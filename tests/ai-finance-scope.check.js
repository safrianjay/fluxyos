'use strict';

/**
 * Fluxy AI (brain/chat) finance-read check — no network, no Firestore.
 *
 * Guards the regression where the AI answered "0" for a week that had data:
 * finance collections are workspace-scoped (migrated users/{uid}/* ->
 * workspaces/{workspaceId}/* on 2026-06-22), but the backend still read
 * users/{uid}/*, which is the frozen pre-migration copy. Reading it does not
 * error, so every recent period computed as zero.
 *
 * Run: node tests/ai-finance-scope.check.js
 */

delete process.env.OPENAI_API_KEY; // deterministic answers only
process.env.FIREBASE_PROJECT_ID = 'fluxyos-test';

const assert = require('assert');

const api = require('../netlify/functions/api');
const finance = api.digest;
const { buildBrainChatResponse, resolveFinanceScopes } = api.__test__;

const UID = 'ownerUid';
const D = 24 * 60 * 60 * 1000;
// Inside "last week" for the engine (Jakarta weeks, Monday-start).
const LAST_WEEK_MS = finance.startOfWeek(finance.todayJakarta()).getTime() - 3 * D;
const OLD_MS = Date.now() - 120 * D;

const rfc = (ms) => new Date(ms).toISOString();

function txDoc(id, type, amount, ms, extra = {}) {
    return {
        name: `projects/p/databases/(default)/documents/x/${id}`,
        fields: {
            vendor_name: { stringValue: type === 'income' ? 'Client A' : 'AWS' },
            category: { stringValue: type === 'income' ? 'Revenue' : 'Infrastructure' },
            type: { stringValue: type },
            status: { stringValue: extra.status || 'Completed' },
            amount: { integerValue: String(amount) },
            timestamp: { timestampValue: rfc(ms) },
            ...(extra.is_voided ? { is_voided: { booleanValue: true } } : {}),
        },
    };
}

const LAST_WEEK_LEDGER = [
    txDoc('t1', 'income', 5000000, LAST_WEEK_MS),
    txDoc('t2', 'expense', 2000000, LAST_WEEK_MS),
];
const STALE_LEDGER = [txDoc('old1', 'income', 111000, OLD_MS)];

// Firestore REST double. `store` maps 'workspaces/x/transactions' -> [docs].
// Emulates the two shapes api.js uses: list GET and :runQuery POST.
function installFetch(store, { denyScopes = [], pointer = undefined } = {}) {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
        const u = String(url);
        calls.push(u);
        const path = u.split('/documents/')[1] || '';
        const json = (status, body) => ({
            ok: status < 400,
            status,
            async json() { return body; },
            async text() { return JSON.stringify(body); },
        });

        if (path.startsWith('user_workspaces/')) {
            if (pointer === undefined) return json(404, {});
            return json(200, {
                name: `projects/p/databases/(default)/documents/${path}`,
                fields: {
                    default: { stringValue: pointer },
                    workspaceIds: { arrayValue: { values: [{ stringValue: pointer }] } },
                },
            });
        }

        const docId = (d) => String(d.name).split('/').pop();

        if (u.includes(':runQuery')) {
            const scope = path.replace(':runQuery', '');
            const { from, orderBy: order, limit } = JSON.parse(opts.body).structuredQuery;
            const collectionId = from[0].collectionId;
            const orderField = order[0].field.fieldPath;
            if (denyScopes.includes(scope)) return json(403, { error: 'denied' });
            const docs = store[`${scope}/${collectionId}`] || [];
            const rows = [...docs]
                // Firestore skips documents that lack the ordered field.
                .filter((d) => d.fields[orderField])
                .sort((a, b) => Date.parse(b.fields[orderField].timestampValue) - Date.parse(a.fields[orderField].timestampValue))
                .slice(0, limit)
                .map((document) => ({ document }));
            return json(200, rows.length ? rows : [{ readTime: rfc(Date.now()) }]);
        }

        const scope = path.split('?')[0].split('/').slice(0, -1).join('/');
        const collectionId = path.split('?')[0].split('/').pop();
        if (denyScopes.includes(scope)) return json(403, { error: 'denied' });
        // A list read is document-ID ordered and capped by pageSize — that cap is
        // exactly how recent records go missing from an unordered read.
        const pageSize = Number((u.match(/pageSize=(\d+)/) || [])[1]) || 1000;
        const documents = [...(store[`${scope}/${collectionId}`] || [])]
            .sort((a, b) => docId(a).localeCompare(docId(b)))
            .slice(0, pageSize);
        return json(200, { documents });
    };
    return calls;
}

