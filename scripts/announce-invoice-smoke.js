'use strict';

// Smoke test for the one-time "Invoice email delivery + multi-currency"
// broadcast. Mocks Firestore + the email sender — sends NOTHING. Asserts:
//   - pagination across the Firestore page boundary
//   - rows without an email are skipped (never sent)
//   - exactly-once: a second run sends 0 (idempotency-key dedupe)
//   - a per-user send failure is isolated (the sweep keeps going)
//   - per-user locale routing: the resolved locale picks the EN or ID template
//   - both locales of the prebuilt template render the release content

const assert = require('assert');
const { broadcast, EVENT_KEY, TEMPLATE_KEY } = require('../netlify/functions/announce-invoice-multicurrency');
const { buildInvoiceAnnouncement, TEMPLATE } = require('../functions/lib/announce-invoice-template');

const quietLogger = { info() {}, warn() {}, error() {} };

// Minimal Firestore double: collection('internal_users') with
// orderBy().limit().startAfter(snapshot).get() cursor semantics.
function makeDb(users) {
    return {
        collection(name) {
            assert.strictEqual(name, 'internal_users', `unexpected collection ${name}`);
            const q = {
                _start: 0,
                _limit: users.length,
                orderBy() { return q; },
                limit(n) { q._limit = n; return q; },
                startAfter(doc) { q._start = users.findIndex((u) => u.id === doc.id) + 1; return q; },
                async get() {
                    const slice = users.slice(q._start, q._start + q._limit);
                    return {
                        empty: slice.length === 0,
                        size: slice.length,
                        docs: slice.map((u) => ({ id: u.id, data: () => u.data })),
                    };
                },
            };
            return q;
        },
    };
}

// Sender double honouring the real .create()-based dedupe contract: first call
// per (uid,eventKey) "sends"; repeats report a duplicate skip.
function makeSender({ throwFor = new Set() } = {}) {
    const seen = new Set();
    const calls = [];
    const send = async ({ uid, to, eventKey, templateKey, locale, prebuilt }) => {
        calls.push({ uid, eventKey, templateKey, locale, prebuilt });
        assert.strictEqual(eventKey, EVENT_KEY, 'eventKey must be the fixed announcement key');
        assert.strictEqual(templateKey, TEMPLATE_KEY, 'templateKey must be announce_invoice_multicurrency');
        assert.ok(to, 'sender must never be called without a recipient');
        assert.ok(prebuilt && prebuilt.html && prebuilt.subject && prebuilt.text, 'sender must receive a fully prebuilt email');
        if (throwFor.has(uid)) throw new Error('simulated provider failure');
        const key = `${uid}/${eventKey}`;
        if (seen.has(key)) return { skipped: 'duplicate' };
        seen.add(key);
        return { sent: true, providerId: `msg_${uid}` };
    };
    return { send, calls };
}

