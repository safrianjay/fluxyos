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

// Split tender: the bug that made this test necessary.
//
// Until 2026-08-30 `_emitPosSale` routed the WHOLE sale to whichever payment
// method was largest, so a Rp200.000 bill paid Rp120.000 cash + Rp80.000 QRIS
// booked all Rp200.000 to 1000 Cash. The bank rec was then wrong by the minority
// tender, and 1030 — whose balance is supposed to BE the unsettled float — was
// wrong by the same amount. Both silent.
//
// A refund was worse and unconditional: refundPosOrder hardcoded
// `pos_settlement: 'cash'`, so refunding a QRIS sale credited cash that had
// never been in the drawer and stranded the float in 1030 permanently.
test('split tender settles to both accounts, and legacy rows still post the old way', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const at = new Date('2026-08-30T05:00:00Z');
        const pos = (doc) => e.buildJournal({
            collection: 'transactions', id: doc._id || 'x', date: at,
            document: { source: 'pos', timestamp: at, ...doc }
        });
        const netOf = (j) => {
            const n = {};
            (j ? j.lines : []).forEach((l) => { n[l.account_code] = (n[l.account_code] || 0) + l.debit - l.credit; });
            return n;
        };

        // Rp200.000 bill: Rp120.000 cash + Rp80.000 QRIS. `pos_settlement` still
        // says 'cash' (the dominant tender) — the split must win over it, or the
        // fix is cosmetic.
        const split = pos({ _id: 's1', type: 'income', amount: 200000, category: 'Sales',
            pos_settlement: 'cash', pos_cash_amount: 120000, pos_clearing_amount: 80000 });

        // Split PLUS a discount: revenue still credited gross, both cash lines intact.
        const splitDisc = pos({ _id: 's2', type: 'income', amount: 180000, category: 'Sales',
            pos_discount_amount: 20000, pos_settlement: 'clearing',
            pos_cash_amount: 100000, pos_clearing_amount: 80000 });

        // A refund of a QRIS sale must credit 1030, not 1000.
        const qrisRefund = pos({ _id: 's3', type: 'refund', amount: 90000,
            pos_settlement: 'clearing', pos_cash_amount: 0, pos_clearing_amount: 90000,
            pos_refund_reason: 'Pesanan dibatalkan' });

        // A refund of a SPLIT sale goes back the way it came in.
        const splitRefund = pos({ _id: 's4', type: 'refund', amount: 200000,
            pos_settlement: 'cash', pos_cash_amount: 120000, pos_clearing_amount: 80000,
            pos_refund_reason: 'Complain' });

        // LEGACY: a row written before the split existed carries no amounts at
        // all. postPendingJournals may still re-post one, and it must produce the
        // SAME journal it would have produced then — a re-post that differs from
        // what is already on the books is its own defect.
        const legacyCash = pos({ _id: 's5', type: 'income', amount: 75000, pos_settlement: 'cash' });
        const legacyQris = pos({ _id: 's6', type: 'income', amount: 75000, pos_settlement: 'clearing' });
        const legacyRefund = pos({ _id: 's7', type: 'refund', amount: 75000, pos_settlement: 'clearing',
            pos_refund_reason: 'Legacy' });

        // A split that does NOT sum to the amount must never produce an
        // unbalanced journal. The DAL cannot emit this (cash is derived), so the
        // rule falls back to the legacy single-account behaviour.
        const inconsistent = pos({ _id: 's8', type: 'income', amount: 100000,
            pos_settlement: 'clearing', pos_cash_amount: 10000, pos_clearing_amount: 20000 });

        // An all-cash sale that DOES carry a split must still be two lines, not
        // three with a zero — a zero line is noise on every statement that reads it.
        const allCash = pos({ _id: 's9', type: 'income', amount: 60000,
            pos_settlement: 'cash', pos_cash_amount: 60000, pos_clearing_amount: 0 });

        const all = [split, splitDisc, qrisRefund, splitRefund, legacyCash, legacyQris,
            legacyRefund, inconsistent, allCash];
        return {
            balanced: all.every((j) => j.is_balanced),
            split: netOf(split),
            splitDisc: netOf(splitDisc),
            qrisRefund: netOf(qrisRefund),
            splitRefund: netOf(splitRefund),
            legacyCash: netOf(legacyCash),
            legacyQris: netOf(legacyQris),
            legacyRefund: netOf(legacyRefund),
            inconsistent: netOf(inconsistent),
            allCashLines: allCash.lines.length,
            allCash: netOf(allCash),
            dimensions: pos({ _id: 's10', type: 'income', amount: 50000, dimension_id: 'outlet_kemang',
                pos_cash_amount: 30000, pos_clearing_amount: 20000 }).lines.map((l) => l.dimension_id)
        };
    });

    expect(r.balanced, 'every split-tender journal must balance').toBe(true);

    // ── The fix itself. Both destinations receive their real share.
    expect(r.split['1000'], 'cash gets exactly the cash tender').toBe(120000);
    expect(r.split['1030'], 'clearing gets exactly the non-cash tender').toBe(80000);
    expect(-r.split['4000'], 'revenue is unchanged by how it was paid').toBe(200000);

    // ── Split plus discount: revenue still gross, discount still contra.
    expect(r.splitDisc['1000']).toBe(100000);
    expect(r.splitDisc['1030']).toBe(80000);
    expect(r.splitDisc['4900']).toBe(20000);
    expect(-r.splitDisc['4000'], 'gross = net + discount').toBe(200000);

    // ── Refunds go back the way the money came in.
    expect(r.qrisRefund['1030'], 'a QRIS refund reduces the float').toBe(-90000);
    expect(r.qrisRefund['1000'] || 0, 'a QRIS refund must not touch the drawer').toBe(0);
    expect(r.qrisRefund['4900']).toBe(90000);
    expect(r.splitRefund['1000']).toBe(-120000);
    expect(r.splitRefund['1030']).toBe(-80000);

    // ── Legacy rows reproduce their original journal exactly.
    expect(r.legacyCash['1000']).toBe(75000);
    expect(r.legacyCash['1030'], 'a legacy cash row must not gain a clearing line').toBeUndefined();
    expect(r.legacyQris['1030']).toBe(75000);
    expect(r.legacyQris['1000']).toBeUndefined();
    expect(r.legacyRefund['1030']).toBe(-75000);

    // ── An inconsistent split falls back rather than unbalancing the books.
    expect(r.inconsistent['1030']).toBe(100000);
    expect(r.inconsistent['1000']).toBeUndefined();

    // ── A zero side produces no line at all.
    expect(r.allCashLines, 'a zero clearing side must not emit a line').toBe(2);
    expect(r.allCash['1000']).toBe(60000);

    // ── Both settlement lines carry the outlet, or /outlet-pnl loses half the sale.
    expect(r.dimensions).toEqual(['outlet_kemang', 'outlet_kemang', 'outlet_kemang']);
});

