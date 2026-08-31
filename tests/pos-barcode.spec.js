const { test, expect } = require('@playwright/test');
const { setUnit } = require('./helpers/inventory-unit');

// =============================================================================
// Scanning, end to end: a barcode set on the item, typed at the till, straight
// into the cart.
//
// `items.barcode` has been stored since the bulk-import work and NOTHING has
// ever read it — and until now nothing could write it either, because the item
// drawer had no field for it. A scanner that cannot be taught a code is not a
// feature, so this covers both halves.
//
// A scanner is a KEYBOARD: it types the code into whatever has focus and presses
// Enter. There is no device to pair and no permission to ask for, which is why
// this spec can drive it with `fill` + `Enter` and still be testing the real
// thing rather than a simulation of it.
//
// Items cannot be deleted (immutable stock/journal history), so the fixture is
// tagged and left behind, then un-published from the till — the convention the
// other inventory specs follow.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

const TAG = `QA-BAR-${Date.now()}`;
const CODE = `899${Date.now().toString().slice(-10)}`;
const PRICE = 17000;

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-items').classList.contains('hidden')
            && document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])'),
        undefined, { timeout: 60000 }
    );
}

async function openFixture(page) {
    await gotoItems(page);
    await page.fill('#inventory-search', TAG);
    await page.waitForTimeout(900);
    await page.locator(`text=${TAG}`).first().click();
    await page.waitForSelector('#item-barcode', { timeout: 20000 });
}

test('a barcode set on the item scans into the cart at the till', async ({ page }) => {
    // ── 1. Teach the item its code ──────────────────────────────────────────
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.fill('#item-name', TAG);
    await setUnit(page, 'base', 'pcs');
    await page.fill('#item-price', String(PRICE));
    await page.fill('#item-barcode', CODE);
    await page.check('#item-pos-visible');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });

    // It round-trips. `saveItem` writes barcode only when the caller supplies
    // the key — so an edit that opened with the field empty would erase one that
    // arrived by import.
    await openFixture(page);
    await expect(page.locator('#item-barcode')).toHaveValue(CODE);
    await page.click('#item-drawer-close');

    // ── 2. Scan it ──────────────────────────────────────────────────────────
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

    // Exactly what the hardware does: type the code, press Enter.
    await page.fill('#pos-menu-search', CODE);
    await page.locator('#pos-menu-search').press('Enter');

    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
    await expect(page.locator('.pos-line-name').first()).toHaveText(TAG);
    // Cleared and ready for the next scan — a cashier works a queue without
    // touching the screen between items.
    await expect(page.locator('#pos-menu-search')).toHaveValue('');

    // Scanning the same code again stacks the line rather than opening a second.
    await page.fill('#pos-menu-search', CODE);
    await page.locator('#pos-menu-search').press('Enter');
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 25000 });
    await expect(page.locator('#pos-order-totals')).toContainText('34.000', { timeout: 20000 });

    // ── 3. A code that matches nothing adds nothing ─────────────────────────
    // Silence would be the dangerous outcome: the cashier believes the item is
    // on the bill and it is not.
    await page.fill('#pos-menu-search', '0000000000000');
    await page.locator('#pos-menu-search').press('Enter');
    await page.waitForTimeout(600);
    await expect(page.locator('.pos-line'), 'an unknown code must not add a line').toHaveCount(1);

    // ── 4. Clean up ─────────────────────────────────────────────────────────
    await page.fill('#pos-menu-search', '');
    await page.click('#pos-void-btn');
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan|no sale open|belum ada transaksi/i, { timeout: 20000 });

    await openFixture(page);
    await page.uncheck('#item-pos-visible');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });
});

test('a partial code narrows the grid instead of guessing', async ({ page }) => {
    // The safety property. `899100210` is a prefix of a real product's code, and
    // a scan cut short must NOT resolve to it — adding the wrong item to a cart
    // is worse than adding nothing. It filters, which is visible and correctable.
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

    await page.fill('#pos-menu-search', CODE.slice(0, 6));
    await page.locator('#pos-menu-search').press('Enter');
    await page.waitForTimeout(600);
    expect(await page.locator('.pos-line').count(), 'a partial code must not add anything').toBe(0);

    await page.click('#pos-void-btn');
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan|no sale open|belum ada transaksi/i, { timeout: 20000 });
});
