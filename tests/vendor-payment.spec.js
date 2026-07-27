// @ts-check
const { test, expect } = require('@playwright/test');

// End-to-end for the Vendor Payment flow: create a bill, open Pay Bills, select
// the vendor, make a PARTIAL payment, and verify the bill's outstanding_amount /
// amount_paid / payment_status update and a linked BILL-PAY expense posts. Real
// Firestore + deployed rules (like the tax-bill specs). Uses a unique vendor per
// run so the picker selection is deterministic.

test('Vendor Payment: partial payment updates outstanding and posts a linked expense', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    const vendor = `QA VPay ${Date.now()}`;

    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.loadBills === 'function', null, { timeout: 30000 });

    // Seed one unpaid bill for the unique vendor.
    const billId = await page.evaluate(async (vendorName) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        for (let i = 0; i < 40 && !auth.currentUser; i++) await new Promise((r) => setTimeout(r, 200));
        const uid = auth.currentUser.uid;
        const ds = new DataService(app);
        ds.setActor(uid);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        const ref = await ds.addBill(wsId, {
            amount: 1000000, vendor_name: vendorName, category: 'Operations',
            type: 'expense', status: 'Upcoming', icon: '💸', payment_status: 'unpaid',
            due_date: new Date(Date.now() + 7 * 86400000)
        });
        return ref.id;
    }, vendor);
    expect(billId).toBeTruthy();

    // Reload so the new bill is in allBills, then open Pay Bills.
    await page.evaluate(() => window.loadBills());
    await page.waitForTimeout(1500);
    await page.click('#pay-bills-btn');
    await expect(page.locator('#vendor-pay-modal')).not.toHaveClass(/hidden/, { timeout: 10000 });

    // Select our vendor (option value is the normalized vendor key); its bill row
    // must render with the full outstanding.
    const optionValue = await page.$eval('#vendor-pay-vendor', (sel, v) => {
        const opt = Array.from(sel.options).find((o) => o.textContent.includes(v));
        return opt ? opt.value : '';
    }, vendor);
    expect(optionValue).toBeTruthy();
    await page.selectOption('#vendor-pay-vendor', optionValue);
    const row = page.locator(`#vendor-pay-bills [data-vpay-row][data-bill-id="${billId}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toHaveAttribute('data-outstanding', '1000000');

    // Enter a partial amount (400.000) → the total reflects it.
    const amountInput = row.locator('[data-vpay-amount]');
    await amountInput.fill('400000');
    await amountInput.dispatchEvent('input');
    await expect(page.locator('#vendor-pay-total')).toHaveText(/400\.000/, { timeout: 5000 });

    // Pay → success toast, modal closes.
    await page.click('#vendor-pay-confirm');
    await expect(page.locator('#vendor-pay-modal')).toHaveClass(/hidden/, { timeout: 20000 });

    // Verify the bill + the posted BILL-PAY journal via the DAL.
    const r = await page.evaluate(async ({ vendorName, bId }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        const bill = await ds.getBillById(wsId, bId);
        const js = await ds.listJournals(wsId, { max: 50 });
        const j = js.find((x) => x.source && x.source.collection === 'transactions' && x.description && x.posting_rule_id === 'BILL-PAY'
            && x.lines.some((l) => l.account_code === '2000' && l.debit === 400000)) || null;
        return {
            payment_status: bill.payment_status,
            outstanding_amount: bill.outstanding_amount,
            amount_paid: bill.amount_paid,
            billPayFound: !!j,
            balanced: j ? j.is_balanced && j.total_debit === j.total_credit : false
        };
    }, { vendorName: vendor, bId: billId });

    expect(r.payment_status).toBe('partial');
    expect(r.outstanding_amount).toBe(600000);
    expect(r.amount_paid).toBe(400000);
    expect(r.billPayFound, 'a BILL-PAY journal for 400.000 posted (Dr A/P 2000)').toBe(true);
    expect(r.balanced).toBe(true);

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
