#!/usr/bin/env node
/**
 * FluxyOS design-system linter.
 *
 * Enforces the mechanically-checkable subset of docs/DESIGN_SYSTEM.md and the
 * CLAUDE.md design rules. Most anti-slop rules ("one primary action per
 * viewport zone", "sections must earn their space") are judgement calls and are
 * deliberately NOT encoded here — a linter that guesses at those produces noise
 * and trains everyone to ignore it.
 *
 * DELTA BY DEFAULT. The repo carries pre-existing violations (208 orange
 * backgrounds, 34 spaced `Rp ` on app pages as of 2026-08-07). Linting the
 * whole tree would fail on arrival and get muted within a day, so by default
 * only files you actually changed are checked. `--all` runs a full audit for
 * when you want the backlog.
 *
 * Usage:
 *   node scripts/qa/lint-design.js                 # changed files vs origin/main
 *   node scripts/qa/lint-design.js --all           # whole tree (expect failures)
 *   node scripts/qa/lint-design.js --files a.html b.js
 *   node scripts/qa/lint-design.js --json          # machine-readable
 *
 * Exit 0 = clean, 1 = violations found.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Page classification comes from scripts/prepare-deploy.js, which CLAUDE.md
// already makes the single source of truth for the two-site split ("every new
// root *.html MUST be classified"). Re-deriving it here with a regex drifts —
// the first version of this linter guessed, and misfiled all six KPI
// drill-down pages plus login.html as marketing.
function loadPageLists() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'prepare-deploy.js'), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (!m) throw new Error(`prepare-deploy.js: could not parse ${name}`);
    return new Set(
      m[1].split('\n').map((l) => (l.match(/'([^']+\.html)'/) || [])[1]).filter(Boolean)
    );
  };
  return { app: grab('APP_PAGES'), marketing: grab('MARKETING_PAGES') };
}

const PAGES = loadPageLists();

// `/id/x.html` mirrors root `x.html`, so classify by basename.
const basename = (f) => f.replace(/^.*\//, '');
const isAppPage = (f) => f.endsWith('.html') && PAGES.app.has(basename(f));
const isAppJs = (f) => f.startsWith('assets/js/');
const isLanding = (f) => f.endsWith('.html') && PAGES.marketing.has(basename(f));

/**
 * Each rule: { id, severity, applies(file), scan(line, file) -> message|null }
 * Rules are line-oriented so we can report file:line and let the caller anchor.
 */
