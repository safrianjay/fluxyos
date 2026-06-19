// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * QA: universal transaction deep-linking on the Ledger.
 *
 * A transaction opened from another page (`/ledger?record=<id>`) must open
 * regardless of the Ledger's current date filter — even when the record sits
 * in a previous month. The fix snaps the Ledger range to the record's month
 * (and widens the visibility filter for voided records), then opens the
 * detail drawer. See ledger.html `prepareLinkedLedgerRecordRange`.
 *
 * Read-only: it reuses the page's already-authenticated Firebase session to
 * pick a real record; it never writes to Firestore.
 */

async function waitForLedgerReady(page) {
    await page.waitForSelector('#ledger-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#ledger-table-body');
        return !!body && !/Fetching ledger data/.test(body.textContent || '');
    }, null, { timeout: 20_000 });
}

// Reuse the ledger page's initialized Firebase app + auth session to read a
// real transaction without writing anything.
async function pickTransactions(page) {
    return page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return { error: 'no-auth' };
        const db = fsMod.getFirestore(app);
        const q = fsMod.query(
            fsMod.collection(db, `users/${user.uid}/transactions`),
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
            const t = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate() : null;
            if (!t) return;
            const key = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
            const vendor = data.vendor_name || data.merchant_name || data.vendor || 'Transaction';
            const rec = { id: d.id, key, vendor };
            if (key === curKey) { if (!currentMonth) currentMonth = rec; }
            else if (!previousMonth) { previousMonth = rec; }
        });
        return { curKey, previousMonth, currentMonth, total: snap.size };
    });
}

test('deep-link opens a PREVIOUS-month transaction regardless of the date filter', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    // Land on the default (current-month) ledger first to read real data.
    await page.goto('/ledger.html');
    await waitForLedgerReady(page);

    const picked = await pickTransactions(page);
    test.skip(!!picked.error, 'No authenticated Firebase session available');
    test.skip(!picked.previousMonth, `QA account has no transaction outside the current month (${picked.curKey}); cannot exercise cross-month deep-link.`);

    const target = picked.previousMonth;
    const defaultLabel = (await page.locator('#ledger-date-range-picker [data-drp-label]').textContent() || '').trim();

    // Deep-link to the previous-month record.
    await page.goto(`/ledger.html?record=${encodeURIComponent(target.id)}`);
    await waitForLedgerReady(page);

    // The detail drawer must open and show the target record.
    const overlay = page.locator('#tx-detail-overlay');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#tx-detail-vendor')).toContainText(target.vendor.slice(0, 12));

    // The Ledger range must have snapped to the record's month (label changed
    // away from the default current-month label).
    const snappedLabel = (await page.locator('#ledger-date-range-picker [data-drp-label]').textContent() || '').trim();
    expect(snappedLabel).not.toEqual(defaultLabel);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('deep-link still opens a CURRENT-month transaction (regression)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/ledger.html');
    await waitForLedgerReady(page);
    const picked = await pickTransactions(page);
    test.skip(!!picked.error, 'No authenticated Firebase session available');
    test.skip(!picked.currentMonth, 'QA account has no current-month transaction to deep-link.');

    const target = picked.currentMonth;
    await page.goto(`/ledger.html?record=${encodeURIComponent(target.id)}`);
    await waitForLedgerReady(page);

    await expect(page.locator('#tx-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#tx-detail-vendor')).toContainText(target.vendor.slice(0, 12));
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('deep-link to a non-existent record does not crash the page', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/ledger.html?record=__does_not_exist__deadbeef');
    await waitForLedgerReady(page);

    // No detail drawer, page still usable, and no uncaught errors.
    await expect(page.locator('#tx-detail-overlay')).toBeHidden();
    await expect(page.locator('#ledger-table-body')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
