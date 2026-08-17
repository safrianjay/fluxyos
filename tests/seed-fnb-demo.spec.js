const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 180_000 });

// The demo seeder, exercised for real.
//
// A seeder that has never been run is a liability: it is handed over as working
// and discovered broken in front of a prospect. So this drives the actual write
// path — one outlet and three items rather than the full set, to keep the QA
// workspace from growing by a whole demo.
//
// It also pins the two safety behaviours, which are the parts most likely to be
// quietly weakened later: a dry run must write NOTHING, and seeding a workspace
// that already holds inventory must be refused.

const TAG = `QA-SEED-${Date.now()}`;

const ONE_OUTLET = [
    { name: `${TAG} Kemang`, keep: 0.30, foodCost: 0.32, opexRatio: 0.44, wasteBoost: 1 }
];
const THREE_ITEMS = [
    { name: `${TAG} Beras`, base: 'g', buy: ['karung', 25000], shelf: 'Gudang kering — Rak A', rate: 14,  order: 2 },
    { name: `${TAG} Ayam`,  base: 'g', buy: ['kg', 1000],      shelf: 'Chiller',               rate: 42,  order: 12,
      waste: { qty: 2200, reason: 'Lewat tanggal' } },
    { name: `${TAG} Kopi`,  base: 'g', buy: ['kg', 1000],      shelf: 'Bar',                   rate: 185, order: 3 }
];

async function openApp(page) {
    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => window.FluxyWorkspace && window.FluxyWorkspace.id,
        undefined, { timeout: 60000 }
    );
}

test('a dry run reports the plan and writes nothing', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
        const { seedFnbDemo } = await import('/scripts/seed-fnb-demo.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const ds = new DataService(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;

        const before = (await ds.getItems(uid)).length;
        const out = await seedFnbDemo();                 // no confirm -> dry run
        const after = (await ds.getItems(uid)).length;
        return { dryRun: out.dryRun, before, after };
    });

    expect(result.dryRun).toBe(true);
    expect(result.after, 'a dry run must not create anything').toBe(result.before);
});

test('seeding a workspace that already has inventory is refused', async ({ page }) => {
    await openApp(page);

    // The QA workspace is full of items, which makes it the right place to prove
    // the guard fires. Without `allowExisting` this must throw rather than mix
    // demo figures into books that already mean something.
    const err = await page.evaluate(async () => {
        const { seedFnbDemo } = await import('/scripts/seed-fnb-demo.js');
        try {
            await seedFnbDemo({ confirm: 'WRITE' });
            return null;
        } catch (e) { return e.message; }
    });

    expect(err).toContain('already has items');
});

test('the seeder builds a coherent outlet: stock in, waste, count, revenue, opex', async ({ page }) => {
    await openApp(page);

    const res = await page.evaluate(async ({ outlets, items }) => {
        const { seedFnbDemo } = await import('/scripts/seed-fnb-demo.js');
        return seedFnbDemo({ confirm: 'WRITE', allowExisting: true, outlets, items });
    }, { outlets: ONE_OUTLET, items: THREE_ITEMS });

    expect(res.dryRun).toBe(false);
    expect(res.summary).toHaveLength(1);
    const s = res.summary[0];

    // Every figure has to be real money, and COGS must come from an actual count
    // rather than being invented — so it is bounded by what was received.
    expect(s.revenue).toBeGreaterThan(0);
    expect(s.cogs).toBeGreaterThan(0);
    expect(s.waste).toBeGreaterThan(0);
    expect(s.opex).toBeGreaterThan(0);

    // Revenue is derived from posted COGS, so the food-cost story holds exactly.
    const foodCost = s.cogs / s.revenue;
    expect(foodCost).toBeGreaterThan(0.30);
    expect(foodCost).toBeLessThan(0.34);

    // The whole point of the demo: this outlet should read as healthy.
    expect(s.net, 'Kemang is the healthy outlet — it must not post a loss').toBeGreaterThan(0);

    // ── And it must be visible in the product, not just in the return value ──
    await page.goto('/outlet-pnl');
    await page.waitForFunction(
        () => document.querySelector('#outlet-body tr'),
        undefined, { timeout: 60000 }
    );
    const row = page.locator(`#outlet-body tr:has-text("${TAG} Kemang")`);
    await expect(row).toHaveCount(1);
    // Revenue, cost of sales and operating costs all landed on the outlet.
    await expect(row.locator('td').nth(1)).not.toContainText('—');
    await expect(row.locator('td').nth(2)).not.toContainText('—');
    await expect(row.locator('td').nth(5)).not.toContainText('—');

    // The count sheet reads as a walk through the stockroom: the seeded items
    // carry shelves, so they group rather than sitting under "No shelf set".
    await page.goto('/inventory-count');
    await page.waitForFunction(
        () => document.querySelectorAll('#count-list .cnt-row').length > 0,
        undefined, { timeout: 60000 }
    );
    await page.selectOption('#count-outlet', { label: `${TAG} Kemang` });
    await expect(page.locator('.cnt-shelf-label', { hasText: 'Chiller' }).first()).toBeVisible();
});
