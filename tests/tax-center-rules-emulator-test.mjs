// =============================================================================
// FluxyOS — Tax Center firestore.rules test (emulator-only)
//
// Verifies the workspace-scoped Tax Center collections (Indonesia Tax Center):
//   - company_tax_profile: finance+ write with field validation; viewer read-only;
//     bad pkp_status / out-of-range PPN rate rejected; no delete.
//   - tax_mappings: finance+ create/update; viewer denied; delete owner/admin only.
//   - tax_transactions: finance+ create (validated); append-only (no delete; update
//     only the reversal-linkage keys); bad direction rejected.
//   - tax_periods: finance+ create/update; bad status rejected; no delete.
//   - tax_filings: finance+ create; update owner/admin only; no delete.
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/tax-center-rules-emulator-test.mjs"
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

const WS = 'ws_tax_test';
async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}
function profile(extra = {}) {
    return {
        npwp: '01.234.567.8-901.000', nik: null, pkp_status: 'pkp', pkp_effective_date: null,
        umkm_final: false, tax_office_kpp: 'KPP Jakarta', business_classification: '62019',
        default_ppn_rate: 11, updated_at: serverTimestamp(), updated_by: 'u', created_at: serverTimestamp(), ...extra
    };
}
function taxMapping(extra = {}) {
    return { source_type: 'transaction_category', source_value: 'Revenue', tax_code: 'PPN_OUT_11', tax_rate_percent: 11, status: 'active', created_at: serverTimestamp(), updated_at: serverTimestamp(), ...extra };
}
function taxTx(extra = {}) {
    return { tax_code: 'PPN_OUT_11', tax_name: 'PPN Keluaran', direction: 'output', tax_rate_percent: 11, taxable_base: 10000000, tax_amount: 1100000, period_key: '2026-06', journal_ref: 'J1', status: 'posted', entity_id: WS, created_by: 'u', created_at: serverTimestamp(), ...extra };
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    console.log('\n— company_tax_profile —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CAN write a valid tax profile', true, () =>
        setDoc(doc(db, `workspaces/${WS}/company_tax_profile/current`), profile()));
    await expectOutcome('reject bad pkp_status', false, () =>
        setDoc(doc(db, `workspaces/${WS}/company_tax_profile/current`), profile({ pkp_status: 'maybe' })));
    await expectOutcome('reject PPN rate > 100', false, () =>
        setDoc(doc(db, `workspaces/${WS}/company_tax_profile/current`), profile({ default_ppn_rate: 150 })));
    await expectOutcome('hard-delete profile is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/company_tax_profile/current`)));
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer CANNOT write the tax profile', false, () =>
        setDoc(doc(db, `workspaces/${WS}/company_tax_profile/current`), profile({ default_ppn_rate: 10 })));

    console.log('\n— tax_mappings —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CAN create a tax mapping', true, () =>
        setDoc(doc(db, `workspaces/${WS}/tax_mappings/transaction_category__revenue`), taxMapping()));
    await expectOutcome('reject tax_rate_percent > 100', false, () =>
        setDoc(doc(db, `workspaces/${WS}/tax_mappings/bad`), taxMapping({ tax_rate_percent: 200 })));
    await expectOutcome('finance CANNOT hard-delete a mapping (soft-archive only)', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/tax_mappings/transaction_category__revenue`)));
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer CANNOT create a mapping', false, () =>
        setDoc(doc(db, `workspaces/${WS}/tax_mappings/v`), taxMapping()));
    await setMemberRole(uid, 'owner');
    await expectOutcome('owner CAN hard-delete a mapping', true, () =>
        deleteDoc(doc(db, `workspaces/${WS}/tax_mappings/transaction_category__revenue`)));

    console.log('\n— tax_transactions (append-only) —');
    await setMemberRole(uid, 'finance');
    const ttRef = doc(collection(db, `workspaces/${WS}/tax_transactions`));
    await expectOutcome('finance CAN create a tax_transaction', true, () => setDoc(ttRef, taxTx()));
    await expectOutcome('reject a bad direction', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/tax_transactions`)), taxTx({ direction: 'sideways' })));
    await expectOutcome('reject a negative tax_amount', false, () =>
        setDoc(doc(collection(db, `workspaces/${WS}/tax_transactions`)), taxTx({ tax_amount: -5 })));
    await expectOutcome('update is limited to reversal-linkage keys', true, () =>
        updateDoc(ttRef, { status: 'reversed', reversed_by_tax_tx_id: 'tt2', updated_at: serverTimestamp() }));
    await expectOutcome('update of tax_amount is denied (append-only)', false, () =>
        updateDoc(ttRef, { tax_amount: 999 }));
    await expectOutcome('delete a tax_transaction is denied', false, () => deleteDoc(ttRef));

    console.log('\n— tax_periods —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CAN create/compute a tax period', true, () =>
        setDoc(doc(db, `workspaces/${WS}/tax_periods/monthly-2026-06`), { period_type: 'monthly', period_key: '2026-06', status: 'computed', ppn_output: 1100000, ppn_input: 0, ppn_payable: 1100000, entity_id: WS, updated_at: serverTimestamp() }));
    await expectOutcome('reject a bad period status', false, () =>
        setDoc(doc(db, `workspaces/${WS}/tax_periods/bad`), { period_type: 'monthly', period_key: '2026-06', status: 'nonsense' }));
    await expectOutcome('delete a tax period is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/tax_periods/monthly-2026-06`)));

    console.log('\n— tax_filings (file step is owner/admin) —');
    await setMemberRole(uid, 'finance');
    const fRef = doc(collection(db, `workspaces/${WS}/tax_filings`));
    await expectOutcome('finance CAN create a draft filing', true, () =>
        setDoc(fRef, { period_id: 'monthly-2026-06', filing_type: 'SPT_PPN', status: 'draft', filed_by: uid, entity_id: WS, created_at: serverTimestamp() }));
    await expectOutcome('finance CANNOT accept/amend a filing (owner/admin only)', false, () =>
        updateDoc(fRef, { status: 'accepted' }));
    await setMemberRole(uid, 'admin');
    await expectOutcome('admin CAN accept a filing', true, () =>
        updateDoc(fRef, { status: 'accepted' }));
    await setMemberRole(uid, 'finance');
    await expectOutcome('delete a filing is denied', false, () => deleteDoc(fRef));

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
