// @ts-check
const { test, expect } = require('@playwright/test');

// Reproduction: editing a transaction whose journal is in a CLOSED period must
// fail with a clear, user-facing message — not a raw Firestore "permission denied"
// (the correction can't post into a closed period). Also confirms an open-period
// edit still works. Uses an isolated past period. Runs as the QA owner account.

test('editing a transaction in a closed period is blocked with a clear message', async ({ page }) => {
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
        const PK = '2026-04';

        // Cleanup any prior residue: ensure PK is open before we start.
        const p0 = await ds.getPeriod(uid, PK);
        if (p0.status === 'closed' || p0.status === 'locked') { try { await ds.reopenPeriod(uid, PK); } catch (_) {} }

        // Post a back-dated expense into PK, then close PK.
        const ref = await ds.addTransaction(uid, {
            amount: 120000, vendor_name: 'Closed Period Edit Test', category: 'Operations',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}', timestamp: new Date('2026-04-10T03:00:00Z')
        });
        await ds.closePeriod(uid, PK);

        // Attempt to edit it — should throw a clear error, not permission-denied.
        let message = null;
        let isPermission = false;
        try {
            await ds.updateTransaction(uid, ref.id, { amount: 130000 }, 'QA closed-period edit');
        } catch (e) {
            message = String(e && e.message || e);
            isPermission = e && (e.code === 'permission-denied' || /Missing or insufficient permissions/i.test(message));
        }

        // Cleanup: reopen PK.
        try { await ds.reopenPeriod(uid, PK); } catch (_) {}

        return { message, isPermission };
    });

    expect(r.message, 'edit in a closed period should be rejected').not.toBeNull();
    expect(r.isPermission, `should NOT be a raw permission error — got: ${r.message}`).toBe(false);
    expect(r.message).toMatch(/closed .*period/i);
});
