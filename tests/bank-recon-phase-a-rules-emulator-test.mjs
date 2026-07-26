// =============================================================================
// FluxyOS — Bank reconciliation Phase A firestore.rules test (emulator-only)
//
// Verifies (docs/BANK_RECONCILIATION_PLAN.md Phase A):
//   - bank_statement_imports accepts the account link + certification fields
//     (bank_account_id, reconciliation_status, certified_at/by/closing_balance)
//     and rejects bad enum / negative certified balance.
//   - statement-imported transactions may carry the cash-impact stamp
//     (cash_effective/direction/account_id/source) alongside the import links.
//   - bank_balance_snapshots accepts source_type 'statement_upload' with
//     confidence 'extracted' and stays append-only.
//   - viewer cannot write any of it.
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/bank-recon-phase-a-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, collection, setDoc, updateDoc,
    deleteDoc, serverTimestamp
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

const WS = 'ws_recon_test';

function importDoc(overrides = {}) {
    return {
        file_name: 'statement-mei.csv', file_mime_type: 'text/csv', file_size: 1024,
        storage_path: null, document_type: 'bank_statement',
        extraction_status: 'pending', review_status: 'draft',
        bank_name: 'BCA', account_holder: null, account_number_masked: '****1234',
        currency: 'IDR', statement_start_date: null, statement_end_date: null,
        opening_balance: 1000000, closing_balance: 2000000, total_debit: null, total_credit: null,
        row_count: 0, balance_check_status: 'unavailable', running_balance_check_status: 'unavailable',
        duplicate_count: 0, needs_review_count: 0,
        created_at: serverTimestamp(), updated_at: serverTimestamp(), ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    await setMemberRole(uid, 'finance');

    console.log('\n— bank_statement_imports: account link + certification —');
    const impRef = doc(db, `workspaces/${WS}/bank_statement_imports/imp1`);
    await expectOutcome('create a draft import', true, () => setDoc(impRef, importDoc()));
    await expectOutcome('link a bank account (partial merge)', true, () =>
        setDoc(impRef, { bank_account_id: 'acct1', updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('certify the import (status + certified fields)', true, () =>
        setDoc(impRef, {
            reconciliation_status: 'certified', certified_at: serverTimestamp(),
            certified_by: uid, certified_closing_balance: 2000000, updated_at: serverTimestamp()
        }, { merge: true }));
    await expectOutcome('bad reconciliation_status is denied', false, () =>
        setDoc(impRef, { reconciliation_status: 'done', updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('negative certified_closing_balance is denied', false, () =>
        setDoc(impRef, { certified_closing_balance: -5, updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('unknown certification key is denied', false, () =>
        setDoc(impRef, { certified_note: 'x', updated_at: serverTimestamp() }, { merge: true }));

    console.log('\n— transactions: statement import cash stamp —');
    await expectOutcome('imported tx with cash stamp + account link is allowed', true, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/transactions`)), {
            amount: 450000, vendor_name: 'TRSF AWS', category: 'Operations', type: 'expense',
            status: 'Completed', icon: '💸', timestamp: serverTimestamp(), created_at: serverTimestamp(),
            source: 'bank_statement_import', bank_statement_import_id: 'imp1', bank_statement_row_id: 'row1',
            imported_at: serverTimestamp(), accounting_status: 'pending',
            cash_effective: true, cash_status: 'actual', cash_direction: 'out',
            cash_account_id: 'acct1', cash_source: 'bank_statement_import',
            cash_match_status: 'imported', cash_effective_at: serverTimestamp()
        }));

    console.log('\n— bank_balance_snapshots: statement_upload source —');
    const snapRef = doc(db, `workspaces/${WS}/bank_balance_snapshots/snap1`);
    await expectOutcome('snapshot from a certified statement is allowed', true, () =>
        setDoc(snapRef, {
            bank_account_id: 'acct1', balance: 2000000, currency: 'IDR',
            source_type: 'statement_upload', snapshot_at: serverTimestamp(),
            confidence: 'extracted', notes: 'Certified from statement statement-mei.csv',
            created_at: serverTimestamp()
        }));
    await expectOutcome('mutating a snapshot is denied (append-only)', false, () =>
        updateDoc(snapRef, { balance: 1 }));
    await expectOutcome('deleting a snapshot is denied', false, () => deleteDoc(snapRef));

    console.log('\n— viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer cannot certify an import', false, () =>
        setDoc(impRef, { reconciliation_status: 'certified', updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('viewer cannot write a snapshot', false, () =>
        setDoc(doc(db, `workspaces/${WS}/bank_balance_snapshots/snap2`), {
            bank_account_id: 'acct1', balance: 1, currency: 'IDR', source_type: 'statement_upload',
            snapshot_at: serverTimestamp(), created_at: serverTimestamp()
        }));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
