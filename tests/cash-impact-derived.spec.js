// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Cash impact is derived from the transaction type, never asked.
 *
 * The manual Actual/Pending/No-impact + Cash-in/out tabs were a second
 * vocabulary for a fact the Type field already states, and the two could
 * disagree — type `pending_payable` with impact "Actual" was reachable, giving a
 * record that claimed both "unpaid" and "cash moved" while feeding the Cash
 * Movement card and bank reconciliation.
 *
 * Removing the tabs would have deleted a capability: "Pending" was the ONLY way
 * to reach pending_payable/pending_receivable from the Add drawer (the visible
 * Direction select had no such option and #tx-type is a hidden carrier). So
 * pending moved into Direction, where it is one vocabulary instead of two.
 * The first test below is the guard for that.
 */

async function ledgerReady(page) {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.__fluxyTxContext?.auth?.currentUser, null, { timeout: 30_000 });
}

async function readTx(page, id) {
    return page.evaluate(async (txId) => {
        const ctx = window.__fluxyTxContext;
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const uid = ctx.auth.currentUser.uid;
        const snap = await getDoc(doc(ctx.ds.db, `${ctx.ds._scope(uid)}/transactions/${txId}`));
        return snap.exists() ? snap.data() : null;
    }, id);
}

test('an unpaid expense is still recordable after the tabs were removed', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30_000 });
    await page.evaluate(() => window.showAddTransactionModal({}));

    // Pending is a Direction now, not a cash-impact toggle.
    const direction = page.locator('#tx-direction');
    await expect(direction.locator('option[value="pending_out"]')).toHaveCount(1);
    await expect(direction.locator('option[value="pending_in"]')).toHaveCount(1);

    // And no impact/direction tabs remain to contradict it.
    await expect(page.locator('#tx-cash-impact-control [data-cash-impact]')).toHaveCount(0);
    await expect(page.locator('#tx-cash-impact-control [data-cash-dir]')).toHaveCount(0);

    const vendor = `QA pending ${Date.now()}`;
    await page.locator('#tx-amount').fill('250000');
    await page.locator('#tx-vendor').fill(vendor);
    await direction.selectOption('pending_out');
    await expect(page.locator('#tx-cash-impact-control [data-fci-badge]')).toHaveText('Pending cash');

    await page.locator('#tx-submit-btn').click();
    await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 30_000 });

    const saved = await page.evaluate(async (v) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { default: DataService } = await import('/assets/js/db-service.js');
        const auth = getAuth(getApps()[0]);
        await auth.authStateReady();
        const ds = new DataService(getApps()[0]);
        const rows = await ds.getTransactions(auth.currentUser.uid, 50);
        const r = rows.find((x) => x.vendor_name === v);
        return r ? { type: r.type, cash_status: r.cash_status, cash_effective: r.cash_effective, cash_direction: r.cash_direction, cash_source: r.cash_source } : null;
    }, vendor);

    expect(saved, 'the unpaid expense saved').toBeTruthy();
    expect(saved.type).toBe('pending_payable');
    // The type and the cash fields now agree by construction.
    expect(saved.cash_status).toBe('pending');
    expect(saved.cash_effective).toBe(false);
    expect(saved.cash_source).toBe('auto');
});

test('editing the type re-derives the cash fields', async ({ page }) => {
    await ledgerReady(page);

    const txId = await page.evaluate(async () => {
        const ctx = window.__fluxyTxContext;
        const ref = await ctx.ds.addTransaction(ctx.auth.currentUser.uid, {
            vendor_name: `QA cash edit ${Date.now()}`, amount: 90000, category: 'Operations',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}',
            cash_effective: true, cash_status: 'actual', cash_direction: 'out',
            cash_account_id: null, cash_source: 'auto', cash_match_status: 'unmatched'
        });
        return ref.id;
    });
    expect((await readTx(page, txId)).cash_status).toBe('actual');

    await page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const row = await ctx.ds.getTransactionById(ctx.auth.currentUser.uid, id);
        window.openTxDetailDrawer(row);
    }, txId);
    await page.locator('#tx-detail-edit-btn').click();

    // No tabs in Edit either.
    await expect(page.locator('#tx-edit-cash-control [data-cash-impact]')).toHaveCount(0);
    await expect(page.locator('#tx-edit-cash-control [data-fci-badge]')).toHaveText('Cash out');

    await page.locator('#tx-edit-type').selectOption('pending_payable');
    await expect(page.locator('#tx-edit-cash-control [data-fci-badge]')).toHaveText('Pending cash');

    await page.locator('#tx-edit-reason').fill('QA: became unpaid');
    await page.locator('#tx-edit-save-btn').click();
    await expect(page.locator('#tx-detail-overlay')).toBeHidden({ timeout: 30_000 });

    const after = await readTx(page, txId);
    expect(after.type).toBe('pending_payable');
    expect(after.cash_status, 'cash fields followed the type').toBe('pending');
    expect(after.cash_effective).toBe(false);
});

test('bank-imported cash facts are never overwritten by the derivation', async ({ page }) => {
    await ledgerReady(page);

    // A record whose cash facts came from a statement import: observed, not inferred.
    const txId = await page.evaluate(async () => {
        const ctx = window.__fluxyTxContext;
        const ref = await ctx.ds.addTransaction(ctx.auth.currentUser.uid, {
            vendor_name: `QA imported ${Date.now()}`, amount: 70000, category: 'Operations',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}',
            cash_effective: true, cash_status: 'actual', cash_direction: 'out',
            cash_account_id: null, cash_source: 'bank_statement_import', cash_match_status: 'matched'
        });
        return ref.id;
    });

    const isDerivable = await page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const row = await ctx.ds.getTransactionById(ctx.auth.currentUser.uid, id);
        return window.FluxyCashImpact.isDerivable(row);
    }, txId);
    expect(isDerivable, 'a bank-sourced record must not be re-derived').toBe(false);

    await page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const row = await ctx.ds.getTransactionById(ctx.auth.currentUser.uid, id);
        window.openTxDetailDrawer(row);
    }, txId);
    await page.locator('#tx-detail-edit-btn').click();
    await expect(page.locator('#tx-edit-cash-control')).toContainText('Set from your bank import');

    // Change the type; the imported cash facts must stand.
    await page.locator('#tx-edit-type').selectOption('pending_payable');
    await page.locator('#tx-edit-reason').fill('QA: type change on imported record');
    await page.locator('#tx-edit-save-btn').click();
    await expect(page.locator('#tx-detail-overlay')).toBeHidden({ timeout: 30_000 });

    const after = await readTx(page, txId);
    expect(after.type).toBe('pending_payable');
    expect(after.cash_source).toBe('bank_statement_import');
    expect(after.cash_status, 'reconciliation truth survives a type edit').toBe('actual');
    expect(after.cash_match_status).toBe('matched');
});
