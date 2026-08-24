#!/usr/bin/env node
'use strict';
// =============================================================================
// Change classification (docs/DEVELOPMENT_WORKFLOW.md).
//
// The level is COMPUTED from the diff, never declared. A level you type is a
// level you can get wrong when tired — and that is exactly what happened: the
// multi-currency work was Level 4 and was worked as Level 2, which is how a
// 100x invoice amount and a dead KYC gate reached main.
//
// Output: the level, why, and which gates that level requires. qa-run.js reads
// this to force lanes rather than selecting them from the diff alone.
//
// Usage:  node scripts/classify-change.js [--range <git-range>] [--json]
// =============================================================================
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const rangeIdx = args.indexOf('--range');
const RANGE = rangeIdx !== -1 ? args[rangeIdx + 1] : null;

function changedFiles() {
    if (RANGE) {
        return execSync(`git diff --name-only ${RANGE}`, { encoding: 'utf8' })
            .split('\n').map((f) => f.trim()).filter(Boolean);
    }
    // Uncommitted + staged, else the last commit.
    let out = execSync('git diff --name-only HEAD', { encoding: 'utf8' }).trim();
    if (!out) out = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' }).trim();
    return out.split('\n').map((f) => f.trim()).filter(Boolean);
}

// Ordered most-severe first: a change is classified by its HIGHEST match, because
// a commit that touches both a stylesheet and the posting kernel is a kernel
// change that happens to include a stylesheet.

// True when a diff on this file touches money, tax, or currency handling rather
// than surrounding markup. Deliberately generous: a false L4 costs QA time, a
// false L2 costs a wrong number in someone's ledger.
const MONEY_RE = /(currency|amount|toMinor|fromMinor|formatMoney|formatBase|seedMoneyInput|liveMoneyInput|unit_price|subtotal|total|tax|ppn|vat|price|withhold|minor)/i;
function diffTouchesMoney(file) {
    try {
        const spec = RANGE ? `${RANGE} -- ${file}` : `HEAD -- ${file}`;
        const diff = execSync(`git diff ${spec}`, { encoding: 'utf8' });
        return diff.split('\n')
            .filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l))
            .some((l) => MONEY_RE.test(l));
    } catch (_) { return true; }   // cannot tell -> assume it does
}

const RULES = [
    { level: 4, label: 'Financial / Payment / Security',
      test: (f) => /^(firestore|storage)\.rules$/.test(f)
        || /^assets\/js\/(money-format|billing-config|checkout|db-service|accounting-engine|accounting|tax-engine|invoices|payment-pending|statements-engine|kyc-gate|onboarding-gate|feature-access|trial-access|workspace-service)\.js$/.test(f)
        || /^functions\/lib\/(format|templates|locale)\.js$/.test(f)
        || /^netlify\/functions\/(fx-rate|commerce|notify-payment-submitted)\.js$/.test(f)
        // Financial PAGES escalate on what the diff touches, not on their name.
        // Removing a label from invoices.html is copy; editing its money handling
        // is not. Classifying every edit to these files as L4 would make L4 the
        // default, and a level that always fires stops carrying information.
        || (/^(checkout|payment-pending|invoices|settings-billing|onboarding|ledger|bill)\.html$/.test(f)
            && diffTouchesMoney(f))
        || /^firestore\.indexes\.json$/.test(f),
      gates: ['check:money-seam', 'check:price-book', 'check:module-parse',
              'rules emulator (if *.rules changed)', 'browser: non-IDR workspace currency',
              'full regression sweep', 'deployed-stamp for rules/indexes'] },

    { level: 3, label: 'Backend / Data',
      test: (f) => /^assets\/js\/(db-service|duplicate-guard|inventory-engine|report-builder|commerce)/.test(f)
        || /^(netlify\/functions|functions)\//.test(f)
        || /^scripts\/.*\.js$/.test(f)
        || /^(netlify\.toml|deploy\/)/.test(f)
        || /^docs\/data-model\//.test(f)
        // Test and gate infrastructure does not reach production, so the
        // financial risk is nil — but breaking it removes the thing that catches
        // everything else, which is a systemic risk, not a cosmetic one. A
        // silently disabled gate is worse than a visible bug.
        || /^tests\//.test(f)
        || /^\.claude\/hooks\//.test(f)
        || /^(playwright\.config|package)\.json?$/.test(f)
        || /^playwright\.config\.js$/.test(f),
      gates: ['check:module-parse', 'workspace-scoping invariant', 'check:structure',
              'browser sweep on affected pages'] },

    { level: 2, label: 'Frontend Behavior',
      test: (f) => /^assets\/js\//.test(f) || /^assets\/css\//.test(f)
        || (/\.html$/.test(f) && !/^docs\//.test(f)),
      gates: ['design-system lint', 'browser: console sweep', 'check:module-parse'] },

    { level: 1, label: 'UI / Copy / Docs',
      test: (f) => true,
      gates: ['design-system lint (changed lines)'] },
];

const files = changedFiles();
let level = 0, label = 'No changes', reasons = [];

for (const rule of RULES) {
    const hits = files.filter(rule.test);
    if (hits.length) { level = rule.level; label = rule.label; reasons = hits.slice(0, 6); break; }
}
if (!files.length) { level = 0; label = 'No changes'; }

const gates = level ? RULES.find((r) => r.level === level).gates : [];

if (JSON_OUT) {
    console.log(JSON.stringify({ level, label, files: files.length, reasons, gates }));
    process.exit(0);
}

console.log(`\nChange level: L${level} — ${label}   (${files.length} file(s))`);
if (reasons.length) {
    console.log('  triggered by:');
    reasons.forEach((f) => console.log('    ' + f));
    if (files.length > reasons.length) console.log(`    …and ${files.length - reasons.length} more`);
}
if (level >= 4) {
    console.log('\n  ⚠ LEVEL 4 — financial, payment, or security surface.');
    console.log('    Correct-looking output is the failure mode here, not an error.');
    console.log('    Verify in a NON-IDR workspace: IDR is both the right answer and');
    console.log('    the fallback, so a currency bug is invisible on an Indonesian account.');
}
console.log('\n  Required gates:');
gates.forEach((g) => console.log('    · ' + g));
console.log('');
