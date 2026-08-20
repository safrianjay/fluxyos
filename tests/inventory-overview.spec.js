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
        () => document.querySelectorAll('#inv-kpis .kpi-detail-cell:not([data-skeleton])').length === 4,
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

    // The strip still names the account the value must agree with, and money is
    // Rp with dot separators and NO space (DESIGN_SYSTEM, strict).
    await expect(page.locator('#inv-kpis')).toContainText('1200 Inventory');
    await expect(page.locator('#inv-kpis .inv-metric-value').first()).toHaveText(/^-?Rp[\d.]+$/);

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

    // The alert fired, as a compact chip rather than a card.
    const alert = page.locator('[data-alert="no_cost"]');
    await expect(alert).toBeVisible({ timeout: 30000 });
    await expect(alert.locator('.inv-chip-count')).toHaveText(/^[1-9]/);

    // And it is an ENTRY POINT: clicking opens Items, filtered, chip shown.
    await alert.click();
    await expect(page.locator('#inv-panel-items')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('filter')).toBe('no_cost');
    await expect(page.locator('.inv-filter-chip')).toContainText('No cost recorded');

    // The filtered list paginates at 10 like any other, so an aggregate alert
    // lands the user on page 1 of the matches — not necessarily on this spec's
    // item. Narrowing with search is the intended combination (filter first,
    // then search WITHIN it) and is what proves the item really is in the set.
    await page.fill('#inventory-search', TAG);
    await expect(page.locator(`#inventory-body tr:has-text("${TAG} Air Galon")`)).toHaveCount(1);
    await page.fill('#inventory-search', '');

    // The same item is also below its reorder point (19.000 of 50.000 ml), which
    // proves low stock counts only where a threshold was actually set.
    await page.goto('/inventory?tab=items&filter=low_stock');
    await page.waitForFunction(
        () => !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
    );
    await page.fill('#inventory-search', TAG);
    await expect(page.locator(`#inventory-body tr:has-text("${TAG} Air Galon")`)).toHaveCount(1);
    await page.fill('#inventory-search', '');

    // Clearing the chip restores the full list.
    await page.click('#inv-filter-clear');
    await expect(page.locator('.inv-filter-chip')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('filter')).toBeNull();
});

test('the attention strip only exists when something is wrong', async ({ page }) => {
    await gotoOverview(page);

    // Every chip that renders must carry a real count — a "0 out of stock" chip
    // is weight spent on the absence of news.
    const counts = await page.locator('#inv-alerts .inv-chip-count').allTextContents();
    expect(counts.every((c) => Number(c.replace(/\D/g, '')) > 0),
        `every chip must have a non-zero count, got: ${counts.join(', ')}`).toBe(true);

    // And with nothing wrong the WHOLE strip is gone — not an empty card, not a
    // placeholder. Proven by emptying the signal set the page reads.
    await page.addInitScript(() => {
        window.__invForceClean = true;
    });
    await page.goto('/inventory');
    await page.waitForFunction(
        () => document.querySelectorAll('#inv-kpis .kpi-detail-cell:not([data-skeleton])').length === 4,
        undefined, { timeout: 60000 }
    );
    const hiddenWhenClean = await page.evaluate(() => {
        const host = document.getElementById('inv-alerts');
        // Re-render with no rows at all: the strip must hide itself.
        window.__invRenderAlerts([]);
        return host.classList.contains('hidden') && host.innerHTML === '';
    });
    expect(hiddenWhenClean, 'with nothing wrong the attention strip must not exist at all').toBe(true);
});

