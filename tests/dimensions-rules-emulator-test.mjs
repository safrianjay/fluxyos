// =============================================================================
// FluxyOS — dimensions + ledger_balances_by_dim firestore.rules test
// (emulator-only)
//
// Covers the two collections added for the outlet/branch/warehouse dimension:
//   - dimensions: role gates (finance+ write, viewer read-only), lean field
//     validation, type enum, no delete (archive via status).
//   - ledger_balances_by_dim: the increment target on the posting hot path —
//     field-validated only, negative totals denied, no delete.
//
// The `delete: if false` cases are the ones that matter most: deleting a
// dimension would orphan journal lines that are immutable by rule, and deleting
// a balance row would silently break the invariant that the per-dimension rows
// sum to the workspace-level ledger_balances row.
//
// Schema: docs/data-model/dimensions.md
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/dimensions-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc,
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

const WS = 'ws_dimension_test';

function dimension(overrides = {}) {
    return {
        name: 'Outlet Kemang', name_key: 'outlet kemang', type: 'outlet',
        status: 'active', created_at: serverTimestamp(), updated_at: serverTimestamp(),
        ...overrides
    };
}

function balanceRow(overrides = {}) {
    return {
        period_key: '2026-08', account_code: '6100', account_type: 'expense',
        dimension_id: '__unassigned__', entity_id: WS, currency: 'IDR',
        debit_total: 250000, credit_total: 0, updated_at: serverTimestamp(),
        ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    console.log('\n— dimensions: finance+ writes —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance creates an outlet', true, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/kemang`), dimension()));
    await expectOutcome('warehouse type is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/gudang`), dimension({ name: 'Gudang Pusat', name_key: 'gudang pusat', type: 'warehouse' })));
    await expectOutcome('branch type is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/cabang`), dimension({ name: 'Cabang Bandung', name_key: 'cabang bandung', type: 'branch' })));
    await expectOutcome('archiving via status is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/dimensions/cabang`), { status: 'archived', updated_at: serverTimestamp() }));

    console.log('\n— dimensions: validation —');
    await expectOutcome('unknown type is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/bad-type`), dimension({ type: 'region' })));
    await expectOutcome('empty name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/no-name`), dimension({ name: '' })));
    await expectOutcome('name over 80 chars is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/long-name`), dimension({ name: 'x'.repeat(81) })));
    await expectOutcome('unknown status is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/bad-status`), dimension({ status: 'deleted' })));
    // Deleting orphans immutable journal lines — archive is the only exit.
    await expectOutcome('deleting a dimension is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/dimensions/kemang`)));

    console.log('\n— dimensions: viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/dimensions/viewer-dim`), dimension({ name: 'Nope', name_key: 'nope' })));
    await expectOutcome('viewer update is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/dimensions/kemang`), { name: 'Renamed' }));

    console.log('\n— ledger_balances_by_dim: the posting hot path —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance writes an unassigned balance row', true, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6100____unassigned__`), balanceRow()));
    await expectOutcome('a real dimension id is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6100__kemang`), balanceRow({ dimension_id: 'kemang' })));
    await expectOutcome('merge increment on an existing row is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6100__kemang`), { debit_total: 400000, updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('negative debit_total is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6200__kemang`), balanceRow({ account_code: '6200', debit_total: -1 })));
    await expectOutcome('missing dimension_id is denied', false, () => {
        const r = balanceRow({ account_code: '6300' }); delete r.dimension_id;
        return setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6300__x`), r);
    });
    await expectOutcome('non-string period_key is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6400__kemang`), balanceRow({ account_code: '6400', period_key: 202608 })));
    // A deleted row silently breaks "by-dim rows sum to the workspace row".
    await expectOutcome('deleting a balance row is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6100__kemang`)));

    console.log('\n— ledger_balances_by_dim: viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer balance write is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances_by_dim/2026-08__6500__kemang`), balanceRow({ account_code: '6500' })));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
