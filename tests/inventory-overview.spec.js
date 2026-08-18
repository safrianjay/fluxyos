const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 180_000 });

// The Inventory Overview — the module's new default entry point.
//
// The assertions that matter are about the dashboard being an ENTRY POINT rather
// than a report: every alert has to open the items it is about, and an alert has
// to actually fire. A "needs attention" list that has never fired in a test is
// not evidence that it can.

const TAG = `QA-OVW-${Date.now()}`;

async function gotoOverview(page) {
    await page.goto('/inventory');
    await page.waitForFunction(
        () => !document.querySelector('#inventory-total-value .inv-headline-skeleton'),
        undefined, { timeout: 60000 }
    );
}

test('Overview is the default entry point, and Items is one click away', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await gotoOverview(page);

    // Default tab, without a query string.
    await expect(page.locator('#inv-panel-overview')).toBeVisible();
    await expect(page.locator('#inv-panel-items')).toBeHidden();
    await expect(page.locator('#inv-tab-overview')).toHaveAttribute('aria-selected', 'true');

    // The headline still names the account it must agree with.
    await expect(page.locator('#inventory-total-context')).toContainText('1200 Inventory');
    await expect(page.locator('#inventory-total-value')).toHaveText(/^-?Rp[\d.]+$/);

    // Switching tabs moves the URL, so the view is linkable and reloadable.
    await page.click('#inv-tab-items');
    await expect(page.locator('#inv-panel-items')).toBeVisible();
    await expect(page.locator('#inv-panel-overview')).toBeHidden();
    expect(new URL(page.url()).searchParams.get('tab')).toBe('items');

    // Back must return to Overview — otherwise the URL state is decorative.
    await page.goBack();
    await expect(page.locator('#inv-panel-overview')).toBeVisible();

    // Add Item stays available from both tabs.
    await page.click('#inv-tab-items');
    await expect(page.locator('#new-item-btn')).toBeVisible();

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a real defect fires its alert, and the alert opens the item', async ({ page }) => {
    // Create the condition rather than hoping the workspace already has one:
    // stock on hand with NO cost recorded. Every count on such an item posts zero
    // COGS and silently overstates gross margin, which is exactly why it is
    // surfaced — and an alert that has never fired proves nothing.
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });

    await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const item = await ds.saveItem(uid, {
            name: `${tag} Air Galon`, type: 'stock', base_unit: 'ml',
            reorder_point: 50000
        }, { create: true });
        const dim = await ds.saveDimension(uid, { name: `${tag} Outlet`, type: 'outlet' }, { create: true });
        // Received at ZERO cost — a real thing (a free sample, a supplier error)
        // and the case that quietly breaks costing.
        await ds.createGoodsReceipt(uid, {
            vendor_name: `${tag} Supplier`, dimension_id: dim.id, reference: `${tag}-GR`,
            lines: [{ item_id: item.id, quantity: 19000, amount: 0 }]
        });
    }, { tag: TAG });

    await gotoOverview(page);

    // The alert fired.
    const alert = page.locator('[data-alert="no_cost"]');
    await expect(alert).toBeVisible({ timeout: 30000 });
    await expect(alert.locator('.inv-alert-count')).toHaveText(/^[1-9]/);

    // And it is an ENTRY POINT: clicking opens Items, filtered, chip shown.
    await alert.click();
    await expect(page.locator('#inv-panel-items')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('filter')).toBe('no_cost');
    await expect(page.locator('.inv-filter-chip')).toContainText('No cost recorded');
    await expect(page.locator(`#inventory-body tr:has-text("${TAG} Air Galon")`)).toHaveCount(1);

    // The same item is also below its reorder point (19.000 of 50.000 ml), which
    // proves low stock counts only where a threshold was actually set.
    await page.goto('/inventory?tab=items&filter=low_stock');
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
    );
    await expect(page.locator(`#inventory-body tr:has-text("${TAG} Air Galon")`)).toHaveCount(1);

    // Clearing the chip restores the full list.
    await page.click('#inv-filter-clear');
    await expect(page.locator('.inv-filter-chip')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('filter')).toBeNull();
});

test('a signal with nothing wrong does not render a reassuring zero', async ({ page }) => {
    await gotoOverview(page);
    // Rows appear only when their count is non-zero. Four cards reading "0" is
    // the cloned-grid pattern DESIGN_SYSTEM bans, and it buries the one row that
    // matters. Whatever is clean must be absent, not present-and-empty.
    const counts = await page.locator('#inv-alerts .inv-alert-count').allTextContents();
    expect(counts.every((c) => Number(c.replace(/\D/g, '')) > 0),
        `every rendered alert must have a non-zero count, got: ${counts.join(', ')}`).toBe(true);
});

test('recent activity links each row to the journal that posted it', async ({ page }) => {
    await gotoOverview(page);
    await expect(page.locator('#receipts-card')).toBeVisible({ timeout: 30000 });

    // NOT every movement carries a journal: a zero-value receipt has nothing to
    // post, so its rows are deliberately inert and carry no data-journal. Assert
    // on the linkable ones — and that at least one exists, or the feature is
    // decorative.
    const linkable = page.locator('#receipts-body tr[data-journal]');
    await expect(linkable.first()).toBeVisible({ timeout: 30000 });

    // This link IS the inventory→finance connection, so it has to actually go
    // somewhere — a dead href would make the whole claim decorative.
    await linkable.first().click();
    await page.waitForURL(/accounting-journal\.html\?id=/, { timeout: 30000 });
});

test('the Overview holds together at 375px and 1280px', async ({ page }) => {
    for (const [label, width, height] of [['mobile', 375, 812], ['tablet', 768, 1024], ['desktop', 1280, 900]]) {
        await page.setViewportSize({ width, height });
        await gotoOverview(page);

        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth
        }));
        expect(overflow.scrollWidth, `${label}: page scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth);

        await expect(page.locator('#inv-tab-overview')).toBeVisible();
        await expect(page.locator('#inv-tab-items')).toBeVisible();
        // The title must not be squeezed out by the topbar actions.
        const titleW = await page.locator('.dashboard-topbar-title')
            .evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(titleW, `${label}: page title collapsed`).toBeGreaterThan(40);
    }
});
