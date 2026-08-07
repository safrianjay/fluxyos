'use strict';

/**
 * Guards netlify/functions/statements-xlsx.js — the accounting workbook writer.
 *
 * Runs without credentials or a browser (the Playwright suite serves static
 * files only, so a Netlify function is unreachable there). Token verification is
 * the one thing stubbed; everything else is the real handler.
 *
 * The contract this protects, in priority order:
 *   1. Amounts arrive as NUMBERS, not text. An accountant has to be able to sum
 *      a column — a workbook of strings is a worse deliverable than the CSV it
 *      replaced, and the failure is invisible until someone tries to total it.
 *   2. Every tab is self-describing (period, basis, tie-out), matching the CSV
 *      header contract so one tab can be read without opening the others.
 *   3. No formatted currency anywhere — raw integer IDR, per
 *      PROJECT_BACKGROUND.md §13.
 *   4. The endpoint is not an open document generator.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Resolve `xlsx` from the repo root regardless of cwd.
const XLSX = require(require.resolve('xlsx', { paths: [ROOT] }));
const handler = require(path.join(ROOT, 'netlify', 'functions', 'statements-xlsx.js')).handler;

process.env.FIREBASE_API_KEY = 'test-key';
const realFetch = global.fetch;
global.fetch = async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) });

const PERIOD = { start: '2026-07-01', end: '2026-07-31' };
const INTEGRITY = { trialBalanced: true, bsBalanced: true, bsDelta: 0, cfBalanced: false, cfDelta: -110 };

const SHEETS = [
    {
        key: 'income_statement', title: 'Income Statement',
        columns: ['Section', 'Account code', 'Account', 'Amount (IDR)', 'Comparison (IDR)'],
        rows: [
            ['Revenue', '4000', 'Sales', 417164874, 300000000],
            ['', '', 'Net income', -379000000, 4200000],
        ],
    },
    {
        key: 'balance_sheet', title: 'Balance Sheet',
        columns: ['Section', 'Account code', 'Account', 'Amount (IDR)'],
        rows: [['Assets', '1000', 'Cash', 1234567], ['', '', 'Total liabilities & equity', 1234567]],
    },
];

function post(body, { auth = 'Bearer t' } = {}) {
    return handler({
        httpMethod: 'POST',
        headers: { origin: 'https://dashboard.fluxyos.com', authorization: auth },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function readBook(res) {
    return XLSX.read(Buffer.from(res.body, 'base64'), { type: 'buffer' });
}

const checks = [];
function check(name, fn) { checks.push([name, fn]); }

check('builds one tab per statement, named for the statement', async () => {
    const res = await post({ period: PERIOD, integrity: INTEGRITY, sheets: SHEETS });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.isBase64Encoded, true);
    assert.match(res.headers['Content-Type'], /spreadsheetml\.sheet$/);
    const wb = readBook(res);
    assert.deepStrictEqual(wb.SheetNames, ['Income Statement', 'Balance Sheet']);
});

check('amounts are numeric cells, so a column can be summed', async () => {
    const res = await post({ period: PERIOD, integrity: INTEGRITY, sheets: SHEETS });
    const ws = readBook(res).Sheets['Income Statement'];
    // 8 header rows + 1 blank + 1 column row => data starts at row 11.
    assert.strictEqual(ws.D11.t, 'n', 'revenue amount must be a number cell');
    assert.strictEqual(ws.D11.v, 417164874);
    assert.strictEqual(ws.D12.t, 'n', 'a negative net income must stay numeric');
    assert.strictEqual(ws.D12.v, -379000000);
});

check('every tab declares period, basis and tie-out', async () => {
    const res = await post({ period: PERIOD, integrity: INTEGRITY, sheets: SHEETS });
    const wb = readBook(res);
    for (const name of wb.SheetNames) {
        const text = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        for (const field of ['Report,', 'Period,', 'Basis,', 'Trial balance,', 'Balance sheet tie-out,', 'Cash flow tie-out,']) {
            assert.ok(text.includes(field), `${name} must declare "${field}"`);
        }
        assert.ok(text.includes('2026-07-01 to 2026-07-31'), `${name} must state the period range`);
        assert.ok(!/Rp[\d.]/.test(text), `${name} must not contain formatted currency`);
    }
});

check('a failing tie-out is stated, not hidden', async () => {
    const res = await post({ period: PERIOD, integrity: INTEGRITY, sheets: SHEETS });
    const text = XLSX.utils.sheet_to_csv(readBook(res).Sheets['Balance Sheet']);
    assert.ok(text.includes('Out by -110'), 'a non-zero cash-flow delta must appear on the tab');
});

check('illegal and colliding sheet names are made safe', async () => {
    const res = await post({
        period: PERIOD, integrity: INTEGRITY,
        sheets: [
            { title: 'A/B:C?D*E[F]', columns: ['x'], rows: [['1']] },
            { title: 'A/B:C?D*E[F]', columns: ['x'], rows: [['2']] },
        ],
    });
    assert.strictEqual(res.statusCode, 200);
    const names = readBook(res).SheetNames;
    assert.strictEqual(names.length, 2, 'a duplicate title must not collapse two tabs into one');
    names.forEach((n) => {
        assert.ok(n.length <= 31, `sheet name too long: ${n}`);
        assert.ok(!/[:\\/?*[\]]/.test(n), `sheet name has an illegal character: ${n}`);
    });
});

check('null and non-finite cells do not become the text "null" or "NaN"', async () => {
    const res = await post({
        period: PERIOD, integrity: INTEGRITY,
        sheets: [{ title: 'Edge', columns: ['A', 'B'], rows: [[null, Number.NaN], [undefined, 5]] }],
    });
    const text = XLSX.utils.sheet_to_csv(readBook(res).Sheets.Edge);
    assert.ok(!/\bnull\b/.test(text), 'null must render as an empty cell');
    assert.ok(!/\bNaN\b/i.test(text), 'a non-finite number must render as an empty cell');
});

check('rejects unauthenticated and malformed callers', async () => {
    assert.strictEqual((await post({ period: PERIOD, sheets: SHEETS }, { auth: '' })).statusCode, 401);
    assert.strictEqual((await post('not json')).statusCode, 400);
    assert.strictEqual((await post({ sheets: SHEETS })).statusCode, 400, 'a missing period must be rejected');
    assert.strictEqual((await post({ period: PERIOD, sheets: [] })).statusCode, 400);
    assert.strictEqual(
        (await post({ period: PERIOD, sheets: [{ title: 'x', columns: ['a'], rows: ['not-an-array'] }] })).statusCode,
        400, 'rows must be arrays');
    const res = await handler({ httpMethod: 'GET', headers: {}, body: null });
    assert.strictEqual(res.statusCode, 405);
});

check('an expired token is refused even with a well-formed body', async () => {
    global.fetch = async () => ({ ok: false, json: async () => ({}) });
    try {
        const res = await post({ period: PERIOD, integrity: INTEGRITY, sheets: SHEETS });
        assert.strictEqual(res.statusCode, 401);
    } finally {
        global.fetch = async () => ({ ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) });
    }
});

(async () => {
    let failed = 0;
    for (const [name, fn] of checks) {
        try {
            await fn();
            console.log(`  ok   ${name}`);
        } catch (err) {
            failed += 1;
            console.error(`  FAIL ${name}\n       ${err.message}`);
        }
    }
    global.fetch = realFetch;
    if (failed) {
        console.error(`\n${failed} statements-workbook check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll statements-workbook checks passed.');
})();
