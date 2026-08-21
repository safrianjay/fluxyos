const { test, expect } = require('@playwright/test');
const { setUnit, unitValue } = require('./helpers/inventory-unit');

// The recipe editor, driven the way a person drives it.
//
// tests/inventory-engine.spec.js already proves explodeRecipe/recipeCost as pure
// functions, and db-service validates the graph on write. This spec only asks
// whether a human can actually make a recipe — which, until now, they could not:
// the engine, the posting path and the data model all supported composites while
// the drawer said "v1's drawer never edits one", so they could only be created
// by script.
//
// Items cannot be deleted (immutable stock/journal history), so everything this
// creates is tagged and left behind, same convention as the other inventory specs.

test.describe.configure({ timeout: 180_000 });

const TAG = `QA-RCP-${Date.now()}`;

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-items').classList.contains('hidden')
            && document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])'),
        undefined, { timeout: 60000 }
    );
}

// An ingredient that actually has a cost basis, so the readout has something to
// price. Rp140.000 for 10 kg is Rp14 per gram.
async function seedIngredient(page, name) {
    await page.click('#new-item-btn');
    await page.fill('#item-name', name);
    await setUnit(page, 'base', 'g');
    await setUnit(page, 'purchase', 'kg');
    await page.fill('#item-purchase-factor', '1000');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });

    await page.click('#receive-stock-btn');
    const line = page.locator('#receipt-lines .inv-line').first();
    await line.locator('[data-field="item"]').selectOption({ label: name });
    await line.locator('[data-field="unit"]').selectOption('kg');
    await line.locator('[data-field="qty"]').fill('10');
    await line.locator('[data-field="amount"]').fill('140000');
    await page.click('#receipt-save-btn');
    await expect(page.locator('#receipt-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });

    // saveReceipt closes the drawer BEFORE it awaits loadInventory(), so the
    // page still holds pre-receipt rows for a moment — and the recipe cost
    // readout is built from those rows. Wait for the reload to land, or the
    // ingredient reads as having no cost basis yet.
    await expect(page.locator(`#inventory-body tr:has-text("${name}")`))
        .not.toContainText('Not stocked yet', { timeout: 30000 });
}

test('a recipe can be created, costed, and reopened', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));

    await gotoItems(page);
    await seedIngredient(page, `${TAG} Beras`);

    // ── The form changes shape with the answer ───────────────────────────────
    await page.click('#new-item-btn');
    await page.selectOption('#item-type', 'composite');
    await expect(page.locator('#item-recipe-section')).not.toHaveClass(/hidden/);
    // A recipe is never purchased and never held, so neither question applies.
    await expect(page.locator('#item-purchase-section')).toHaveClass(/hidden/);
    await expect(page.locator('#item-reorder-field')).toHaveClass(/hidden/);

    await page.fill('#item-name', `${TAG} Nasi Goreng`);
    await setUnit(page, 'base', 'porsi');
    // The batch unit is the recipe's own unit — it must follow that field.
    await expect(page.locator('#item-batch-unit')).toHaveText('porsi');
    await page.fill('#item-batch-size', '10');

    // A composite with no ingredients would explode to nothing and relieve no
    // stock, so it cannot be saved.
    await expect(page.locator('#item-save-btn')).toBeDisabled();

    // ── An ingredient, entered in the unit the cook thinks in ────────────────
    const row = page.locator('#recipe-lines .inv-line').first();
    await row.locator('[data-field="item"]').selectOption({ label: `${TAG} Beras` });
    await row.locator('[data-field="unit"]').selectOption('kg');
    await row.locator('[data-field="qty"]').fill('2');

    // Resolved to the ingredient's own base unit BEFORE saving, the same way the
    // receipt drawer shows it — a wrong unit is cheap here, expensive in a COGS
    // figure next month.
    await expect(row.locator('[data-field="derived"]')).toHaveText('2.000 g');

    // 2.000 g at Rp14/g = Rp28.000 a batch, over 10 portions = Rp2.800 each.
    const cost = page.locator('#recipe-cost');
    await expect(cost).toContainText('Rp28.000');
    await expect(cost).toContainText('Rp2.800');

    await expect(page.locator('#item-save-btn')).toBeEnabled();
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });

    // The table marks it as a recipe rather than leaving it to look like stock.
    const tableRow = page.locator(`#inventory-body tr:has-text("${TAG} Nasi Goreng")`);
    await expect(tableRow).toHaveCount(1);
    await expect(tableRow).toContainText('Recipe');

    // ── Reopening restores the recipe, in base units ─────────────────────────
    await tableRow.click();
    await expect(page.locator('#item-type')).toHaveValue('composite');
    // What an item IS cannot change: a recipe is relieved as its ingredients and
    // a stock item carries movements, so flipping it would reinterpret history.
    await expect(page.locator('#item-type')).toBeDisabled();
    await expect(page.locator('#item-batch-size')).toHaveValue('10');
    await expect(page.locator('#recipe-lines .inv-line').first().locator('[data-field="qty"]'))
        .toHaveValue('2000');
    await expect(page.locator('#recipe-cost')).toContainText('Rp28.000');

    // A recipe cannot list itself as an ingredient — the cycle the engine would
    // refuse is never offered in the first place.
    const options = await page.locator('#recipe-lines .inv-line').first()
        .locator('[data-field="item"] option').allTextContents();
    expect(options.join(' | ')).not.toContain(`${TAG} Nasi Goreng`);

    await page.click('#item-cancel-btn');
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an ingredient listed twice is refused with the ingredient named', async ({ page }) => {
    await gotoItems(page);
    await seedIngredient(page, `${TAG} Gula`);

    await page.click('#new-item-btn');
    await page.selectOption('#item-type', 'composite');
    await page.fill('#item-name', `${TAG} Teh Manis`);
    await setUnit(page, 'base', 'gelas');
    await page.fill('#item-batch-size', '4');

    const first = page.locator('#recipe-lines .inv-line').nth(0);
    await first.locator('[data-field="item"]').selectOption({ label: `${TAG} Gula` });
    await first.locator('[data-field="qty"]').fill('40');

    await page.click('#recipe-add-line');
    const second = page.locator('#recipe-lines .inv-line').nth(1);
    await second.locator('[data-field="item"]').selectOption({ label: `${TAG} Gula` });
    await second.locator('[data-field="qty"]').fill('20');

    await page.click('#item-save-btn');

    // The engine refuses this too, but its message carries a raw item id. The
    // drawer names the ingredient and says what to do about it instead.
    const err = page.locator('#item-form-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(`${TAG} Gula`);
    await expect(err).toContainText('listed twice');
    await expect(err).not.toContainText('item_id');

    // Combining them saves.
    await page.locator('#recipe-lines .inv-line').nth(1)
        .locator('[data-field="remove"]').click();
    await first.locator('[data-field="qty"]').fill('60');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 30000 });
});
