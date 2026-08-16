const { test, expect } = require('@playwright/test');

// These specs run serially against REAL Firebase, and the QA workspace has grown
// large enough (49 items, 20+ outlets, 70+ movements) that page boot alone can
// take tens of seconds under full-suite contention. The default 60s per-test
// budget is what makes this file flake when it runs after the others rather than
// alone — see the "slow runs = contention" note in the QA docs.
test.describe.configure({ timeout: 150_000 });

// The count sheet, driven through the DOM.
//
// The assertions that matter are the ones a screenshot cannot make:
//   - a blank input is SKIPPED, never treated as counted-to-zero
//   - the sheet is ordered by shelf, not alphabetically
//   - a draft survives a reload
//   - stock moving mid-count is refused, not silently booked as consumption
//
// Items cannot be deleted (immutable movements reference them), so this spec
// tags what it creates and leaves it, same convention as the other inventory
// specs.

const TAG = `QA-CNT-${Date.now()}`;

// Two items, deliberately named so that ALPHABETICAL and BY-SHELF order differ.
// "Aaa" sits on shelf B, "Zzz" on shelf A — so shelf order is Zzz then Aaa.
const ITEM_A = `${TAG} Aaa Beras`;   // shelf B
const ITEM_Z = `${TAG} Zzz Garam`;   // shelf A

async function seed(page) {
    await page.goto('/inventory');
    await page.waitForFunction(
        () => !document.querySelector('#inventory-total-value .inv-headline-skeleton'),
        undefined, { timeout: 60000 }
    );

    for (const [name, shelf] of [[ITEM_A, `${TAG} Shelf B`], [ITEM_Z, `${TAG} Shelf A`]]) {
        await page.click('#new-item-btn');
        await page.fill('#item-name', name);
        await page.fill('#item-base-unit', 'g');
        await page.fill('#item-shelf', shelf);
        await page.click('#item-save-btn');
        await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/, { timeout: 20000 });
    }

    // Receive stock into a dedicated outlet so this run cannot collide with
    // another spec's data.
    await page.click('#receive-stock-btn');
    await page.selectOption('#receipt-outlet', { value: '__add__' });
    await page.fill('#receipt-new-outlet-name', `${TAG} Outlet`);
    await page.click('#receipt-new-outlet-save');
    await expect(page.locator('#receipt-new-outlet')).toBeHidden({ timeout: 15000 });

    const rows = [[ITEM_A, '1000', '20000'], [ITEM_Z, '500', '5000']];
    for (let i = 0; i < rows.length; i++) {
        if (i > 0) await page.click('#receipt-add-line');
        const line = page.locator('#receipt-lines .inv-line').nth(i);
        await line.locator('[data-field="item"]').selectOption({ label: rows[i][0] });
        await line.locator('[data-field="qty"]').fill(rows[i][1]);
        await line.locator('[data-field="amount"]').fill(rows[i][2]);
    }
    await page.click('#receipt-save-btn');
    await expect(page.locator('#receipt-drawer')).toHaveClass(/translate-x-full/, { timeout: 25000 });
}

async function gotoCount(page) {
    await page.goto('/inventory-count');
    await page.waitForFunction(
        () => document.querySelectorAll('#count-list .cnt-row').length > 0,
        undefined, { timeout: 60000 }
    );
    await page.selectOption('#count-outlet', { label: `${TAG} Outlet` });
    await page.waitForTimeout(300);
}

test('counting posts consumption, and a blank line is skipped rather than zeroed', async ({ page }) => {
    await seed(page);
    await gotoCount(page);

    // Ordered by SHELF, not by name. Shelf A holds Zzz, shelf B holds Aaa, so
    // the alphabetically-last item comes first. This is the whole reason
    // storage_location exists.
    const names = await page.locator('#count-list .cnt-row-name').allTextContents();
    const mine = names.filter((n) => n.includes(TAG));
    expect(mine[0]).toContain('Zzz');
    expect(mine[1]).toContain('Aaa');

    const rowA = page.locator(`.cnt-row:has-text("${ITEM_A}")`);
    const rowZ = page.locator(`.cnt-row:has-text("${ITEM_Z}")`);
    await expect(rowA.locator('.cnt-row-system')).toHaveText('System: 1.000 g');

    // Count ONE item short and leave the other blank entirely.
    await rowA.locator('[data-field="counted"]').fill('850');
    await expect(rowA.locator('[data-field="variance"]')).toHaveText('-150 g · -Rp3.000');
    await expect(rowZ.locator('[data-field="variance"]')).toHaveText('');

    // Progress counts the sheet, not the filtered view.
    await expect(page.locator('#count-progress-label')).toContainText('counted');
    await expect(page.locator('#count-total-value')).toHaveText('-Rp3.000');
    await expect(page.locator('#count-total-note')).toContainText('5100');

    await page.click('#count-post-btn');
    await expect(page.locator('#count-total-note')).toHaveText('Nothing to post yet', { timeout: 25000 });

    // The counted item moved to what was physically there. The BLANK one is
    // untouched — treating blank as zero would have written off all 500 g.
    await expect(rowA.locator('.cnt-row-system')).toHaveText('System: 850 g');
    await expect(rowZ.locator('.cnt-row-system')).toHaveText('System: 500 g');
});

