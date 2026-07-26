const { test, expect } = require('@playwright/test');

// Pure-logic unit test for CoA Phase 1: seed integrity of the expanded
// 32-account chart, the SAK validators, and a posting-behavior regression
// (the seed expansion must not change what the engine posts). Same pattern as
// accounting-engine.spec.js — import the ESM module in the browser, no I/O.

test('chart of accounts seed is internally consistent', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const seed = e.CHART_OF_ACCOUNTS_SEED;
        const byCode = Object.fromEntries(seed.map((a) => [a.code, a]));
        return {
            count: seed.length,
            codes: seed.map((a) => a.code),
            sakCategories: e.SAK_CATEGORIES,
            systemCodes: e.SYSTEM_ACCOUNT_CODES,
            badCodes: seed.filter((a) => !e.isValidAccountCode(a.code)).map((a) => a.code),
            badTypes: seed.filter((a) => !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(a.type)).map((a) => a.code),
            typeMismatch: seed.filter((a) => e.accountTypeForCode(a.code) && e.accountTypeForCode(a.code) !== a.type).map((a) => a.code),
            badSak: seed.filter((a) => !e.isValidSakCategory(a.sak_category)).map((a) => a.code),
            orphanParents: seed.filter((a) => a.parent_code && !byCode[a.parent_code]).map((a) => a.code),
            crossTypeParents: seed.filter((a) => a.parent_code && byCode[a.parent_code] && byCode[a.parent_code].type !== a.type).map((a) => a.code),
            contraOverrides: seed.filter((a) => a.normal_balance).map((a) => a.code),
            missingNameId: seed.filter((a) => !a.name_id).map((a) => a.code),
            mappableCount: seed.filter((a) => a.mappable !== false).length,
            draftChecks: {
                validChild: e.validateAccountDraft(
                    { code: '6470', type: 'expense', name: 'Depreciation Expense', sak_category: 'operating_expense', parent_code: '6400' },
                    { parent: byCode['6400'] }
                ),
                badCode: e.validateAccountDraft({ code: '64', type: 'expense', name: 'X' }),
                wrongBlockType: e.validateAccountDraft({ code: '6470', type: 'asset', name: 'X' }),
                crossTypeParent: e.validateAccountDraft(
                    { code: '6470', type: 'expense', name: 'X', parent_code: '4000' },
                    { parent: byCode['4000'] }
                ),
                selfParent: e.validateAccountDraft({ code: '6470', type: 'expense', name: 'X', parent_code: '6470' }),
                badSak: e.validateAccountDraft({ code: '6470', type: 'expense', name: 'X', sak_category: 'nonsense' })
            }
        };
    });

    // 32 unique, well-formed accounts.
    expect(r.count).toBe(32);
    expect(new Set(r.codes).size).toBe(r.count);
    expect(r.badCodes).toEqual([]);
    expect(r.badTypes).toEqual([]);
    expect(r.typeMismatch).toEqual([]);
    expect(r.badSak).toEqual([]);
    expect(r.missingNameId).toEqual([]);
    // Hierarchy: parents exist and share the child's type.
    expect(r.orphanParents).toEqual([]);
    expect(r.crossTypeParents).toEqual([]);
    // Contra normal-balance overrides exist ONLY on 3200 and 4900.
    expect(r.contraOverrides.sort()).toEqual(['3200', '4900']);
    // System set covers every code the engines/defaults hardcode.
    const requiredSystem = ['1000', '1100', '2000', '3000', '3900', '4000',
        '6100', '6200', '6300', '6400', '6500', '6600', '6999',
        '1130', '1140', '1150', '2100', '2110', '2200'];
    expect([...r.systemCodes].sort()).toEqual([...requiredSystem].sort());
    // 16-value SAK enum; catalog derivation admits 23 mappable accounts.
    expect(r.sakCategories.length).toBe(16);
    expect(r.mappableCount).toBe(23);
    // Validators.
    expect(r.draftChecks.validChild.ok).toBe(true);
    for (const key of ['badCode', 'wrongBlockType', 'crossTypeParent', 'selfParent', 'badSak']) {
        expect(r.draftChecks[key].ok, `${key} must fail validation`).toBe(false);
    }
});

test('seed expansion does not change posting behavior', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/accounting-engine.js');
        const d = new Date('2026-06-15T03:00:00Z');
        const j = (collection, id, document, mappings) => e.buildJournal({ collection, id, document, mappings, date: document.timestamp });
        const codesOf = (jr) => jr.lines.map((l) => `${l.account_code}:${l.debit}:${l.credit}`);
        return {
            expense: codesOf(j('transactions', 't1', { type: 'expense', amount: 150000, category: 'Marketing', timestamp: d })),
            income: codesOf(j('transactions', 't2', { type: 'income', amount: 5000000, category: 'Revenue', timestamp: d })),
            unmapped: codesOf(j('transactions', 't3', { type: 'expense', amount: 7000, category: 'Something Custom', timestamp: d })),
            // A saved mapping to a NEW seed account routes there (the mapping
            // seam admits the expanded chart)...
            rentMapped: codesOf(j('transactions', 't4', { type: 'expense', amount: 9000, category: 'Rent', timestamp: d }, { 'category:Rent': '6420' })),
            // ...and prive works today through the expense path (Dr equity contra / Cr cash).
            priveMapped: codesOf(j('transactions', 't5', { type: 'expense', amount: 11000, category: 'Owner Drawing', timestamp: d }, { 'category:Owner Drawing': '3200' })),
            priveLineType: j('transactions', 't5b', { type: 'expense', amount: 11000, category: 'Owner Drawing', timestamp: d }, { 'category:Owner Drawing': '3200' }).lines[0].account_type
        };
    });

    // Unchanged legacy behavior, byte-for-byte on the posting lines.
    expect(r.expense).toEqual(['6100:150000:0', '1000:0:150000']);
    expect(r.income).toEqual(['1000:5000000:0', '4000:0:5000000']);
    expect(r.unmapped).toEqual(['6999:7000:0', '1000:0:7000']);
    // New accounts are reachable only via explicit mappings.
    expect(r.rentMapped).toEqual(['6420:9000:0', '1000:0:9000']);
    expect(r.priveMapped).toEqual(['3200:11000:0', '1000:0:11000']);
    expect(r.priveLineType).toBe('equity');
});