(async () => {
    // --- Scenario A: pagination (305 > BATCH 300) + no-email skip + idempotency
    const roster = [];
    for (let i = 0; i < 305; i++) {
        const id = `u${String(i).padStart(3, '0')}`;
        roster.push({ id, data: i === 10 ? { display_name: 'No Email' } : { email: `${id}@example.com`, display_name: `User ${i}` } });
    }
    const dbA = makeDb(roster);
    const senderA = makeSender();
    const resolveEn = async () => 'en';

    const run1 = await broadcast(dbA, { logger: quietLogger, send: senderA.send, resolveLocale: resolveEn });
    assert.strictEqual(run1.scanned, 305, 'run1 should scan the whole roster across 2 pages');
    assert.strictEqual(run1.sent, 304, 'run1 should send to everyone with an email');
    assert.strictEqual(run1.skipped, 1, 'run1 should skip the 1 row with no email');
    assert.strictEqual(run1.failed, 0, 'run1 should have no failures');
    assert.strictEqual(senderA.calls.length, 304, 'sender must not be called for the no-email row');

    const run2 = await broadcast(dbA, { logger: quietLogger, send: senderA.send, resolveLocale: resolveEn });
    assert.strictEqual(run2.scanned, 305, 'run2 re-scans the roster');
    assert.strictEqual(run2.sent, 0, 'run2 must send to nobody (exactly-once)');
    assert.strictEqual(run2.skipped, 305, 'run2 skips everyone (304 duplicates + 1 no-email)');
    assert.strictEqual(run2.failed, 0, 'run2 should have no failures');

    // --- Scenario B: a per-user failure does not abort the sweep
    const smallRoster = [
        { id: 'a1', data: { email: 'a1@example.com' } },
        { id: 'a2', data: { email: 'a2@example.com' } }, // this one throws
        { id: 'a3', data: { email: 'a3@example.com' } },
    ];
    const senderB = makeSender({ throwFor: new Set(['a2']) });
    const runB = await broadcast(makeDb(smallRoster), { logger: quietLogger, send: senderB.send, resolveLocale: resolveEn });
    assert.strictEqual(runB.scanned, 3, 'scenario B scans all 3');
    assert.strictEqual(runB.sent, 2, 'scenario B sends to the 2 healthy rows');
    assert.strictEqual(runB.failed, 1, 'scenario B records the 1 failure');
    assert.deepStrictEqual(senderB.calls.map((c) => c.uid), ['a1', 'a2', 'a3'], 'sweep continues past the failure');

    // --- Scenario C: per-user locale routing picks the right template language
    const mixedRoster = [
        { id: 'en1', data: { email: 'en1@example.com', display_name: 'Alex Tan' } },
        { id: 'id1', data: { email: 'id1@example.com', display_name: 'Budi Santoso' } },
    ];
    const senderC = makeSender();
    const runC = await broadcast(makeDb(mixedRoster), {
        logger: quietLogger,
        send: senderC.send,
        resolveLocale: async (_db, uid) => (uid === 'en1' ? 'en' : 'id'),
    });
    assert.strictEqual(runC.sent, 2, 'scenario C sends to both users');
    const enCall = senderC.calls.find((c) => c.uid === 'en1');
    const idCall = senderC.calls.find((c) => c.uid === 'id1');
    assert.strictEqual(enCall.locale, 'en');
    assert.strictEqual(idCall.locale, 'id');
    assert.ok(/send invoices by email/.test(enCall.prebuilt.subject), 'EN user gets the EN subject');
    assert.ok(/kirim invoice via email/.test(idCall.prebuilt.subject), 'ID user gets the ID subject');
    assert.ok(/Hi Alex,/.test(enCall.prebuilt.html), 'EN greeting personalizes with the first name');
    assert.ok(/Halo Budi,/.test(idCall.prebuilt.html), 'ID greeting personalizes with the first name');

    // --- Template renders the release content in both locales
    for (const [locale, marks] of [
        ['en', [/Finalize and mark as sent/, /US Dollar \(USD\)/, /Recorded in your ledger/, /Rp40\.625\.000/, /dashboard\.fluxyos\.com\/invoices/]],
        ['id', [/Finalisasi dan tandai terkirim/, /Dolar Singapura \(SGD\)/, /Tercatat di buku besar/, /kurs live, dicatat saat pembayaran/, /Dan ini baru permulaan/]],
    ]) {
        const email = buildInvoiceAnnouncement(locale, { name: '', baseUrl: 'https://dashboard.fluxyos.com' });
        assert.strictEqual(email.template, TEMPLATE);
        for (const re of marks) assert.ok(re.test(email.html), `${locale} html should match ${re}`);
        assert.ok(email.text.length > 200, `${locale} text part renders`);
        assert.ok(!/undefined/.test(email.html), `${locale} html has no leaked undefined`);
    }
    // Unknown locale falls back to Bahasa (product default).
    assert.ok(/kirim invoice/.test(buildInvoiceAnnouncement('fr', {}).subject), 'unknown locale falls back to ID');

    console.log('announce-invoice-smoke OK — run1:', run1, '| run2:', run2, '| failureIsolation:', runB, '| localeRouting:', runC);
})().catch((e) => { console.error('announce-invoice-smoke FAILED:', e.message); process.exit(1); });
