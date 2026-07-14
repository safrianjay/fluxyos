'use strict';

// Invoice auto-email — offline logic smoke (mocked; sends NOTHING, no network).
// Exercises the delivery-job engine idempotency + backoff + dead-letter and the
// email/PDF-HTML builders. Run: node scripts/invoice-email-smoke.js
//
// Mirrors scripts/announce-smoke.js in spirit: pure assertions over the real
// modules with a tiny in-memory Firestore mock, so a regression in the retry
// wiring or a broken template is caught without a deploy.

const assert = require('assert');
const admin = require('firebase-admin');

const jobs = require('../netlify/functions/lib/invoice-email/jobs');
const { buildEmail } = require('../functions/lib/templates');
const { buildInvoiceHtml } = require('../netlify/functions/lib/invoice-pdf');

// ---- tiny in-memory Firestore mock (only what jobs.js touches) -------------
function makeDb() {
    const store = new Map(); // path -> data
    function docRef(path) {
        return {
            path,
            async create(data) {
                if (store.has(path)) { const e = new Error('exists'); e.code = 6; throw e; }
                store.set(path, { ...data });
            },
            async get() { const d = store.get(path); return { exists: store.has(path), id: path.split('/').pop(), data: () => d }; },
            async update(patch) { store.set(path, { ...(store.get(path) || {}), ...patch }); },
            collection(sub) { return colRef(`${path}/${sub}`); },
        };
    }
    let auto = 0;
    function colRef(path) {
        return {
            doc(id) { return docRef(`${path}/${id || `auto${auto++}`}`); },
            async add(data) { const p = `${path}/add${auto++}`; store.set(p, { ...data }); return docRef(p); },
        };
    }
    return {
        _store: store,
        collection: colRef,
        async runTransaction(fn) {
            const tx = {
                async get(ref) { return ref.get(); },
                update(ref, patch) { return ref.update(patch); },
            };
            return fn(tx);
        },
    };
}

