const { test, expect } = require('@playwright/test');
const { startTakeawayOrder } = require('./helpers/pos-order');
const { workspaceReady, setCategory, captureBaseline } = require('./helpers/business-category');

// =============================================================================
// Parking a sale — Hold and Resume.
//
// THE DEFECT THIS FIXES, measured before the change: with a cart open, pressing
// "New sale" took the lines from 1 to 0 with `warned: false` and an empty toast
// container. The cart was not lost — it stayed an `open` document, reachable
// from the Orders board — but nothing on screen said so and the cashier had no
// reason to look. It is also where a workspace's pile of stray open orders comes
// from.
//
// In F&B the TABLE is the parking slot, which is why this never surfaced until
// pay-first: retail has no tables, so a cart the cashier puts down has nowhere
// to be. Hold is therefore a pay-first affordance, and this spec runs against a
// retail workspace.
//
// FIXTURE. Flips `business_category` to `retail` and restores it in `finally`,
// including restoring ABSENT — see tests/pos-pay-first.spec.js for why that
// distinction matters.
// =============================================================================

test.describe.configure({ timeout: 240_000 });


// Does NOT wait for an enabled product card: in F&B the catalogue stays disabled
// until an order exists, and only a pay-first profile keeps it live. Waiting here
// would hang the F&B control on a state it can never reach.
async function openTill(page) {
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
}

/** Void whatever is on screen, if anything is. */
async function voidOpen(page) {
    const btn = page.locator('#pos-void-btn');
    if (!(await btn.isVisible().catch(() => false))) return;
    // The order panel is sticky and scrolls internally, so the button can be
    // "visible" to Playwright and still outside the viewport. Centre it in its
    // own scroll container rather than forcing the click.
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    await btn.click();
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no sale open|belum ada transaksi|no order open|belum ada pesanan/i, { timeout: 20000 });
}

test('a cart can be put down and picked up again', async ({ page }) => {
    await page.goto('/pos');
    await workspaceReady(page);
    const original = await captureBaseline(page);

    try {
        await setCategory(page, 'retail');
        await openTill(page);
        await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

        // ── Build a cart ────────────────────────────────────────────────────
        await page.locator('.pos-card:not([disabled])').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
        // The line paints before the totals do, so read the figure only once
        // there IS one — capturing "Rp0" here compares the cart against nothing.
        await expect(page.locator('#pos-order-totals')).not.toContainText('Total Rp0', { timeout: 20000 });
        const heldTotal = (await page.locator('#pos-order-totals').innerText()).replace(/\s+/g, ' ');

        // ── Hold it, with a name ────────────────────────────────────────────
        await expect(page.locator('#pos-hold-btn'), 'Hold is the affordance this whole spec is about').toBeVisible();
        await page.click('#pos-hold-btn');
        await page.waitForSelector('#pos-hold-label', { timeout: 10000 });
        await page.fill('#pos-hold-label', 'Blue jacket');
        await page.locator('button[type="submit"][form="pos-drawer-form"]').click();

        // The counter is clear and ready for the next customer.
        await expect(page.locator('#pos-order-title'))
            .toHaveText(/no sale open|belum ada transaksi/i, { timeout: 20000 });
        await expect(page.locator('.pos-line')).toHaveCount(0);

        // ── And it is findable ──────────────────────────────────────────────
        // The point. Before this, the only route back was the Orders board and
        // nothing pointed at it.
        const chip = page.locator('#pos-parked-chip');
        await expect(chip, 'a parked sale with nothing pointing at it is a lost sale').toBeVisible({ timeout: 20000 });
        await chip.click();
        const results = page.locator('#pos-order-results');
        await expect(results).toBeVisible();
        await expect(results, 'the label is what makes one parked cart tell itself from another')
            .toContainText('Blue jacket');

        // ── Resume ──────────────────────────────────────────────────────────
        await results.locator('[data-open]').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
        expect((await page.locator('#pos-order-totals').innerText()).replace(/\s+/g, ' '),
            'the resumed cart is not the cart that was parked').toBe(heldTotal);

        await voidOpen(page);
    } finally {
        await page.goto('/pos').catch(() => {});
        await workspaceReady(page).catch(() => {});
        await setCategory(page, original).catch(() => {});
    }
});

test('starting a new sale parks the open one instead of dropping it', async ({ page }) => {
    // The measured defect, pinned. Lines went 1 → 0 with no warning and no way
    // back on screen.
    await page.goto('/pos');
    await workspaceReady(page);
    const original = await captureBaseline(page);

    try {
        await setCategory(page, 'retail');
        await openTill(page);
        await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

        await page.locator('.pos-card:not([disabled])').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });

        await startTakeawayOrder(page);
        await expect(page.locator('.pos-line')).toHaveCount(0, { timeout: 20000 });

        // Cleared, yes — but PARKED, not abandoned. The chip is the difference
        // between the two, and it is the entire fix.
        await expect(page.locator('#pos-parked-chip'),
            'the cart was dropped rather than parked — this is the original defect')
            .toBeVisible({ timeout: 20000 });

        // Reload before resuming: the parked list is a snapshot, and an earlier
        // spec's cleanup can have voided a sale that is still in this tab's copy.
        // The app now says so rather than doing nothing, but the assertion below
        // is about resuming, not about that message.
        await page.reload();
        await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
        await page.click('#pos-parked-chip');
        await page.locator('#pos-order-results [data-open]').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
        await voidOpen(page);
    } finally {
        await page.goto('/pos').catch(() => {});
        await workspaceReady(page).catch(() => {});
        await setCategory(page, original).catch(() => {});
    }
});

test('an F&B till has no Hold — the table is the parking slot', async ({ page }) => {
    // The control. A second parking concept alongside tables would be two ways
    // to do one thing, and this is what stops Hold leaking into dine-in.
    await openTill(page);
    await workspaceReady(page);
    const category = await page.evaluate(() => window.FluxyWorkspace.businessCategory || null);
    expect(category, 'a previous spec did not restore business_category').not.toBe('retail');

    await startTakeawayOrder(page);
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
    await page.locator('.pos-card:not([disabled])').first().click();
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
    await expect(page.locator('#pos-hold-btn')).toBeHidden();
    await expect(page.locator('#pos-parked-chip')).toBeHidden();

    await voidOpen(page);
});
