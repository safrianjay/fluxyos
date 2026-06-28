// =============================================================================
// FluxyOS — Accounting kernel firestore.rules test (emulator-only)
//
// Verifies the new workspace-scoped accounting collections:
//   - journals: balanced (Σdebit==Σcredit, >0) + open-period required at create;
//     immutable after post (only reversed_by_journal_id may change); no delete.
//   - chart_of_accounts / ledger_balances / periods field validation + role gates.
//   - posting into a CLOSED period is denied (the period-lock spine).
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/accounting-kernel-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, collection, setDoc, updateDoc,
    deleteDoc, serverTimestamp, writeBatch, increment
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const adminDb = admin.firestore();

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

let passed = 0;
let failed = 0;
async function expectOutcome(label, shouldAllow, run) {
    try {
        await run();
        if (shouldAllow) { passed++; console.log(`  PASS (allowed)  ${label}`); }
        else { failed++; console.error(`  FAIL (should have been DENIED)  ${label}`); }
    } catch (err) {
        const denied = err?.code === 'permission-denied' || /permission|PERMISSION/.test(String(err?.message));
        if (!shouldAllow && denied) { passed++; console.log(`  PASS (denied)   ${label}`); }
        else { failed++; console.error(`  FAIL ${shouldAllow ? '(should have been ALLOWED)' : '(unexpected error)'}  ${label} → ${err?.code || err?.message}`); }
    }
}

const WS = 'ws_acct_test';

