// @ts-check
const { test, expect } = require('@playwright/test');

// Cash application (Phase 2, slice 1b): the "Receive Payment" modal applies one
// customer's payment across several open invoices in a single action, driving the
// receiveCustomerPayment DAL (already unit-covered in invoice-payment.spec.js).
// This is the UI→DAL path: seed two invoices for a unique customer, open the
// modal, and confirm — both must settle. Real Firestore + deployed rules.

test('Receive Payment modal settles a customer\'s invoices in one action', async ({ page }) => {
    await page.goto('/invoices.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const customer = `QA Receive ${Date.now()}`;

    // Seed two open IDR invoices for a unique customer (500k + 300k).
    const ids = await page.evaluate(async (cust) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => { const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } }); });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const due = new Date(Date.now() + 30 * 86400000).toISOString();
        const mk = async (price) => {
            const inv = await ds.createInvoiceDraft(uid, { customer_name: cust, currency: 'IDR', due_date: due, items: [{ description: 'Consulting', quantity: 1, unit_price: price }] });
            await ds.finalizeInvoice(uid, inv.id, {});
            return inv.id;
        };
        return { a: await mk(500000), b: await mk(300000) };
    }, customer);

    // Reload so the page's list picks up the seeded invoices, then wait for the list.
    await page.reload();
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });
    await expect(page.locator('#invoice-table-card')).toBeVisible({ timeout: 30000 });

    // Open the modal and select our customer.
    await page.locator('#receive-payment-btn').click();
    await expect(page.locator('#receive-pay-modal')).toBeVisible();
    await page.selectOption('#receive-pay-customer', customer);

    // Both invoices listed; total auto-sums to 800.000.
    await expect(page.locator('#receive-pay-invoices [data-rpay-row]')).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator('#receive-pay-total')).toHaveText(/800\.000/);
    await expect(page.locator('#receive-pay-count')).toHaveText(/2 invoice/);

    // Confirm → both settle.
    await page.locator('#receive-pay-confirm').click();
    await expect(page.locator('#receive-pay-modal')).toBeHidden({ timeout: 20000 });

    const statuses = await page.evaluate(async (pair) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const a = await ds.getInvoice(uid, pair.a);
        const b = await ds.getInvoice(uid, pair.b);
        return { a: a.status, b: b.status, aOut: a.outstanding_amount, bOut: b.outstanding_amount };
    }, ids);

    expect(statuses.a).toBe('paid');
    expect(statuses.b).toBe('paid');
    expect(statuses.aOut).toBe(0);
    expect(statuses.bOut).toBe(0);
});
