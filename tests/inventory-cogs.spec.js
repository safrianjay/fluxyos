const { test, expect } = require('@playwright/test');

// The whole F&B chain, end to end against the real QA workspace:
//
//   receive stock      Dr 1200 / Cr 2050
//   record waste       Dr 5150 / Cr 1200
//   count what is left Dr 5100 / Cr 1200
//   read outlet P&L    from ledger_balances_by_dim
//
// This is the payoff the ~15 blocked F&B prospects asked for, and the first
// point where the pieces from steps 1-4 have to agree with each other. The
// assertions that matter are the relationships, not the individual numbers:
//
//   - waste lands in 5150 and NOT in COGS, so gross margin exposes spoilage
//     rather than absorbing it
//   - waste and the count do not double-count the same stock
//   - the outlet P&L is built by the SAME engine as the company statement

test('receipt → waste → count produces COGS, waste and an outlet P&L', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const tag = `QA-COGS-${Date.now()}`;
        const out = { error: null };
        try {
            // A dedicated outlet, so this run cannot be confused with any other.
            const dim = await ds.saveDimension(uid, { name: tag, type: 'outlet' }, { create: true });
            const item = await ds.saveItem(uid, {
                name: `${tag} Flour`, type: 'stock', base_unit: 'g',
                units: [{ code: 'kg', factor: 1000, role: 'purchase' }], sku: tag
            }, { create: true });

            // 25 kg at Rp300.000 -> Rp12 per gram.
            await ds.createGoodsReceipt(uid, {
                vendor_name: 'QA Vendor', dimension_id: dim.id, reference: `${tag}-GR`,
                lines: [{ item_id: item.id, quantity: 25000, amount: 300000 }]
            });
            const afterReceipt = (await ds.getStockOnHand(uid, { byDimension: true }))[`${item.id}__${dim.id}`];

            // 500 g spoiled -> Rp6.000 to 5150, not to COGS.
            await ds.createStockAdjustment(uid, {
                adjustment_type: 'waste', dimension_id: dim.id, reference: `${tag}-W`,
                lines: [{ item_id: item.id, quantity: 500 }]
            });
            const afterWaste = (await ds.getStockOnHand(uid, { byDimension: true }))[`${item.id}__${dim.id}`];

            // Count finds 21.500 g. System now believes 24.500 (25.000 - 500 waste),
            // so the variance is 3.000 g of consumption -> Rp36.000 to COGS.
            const count = await ds.createStockAdjustment(uid, {
                adjustment_type: 'count', dimension_id: dim.id, reference: `${tag}-C`,
                lines: [{ item_id: item.id, counted_quantity: 21500 }]
            });
            const afterCount = (await ds.getStockOnHand(uid, { byDimension: true }))[`${item.id}__${dim.id}`];

            const pnl = (await ds.getOutletPnL(uid)).find((p) => p.dimension_id === dim.id);

            out.receiptQty = afterReceipt.quantity;
            out.receiptValue = afterReceipt.value;
            out.wasteQty = afterWaste.quantity;
            out.countLine = count.lines[0];
            out.countTotal = count.total_amount;
            out.finalQty = afterCount.quantity;
            out.pnlName = pnl && pnl.dimension_name;
            out.cogs = pnl && pnl.statement.totalCogs;
            out.opex = pnl && pnl.statement.totalOpEx;
            out.cogsCodes = pnl ? pnl.statement.cogs.map((l) => l.code) : [];
            out.opexCodes = pnl ? pnl.statement.operatingExpenses.map((l) => l.code) : [];
        } catch (e) {
            out.error = `${e.code || ''} ${e.message || e}`.trim();
        }
        return out;
    });

    expect(r.error).toBeNull();

    // Receipt: 25 kg in, valued at cost.
    expect(r.receiptQty).toBe(25000);
    expect(r.receiptValue).toBe(300000);

    // Waste reduced the SYSTEM quantity — which is what stops it being counted
    // twice when the physical count runs next.
    expect(r.wasteQty).toBe(24500);

    // Variance is measured against the post-waste system quantity, so it is
    // 3.000 g of consumption, not 3.500 g.
    expect(r.countLine.system_quantity, 'count compares against post-waste stock').toBe(24500);
    expect(r.countLine.quantity, 'consumption only — waste already accounted for').toBe(-3000);
    expect(r.countTotal, '3.000 g at Rp12/g').toBe(-36000);
    expect(r.finalQty, 'subledger now agrees with the physical count').toBe(21500);

    // The relationship that matters: spoilage is visible as opex, NOT buried in
    // cost of goods sold where it would quietly depress gross margin.
    expect(r.pnlName).toBeTruthy();
    expect(r.cogsCodes, 'consumption posts to 5100').toContain('5100');
    expect(r.opexCodes, 'waste posts to 5150, outside COGS').toContain('5150');
    expect(r.cogsCodes, 'waste must never appear in COGS').not.toContain('5150');
    expect(r.cogs).toBe(36000);
    expect(r.opex).toBe(6000);
});
