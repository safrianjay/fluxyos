const { test, expect } = require('@playwright/test');

// =============================================================================
// The order line: a typable quantity, honest stock, and one row of controls.
//
// THREE THINGS THIS PINS.
//
// 1. QUANTITY IS A FIELD. It was a stepper and a number you could only nudge.
//    Selling a dozen of something meant tapping "+" eleven times, which is not a
//    till. The steppers stay for the one-or-two case; the number is typed.
//
// 2. STOCK WARNS AND NEVER BLOCKS. A shop that has physically got the thing
//    sells it, whatever inventory believes, and a cashier cannot stop
//    mid-service to reconcile. Refusing the sale would make FluxyOS wrong about
//    the MONEY as well as the stock — the worse of the two errors. The negative
//    on-hand left behind is the correct record and surfaces in the next count.
//
//    Verified by hand on 2026-08-31 against injected stock levels: an item at 0
//    rendered "Out of stock", one at 3 rendered "3 left", one at 90 rendered
//    nothing, a line of 5 against 1 in stock read "Only 1 in stock, 5 on this
//    order" — and `cards disabled: 0` throughout. The assertion below is the
//    part that can be made to hold without writing stock movements to a real
//    ledger: no stock state may ever disable a card.
//
// 3. THE CONTROLS ARE ONE ROW. They used to sit inside the line's left column,
//    which is ~215px once the amount has taken its share, so the third control
//    wrapped onto a line by itself and the row read as 2+1 — a layout accident
//    rather than a layout. They span the full line now.
// =============================================================================

test.describe.configure({ timeout: 180_000 });

async function openCart(page) {
    // An explicit width, because the order panel is 320px under a 1040px canvas
    // and 380px above it — and whether three controls fit on one row is exactly
    // a question about that width. Playwright's 1280 default puts the panel in
    // its narrow mode, where the assertion below would be measuring the wrong
    // thing.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
    await page.locator('.pos-card:not([disabled])').first().click();
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
}

async function voidOpen(page) {
    const btn = page.locator('#pos-void-btn');
    if (!(await btn.isVisible().catch(() => false))) return;
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await btn.click();
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan|no sale open|belum ada transaksi/i, { timeout: 20000 });
}

test('a quantity can be typed, not only stepped', async ({ page }) => {
    await openCart(page);

    const qty = page.locator('.pos-qty-input').first();
    await expect(qty, 'the quantity must be a field a cashier can type into').toBeVisible();
    await expect(qty).toHaveValue('1');

    await qty.fill('12');
    await qty.press('Enter');

    // The arithmetic on the line is the proof it reached the order, not just the
    // input: `unit × 12 = total`.
    await expect(page.locator('.pos-line-calc')).toContainText('× 12', { timeout: 25000 });
    await expect(page.locator('#pos-order-totals')).not.toContainText('Total Rp0');

    // Letters are not quantities.
    await qty.fill('3a');
    await expect(qty, 'non-digits must never reach the order').toHaveValue('3');
    await qty.press('Escape');

    await voidOpen(page);
});

test('clearing the box does not delete the line', async ({ page }) => {
    // The commonest thing a person does in a number field is clear it to retype.
    // Reading that as "quantity zero" would remove the item mid-edit — the DAL
    // drops a zero-quantity line, so this would be silent and immediate.
    await openCart(page);

    const qty = page.locator('.pos-qty-input').first();
    await qty.fill('');
    await qty.blur();
    await page.waitForTimeout(1500);

    await expect(page.locator('.pos-line'), 'clearing the box removed the line').toHaveCount(1);
    await expect(qty, 'the box must fall back to the quantity on the order').toHaveValue('1');

    await voidOpen(page);
});

test('stock never disables a product — it only warns', async ({ page }) => {
    await openCart(page);

    const state = await page.evaluate(() => ({
        // Any card carrying a stock tag must still be tappable. This is the
        // invariant; the copy is verified by hand (see the header).
        taggedButDisabled: [...document.querySelectorAll('.pos-card')]
            .filter((c) => c.querySelector('.pos-card-stock') && c.disabled).length,
        outOfStockTags: document.querySelectorAll('.pos-card-stock.is-out').length,
        anyTag: document.querySelectorAll('.pos-card-stock').length
    }));

    expect(state.taggedButDisabled,
        'a product the shop still has in its hand must remain sellable').toBe(0);
    // Whether this workspace currently HAS out-of-stock items is a fact about
    // the day, not about the code — so it is reported, never asserted.
    expect(state.outOfStockTags).toBeLessThanOrEqual(state.anyTag);

    await voidOpen(page);
});

test('the line controls sit on one row', async ({ page }) => {
    await openCart(page);

    const layout = await page.evaluate(() => {
        const row = document.querySelector('.pos-line-controls');
        if (!row) return null;
        const tops = [...row.children].map((el) => Math.round(el.getBoundingClientRect().top));
        return { count: row.children.length, spread: Math.max(...tops) - Math.min(...tops) };
    });

    expect(layout, 'the line has no controls at all').not.toBeNull();
    expect(layout.count, 'stepper, notes and discount').toBeGreaterThanOrEqual(3);
    // 2px of tolerance for sub-pixel baselines; a wrap is ~36px.
    expect(layout.spread, 'the controls wrapped onto a second row').toBeLessThanOrEqual(2);

    await voidOpen(page);
});
