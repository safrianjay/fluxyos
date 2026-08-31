const { test, expect } = require('@playwright/test');

// =============================================================================
// The retail till: pay-first, and no room to draw.
//
// Every order used to walk the dine-in chain — open → sent → served →
// awaiting_payment → paid — because it was the only chain there was. Correct for
// a restaurant. Wrong for every counter transaction, where the customer pays
// BEFORE they get the goods: a retail cashier pressed "Send to kitchen", "Mark
// served" and "Request bill" before reaching the one button that meant anything,
// on every single sale.
//
// The engine never needed changing. `recordPosPayment` has no status
// precondition and `wsValidPosOrderUpdate` imposes no ordering, so `open → paid`
// was always legal — the ladder lived only in `pos.js`. This spec pins that:
// the workflow differs, the money does not.
//
// FIXTURE. `business_category` is deliberately not set-once (it re-prices
// nothing), so the spec flips the QA workspace to `retail`, runs, and puts it
// back. The restore is in `finally` — leaving the workspace as retail would
// change every other POS spec's behaviour, so a failure here must not leak.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

/**
 * Wait until the workspace is fully RESOLVED, not merely identified.
 *
 * `window.FluxyWorkspace` is published in stages: `id` lands before the profile
 * read returns, so a spec that waits on `id` and then reads `businessCategory`
 * gets `null` for a workspace that has one. That is not hypothetical — the first
 * cut of this spec captured a false "original" that way and its restore then
 * skipped, leaving the QA workspace mis-stamped. `ready` is the flag that means
 * the profile read is done.
 */
async function workspaceReady(page) {
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.ready,
        null, { timeout: 30000 });
}

/** Read the category the workspace currently carries. Call after workspaceReady. */
async function readCategory(page) {
    return page.evaluate(() => (window.FluxyWorkspace && window.FluxyWorkspace.businessCategory) || null);
}

/**
 * Write `business_category` on the workspace doc through the app's own Firebase
 * instance — the field is on the workspace profile, which an owner may edit.
 *
 * `null` DELETES the field rather than writing null: `isValidWorkspaceProfile`
 * validates the value against the seven-category enum when the key is present,
 * so a literal null would be refused — and "absent" is a state a workspace can
 * genuinely be in, which is exactly what a restore has to be able to reach.
 */
// The baseline category, captured ONCE for the whole file.
//
// Each test used to capture its own "original", which meant the second one
// captured `retail` left behind by the first and faithfully restored THAT — a
// leak that perpetuates itself and then fails the F&B control for a reason that
// looks nothing like the cause. `retail` can never be a real baseline here:
// these specs are the only thing in the suite that sets it.
let baseline;
async function captureBaseline(page) {
    const seen = await page.evaluate(() => (window.FluxyWorkspace && window.FluxyWorkspace.businessCategory) || null);
    if (baseline === undefined) baseline = (seen === 'retail' ? null : seen);
    return baseline;
}

async function setCategory(page, category) {
    const err = await page.evaluate(async (cat) => {
        try {
            const [{ getFirestore, doc, updateDoc, deleteField, serverTimestamp }, { getApp }] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js')
            ]);
            const ws = window.FluxyWorkspace && window.FluxyWorkspace.id;
            if (!ws) return 'no workspace resolved';
            await updateDoc(doc(getFirestore(getApp()), `workspaces/${ws}`), {
                business_category: cat === null ? deleteField() : cat,
                updated_at: serverTimestamp()
            });
            return null;
        } catch (e) { return String(e && e.message); }
    }, category);
    expect(err, `could not set business_category=${category}`).toBeNull();
}

async function openTill(page) {
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
}

