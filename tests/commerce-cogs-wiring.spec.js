const { test, expect } = require('@playwright/test');

// The two gaps that let a shipped capability sit inert.
//
// `CM-ORDER-COGS` landed 2026-08-20 with a posting rule, a DAL method and a
// spec — and it was never true in production, for two independent reasons:
//
//   1. NOTHING CALLED IT. `relieveCommerceCogs` had exactly one call site: its
//      own spec. No page, no button, no scheduled function. So
//      `POS_READINESS.md` §1's headline — "every marketplace sale books revenue
//      at full margin and leaves inventory untouched" — stayed true after the
//      commit that was supposed to close it.
//
//   2. THE RECIPE PATH THREW. `explodeRecipe` returns an OBJECT keyed by item
//      id; the code called `.forEach` on it, so the first composite order threw
//      out of the whole sweep. `commerce-cogs.spec.js` could not catch it
//      because it says so itself: "assert the DAL's CONTRACT on an EMPTY order
//      set". A contract test on nothing proves nothing about explosion.
//
// Both found 2026-08-21 while measuring the blast radius of the second. These
// are the guards. The explosion test is pure, which is what lets it be the guard
// the original could not be — `commerce_orders` is Admin-SDK-only, so no
// browser spec can seed one.

test('a composite sale explodes to the ingredients it consumes', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const { default: DataService } = await import('/assets/js/db-service.js');
        const ds = Object.create(DataService.prototype);

        // Nasi Goreng: one batch makes 2 portions from 300g rice + 20ml oil +
        // 100g sambal. Sambal is a nested sub-preparation that ALSO uses rice,
        // so rice is reached both directly and through it — the merge case.
        const byId = {
            rice:   { id: 'rice',   name: 'Beras',  type: 'stock', base_unit: 'g' },
            oil:    { id: 'oil',    name: 'Minyak', type: 'stock', base_unit: 'ml' },
            sambal: { id: 'sambal', name: 'Sambal', type: 'composite', base_unit: 'g', batch_size: 100,
                      components: [{ item_id: 'rice', quantity: 10 }] },
            nasgor: { id: 'nasgor', name: 'Nasi Goreng', type: 'composite', base_unit: 'porsi', batch_size: 2,
                      components: [
                          { item_id: 'rice',   quantity: 300 },
                          { item_id: 'oil',    quantity: 20 },
                          { item_id: 'sambal', quantity: 100 }
                      ] }
        };
        // Rice Rp20/g, oil Rp50/ml.
        const onHand = () => ({ rice: { quantity: 10000, value: 200000 }, oil: { quantity: 1000, value: 50000 } });
        const norm = (o) => o.lines.map((l) => `${l.item_id} ${l.quantity}${l.base_unit} ${l.amount}`).sort();

        return {
            composite: norm(ds._resolveSaleConsumption({
                soldLines: [{ item_id: 'nasgor', quantity: 2 }], byId, bySku: {}, onHand: onHand() })),
            plain: norm(ds._resolveSaleConsumption({
                soldLines: [{ item_id: 'rice', quantity: 50 }], byId, bySku: {}, onHand: onHand() })),
            bySku: norm(ds._resolveSaleConsumption({
                soldLines: [{ sku: 'NG-1', quantity: 2 }], byId,
                bySku: { 'ng-1': byId.nasgor }, onHand: onHand() })),
            uncosted: (() => {
                const o = ds._resolveSaleConsumption({
                    soldLines: [{ item_id: 'rice', quantity: 10 }], byId, bySku: {},
                    onHand: { rice: { quantity: 0, value: 0 } } });
                return { lines: norm(o), missing: o.missingCost };
            })(),
            unknown: (() => {
                const o = ds._resolveSaleConsumption({
                    soldLines: [{ sku: 'NOPE', quantity: 1 }], byId, bySku: {}, onHand: {} });
                return { count: o.lines.length, unmatched: o.unmatched };
            })()
        };
    });

    // Rice MERGES to 310g — 300g direct plus 10g through sambal. Without the
    // merge a nested recipe costs wrong and nothing reports it.
    expect(r.composite).toEqual([
        'oil -20ml -1000',    // 20ml x Rp50 — quantity is SIGNED, negative is stock out
        'rice -310g -6200'    // 310g x Rp20
    ]);

    // A bare stock item relieves itself one-for-one — the retail case.
    expect(r.plain).toEqual(['rice -50g -1000']);

    // SKU lookup is the join the commerce path uses; it must land identically.
    expect(r.bySku).toEqual(r.composite);

    // An ingredient with no cost basis relieves QUANTITY at zero value and is
    // REPORTED — never silently free, which is how a sale books at full margin.
    expect(r.uncosted.lines).toEqual(['rice -10g 0']);
    expect(r.uncosted.missing).toContain('Beras');

    // An unmatched SKU makes no movement and is named, so the item can be fixed.
    expect(r.unknown.count).toBe(0);
    expect(r.unknown.unmatched).toEqual(['NOPE']);
});

test('the Inventory Overview surfaces unrelieved marketplace orders, and only then', async ({ page }) => {
    // The wiring half. Without a surface the method is dead code — which is
    // exactly the state it shipped in.
    await page.goto('/inventory');
    await page.waitForFunction(() => typeof window.__invRenderCommerceCogs === 'function', undefined, { timeout: 60000 });

    // Nothing outstanding → absent, not an empty "all clear" card. A dashboard
    // that reports the absence of news reads as withholding something.
    await page.evaluate(() => window.__invRenderCommerceCogs({ unrelieved: 0 }));
    await expect(page.locator('#inv-commerce-cogs')).toBeHidden();

    // Work outstanding → a count, the consequence in plain words, one action.
    await page.evaluate(() => window.__invRenderCommerceCogs({ unrelieved: 7 }));
    const host = page.locator('#inv-commerce-cogs');
    await expect(host).toBeVisible();
    await expect(host).toContainText('7 marketplace orders have sold stock that was never relieved');
    // Naming the consequence is the point — "gross margin is overstated" is what
    // makes an owner press the button.
    await expect(host).toContainText(/gross margin is overstated/i);
    await expect(page.locator('#inv-relieve-cogs')).toBeVisible();

    // Singular must read correctly; "1 orders have" is how a dashboard loses trust.
    await page.evaluate(() => window.__invRenderCommerceCogs({ unrelieved: 1 }));
    await expect(host).toContainText('1 marketplace order has sold stock');
});

test('counting what would be relieved writes nothing', async ({ page }) => {
    // This count backs a banner that renders on every Overview load. If it ever
    // started writing, merely opening the page would post journals.
    await page.goto('/inventory');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const before = (await ds.getStockMovements(uid, { limitCount: 1000 })).length;
        const a = await ds.countUnrelievedCommerceOrders(uid);
        const b = await ds.countUnrelievedCommerceOrders(uid);
        const after = (await ds.getStockMovements(uid, { limitCount: 1000 })).length;
        return { a, b, before, after };
    });

    expect(r.after, 'counting must not move stock').toBe(r.before);
    expect(r.a).toEqual(r.b);
    expect(typeof r.a.unrelieved).toBe('number');
    expect(r.a.unrelieved).toBeGreaterThanOrEqual(0);
});