const RULES = [
  {
    id: 'orange-background',
    severity: 'error',
    doc: 'CLAUDE.md — "Orange backgrounds are PROHIBITED project-wide"',
    applies: (f) => /\.(html|css)$/.test(f) && !f.startsWith('docs/'),
    scan(line) {
      // Gradients are explicitly allowed (orange is legal as an accent and in
      // gradients), so from-/via-/to- prefixes must not trip this.
      const m = line.match(/(?<![\w-])bg-orange-\d{2,3}\b/);
      if (m) return `orange background utility \`${m[0]}\` — orange is accent-only`;
      const hex = line.match(/background(-color)?\s*:\s*#(ea580c|EA580C)/);
      if (hex) return 'orange hex used as a background — orange is accent-only';
      return null;
    },
  },
  {
    id: 'rp-space',
    severity: 'error',
    doc: 'DESIGN_SYSTEM.md §"Numeric & currency format (strict)" — `Rp1.000`, never `Rp 1.000`',
    applies: (f) => isAppPage(f) || isAppJs(f),
    scan(line) {
      // Only a space directly before a digit or a template expression is a
      // currency violation; "Rp" in prose ("nilai Rp yang tampil") is fine.
      const m = line.match(/\bRp \$\{|\bRp \d/);
      if (m) return `space after \`Rp\` (\`${m[0].trim()}…\`) — must render as \`Rp1.000\``;
      return null;
    },
  },
  {
    id: 'mono-numerics',
    severity: 'error',
    doc: 'DESIGN_SYSTEM.md — monospace renders a slashed zero; numbers use Inter + tabular-nums',
    applies: (f) => isAppPage(f) || isAppJs(f) || f === 'assets/css/shared-dashboard.css',
    scan(line, file) {
      // shared-dashboard.css is where `.font-mono` is deliberately PINNED back
      // to Inter, so the string legitimately appears there.
      if (file === 'assets/css/shared-dashboard.css') return null;
      if (/font-family[^;]*Fira Code/i.test(line)) {
        return 'Fira Code in a font-family on an app surface — banned for numerics';
      }
      return null;
    },
  },
  {
    id: 'fractional-tailwind',
    severity: 'error',
    doc: 'DESIGN_SYSTEM.md §4 — `h-4.5`/`w-4.5` are not in Tailwind\'s scale and render oversized',
    applies: (f) => /\.(html|js)$/.test(f) && !f.startsWith('docs/'),
    scan(line) {
      // Tailwind's default scale DOES include 0.5/1.5/2.5/3.5 — those are valid
      // and heavily used here. Only 4.5 and up are unsupported.
      const m = line.match(/(?<![\w-])[hw]-(?:[4-9]|\d{2,})\.5(?![\w-])/);
      if (m) return `\`${m[0]}\` is not a generated Tailwind class — use h-4/h-5 or explicit CSS`;
      return null;
    },
  },
  {
    id: 'generic-eyebrow',
    severity: 'error',
    doc: 'CLAUDE.md — generic hero eyebrow labels are prohibited',
    applies: (f) => f.endsWith('.html') && !f.startsWith('docs/'),
    scan(line) {
      if (/\b(?:and|dan)\s+AI\s+in\s+one\s+system\b/i.test(line)) {
        return 'generic hero eyebrow ("… and AI in one system") — the H1 already says it';
      }
      return null;
    },
  },
  {
    id: 'tailwind-cdn',
    severity: 'error',
    doc: 'CLAUDE.md — Tailwind CDN is not allowed on landing pages (kills LCP)',
    applies: (f) => isLanding(f),
    scan(line) {
      if (/cdn\.tailwindcss\.com/.test(line)) {
        return 'Tailwind CDN on a landing page — use assets/css/tailwind.min.css';
      }
      return null;
    },
  },
];

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
};
const gitLines = (args) => git(args).split('\n').filter(Boolean);

/**
 * Line numbers ADDED by a diff, per file. Merely opening a file must not
 * inherit its backlog — ledger.html carries four pre-existing orange
 * backgrounds, and flagging those every time someone edits an unrelated part of
 * the page is how a linter earns a permanent `--no-verify`.
 *
 * Returns Map<file, Set<lineNo>>; a file mapped to `null` means "whole file"
 * (untracked/new), which the caller treats as every line.
 */
function addedLines(ranges) {
  const map = new Map();
  const add = (file, line) => {
    if (map.get(file) === null) return; // already whole-file
    if (!map.has(file)) map.set(file, new Set());
    map.get(file).add(line);
  };

  for (const range of ranges) {
    const out = git(['diff', '-U0', ...range]);
    let file = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('+++ b/')) file = line.slice(6);
      else if (line.startsWith('+++ ')) file = null;
      else if (file && line.startsWith('@@')) {
        // @@ -old,cnt +new,cnt @@
        const m = line.match(/@@ -\S+ \+(\d+)(?:,(\d+))?/);
        if (!m) continue;
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let i = 0; i < count; i++) add(file, start + i);
      }
    }
  }

  // Untracked files are entirely new — every line counts.
  for (const f of gitLines(['ls-files', '--others', '--exclude-standard'])) map.set(f, null);

  return map;
}

function changedScope() {
  return addedLines([['HEAD'], ['--cached'], ['origin/main...HEAD']]);
}

function allFiles() {
  return gitLines(['ls-files']);
}

/**
 * @param {string[]} files
 * @param {Map<string, Set<number>|null>|null} scope  null = lint every line
 */
function lint(files, scope = null) {
  const findings = [];
  for (const file of files) {
    // The linter's own rule definitions contain the patterns they ban.
    if (/node_modules|^\.qa\/|^scripts\/qa\//.test(file)) continue;
    const lineScope = scope ? scope.get(file) : undefined;
    if (scope && lineScope === undefined) continue;
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;

    const active = RULES.filter((r) => r.applies(file));
    if (!active.length) continue;

    let lines;
    try {
      lines = fs.readFileSync(abs, 'utf8').split('\n');
    } catch {
      continue;
    }

    lines.forEach((line, i) => {
      // lineScope null = whole file (new/untracked); Set = only added lines.
      if (scope && lineScope !== null && !lineScope.has(i + 1)) return;
      for (const rule of active) {
        const msg = rule.scan(line, file);
        if (msg) {
          findings.push({ file, line: i + 1, rule: rule.id, severity: rule.severity, message: msg, doc: rule.doc });
        }
      }
    });
  }
  return findings;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const all = argv.includes('--all');
  const fileFlag = argv.indexOf('--files');

  let files;
  let scope = null;
  if (fileFlag !== -1) {
    files = argv.slice(fileFlag + 1).filter((a) => !a.startsWith('--'));
  } else if (all) {
    files = allFiles();
  } else {
    scope = changedScope();
    files = [...scope.keys()];
  }

  const findings = lint(files, scope);

  if (asJson) {
    process.stdout.write(JSON.stringify({ scanned: files.length, findings }, null, 2) + '\n');
  } else if (!findings.length) {
    console.log(`design-lint: clean (${files.length} file${files.length === 1 ? '' : 's'} scanned)`);
  } else {
    console.log(`design-lint: ${findings.length} violation(s) in ${files.length} scanned file(s)\n`);
    const byRule = {};
    for (const f of findings) (byRule[f.rule] ||= []).push(f);
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`  ${rule}  (${list[0].doc})`);
      for (const f of list) console.log(`    ${f.file}:${f.line}  ${f.message}`);
      console.log('');
    }
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { lint, changedScope, allFiles, RULES };
