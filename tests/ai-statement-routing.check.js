'use strict';

/**
 * Fluxy AI statement routing — no network, no Firestore.
 *
 * "Buatkan balance sheet di Excel" used to fall through to the ambiguous branch
 * and get a polite decline, because no intent covered financial statements.
 * This guards the routing that replaced that, and the two things about it that
 * could go quietly wrong:
 *
 *   1. Keyword ORDER. "income statement" contains "income" and "neraca saldo"
 *      contains "neraca". Get the order wrong and the user asking for an Income
 *      Statement receives a revenue analysis, or a Trial Balance request opens
 *      the Balance Sheet — both look like plausible answers, so neither is
 *      obvious in manual testing.
 *   2. The route ALLOWLIST. `recommended_actions` is a field the model writes.
 *      Without a closed set, a prompt injection could render an arbitrary link
 *      inside a trusted panel of the app.
 *
 * Run: node tests/ai-statement-routing.check.js
 */

delete process.env.OPENAI_API_KEY; // deterministic answers only
process.env.FIREBASE_PROJECT_ID = 'fluxyos-test';

const assert = require('assert');
const {
    classifyIntent, isStatementRequest, statementTargetFor,
    buildDeterministicAnswer, sanitizeActions, ACTION_ROUTES,
} = require('../netlify/functions/api').__test__;

const PERIOD = { label: 'this month', start: '2026-08-01', end: '2026-08-31' };

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('statement requests route to statement_export, in EN and ID', () => {
    const asks = [
        'can you make me a balance sheet in excel',
        'export the income statement',
        'buatkan neraca dalam excel',
        'download laporan laba rugi',
        'show me the trial balance',
        'unduh buku besar',
        'i need the financial statements for july',
        'laporan keuangan bulan ini',
    ];
    asks.forEach((m) => {
        assert.strictEqual(classifyIntent(m, 'accounting'), 'statement_export', `not routed: "${m}"`);
    });
});

check('"income statement" is not stolen by the revenue keyword rule', () => {
    // The bug this prevents: 'income statement'.includes('income') is true, and
    // the revenue rule sits further down the same function.
    assert.strictEqual(classifyIntent('export the income statement', 'global'), 'statement_export');
    assert.strictEqual(classifyIntent('laporan laba rugi', 'global'), 'statement_export');
    // ...while a genuine revenue question is untouched.
    assert.strictEqual(classifyIntent('how much income did we make', 'global'), 'revenue_analysis');
    assert.strictEqual(classifyIntent('show me revenue this month', 'global'), 'revenue_analysis');
});

check('ordinary analysis questions are NOT hijacked', () => {
    const notStatements = [
        ['how is my cash flow', 'global'],          // analysis, no file asked for
        ['bagaimana arus kas saya', 'global'],
        ['what should i fix first', 'global'],
        ['which vendor costs the most', 'global'],
        ['are my books healthy', 'global'],
    ];
    notStatements.forEach(([m, ctx]) => {
        assert.notStrictEqual(classifyIntent(m, ctx), 'statement_export', `wrongly routed: "${m}"`);
    });
});

check('"cash flow" routes to the statement only when a file is asked for', () => {
    assert.strictEqual(isStatementRequest('how is my cash flow'), false);
    assert.strictEqual(isStatementRequest('export my cash flow statement'), true);
    assert.strictEqual(isStatementRequest('unduh arus kas ke excel'), true);
});

check('the named statement decides the destination tab', () => {
    const cases = [
        ['export the balance sheet', '/accounting?tab=balance'],
        ['buatkan neraca', '/accounting?tab=balance'],
        ['show the trial balance', '/accounting?tab=trial'],
        ['neraca saldo', '/accounting?tab=trial'],       // must beat 'neraca'
        ['download the income statement', '/accounting?tab=income'],
        ['export cash flow to excel', '/accounting?tab=cashflow'],
    ];
    cases.forEach(([m, route]) => {
        assert.strictEqual(statementTargetFor(m).route, route, `wrong tab for "${m}"`);
    });
});

check('the answer routes without quoting a figure it did not compute', () => {
    const a = buildDeterministicAnswer({
        intent: 'statement_export', message: 'export the balance sheet',
        pageContext: 'accounting', period: PERIOD, tools: {}, language: 'en',
    });
    assert.strictEqual(a.intent, 'statement_export');
    assert.deepStrictEqual(a.key_numbers, [], 'routing must not invent figures');
    assert.ok(a.direct_answer.includes('Balance Sheet'), 'the answer must name the statement asked for');
    assert.ok(a.recommended_actions.length >= 1);
    assert.strictEqual(a.recommended_actions[0].route, '/accounting?tab=balance');
    assert.ok(a.limitations.length, 'it must say it does not generate the file itself');
});

check('the Indonesian answer is Indonesian, not English with an ID label', () => {
    const a = buildDeterministicAnswer({
        intent: 'statement_export', message: 'buatkan neraca',
        pageContext: 'accounting', period: PERIOD, tools: {}, language: 'id',
    });
    assert.ok(a.direct_answer.includes('Neraca'));
    assert.ok(/tersedia|Buka/.test(a.direct_answer), 'ID answer must be written in ID');
    assert.ok(!/lives in|Open it there/.test(a.direct_answer), 'ID answer leaked English copy');
    assert.strictEqual(a.recommended_actions[0].route, '/accounting?tab=balance');
});

check('sanitizeActions drops any route outside the allowlist', () => {
    // sanitizeActions caps the list at 5, so this stays within it.
    const cleaned = sanitizeActions([
        { title: 'a', description: 'd', route: 'https://evil.example/steal' },
        { title: 'b', description: 'd', route: 'javascript:alert(1)' },
        { title: 'c', description: 'd', route: '//evil.example' },
        { title: 'd', description: 'd', route: '/accounting?tab=balance&x=1' }, // near-miss
        { title: 'e', description: 'd', route: '/accounting?tab=balance' },     // the only valid one
    ]);
    assert.strictEqual(cleaned.length, 5, 'actions themselves must survive; only the route is stripped');
    cleaned.slice(0, 4).forEach((a, i) => {
        assert.strictEqual(a.route, undefined, `hostile route ${i} was not stripped`);
    });
    assert.strictEqual(cleaned[4].route, '/accounting?tab=balance');
});

check('a path-traversal route is stripped even though it starts with "/"', () => {
    const [a] = sanitizeActions([{ title: 'x', description: 'd', route: '/../../etc/passwd' }]);
    assert.strictEqual(a.route, undefined);
});

check('sanitizeActions still caps the list at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, description: 'd' }));
    assert.strictEqual(sanitizeActions(many).length, 5);
});

check('every allowlisted route is a same-origin path', () => {
    assert.ok(ACTION_ROUTES.size > 0);
    for (const route of ACTION_ROUTES) {
        assert.match(route, /^\/[A-Za-z0-9/?=&_-]*$/, `not a safe same-origin path: ${route}`);
    }
});

let failed = 0;
for (const [name, fn] of checks) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL ${name}\n       ${err.message}`);
    }
}
if (failed) {
    console.error(`\n${failed} statement-routing check(s) failed.`);
    process.exit(1);
}
console.log('\nAI STATEMENT ROUTING PASS');
