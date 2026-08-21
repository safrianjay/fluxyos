const { test, expect } = require('@playwright/test');

// Pure-logic unit test for the POS posting rules. Same pattern as
// accounting-engine.spec.js: navigate to any served page, import the ESM module
// in the browser, assert against its pure outputs. No Firestore, no auth.
//
// What these pin down, in order of how badly each would fail silently:
//   1. Revenue is credited GROSS and the discount is a separate 4900 debit.
//      Fold the discount into the price and menu-price integrity, discount
//      analytics, and anomaly detection all become unbuildable — and nothing
//      would report it (docs/POS_IMPLEMENTATION_PLAN.md §18.4).
//   2. `amount` is NET, so the dashboard Revenue KPI — which sums transaction
//      amounts — matches the ledger. Two revenue numbers is what §6 forbids.
//   3. Non-cash settles through 1030, not 1000, so the bank rec stays tieable.
//   4. A POS sale relieves stock through the SAME rule a marketplace sale does.

test('POS posting rules keep gross revenue, discount, and settlement separate', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const at = new Date('2026-08-21T05:00:00Z');
        const pos = (doc) => e.buildJournal({
            collection: 'transactions', id: doc._id || 'x', date: at,
            document: { source: 'pos', timestamp: at, ...doc }
        });
        const netOf = (j) => {
            const n = {};
            (j ? j.lines : []).forEach((l) => { n[l.account_code] = (n[l.account_code] || 0) + l.debit - l.credit; });
            return n;
        };
        const cap = (fn) => { try { return { ok: true, value: fn() }; }
            catch (err) { return { ok: false, code: err && err.code || null }; } };

        // A Rp100.000 order with Rp20.000 off, paid in cash.
        const discounted = pos({ _id: 'o1', type: 'income', amount: 80000, pos_discount_amount: 20000,
            pos_discount_reason: 'Promo makan siang', pos_settlement: 'cash', category: 'Sales' });
        // The same order paid by QRIS.
        const qris = pos({ _id: 'o2', type: 'income', amount: 80000, pos_discount_amount: 20000,
            pos_settlement: 'clearing', category: 'Sales' });
        // No discount at all — must degrade to a plain two-line cash sale.
        const plain = pos({ _id: 'o3', type: 'income', amount: 55000, pos_settlement: 'cash' });
        // Refund of a cash sale.
        const refund = pos({ _id: 'o4', type: 'refund', amount: 55000, pos_settlement: 'cash',
            pos_refund_reason: 'Salah pesan' });
        // The acquirer pays out. Reuses CM-SETTLE — same journal, same meaning.
        const payout = pos({ _id: 'o5', type: 'transfer', amount: 80000 });
        // Stock relief. Routed by adjustment_type, NOT by source — a POS sale and a
        // marketplace sale relieve stock through one rule because it is one journal.
        const cogs = e.buildJournal({ collection: 'stock_adjustments', id: 'sa1', date: at,
            document: { adjustment_type: 'sale', total_amount: -32000, reference: 'POS KMG-014', timestamp: at } });

        return {
            rules: {
                sale: discounted.posting_rule_id, qris: qris.posting_rule_id, plain: plain.posting_rule_id,
                refund: refund.posting_rule_id, payout: payout.posting_rule_id, cogs: cogs.posting_rule_id
            },
            balanced: [discounted, qris, plain, refund, payout, cogs].every((j) => j.is_balanced),
            discounted: netOf(discounted),
            qris: netOf(qris),
            plainLineCount: plain.lines.length,
            plainNet: netOf(plain),
            refund: netOf(refund),
            payout: netOf(payout),
            cogs: netOf(cogs),
            descriptions: {
                sale: e.describeRule('POS-SALE'),
                cogs: e.describeRule('CM-ORDER-COGS'),
                settle: e.describeRule('CM-SETTLE')
            },
            // A dimension on the document must reach every line, or /outlet-pnl
            // silently files the sale under "Unassigned".
            dimensions: pos({ _id: 'o6', type: 'income', amount: 40000, pos_discount_amount: 5000,
                pos_settlement: 'cash', dimension_id: 'outlet_kemang' }).lines.map((l) => l.dimension_id),
            // A zero or negative sale is a bug upstream, never a journal.
            zero: cap(() => pos({ _id: 'o7', type: 'income', amount: 0, pos_settlement: 'cash' })),
            // A non-POS income row must be completely untouched by the new branch.
            plainIncomeUnaffected: e.buildJournal({ collection: 'transactions', id: 'p1', date: at,
                document: { type: 'income', amount: 500000, category: 'Revenue', timestamp: at } }).posting_rule_id
        };
    });

    expect(r.rules).toEqual({
        sale: 'POS-SALE', qris: 'POS-SALE', plain: 'POS-SALE',
        refund: 'POS-REFUND', payout: 'CM-SETTLE', cogs: 'CM-ORDER-COGS'
    });
    expect(r.balanced, 'every POS journal must balance').toBe(true);

    // ── The discount invariant. Revenue is credited the GROSS menu price
    //    (80.000 + 20.000); the discount is a visible debit to contra-revenue.
    expect(-r.discounted['4000'], 'revenue must be credited GROSS').toBe(100000);
    expect(r.discounted['4900'], 'discount is contra-revenue, not a lower price').toBe(20000);
    expect(r.discounted['1000'], 'cash receives only what the customer paid').toBe(80000);

    // ── Settlement routing. Non-cash must never debit 1000, or the bank rec
    //    cannot tie: the money is still with the acquirer.
    expect(r.qris['1030'], 'QRIS lands in clearing, not cash').toBe(80000);
    expect(r.qris['1000'] || 0, 'cash must not move on a QRIS sale').toBe(0);
    expect(-r.qris['4000'], 'settlement type must not change revenue').toBe(100000);

    // ── No discount degrades cleanly to the ordinary two-line cash sale.
    expect(r.plainLineCount, 'no discount means no 4900 line').toBe(2);
    expect(r.plainNet['1000']).toBe(55000);
    expect(-r.plainNet['4000']).toBe(55000);
    expect(r.plainNet['4900'], '4900 must be absent, not zero').toBeUndefined();

    // ── A refund reduces net revenue and takes cash back out.
    expect(r.refund['4900']).toBe(55000);
    expect(r.refund['1000']).toBe(-55000);

    // ── The payout clears the float exactly.
    expect(r.payout['1030']).toBe(-80000);
    expect(r.payout['1000']).toBe(80000);

    // ── Stock relief: Dr COGS / Cr Inventory, on the shipped rule.
    expect(r.cogs['5100']).toBe(32000);
    expect(r.cogs['1200']).toBe(-32000);

    // ── The COGS description must be source-neutral now that a till uses it.
    expect(r.descriptions.cogs).toBe('Cost of goods sold');
    expect(r.descriptions.cogs).not.toContain('Marketplace');
    expect(r.descriptions.settle).not.toContain('Marketplace');
    expect(r.descriptions.sale).toBe('Till sale');

    // ── Every line carries the outlet, including the discount line.
    expect(r.dimensions).toEqual(['outlet_kemang', 'outlet_kemang', 'outlet_kemang']);

    // ── A zero-amount sale is refused, not posted as an empty journal.
    expect(r.zero.ok).toBe(false);
    expect(r.zero.code).toBe('GL_003');

    // ── Regression: the POS branch must not capture ordinary income.
    expect(r.plainIncomeUnaffected).toBe('TXN-INC-CASH');
});

