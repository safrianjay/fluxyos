const { test, expect } = require('@playwright/test');
const { setUnit } = require('./helpers/inventory-unit');

// The item drawer after the Head of Finance's review (Inventory tab of the
// revision sheet): SKU beside Name, an "I track this inventory" switch, and an
// Accounting section carrying the three chart-of-accounts codes.
//
// Items cannot be deleted (`allow delete: if false`), so this leaves tagged rows
// behind — same convention as inventory-cogs.spec.js.

test.describe.configure({ timeout: 150_000 });

const TAG = `QA-ACCT-${Date.now()}`;

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])')
            && !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
    );
}

test('SKU is answered next to Name, not nine fields below it', async ({ page }) => {
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);

    // Both identity fields share one row, and SKU now comes before the unit
    // rather than after the reorder point.
    const order = await page.evaluate(() => {
        const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
        const nameBox = document.getElementById('item-name').getBoundingClientRect();
        const skuBox = document.getElementById('item-sku').getBoundingClientRect();
        return {
            sameRow: Math.abs(nameBox.top - skuBox.top) < 4,
            sku: skuBox.top,
            unitLabel: top('label[for="item-base-unit"]'),
            reorderLabel: top('label[for="item-reorder"]'),
            priceLabel: top('label[for="item-price"]')
        };
    });
    expect(order.sameRow).toBe(true);
    expect(order.sku).toBeLessThan(order.unitLabel);
    expect(order.sku).toBeLessThan(order.reorderLabel);
    expect(order.sku).toBeLessThan(order.priceLabel);
});

test('untracked hides every field that only exists for something on a shelf', async ({ page }) => {
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);

    const stockOnly = ['item-purchase-section', 'item-shelf-field', 'item-reorder-field', 'item-inventory-account-field'];
    const hiddenState = () => page.evaluate((ids) => ids.map((id) =>
        document.getElementById(id).classList.contains('hidden')), stockOnly);

    // Tracked by default — a new item is normally something you hold.
    expect(await hiddenState()).toEqual([false, false, false, false]);

    await page.uncheck('#item-track-stock');
    await page.waitForTimeout(200);
    // Hidden, not disabled: a greyed-out Reorder point still reads as something
    // this item could have, and a service cannot.
    expect(await hiddenState()).toEqual([true, true, true, true]);

    // The unit label stops calling itself Stock unit, because there is no stock.
    const label = await page.textContent('label[for="item-base-unit"]');
    expect(label.trim()).toBe('Unit');

    await page.check('#item-track-stock');
    await page.waitForTimeout(200);
    expect(await hiddenState()).toEqual([false, false, false, false]);
    expect((await page.textContent('label[for="item-base-unit"]')).trim()).toBe('Stock unit');
});

test('"What is this?" is answered by the tab, not by a field above the name', async ({ page }) => {
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);

    // The Head of Finance's note was "What is this? — ga perlu". The question is
    // gone; the tab row answers it. The select survives only as the hidden value
    // the rest of the form reads.
    expect(await page.locator('#item-type-field').count()).toBe(0);
    await expect(page.locator('#item-type')).toBeHidden();
    await expect(page.locator('#item-type')).toHaveValue('stock');

    // Recipes are still reachable — removing the field without this would have
    // deleted the only way to create a composite, which POS menu items explode
    // through for their COGS.
    await page.click('#item-tab-recipe');
    await page.waitForTimeout(300);
    await expect(page.locator('#item-type')).toHaveValue('composite');
    await expect(page.locator('#item-recipe-section')).toBeVisible();
    // A recipe is made, not bought, and is not "tracked inventory" you shelve.
    await expect(page.locator('#item-purchase-section')).toBeHidden();
    await expect(page.locator('#item-track-field')).toBeHidden();

    await page.click('#item-tab-single');
    await page.waitForTimeout(300);
    await expect(page.locator('#item-type')).toHaveValue('stock');
    await expect(page.locator('#item-recipe-section')).toBeHidden();
});

test('the accounting codes save and come back when the item is reopened', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) consoleErrors.push(m.text());
    });

    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);

    await page.fill('#item-name', `${TAG} Kopi`);
    await page.fill('#item-sku', TAG);
    await setUnit(page, 'base', 'g');

    // Driven the way a person drives it: open the picker, search, pick a row.
    // The value lives in the component's closure, so writing to its hidden input
    // from outside leaves getValue() stale and the save silently loses the code.
    const pick = async (mountId, code) => {
        await page.click(`#${mountId} .fluxy-acct-trigger`);
        await page.waitForSelector('.fluxy-acct-menu .fluxy-acct-search', { timeout: 10000 });
        await page.fill('.fluxy-acct-menu .fluxy-acct-search', code);
        await page.waitForTimeout(250);
        await page.click(`.fluxy-acct-menu [data-code="${code}"]`);
        await page.waitForTimeout(250);
    };
    await pick('item-sell-account-mount', '4000');
    await pick('item-cogs-account-mount', '5100');

    await page.click('#item-save-btn');
    await page.waitForTimeout(2500);

    // Reopen from the table and confirm the codes survived the round trip.
    const stored = await page.evaluate(async (tag) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        const items = await ds.getItems(uid, { includeArchived: true });
        const it = items.find((i) => i.name === `${tag} Kopi`);
        return it ? {
            sku: it.sku,
            track: it.track_stock,
            tracking: it.tracking_type,
            sell: it.default_sales_account_code,
            cogs: it.default_cogs_account_code
        } : null;
    }, TAG);

    expect(stored).not.toBeNull();
    expect(stored.sku).toBe(TAG);
    expect(stored.track).toBe(true);
    expect(stored.tracking).toBe('qty');
    expect(stored.sell).toBe('4000');
    expect(stored.cogs).toBe('5100');
    expect(consoleErrors).toEqual([]);
});