test('an in-progress count survives a reload', async ({ page }) => {
    await gotoCount(page);
    const rowZ = page.locator(`.cnt-row:has-text("${ITEM_Z}")`);
    await rowZ.locator('[data-field="counted"]').fill('480');
    await expect(rowZ.locator('[data-field="variance"]')).toContainText('-20 g');

    // A real count takes twenty minutes on a phone; losing it to a reload or a
    // dropped connection is not acceptable.
    await page.reload();
    await page.waitForFunction(
        () => document.querySelectorAll('#count-list .cnt-row').length > 0,
        undefined, { timeout: 60000 }
    );
    await page.selectOption('#count-outlet', { label: `${TAG} Outlet` });
    await expect(page.locator(`.cnt-row:has-text("${ITEM_Z}") [data-field="counted"]`)).toHaveValue('480');
});

test('stock moving mid-count is refused, not booked as consumption', async ({ page }) => {
    await gotoCount(page);

    const rowZ = page.locator(`.cnt-row:has-text("${ITEM_Z}")`);
    await rowZ.locator('[data-field="counted"]').fill('400');
    await expect(rowZ.locator('[data-field="variance"]')).toContainText('-100 g');

    // Now move the stock underneath the open sheet, exactly as a delivery landing
    // mid-count would. Without the guard the variance would be measured against a
    // system quantity this counter never saw: they counted 400 g against 500 g,
    // but by post time the system says 700 g, so 300 g (not 100 g) would be
    // booked to COGS — silently, with nothing erroring.
    const receipt = await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const items = await ds.getItems(uid);
        const dims = await ds.getDimensions(uid);
        const item = items.find((i) => i.name === `${tag} Zzz Garam`);
        const dim = dims.find((d) => d.name === `${tag} Outlet`);
        await ds.createGoodsReceipt(uid, {
            dimension_id: dim.id, vendor_name: 'QA Interleaved', reference: `${tag}-MID`,
            lines: [{ item_id: item.id, quantity: 200, amount: 2000 }]
        });
        return { ok: true };
    }, { tag: TAG });
    expect(receipt.ok).toBe(true);

    // The sheet still shows the stale figure — it has no idea anything happened.
    await expect(rowZ.locator('.cnt-row-system')).toHaveText('System: 500 g');

    await page.click('#count-post-btn');

    // Refused, by name, with the counts preserved.
    const dialog = page.locator('text=Stock moved while you were counting');
    await expect(dialog).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: 'Review' }).click();

    // Reloaded against reality: the system column now shows the delivery, and the
    // count the user actually took is still in the box.
    await expect(rowZ.locator('.cnt-row-system')).toHaveText('System: 700 g', { timeout: 20000 });
    await expect(rowZ.locator('[data-field="counted"]')).toHaveValue('400');
});

test('waste is written off outside cost of goods sold', async ({ page }) => {
    await gotoCount(page);

    await page.click('#record-waste-btn');
    await expect(page.locator('#waste-drawer')).not.toHaveClass(/translate-x-full/);
    await expect(page.locator('#waste-save-btn')).toBeDisabled();

    await page.selectOption('#waste-item', { label: ITEM_A });
    await page.fill('#waste-qty', '50');
    // 50 g of an item held at Rp20/g. The preview names the account BEFORE saving,
    // because 5150-not-5100 is the decision an owner most needs to see.
    await expect(page.locator('#waste-preview')).toContainText('5150');
    await expect(page.locator('#waste-save-btn')).toBeEnabled();

    // Cannot throw away more than is there.
    await page.fill('#waste-qty', '999999');
    await expect(page.locator('#waste-preview')).toContainText('is on hand at this outlet');
    await expect(page.locator('#waste-save-btn')).toBeDisabled();

    await page.fill('#waste-qty', '50');
    await page.click('#waste-save-btn');
    await expect(page.locator('#waste-drawer')).toHaveClass(/translate-x-full/, { timeout: 25000 });

    // Waste reduced the system quantity — which is precisely what stops the next
    // count double-counting it as consumption.
    await expect(page.locator(`.cnt-row:has-text("${ITEM_A}") .cnt-row-system`))
        .toHaveText('System: 800 g', { timeout: 20000 });
});

test('the count sheet works at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoCount(page);

    const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The input must be reachable and typable, and the post bar must stay put.
    const rowZ = page.locator(`.cnt-row:has-text("${ITEM_Z}")`);
    await rowZ.locator('[data-field="counted"]').fill('123');
    await expect(page.locator('#count-footer')).toBeVisible();
    await expect(page.locator('#count-post-btn')).toBeVisible();

    // 16px on the input keeps iOS from zooming the page when it gets focus.
    const fontSize = await rowZ.locator('[data-field="counted"]')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
});