test('recent activity links each row to the journal that posted it', async ({ page }) => {
    await gotoOverview(page);
    await expect(page.locator('#receipts-card')).toBeVisible({ timeout: 30000 });

    // NOT every movement carries a journal: a zero-value receipt has nothing to
    // post, so its rows are deliberately inert and carry no data-journal. Assert
    // on the linkable ones — and that at least one exists, or the feature is
    // decorative.
    // Header and body must agree on the column count — a mismatch silently
    // shunts every value into the wrong column, which reads as plausible data.
    const headCols = await page.locator('#receipts-card thead th').count();
    const bodyCols = await page.locator('#receipts-body tr').first().locator('td').count();
    expect(bodyCols, 'activity rows must match the header column count').toBe(headCols);

    const linkable = page.locator('#receipts-body tr[data-journal]');
    await expect(linkable.first()).toBeVisible({ timeout: 30000 });

    // This link IS the inventory→finance connection, so it has to actually go
    // somewhere — a dead href would make the whole claim decorative.
    await linkable.first().click();
    await page.waitForURL(/accounting-journal\.html\?id=/, { timeout: 30000 });
});

test('the page shimmers while it loads, and nothing jumps when data lands', async ({ page }) => {
    // Throttled so the loading state is observable rather than a single frame.
    await page.route('**/firestore.googleapis.com/**', async (route) => {
        await new Promise((r) => setTimeout(r, 700));
        await route.continue();
    });

    await page.goto('/inventory');

    // Placeholders of roughly the final shape, on every surface that will hold
    // data — not a spinner, and not a blank page.
    await page.waitForSelector('#inv-kpis [data-skeleton]', { timeout: 30000 });
    expect(await page.locator('#inv-kpis [data-skeleton]').count()).toBe(4);
    await expect(page.locator('#inv-month [data-skeleton]').first()).toBeVisible();
    await expect(page.locator('#inv-trend [data-skeleton]')).toBeVisible();
    await expect(page.locator('#receipts-body tr[data-skeleton]').first()).toBeVisible();

    // The activity and outlet cards are revealed for the placeholder, so the page
    // does not grow by two cards the moment the read lands.
    await expect(page.locator('#receipts-card')).toBeVisible();
    await expect(page.locator('#inv-outlets-card')).toBeVisible();

    // Shimmer rows carry the table's REAL column count — a mismatched
    // placeholder widens the table and everything shifts when data arrives.
    const headCols = await page.locator('#receipts-card thead th').count();
    const skelCols = await page.locator('#receipts-body tr[data-skeleton]').first().locator('td').count();
    expect(skelCols, 'shimmer must match the header column count').toBe(headCols);

    // And every placeholder is gone once the data is in.
    await page.waitForFunction(
        () => document.querySelectorAll('#inv-kpis .kpi-detail-cell:not([data-skeleton])').length === 4,
        undefined, { timeout: 60000 }
    );
    expect(await page.locator('#inv-panel-overview [data-skeleton]').count(),
        'no placeholder may survive the load').toBe(0);
});

test('the Overview holds together at 375px and 1280px', async ({ page }) => {
    for (const [label, width, height] of [['mobile', 375, 812], ['tablet', 768, 1024], ['desktop', 1280, 900]]) {
        await page.setViewportSize({ width, height });
        await gotoOverview(page);
        // Settle before measuring: a viewport change plus a navigation can report
        // a stale scrollWidth for a frame. A REAL overflow survives this wait; a
        // transient one does not, so the assertion still bites.
        await page.waitForTimeout(300);

        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth
        }));
        expect(overflow.scrollWidth, `${label}: page scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth);

        await expect(page.locator('#inv-tab-overview')).toBeVisible();
        await expect(page.locator('#inv-tab-items')).toBeVisible();
        // The title must not be squeezed out by the topbar actions — and it must
        // fit its own text, not be silently clipped to "Invent…".
        const title = await page.locator('.dashboard-topbar-title').evaluate((el) => ({
            width: Math.round(el.getBoundingClientRect().width),
            clipped: el.scrollWidth > el.clientWidth + 1
        }));
        expect(title.width, `${label}: page title collapsed`).toBeGreaterThan(40);
        expect(title.clipped, `${label}: page title is clipped`).toBe(false);
    }
});
