// @ts-check
const { test, expect } = require('@playwright/test');

// "Manage" on the Subscriptions table was a <button> with no handler and no
// detail view behind it. It now opens the same drawer shape Bill, Revenue and
// Transaction use, and can actually stop the subscription renewing.

async function seedSubscription(page) {
    return page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app); ds.actorUid = uid;
        const name = `QA Sub ${Date.now()}`;
        const ref = await ds.addSubscription(uid, {
            amount: 750000, vendor_name: name, category: 'SaaS', type: 'expense',
            status: 'Completed', icon: '\u{1F4B8}', billing_cycle: 'monthly',
            renewal_date: Timestamp.fromDate(new Date('2026-09-01T03:00:00Z'))
        });
        return { id: ref.id, name };
    });
}

test('Manage opens a subscription detail drawer', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/subscription.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });
    await seedSubscription(page);
    await page.reload();
    await page.waitForTimeout(3000);

    await page.locator('#sub-table-body button:has-text("Manage")').first().click();
    const drawer = page.locator('#sub-drawer');
    await expect(drawer).not.toHaveClass(/translate-x-full/, { timeout: 5000 });
    // Same Summary card as the other detail drawers: chip, amount, fields, readiness.
    await expect(drawer.locator('.fluxy-drawer-summary')).toBeVisible();
    await expect(drawer.locator('.fluxy-drawer-summary-amount')).toBeVisible();
    await expect(drawer.locator('.fluxy-drawer-readiness')).toBeVisible();
    await expect(page.locator('#sub-cancel-btn')).toBeVisible();

    // The row itself opens it too, not only the button.
    await page.locator('#sub-drawer-close-footer').click();
    await expect(drawer).toHaveClass(/translate-x-full/);
    await page.locator('#sub-table-body tr[data-subscription-id]').first().click();
    await expect(drawer).not.toHaveClass(/translate-x-full/, { timeout: 5000 });

    expect(errors).toEqual([]);
});

test('cancelling stops renewal without touching the ledger', async ({ page }) => {
    await page.goto('/subscription.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });
    const seeded = await seedSubscription(page);

    const r = await page.evaluate(async (id) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app); ds.actorUid = uid;
        const out = {};

        const before = await ds.getSubscriptionById(uid, id);
        out.journalBefore = before.journal_ref || null;

        // A reason is mandatory — the books have to say why it stopped.
        try { await ds.cancelSubscription(uid, id, ''); out.reasonRequired = false; }
        catch (e) { out.reasonRequired = /reason/i.test(e.message); }

        await ds.cancelSubscription(uid, id, 'No longer needed');
        const after = await ds.getSubscriptionById(uid, id);
        out.status = after.status;
        // Cancelling is forward-looking: the journal already posted stays put.
        out.journalAfter = after.journal_ref || null;
        out.amountUnchanged = after.amount === before.amount;

        try { await ds.cancelSubscription(uid, id, 'again'); out.doubleCancelBlocked = false; }
        catch (e) { out.doubleCancelBlocked = /already cancelled/i.test(e.message); }
        return out;
    }, seeded.id);

    expect(r.reasonRequired).toBe(true);
    expect(r.status).toBe('Cancelled');
    expect(r.journalAfter).toBe(r.journalBefore);   // ledger untouched
    expect(r.amountUnchanged).toBe(true);
    expect(r.doubleCancelBlocked).toBe(true);
});
