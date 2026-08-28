const { test, expect } = require('@playwright/test');

// Pure-logic tests for assets/js/coa-import.js — same pattern as
// inventory-import.spec.js: no auth, no Firestore, the module imported into a
// page and exercised directly.
//
// The chart is the thing every posting rule addresses by code, so the failure
// mode of a bad import is not a crash. It is a cost filed under income, or a
// system account quietly renamed out from under the tax engine.

async function engine(page) { await page.goto('/pricing'); return page; }

test('the block→type map agrees with accounting-engine', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const coa = await import('/assets/js/coa-import.js');
        const acct = await import('/assets/js/accounting-engine.js');
        // accountTypeForCode is not exported, so it is exercised through the
        // validator: a draft whose type disagrees with its block must fail.
        const out = {};
        ['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000'].forEach((code) => {
            const mine = coa.typeForCode(code);
            // Ask the real validator whether 'expense' is acceptable for this code.
            const asExpense = acct.validateAccountDraft({ code, name: 'x', type: 'expense' });
            out[code] = { mine, expenseOk: asExpense.ok };
        });
        return out;
    });

    // Where the block has a type, ours must name it, and the real validator must
    // reject a contradicting one.
    expect(r['1000'].mine).toBe('asset');
    expect(r['1000'].expenseOk).toBe(false);
    expect(r['4000'].mine).toBe('revenue');
    expect(r['4000'].expenseOk).toBe(false);
    expect(r['6000'].mine).toBe('expense');
    expect(r['6000'].expenseOk).toBe(true);
    expect(r['7000'].mine).toBe('revenue');
    // 9xxx has no assigned type in either — "any type allowed". A stricter copy
    // here would reject rows the real validator accepts.
    expect(r['9000'].mine).toBeNull();
    expect(r['9000'].expenseOk).toBe(true);
});

test('the code is the upsert key: existing updates, new creates', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/coa-import.js');
        const header = m.COA_TEMPLATE_COLUMNS.map((c) => c.header);
        const out = m.analyzeCoaImport([
            header,
            ['6100', 'Marketing Spend', 'expense', 'Beban Pemasaran', '', 'operating_expense'],
            ['6480', 'Training', 'expense', 'Pelatihan', '6400', 'operating_expense'],
            ['6420', 'Rent Expense', 'expense', 'Beban Sewa', '', 'operating_expense']
        ], {
            existingAccounts: [
                { code: '6100', name: 'Marketing Expense', name_id: 'Beban Pemasaran', type: 'expense', sak_category: 'operating_expense', is_system: false },
                { code: '6400', name: 'Operations Expense', type: 'expense', sak_category: 'operating_expense' },
                { code: '6420', name: 'Rent Expense', name_id: 'Beban Sewa', type: 'expense', sak_category: 'operating_expense', is_system: false }
            ]
        });
        return { statuses: out.rows.map((x) => [x.code, x.status]), summary: out.summary };
    });

    // 6100 exists and the name differs → update, not a duplicate.
    expect(r.statuses).toContainEqual(['6100', 'update']);
    // 6480 is new, and its parent 6400 exists.
    expect(r.statuses).toContainEqual(['6480', 'create']);
    // 6420 exists and the file says nothing new — silence is not a change.
    expect(r.statuses).toContainEqual(['6420', 'unchanged']);
    expect(r.summary.create).toBe(1);
    expect(r.summary.update).toBe(1);
    expect(r.summary.unchanged).toBe(1);
});

test('a system account is reported, never quietly changed', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/coa-import.js');
        const header = m.COA_TEMPLATE_COLUMNS.map((c) => c.header);
        const out = m.analyzeCoaImport([
            header,
            ['1000', 'Bank Accounts', 'asset', '', '', 'cash_bank']
        ], {
            existingAccounts: [{ code: '1000', name: 'Cash & Bank', type: 'asset', sak_category: 'cash_bank', is_system: true }]
        });
        return { status: out.rows[0].status, warned: out.rows[0].warnings.map((w) => w.code) };
    });
    // The posting and tax engines address 1000 by code; renaming it from a
    // spreadsheet would re-point journals with nothing said.
    expect(r.status).toBe('skipped');
    expect(r.warned).toContain('COA_010');
});

test('the thousand block and the type must agree', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/coa-import.js');
        const header = m.COA_TEMPLATE_COLUMNS.map((c) => c.header);
        const out = m.analyzeCoaImport([
            header,
            ['6100', 'Mislabelled', 'revenue', '', '', ''],
            ['12', 'Too short', 'asset', '', '', ''],
            ['6200', 'Bad category', 'expense', '', '', 'not_a_category'],
            ['6300', 'Orphan', 'expense', '', '9999', '']
        ], { existingAccounts: [] });
        return out.rows.map((x) => ({ code: x.code, code0: (x.errors[0] || {}).code }));
    });
    // A 6xxx row calling itself revenue would file a cost under income on every
    // statement it touches.
    expect(r[0].code0).toBe('COA_005');
    expect(r[1].code0).toBe('COA_004');
    expect(r[2].code0).toBe('COA_007');
    expect(r[3].code0).toBe('COA_008');
});

test('a parent defined later in the same file is accepted', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/coa-import.js');
        const header = m.COA_TEMPLATE_COLUMNS.map((c) => c.header);
        // Child first, parent second — a perfectly ordinary export.
        const out = m.analyzeCoaImport([
            header,
            ['6410', 'Salaries', 'expense', '', '6400', 'operating_expense'],
            ['6400', 'Operations', 'expense', '', '', 'operating_expense']
        ], { existingAccounts: [] });
        return out.rows.map((x) => x.status);
    });
    expect(r).toEqual(['create', 'create']);
});

test('the template round-trips through its own analyzer', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/coa-import.js');
        const accounts = [
            { code: '1000', name: 'Cash & Bank', name_id: 'Kas & Bank', type: 'asset', sak_category: 'cash_bank', is_system: true },
            { code: '6420', name: 'Rent Expense', name_id: 'Beban Sewa', type: 'expense', sak_category: 'operating_expense' }
        ];
        const csv = m.buildCoaTemplateCsv(accounts);
        const parse = (text) => {
            const rows = []; let row = [], cur = '', q = false;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '"' && q && text[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = !q;
                else if (ch === ',' && !q) { row.push(cur); cur = ''; }
                else if ((ch === '\n' || ch === '\r') && !q) {
                    if (ch === '\r' && text[i + 1] === '\n') i++;
                    row.push(cur); cur = '';
                    if (row.some((v) => v !== '')) rows.push(row);
                    row = [];
                } else cur += ch;
            }
            row.push(cur);
            if (row.some((v) => v !== '')) rows.push(row);
            return rows;
        };
        const out = m.analyzeCoaImport(parse(csv.replace(/^﻿/, '')), { existingAccounts: accounts });
        return { ok: out.ok, summary: out.summary, notes: out.skippedNoteRows, statuses: out.rows.map((x) => [x.code, x.status]) };
    });

    expect(r.ok).toBe(true);
    // Exporting the chart and importing it back changes nothing, and the
    // guidance row is skipped rather than reported as a bad code.
    expect(r.notes).toBe(1);
    expect(r.summary.create).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(r.statuses).toContainEqual(['1000', 'skipped']);
    expect(r.statuses).toContainEqual(['6420', 'unchanged']);
});
