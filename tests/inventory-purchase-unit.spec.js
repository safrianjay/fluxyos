const { test, expect } = require('@playwright/test');
const { setUnit } = require('./helpers/inventory-unit');

// The purchase unit moved out of the item drawer and into Receive stock.
//
// The Head of Finance's review called the item-drawer field redundant. It was
// not redundant — it is the `units[]` conversion seam, and deleting it would
// have meant every receipt had to be keyed in base units (25000 g, not 25 kg).
// What was wrong is WHERE it was asked: in the item drawer, before anyone had
// bought the thing, so the answer had to be guessed. It is now asked on the
// receipt line, with the delivery note in hand, and saved back onto the item so
// it is only entered once.
//
// Items cannot be deleted, so this leaves a tagged item behind — same
// convention as inventory-cogs.spec.js.

test.describe.configure({ timeout: 150_000 });

const TAG = `QA-PU-${Date.now()}`;

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])')
            && !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
    );
}

test('the item drawer no longer asks for a purchase unit', async ({ page }) => {
    await gotoItems(page);
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);
    expect(await page.locator('#item-purchase-section').count()).toBe(0);
    expect(await page.locator('#item-purchase-factor').count()).toBe(0);
});

test('a purchase unit is defined on the receipt line and remembered on the item', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) errors.push(m.text());
    });

    await gotoItems(page);

    // An item with no alternate unit — which is now every new item.
    await page.click('#new-item-btn');
    await page.waitForTimeout(400);
    await page.fill('#item-name', `${TAG} Tepung`);
    await setUnit(page, 'base', 'g');
    await page.click('#item-save-btn');
    await page.waitForTimeout(2500);

    await page.click('#receive-stock-btn');
    await page.waitForTimeout(1200);

    // Pick our item on the first line.
    await page.selectOption('#receipt-lines select[data-field="item"]', { label: `${TAG} Tepung` });
    await page.waitForTimeout(400);

    // Only the base unit is on offer, plus the escape hatch.
    const units = await page.evaluate(() => {
        const sel = document.querySelector('#receipt-lines select[data-field="unit"]');
        return Array.from(sel.options).map((o) => o.value);
    });
    expect(units).toEqual(['g', '__newunit__']);

    await page.selectOption('#receipt-lines select[data-field="unit"]', '__newunit__');
    await page.waitForTimeout(400);
    await page.fill('[data-field="newunit"]', 'sak');
    await page.fill('[data-field="newfactor"]', '25000');
    await page.fill('#receipt-lines [data-field="qty"]', '2');
    await page.fill('#receipt-lines [data-field="amount"]', '300000');
    await page.waitForTimeout(600);

    // 2 sak at 25.000 g each is 50.000 g — resolved by the engine against the
    // item as it WOULD be, not by a second conversion written here.
    await expect(page.locator('#receipt-lines [data-field="derived"]').first()).toContainText('50.000');

    await page.click('#receipt-save-btn');
    await page.waitForTimeout(3500);

    const after = await page.evaluate(async (tag) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        const items = await ds.getItems(uid, { includeArchived: true });
        const it = items.find((i) => i.name === `${tag} Tepung`);
        const onHand = await ds.getStockOnHand(uid, {});
        return it ? { units: it.units, qty: onHand[it.id] ? onHand[it.id].quantity : null } : null;
    }, TAG);

    expect(after).not.toBeNull();
    // The unit was written back, so the next receipt offers it from the list.
    expect(after.units).toEqual([{ code: 'sak', factor: 25000, role: 'purchase' }]);
    // And the stock landed in base units, as it always must.
    expect(after.qty).toBe(50000);
    expect(errors).toEqual([]);
});

test('a fractional or self-referencing factor is refused, not rounded', async ({ page }) => {
    await gotoItems(page);
    await page.click('#receive-stock-btn');
    await page.waitForTimeout(1200);
    await page.selectOption('#receipt-lines select[data-field="unit"]', '__newunit__');
    await page.waitForTimeout(400);

    const baseUnit = await page.evaluate(() => {
        const sel = document.querySelector('#receipt-lines select[data-field="unit"]');
        return sel.options[0].value;
    });

    // Naming the base unit again is a contradiction, not a conversion.
    await page.fill('[data-field="newunit"]', baseUnit);
    await page.fill('[data-field="newfactor"]', '10');
    await page.fill('#receipt-lines [data-field="qty"]', '1');
    await page.waitForTimeout(500);
    await expect(page.locator('#receipt-lines [data-field="derived"]').first())
        .toContainText("already this item's stock unit");

    // A factor is a whole number of base units — a fraction would put binary
    // rounding error straight into a journal amount.
    await page.fill('[data-field="newunit"]', 'karton');
    await page.fill('[data-field="newfactor"]', '');
    await page.waitForTimeout(500);
    await expect(page.locator('#receipt-lines [data-field="derived"]').first())
        .toContainText('Whole numbers only');

    await page.click('#receipt-drawer-close');
});