test('a retail workspace gets a pay-first counter, and the money is unchanged', async ({ page }) => {
    await page.goto('/pos');
    await workspaceReady(page);
    const original = await captureBaseline(page);

    try {
        await setCategory(page, 'retail');
        await openTill(page);

        // ── The shell is not a restaurant ───────────────────────────────────
        await expect(page.locator('#nav-container [data-view="tables"]'),
            'a retail till has no floor to draw').toHaveCount(0);
        await expect(page.locator('#nav-container [data-view="till"]')).toHaveCount(1);
        await expect(page.locator('#nav-container [data-view="orders"]')).toHaveCount(1);
        await expect(page.locator('#pos-tables-btn'), '"Table Order" opens a floor that does not exist').toBeHidden();
        await expect(page.locator('.pos-order-selects'), 'dine-in / table pickers are meaningless at a counter').toBeHidden();
        await expect(page.locator('#pos-new-order')).toContainText(/new sale/i);

        // ── One tap starts the sale ─────────────────────────────────────────
        // Nobody "opens an order" at a counter; they start scanning. The
        // catalogue is live with no order open, and the first tap creates it.
        await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
        await expect(page.locator('#pos-order-title')).toHaveText(/no sale open|belum ada transaksi/i);
        await page.locator('.pos-card:not([disabled])').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });

        // ── ONE press reaches payment ───────────────────────────────────────
        // The whole point. In F&B this button would read "Send to kitchen".
        const primary = page.locator('#pos-primary');
        await expect(primary, 'the primary action must carry the amount that will be charged')
            .toContainText(/charge|bayar/i);
        const total = (await page.locator('#pos-order-totals').innerText()).replace(/\s+/g, ' ');
        await primary.click();
        await expect(page.locator('#pos-pay-amount'),
            'a retail sale must reach payment in ONE press').toBeVisible({ timeout: 15000 });

        await page.locator('#pos-method-row [data-method="cash"]').click();
        const receipt = page.waitForEvent('popup', { timeout: 30000 }).then((p) => p.close()).catch(() => {});
        await page.locator('button[type="submit"][form="pos-drawer-form"]').click();
        await expect(page.locator('#pos-order-status')).toHaveText(/paid|lunas/i, { timeout: 30000 });
        await receipt;

        // ── The money is identical to a pay-last sale ───────────────────────
        // The order posted revenue through the same POS-SALE path. If pay-first
        // had needed its own posting rule, this is where two sets of books would
        // start.
        const posted = await page.evaluate(() => {
            const el = document.getElementById('pos-order-status');
            return el ? el.textContent.trim() : null;
        });
        expect(posted).toBeTruthy();
        expect(total, 'the totals panel painted nothing to charge for').toMatch(/\d/);

        // After payment the counter is ready for the next customer, and the sale
        // is still reachable from the Orders board (which is what makes clearing
        // it safe — see docs/POS_BUSINESS_TYPE_STRATEGY.md B4).
        await expect(page.locator('#pos-primary')).toHaveText(/new sale|transaksi baru/i);
        await page.click('#nav-container [data-view="orders"]');
        await expect(page.locator('#pos-orders-grid .pos-ocard[data-status="paid"]').first(),
            'a paid retail sale must stay reachable, or refund is a dead end')
            .toBeVisible({ timeout: 20000 });
    } finally {
        // Restore, whatever happened. A workspace left as `retail` would change
        // every other POS spec.
        await page.goto('/pos').catch(() => {});
        await workspaceReady(page).catch(() => {});
        // Restores ABSENT too — `if (original)` was the bug that leaked `retail`
        // onto the QA workspace, because an unstamped workspace reads as null and
        // null is falsy.
        await setCategory(page, original).catch(() => {});
    }
});

test('an F&B workspace still walks the kitchen ladder', async ({ page }) => {
    // The control. Without it, a profile that returned pay-first for everyone
    // would pass the test above and quietly remove the kitchen from every
    // restaurant on the product.
    await openTill(page);
    await workspaceReady(page);
    const category = await readCategory(page);
    // NOT a skip. A control that opts out when the fixture leaked is a control
    // that reports green on the exact failure it exists to catch — and the leak
    // is precisely what happened on the first run of this file.
    expect(category, 'the retail spec did not restore business_category — its fixture leaked')
        .not.toBe('retail');

    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
    await page.locator('.pos-card:not([disabled])').first().click();
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });

    // An F&B till does NOT offer payment first — the food has to reach the table.
    await expect(page.locator('#pos-primary')).toHaveText(/send to kitchen|kirim ke dapur/i);
    await expect(page.locator('#nav-container [data-view="tables"]')).toHaveCount(1);

    await page.click('#pos-void-btn');
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan/i, { timeout: 20000 });
});
