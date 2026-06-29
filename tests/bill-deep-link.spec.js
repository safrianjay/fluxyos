// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: universal record deep-linking on the Bills page.
 *
 * A bill opened from another page (`/bill?record=<id>`) — e.g. from Fluxy AI
 * results or Accounting Records "View Bill" — must open regardless of the Bills
 * page's current date filter, even when the bill sits in a previous month. The
 * fix snaps the Bills range to the bill's own month before the first load
 * (`prepareLinkedBillRecordRange`), then locates, scrolls to, highlights, and
 * opens the record. The user must never see "not in the currently loaded range".
 *
 * Read-only: it reuses the page's already-authenticated Firebase session to
 * pick a real bill; it never writes to Firestore.
 */

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForBillsReady(page) {
    await page.waitForSelector('#bill-table-body');
    // A period with no bills renders the empty-state container instead of
    // overwriting the tbody placeholder, so accept either signal as "loaded".
    await page.waitForFunction(() => {
        const body = document.querySelector('#bill-table-body');
        const empty = document.querySelector('#bill-empty-state');
        const emptyVisible = !!empty && !empty.classList.contains('hidden');
        const bodyReady = !!body && !/Loading your bills/.test(body.textContent || '');
        return emptyVisible || bodyReady;
    }, null, { timeout: 20_000 });
}

async function pickBills(page) {
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, null, { timeout: 20_000 });
    return page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return { error: 'no-auth' };
        const scopeId = window.FluxyWorkspace?.id || user.uid;
        const db = fsMod.getFirestore(app);
        const q = fsMod.query(
            fsMod.collection(db, `workspaces/${scopeId}/bills`),
            fsMod.orderBy('timestamp', 'desc'),
            fsMod.limit(400)
        );
        const snap = await fsMod.getDocs(q);
        const now = new Date();
        const curKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        let previousMonth = null;
        let currentMonth = null;
        snap.forEach(d => {
            const data = d.data();
            // Bills load by `timestamp`, so bucket on the same field the page filters on.
            const t = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate() : null;
            if (!t) return;
            const key = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
            const vendor = data.vendor_name || data.merchant_name || data.vendor || 'Bill';
            const rec = { id: d.id, key, vendor };
            if (key === curKey) { if (!currentMonth) currentMonth = rec; }
            else if (!previousMonth) { previousMonth = rec; }
        });
        return { curKey, previousMonth, currentMonth, total: snap.size };
    });
}

test('deep-link opens a PREVIOUS-month bill regardless of the date filter', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/bill.html');
    await waitForBillsReady(page);

    const picked = await pickBills(page);
    test.skip(!!picked.error, 'No authenticated Firebase session available');
    test.skip(!picked.previousMonth, `QA account has no bill outside the current month (${picked.curKey}); cannot exercise cross-month deep-link.`);

    const target = picked.previousMonth;
    const defaultLabel = (await page.locator('#bill-date-range-picker [data-drp-label]').textContent() || '').trim();

    await page.goto(`/bill.html?record=${encodeURIComponent(target.id)}`);
    await waitForBillsReady(page);

    // The detail drawer must slide in (translate-x-full removed) and show the bill.
    const drawer = page.locator('#bill-drawer');
    await expect(drawer).not.toHaveClass(/translate-x-full/, { timeout: 10_000 });
    await expect(page.locator('#bill-drawer-content')).toContainText(target.vendor.slice(0, 12));

    // The Bills range must have snapped to the bill's month (label changed away
    // from the default current-month label).
    const snappedLabel = (await page.locator('#bill-date-range-picker [data-drp-label]').textContent() || '').trim();
    expect(snappedLabel).not.toEqual(defaultLabel);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('deep-link still opens a CURRENT-month bill (regression)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/bill.html');
    await waitForBillsReady(page);
    const picked = await pickBills(page);
    test.skip(!!picked.error, 'No authenticated Firebase session available');
    test.skip(!picked.currentMonth, 'QA account has no current-month bill to deep-link.');

    const target = picked.currentMonth;
    await page.goto(`/bill.html?record=${encodeURIComponent(target.id)}`);
    await waitForBillsReady(page);

    await expect(page.locator('#bill-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 10_000 });
    await expect(page.locator('#bill-drawer-content')).toContainText(target.vendor.slice(0, 12));
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('deep-link to a non-existent bill does not crash the page', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/bill.html?record=__does_not_exist__deadbeef');
    await waitForBillsReady(page);

    // Drawer stays closed, page still usable, and no uncaught errors.
    await expect(page.locator('#bill-drawer')).toHaveClass(/translate-x-full/);
    // Page still usable (the tbody may be hidden behind the empty state when the
    // current period has no bills, so assert an always-present control instead).
    await expect(page.locator('#bill-search-input')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
