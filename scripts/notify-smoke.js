'use strict';

/**
 * Local smoke test for the no-Blaze notification sweeps — sends NO real email.
 * Mocks the network (Resend) and Firestore/Auth. Run: npm run smoke:notify
 */

// --- Mock network so Resend sends nothing real ---
let resendBehavior = 'ok';
const sentMessages = [];
const _realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('resend.com')) return _realFetch(url, opts);
    if (resendBehavior === 'throw') throw new Error('simulated failure');
    sentMessages.push({ u, body: opts && opts.body });
    return new Response(JSON.stringify({ id: 'mock_' + Math.random().toString(36).slice(2, 8) }), { status: 200, headers: { 'content-type': 'application/json' } });
};
process.env.RESEND_API_KEY = 're_smoke_dummy';

// admin.auth() has no default app in smoke — force the internal-index fallback.
const admin = require('firebase-admin');
Object.defineProperty(admin, 'auth', { configurable: true, value: () => ({ getUser: async () => { throw new Error('no auth in smoke'); } }) });

const { reconcileInternalUsers, sweepTrialEnding } = require('../netlify/functions/lib/notify-core');

const ts = (ms) => ({ toMillis: () => ms });
const NOW = Date.now();
const H = 60 * 60 * 1000;

function makeDb(seed) {
    const docs = new Map();
    for (const [uid, s] of Object.entries(seed.settings || {})) docs.set(`users/${uid}/settings/finance`, s);
    const internal = (seed.internalUsers || []).map((u) => ({ id: u.id, fields: { ...u } }));
    for (const u of internal) docs.set(`internal_users/${u.id}`, u.fields);
    const billing = seed.billing || [];

    const docHandle = (p) => ({
        async create(data) { if (docs.has(p)) { const e = new Error('exists'); e.code = 6; throw e; } docs.set(p, { ...data }); },
        async set(data, opts) { const prev = (opts && opts.merge && docs.get(p)) || {}; docs.set(p, { ...prev, ...data }); },
        async delete() { docs.delete(p); },
        async get() { return { exists: docs.has(p), data: () => docs.get(p) }; },
    });
    return {
        _docs: docs,
        doc: (p) => docHandle(p),
        collection: (p) => {
            if (p === 'internal_users') {
                return { limit: () => ({ async get() { return { size: internal.length, docs: internal.map((u) => ({ id: u.id, data: () => docs.get(`internal_users/${u.id}`) })) }; } }) };
            }
            return { async add(data) { docs.set(`${p}/${docs.size}_${Math.random().toString(36).slice(2, 6)}`, data); } };
        },
        collectionGroup: () => ({
            where: (field, _op, val) => ({ async get() {
                const matched = billing.filter((b) => b[field] === val).map((b) => ({ id: b._docId || 'current', data: () => b, ref: { parent: { parent: { id: b.uid } } } }));
                return { size: matched.length, docs: matched };
            } }),
        }),
    };
}

let failures = 0;
const check = (label, cond, detail) => { const ok = !!cond; if (!ok) failures += 1; console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); };
const silent = { info() {}, warn() {}, error() {}, log() {} };

async function main() {
    // ---- internal_users reconcile ----
    const db = makeDb({
        settings: { uA: { locale: 'id-ID' } },
        internalUsers: [
            // A: new (welcome), KYC approved, payment verified -> 3 emails
            { id: 'uA', email: 'a@example.com', display_name: 'Andi Wijaya', created_at: ts(NOW - 1000), kyc_status: 'approved', kyc_reviewed_at: ts(NOW), payment_status: 'verified', payment_verified_at: ts(NOW), plan_id: 'growth', payment_amount: 1490000 },
            // B: old account, nothing notifiable -> 0 emails
            { id: 'uB', email: 'b@example.com', display_name: 'Budi', created_at: ts(NOW - 10 * 24 * H), kyc_status: 'submitted', payment_status: 'pending' },
            // C: no email -> skipped
            { id: 'uC', display_name: 'NoEmail', created_at: ts(NOW - 1000), kyc_status: 'approved' },
        ],
    });

    resendBehavior = 'ok';
    const r1 = await reconcileInternalUsers(db, { logger: silent });
    check('reconcile run #1 sent 3 (welcome+kyc+payment for A)', r1.sent === 3, `sent=${r1.sent}`);
    check('A welcome logged', db._docs.get('users/uA/mail_log/welcome')?.status === 'sent');
    check('A kyc_approved logged', [...db._docs.keys()].some((k) => k.startsWith('users/uA/mail_log/kyc_approved')));
    check('A payment_verified logged', [...db._docs.keys()].some((k) => k.startsWith('users/uA/mail_log/payment_verified')));
    check('B (old, non-notifiable) sent nothing', ![...db._docs.keys()].some((k) => k.startsWith('users/uB/mail_log/')));
    check('C (no email) skipped', ![...db._docs.keys()].some((k) => k.startsWith('users/uC/mail_log/')));
    check('A email locale is Indonesian', /memverifikasi|Selamat datang|Verifikasi disetujui/.test(sentMessages.map((m) => m.body).join('')));

    const before = sentMessages.length;
    const r2 = await reconcileInternalUsers(db, { logger: silent });
    check('reconcile run #2 fully deduped (idempotent)', r2.sent === 0 && sentMessages.length === before, `sent=${r2.sent}`);

    // ---- trial-ending sweep ----
    const db2 = makeDb({
        internalUsers: [{ id: 'uT', email: 't@example.com' }],
        billing: [
            { uid: 'uT', status: 'trialing', trial_ends_at: ts(NOW + 12 * H), plan_name: 'Trial' }, // within 24h -> send
            { uid: 'uX', status: 'trialing', trial_ends_at: ts(NOW + 48 * H), plan_name: 'Trial' }, // >24h -> skip
        ],
    });
    const t1 = await sweepTrialEnding(db2, { logger: silent });
    check('trial sweep sent 1 (ends in 12h, not the 48h one)', t1.sent === 1, `sent=${t1.sent}`);
    check('trial reminder deduped on re-run', (await sweepTrialEnding(db2, { logger: silent })).sent === 0);

    // ---- failure isolation ----
    // Old account (no welcome) so this isolates the KYC retry path.
    const db3 = makeDb({ internalUsers: [{ id: 'uF', email: 'f@example.com', created_at: ts(NOW - 10 * 24 * H), kyc_status: 'approved', kyc_reviewed_at: ts(NOW) }] });
    resendBehavior = 'throw';
    const f1 = await reconcileInternalUsers(db3, { logger: silent }); // must not throw
    check('provider failure isolated (sweep still returns)', f1 && f1.sent === 0);
    check('failed send rolled back placeholder (retryable)', ![...db3._docs.keys()].some((k) => k.startsWith('users/uF/mail_log/')));
    resendBehavior = 'ok';
    const f2 = await reconcileInternalUsers(db3, { logger: silent });
    check('retry after failure sends', f2.sent === 1);

    console.log(`\nReal sends via mock: ${sentMessages.length} (no network)`);
    console.log(failures === 0 ? 'NOTIFY SMOKE PASS' : `NOTIFY SMOKE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
