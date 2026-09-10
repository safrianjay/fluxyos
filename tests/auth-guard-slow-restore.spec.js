// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// A signed-in user is never sent to /login because their session was slow to
// restore.
//
// ⚠️ 23 PAGES DECIDED "SIGNED OUT" BY A STOPWATCH. Each armed
// `setTimeout(() => location.replace('/login'), 2000)` and cancelled it when
// onAuthStateChanged reported a user. Firebase restores the session
// asynchronously, so whenever that took longer than the guess — a slow phone,
// restaurant wifi, a busy machine — a signed-in user was bounced to /login. For
// an unverified password account login then shows "We sent a verification link",
// which is exactly the screen a flaky settings-pos spec kept landing on, and why
// it came and went with machine load.
//
// Reproduced deterministically by making those guard timers fire at 0ms: the
// session cannot possibly be restored by then, so the page must WAIT for
// Firebase rather than trust the clock. Verified to fail against the old guard.
// =============================================================================

const PAGES = ['/settings-pos', '/dashboard', '/settings', '/ledger'];

for (const path of PAGES) {
    test(`${path} keeps a signed-in user when their session restores slowly`, async ({ page }) => {
        await page.addInitScript(() => {
            const real = window.setTimeout;
            // Only the guard's own delays, so the rest of the page behaves.
            window.setTimeout = function (fn, ms, ...rest) {
                return real(fn, (ms === 2000 || ms === 2500) ? 0 : ms, ...rest);
            };
        });
        await page.goto(path);
        // Long enough for any redirect to have happened, and for a real restore.
        await page.waitForTimeout(6000);
        expect(new URL(page.url()).pathname, `${path} sent a signed-in user to /login`)
            .not.toMatch(/^\/login/);
        await expect(page.locator('#verify-view'), 'landed on the email verification gate')
            .toHaveCount(0);
    });
}

test('a genuinely signed-out visitor is still sent to /login', async ({ browser }) => {
    // The fix must not turn "wait for Firebase" into "never redirect".
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/settings-pos');
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await context.close();
});
