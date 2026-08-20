const { test, expect } = require('@playwright/test');

// These specs run serially against REAL Firebase, and the QA workspace has grown
// large enough (49 items, 20+ outlets, 70+ movements) that page boot alone can
// take tens of seconds under full-suite contention. The default 60s per-test
// budget is what makes this file flake when it runs after the others rather than
// alone — see the "slow runs = contention" note in the QA docs.
test.describe.configure({ timeout: 150_000 });

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

// Overview is the default tab now, so anything driving the ITEM TABLE asks for
// it explicitly. ?tab=items is the documented deep-link, so this exercises it.
async function gotoInventory(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])')
            && !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
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

    // Drawer closes and the row is ON THE VISIBLE PAGE.
    //
    // This assertion is load-bearing, not incidental: the table paginates at 10
    // and the master list is sorted by name, so a new item routinely belongs on
    // a page the user is not looking at. Before revealItem() the save appeared to
    // do nothing. The locator only matches rendered rows, so it fails if the row
    // exists but sits on another page.
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

test('empty states never offer an action the page cannot perform', async ({ page }) => {
    await gotoInventory(page);

    // Searching for nothing is not an invitation to create a transaction. This
    // shipped as an orange "Add Record" wired to the generic income/expense
    // drawer, because renderEmptyState defaulted to one when a caller passed
    // only a title — see DESIGN_SYSTEM.md 3c.
    await page.fill('#inventory-search', 'zzz-no-such-item-zzz');
    const itemsEmpty = page.locator('#inventory-empty-state');
    await expect(itemsEmpty).toContainText('No item matches that');
    await expect(itemsEmpty).not.toContainText('Add Record');

    // What it offers instead actually resolves the state the user is in.
    await itemsEmpty.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.locator('#inventory-search')).toHaveValue('');
    await expect(page.locator('#inventory-body tr').first()).toBeVisible();

    // ── Restock: the tab where this was reported ─────────────────────────────
    await page.click('[data-inv-tab="restock"]');
    await expect(page.locator('#inv-panel-restock')).not.toHaveClass(/hidden/);

    await page.fill('#restock-search', 'zzz-no-such-item-zzz');
    const restockEmpty = page.locator('#restock-empty-state');
    await expect(restockEmpty).toContainText('No item matches that');
    await expect(restockEmpty).not.toContainText('Add Record');
    await restockEmpty.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.locator('#restock-search')).toHaveValue('');

    // And with the search cleared, whatever state Restock lands in must never
    // offer to log a transaction: restocking happens through Receive stock when
    // the goods arrive, so there is no honest "add" on this surface.
    await expect(restockEmpty).not.toContainText('Add Record');
});

test('a quantity typed into the stock-unit field is refused', async ({ page }) => {
    await gotoInventory(page);
    await page.click('#new-item-btn');
    await page.fill('#item-name', `${TAG} Salah Unit`);

    // The exact mistake that produced "System: 2.394 1000" on the count sheet:
    // the conversion factor typed into Stock unit. base_unit is immutable, so an
    // item created this way can never be fixed — only this moment can catch it.
    await page.fill('#item-base-unit', '1000');
    await page.click('#item-save-btn');

    const err = page.locator('#item-form-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('looks like a quantity, not a unit');
    // And it points at where the number actually belongs.
    await expect(err).toContainText('Purchase unit');

    // A real unit saves fine — the guard must not block ordinary work.
    await page.fill('#item-base-unit', 'g');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 20000 });
});

test('stock can be received through the page, in the unit it was bought in', async ({ page }) => {
    await gotoInventory(page);

    // Create the item this test will receive into, so the spec owns its data.
    await page.click('#new-item-btn');
    await page.fill('#item-name', `${TAG} Gula`);
    await page.fill('#item-base-unit', 'g');
    await page.fill('#item-purchase-unit', 'kg');
    await page.fill('#item-purchase-factor', '1000');
    await page.click('#item-save-btn');
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 20000 });

    const valueBefore = await page.locator('#inv-kpis .inv-metric-value').first().textContent();

    await page.click('#receive-stock-btn');
    await expect(page.locator('#receipt-drawer')).not.toHaveClass(/translate-x-full/);
    await expect(page.locator('#receipt-save-btn')).toBeDisabled();

    // Pick the item, then buy in KILOS while the item is held in GRAMS. This is
    // the whole point of the purchase unit, and the conversion must be the
    // engine's, not the page's.
    const line = page.locator('#receipt-lines .inv-line').first();
    await line.locator('[data-field="item"]').selectOption({ label: `${TAG} Gula` });
    await line.locator('[data-field="unit"]').selectOption('kg');
    await line.locator('[data-field="qty"]').fill('25');
    await line.locator('[data-field="amount"]').fill('300000');

    // Amount input carries Indonesian separators; the stored value is an integer.
    await expect(line.locator('[data-field="amount"]')).toHaveValue('300.000');
    // 25 kg resolves to 25.000 g at Rp12/g — shown BEFORE committing, so a wrong
    // conversion factor is caught here rather than inside a COGS figure later.
    await expect(line.locator('[data-field="derived"]')).toHaveText('25.000 g · Rp12 per g');
    await expect(page.locator('#receipt-total')).toHaveText('Rp300.000');
    await expect(page.locator('#receipt-save-btn')).toBeEnabled();

    await page.fill('#receipt-vendor', 'QA Sumber Pangan');
    await page.click('#receipt-save-btn');
    await expect(page.locator('#receipt-drawer')).toHaveClass(/translate-x-full/, { timeout: 25000 });

    // The item now carries stock, in base units.
    const row = page.locator(`#inventory-body tr:has-text("${TAG} Gula")`);
    await expect(row).toContainText('25.000');
    await expect(row).toContainText('Rp300.000');
    await expect(row).not.toContainText('Not stocked yet');

    // The headline moved, and the delivery shows on the Overview's activity feed
    // (which replaced the old deliveries strip and links each row to its journal).
    await expect(page.locator('#inv-kpis .inv-metric-value').first()).not.toHaveText(valueBefore);
    await page.click('[data-inv-tab="overview"]');
    await expect(page.locator('#receipts-card')).toBeVisible();
    await expect(page.locator('#receipts-body')).toContainText('Stock received');
    await expect(page.locator('#receipts-body tr').first()).toHaveAttribute('data-journal', /.+/);
});

test('a quantity that is not a whole number of stock units is refused, not rounded', async ({ page }) => {
    await gotoInventory(page);
    await page.click('#receive-stock-btn');

    const line = page.locator('#receipt-lines .inv-line').first();
    await line.locator('[data-field="item"]').selectOption({ label: `${TAG} Gula` });
    // 0,0005 kg is half a gram. Rounding it would be invisible and would land in
    // a journal amount, so the engine rejects it and the page must say so.
    await line.locator('[data-field="unit"]').selectOption('kg');
    await line.locator('[data-field="qty"]').fill('0.0005');
    await line.locator('[data-field="amount"]').fill('1000');

    await expect(line.locator('[data-field="derived"]')).toContainText('not a whole number of g');
    await expect(page.locator('#receipt-save-btn')).toBeDisabled();
    await page.click('#receipt-cancel-btn');
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