// The apportionment itself, one layer below the posting rule.
//
// The posting rule is handed a split and trusts it. THIS is where the split is
// decided, and the subtle case is change: a customer who hands over Rp170.000
// cash plus Rp80.000 QRIS against a Rp200.000 bill has settled exactly Rp80.000
// to clearing — not the Rp64.000 a proportional apportionment would compute.
// Non-cash tender is exact; cash absorbs change and the remainder.
//
// Called on the prototype with a minimal `this`, so no Firebase app or auth is
// needed — the method touches nothing but its own arguments.
test('settlement apportionment: non-cash is exact, cash absorbs the change', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const DataService = (await import('/assets/js/db-service.js')).default;
        const ctx = { _posSettlementFor: DataService.prototype._posSettlementFor };
        const split = (payments, amount) =>
            DataService.prototype._posSettlementAmounts.call(ctx, { payments }, amount);
        const p = (method, amount) => ({ method, amount, status: 'settled' });

        return {
            allCash:      split([p('cash', 200000)], 200000),
            allQris:      split([p('qris', 200000)], 200000),
            exactSplit:   split([p('cash', 120000), p('qris', 80000)], 200000),
            // Rp170.000 tendered in cash + Rp80.000 QRIS on a Rp200.000 bill:
            // Rp50.000 change. Clearing is exactly 80.000, cash is the remainder.
            withChange:   split([p('cash', 170000), p('qris', 80000)], 200000),
            // Card and QRIS both clear; transfer and 'other' settle as cash.
            cardAndQris:  split([p('card', 50000), p('qris', 30000), p('cash', 120000)], 200000),
            transferIsCash: split([p('transfer', 200000)], 200000),
            // An unsettled payment must not count — the money has not arrived.
            unsettled:    split([{ method: 'qris', amount: 80000, status: 'pending' },
                                 p('cash', 120000)], 120000),
            // Defensive: clearing can never exceed the amount being settled.
            overClearing: split([p('qris', 500000)], 200000),
            noPayments:   split([], 200000)
        };
    });

    expect(r.allCash).toEqual({ cash: 200000, clearing: 0 });
    expect(r.allQris).toEqual({ cash: 0, clearing: 200000 });
    expect(r.exactSplit).toEqual({ cash: 120000, clearing: 80000 });

    // The case a proportional split would get wrong (it would say 64.000).
    expect(r.withChange, 'non-cash tender is exact; change comes out of cash')
        .toEqual({ cash: 120000, clearing: 80000 });

    expect(r.cardAndQris).toEqual({ cash: 120000, clearing: 80000 });
    expect(r.transferIsCash, 'a bank transfer is already in the account, not with an acquirer')
        .toEqual({ cash: 200000, clearing: 0 });
    expect(r.unsettled, 'an unsettled payment has not arrived and must not split')
        .toEqual({ cash: 120000, clearing: 0 });
    expect(r.overClearing).toEqual({ cash: 0, clearing: 200000 });
    expect(r.noPayments).toEqual({ cash: 200000, clearing: 0 });

    // The invariant the posting rule depends on: the two sides always sum to the
    // amount exactly, so an unbalanced POS journal is not reachable from here.
    for (const [name, v] of Object.entries(r)) {
        expect(v.cash + v.clearing, `${name} must sum to the amount`).toBe(200000 - (name === 'unsettled' ? 80000 : 0));
    }
});

