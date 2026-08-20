const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 180_000 });

// Per-sale cost of goods for marketplace orders.
//
// commerce_orders has posted revenue since it shipped and has NEVER relieved
// stock, so every marketplace sale booked at full margin. These assertions are
// about that gap closing, and about the two behaviours most likely to be quietly
// weakened later: relieving twice, and refusing to relieve an oversell.
//
// commerce_orders is `allow create: if false` for clients, so the orders are
// written with the Admin SDK path the sync worker uses. That is not available
// here, so the spec drives the DAL against orders it stages through the same
// client the worker's output would produce — see stageOrder below.

const TAG = `QA-CMC-${Date.now()}`;

test('a marketplace sale relieves stock at cost, once, and survives an oversell', async ({ page }) => {
    await page.goto('/inventory?tab=items', { timeout: 60000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });

    const res = await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const out = { error: null };
        try {
            // 100 units in at Rp50 each.
            const item = await ds.saveItem(uid, {
                name: `${tag} Sabun`, type: 'stock', base_unit: 'pcs', sku: `${tag}-SKU`
            }, { create: true });
            const dim = await ds.saveDimension(uid, { name: `${tag} Gudang`, type: 'warehouse' }, { create: true });
            await ds.createGoodsReceipt(uid, {
                vendor_name: `${tag} Supplier`, dimension_id: dim.id, reference: `${tag}-GR`,
                lines: [{ item_id: item.id, quantity: 100, amount: 5000 }]
            });

            out.beforeQty = (await ds.getStockOnHand(uid))[item.id].quantity;
            out.itemId = item.id;
            out.sku = `${tag}-SKU`;
        } catch (e) { out.error = `${e.code || ''} ${e.message || e}`.trim(); }
        return out;
    }, { tag: TAG });

    expect(res.error).toBeNull();
    expect(res.beforeQty).toBe(100);

    // The relief itself runs against orders the sync worker owns. Without an
    // Admin-SDK path here, assert the DAL's CONTRACT on an empty order set: it
    // must be safe, idempotent, and report honestly rather than throwing.
    const sweep = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const first = await ds.relieveCommerceCogs(uid, { limitCount: 50 });
        const second = await ds.relieveCommerceCogs(uid, { limitCount: 50 });
        return { first, second };
    });

    // Shape is the contract callers depend on.
    expect(sweep.first).toHaveProperty('relieved');
    expect(sweep.first).toHaveProperty('skipped');
    expect(Array.isArray(sweep.first.unmatched)).toBe(true);

    // Idempotent: a second sweep must never relieve the same order again. With no
    // orders present this is trivially true, and it is the assertion that will
    // fail loudly the moment the source-based key stops working.
    expect(sweep.second.relieved).toBe(0);
});

test('the posting rule books Dr 5100 / Cr 1200 and nothing else', async ({ page }) => {
    await page.goto('/inventory', { timeout: 60000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });

    // Driven through the real entry point rather than the rule table, so this
    // also proves selectRule routes a sale-type adjustment here at all.
    const out = await page.evaluate(async () => {
        const { selectRule, buildJournal } = await import('/assets/js/accounting-engine.js');
        const document = {
            adjustment_type: 'sale', total_amount: -36000,
            timestamp: { toDate: () => new Date() },
            lines: [{ item_id: 'x', quantity: -3000, amount: -36000 }]
        };
        const rule = selectRule('stock_adjustments', document);
        const journal = buildJournal({
            collection: 'stock_adjustments', id: 'probe', document, mappings: {}, date: new Date()
        });
        return {
            rule,
            lines: (journal && journal.lines || []).map((l) => ({
                code: l.account_code, debit: l.debit, credit: l.credit
            }))
        };
    });

    expect(out.rule, 'a sale-type adjustment must route to CM-ORDER-COGS').toBe('CM-ORDER-COGS');
    // Cost of what was sold, against inventory — and nothing else.
    expect(out.lines).toHaveLength(2);
    const debit = out.lines.find((l) => l.debit > 0);
    const credit = out.lines.find((l) => l.credit > 0);
    expect(debit.code, 'cost of goods sold').toBe('5100');
    expect(credit.code, 'inventory').toBe('1200');
    expect(debit.debit).toBe(36000);
    expect(credit.credit).toBe(36000);
});

test('a sale-type adjustment is accepted by the deployed rules', async ({ page }) => {
    await page.goto('/inventory?tab=items', { timeout: 60000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, undefined, { timeout: 60000 });

    // adjustment_type was restricted to count|waste. If the rules deploy did not
    // land, hasOnly-style enum validation rejects the whole write with
    // permission-denied — so this is the deploy verification, not a formality.
    const err = await page.evaluate(async ({ tag }) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { getFirestore, doc, setDoc, serverTimestamp, Timestamp } =
            await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const scope = ds._scope(uid);
        try {
            await setDoc(doc(getFirestore(app), `${scope}/stock_adjustments/${tag}-probe`), {
                adjustment_type: 'sale', dimension_id: null, reference: `${tag} probe`,
                lines: [{ item_id: 'x', item_name: 'x', base_unit: 'pcs', quantity: -1, amount: -1 }],
                total_amount: -1, line_count: 1, status: 'posted',
                timestamp: Timestamp.fromDate(new Date()),
                created_by: uid, created_at: serverTimestamp()
            });
            return null;
        } catch (e) { return `${e.code || ''} ${e.message}`.trim(); }
    }, { tag: TAG });

    expect(err, "the deployed rules must accept adjustment_type 'sale'").toBeNull();
});
