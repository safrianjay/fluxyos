const { test, expect } = require('@playwright/test');

// Pure tests for assets/js/depreciation-engine.js.
//
// Depreciation decides journal amounts, so the failure mode is not a crash — it
// is a schedule that sums to slightly less than the asset, leaving a residue in
// 1590 that nothing ever clears and that no report explains.

async function engine(page) { await page.goto('/pricing'); return page; }

const OVEN = {
    name: 'Oven', cost: 10_000_000, salvage_value: 0,
    useful_life_months: 36, in_service_date: '2026-01-15', asset_account_code: '1500'
};

test('a schedule sums to the depreciable base EXACTLY, whatever the numbers', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/depreciation-engine.js');
        const sum = (a) => m.depreciationSchedule(a).reduce((t, x) => t + x.amount, 0);
        const base = { name: 'A', in_service_date: '2026-01-15', asset_account_code: '1500', salvage_value: 0 };
        // Deliberately awkward: lives that do not divide the cost.
        const cases = [
            { ...base, cost: 10_000_000, useful_life_months: 36 },
            { ...base, cost: 1_000_000, useful_life_months: 7 },
            { ...base, cost: 999_999, useful_life_months: 13 },
            { ...base, cost: 1, useful_life_months: 12 },
            { ...base, cost: 7, useful_life_months: 3 },
            { ...base, cost: 10_000_000, salvage_value: 1_000_000, useful_life_months: 36 }
        ];
        return cases.map((c) => ({
            cost: c.cost, life: c.useful_life_months, salvage: c.salvage_value || 0,
            sum: sum(c), periods: m.depreciationSchedule(c).length
        }));
    });

    r.forEach((c) => {
        // The property that matters: no residue, ever.
        expect(c.sum, `${c.cost} over ${c.life}mo salvage ${c.salvage}`).toBe(c.cost - c.salvage);
        expect(c.periods).toBe(c.life);
    });
});

test('a cost smaller than its life still fully depreciates', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/depreciation-engine.js');
        // 1 minor unit over 12 months. Per-period rounding would give 0 every
        // month and never retire the asset; cumulative rounding gives eleven
        // zeros and a one.
        const s = m.depreciationSchedule({
            name: 'Tiny', cost: 1, salvage_value: 0, useful_life_months: 12,
            in_service_date: '2026-01-01', asset_account_code: '1500'
        });
        return { amounts: s.map((x) => x.amount), sum: s.reduce((t, x) => t + x.amount, 0) };
    });
    expect(r.sum).toBe(1);
    expect(r.amounts.filter((a) => a > 0).length).toBe(1);
});

test('what is due excludes what was already posted', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (asset) => {
        const m = await import('/assets/js/depreciation-engine.js');
        return {
            fresh: m.depreciationDue(asset, '2026-03').periods.map((p) => p.period_key),
            resumed: m.depreciationDue(asset, '2026-03', { postedThrough: '2026-02' }).periods.map((p) => p.period_key),
            caughtUp: m.depreciationDue(asset, '2026-03', { postedThrough: '2026-03' }).periods.map((p) => p.period_key),
            // Before it was even in service.
            early: m.depreciationDue(asset, '2025-12').periods.map((p) => p.period_key)
        };
    }, OVEN);

    // Periods come back individually, never summed — one journal each, or six
    // months of cost lands in one month's P&L.
    expect(r.fresh).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.resumed).toEqual(['2026-03']);
    expect(r.caughtUp).toEqual([]);
    expect(r.early).toEqual([]);
});

test('an asset stops when it is fully depreciated', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (asset) => {
        const m = await import('/assets/js/depreciation-engine.js');
        return {
            // 36 months from 2026-01 ends 2028-12. Asking for more owes nothing more.
            beyond: m.depreciationDue(asset, '2030-01', { postedThrough: '2028-12' }).periods.length,
            allOf: m.depreciationDue(asset, '2030-01').total,
            bookAtEnd: m.bookValueAt(asset, '2028-12'),
            bookMidway: m.bookValueAt(asset, '2026-12'),
            doneAtEnd: m.isFullyDepreciated(asset, '2028-12'),
            doneMidway: m.isFullyDepreciated(asset, '2027-06')
        };
    }, OVEN);

    expect(r.beyond).toBe(0);
    expect(r.allOf).toBe(10_000_000);
    expect(r.bookAtEnd).toBe(0);
    // 12 of 36 months taken.
    expect(r.bookMidway).toBe(10_000_000 - 3_333_333);
    expect(r.doneAtEnd).toBe(true);
    expect(r.doneMidway).toBe(false);
});

