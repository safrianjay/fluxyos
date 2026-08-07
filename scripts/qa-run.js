#!/usr/bin/env node
/**
 * FluxyOS automated QA runner.
 *
 * Replaces the manual pre-push checklist in .claude/hooks/qa-gate.sh with three
 * lanes, and writes a signed-ish artifact the push gate verifies:
 *
 *   BE       syntax, the workspace-scoping invariant, the existing check:*
 *            regression scripts, Firestore rules tests when rules changed
 *   FE       design-system lint (delta) + a real-browser console sweep of the
 *            pages the change actually touches
 *   PRODUCT  i18n EN/ID pairing, two-site page classification, SEO essentials
 *
 * Lanes are selected from the git diff, so an accounting-only change does not
 * pay for a landing-page SEO scan.
 *
 * The artifact lands at .qa/qa-run.json (gitignored) stamped with the HEAD sha.
 * qa-gate.sh accepts QA_PASS=1 only when that file exists, passed, and matches
 * the commit being pushed — so QA_PASS stops being a thing you can simply type.
 * Commit first, then run QA, then push.
 *
 * Usage:
 *   npm run qa                # lanes selected from the diff
 *   npm run qa -- --all       # force every lane
 *   npm run qa -- --lane=be   # one lane
 *   npm run qa -- --skip-browser   # no Playwright (fast; artifact marked partial)
 */

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(REPO_ROOT, '.qa', 'qa-run.json');

const argv = process.argv.slice(2);
const FORCE_ALL = argv.includes('--all');
const SKIP_BROWSER = argv.includes('--skip-browser');
const ONLY_LANE = (argv.find((a) => a.startsWith('--lane=')) || '').split('=')[1] || null;

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function git(args, { allowFail = true } = {}) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}
const gitLines = (args) => git(args).split('\n').filter(Boolean);

const headSha = () => git(['rev-parse', 'HEAD']);
const isDirty = () => git(['status', '--porcelain']).length > 0;