test('a POS sale and a marketplace sale produce the same gross margin arithmetic', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const at = new Date('2026-08-21T05:00:00Z');
        const net = {};
        const add = (j) => j.lines.forEach((l) => { net[l.account_code] = (net[l.account_code] || 0) + l.debit - l.credit; });

        // Sell a Rp45.000 dish costing Rp18.000, through the till, at full price.
        add(e.buildJournal({ collection: 'transactions', id: 's1', date: at,
            document: { source: 'pos', type: 'income', amount: 45000, pos_settlement: 'cash', timestamp: at } }));
        add(e.buildJournal({ collection: 'stock_adjustments', id: 'sa1', date: at,
            document: { adjustment_type: 'sale', total_amount: -18000, timestamp: at } }));
        return net;
    });

    // Revenue 45.000, COGS 18.000 → gross profit 27.000, 60% margin. Inventory
    // fell by exactly the cost. Before per-sale relief existed this booked at
    // 100% margin, which is the defect the whole chain exists to close.
    expect(-r['4000']).toBe(45000);
    expect(r['5100']).toBe(18000);
    expect(r['1200']).toBe(-18000);
    expect(-r['4000'] - r['5100']).toBe(27000);
});

test('a drawer variance posts to 6700 and never touches sales', async ({ page }) => {
    // The genuinely new accounting in Phase 1.5. A shift that counted short is a
    // real operating cost; folding it into sales would hide the exact thing a
    // cash count exists to find — the same reason waste posts to 5150 rather
    // than COGS.
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const at = new Date('2026-08-22T05:00:00Z');
        const shift = (variance) => e.buildJournal({
            collection: 'pos_shifts', id: 's1', date: at,
            document: { variance, reference: 'Shift abc123', timestamp: at }
        });
        const net = (j) => {
            const n = {};
            (j ? j.lines : []).forEach((l) => { n[l.account_code] = (n[l.account_code] || 0) + l.debit - l.credit; });
            return n;
        };
        const short = shift(-5000);
        const over = shift(12000);
        return {
            rules: { short: short.posting_rule_id, over: over.posting_rule_id },
            balanced: short.is_balanced && over.is_balanced,
            shortNet: net(short),
            overNet: net(over),
            // A drawer that counted exactly right has nothing to say to the ledger.
            balancedDrawer: shift(0),
            desc: e.describeRule('POS-SHIFT-VARIANCE')
        };
    });

    expect(r.rules).toEqual({ short: 'POS-SHIFT-VARIANCE', over: 'POS-SHIFT-VARIANCE' });
    expect(r.balanced).toBe(true);

    // Short: the missing cash is an expense, and cash comes down to match reality.
    expect(r.shortNet['6700']).toBe(5000);
    expect(r.shortNet['1000']).toBe(-5000);

    // Over: more cash than the sales explain. Same account, other direction —
    // a credit balance on 6700 is a control signal, not an error.
    expect(r.overNet['6700']).toBe(-12000);
    expect(r.overNet['1000']).toBe(12000);

    // Neither may touch revenue or COGS.
    expect(r.shortNet['4000']).toBeUndefined();
    expect(r.overNet['4000']).toBeUndefined();
    expect(r.shortNet['5100']).toBeUndefined();

    // A balanced drawer posts NOTHING — not a zero journal, which would fail the
    // engine's own balance assertion and would mean nothing anyway.
    expect(r.balancedDrawer).toBeNull();

    expect(r.desc).toBe('Cash drawer count');
});
