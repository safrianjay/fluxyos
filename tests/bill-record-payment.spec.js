// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * Regression: the Bills "Record payment" confirm button must never stay stuck on
 * "Recording…" for the next bill.
 *
 * The bug: confirmPay() disabled the shared #bill-pay-confirm and set it to
 * "Recording…", but the SUCCESS path only closed the modal — it reset the button
 * solely in catch. So after one successful mark-paid, the reused modal reopened
 * with a disabled "Recording…" button for the next bill. The fix resets the
 * button on modal open AND close (resetPayConfirmButton).
 *
 * Marking a bill paid is terminal (posts to the ledger, can't be undone), so this
 * test does NOT submit. Instead it forces the button into the post-success stuck
 * state, then verifies closing + reopening the modal restores it — exactly the
 * path the success flow now takes.
 */
test('Bills: Record payment button is never stuck on "Recording…"', async ({ page }) => {
    await installTrialPaywallBypass(page);
    await page.goto('/bill');
    await page.waitForSelector('#bill-table-body tr, .fluxy-table-empty', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window.FluxyWorkspace && window.FluxyWorkspace.id), null, { timeout: 20_000 }).catch(() => {});

    // Find an unpaid bill (id + vendor) from Firestore — Mark-as-Paid only shows
    // for unpaid bills, and it may sit on any pagination page.
    const unpaid = await page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return null;
        const db = fsMod.getFirestore(app);
        const wsId = window.FluxyWorkspace && window.FluxyWorkspace.id;
        const scopes = [wsId ? `workspaces/${wsId}` : null, `users/${user.uid}`].filter(Boolean);
        for (const scope of scopes) {
            const snap = await fsMod.getDocs(fsMod.collection(db, `${scope}/bills`));
            let hit = null;
            snap.forEach(d => { const b = d.data(); if (!hit && String(b.payment_status || '').toLowerCase() !== 'paid' && !b.is_voided && b.vendor_name) hit = { id: d.id, vendor: b.vendor_name }; });
            if (hit) return hit;
        }
        return null;
    });
    test.skip(!unpaid, 'no unpaid bill on the QA account to exercise Record payment');

    // openPayModal() is gated by FluxyAccessGuard.requireWriteAccess(); the QA
    // account may be trial-restricted. This test never submits, so allow the
    // modal to open (the paywall itself is covered elsewhere).
    await page.waitForFunction(() => !!window.FluxyAccessGuard, null, { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => { if (window.FluxyAccessGuard) window.FluxyAccessGuard.requireWriteAccess = () => true; });

    // Surface it via search so it renders on page 1, then open its drawer.
    await page.locator('#bill-search-input').fill(unpaid.vendor);
    const targetRow = page.locator(`#bill-table-body tr[data-bill-id="${unpaid.id}"]`).first();
    await targetRow.waitFor({ state: 'visible', timeout: 10_000 });

    // Open the bill drawer once (sets activeDrawerBill). The pay modal's Cancel
    // closes only the modal, leaving the drawer open, so both the first open and
    // the reopen just fire the Mark-as-Paid handler directly. (The button lives in
    // the drawer footer and stays present even when the drawer is off-screen, so
    // its DOM click handler is the reliable trigger — not a viewport click.)
    await targetRow.click();
    const markPaidBtn = page.locator('#bill-mark-paid-btn');
    const openPayModal = async () => {
        await markPaidBtn.evaluate((b) => b.click());
        // openPayModal() awaits getBankAccounts before revealing the modal.
        await expect(page.locator('#bill-pay-modal')).toBeVisible({ timeout: 20_000 });
    };

    await openPayModal();
    const confirm = page.locator('#bill-pay-confirm');
    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveText('Mark as Paid');

    // Simulate the leftover state a successful submit used to produce.
    await confirm.evaluate((b) => { b.disabled = true; b.textContent = 'Recording…'; });

    // Close (the success path calls closePayModal) …
    await page.locator('#bill-pay-cancel').click();
    await expect(page.locator('#bill-pay-modal')).toBeHidden();

    // … and reopening must show a clean, clickable button — not the stuck one.
    await openPayModal();
    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveText('Mark as Paid');
});
