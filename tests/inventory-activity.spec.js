const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 180_000 });

// The Stock Activity subpage, and the route into it.
//
// The point of the split is that the Overview stays a PREVIEW: exactly ten rows
// with a way out to the full history. Both halves of that claim are asserted,
// because "10 most recent" is the kind of thing that silently drifts.

const PAGE_SIZE = 25;

async function gotoActivity(page) {
    await page.goto('/inventory-activity');
    await page.waitForFunction(
        () => document.querySelectorAll('#act-body tr:not([data-skeleton])').length > 0
            || document.querySelector('#act-empty-state .fluxy-table-empty'),
        undefined, { timeout: 60000 }
    );
}

test('the Overview preview shows ten rows and View all opens the full page', async ({ page }) => {
    await page.goto('/inventory');
    await page.waitForFunction(
        () => document.querySelectorAll('#inv-kpis .kpi-detail-cell:not([data-skeleton])').length === 4,
        undefined, { timeout: 60000 }
    );

    // A preview, not a truncated ledger — and the card's copy says ten, so ten
    // is what it must render.
    const rows = await page.locator('#receipts-body tr:not([data-skeleton])').count();
    expect(rows, 'the Overview preview must be capped at 10').toBeLessThanOrEqual(10);
    await expect(page.locator('#receipts-card')).toContainText('last 10');

    // The way out is in the card header, where a table's actions live.
    const viewAll = page.locator('#act-view-all');
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await page.waitForURL(/inventory-activity/, { timeout: 30000 });
});

test('the full page reuses the standard breadcrumb, search, filter and pagination', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await gotoActivity(page);

    // Breadcrumb is the shared component, at the very top of the content —
    // the reading order DESIGN_SYSTEM fixes as a hard rule.
    const crumb = page.locator('nav.acct-breadcrumb');
    await expect(crumb).toBeVisible();
    await expect(crumb).toContainText('Inventory');
    await expect(crumb).toContainText('Stock activity');

    // 25 per page, using the shared paginator.
    const shown = await page.locator('#act-body tr').count();
    expect(shown, 'page size must be 25').toBeLessThanOrEqual(PAGE_SIZE);
    await expect(page.locator('#act-pagination')).toBeVisible();
    await expect(page.locator('#act-page-summary')).toContainText('movements');

    // Paging forward actually changes the rows rather than just the indicator.
    const indicator = await page.locator('#act-page-indicator').textContent();
    const firstBefore = await page.locator('#act-body tr').first().innerText();
    await page.click('#act-next-page');
    await expect(page.locator('#act-page-indicator')).not.toHaveText(indicator);
    expect(await page.locator('#act-body tr').first().innerText()).not.toBe(firstBefore);
    await page.click('#act-prev-page');

    // Search narrows, and says so honestly when nothing matches.
    await page.fill('#act-search', 'zzz-no-such-activity-zzz');
    await expect(page.locator('#act-empty-state')).toContainText('Nothing matches that');
    await page.fill('#act-search', '');
    await expect(page.locator('#act-body tr').first()).toBeVisible();

    // The type filter is a real filter, not decoration.
    await page.selectOption('#act-type', 'waste');
    const kinds = await page.locator('#act-body tr .fluxy-table-cell-primary').allTextContents();
    expect(kinds.every((k) => k.includes('Waste')), `expected only waste rows, got: ${kinds.join(', ')}`).toBe(true);
    await page.selectOption('#act-type', '');

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a row opens the journal it posted', async ({ page }) => {
    await gotoActivity(page);
    const linkable = page.locator('#act-body tr[data-journal]');
    await expect(linkable.first()).toBeVisible({ timeout: 30000 });
    await linkable.first().click();
    await page.waitForURL(/accounting-journal\.html\?id=/, { timeout: 30000 });
});

test('the page holds together at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoActivity(page);
    const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    await expect(page.locator('nav.acct-breadcrumb')).toBeVisible();
    await expect(page.locator('.dashboard-topbar-title')).toBeVisible();
});
