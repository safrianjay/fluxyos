'use strict';

/**
 * Local smoke test for the Weekly Financial Digest — sends NO real email,
 * makes NO network call. Mocks Resend (fetch) + Firestore/Auth. OpenAI is not
 * configured here, so it exercises the deterministic path. Run: npm run smoke:digest
 */

delete process.env.OPENAI_API_KEY; // force deterministic narrative
process.env.RESEND_API_KEY = 're_smoke_dummy';
process.env.APP_BASE_URL = 'https://fluxyos.com';
// Pin the fallback locale so the EN assertions are deterministic (the product
// default is Bahasa-first). Explicit language preferences are tested below.
process.env.DEFAULT_LOCALE = 'en';

const sent = [];
const _realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('resend.com')) return _realFetch(url, opts);
    sent.push({ u, body: opts && opts.body });
    return new Response(JSON.stringify({ id: 'mock_' + Math.random().toString(36).slice(2, 8) }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const admin = require('firebase-admin');
Object.defineProperty(admin, 'auth', { configurable: true, value: () => ({ getUser: async () => { throw new Error('no auth in smoke'); } }) });

const { generateWeeklyDigest, shouldDeliverNow, runWeeklyDigestSweep, getEffectivePrefs } = require('../netlify/functions/lib/digest-core');

const finance = require('../netlify/functions/api').digest;
const NOW = new Date();
// A timestamp guaranteed inside the digest period (last completed week).
const IN_PERIOD = finance.startOfWeek(NOW).getTime() - 3 * 24 * 60 * 60 * 1000;
const ts = (ms) => ({ seconds: Math.floor(ms / 1000) });
const D = 24 * 60 * 60 * 1000;

// In-memory Firestore double.
function makeDb(seed) {
    const colls = new Map(); // path -> [{id, ...fields}]
    const docs = new Map();  // path -> data
    for (const [p, arr] of Object.entries(seed.colls || {})) colls.set(p, arr.map((r) => ({ ...r })));
    for (const [p, data] of Object.entries(seed.docs || {})) docs.set(p, { ...data });

    const listing = (p) => { const arr = colls.get(p) || []; return { size: arr.length, docs: arr.map((r) => ({ id: r.id, data: () => r })) }; };
    const docHandle = (p) => ({
        async create(data) { if (docs.has(p)) { const e = new Error('exists'); e.code = 6; throw e; } docs.set(p, { ...data }); },
        async set(data, opts) { const prev = (opts && opts.merge && docs.get(p)) || {}; docs.set(p, { ...prev, ...data }); },
        async delete() { docs.delete(p); },
        async get() { return { exists: docs.has(p), data: () => docs.get(p) }; },
    });
    return {
        _colls: colls, _docs: docs,
        doc: (p) => docHandle(p),
        collection: (p) => ({
            limit: () => ({ async get() { return listing(p); } }),
            async get() { return listing(p); },
            async add(data) { const a = colls.get(p) || []; a.push({ id: 'a' + a.length, ...data }); colls.set(p, a); },
        }),
    };
}

function financeSeed(uid, weekMs) {
    return {
        [`users/${uid}/transactions`]: [
            { id: 't1', type: 'income', amount: 5000000, vendor_name: 'Client A', category: 'Revenue', status: 'Completed', timestamp: ts(weekMs) },
            { id: 't2', type: 'expense', amount: 2000000, vendor_name: 'AWS', category: 'Infrastructure', status: 'Completed', timestamp: ts(weekMs) },
            { id: 't3', type: 'expense', amount: 800000, vendor_name: 'Meta Ads', category: 'Marketing', status: 'Completed', timestamp: ts(weekMs) },
        ],
        [`users/${uid}/bills`]: [{ id: 'b1', amount: 1200000, vendor_name: 'Office Rent', status: 'unpaid', due_date: ts(NOW.getTime() + 3 * D) }],
        [`users/${uid}/subscriptions`]: [{ id: 's1', amount: 300000, vendor_name: 'Figma', status: 'active', renewal_date: ts(NOW.getTime() + 10 * D) }],
        [`users/${uid}/budgets`]: [],
    };
}

let failures = 0;
const check = (label, cond, detail) => { const ok = !!cond; if (!ok) failures += 1; console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`); };
const silent = { info() {}, warn() {}, error() {}, log() {} };
const ALL = { financial_health: true, cash_position: true, bills: true, budgets: true, revenue: true, expenses: true, subscriptions: true, vendors: true };

async function main() {
    // 1) Rich week → full digest (dry run).
    const db1 = makeDb({ colls: financeSeed('uX', IN_PERIOD) });
    const r1 = await generateWeeklyDigest(db1, 'uX', { metrics: ALL, name: 'Andi', email: 'x@example.com' }, { now: NOW, logger: silent, dryRun: true });
    const html1 = r1.prebuilt.html;
    check('dry run produced a digest', !!r1.prebuilt && /weekly digest/i.test(r1.prebuilt.subject));
    check('has data → not summary-only', r1.summaryOnly === false);
    check('renders Executive summary + Revenue + Recommended actions', ['Executive summary', 'Revenue', 'Recommended actions'].every((s) => html1.includes(s)));
    check('renders Rp amounts (real numbers)', /Rp[0-9.]/.test(html1));
    check('renders all KPI/table sections', ['Cash', 'Bills', 'Subscriptions', 'Top vendors', 'Top spending categories', 'Profitability'].every((s) => html1.includes(s)));
    check('renders colored change pills (▲/▼)', /▲|▼/.test(html1));

    // 2) Disabled metrics are omitted (test unique card titles).
    const r2 = await generateWeeklyDigest(db1, 'uX', { metrics: { ...ALL, subscriptions: false, vendors: false }, email: 'x@example.com' }, { now: NOW, logger: silent, dryRun: true });
    check('disabled Subscriptions card omitted', !r2.prebuilt.html.includes('Subscriptions'));
    check('disabled Top vendors card omitted', !r2.prebuilt.html.includes('Top vendors'));
    check('enabled financial-health cards still present', r2.prebuilt.html.includes('Profitability'));

    // 3) Low-activity week (records exist, none this week) → summary-only.
    const db3 = makeDb({ colls: financeSeed('uY', NOW.getTime() - 40 * D) });
    const r3 = await generateWeeklyDigest(db3, 'uY', { metrics: ALL, email: 'y@example.com' }, { now: NOW, logger: silent, dryRun: true });
    check('low-activity → summary-only', r3.summaryOnly === true);
    check('summary-only omits data sections, keeps summary + actions', !r3.prebuilt.html.includes('Cash') && !r3.prebuilt.html.includes('Top vendors') && r3.prebuilt.html.includes('Executive summary') && r3.prebuilt.html.includes('Recommended actions'));

    // 4) Zero records ever → skipped.
    const db4 = makeDb({ colls: {} });
    const r4 = await generateWeeklyDigest(db4, 'uZ', { metrics: ALL, email: 'z@example.com' }, { now: NOW, logger: silent });
    check('zero-records account skipped', r4.skipped === 'no_records');

    // 5) Real send + idempotency + audit.
    const db5 = makeDb({ colls: financeSeed('uS', IN_PERIOD) });
    const s1 = await generateWeeklyDigest(db5, 'uS', { metrics: ALL, email: 's@example.com' }, { now: NOW, logger: silent });
    check('send → sent', s1.sent === true);
    check('mail_log keyed by ISO week', [...db5._docs.keys()].some((k) => /users\/uS\/mail_log\/weekly_digest_\d{4}_W\d{2}/.test(k)));
    check('audit weekly_digest.generated + .sent written', (db5._colls.get('users/uS/audit_logs') || []).filter((a) => a.action && a.action.startsWith('weekly_digest.')).length >= 2);
    const before = sent.length;
    const s2 = await generateWeeklyDigest(db5, 'uS', { metrics: ALL, email: 's@example.com' }, { now: NOW, logger: silent });
    check('re-run same week → deduped (no resend)', s2.skipped === 'duplicate' && sent.length === before);

    // 6) Email Language preference — settings/email_preferences.language = 'id'
    // must localize the ENTIRE email: subject, chrome, AND the generated
    // summary/insights/actions (deterministic path here). No mixed languages.
    const db6 = makeDb({
        colls: financeSeed('uID', IN_PERIOD),
        docs: { 'users/uID/settings/email_preferences': { language: 'id' } },
    });
    const r6 = await generateWeeklyDigest(db6, 'uID', { metrics: ALL, name: 'Andi', email: 'id@example.com' }, { now: NOW, logger: silent, dryRun: true });
    const html6 = r6.prebuilt.html;
    check('language=id → ID subject', r6.prebuilt.subject.includes('Ringkasan keuangan mingguan'));
    check('language=id → ID chrome (executive summary, actions)', html6.includes('Ringkasan eksekutif') && html6.includes('Tindakan yang disarankan'));
    check('language=id → ID generated summary (no English sentence)', html6.includes('pendapatan Anda') && html6.includes('minggu lalu') && !html6.includes('For last week'));
    check('language=id → ID recommended action', html6.includes('Tinjau pendorong utama periode ini') && !html6.includes('Review period drivers'));
    // Explicit 'en' wins over an Indonesian finance locale.
    const db6b = makeDb({
        colls: financeSeed('uEN', IN_PERIOD),
        docs: {
            'users/uEN/settings/email_preferences': { language: 'en' },
            'users/uEN/settings/finance': { locale: 'id-ID' },
        },
    });
    const r6b = await generateWeeklyDigest(db6b, 'uEN', { metrics: ALL, email: 'en@example.com' }, { now: NOW, logger: silent, dryRun: true });
    check('language=en beats finance locale id-ID', /weekly digest/i.test(r6b.prebuilt.subject) && r6b.prebuilt.html.includes('Executive summary'));
    // No explicit language → finance locale drives it (legacy behavior).
    const db6c = makeDb({
        colls: financeSeed('uFL', IN_PERIOD),
        docs: { 'users/uFL/settings/finance': { locale: 'id-ID' } },
    });
    const r6c = await generateWeeklyDigest(db6c, 'uFL', { metrics: ALL, email: 'fl@example.com' }, { now: NOW, logger: silent, dryRun: true });
    check('no explicit language → finance locale (id-ID) used', r6c.prebuilt.subject.includes('Ringkasan keuangan mingguan'));

    // 7) Delivery-time matching.
    const tz = 'Asia/Jakarta';
    const lp = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', hour: 'numeric', hour12: false }).formatToParts(NOW);
    const wd = lp.find((p) => p.type === 'weekday').value.toLowerCase();
    let hr = parseInt(lp.find((p) => p.type === 'hour').value, 10); if (hr === 24) hr = 0;
    check('shouldDeliverNow true at matching slot', shouldDeliverNow({ weekly_digest_enabled: true, delivery_day: wd, delivery_hour: hr, timezone: tz }, NOW) === true);
    check('shouldDeliverNow false at wrong hour', shouldDeliverNow({ weekly_digest_enabled: true, delivery_day: wd, delivery_hour: (hr + 1) % 24, timezone: tz }, NOW) === false);
    check('shouldDeliverNow false when disabled', shouldDeliverNow({ weekly_digest_enabled: false, delivery_day: wd, delivery_hour: hr, timezone: tz }, NOW) === false);

    // 7) Sweep delivers to a matching roster user (missing prefs = enabled defaults; default Monday/09:00).
    const isMonday9 = wd === 'monday' && hr === 9;
    const dbSweep = makeDb({
        colls: {
            internal_users: [{ id: 'uS2', email: 's2@example.com', display_name: 'Sweep User' }],
            ...financeSeed('uS2', IN_PERIOD),
        },
        docs: { 'users/uS2/settings/email_preferences': { weekly_digest_enabled: true, delivery_day: wd, delivery_hour: hr, timezone: tz, metrics: ALL } },
    });
    const sw = await runWeeklyDigestSweep(dbSweep, { now: NOW, logger: silent });
    check('sweep sent to the due user', sw.due === 1 && sw.sent === 1, `due=${sw.due} sent=${sw.sent}`);

    console.log(`\nReal sends via mock: ${sent.length} (no network) | default Monday/09:00 matches now: ${isMonday9}`);
    console.log(failures === 0 ? 'DIGEST SMOKE PASS' : `DIGEST SMOKE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