// The trading day belongs to the business, not the device.
//
// `_posDayKey` fed the per-outlet order-number counter and `getPosOverview`
// computed "sales today", both from `new Date()` in the DEVICE's timezone. A
// till set to UTC while trading in Jakarta rolls the day at 07:00 local — mid
// service — restarting the order numbers with the room full and splitting one
// day's sales across two. Invisible on a correctly-set tablet, which is why it
// survived: every QA machine was already on the business's zone.
test('the trading day follows the workspace country, not the device clock', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        await import('/assets/js/money-format.js');
        const M = window.FluxyMoney;
        const withCountry = (code, fn) => {
            const prev = window.FluxyWorkspace;
            window.FluxyWorkspace = Object.assign({}, prev, { country: code });
            try { return fn(); } finally { window.FluxyWorkspace = prev; }
        };

        // 2026-08-30 22:30 UTC. Already the 31st in Jakarta (+07) and Manila
        // (+08); still the 30th in UTC. A device on UTC would file these sales
        // under the wrong day and reuse yesterday's order numbers.
        const evening = new Date('2026-08-30T22:30:00Z');
        // 2026-08-30 01:00 UTC — still the 29th in no supported zone, but a
        // device set WEST of the business would disagree.
        const earlyUtc = new Date('2026-08-30T01:00:00Z');

        return {
            zones: {
                ID: withCountry('ID', () => M.baseTimeZone()),
                PH: withCountry('PH', () => M.baseTimeZone()),
                SG: withCountry('SG', () => M.baseTimeZone()),
                MY: withCountry('MY', () => M.baseTimeZone())
            },
            eveningKeys: {
                ID: withCountry('ID', () => M.businessDayKey(evening)),
                PH: withCountry('PH', () => M.businessDayKey(evening))
            },
            earlyKeys: {
                ID: withCountry('ID', () => M.businessDayKey(earlyUtc))
            },
            // Start-of-day must be a real instant, and re-deriving the key from
            // it must land on the same day — the two are used together (the bar
            // filters on the instant, the counter keys on the string).
            roundTrip: withCountry('ID', () => {
                const start = M.startOfBusinessDay(evening);
                return {
                    iso: start.toISOString(),
                    keyOfStart: M.businessDayKey(start),
                    keyOfNow: M.businessDayKey(evening),
                    beforeNow: start.getTime() <= evening.getTime()
                };
            }),
            phRoundTrip: withCountry('PH', () => {
                const start = M.startOfBusinessDay(evening);
                return { iso: start.toISOString(), keyOfStart: M.businessDayKey(start) };
            }),
            // An unstamped legacy workspace has no country and must behave as
            // Indonesia, matching every other default in the currency work.
            absentCountry: withCountry(undefined, () => M.baseTimeZone())
        };
    });

    expect(r.zones).toEqual({
        ID: 'Asia/Jakarta', PH: 'Asia/Manila', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur'
    });

    // ── The bug itself. 22:30 UTC is already tomorrow for the business.
    expect(r.eveningKeys.ID, 'Jakarta is +07, so 22:30Z is the 31st').toBe('20260831');
    expect(r.eveningKeys.PH, 'Manila is +08, so 22:30Z is the 31st').toBe('20260831');
    expect(r.earlyKeys.ID, '01:00Z is 08:00 in Jakarta, still the 30th').toBe('20260830');

    // ── Start-of-day is a real instant that agrees with the key.
    expect(r.roundTrip.keyOfStart, 'start-of-day must fall on the same trading day')
        .toBe(r.roundTrip.keyOfNow);
    expect(r.roundTrip.beforeNow, 'the day cannot start after now').toBe(true);
    // Jakarta midnight on the 31st is 17:00Z on the 30th.
    expect(r.roundTrip.iso).toBe('2026-08-30T17:00:00.000Z');
    // Manila midnight on the 31st is 16:00Z on the 30th.
    expect(r.phRoundTrip.iso).toBe('2026-08-30T16:00:00.000Z');
    expect(r.phRoundTrip.keyOfStart).toBe('20260831');

    // ── Absent country = the Indonesian baseline, as everywhere else.
    expect(r.absentCountry).toBe('Asia/Jakarta');
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
