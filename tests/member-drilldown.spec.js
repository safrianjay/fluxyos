// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: invited-team-MEMBER data sharing on the KPI drill-down pages.
 *
 * Finance collections are workspace-scoped; a member must read the SAME data as
 * the owner. The failure mode (PROJECT_BACKGROUND §4) is a page reading finance
 * data before the workspace resolves, so `_scope()` falls back to
 * `workspaces/{memberUid}` (empty) and the member sees 0 data.
 *
 * Flow (real user path): the member arrives via the invite link
 * `/login?invite=<email>&ws=<ownerWorkspaceId>`; login.html stores the pending
 * invite and `healFromStoredInvite` (workspace-service.js) accepts it on load,
 * creating the member doc and exempting them from onboarding. After that first
 * join the membership persists, so later plain logins resolve via
 * collectionGroup(members).
 *
 * Prerequisites (manual — see docs/QA_TEST_ACCOUNT.md):
 *   • `.qa/firebase-test-account.md`         (owner, already used by the suite)
 *   • `.qa/firebase-test-member-account.md`  (the member login)
 *   • The owner must have INVITED the member email in Settings → Team & roles.
 * If the member file is missing the whole spec skips; if the member exists but
 * hasn't been invited, it lands on /onboarding and the test fails with a clear
 * "invite it first" message.
 */

function readCreds(fileName) {
    const p = path.join(__dirname, '..', '.qa', fileName);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    return email && password ? { email, password } : null;
}

const memberCreds = readCreds('firebase-test-member-account.md');
const ownerCreds = readCreds('firebase-test-account.md');
const ROUTES = ['/revenue-overview', '/cash-position', '/cash-pressure', '/opex-budget'];

let cachedOwnerWsId = null;

// Sign in and settle on an app page. Returns the final pathname so the caller
// can distinguish dashboard (joined) from onboarding (not a member yet).
async function signInAndSettle(page, creds, { inviteEmail = null, wsId = null } = {}) {
    const url = inviteEmail && wsId
        ? `/login.html?invite=${encodeURIComponent(inviteEmail)}&ws=${encodeURIComponent(wsId)}`
        : '/login.html';
    await page.goto(url);
    if (inviteEmail && wsId) {
        // Invite mode: login.html collapses the form behind a "Continue with
        // email" CTA and pre-locks the email to the invited address.
        await page.locator('#invite-email-cta').click();
        await page.locator('#password').fill(creds.password);
    } else {
        await page.locator('#email').fill(creds.email);
        await page.locator('#password').fill(creds.password);
    }
    await page.locator('form button[type="submit"]').click();

    // Possible destinations: /dashboard (ok), /onboarding (not a member),
    // or the email-verify gate (skip it, then re-settle).
    const verifyGate = page.locator('#verify-view')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => page.locator('#verify-skip-link').click())
        .catch(() => {});
    const landed = page.waitForURL(/\/(dashboard|onboarding)(\.html)?($|[?#])/, { timeout: 40_000 });
    await Promise.race([landed, verifyGate]);
    await page.waitForURL(/\/(dashboard|onboarding)(\.html)?($|[?#])/, { timeout: 40_000 });
    return new URL(page.url()).pathname;
}

async function ownerWorkspaceId(browser) {
    if (cachedOwnerWsId) return cachedOwnerWsId;
    const ctx = await browser.newContext();
    try {
        const page = await ctx.newPage();
        await signInAndSettle(page, ownerCreds);
        // The workspace resolves asynchronously after the dashboard loads — wait
        // for the global before reading it.
        await page.waitForFunction(() => !!(window.FluxyWorkspace && window.FluxyWorkspace.id), null, { timeout: 20_000 });
        cachedOwnerWsId = await page.evaluate(() => window.FluxyWorkspace.id);
        return cachedOwnerWsId;
    } finally {
        await ctx.close();
    }
}

// Fresh context — do NOT inherit the owner storageState.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('member data sharing (KPI drill-downs)', () => {
    test.beforeEach(async ({ page, browser }) => {
        test.skip(!memberCreds, 'Missing .qa/firebase-test-member-account.md — see docs/QA_TEST_ACCOUNT.md.');
        test.skip(!ownerCreds, 'Missing .qa/firebase-test-account.md (owner) — needed to resolve the workspace id.');

        const wsId = await ownerWorkspaceId(browser);
        expect(wsId, 'owner workspace id resolved').toBeTruthy();

        const landing = await signInAndSettle(page, memberCreds, { inviteEmail: memberCreds.email, wsId });
        expect(
            /onboarding/.test(landing),
            `member landed on ${landing} — it is not a member yet. Invite ${memberCreds.email} in Settings → Team & roles, then re-run.`
        ).toBeFalsy();

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
            // Linchpin: a resolved workspace id different from the member's own uid
            // proves the read hit the shared owner workspace, not the
            // workspaces/{memberUid} fallback that yields 0 data.
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
