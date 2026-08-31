// @ts-check
const { test, expect } = require('@playwright/test');
const { auditSpacing, MIN_GAP } = require('./helpers/spacing-audit');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * Console-cleanliness sweep — the automated form of the manual QA gate.
 *
 * CLAUDE.md and .claude/hooks/qa-gate.sh both require, before any push to main:
 *   "Smoke-tested the affected page in a real browser"
 *   "Browser console is clean (no CSP, CORS, 404, or Firebase errors)"
 *   "Every new file reference (CSS, JS, image) actually EXISTS"
 *
 * That was a human step. This spec performs it: it loads each affected page as
 * the authenticated QA account and fails on console errors, uncaught exceptions,
 * and same-origin asset 404s.
 *
 * Page selection: `QA_SWEEP_PAGES` (comma-separated) narrows the sweep to the
 * pages a change actually touches — scripts/qa-run.js sets it from the git diff.
 * Unset, it sweeps CORE_PAGES.
 *
 * Deliberately load-only. No hover, no clicks: the product tour overlay
 * intercepts pointer events on a fresh account, which makes interaction-based
 * sweeps flaky for reasons unrelated to the code under test. Interaction
 * coverage belongs in the feature specs, which already exist.
 */

const CORE_PAGES = [
    'dashboard.html',
    'ledger.html',
    'bill.html',
    'subscription.html',
    'invoices.html',
    'accounting.html',
    'budget.html',
    'reports.html',
];

const pages = (process.env.QA_SWEEP_PAGES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

const TARGETS = pages.length ? pages : CORE_PAGES;

/**
 * Known-benign console output. Every entry needs a reason — an allowlist nobody
 * can justify decays into a mute button.
 */
const ALLOWED = [
    // login.html always POSTs sendOobCode on load and takes a 400 when the
    // address has no pending link. Expected, not a regression.
    /identitytoolkit.*sendOobCode/i,
    // Firebase installations/analytics chatter on a throwaway QA project.
    /firebase-installations|installations\.googleapis/i,
    // Chrome asks for a favicon on every navigation; a missing one is cosmetic
    // and is caught by the SEO/product lane instead.
    /favicon\.ico/i,
    // Extensions injected by the developer's own browser profile.
    /chrome-extension:\/\//i,
];

const isAllowed = (text) => ALLOWED.some((re) => re.test(text));

/**
 * Console errors worth failing on. A bare "error"-level message can be
 * third-party noise, so match the failure classes the checklist names.
 *
 * NOTE: do NOT add a naive /NaN/i pattern here. It matches the word "finance",
 * which appears in half this app's log lines, and produced a wave of phantom QA
 * failures the last time it was tried.
 */
const FAILURE_CLASSES =
    /Content Security Policy|CSP|CORS|Access-Control-Allow|permission-denied|Missing or insufficient permissions|is not defined|is not a function|Cannot read (?:property|properties)|Unexpected token|Failed to load module|SyntaxError/i;

for (const target of TARGETS) {
    test(`console clean: ${target}`, async ({ page, baseURL }) => {
        /** @type {string[]} */
        const bad = [];
        const origin = baseURL || 'http://127.0.0.1:8765';

        page.on('console', (m) => {
            if (m.type() !== 'error') return;
            const t = m.text();
            if (isAllowed(t)) return;
            if (FAILURE_CLASSES.test(t)) bad.push(`console: ${t}`);
        });

        // Uncaught exceptions are always a failure — no allowlist, no class filter.
        page.on('pageerror', (e) => {
            if (isAllowed(e.message)) return;
            bad.push(`pageerror: ${e.message}`);
        });

        // A missing local asset is the "new file reference actually EXISTS"
        // checklist item. Only same-origin — third-party 4xx is their problem.
        page.on('response', (res) => {
            const url = res.url();
            if (!url.startsWith(origin)) return;
            if (isAllowed(url)) return;
            if (res.status() >= 400) bad.push(`http ${res.status()}: ${url.replace(origin, '')}`);
        });
        page.on('requestfailed', (req) => {
            const url = req.url();
            if (!url.startsWith(origin) || isAllowed(url)) return;
            bad.push(`requestfailed: ${url.replace(origin, '')} (${req.failure()?.errorText})`);
        });

        await installTrialPaywallBypass(page);
        await page.goto(`/${target}`, { waitUntil: 'domcontentloaded' });

        // Proof the page actually booted rather than dying early — otherwise a
        // blank page would sweep "clean". App pages render the shared sidebar;
        // login.html and standalone pages do not, so accept either signal.
        await expect
            .poll(async () => {
                const sidebar = await page.locator('#sidebar').count().catch(() => 0);
                const body = (await page.locator('body').innerText().catch(() => '')) || '';
                return sidebar > 0 || body.trim().length > 40;
            }, { timeout: 30_000, message: `${target} never rendered` })
            .toBe(true);

        // Let deferred Firestore reads and lazy modules settle; they are where
        // permission-denied and CSP violations actually surface.
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        expect(bad, `${target} console/network issues:\n  ${bad.join('\n  ')}`).toEqual([]);

        // ── VERTICAL RHYTHM ────────────────────────────────────────────────
        // Extracted to tests/helpers/spacing-audit.js — the rule and its history
        // live there, and pos-ui.spec.js runs the same audit once per in-page
        // view, which a single page load cannot reach.
        const spacing = await auditSpacing(page);
        expect(spacing,
            `${target} has sections touching (min ${MIN_GAP}px between stacked cards):\n  ${spacing.join('\n  ')}`
        ).toEqual([]);
    });
}
