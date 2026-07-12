// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: invited-team-MEMBER data sharing on the KPI drill-down pages.
 *
 * Finance collections are workspace-scoped; a member must read the SAME data as
 * the workspace owner. The failure mode (documented in PROJECT_BACKGROUND §4) is
 * a page reading finance data before the workspace resolves, so `_scope()` falls
 * back to `workspaces/{memberUid}` (which doesn't exist) and the member sees 0
 * data / permission-denied.
 *
 * This spec logs in as a SEPARATE member account (not the owner storageState)
 * and asserts each drill-down: workspace mode on, a resolved workspace id that
 * is NOT the member's own uid (i.e. the shared owner workspace, not the
 * fallback), content renders, and no uncaught error.
 *
 * Provisioning (manual, one-time — see docs/QA_TEST_ACCOUNT.md):
 *   1. Create a second Firebase account and invite it into the owner QA
 *      workspace as a member; accept the invite.
 *   2. Drop its credentials in `.qa/firebase-test-member-account.md` (same
 *      `Email:` / `Password:` backtick format as the owner file; git-ignored).
 * Until that file exists this whole spec skips.
 */

function readMemberCreds() {
    const p = path.join(__dirname, '..', '.qa', 'firebase-test-member-account.md');
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    return email && password ? { email, password } : null;
}

const creds = readMemberCreds();
const ROUTES = ['/revenue-overview', '/cash-position', '/cash-pressure', '/opex-budget'];

// Start from a fresh context — do NOT inherit the owner storageState.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('member data sharing (KPI drill-downs)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!creds, 'Missing .qa/firebase-test-member-account.md — see docs/QA_TEST_ACCOUNT.md.');

        // Log in as the member (mirrors tests/setup-auth.spec.js).
        await page.goto('/login.html');
        await page.locator('#email').fill(creds.email);
        await page.locator('#password').fill(creds.password);
        await page.locator('form button[type="submit"]').click();
        const dashboard = page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 30_000 });
        const verifyGate = page.locator('#verify-view')
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => page.locator('#verify-skip-link').click());
        await Promise.race([dashboard, verifyGate]);
        await page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 30_000 });
        await page.evaluate(() => localStorage.setItem('fluxyos-lang', 'en'));
        await installTrialPaywallBypass(page);
    });

    test('member reads the shared workspace (not their own scope) on every drill-down', async ({ page }) => {
        for (const route of ROUTES) {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(route);
            await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });

            const info = await page.evaluate(async () => {
                const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
                const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                const app = appMod.getApps()[0];
                const user = app && authMod.getAuth(app).currentUser;
                return {
                    mode: window.FLUXY_WORKSPACE_MODE === true,
                    wsId: (window.FluxyWorkspace && window.FluxyWorkspace.id) || null,
                    uid: user ? user.uid : null,
                };
            });

            expect(info.mode, `${route}: workspace mode on`).toBeTruthy();
            expect(info.wsId, `${route}: workspace resolved`).toBeTruthy();
            // The linchpin: a resolved workspace id different from the member's
            // own uid proves the read hit the shared owner workspace, not the
            // `workspaces/{memberUid}` fallback that yields 0 data.
            expect(info.wsId, `${route}: member must read the shared workspace, not their own uid`).not.toBe(info.uid);
            expect(errors, `${route}: no uncaught error (a mis-scoped read throws permission-denied)`).toEqual([]);
        }
    });

    test('member sees the workspace revenue on Revenue Overview', async ({ page }) => {
        await page.goto('/revenue-overview?period=all_time');
        await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
        // The workspace has revenue (owner data), so an all-time member read must
        // surface a real figure — not the empty/zero a mis-scoped member would get.
        await expect(page.locator('#revenue-headline')).not.toHaveText('Rp0');
        await expect(page.locator('#revenue-table-body tr').first()).toBeVisible();
    });
});
