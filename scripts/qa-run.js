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

const { execFileSync, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(REPO_ROOT, '.qa', 'qa-run.json');

const argv = process.argv.slice(2);
let FORCE_ALL = argv.includes('--all');
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
  // `vendors` is workspace-scoped in firestore.rules and read by accounting.js,
  // but it was never added here or to the §4 list — the guard has been blind to
  // it since it shipped. A guard is only as good as this array.
  'vendors',
  // Dimension master + the per-dimension balance rollup (2026-08-16).
  'dimensions', 'ledger_balances_by_dim', 'items',
  'goods_receipts', 'stock_movements', 'stock_adjustments',
  // Point of sale (2026-08-21).
  'pos_tables', 'pos_orders', 'pos_shifts',
  // Reservations (2026-09-01) — a booking holds a table, so it is operational
  // data the scope guard has to see.
  'pos_reservations',
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

  // Runs on EVERY invocation, not from the diff. Its whole job is catching
  // claims this repo makes about itself in more than one place drifting apart —
  // and the file that drifts is rarely the file you just edited. Cheap: pure
  // file reads, no network, no browser.
  ok = record('be', run('check:structure-drift', 'node', ['tests/structure-drift.check.js'])) && ok;

  // Also unconditional. firestore.rules / firestore.indexes.json / storage.rules
  // do NOT ship with `git push` — they are separate Firebase commands — and code
  // that depends on an undeployed one breaks production the moment it lands.
  // Batch writes are atomic, so a missing rules block does not degrade a feature,
  // it fails every posting. Cheap: three file hashes, no network, no credentials.
  ok = record('be', run('check:deploy-stamp (rules/indexes deployed?)', 'node', ['tests/deploy-stamp.check.js'])) && ok;

  // Unconditional for the same reason as structure-drift: a hardcoded currency
  // literal is usually reintroduced in a file nobody thinks of as "the currency
  // file". It never throws — it renders a plausible wrong number (wrong symbol,
  // wrong decimals, wrong separators), which for a non-IDR workspace means
  // showing 100x the real money. Cheap: file reads plus one grep.
  ok = record('be', run('check:money-seam (currency renders via the seam?)', 'node', ['tests/money-seam.check.js'])) && ok
        // Unconditional: the price book lives in billing-config.js AND
        // firestore.rules, and neither file needs to be in the diff for them
        // to disagree — a rules deploy alone can do it.
        ok = record('be', run('check:price-book (client prices == rules prices?)', 'node', ['tests/billing-price-book.check.js'])) && ok
        // Unconditional: `node --check` returns 0 for a module-mode SyntaxError,
        // and a module that cannot parse fails silently at runtime because every
        // dynamic import of it sits inside a catch. kyc-gate.js reached main that
        // way and the KYC gate stopped running with nothing going red.
        ok = record('be', run('check:module-parse (every client module parses?)', 'node', ['tests/module-parse.check.js'])) && ok;
  // Unconditional, for the same reason as the price book: the two eligibility
  // signals live in feature-access.js while the DATA they read is stamped by
  // onboarding and by a backfill script, so neither file needs to be in the diff
  // for the pair to stop agreeing. The branch that matters — an unstamped
  // workspace keeping its module through the email allowlist — returns the same
  // boolean as the category branch, so nothing else can see it break.
  ok = record('be', run('check:feature-category (category vs allowlist precedence)', 'node', ['tests/feature-access-category.check.js'])) && ok;
  // Unconditional: the boundary is breached by editing pos-service.js, but it is
  // also breached by DELETING a method from db-service.js that the POS still
  // calls — and that edit lands in a file the POS author never opened.
  ok = record('be', run('check:pos-boundary (POS DAL edge into DataService)', 'node', ['tests/pos-service-boundary.check.js'])) && ok;
  // Unconditional, for the reason the check itself explains: the availability
  // rule is one claim asserted in FOUR places — pos-availability.js, the floor
  // plan, the Create Order dialog and `createPosOrder` — and the way it breaks
  // is silent. A status dropped from an allowlist does not error; the order
  // vanishes from the board and its table reads as free, which is a table sold
  // twice during service.
  ok = record('be', run('check:pos-availability (one rule for a free table)', 'node', ['tests/pos-availability.check.js'])) && ok;
  // Unconditional: the origin list is mirrored into cors.json and netlify.toml,
  // which are enforced by Google and the browser rather than by our code. Either
  // can fall out of sync without a function file being in the diff, and the
  // symptom is an opaque CORS error from ONE origin.
  ok = record('be', run('check:origins (one CORS allowlist, mirrors agree)', 'node', ['tests/allowed-origins.check.js'])) && ok;
  // Unconditional. This is the ONLY endpoint that serves workspace data to a
  // caller with no account, and both its inputs come from a stranger's URL bar.
  // The guard that matters most — that it never mints a getDownloadURL link —
  // can be broken by an edit anywhere in the file, and the consequence is a
  // permanent public URL to a customer's menu that cannot be revoked.
  ok = record('be', run('check:qr-image (no public URL, refuses before Firebase)', 'node', ['tests/qr-menu-image.check.js'])) && ok;
  // Unconditional, and the sharpest of the three. `wsPosOrderKeys` is a
  // `hasOnly`, so a key qr-order writes that the rules do not allow succeeds
  // when written (Admin SDK bypasses rules) and then fails EVERY later till
  // update to that order — the exact shape that kept a day of till sales out of
  // the ledger on 2026-08-31. Nothing about it is visible until a cashier
  // touches the order.
  ok = record('be', run('check:qr-order (rules-shaped doc, server-resolved price)', 'node', ['tests/qr-order.check.js'])) && ok;
  // Unconditional, for the same reason. An off-by-one in a limiter is either a
  // public endpoint with no ceiling or a restaurant whose customers are refused
  // their own menu, and neither states itself at runtime.
  ok = record('be', run('check:rate-limit (counts, refuses, fails open)', 'node', ['tests/rate-limit.check.js'])) && ok;
  // Unconditional. The arithmetic is invisible at runtime: relieving too little
  // inflates gross margin, relieving too much invents cost, and neither raises
  // anything. It also crosses FOUR explicit field lists between the item and the
  // stock movement, any one of which can drop `consumes` silently.
  ok = record('be', run('check:modifier-cogs (a priced option moves stock)', 'node', ['tests/modifier-cogs.check.js'])) && ok;
  // Unconditional. The offending call can live in ANY module — the first
  // Firestore touch on a page decides the transport for all of it — so the file
  // that breaks this is rarely the file being edited. Same reasoning as
  // structure-drift.
  ok = record('be', run('check:firestore-transport (one long-polling initializer)', 'node', ['tests/firestore-transport.check.js'])) && ok;

  const jsChanged = changed.filter((f) => /\.(js|mjs)$/.test(f) && fs.existsSync(path.join(REPO_ROOT, f)));
  if (jsChanged.length) {
    for (const f of jsChanged) {
      // `node --check <file>` parses as a SCRIPT unless the extension says
      // otherwise, so it accepts a stray `});` that closes nothing — valid in a
      // script, a SyntaxError in a module. A broken checkout.js passed this
      // check on 2026-08-24 and only failed in the browser.
      //
      // Anything with import/export must be parsed as a module to be checked at
      // all. `--input-type=module` needs stdin, hence the shell redirect.
      const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      const isModule = f.endsWith('.mjs') || /^\s*(import|export)\s/m.test(src);
      ok = record('be', isModule
        ? run(`syntax (module): ${f}`, 'bash', ['-c', `node --input-type=module --check < ${JSON.stringify(f)}`])
        : run(`syntax: ${f}`, 'node', ['--check', f])) && ok;
    }
  }

  const touched = (re) => changed.some((f) => re.test(f));

  // The event QR is a printed artefact: if it stops decoding it fails silently,
  // in front of people. Only runs when the symbol or its generator changes.
  if (touched(/^assets\/images\/qr-event\.svg$|^scripts\/make-qr\.js$/)) {
    ok = record('be', run('QR decodes (logo composited)', 'bash', ['scripts/qa/verify-qr.sh'])) && ok;
  }

  if (FORCE_ALL || touched(/^scripts\/prepare-deploy\.js$|^deploy\/|^[^/]+\.html$/)) {
    ok = record('be', run('check:deploy (two-site split)', 'node', ['tests/prepare-deploy.check.js'])) && ok;
  }
  if (FORCE_ALL || touched(/db-service\.js|^netlify\/|^functions\//)) {
    ok = record('be', run('check:ai-scope', 'node', ['tests/ai-finance-scope.check.js'])) && ok;
    ok = record('be', run('check:bank-scope', 'node', ['tests/bank-statement-scope.check.js'])) && ok;
    // The KYC alert fires per new signup/submission. Its recency window is the
    // only thing preventing one email per existing roster user on first sweep.
    ok = record('be', run('check:kyc-alerts', 'node', ['tests/kyc-alert-backfill.check.js'])) && ok;
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
  // The QA cleanup script is run BY HAND against a real workspace, so its first
  // execution must not also be its first test. The check is about what it
  // REFUSES to touch — `awaiting_payment` (money partially applied), `paid`
  // (revenue posted), and real products whose names merely start with "QA".
  if (FORCE_ALL || touched(/cleanup-qa-test-data\.js|cleanup-pos\.check\.js/)) {
    ok = record('be', run(
      'check:cleanup-pos (emulator)',
      'npx',
      ['firebase', 'emulators:exec', '--config', '.rules-build/firebase.json', '--only', 'firestore',
       'node tests/cleanup-pos.check.js'],
      { timeout: 5 * 60_000 }
    )) && ok;
  }
  if (FORCE_ALL || touched(/^firestore\.rules$|^storage\.rules$/)) {
    console.log('    (rules changed — running emulator rules tests, ~60s)');
    const specs = gitLines(['ls-files', 'tests/*-rules-emulator-test.mjs']);
    if (specs.length) {
      // A shell LOOP, not `node a && node b && …`. The joined form grew past the
      // argv limit at 17 specs and returned exit 126 ("cannot execute") — which
      // reads exactly like a test failure and would have been chased as one.
      // The loop is a fixed-length string however many specs exist, and echoing
      // each name makes a failure attributable to one file.
      ok = record('be', run(
        'firestore rules (emulator)',
        'npx',
        ['firebase', 'emulators:exec', '--only', 'firestore,auth',
         'for s in tests/*-rules-emulator-test.mjs; do echo "--- $s"; node "$s" || exit 1; done'],
        { timeout: 10 * 60_000 }
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

// ── Change level ─────────────────────────────────────────────────────────────
//
// Computed from the diff (scripts/classify-change.js), never declared. L3+ forces
// the full lane set rather than the diff-selected subset: the multi-currency work
// was Level 4 and ran with Level 2 gates, which is how a 100x invoice amount and
// a KYC gate that had stopped running both reached main.
function changeLevel() {
  try {
    const out = execSync('node scripts/classify-change.js --json', { cwd: REPO_ROOT, encoding: 'utf8' });
    return JSON.parse(out);
  } catch (_) { return { level: 4, label: 'unknown (classifier failed — assuming L4)', gates: [] }; }
}

// ── Rotating sweep shard ─────────────────────────────────────────────────────
//
// The sweep only ever loaded CHANGED pages plus a fixed core set, so ~40 of the
// 48 app pages were never opened in a browser unless someone edited them. A page
// could therefore break and stay broken indefinitely: settings-personal.html
// threw on every load and rendered no account details, and nothing noticed until
// an unrelated commit happened to touch it.
//
// A full sweep is not the answer — 48 pages takes over ten minutes, which is not
// payable on every push. Instead each run also opens a small rotating slice, so
// the whole surface is covered every few runs at ~25s a time. The cursor lives
// in .qa/ (gitignored) beside the run artifact.
const SWEEP_SHARD = 4;

function rotatingShard(alreadyCovered) {
  let all = [];
  try {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/prepare-deploy.js'), 'utf8');
    const m = src.match(/const APP_PAGES = \[([\s\S]*?)\];/);
    all = (m ? m[1].match(/'([^']+)'/g) || [] : []).map((q) => q.slice(1, -1));
  } catch (_) { return []; }

  // Pages that cannot be judged by a cold load. Each needs a reason — an
  // exclusion nobody can justify is just a page nobody checks.
  const UNSWEEPABLE = new Set([
    'login.html',            // pre-auth; its expected 400 is already allowlisted
    'payment-pending.html',  // needs a live requestId in the query string
    'internal.html',         // role-gated to internal staff
    'internal-dashboard.html',
  ]);

  const pool = all.filter((f) => !UNSWEEPABLE.has(f) && !alreadyCovered.includes(f)
    && fs.existsSync(path.join(REPO_ROOT, f)));
  if (!pool.length) return [];

  const cursorFile = path.join(REPO_ROOT, '.qa', 'sweep-cursor.json');
  let cursor = 0;
  try { cursor = Number(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).cursor) || 0; } catch (_) {}
  const shard = [];
  for (let i = 0; i < Math.min(SWEEP_SHARD, pool.length); i += 1) {
    shard.push(pool[(cursor + i) % pool.length]);
  }
  try {
    fs.mkdirSync(path.join(REPO_ROOT, '.qa'), { recursive: true });
    fs.writeFileSync(cursorFile, JSON.stringify({
      cursor: (cursor + shard.length) % pool.length,
      pool: pool.length,
      note: 'Rotating console-sweep position. Delete to restart the rotation.',
    }, null, 2));
  } catch (_) { /* a missing cursor just means the rotation restarts */ }
  return shard;
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
  // No early exit for "nothing changed" any more: the rotating slice is the
  // whole point — it opens pages precisely when nobody has touched them.

  const env = {};
  let scopeNote;
  if (FORCE_ALL || sharedTouched) {
    // Shared module or --all: the curated core set already covers the risk.
    scopeNote = sharedTouched ? 'core pages (shared module changed)' : 'core pages';
  } else {
    const shard = rotatingShard(pages);
    env.QA_SWEEP_PAGES = [...pages, ...shard].join(',');
    scopeNote = pages.length
      ? `${pages.join(',')}  + rotating: ${shard.join(',') || 'none left'}`
      : `rotating: ${shard.join(',')}`;
  }
  console.log(`    sweeping: ${scopeNote}`);

  // ONE Playwright invocation for both suites. Running them as two separate
  // `playwright test` calls made the auth-setup project run twice and contend on
  // the same static server — the second run intermittently timed out on
  // /login.html and failed the lane for no real reason. A flaky gate is worse
  // than a slow one: it teaches you to re-run instead of to read the failure.
  //
  // The currency suite is here because currency rendering is a TIMING property.
  // The static check proves the source is clean; only a real browser proves the
  // page never paints the wrong currency, that the boot mask lifts, and that the
  // seam is initialised wherever money renders.
  ok = record('fe', run(
    'browser: console sweep + currency render',
    'npx',
    ['playwright', 'test',
      'tests/zz-console-sweep.spec.js',
      'tests/base-currency-render.spec.js',
      '--project=chromium', '--reporter=line'],
    { env, timeout: 12 * 60_000 }
  )) && ok;

  // Second pass on the NON-IDR workspace. A separate invocation because it needs
  // its own auth-setup and storageState. It runs ONE small spec rather than the
  // sweep, so the cost is ~20s instead of a second full pass — what the extra
  // account uniquely buys is the currency assertion, not more page coverage.
  // Skips itself when the fixture is absent, so this is a no-op for anyone
  // without the account.
  ok = record('fe', run(
    'browser: non-IDR workspace currency',
    'npx',
    ['playwright', 'test', 'tests/workspace-currency.spec.js',
      '--project=chromium-ph', '--reporter=line'],
    { env, timeout: 6 * 60_000 }
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
    // A page that declares noindex has no search surface, so the discovery
    // rules in SEO_STRATEGY.md do not apply to it — requiring Open Graph and
    // JSON-LD on a private, unlisted page asks for rich previews of something
    // deliberately kept out of search. The private-link pages (investor.html,
    // beila.html) are the cases; they are in MARKETING_PAGES only because that
    // list decides which ORIGIN serves a page, not whether it is a landing page.
    if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) continue;
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

  // The two SEO generators have an ORDER dependency and no other guard.
  // `build-id-mirrors.js` copies each root page's JSON-LD verbatim — including
  // the ENGLISH Organization block — and `sync-org-schema.js` is what rewrites
  // the /id/ pages to the Indonesian description. Run them the other way round
  // and the Indonesian pages ship an English company description: valid JSON-LD,
  // correct hreflang, no console error, no visible defect. Nothing catches it.
  //
  // `--check` exits 1 on exactly that state, so it is the guard. Scoped to the
  // changes that can cause it rather than every run.
  const orgSurfaceTouched = changed.some(
    (f) => /^id\/[^/]+\.html$/.test(f)
        || f === 'seo/organization.json'
        || f === 'scripts/build-id-mirrors.js'
        || f === 'scripts/sync-org-schema.js'
        || /^[^/]+\.html$/.test(f)
  );
  if (FORCE_ALL || orgSurfaceTouched) {
    ok = record('product', run('seo:check-org (Organization entity in sync)', 'node',
      ['scripts/sync-org-schema.js', '--check'])) && ok;
    // The /id/ mirrors are generated from the root pages through the i18n
    // dictionary, and a dictionary miss ships English into a Bahasa page with
    // no error and no visible defect. That is how id/pricing.html regressed to
    // English review quotes (37% English) while hreflang, canonicals and the
    // schema all still looked correct. Fail the lane on an untranslated segment.
    ok = record('product', run('seo:check-id (no untranslated /id/ segments)', 'node',
      ['scripts/build-id-mirrors.js', '--check'])) && ok;
  }

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

  // Level drives the gate set. L3+ runs everything: at those levels the failure
  // mode is a plausible-looking wrong value, not a crash, so lane selection from
  // the diff is not enough — the file that breaks is often not the file edited.
  const lvl = changeLevel();
  console.log(`  level   L${lvl.level} — ${lvl.label}`);
  if (lvl.level >= 4) {
    console.log('          ⚠ financial/security surface — verify in a NON-IDR workspace;');
    console.log('            IDR is both the right answer and the fallback.');
  }
  if (lvl.level >= 3 && !FORCE_ALL) {
    FORCE_ALL = true;
    console.log('  mode    every lane forced (L3+)');
  } else if (FORCE_ALL) {
    console.log('  mode    --all (every lane forced)');
  }

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