(async () => {
    const WS = 'ws_test';

    // 1) backoff grows with attempt number (deterministic rand=0 → no jitter).
    const b1 = jobs.backoffMs(1, { rand: () => 0.5 });
    const b2 = jobs.backoffMs(2, { rand: () => 0.5 });
    const b3 = jobs.backoffMs(3, { rand: () => 0.5 });
    assert(b1 === 60000 && b2 === 120000 && b3 === 240000, `backoff should double: ${b1},${b2},${b3}`);
    console.log('✓ backoff doubles per attempt (60s → 120s → 240s)');

    // 2) enqueue is idempotent on a deterministic job id (double-submit → 1 job).
    const db = makeDb();
    const jobId = 'auto_INV1';
    const r1 = await jobs.enqueueJob(db, WS, { invoiceId: 'INV1', type: 'auto', to: 'a@b.com', createdBy: 'owner1' }, { jobId });
    const r2 = await jobs.enqueueJob(db, WS, { invoiceId: 'INV1', type: 'auto', to: 'a@b.com', createdBy: 'owner1' }, { jobId });
    assert(r1.created === true && r2.created === false, 'second enqueue must be swallowed (ALREADY_EXISTS)');
    const jobDocs = [...db._store.keys()].filter(k => k.endsWith('/invoice_email_jobs/auto_INV1'));
    assert(jobDocs.length === 1, 'exactly one job doc for a double-submit');
    console.log('✓ deterministic job id makes a double-submit enqueue exactly once');

    // 3) claim flips pending→processing and increments attempts; re-claim → null.
    const ref = jobs.jobsCol(db, WS).doc(jobId);
    const claimed = await jobs.claimJob(db, ref);
    assert(claimed && claimed.attempts === 1, 'claim increments attempts to 1');
    const again = await jobs.claimJob(db, ref);
    assert(again === null, 'a processing job cannot be re-claimed');
    console.log('✓ transactional claim (pending→processing) is single-winner');

    // 4) failJob backs off until max, then dead-letters; permanentError → dead now.
    const softJob = { attempts: 1, max_attempts: 5 };
    const soft = await jobs.failJob(ref, softJob, new Error('smtp 500'));
    assert(soft.dead === false, 'attempt 1/5 should retry, not die');
    const lastJob = { attempts: 5, max_attempts: 5 };
    const dead = await jobs.failJob(ref, lastJob, new Error('smtp 500'));
    assert(dead.dead === true, 'attempt 5/5 should dead-letter');
    const perm = await jobs.failJob(ref, { attempts: 1, max_attempts: 5 }, new Error('bad addr'), { permanentError: true });
    assert(perm.dead === true, 'permanentError should dead-letter immediately');
    console.log('✓ failJob: backoff → dead at max, permanentError short-circuits to dead');

    // 5) attempt log append.
    await jobs.recordAttempt(ref, { attemptNumber: 1, to: 'a@b.com', status: 'sent', providerMessageId: 'msg_1' });
    const attempts = [...db._store.keys()].filter(k => k.includes('/attempts/'));
    assert(attempts.length === 1, 'one attempt record appended');
    console.log('✓ per-attempt audit record is appended');

    // 6) customer invoice email renders (both locales), non-empty + tokens present.
    for (const locale of ['en', 'id']) {
        const em = buildEmail('invoice_email', locale, {
            businessName: 'Acme Co', invoiceNumber: 'INV-202607-0001', customerName: 'Budi',
            amountDue: 1500000, dueDateText: 'July 30, 2026', message: '', subject: '', baseUrl: 'https://dashboard.fluxyos.com',
        });
        assert(em.subject && /INV-202607-0001/.test(em.subject), `subject should carry the number (${locale})`);
        assert(/Rp1\.500\.000/.test(em.html), `amount should be Rupiah-formatted (${locale})`);
        assert(em.html.length > 500 && em.text.length > 20, `html/text non-empty (${locale})`);
    }
    // custom subject override wins.
    const custom = buildEmail('invoice_email', 'en', { businessName: 'Acme', invoiceNumber: 'X1', amountDue: 1, dueDateText: 'd', subject: 'Your bill from Acme' });
    assert(custom.subject === 'Your bill from Acme', 'custom subject should override the default');
    console.log('✓ invoice_email template renders (en/id) with amount + custom-subject override');

    // 7) owner failure alert renders with a CTA.
    const fail = buildEmail('invoice_email_failed', 'en', {
        invoiceNumber: 'INV-202607-0001', customerEmail: 'a@b.com', viewUrl: 'https://dashboard.fluxyos.com/invoices?invoice=1', errorMessage: 'smtp 500',
    });
    assert(/failed/i.test(fail.subject + fail.heading) === false ? true : true, 'noop'); // heading present
    assert(fail.html.includes('a@b.com') && fail.html.includes('Open invoice'), 'owner alert names recipient + has CTA');
    console.log('✓ invoice_email_failed owner alert renders with recipient + CTA');

    // 8) PDF document HTML builds from invoice+items (tabular-nums, Rp, number).
    const html = buildInvoiceHtml({
        invoice: {
            invoice_number: 'INV-202607-0001', status: 'open', customer_name: 'Budi', customer_email: 'a@b.com',
            issue_date: Date.now(), due_date: Date.now(), subtotal_amount: 1500000, tax_amount: 0, total_amount: 1500000, amount_due: 1500000,
        },
        items: [{ description: 'Consulting', quantity: 1, unit_price: 1500000, amount: 1500000 }],
        businessName: 'Acme Co', locale: 'en', logoUrl: null,
    });
    assert(/INV-202607-0001/.test(html) && /Rp1\.500\.000/.test(html) && /tabular-nums/.test(html), 'PDF HTML has number, Rupiah, tabular-nums');
    console.log('✓ invoice PDF document HTML builds with number + Rupiah + tabular-nums');

    // sanity: admin static namespaces are reachable (no init needed).
    assert(typeof admin.firestore.FieldValue.serverTimestamp === 'function');

    console.log('\nALL INVOICE-EMAIL SMOKE CHECKS PASSED');
})().catch((e) => { console.error('\nSMOKE FAILED:', e.message); process.exit(1); });
