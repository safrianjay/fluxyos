const { test, expect } = require('@playwright/test');

// Outlet P&L — the number the F&B prospects actually asked for.
//
// The assertions that matter here are about TRUTHFULNESS, not layout:
//   - revenue tagged to an outlet reaches that outlet's row
//   - "Unassigned" is a visible row, never hidden
//   - the outlets sum to the company total
//   - untagged revenue is called out, because otherwise an owner reads a
//     profitable outlet as a loss-maker and closes it

const TAG = `QA-PNL-${Date.now()}`;

function rpToInt(text) {
    const negative = /^-/.test(text.trim());
    const digits = text.replace(/[^\d]/g, '');
    if (!digits) return 0;
    return (negative ? -1 : 1) * parseInt(digits, 10);
}

async function gotoPnl(page) {
    await page.goto('/outlet-pnl');
    await page.waitForFunction(
        () => document.querySelector('#outlet-body tr') || document.querySelector('#outlet-empty .fluxy-table-empty'),
        { timeout: 30000 }
    );
}

test('an outlet P&L is built, and the outlets tie out to the company', async ({ page }) => {
    // Seed through the DAL: this spec is about the REPORT, and driving four
    // screens to arrange the data would test them a second time. An app page has
    // to be loaded first — module specifiers do not resolve on about:blank.
    await page.goto('/inventory');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const seeded = await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const ds = new DataService(app);
        ds.actorUid = user.uid;
        const uid = user.uid;

        const outlet = await ds.saveDimension(uid, { name: `${tag} Kemang`, type: 'outlet' }, { create: true });
        const item = await ds.saveItem(uid, {
            name: `${tag} Beras`, type: 'stock', base_unit: 'g',
            units: [{ code: 'kg', factor: 1000, role: 'purchase' }]
        }, { create: true });

        // Stock in, then counted short: 2.000 g of consumption at Rp10/g.
        await ds.createGoodsReceipt(uid, {
            vendor_name: `${tag} Supplier`, dimension_id: outlet.id, reference: `${tag}-GR`,
            lines: [{ item_id: item.id, quantity: 10000, amount: 100000 }]
        });
        await ds.createStockAdjustment(uid, {
            adjustment_type: 'count', dimension_id: outlet.id,
            lines: [{ item_id: item.id, counted_quantity: 8000 }]
        });

        // Revenue TAGGED to the outlet — the piece that makes the report answer
        // "which outlet is working" rather than "which outlet has costs".
        await ds.addTransaction(uid, {
            vendor_name: `${tag} Sales`, category: 'Revenue', type: 'income',
            amount: 250000, status: 'Completed', icon: 'cash',
            dimension_id: outlet.id, timestamp: new Date()
        });

        return { outletName: `${tag} Kemang` };
    }, { tag: TAG });

    await gotoPnl(page);

    const row = page.locator(`#outlet-body tr:has-text("${seeded.outletName}")`);
    await expect(row).toHaveCount(1);

    // Revenue reached the outlet, and consumption landed as cost of sales.
    const cells = row.locator('td');
    expect(rpToInt(await cells.nth(1).innerText())).toBe(250000);   // revenue
    expect(rpToInt(await cells.nth(2).innerText())).toBe(20000);    // cost of sales
    expect(rpToInt(await cells.nth(3).innerText())).toBe(230000);   // gross profit
    await expect(cells.nth(4)).toContainText('92.0%');              // margin, not NaN

    // The integrity claim, made checkable: every outlet row must sum to the
    // "All outlets" total. If these ever disagree, the per-outlet statement has
    // stopped being the company statement sliced up.
    const dataRows = page.locator('#outlet-body tr:not(.fluxy-table-row-final)');
    const n = await dataRows.count();
    let revenueSum = 0;
    let netSum = 0;
    for (let i = 0; i < n; i++) {
        const tds = dataRows.nth(i).locator('td');
        revenueSum += rpToInt(await tds.nth(1).innerText());
        netSum += rpToInt(await tds.nth(6).innerText());
    }
    const totalRow = page.locator('#outlet-body tr.fluxy-table-row-final td');
    expect(rpToInt(await totalRow.nth(1).innerText()), 'revenue must tie out').toBe(revenueSum);
    expect(rpToInt(await totalRow.nth(6).innerText()), 'net must tie out').toBe(netSum);

    // Clicking through shows the accounts behind the row.
    await row.click();
    await expect(page.locator('#outlet-detail-card')).toBeVisible();
    await expect(page.locator('#outlet-detail-title')).toHaveText(seeded.outletName);
    await expect(page.locator('#outlet-detail-body')).toContainText('5100');
});

test('untagged revenue is surfaced, not quietly dropped', async ({ page }) => {
    // Revenue with NO outlet. It is real money and must remain visible, or the
    // outlets stop summing to the company.
    await page.goto('/inventory');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        await ds.addTransaction(uid, {
            vendor_name: `${tag} Untagged`, category: 'Revenue', type: 'income',
            amount: 90000, status: 'Completed', icon: 'cash', timestamp: new Date()
        });
    }, { tag: TAG });

    await gotoPnl(page);

    // Unassigned is a real, visible row.
    const unassigned = page.locator('#outlet-body tr:has-text("Unassigned")');
    await expect(unassigned).toHaveCount(1);
    await expect(unassigned).toContainText('Not tagged to any outlet');

    // And the page says so in words, because a silent Unassigned row is exactly
    // how an owner concludes a profitable outlet is losing money.
    const notice = page.locator('#outlet-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('not tagged to an outlet');
});

test('the transaction drawer offers an outlet once outlets exist', async ({ page }) => {
    await page.goto('/ledger');
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction' }));

    // The field is progressive: it only appears for workspaces that actually run
    // outlets, so a single-location business never sees an empty picker.
    const section = page.locator('#tx-outlet-section');
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`#tx-outlet option:has-text("${TAG} Kemang")`)).toHaveCount(1);
    // Default is unassigned — tagging is opt-in, never guessed.
    await expect(page.locator('#tx-outlet')).toHaveValue('');
});

test('outlet P&L holds at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoPnl(page);
    const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    await expect(page.locator('.dashboard-topbar-title')).toBeVisible();
});
