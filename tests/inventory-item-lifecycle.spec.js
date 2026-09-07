// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// An item can be retired, and a menu group can be renamed.
//
// Neither could be done from a screen. `archiveItem` had existed since inventory
// shipped with NOTHING calling it, and a menu group is not a document at all —
// it exists because items name it in `pos_category`, so a typo'd one could only
// be fixed by opening every item in it, one at a time.
//
// ⚠️ THERE IS NO DELETE, AND THERE CANNOT BE. Stock movements, goods receipts
// and posted journals reference the item, and posted journals are immutable. So
// retirement is a soft archive — which means the list has to be able to SHOW an
// archived item, or the screen is a one-way door.
//
// The specs seed their own item and reverse it, per the standing rule.
// =============================================================================

test.describe.configure({ timeout: 300_000 });

// ⚠️ EACH SPEC GETS ITS OWN NAME, not a shared prefix. These run against one
// live workspace, and `hasText` is a SUBSTRING match — a shared prefix made the
// archive spec match the recipe spec's ingredient and report that archiving had
// not worked when it had.
const STAMP = Date.now();
const TAG = `QA Archive ${STAMP}`;
const RECIPE_TAG = `QA Recipe ${STAMP}`;
const GROUP_TAG = `QA Group ${STAMP}`;

/** ⚠️ WAIT FOR A REAL ROW. `renderShimmer` draws exactly five placeholder <tr>s,
    so waiting on `#inventory-body tr` matches the skeleton and everything after
    it races the load — which is how the first run of this spec "found" an empty
    catalogue on a 466-item workspace. */
async function openItems(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/inventory');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id,
        undefined, { timeout: 60000 });
    await page.click('[data-inv-tab="items"]');
    await page.waitForSelector('#inventory-body [data-item-id]', { timeout: 60000 });
}

async function seedItem(page, name, posCategory) {
    return page.evaluate(async ({ n, cat }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const item = await ds.saveItem(uid, {
            name: n, type: 'stock', base_unit: 'pcs', pos_category: cat || null
        }, { create: true });
        return item.id;
    }, { n: name, cat: posCategory });
}

const findRow = async (page, name) => {
    await page.locator('#inventory-search').fill(name);
    const row = page.locator('#inventory-body [data-item-id]', { hasText: name });
    await expect(row).toHaveCount(1, { timeout: 20000 });
    return row;
};

test('AN ITEM CAN BE ARCHIVED AND RESTORED', async ({ page }) => {
    await openItems(page);
    await seedItem(page, TAG, null);
    await page.reload();
    await openItems(page);

    let row = await findRow(page, TAG);
    await row.click();
    const btn = page.locator('#item-archive-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Archive item');

    // Two taps: it disappears from the till menu and every picker.
    await btn.click();
    await expect(btn).toHaveText('Tap again to archive');
    await btn.click();
    await expect(page.locator('#toast-container')).toContainText('Item archived', { timeout: 30000 });

    // Gone from the default list — the catalogue is the ACTIVE catalogue.
    await page.locator('#inventory-search').fill(TAG);
    await expect(page.locator('#inventory-body [data-item-id]', { hasText: TAG })).toHaveCount(0);

    // ⚠️ AND FINDABLE AGAIN, or archiving is a one-way door and the only way
    // back is the console.
    await page.locator('#inventory-show-archived').check();
    row = await findRow(page, TAG);
    await expect(row, 'an archived item is not marked as one').toContainText('Archived');

    await row.click();
    await expect(btn).toHaveText('Restore item');
    await btn.click();
    await expect(page.locator('#toast-container')).toContainText('Item restored', { timeout: 30000 });
    row = await findRow(page, TAG);
    await expect(row).not.toContainText('Archived');

    // Leave it archived.
    await row.click();
    await btn.click();
    await btn.click();
    await page.locator('#inventory-search').fill(TAG);
    await expect(page.locator('#inventory-body [data-item-id]', { hasText: TAG })).toHaveCount(1);
});

test('AN INGREDIENT INSIDE A LIVE RECIPE CANNOT BE ARCHIVED', async ({ page }) => {
    // ⚠️ NOTHING DOWNSTREAM WOULD REFUSE IT. `saveItem` validates a recipe's
    // graph when the RECIPE is written, not when a component is retired later —
    // so the composite would go on costing against an item that had vanished
    // from every picker, and the first person to open that recipe could not put
    // the ingredient back.
    const ing = `${RECIPE_TAG} Flour`;
    const dish = `${RECIPE_TAG} Cake`;
    await openItems(page);
    const ingId = await seedItem(page, ing, null);
    await page.evaluate(async ({ id, n }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        await ds.saveItem(uid, {
            name: n, type: 'composite', base_unit: 'pcs', batch_size: 1,
            components: [{ item_id: id, quantity: 100 }]
        }, { create: true });
    }, { id: ingId, n: dish });

    await page.reload();
    await openItems(page);
    const row = await findRow(page, ing);
    await row.click();
    await page.locator('#item-archive-btn').click();

    const err = page.locator('#item-form-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText(dish);
    await expect(err).toContainText('recipe');
    // …and it did NOT archive.
    await expect(page.locator('#item-archive-btn')).toHaveText('Archive item');
});

test('A MENU GROUP CAN BE RENAMED ACROSS EVERY ITEM AT ONCE', async ({ page }) => {
    const group = `QA Grp ${Date.now()}`;
    const renamed = `${group} B`;
    await openItems(page);
    await seedItem(page, `${GROUP_TAG} Kopi`, group);
    await seedItem(page, `${GROUP_TAG} Teh`, group);
    await page.reload();
    await openItems(page);

    await page.locator('#inventory-groups-btn').click();
    const list = page.locator('#groups-list');
    // Counted from the same list the item drawer's dropdown is built from, so
    // the two cannot disagree about what exists.
    await expect(list.locator(`[data-group="${group}"]`)).toContainText('2 items');

    await list.locator(`[data-rename-group="${group}"]`).click();
    await page.locator('[data-group-input]').fill(renamed);
    await page.locator('[data-group-save]').click();
    await expect(page.locator('#toast-container')).toContainText('items moved', { timeout: 30000 });

    await page.locator('#inventory-groups-btn').click();
    await expect(list.locator(`[data-group="${renamed}"]`)).toContainText('2 items');
    await expect(list.locator(`[data-group="${group}"]`)).toHaveCount(0);

    // ⚠️ RENAMING ONTO AN EXISTING GROUP IS A MERGE, and it says so BEFORE it
    // does it — that is what fixes "Minuman" and "minuman" being two tabs, and
    // it is not something to discover afterwards.
    const other = `QA Grp2 ${Date.now()}`;
    await page.locator('#groups-close').click();
    await seedItem(page, `${GROUP_TAG} Susu`, other);
    await page.reload();
    await openItems(page);
    await page.locator('#inventory-groups-btn').click();
    await list.locator(`[data-rename-group="${other}"]`).click();
    await page.locator('[data-group-input]').fill(renamed);
    const save = page.locator('[data-group-save]');
    await save.click();
    await expect(save).toContainText(`Merge into ${renamed}`);
    await save.click();
    await expect(page.locator('#toast-container')).toContainText('moved', { timeout: 30000 });

    await page.locator('#inventory-groups-btn').click();
    await expect(list.locator(`[data-group="${renamed}"]`)).toContainText('3 items');
    await expect(list.locator(`[data-group="${other}"]`)).toHaveCount(0);
});
