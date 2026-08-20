const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 180_000 });

// The Restock tab.
//
// The brief's complaint was that the numbers needed interpreting. So the
// assertions are about MEANING, not layout: the recommendation has to state what
// it is and what it is for, status has to be readable without colour, and an
// item the system cannot judge has to be excluded and said so — not guessed at.

const TAG = `QA-RST-${Date.now()}`;
const ITEM = `${TAG} Kacang`;
const SUPPLIER = `${TAG} Sumber Pangan`;

async function seed(page) {
    await page.goto('/inventory?tab=items', { timeout: 60000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });
    return page.evaluate(async ({ tag, item, supplier }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        // Reorder point 40.000 g, receive 12.000 g at Rp10/g -> recommended 28.000,
        // which is the brief's own 12 / 40 / 28 example at scale.
        const created = await ds.saveItem(uid, {
            name: item, type: 'stock', base_unit: 'g', sku: `${tag}-SKU`, reorder_point: 40000
        }, { create: true });
        const dim = await ds.saveDimension(uid, { name: `${tag} Outlet`, type: 'outlet' }, { create: true });
        await ds.createGoodsReceipt(uid, {
            vendor_name: supplier, dimension_id: dim.id, reference: `${tag}-GR`,
            lines: [{ item_id: created.id, quantity: 12000, amount: 120000 }]
        });
        return { itemId: created.id };
    }, { tag: TAG, item: ITEM, supplier: SUPPLIER });
}

async function gotoRestock(page) {
    await page.goto('/inventory?tab=restock', { timeout: 60000 });
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-restock').classList.contains('hidden')
            && (document.querySelector('#restock-body tr') || document.querySelector('#restock-empty-state .fluxy-table-empty')),
        undefined, { timeout: 60000 }
    );
}

test('the recommendation states what it is and what it is for', async ({ page }) => {
    await seed(page);
    await gotoRestock(page);
    await page.fill('#restock-search', TAG);

    const row = page.locator(`#restock-body tr:has-text("${ITEM}")`);
    await expect(row).toHaveCount(1);

    // The three numbers the brief called confusing, each in a labelled column.
    await expect(row).toContainText('12.000');   // current stock
    await expect(row).toContainText('40.000');   // reorder point
    // And the recommendation says the RELATIONSHIP, not a bare figure.
    await expect(row.locator('.rst-rec-qty')).toHaveText('+28.000 g');
    await expect(row.locator('.rst-rec-why')).toHaveText('to reach 40.000 g');

    // Status is readable without colour.
    await expect(row.locator('.fluxy-table-status')).toHaveText('Low stock');

    // Supplier and cost are derived from real records, not invented: the vendor
    // who last delivered it, and 28.000 g at the Rp10/g actually paid. They share
    // a column because they are one decision — who to order from, for how much.
    await expect(row).toContainText(SUPPLIER);
    await expect(row).toContainText('about Rp280.000');

    // Every column the table promises is actually rendered on the row.
    const headCols = await page.locator('#restock-table-container thead th').count();
    const bodyCols = await row.locator('td').count();
    expect(bodyCols, 'row must match the header column count').toBe(headCols);

    // SKU rides along, as the brief asked.
    await expect(row).toContainText(`${TAG}-SKU`);
});

test('items with no reorder point are excluded, and the page says why', async ({ page }) => {
    await gotoRestock(page);

    // The QA workspace is full of items without a reorder point. They must not
    // appear in the list — a recommendation for them would be invented — and the
    // page has to account for them rather than leaving them silently missing.
    const note = page.locator('#inv-restock-unassessable');
    await expect(note).toBeVisible();
    await expect(note).toContainText('no reorder point');
    await expect(note).toContainText('Items');

    // The KPI strip counts them too, so the number is never unexplained.
    await expect(page.locator('#inv-restock-kpis')).toContainText('Not assessed');
});

test('selecting items builds a sendable order list, grouped by supplier', async ({ page }) => {
    await gotoRestock(page);
    await page.fill('#restock-search', TAG);

    // No selection, no bar — it must not hover over an empty decision.
    await expect(page.locator('#restock-bar')).toBeHidden();

    await page.locator(`#restock-body tr:has-text("${ITEM}") [data-restock-pick]`).check();
    await expect(page.locator('#restock-bar')).toBeVisible();
    await expect(page.locator('#restock-bar-count')).toHaveText('1 item to order');
    await expect(page.locator('#restock-bar-cost')).toContainText('Rp280.000');

    // The list is grouped by supplier, because that is how it gets sent.
    const text = await page.evaluate(() => window.__invBuildOrderList());
    expect(text).toContain(SUPPLIER);
    expect(text).toContain('28.000 g');
    expect(text.indexOf(SUPPLIER)).toBeLessThan(text.indexOf('28.000 g'));

    await page.click('#restock-clear');
    await expect(page.locator('#restock-bar')).toBeHidden();
});

test('the tab is reachable by URL and from the Overview', async ({ page }) => {
    await page.goto('/inventory', { timeout: 60000 });
    await page.waitForFunction(
        () => document.querySelectorAll('#inv-kpis .kpi-detail-cell:not([data-skeleton])').length === 4,
        undefined, { timeout: 60000 }
    );

    // "at or below reorder point" now lands on Restock — where the answer is —
    // rather than on a filtered item list that only restates the question.
    const chip = page.locator('#inv-alerts [data-alert="low_stock"]');
    if (await chip.count()) {
        await chip.click();
        await expect(page.locator('#inv-panel-restock')).toBeVisible();
        expect(new URL(page.url()).searchParams.get('tab')).toBe('restock');
    }

    // And the URL alone gets you there, so it is linkable and reloadable.
    await gotoRestock(page);
    await expect(page.locator('#inv-tab-restock')).toHaveAttribute('aria-selected', 'true');
});

test('Restock holds together at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoRestock(page);
    const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth, 'the page itself must not scroll sideways').toBeLessThanOrEqual(overflow.clientWidth);
    await expect(page.locator('#inv-tab-restock')).toBeVisible();
});
