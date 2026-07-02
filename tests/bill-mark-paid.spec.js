// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Bills "Mark as Paid" → posts a linked expense to the Ledger.
 *
 * Drives the real UI (bill drawer → Record-Payment modal → confirm) against the
 * live Firebase project with the deployed rules, then asserts the resulting
 * Firestore state: the bill is paid + linked, and a matching expense transaction
 * was created carrying `linked_bill_id`. Creates one throwaway bill + one
 * transaction on the QA account per run (self-contained test data).
 */

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForBillsReady(page) {
    await page.waitForSelector('#bill-table-body');
    await page.waitForFunction(() => {
        const body = document.querySelector('#bill-table-body');
        const empty = document.querySelector('#bill-empty-state');
        const emptyVisible = !!empty && !empty.classList.contains('hidden');
        const bodyReady = !!body && !/Loading your bills/.test(body.textContent || '');
        return emptyVisible || bodyReady;
    }, null, { timeout: 20_000 });
}

// Create a throwaway unpaid bill via the page's authenticated Firebase session.
async function createBill(page, tag) {
    return page.evaluate(async (vendorTag) => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const dsMod = await import('/assets/js/db-service.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return { error: 'no-auth' };
        const ds = new dsMod.default(app);
        ds.setActor(user.uid);
        const ref = await ds.addBill(user.uid, {
            amount: 137000,
            vendor_name: vendorTag,
            category: 'Infrastructure',
            type: 'pending_payable',
            status: 'Upcoming',
            icon: '💸',
            payment_status: 'unpaid'
        });
        return { id: ref.id, uid: user.uid };
    }, tag);
}

async function readPaidState(page, billId) {
    return page.evaluate(async (id) => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const dsMod = await import('/assets/js/db-service.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return { error: 'no-auth' };
        const ds = new dsMod.default(app);
        ds.setActor(user.uid);
        const bill = await ds.getBillById(user.uid, id);
        let tx = null;
        if (bill?.linked_transaction_id) {
            tx = await ds.getTransactionById(user.uid, bill.linked_transaction_id);
        }
        return {
            payment_status: bill?.payment_status,
            budget_impact_status: bill?.budget_impact_status,
            linked_transaction_id: bill?.linked_transaction_id || null,
            tx: tx ? { type: tx.type, amount: tx.amount, linked_bill_id: tx.linked_bill_id, category: tx.category } : null
        };
    }, billId);
}

test('Mark as Paid posts a linked expense to the Ledger and marks the bill paid', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/bill.html');
    await waitForBillsReady(page);

    const created = await createBill(page, `QA MarkPaid ${Date.now()}`);
    test.skip(!!created.error, 'No authenticated Firebase session available');
    expect(created.id, 'bill should be created').toBeTruthy();

    // Open the new bill's drawer via the universal record deep-link.
    await page.goto(`/bill.html?record=${encodeURIComponent(created.id)}`);
    await waitForBillsReady(page);
    await expect(page.locator('#bill-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 15_000 });

    // Neutralize the orthogonal write-access guard (trial paywall is UX-only and
    // unrelated to this feature), then open the Record-Payment modal.
    await page.evaluate(() => { if (window.FluxyAccessGuard) window.FluxyAccessGuard.requireWriteAccess = () => true; });
    await page.click('#bill-mark-paid-btn');
    await expect(page.locator('#bill-pay-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // Confirm with defaults (today, actual cash-out).
    await page.click('#bill-pay-confirm');

    // On success the modal closes; assert the persisted state.
    await expect(page.locator('#bill-pay-modal')).toHaveClass(/hidden/, { timeout: 15_000 });

    const state = await readPaidState(page, created.id);
    expect(state.payment_status, 'bill marked paid').toBe('paid');
    expect(state.budget_impact_status, 'bill converted to actual').toBe('converted_to_actual');
    expect(state.linked_transaction_id, 'bill linked to a transaction').toBeTruthy();
    expect(state.tx, 'linked ledger transaction exists').toBeTruthy();
    expect(state.tx.type, 'linked transaction is an expense').toBe('expense');
    expect(state.tx.amount, 'amount carried from the bill').toBe(137000);
    expect(state.tx.linked_bill_id, 'transaction back-links the bill').toBe(created.id);
    expect(state.tx.category, 'category inherited from the bill').toBe('Infrastructure');

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
