// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end test for period close → reopen. Closing rolls net income into
// Retained Earnings and locks the period; reopening reverses that and unlocks it.
// Uses a dedicated past period (2026-02) with one back-dated income entry, so it
// never disturbs the current month. Runs as the QA owner account against real
// Firestore (rules deployed).

test('closing then reopening a period rolls net income in and back out', async ({ page }) => {
    await page.goto('/ledger.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => { const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } }); });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const PK = '2026-02';

        // Cleanup: if a prior failed run left PK closed, reopen it first.
        const p0 = await ds.getPeriod(uid, PK);
        if (p0.status === 'closed' || p0.status === 'locked') { try { await ds.reopenPeriod(uid, PK); } catch (_) {} }

        const bal = async (code) => {
            const tb = await ds.getTrialBalance(uid, { periodKey: PK });
            const row = tb.rows.find((x) => x.account_code === code);
            return row ? row.balance : 0;
        };
        const snap = async () => ({ rev: await bal('4000'), re: await bal('3000') });

        const base = await snap();
        // Back-dated income into PK.
        await ds.addTransaction(uid, {
            amount: 555000, vendor_name: 'Reopen Test Client', category: 'Revenue', type: 'income',
            status: 'Completed', icon: '\u{1F4B0}', timestamp: new Date('2026-02-15T03:00:00Z')
        });
        const afterPost = await snap();
        const closed = await ds.closePeriod(uid, PK);
        const afterClose = await snap();
        const reopened = await ds.reopenPeriod(uid, PK);
        const afterReopen = await snap();

        return { base, afterPost, afterClose, afterReopen, closed, reopened };
    });

    // This run's income is recognized as revenue (delta isolates it from any
    // residue a prior run left in this shared past period).
    expect(r.afterPost.rev - r.base.rev).toBe(555000);
    // Close zeroes the period's revenue and rolls net income (all revenue, no
    // expense here) into Retained Earnings. Asserted against the post-state so the
    // absolute close behavior is robust to residue.
    expect(r.afterClose.rev).toBe(0);
    expect(r.afterClose.re - r.afterPost.re).toBe(r.afterPost.rev);
    expect(r.closed.net).toBe(r.afterPost.rev);
    // Reopen reverses the closing entry — a clean round-trip back to the post-state.
    expect(r.afterReopen.rev).toBe(r.afterPost.rev);
    expect(r.afterReopen.re).toBe(r.afterPost.re);
    expect(r.reopened.reversed_close_journals).toBeGreaterThanOrEqual(1);
});