async function ask(message, { workspaceId = null, snapshot = undefined } = {}) {
    const result = await buildBrainChatResponse({
        request: { message, page_context: 'ai_command_center', language: 'en', workspace_id: workspaceId, finance_snapshot: snapshot },
        uid: UID,
        token: 'test-token',
    });
    const answer = result.body.answer || {};
    const revenue = (answer.key_numbers || []).find((k) => /revenue/i.test(k.label));
    return { answer, revenue: revenue ? Number(revenue.value) : null, type: answer.answer_type };
}

let failures = 0;
const check = (label, fn) => {
    try { fn(); console.log(`✅ ${label}`); } catch (e) { failures += 1; console.log(`❌ ${label} — ${e.message}`); }
};

async function main() {
    const realFetch = global.fetch;

    // 1) Scope order: resolved workspace first, legacy user path last.
    installFetch({}, { pointer: 'wsOwner' });
    const scopes = await resolveFinanceScopes(UID, 't', 'wsFromClient');
    check('workspace scopes are tried before the legacy user path', () => {
        assert.strictEqual(scopes[0], 'workspaces/wsOwner', `got ${scopes[0]}`);
        assert.strictEqual(scopes[scopes.length - 1], `users/${UID}`, `got ${scopes[scopes.length - 1]}`);
        assert.ok(scopes.includes('workspaces/wsFromClient'));
    });

    // 2) THE REGRESSION: last week's data lives in the workspace scope only.
    installFetch({ 'workspaces/wsOwner/transactions': LAST_WEEK_LEDGER }, { pointer: 'wsOwner' });
    const lastWeek = await ask('How did last week go?');
    check('last week reports workspace revenue, not 0', () => {
        assert.notStrictEqual(lastWeek.type, 'no_data', 'answered no_data');
        assert.strictEqual(lastWeek.revenue, 5000000, `revenue=${lastWeek.revenue}`);
    });

    // 3) The stale legacy copy must never win over the workspace scope.
    installFetch({
        'workspaces/wsOwner/transactions': LAST_WEEK_LEDGER,
        [`users/${UID}/transactions`]: STALE_LEDGER,
    }, { pointer: 'wsOwner' });
    const bothScopes = await ask('How did last week go?');
    check('workspace scope wins over the stale users/{uid} copy', () => {
        assert.strictEqual(bothScopes.revenue, 5000000, `revenue=${bothScopes.revenue}`);
    });

    // 4) Owner without a pointer: workspaceId == uid (seeding rule).
    installFetch({ [`workspaces/${UID}/transactions`]: LAST_WEEK_LEDGER });
    const seeded = await ask('How did last week go?');
    check('owner without a pointer resolves workspaces/{uid}', () => {
        assert.strictEqual(seeded.revenue, 5000000, `revenue=${seeded.revenue}`);
    });

    // 5) Pre-migration account: data still only under users/{uid}.
    installFetch({ [`users/${UID}/transactions`]: LAST_WEEK_LEDGER });
    const legacy = await ask('How did last week go?');
    check('pre-migration account falls back to users/{uid}', () => {
        assert.strictEqual(legacy.revenue, 5000000, `revenue=${legacy.revenue}`);
    });

    // 6) Voided entries are reversed, not deleted — never counted.
    installFetch({
        'workspaces/wsOwner/transactions': [...LAST_WEEK_LEDGER, txDoc('v1', 'income', 9000000, LAST_WEEK_MS, { is_voided: true, status: 'Voided' })],
    }, { pointer: 'wsOwner' });
    const voided = await ask('How did last week go?');
    check('voided transaction excluded from revenue', () => {
        assert.strictEqual(voided.revenue, 5000000, `revenue=${voided.revenue}`);
    });

    // 7) Backend blocked (rules/permission) but the page snapshot has records →
    // answer from the snapshot instead of reporting an empty ledger.
    installFetch({}, { pointer: 'wsOwner', denyScopes: ['workspaces/wsOwner', `users/${UID}`, `workspaces/${UID}`] });
    const snapshotAnswer = await ask('How did last week go?', {
        snapshot: {
            transactions: [
                { id: 's1', vendor_name: 'Client A', category: 'Revenue', type: 'income', status: 'Completed', amount: 7000000, timestamp: rfc(LAST_WEEK_MS) },
            ],
            bills: [], subscriptions: [],
            meta: { source: 'test', reads: { transactions: { success: true }, bills: { success: true }, subscriptions: { success: true } } },
        },
    });
    check('falls back to the page snapshot when the backend read is blocked', () => {
        assert.strictEqual(snapshotAnswer.revenue, 7000000, `revenue=${snapshotAnswer.revenue}`);
    });

    // 8) Empty backend read + snapshot with records → snapshot wins (an empty
    // backend read is a scope gap, never proof of an empty ledger).
    installFetch({}, { pointer: 'wsOwner' });
    const emptyBackend = await ask('How did last week go?', {
        snapshot: {
            transactions: [
                { id: 's1', vendor_name: 'Client A', category: 'Revenue', type: 'income', status: 'Completed', amount: 4000000, timestamp: rfc(LAST_WEEK_MS) },
            ],
            bills: [], subscriptions: [],
            meta: { source: 'test', reads: { transactions: { success: true }, bills: { success: true }, subscriptions: { success: true } } },
        },
    });
    check('empty backend read does not override a non-empty page snapshot', () => {
        assert.strictEqual(emptyBackend.revenue, 4000000, `revenue=${emptyBackend.revenue}`);
    });

    // 9) A genuinely empty account still answers "no data" (no false numbers).
    installFetch({}, { pointer: 'wsOwner' });
    const empty = await ask('How did last week go?');
    check('genuinely empty account still answers no_data', () => {
        assert.strictEqual(empty.type, 'no_data', `answer_type=${empty.type}`);
    });

    // 10) The capped read is newest-first, so a ledger larger than the cap still
    // contains last week (an unordered page is document-id ordered).
    const bulk = [];
    for (let i = 0; i < 1200; i += 1) bulk.push(txDoc(`a${String(i).padStart(4, '0')}`, 'expense', 1000, OLD_MS - i * D));
    installFetch({ 'workspaces/wsOwner/transactions': [...bulk, ...LAST_WEEK_LEDGER] }, { pointer: 'wsOwner' });
    const capped = await ask('How did last week go?');
    check('large ledger still includes last week (ordered read)', () => {
        assert.strictEqual(capped.revenue, 5000000, `revenue=${capped.revenue}`);
    });

    // 11) A week of custom-typed ("Others") records is genuinely Rp0 revenue —
    // but the answer must say why instead of looking like missing data.
    installFetch({ 'workspaces/wsOwner/transactions': [txDoc('c1', 'Donation', 3000000, LAST_WEEK_MS)] }, { pointer: 'wsOwner' });
    const custom = await ask('How did last week go?');
    check('custom transaction types are explained, not silently dropped', () => {
        const limitations = (custom.answer.limitations || []).join(' ');
        assert.match(limitations, /custom transaction type/i, `limitations=${limitations}`);
        assert.match(limitations, /Donation/, `limitations=${limitations}`);
    });

    global.fetch = realFetch;
    console.log(failures === 0 ? '\nAI FINANCE SCOPE PASS' : `\nAI FINANCE SCOPE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('check crashed:', e); process.exit(1); });
