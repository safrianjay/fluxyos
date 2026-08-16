const { test, expect } = require('@playwright/test');

// The Inventory page, driven the way a user drives it.
//
// tests/inventory-cogs.spec.js already proves the kernel — receive, waste,
// count, outlet P&L — by calling DataService directly. It says nothing about
// whether any of that is reachable. This spec only ever touches the DOM:
// if it passes, a person with a browser can do the same thing.
//
// Items cannot be deleted (`allow delete: if false` — they get referenced by
// immutable stock movements and journal lines), so the item this creates is
// tagged and left behind, same convention as the COGS spec.

const TAG = `QA-UI-${Date.now()}`;

async function gotoInventory(page) {
    await page.goto('/inventory');
    // The table only renders after auth + workspace resolution + the first read.
    await expect(page.locator('#inventory-total-value')).not.toContainText('…', { timeout: 30000 });
    await page.waitForFunction(
        () => !document.querySelector('#inventory-total-value .inv-headline-skeleton'),
        { timeout: 30000 }
    );
}

test('an item can be created from the page and shows up in the table', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // login.html's sendOobCode always 400s in this harness; unrelated here.
        if (/sendOobCode|favicon/i.test(text)) return;
        consoleErrors.push(text);
    });
    page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));

    await gotoInventory(page);

    // The headline states the tie to the control account rather than a bare total.
    await expect(page.locator('#inventory-total-context')).toContainText('1200 Inventory');
    // Rp with dot separators and NO space after Rp (DESIGN_SYSTEM, strict).
    await expect(page.locator('#inventory-total-value')).toHaveText(/^-?Rp[\d.]+$/);

    // ── Create an item through the drawer ────────────────────────────────────
    await page.click('#new-item-btn');
    await expect(page.locator('#item-drawer')).not.toHaveClass(/translate-x-full/);

    // Save is disabled until the two fields that cannot be defaulted are present.
    await expect(page.locator('#item-save-btn')).toBeDisabled();

    await page.fill('#item-name', `${TAG} Tepung`);
    await page.fill('#item-base-unit', 'g');
    await expect(page.locator('#item-save-btn')).toBeEnabled();

    await page.fill('#item-purchase-unit', 'kg');
    await page.fill('#item-purchase-factor', '1000');
    // The conversion is echoed back in the user's own words before they commit,
    // so a wrong factor is caught here rather than inside a stock quantity later.
    await expect(page.locator('#item-purchase-preview')).toHaveText('1 kg = 1.000 g');

    await page.fill('#item-shelf', 'Dry store — shelf A');
    await page.click('#item-save-btn');

    // Drawer closes and the row is on the page.
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 20000 });
    const row = page.locator(`#inventory-body tr:has-text("${TAG} Tepung")`);
    await expect(row).toHaveCount(1);

    // A brand-new item has no movements. That is NOT the same as counted-to-zero,
    // and the table must not claim a quantity it has never been given.
    await expect(row).toContainText('Not stocked yet');
    // The shelf rides along as row meta — it is what orders the count sheet.
    await expect(row).toContainText('Dry store — shelf A');

    // ── Reopening the row loads the item for editing ─────────────────────────
    await row.click();
    await expect(page.locator('#item-drawer-title')).toHaveText('Edit item');
    await expect(page.locator('#item-name')).toHaveValue(`${TAG} Tepung`);
    await expect(page.locator('#item-purchase-unit')).toHaveValue('kg');
    // base_unit is immutable: every recorded quantity is an integer count of it.
    await expect(page.locator('#item-base-unit')).toBeDisabled();
    await page.click('#item-cancel-btn');

    // ── Search filters, and says so honestly when nothing matches ────────────
    await page.fill('#inventory-search', TAG);
    await expect(page.locator('#inventory-body tr')).toHaveCount(1);
    await page.fill('#inventory-search', 'zzz-no-such-item-zzz');
    await expect(page.locator('#inventory-empty-state')).toContainText('No item matches that');
    await page.fill('#inventory-search', '');

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

// The off-canvas sidebar is SHARED behaviour (shared-dashboard.css +
// sidebar-loader.js), so it is guarded here on a page that is not inventory.
// Before this, every app page rendered the `md:hidden` hamburger with nothing
// listening to it, and the 220px sidebar simply ate 59% of a 375px viewport.
test('below 640px the sidebar is a dismissable drawer, on every app page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/bill');
    await page.waitForTimeout(3000);

    const sidebar = page.locator('#sidebar');
    const menuBtn = page.locator('header button.md\\:hidden');

    // Closed by default, and out of flow so the page gets its full width.
    await expect(sidebar).not.toHaveClass(/sidebar-mobile-open/);
    expect(await sidebar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');

    await menuBtn.click();
    await expect(sidebar).toHaveClass(/sidebar-mobile-open/);
    await expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.sidebar-mobile-backdrop')).toHaveClass(/is-visible/);

    // Escape closes it, and the body scroll lock is released with it — leaving
    // that behind would freeze the page under a closed drawer.
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/sidebar-mobile-open/);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    // Above the breakpoint the sidebar is back in flow and the drawer is inert.
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await sidebar.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
    await expect(sidebar).toBeVisible();
});

test('the page holds together at 375px and 1280px', async ({ page }) => {
    for (const [label, width, height] of [['mobile', 375, 812], ['desktop', 1280, 800]]) {
        await page.setViewportSize({ width, height });
        await gotoInventory(page);

        // The page body must never scroll sideways. A wide table scrolls inside
        // .fluxy-table-scroll; if it ever reaches the page wrapper instead, the
        // sidebar appears to overlap the content (DESIGN_SYSTEM §4a bug class).
        const overflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth
        }));
        expect(overflow.scrollWidth, `${label}: page scrolls horizontally`).toBeLessThanOrEqual(overflow.clientWidth);

        // Title and the primary action survive at both sizes — the subtitle is
        // the only thing allowed to drop.
        await expect(page.locator('.dashboard-topbar-title')).toBeVisible();
        await expect(page.locator('#new-item-btn')).toBeVisible();

        // The drawer is usable, not clipped, on a phone.
        await page.click('#new-item-btn');
        await expect(page.locator('#item-name')).toBeVisible();
        const box = await page.locator('#item-drawer').boundingBox();
        expect(box.width, `${label}: drawer wider than viewport`).toBeLessThanOrEqual(width);
        await page.click('#item-cancel-btn');
    }
});