test('residual value is kept on the books, never depreciated away', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/depreciation-engine.js');
        const a = {
            name: 'Van', cost: 100_000_000, salvage_value: 20_000_000,
            useful_life_months: 60, in_service_date: '2026-01-01', asset_account_code: '1510'
        };
        return { book: m.bookValueAt(a, '2030-12'), total: m.depreciationDue(a, '2030-12').total };
    });
    // A van worth Rp20jt at the end is still worth Rp20jt on the balance sheet.
    expect(r.book).toBe(20_000_000);
    expect(r.total).toBe(80_000_000);
});

test('an invalid asset is refused rather than silently producing no schedule', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/depreciation-engine.js');
        const bad = (o) => m.validateAssetDraft(o).errors.map((e) => e.code);
        const ok = { name: 'A', cost: 100, salvage_value: 0, useful_life_months: 12, in_service_date: '2026-01-01', asset_account_code: '1500' };
        return {
            noName: bad({ ...ok, name: '' }),
            zeroCost: bad({ ...ok, cost: 0 }),
            zeroLife: bad({ ...ok, useful_life_months: 0 }),
            fractionalLife: bad({ ...ok, useful_life_months: 12.5 }),
            centuryLife: bad({ ...ok, useful_life_months: 1200 }),
            badDate: bad({ ...ok, in_service_date: '15/01/2026' }),
            salvageOverCost: bad({ ...ok, salvage_value: 200 }),
            negativeSalvage: bad({ ...ok, salvage_value: -1 }),
            badAccount: bad({ ...ok, asset_account_code: '99' }),
            // Salvage EQUAL to cost is legal: on the balance sheet, out of the P&L.
            salvageEqualsCost: m.validateAssetDraft({ ...ok, salvage_value: 100 }).ok,
            valid: m.validateAssetDraft(ok).ok
        };
    });

    expect(r.noName).toContain('FA_001');
    expect(r.zeroCost).toContain('FA_002');
    expect(r.zeroLife).toContain('FA_003');
    expect(r.fractionalLife).toContain('FA_003');
    expect(r.centuryLife).toContain('FA_003');
    expect(r.badDate).toContain('FA_004');
    expect(r.salvageOverCost).toContain('FA_005');
    expect(r.negativeSalvage).toContain('FA_005');
    expect(r.badAccount).toContain('FA_006');
    expect(r.salvageEqualsCost).toBe(true);
    expect(r.valid).toBe(true);
});

test('the journal balances and names each asset on its own debit line', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const { buildDepreciationJournal } = await import('/assets/js/accounting-engine.js');
        const j = buildDepreciationJournal({
            lines: [{ amount: 277778, description: 'Oven' }, { amount: 150000, description: 'Motor' }],
            periodKey: '2026-01'
        });
        return {
            balanced: j.is_balanced,
            debit: j.total_debit,
            credit: j.total_credit,
            rule: j.posting_rule_id,
            period: j.period_key,
            lines: j.lines.map((l) => [l.account_code, l.debit, l.credit, l.memo]),
            empty: buildDepreciationJournal({ lines: [] })
        };
    });

    expect(r.balanced).toBe(true);
    expect(r.debit).toBe(427778);
    expect(r.credit).toBe(427778);
    expect(r.rule).toBe('DEPRECIATION');
    expect(r.period).toBe('2026-01');
    // "Depreciation was Rp427.778" is not an answer anybody can check, so each
    // asset gets its own debit line…
    expect(r.lines[0]).toEqual(['6470', 277778, 0, 'Oven']);
    expect(r.lines[1]).toEqual(['6470', 150000, 0, 'Motor']);
    // …while the credit stays pooled: 1590 is a contra-asset with no per-asset
    // balance on the balance sheet, so splitting it would imply one.
    expect(r.lines[2]).toEqual(['1590', 0, 427778, 'Accumulated depreciation']);
    // Nothing due posts nothing at all, rather than an empty journal.
    expect(r.empty).toBeNull();
});
