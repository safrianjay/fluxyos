// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Global auth setup: signs into the local QA test account and stores the
 * resulting Firebase Auth session. Every other spec inherits this via
 * `use.storageState` in playwright.config.js.
 */
test('authenticate as QA user', async ({ page }, testInfo) => {
    // Which QA account this run authenticates as, derived from the PROJECT name
    // rather than an env var so `npx playwright test` needs no special
    // invocation: `auth-setup` → the original Indonesian account (unchanged for
    // every existing spec), `auth-setup-ph` → the Philippine workspace.
    //
    // A second account exists because the main suite runs on an IDR workspace,
    // so a bug that only appears outside Indonesia passes every browser check —
    // which is how a peso workspace came to be quoted in rupiah with QA green.
    const account = (process.env.QA_ACCOUNT || testInfo.project.name.replace(/^auth-setup-?/, '')).toLowerCase();
    const credsFile = account ? `firebase-test-account-${account}.md` : 'firebase-test-account.md';
    const stateFile = account ? `storageState.${account}.json` : 'storageState.json';

    const qaCredsPath = path.join(__dirname, '..', '.qa', credsFile);
    if (!fs.existsSync(qaCredsPath)) {
        // Skip rather than fail: a clone without the fixture should still run
        // green. Seed one with `node scripts/seed-qa-account.js --country PH`.
        test.skip(true, `Missing .qa/${credsFile} — see docs/QA_TEST_ACCOUNT.md.`);
    }
    const raw = fs.readFileSync(qaCredsPath, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    if (!email || !password) {
        throw new Error(`Could not parse Email + Password from .qa/${credsFile}.`);
    }

    await page.goto('/login.html');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('form button[type="submit"]').click();

    // A password account whose email is unverified is routed to the email
    // verification view instead of /dashboard (login.html `routeUser`). The QA
    // account is unverified, so click "Continue without verifying" to proceed.
    // Race the two possible outcomes so a verified account still works.
    const dashboard = page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 30_000 });
    const verifyGate = page.locator('#verify-view')
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => page.locator('#verify-skip-link').click());
    await Promise.race([dashboard, verifyGate]);
    await page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 30_000 });

    // Wait until the sidebar is hydrated so subsequent specs find the nav.
    await expect(page.locator('#sidebar')).toBeVisible();

    // The dashboard defaults to Bahasa Indonesia (dashboard-i18n.js). The
    // EN-asserting suite pins English here so every spec inherits it through
    // storageState; ID specs opt back in via addInitScript (tax-center-i18n).
    await page.evaluate(() => localStorage.setItem('fluxyos-lang', 'en'));

    const stateDir = path.join(__dirname, '.auth');
    fs.mkdirSync(stateDir, { recursive: true });
    // Firebase Auth persists in IndexedDB by default — include it in the saved
    // state so subsequent specs land on app pages without bouncing to /login.
    await page.context().storageState({
        path: path.join(stateDir, stateFile),
        indexedDB: true,
    });
});
