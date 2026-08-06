#!/usr/bin/env node
/**
 * Extract inline <script> bodies so codebase-memory-mcp can see them.
 *
 * The indexer parses .js files but not JavaScript embedded in HTML, and this
 * project keeps ~11k lines of page logic in inline <script> blocks across 48
 * root pages. Measured before this script existed: ledger.html contributed
 * exactly 2 graph nodes (File + Module) and zero functions, so `showAddTransactionModal`
 * — a function CLAUDE.md names explicitly — was unfindable in the graph while
 * grep found it in five files.
 *
 * LINE NUMBERS ARE PRESERVED. Everything outside a <script> body is replaced
 * with blank lines, so line N of `<page>.inline.js` is line N of `<page>.html`.
 * A graph hit at ledger.inline.js:1874 is ledger.html:1874 — no offset table to
 * get wrong, and no silent drift when the page is edited.
 *
 * Output is generated, gitignored, and safe to delete. Re-run after substantial
 * page edits; the graph is only as fresh as its last index.
 *
 * Usage:
 *   node scripts/cbm-extract-inline.js          # extract
 *   node scripts/cbm-extract-inline.js --check  # report staleness, write nothing
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'cbm-extracted');

// Inline == no src attribute. Also skip non-JS payloads: JSON-LD blocks are
// structured data, and template scripts are markup, not code.
const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const NON_JS_TYPE = /type\s*=\s*["'](application\/ld\+json|text\/template|text\/x-template)["']/i;

/**
 * Keep the generated mirror out of git WITHOUT hiding it from the indexer.
 *
 * This is deliberate and load-bearing: codebase-memory-mcp honours .gitignore,
 * so listing cbm-extracted/ there drops it from the graph entirely (measured:
 * 6470 nodes with it indexed, 5540 without). It does NOT read
 * .git/info/exclude, which git treats identically for status/add purposes. So
 * the ignore lives there instead — git stays quiet, the graph stays complete.
 *
 * .git/info/exclude is per-clone and never committed, so re-assert it on every
 * run rather than assuming a teammate's clone has it.
 */
function ensureGitExclude() {
  const excludeFile = path.join(REPO_ROOT, '.git', 'info', 'exclude');
  try {
    if (!fs.existsSync(path.dirname(excludeFile))) return; // not a git checkout
    const cur = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    if (/^cbm-extracted\/?$/m.test(cur)) return;
    fs.appendFileSync(
      excludeFile,
      '\n# Generated inline-JS mirror for the codebase-memory graph.\n' +
        '# Must NOT go in .gitignore — the indexer honours that and would skip it.\n' +
        'cbm-extracted/\n'
    );
    console.log('cbm-extract: added cbm-extracted/ to .git/info/exclude');
  } catch {
    /* best effort — a missing exclude only costs git-status noise */
  }
}

function htmlFiles() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 2) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'cbm-extracted') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, depth + 1);
      else if (entry.name.endsWith('.html')) out.push(path.relative(REPO_ROOT, abs));
    }
  };
  walk(REPO_ROOT, 0);
  return out;
}

/**
 * Build a line-aligned JS file from an HTML page.
 * @returns {{ js: string, blocks: number, codeLines: number }}
 */
function extract(html) {
  const lines = html.split('\n');
  // Start with a blank canvas of the same shape as the source.
  const out = new Array(lines.length).fill('');

  let blocks = 0;
  let codeLines = 0;
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    const [, attrs, body] = m;
    if (NON_JS_TYPE.test(attrs || '')) continue;
    if (!body || body.trim().length === 0) continue;

    // Line index of the character right after the opening tag.
    const openEnd = m.index + m[0].indexOf('>') + 1;
    const startLine = html.slice(0, openEnd).split('\n').length - 1; // 0-based

    const bodyLines = body.split('\n');
    // body[0] is the remainder of the opening-tag line; keep it there so the
    // alignment holds even for single-line <script>foo()</script>.
    for (let i = 0; i < bodyLines.length; i++) {
      const target = startLine + i;
      if (target >= out.length) break;
      const text = bodyLines[i];
      if (out[target]) out[target] += ' ' + text;
      else out[target] = text;
      if (text.trim()) codeLines++;
    }
    blocks++;
  }

  return { js: out.join('\n'), blocks, codeLines };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const pages = htmlFiles();

  if (!checkOnly) {
    ensureGitExclude();
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  let written = 0;
  let totalBlocks = 0;
  let totalLines = 0;
  const stale = [];

  for (const page of pages) {
    const abs = path.join(REPO_ROOT, page);
    const html = fs.readFileSync(abs, 'utf8');
    const { js, blocks, codeLines } = extract(html);
    if (!blocks || codeLines < 5) continue;

    // Mirror the source path so id/ledger.html and ledger.html stay distinct.
    const outRel = page.replace(/\.html$/, '.inline.js');
    const outAbs = path.join(OUT_DIR, outRel);

    if (checkOnly) {
      const prev = fs.existsSync(outAbs) ? fs.readFileSync(outAbs, 'utf8') : null;
      if (prev !== js) stale.push(page);
    } else {
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, js);
      written++;
    }
    totalBlocks += blocks;
    totalLines += codeLines;
  }

  if (checkOnly) {
    if (stale.length) {
      console.log(`cbm-extract: ${stale.length} page(s) changed since last extract:`);
      for (const s of stale.slice(0, 10)) console.log(`  ${s}`);
      if (stale.length > 10) console.log(`  … and ${stale.length - 10} more`);
      console.log('\nRun: npm run cbm:sync');
      process.exit(1);
    }
    console.log('cbm-extract: up to date');
    process.exit(0);
  }

  console.log(`cbm-extract: ${written} file(s), ${totalBlocks} inline block(s), ${totalLines} code line(s)`);
  console.log(`  -> cbm-extracted/  (generated, gitignored; line numbers match the source HTML)`);
}

if (require.main === module) main();
module.exports = { extract, htmlFiles };