function line(code, type, debit, credit) {
    return { account_code: code, account_type: type, debit, credit, currency: 'IDR', fx_rate: 1, functional_amount: debit || credit, memo: '' };
}
function journal(pk, { debit = 1000, credit = 1000, balanced = true, lines = null, journalType = 'system', number = 'JE-2026-000001', status = 'posted' } = {}) {
    return {
        posting_rule_id: 'TEST', journal_type: journalType, journal_number: number, journal_seq: 1,
        description: 'test', source: { collection: 'bills', id: 'b1' },
        period_key: pk, status, memo: 'test',
        lines: lines || [line('6300', 'expense', 1000, 0), line('2000', 'liability', 0, 1000)],
        total_debit: debit, total_credit: credit, is_balanced: balanced,
        currency: 'IDR', entity_id: WS, posted_by: null, posted_at: serverTimestamp(), created_at: serverTimestamp()
    };
}
// A manual journal DRAFT: no number, may be unbalanced while edited.
function manualDraft(pk, { debit = 1000, credit = 1000, balanced = true, lines = null } = {}) {
    return {
        posting_rule_id: 'MANUAL', journal_type: 'manual', status: 'draft',
        description: 'Manual journal', reference: null, source: { collection: null, id: null }, source_number: null,
        period_key: pk, memo: '',
        lines: lines || [line('6300', 'expense', 1000, 0), line('2000', 'liability', 0, 1000)],
        total_debit: debit, total_credit: credit, is_balanced: balanced,
        currency: 'IDR', entity_id: WS, created_by: null, generated_by: null,
        created_at: serverTimestamp(), updated_at: serverTimestamp()
    };
}
function ledgerBalance(pk, code, overrides = {}) {
    return {
        period_key: pk, account_code: code, account_type: 'expense', entity_id: WS,
        currency: 'IDR', debit_total: 1000, credit_total: 0, updated_at: serverTimestamp(), ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    await setMemberRole(uid, 'owner');

    console.log('\n— chart_of_accounts —');
    await expectOutcome('seed a valid account', true, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6300`), {
            code: '6300', name: 'Infrastructure Expense', type: 'expense', subtype: null,
            parent_code: null, normal_balance: 'debit', is_active: true, currency: 'IDR',
            entity_id: WS, opening_balance: 0, created_at: serverTimestamp()
        }));
    await expectOutcome('reject account with bad type', false, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/9999`), {
            code: '9999', name: 'Bad', type: 'nonsense', normal_balance: 'debit'
        }));
    await expectOutcome('hard-delete an account is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6300`)));

    // REGRESSION: the posting engine stamps journal_ref + accounting_status onto
    // the source document. The document validators must allow these keys, or the
    // whole create batch (document + journal) is denied and adding a transaction
    // breaks. This reproduces the production "Permission Denied" on Add Transaction.
    console.log('\n— regression: source doc carries journal_ref + accounting_status —');
    const txn = (extra = {}) => ({
        amount: 2577200, vendor_name: 'Event wibu', category: 'Revenue', type: 'income',
        status: 'Completed', icon: '💰', timestamp: serverTimestamp(), created_at: serverTimestamp(), ...extra
    });
    await expectOutcome('tx create with journal_ref + accounting_status is allowed', true, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/transactions`)), txn({ journal_ref: 'J123', accounting_status: 'posted' })));
    await expectOutcome('tx create with bad accounting_status is denied', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/transactions`)), txn({ accounting_status: 'nonsense' })));

    console.log('\n— journals: balance + immutability —');
    const okRef = doc(collection(db, `workspaces/${WS}/journals`));
    await expectOutcome('post a balanced journal (open period)', true, () => setDoc(okRef, journal('2026-06')));
    await expectOutcome('reject an UNBALANCED journal', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), journal('2026-06', { debit: 1000, credit: 900, balanced: false })));
    await expectOutcome('reject a zero-total journal', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), journal('2026-06', { debit: 0, credit: 0, lines: [line('6300', 'expense', 0, 0)] })));
    await expectOutcome('mutating posted journal lines is denied', false, () =>
        updateDoc(okRef, { total_debit: 5000, total_credit: 5000 }));
    await expectOutcome('setting reversal linkage is allowed', true, () =>
        updateDoc(okRef, { reversed_by_journal_id: 'J999' }));
    await expectOutcome('deleting a posted journal is denied', false, () => deleteDoc(okRef));

    console.log('\n— manual journals: draft → posted —');
    // A manual draft may be saved unbalanced (work in progress).
    const draftRef = doc(collection(db, `workspaces/${WS}/journals`));
    await expectOutcome('save an UNBALANCED manual draft', true, () =>
        setDoc(draftRef, manualDraft('2026-06', { debit: 1000, credit: 0, balanced: false, lines: [line('6300', 'expense', 1000, 0)] })));
    // Drafts are manual-only — a system draft is rejected.
    await expectOutcome('reject a SYSTEM draft (drafts are manual-only)', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), { ...manualDraft('2026-06'), journal_type: 'system' }));
    // Posting a draft WITHOUT a number is denied.
    await expectOutcome('posting a draft WITHOUT a number is denied', false, () =>
        updateDoc(draftRef, { status: 'posted', total_debit: 1000, total_credit: 1000, is_balanced: true,
            lines: [line('6300', 'expense', 1000, 0), line('2000', 'liability', 0, 1000)] }));
    // Posting a balanced draft WITH a number into an open period is allowed.
    await expectOutcome('posting a balanced draft WITH a number is allowed', true, () =>
        updateDoc(draftRef, { status: 'posted', journal_number: 'JE-2026-000002', journal_seq: 2,
            total_debit: 1000, total_credit: 1000, is_balanced: true,
            lines: [line('6300', 'expense', 1000, 0), line('2000', 'liability', 0, 1000)] }));
    // The ex-draft is now posted → immutable except reversal linkage.
    await expectOutcome('the posted (ex-draft) journal is now immutable', false, () =>
        updateDoc(draftRef, { total_debit: 5 }));
    // A draft can be discarded; a posted entry cannot.
    const draft2 = doc(collection(db, `workspaces/${WS}/journals`));
    await expectOutcome('save a second manual draft', true, () => setDoc(draft2, manualDraft('2026-06')));
    await expectOutcome('deleting a DRAFT journal is allowed', true, () => deleteDoc(draft2));

    console.log('\n— ledger_balances —');
    await expectOutcome('write a valid ledger balance', true, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances/2026-06__6300`), ledgerBalance('2026-06', '6300')));
    // Production writes use FieldValue.increment — verify rules accept the merged
    // numeric result (this is how db-service posts balances alongside journals).
    await expectOutcome('increment-based balance write is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances/2026-06__1000`), {
            period_key: '2026-06', account_code: '1000', account_type: 'asset', entity_id: WS,
            currency: 'IDR', debit_total: increment(5000), credit_total: increment(0), updated_at: serverTimestamp()
        }, { merge: true }));
    await expectOutcome('reject negative debit_total', false, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances/2026-06__2000`), ledgerBalance('2026-06', '2000', { debit_total: -5 })));

    console.log('\n— period close + lock spine —');
    await expectOutcome('close 2026-05 (status closed)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-05`), {
            period_key: '2026-05', status: 'closed', entity_id: WS, closed_by: uid,
            closed_at: serverTimestamp(), retained_earnings_posted: true, updated_at: serverTimestamp()
        }));
    await expectOutcome('posting into the CLOSED period is denied', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), journal('2026-05')));

    console.log('\n— role gates —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer cannot post a journal', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), journal('2026-06')));
    await expectOutcome('viewer cannot lock a period', false, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-04`), { period_key: '2026-04', status: 'locked' }));
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CAN close a period', true, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-03`), { period_key: '2026-03', status: 'closed' }));
    await expectOutcome('finance CANNOT lock a period (owner/admin only)', false, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-02`), { period_key: '2026-02', status: 'locked' }));

    await setMemberRole(uid, 'accountant');
    await expectOutcome('accountant CAN post a journal', true, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), journal('2026-06', { number: 'JE-2026-000050' })));
    await expectOutcome('accountant CAN save a manual draft', true, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/journals`)), manualDraft('2026-06')));
    await expectOutcome('accountant CANNOT lock a period (owner/admin only)', false, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-01`), { period_key: '2026-01', status: 'locked' }));

    console.log('\n— journal-number counters (monotonic) —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('create a counter (seq 5)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/counters/journal-2026`), { seq: 5, entity_id: WS, updated_at: serverTimestamp() }));
    await expectOutcome('advance the counter (seq 10)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/counters/journal-2026`), { seq: 10, entity_id: WS, updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('rolling the counter BACKWARD is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/counters/journal-2026`), { seq: 3, entity_id: WS, updated_at: serverTimestamp() }, { merge: true }));
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer cannot advance the counter', false, () =>
        setDoc(doc(db, `workspaces/${WS}/counters/journal-2026`), { seq: 11 }, { merge: true }));

    console.log('\n— period reopen (closed → open) is owner/admin only —');
    // Seed a closed period (as owner) to reopen from.
    await setMemberRole(uid, 'owner');
    await expectOutcome('close 2026-01 (owner)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-01`), { period_key: '2026-01', status: 'closed' }));
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CANNOT reopen a closed period', false, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-01`), { period_key: '2026-01', status: 'open' }, { merge: true }));
    await setMemberRole(uid, 'accountant');
    await expectOutcome('accountant CANNOT reopen a closed period', false, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-01`), { period_key: '2026-01', status: 'open' }, { merge: true }));
    await setMemberRole(uid, 'admin');
    await expectOutcome('admin CAN reopen a closed period', true, () =>
        setDoc(doc(db, `workspaces/${WS}/periods/2026-01`), { period_key: '2026-01', status: 'open' }, { merge: true }));

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
