'use strict';

/**
 * Local smoke test — sends NO real email.
 *
 *  1. Renders every template in EN + ID to functions/.smoke/*.html
 *  2. Exercises the idempotent sender against in-memory Firestore + Resend
 *     doubles: first send, duplicate skip, failure rollback + retry.
 *
 * Run: npm run smoke
 */

const fs = require('fs');
const path = require('path');

// --- Mock the network so the Resend SDK sends nothing real ---
let resendBehavior = 'ok';
const sentMessages = [];
const _realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('resend.com')) return _realFetch(url, opts);
    if (resendBehavior === 'throw') throw new Error('simulated network failure');
    if (resendBehavior === 'error') {
        return new Response(JSON.stringify({ name: 'application_error', message: 'simulated provider error' }), { status: 422, headers: { 'content-type': 'application/json' } });
    }
    sentMessages.push({ url: u, body: opts && opts.body });
    return new Response(JSON.stringify({ id: 'mock_' + Math.random().toString(36).slice(2, 8) }), { status: 200, headers: { 'content-type': 'application/json' } });
};
process.env.RESEND_API_KEY = 're_smoke_dummy';

const { buildEmail } = require('./lib/templates');
const { sendNotificationEmail } = require('./lib/email');

// --- admin.firestore.FieldValue.serverTimestamp() sentinel (no app init needed) ---
const admin = require('firebase-admin');

// --- Minimal in-memory Firestore double ---
function makeDb() {
    const docs = new Map(); // path -> data
    const ERR_EXISTS = Object.assign(new Error('already exists'), { code: 6 });
    const docHandle = (p) => ({
        async create(data) {
            if (docs.has(p)) throw ERR_EXISTS;
            docs.set(p, { ...data });
        },
        async set(data, opts) {
            const prev = (opts && opts.merge && docs.get(p)) || {};
            docs.set(p, { ...prev, ...data });
        },
        async delete() { docs.delete(p); },
        async get() { return { exists: docs.has(p), data: () => docs.get(p) }; },
    });
    return {
        _docs: docs,
        doc: (p) => docHandle(p),
        collection: (p) => ({ async add(data) { docs.set(`${p}/${docs.size}_${Math.random().toString(36).slice(2, 6)}`, data); } }),
    };
}

const TEMPLATES = [
    ['welcome', { name: 'Andi', baseUrl: 'https://fluxyos.com' }],
    ['kyc_approved', { name: 'Andi', baseUrl: 'https://fluxyos.com' }],
    ['kyc_needs_revision', { name: 'Andi', baseUrl: 'https://fluxyos.com', reviewerNote: 'KTP photo is blurry — please re-upload.' }],
    ['kyc_rejected', { name: 'Andi', baseUrl: 'https://fluxyos.com', reviewerNote: 'Document did not match the registered name.' }],
    ['payment_verified', { name: 'Andi', baseUrl: 'https://fluxyos.com', planName: 'growth', amount: 1490000 }],
    ['payment_rejected', { name: 'Andi', baseUrl: 'https://fluxyos.com', reviewerNote: 'Transfer amount did not match the invoice.' }],
    ['trial_ending', { baseUrl: 'https://fluxyos.com', planName: 'Trial', trialEndsLabel: 'June 16, 2026' }],
];

let failures = 0;
function check(label, cond, detail) {
    const ok = !!cond;
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    const outDir = path.join(__dirname, '.smoke');
    fs.mkdirSync(outDir, { recursive: true });

    // 1) Render every template, both locales.
    for (const [key, data] of TEMPLATES) {
        for (const locale of ['en', 'id']) {
            const { subject, html, text } = buildEmail(key, locale, data);
            fs.writeFileSync(path.join(outDir, `${key}.${locale}.html`), html);
            const hasRp = key.startsWith('payment_verified') ? /Rp[0-9.]/.test(text) : true;
            const noBadSpace = !/Rp\s/.test(text); // no space after Rp
            check(`render ${key}.${locale}`, subject && html.includes('<html') && text.includes(subject ? '' : ''), `subject="${subject}"`);
            if (key === 'payment_verified') check(`  ${key}.${locale} currency`, hasRp && noBadSpace, hasRp ? 'Rp ok' : 'missing Rp');
        }
    }

    // 2) Idempotent sender scenarios.
    const db = makeDb();
    const baseArgs = { db, uid: 'u_test', to: 'qa@example.com', templateKey: 'welcome', locale: 'en', data: { name: 'QA', baseUrl: 'https://fluxyos.com' }, logger: { info() {}, warn() {}, error() {} } };

    resendBehavior = 'ok';
    const r1 = await sendNotificationEmail({ ...baseArgs, eventKey: 'welcome' });
    check('first send -> sent', r1.sent === true);
    check('mail_log marked sent', db._docs.get('users/u_test/mail_log/welcome')?.status === 'sent');
    check('audit row written', [...db._docs.keys()].some((k) => k.startsWith('users/u_test/audit_logs/')));

    const r2 = await sendNotificationEmail({ ...baseArgs, eventKey: 'welcome' });
    check('duplicate send -> skipped', r2.skipped === 'duplicate');

    // Failure rollback: provider throws, placeholder must be removed so retry works.
    resendBehavior = 'throw';
    let threw = false;
    try { await sendNotificationEmail({ ...baseArgs, eventKey: 'kyc_x', templateKey: 'kyc_approved' }); } catch (_e) { threw = true; }
    check('failed send -> throws', threw);
    check('failed send -> placeholder rolled back', !db._docs.has('users/u_test/mail_log/kyc_x'));

    resendBehavior = 'ok';
    const r4 = await sendNotificationEmail({ ...baseArgs, eventKey: 'kyc_x', templateKey: 'kyc_approved' });
    check('retry after failure -> sent', r4.sent === true);

    // Provider returns {error} object (not a throw) must also roll back + throw.
    resendBehavior = 'error';
    let threw2 = false;
    try { await sendNotificationEmail({ ...baseArgs, eventKey: 'err_y' }); } catch (_e) { threw2 = true; }
    check('provider error object -> throws + rollback', threw2 && !db._docs.has('users/u_test/mail_log/err_y'));

    check('no-recipient -> skipped', (await sendNotificationEmail({ ...baseArgs, to: null, eventKey: 'z' })).skipped === 'no_recipient');

    console.log(`\nReal sends attempted via mock: ${sentMessages.length} (no network)`);
    console.log(`Rendered ${TEMPLATES.length * 2} templates -> ${outDir}`);
    console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