function changedFiles() {
  const set = new Set([
    ...gitLines(['diff', '--name-only', 'HEAD']),
    ...gitLines(['diff', '--name-only', '--cached']),
    ...gitLines(['diff', '--name-only', 'origin/main...HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ]);
  return [...set].filter((f) => !f.startsWith('.qa/'));
}

// ---------------------------------------------------------------------------
// check runner
// ---------------------------------------------------------------------------

/**
 * Run a command and capture its REAL exit status.
 *
 * Never pipe these through `tail`/`head` — the pipeline reports the LAST
 * command's status, so a failing Playwright run reads as exit 0 and a red suite
 * sails through the gate. That has burned this project before.
 */
function run(name, cmd, args, opts = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = res.status === 0;
  return {
    name,
    ok,
    status: res.status,
    ms: Date.now() - started,
    // Keep the tail of the output for the artifact; full output goes to stdout.
    detail: ok ? '' : output.split('\n').slice(-40).join('\n').trim(),
    output,
  };
}

const results = [];
function record(lane, r, { printOnPass = false } = {}) {
  results.push({ lane, ...r, output: undefined });
  const icon = r.ok ? '✓' : '✗';
  console.log(`  ${icon} ${r.name}${r.ok ? '' : `  (exit ${r.status})`}`);
  if (!r.ok || printOnPass) {
    const body = (r.ok ? r.output : r.detail).trim();
    if (body) console.log(body.split('\n').map((l) => `      ${l}`).join('\n'));
  }
  return r.ok;
}

// ---------------------------------------------------------------------------
// BE lane
// ---------------------------------------------------------------------------

// Full finance-collection list from docs/PROJECT_BACKGROUND.md §4. The copy
// baked into qa-gate.sh predates the Tax Center, Commerce, and accounting-kernel
// collections, so it silently misses a scope leak in any of them.
const FINANCE_COLLECTIONS = [
  'transactions', 'bills', 'subscriptions', 'budgets', 'budget_allocations',
  'invoices', 'audit_logs', 'bank_accounts', 'bank_balance_snapshots',
  'bank_statement_imports', 'documents', 'report_exports', 'accounting_mappings',
  'chart_of_accounts', 'business_categories', 'journals', 'counters',
  'ledger_balances', 'periods',
  'company_tax_profile', 'tax_mappings', 'tax_transactions', 'tax_periods', 'tax_filings',
  'commerce_accounts', 'commerce_orders', 'commerce_transactions', 'commerce_refunds',
  'commerce_settlements', 'commerce_payouts', 'commerce_sync_jobs',
  'commerce_sync_errors', 'commerce_webhook_logs',
];

function scopeGuard() {
  const re = new RegExp(
    `users/\\$\\{[a-zA-Z_.]+\\}/(${FINANCE_COLLECTIONS.join('|')})\\b`
  );
  const targets = [
    ...gitLines(['ls-files', '*.html']),
    ...gitLines(['ls-files', 'assets/js/*.js']),
  ].filter((f) => !f.endsWith('db-service.js'));

  const hits = [];
  for (const f of targets) {
    const abs = path.join(REPO_ROOT, f);
    if (!fs.existsSync(abs)) continue;
    fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(re);
      if (m) hits.push(`${f}:${i + 1}  ${m[0]}`);
    });
  }
  return {
    name: 'workspace-scoping invariant (finance collections)',
    ok: hits.length === 0,
    status: hits.length ? 1 : 0,
    ms: 0,
    detail: hits.length
      ? `Hardcoded user-scoped finance path(s) — members would see 0 data.\nRoute through \${ds._scope(userId)}/… instead:\n${hits.join('\n')}`
      : '',
    output: '',
  };
}

function laneBE(changed) {
  console.log('\nBE');
  let ok = true;

  ok = record('be', scopeGuard()) && ok;

  const jsChanged = changed.filter((f) => /\.(js|mjs)$/.test(f) && fs.existsSync(path.join(REPO_ROOT, f)));
  if (jsChanged.length) {
    for (const f of jsChanged) {
      ok = record('be', run(`syntax: ${f}`, 'node', ['--check', f])) && ok;
    }
  }

  const touched = (re) => changed.some((f) => re.test(f));

  if (FORCE_ALL || touched(/^scripts\/prepare-deploy\.js$|^deploy\/|^[^/]+\.html$/)) {
    ok = record('be', run('check:deploy (two-site split)', 'node', ['tests/prepare-deploy.check.js'])) && ok;
  }
  if (FORCE_ALL || touched(/db-service\.js|^netlify\/|^functions\//)) {
    ok = record('be', run('check:ai-scope', 'node', ['tests/ai-finance-scope.check.js'])) && ok;
    ok = record('be', run('check:bank-scope', 'node', ['tests/bank-statement-scope.check.js'])) && ok;
    // Intent keyword ORDER and the recommended-action route allowlist. Both fail
    // silently in manual testing — a wrong tab still looks like a real answer.
    ok = record('be', run('check:ai-statements', 'node', ['tests/ai-statement-routing.check.js'])) && ok;
  }
  if (FORCE_ALL || touched(/accounting|ledger|db-service\.js/)) {
    ok = record('be', run('check:ledger-assert', 'node', ['tests/ledger-assert.check.js'])) && ok;
  }
  // The workbook writer is unreachable from the Playwright suite (static server,
  // no Netlify functions), so its contract is guarded here or nowhere.
  if (FORCE_ALL || touched(/statements-xlsx\.js|assets\/js\/accounting\.js/)) {
    ok = record('be', run('check:statements-workbook', 'node', ['tests/statements-workbook.check.js'])) && ok;
  }
  if (FORCE_ALL || touched(/^firestore\.rules$|^storage\.rules$/)) {
    console.log('    (rules changed — running emulator rules tests, ~60s)');
    const specs = gitLines(['ls-files', 'tests/*-rules-emulator-test.mjs']);
    if (specs.length) {
      ok = record('be', run(
        'firestore rules (emulator)',
        'npx',
        ['firebase', 'emulators:exec', '--only', 'firestore,auth', specs.map((s) => `node ${s}`).join(' && ')],
        { timeout: 8 * 60_000 }
      )) && ok;
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// FE lane
// ---------------------------------------------------------------------------

function affectedPages(changed) {
  const pages = new Set();
  for (const f of changed) {
    if (/^[^/]+\.html$/.test(f)) pages.add(f);
  }
  // A shared module or the shared stylesheet can break any app page, so fall
  // back to the sweep's core set rather than pretending nothing is affected.
  const sharedTouched = changed.some((f) =>
    /^assets\/(js|css)\/(shared-dashboard|db-service|sidebar-loader|onboarding-gate|kyc-gate|trial-access|accounting-engine|fluxy-select)/.test(f)
  );
  return { pages: [...pages], sharedTouched };
}

function laneFE(changed) {
  console.log('\nFE');
  let ok = true;

  ok = record('fe', run('design-system lint (changed lines)', 'node', ['scripts/qa/lint-design.js'])) && ok;

  const { pages, sharedTouched } = affectedPages(changed);
  if (SKIP_BROWSER) {
    console.log('  – console sweep skipped (--skip-browser)');
    return ok;
  }
  if (!FORCE_ALL && !sharedTouched && pages.length === 0) {
    console.log('  – console sweep skipped (no page or shared module changed)');
    return ok;
  }

  const env = {};
  if (!FORCE_ALL && !sharedTouched && pages.length) env.QA_SWEEP_PAGES = pages.join(',');
  const scopeNote = env.QA_SWEEP_PAGES || (sharedTouched ? 'core pages (shared module changed)' : 'core pages');
  console.log(`    sweeping: ${scopeNote}`);

  ok = record('fe', run(
    'browser console sweep',
    'npx',
    ['playwright', 'test', 'tests/zz-console-sweep.spec.js', '--project=chromium', '--reporter=line'],
    { env, timeout: 10 * 60_000 }
  )) && ok;

  return ok;
}

// ---------------------------------------------------------------------------
// PRODUCT lane
// ---------------------------------------------------------------------------

function i18nPairing(changed) {
  // CLAUDE.md: "Any change to user-facing copy in an EN page must include the
  // matching update to its /id/ counterpart in the same commit." Only enforce
  // where a mirror actually exists — most pages have none yet.
  const missing = [];
  for (const f of changed) {
    if (!/^[^/]+\.html$/.test(f)) continue;
    const mirror = `id/${f}`;
    if (!fs.existsSync(path.join(REPO_ROOT, mirror))) continue;
    if (!changed.includes(mirror)) missing.push(`${f} changed but ${mirror} did not`);
  }
  return {
    name: 'i18n EN/ID pairing',
    ok: missing.length === 0,
    status: missing.length ? 1 : 0,
    ms: 0,
    detail: missing.length
      ? `Localization pairing rule (CLAUDE.md):\n${missing.join('\n')}\nUpdate the /id/ mirror in the same commit, or confirm the change is not user-facing copy.`
      : '',
    output: '',
  };
}

function seoEssentials(changed) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'prepare-deploy.js'), 'utf8');
  const m = src.match(/const MARKETING_PAGES = \[([\s\S]*?)\];/);
  const marketing = new Set(
    (m ? m[1] : '').split('\n').map((l) => (l.match(/'([^']+\.html)'/) || [])[1]).filter(Boolean)
  );

  const problems = [];
  for (const f of changed) {
    const base = f.replace(/^.*\//, '');
    if (!f.endsWith('.html') || !marketing.has(base)) continue;
    const abs = path.join(REPO_ROOT, f);
    if (!fs.existsSync(abs)) continue;
    const html = fs.readFileSync(abs, 'utf8');
    const need = [
      [/<title>[^<]{1,70}<\/title>/i, '<title>'],
      [/<meta[^>]+name=["']description["']/i, 'meta description'],
      [/<link[^>]+rel=["']canonical["']/i, 'canonical'],
      [/<meta[^>]+property=["']og:/i, 'Open Graph tags'],
      [/application\/ld\+json/i, 'JSON-LD schema'],
    ];
    for (const [re, label] of need) if (!re.test(html)) problems.push(`${f}: missing ${label}`);
  }
  return {
    name: 'SEO essentials on changed landing pages',
    ok: problems.length === 0,
    status: problems.length ? 1 : 0,
    ms: 0,
    detail: problems.length ? `docs/SEO_STRATEGY.md requires these on every landing page:\n${problems.join('\n')}` : '',
    output: '',
  };
}

function laneProduct(changed) {
  console.log('\nPRODUCT');
  let ok = true;
  ok = record('product', i18nPairing(changed)) && ok;
  ok = record('product', seoEssentials(changed)) && ok;

  const appCopyTouched = changed.some((f) => /^assets\/js\/|^[^/]+\.html$/.test(f));
  if (FORCE_ALL || appCopyTouched) {
    // Advisory: writes .qa/i18n-gap-report.md. Bahasa gaps are a running
    // backlog, not a per-change regression, so this reports without failing.
    const r = run('i18n audit (advisory)', 'node', ['scripts/i18n-audit.js']);
    console.log(`  ${r.ok ? '✓' : 'ℹ'} ${r.name}${r.ok ? '' : ' — see .qa/i18n-gap-report.md'}`);
    results.push({ lane: 'product', name: r.name, ok: true, advisory: true, status: r.status, ms: r.ms, detail: '' });
  }
  return ok;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const changed = changedFiles();
  const sha = headSha();
  const dirty = isDirty();

  console.log('FluxyOS QA');
  console.log(`  HEAD    ${sha.slice(0, 8)}${dirty ? '  (working tree dirty)' : ''}`);
  console.log(`  changed ${changed.length} file(s)`);
  if (FORCE_ALL) console.log('  mode    --all (every lane forced)');

  const lanes = ONLY_LANE ? [ONLY_LANE] : ['be', 'fe', 'product'];
  let ok = true;
  if (lanes.includes('be')) ok = laneBE(changed) && ok;
  if (lanes.includes('fe')) ok = laneFE(changed) && ok;
  if (lanes.includes('product')) ok = laneProduct(changed) && ok;

  const partial = SKIP_BROWSER || Boolean(ONLY_LANE);
  const artifact = {
    schema: 1,
    passed: ok,
    partial,
    head: sha,
    dirty,
    ran_at: new Date().toISOString(),
    changed_files: changed,
    lanes: lanes,
    results: results.map(({ output, ...r }) => r),
  };
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, JSON.stringify(artifact, null, 2) + '\n');

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (ok) {
    console.log(`QA PASSED${partial ? ' (partial — gate will not accept this)' : ''}  → .qa/qa-run.json`);
    if (dirty) console.log('Note: working tree is dirty. Commit, then re-run so the artifact matches what you push.');
  } else {
    console.log(`QA FAILED — ${failed.length} check(s):`);
    for (const f of failed) console.log(`  ✗ [${f.lane}] ${f.name}`);
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
