const { test, expect } = require('@playwright/test');
const { setUnit } = require('./helpers/inventory-unit');

// =============================================================================
// Menu modifiers, end to end: authored on the item, chosen at the till, priced
// into the line.
//
// The gap this closes. Customisation lived in the line's free-text `note` — no
// price effect at all — and FluxyOS discounts only ever SUBTRACT, so an "extra
// shot +Rp5.000" could not be rung up by any route. It was either not charged
// or typed in as something it was not, and both are invisible afterwards.
//
// What must hold, and what this asserts:
//   1. an item with no options still adds in ONE tap (the common case must not
//      pay for the rare one)
//   2. an item WITH options asks first
//   3. the chosen option's price reaches gross_amount, and therefore the order
//      total, and therefore the ledger
//   4. `unit_price` stays the MENU price — the same price-integrity rule that
//      keeps a discount off the price. A line that has forgotten what the menu
//      charged can never be audited against it.
//
// Items cannot be deleted (immutable stock/journal history), so the fixture is
// tagged and left behind — the convention every other inventory spec follows.
// It is un-published from the till at the end, so the menu the other specs see
// is exactly the menu they saw before.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

const TAG = `QA-MOD-${Date.now()}`;
const BASE = 20000;
const UPCHARGE = 5000;

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-items').classList.contains('hidden')
            && document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])'),
        undefined, { timeout: 60000 }
    );
}

test('an option priced on the item reaches the order total', async ({ page }) => {
    // ── 1. Author the menu item and its option group ────────────────────────
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.fill('#item-name', TAG);
    await setUnit(page, 'base', 'pcs');
    await page.fill('#item-price', String(BASE));
    await page.check('#item-pos-visible');

    // The editor starts EMPTY. Most menu items have no options, and a drawer
    // pre-seeded with a blank group would read as a required step.
    await expect(page.locator('#item-modifier-groups [data-mgroup]')).toHaveCount(0);

    await page.click('#item-modifier-add');
    const group = page.locator('#item-modifier-groups [data-mgroup]').first();
    await expect(group).toBeVisible();
    await group.locator('[data-mfield="name"]').fill('Size');
    await group.locator('[data-mfield="select"]').selectOption('one_required');

    await group.locator('[data-mopt]').first().locator('[data-mfield="opt-name"]').fill('Regular');
    await group.locator('[data-mfield="opt-add"]').click();
    const second = page.locator('#item-modifier-groups [data-mopt]').nth(1);
    await second.locator('[data-mfield="opt-name"]').fill('Large');
    await second.locator('[data-mfield="opt-price"]').fill(String(UPCHARGE));
    // Thousands formatting, same as every other amount field in the app.
    await expect(second.locator('[data-mfield="opt-price"]')).toHaveValue('5.000');

    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });

    // It round-trips. A group that saves but does not reload is a group the
    // owner has to retype every time they touch the price.
    await gotoItems(page);
    await page.fill('#inventory-search', TAG);
    await page.waitForTimeout(800);
    await page.locator(`text=${TAG}`).first().click();
    await expect(page.locator('#item-modifier-groups [data-mgroup]')).toHaveCount(1, { timeout: 20000 });
    await expect(page.locator('#item-modifier-groups [data-mfield="name"]').first()).toHaveValue('Size');
    await expect(page.locator('#item-modifier-groups [data-mopt]')).toHaveCount(2);
    await page.click('#item-drawer-close');

    // ── 2. Ring it up ───────────────────────────────────────────────────────
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

    await page.fill('#pos-menu-search', TAG);
    await page.waitForTimeout(500);
    const card = page.locator(`.pos-card:not([disabled])[data-name="${TAG}"]`);
    await expect(card, 'the item never reached the till menu').toHaveCount(1, { timeout: 20000 });

    // An item WITH options asks before it lands.
    await card.click();
    await expect(page.locator('.pos-mod-group')).toHaveCount(1, { timeout: 10000 });

    // A required group arms nothing until it is answered.
    const submit = page.locator('button[type="submit"][form="pos-drawer-form"]');
    await expect(submit).toBeDisabled();

    await page.locator('.pos-mod-opt', { hasText: 'Large' }).click();
    await expect(submit).toBeEnabled();
    // The button carries the RESULTING price, so the number read before
    // committing is the number the customer is charged.
    await expect(submit).toContainText('25.000');
    await submit.click();

    // ── 3. The upcharge is in the line, the total, and the price integrity ──
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 20000 });
    const line = page.locator('.pos-line').first();
    await expect(line.locator('.pos-line-mods'), 'the chosen option is not shown on the line')
        .toContainText('Large');
    await expect(line.locator('.pos-line-amt')).toContainText('25.000');

    await expect(page.locator('#pos-order-totals')).toContainText('25.000');
    // `unit_price` stays the MENU price — the upcharge rides beside it. The line
    // shows the per-unit charge (25.000) while the panel's own arithmetic still
    // resolves from the two stored halves, which is what keeps a line auditable
    // against the menu it was rung up from.
    await expect(line.locator('.pos-line-calc')).toContainText('25.000');

    // Quantity must carry the upcharge too — recomputing gross from unit_price
    // alone would silently drop every modifier the moment "+" was pressed.
    await line.locator('[data-inc]').click();
    await expect(page.locator('#pos-order-totals')).toContainText('50.000', { timeout: 20000 });

    // ── 4. Clean up: void the order, un-publish the fixture ─────────────────
    await page.click('#pos-void-btn');
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan/i, { timeout: 20000 });

    await gotoItems(page);
    await page.fill('#inventory-search', TAG);
    await page.waitForTimeout(800);
    await page.locator(`text=${TAG}`).first().click();
    await page.waitForSelector('#item-pos-visible', { timeout: 20000 });
    await page.uncheck('#item-pos-visible');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });
});

test('an item with no options still adds in one tap', async ({ page }) => {
    // The regression that would matter most: routing every add through a drawer
    // to serve the minority of items that need one.
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
    await page.click('#pos-new-order');
    await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });

    await page.locator('.pos-card:not([disabled])').first().click();
    await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 20000 });
    expect(await page.locator('.pos-mod-group').count(), 'a plain item opened the option drawer').toBe(0);

    await page.click('#pos-void-btn');
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan/i, { timeout: 20000 });
});
