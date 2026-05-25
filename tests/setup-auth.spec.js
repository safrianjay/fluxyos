// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Global auth setup: signs into the local QA test account and stores the
 * resulting Firebase Auth session. Every other spec inherits this via
 * `use.storageState` in playwright.config.js.
 */
test('authenticate as QA user', async ({ page }) => {
    const qaCredsPath = path.join(__dirname, '..', '.qa', 'firebase-test-account.md');
    if (!fs.existsSync(qaCredsPath)) {
        test.skip(true, 'Missing .qa/firebase-test-account.md — see docs/QA_TEST_ACCOUNT.md.');
    }
    const raw = fs.readFileSync(qaCredsPath, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    if (!email || !password) {
        throw new Error('Could not parse Email + Password from .qa/firebase-test-account.md.');
    }

    await page.goto('/login.html');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await Promise.all([
        page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 30_000 }),
        page.locator('form button[type="submit"]').click(),
    ]);

    // Wait until the sidebar is hydrated so subsequent specs find the nav.
    await expect(page.locator('#sidebar')).toBeVisible();

    const stateDir = path.join(__dirname, '.auth');
    fs.mkdirSync(stateDir, { recursive: true });
    // Firebase Auth persists in IndexedDB by default — include it in the saved
    // state so subsequent specs land on app pages without bouncing to /login.
    await page.context().storageState({
        path: path.join(stateDir, 'storageState.json'),
        indexedDB: true,
    });
});
