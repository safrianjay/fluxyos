// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * The posting control layer, verified where it actually has to work: on rows read
 * back from Firestore.
 *
 * Regression guard for a real defect. `fluxy-account-picker.js` has always
 * filtered structural accounts out of the entry drawer, but the flag it tested
 * (`mappable`) was never written by seedChartOfAccounts. Firestore rows therefore
 * came back with the field ABSENT, every consumer reads an absent flag as
 * permitted, and the guard was inert on every seeded workspace — i.e. every real
 * one. It only ever worked on the static-seed fallback path, which is why nothing
 * caught it: the pure-engine specs assert the SEED, and the seed was fine.
 *
 * So a seed-only assertion cannot prove this fix. This spec deliberately goes
 * through getChartOfAccounts against real Firestore. If _withAccountPolicy is
 * removed, mis-ordered, or made doc-wins, this is the test that fails — the rest
 * of the suite stays green.
 */

const STRUCTURAL = ['1000', '1100', '2000', '3000', '3900', '1130', '2100'];
const POSTABLE = ['6100', '6400'];

test('structural accounts come back from Firestore closed to both human surfaces', async ({ page }) => {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const out = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        // currentUser is null until the SDK restores the session, and the page's
        // own readiness signals fire on their own schedule — so wait for auth
        // rather than sampling it, or this races on a cold page load.
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((resolve) => {
            const stop = onAuthStateChanged(auth, (u) => { if (u) { stop(); resolve(u); } });
            setTimeout(() => resolve(null), 20000);
        });
        const uid = user?.uid;
        if (!uid) return { error: 'not signed in' };
        // The page has already resolved the workspace (window.FluxyWorkspace) by
        // the time its content is visible, so _scope() targets the shared chart.
        const rows = await ds.getChartOfAccounts(uid);
        const byCode = {};
        rows.forEach((a) => {
            byCode[a.code] = {
                mappable: a.mappable,
                allow_manual_journal: a.allow_manual_journal,
                allow_direct_transaction: a.allow_direct_transaction
            };
        });
        return { total: rows.length, byCode };
    });

    expect(out.error).toBeUndefined();
    // A workspace that has never opened Accounting Center has no chart at all;
    // that is a different (valid) state, and the picker's seed fallback covers it.
    test.skip(!out.total, 'workspace chart not seeded');

    for (const code of STRUCTURAL) {
        const acct = out.byCode[code];
        if (!acct) continue; // tax accounts may predate the tax-center seed
        expect(acct.allow_direct_transaction, `${code} must not be selectable on a transaction`).toBe(false);
        expect(acct.allow_manual_journal, `${code} must not be nameable in a manual journal`).toBe(false);
    }

    // Fail-open must survive the merge: ordinary expense accounts stay postable,
    // otherwise the control layer would take the entry drawer down with it.
    for (const code of POSTABLE) {
        const acct = out.byCode[code];
        if (!acct) continue;
        expect(acct.allow_direct_transaction, `${code} must stay postable`).not.toBe(false);
        expect(acct.allow_manual_journal, `${code} must stay postable`).not.toBe(false);
    }
});

test('the entry-drawer picker offers no structural account', async ({ page }) => {
    // /ledger.html is where the entry drawer and its picker actually load
    // (dashboard.html does not pull fluxy-account-picker.js).
    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });

    // Drive the real filter over the real chart rather than the rendered menu, so
    // the assertion holds for both money-in and money-out without opening the UI
    // twice — visibleAccounts() is not reachable from outside the IIFE, but
    // isSelectable's inputs are exactly these rows.
    const offered = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js?v=' + Date.now())).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        // currentUser is null until the SDK restores the session, and the page's
        // own readiness signals fire on their own schedule — so wait for auth
        // rather than sampling it, or this races on a cold page load.
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((resolve) => {
            const stop = onAuthStateChanged(auth, (u) => { if (u) { stop(); resolve(u); } });
            setTimeout(() => resolve(null), 20000);
        });
        const uid = user?.uid;
        if (!uid) return { error: 'not signed in' };
        const chart = await ds.getChartForPicker(uid);
        return {
            selectable: chart
                .filter((a) => a.is_active !== false && a.allow_direct_transaction !== false)
                .map((a) => String(a.code))
        };
    });

    expect(offered.error).toBeUndefined();
    for (const code of ['1000', '1100', '2000', '3000', '3900']) {
        expect(offered.selectable, `${code} must not be offered in the entry drawer`).not.toContain(code);
    }
    // The picker must still be useful.
    expect(offered.selectable.length).toBeGreaterThan(5);
});
