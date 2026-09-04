// =============================================================================
// FluxyOS — goods_receipts + stock_movements firestore.rules test
// (emulator-only)
//
// stock_movements is the subledger `1200 Inventory` must tie to, so the
// immutability cases are the ones that matter most here. A deleted or edited
// movement puts the control account out of agreement with the subledger
// silently — the GL still ties to its journals, and the movements still look
// self-consistent, so neither side reports anything. That is the same class of
// invisible divergence ledger_balances_by_dim guards against.
//
// Schema: docs/data-model/stock.md
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/stock-rules-emulator-test.mjs"
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

const WS = 'ws_stock_test';

function receipt(overrides = {}) {
    return {
        vendor_name: 'CV Sumber Pangan', vendor_id: null, dimension_id: 'outlet-kemang',
        reference: 'GR-001',
        lines: [{ item_id: 'flour', item_name: 'Tepung', base_unit: 'g', quantity: 25000, amount: 300000 }],
        total_amount: 300000, line_count: 1, status: 'received', bill_id: null,
        timestamp: new Date(), created_by: 'qa', created_at: serverTimestamp(),
        ...overrides
    };
}

function movement(overrides = {}) {
    return {
        item_id: 'flour', item_name: 'Tepung', dimension_id: 'outlet-kemang',
        quantity: 25000, base_unit: 'g', amount: 300000, movement_type: 'receipt',
        source: { collection: 'goods_receipts', id: 'gr1' }, journal_ref: 'j1',
        period_key: '2026-08', entity_id: WS, created_by: 'qa', created_at: serverTimestamp(),
        ...overrides
    };
}

function asset(overrides = {}) {
    return {
        name: 'Oven Rational', asset_account_code: '1500',
        cost: 10000000, salvage_value: 0, useful_life_months: 36,
        in_service_date: '2026-01-15', method: 'straight_line',
        dimension_id: null, notes: null, status: 'active',
        accumulated_depreciation: 0, last_depreciated_period: null,
        created_by: 'qa', created_at: serverTimestamp(), updated_at: serverTimestamp(),
        ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    console.log('\n— goods_receipts —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance creates a receipt', true, () =>
        setDoc(doc(db, `workspaces/${WS}/goods_receipts/gr1`), receipt()));
    await expectOutcome('marking it billed is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/goods_receipts/gr1`), { status: 'billed', bill_id: 'b1' }));
    await expectOutcome('negative total is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/goods_receipts/gr-neg`), receipt({ total_amount: -1 })));
    await expectOutcome('unknown status is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/goods_receipts/gr-bad`), receipt({ status: 'draft' })));
    await expectOutcome('non-list lines is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/goods_receipts/gr-lines`), receipt({ lines: 'nope' })));
    // It carries an immutable journal — correct by reversal, never by deletion.
    await expectOutcome('deleting a receipt is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/goods_receipts/gr1`)));

    console.log('\n— stock_movements: the subledger —');
    await expectOutcome('finance records a receipt movement', true, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_movements/m1`), movement()));
    await expectOutcome('a NEGATIVE quantity is allowed (stock out)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_movements/m2`), movement({ quantity: -450, amount: -5400, movement_type: 'issue' })));
    await expectOutcome('waste is a valid movement type', true, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_movements/m3`), movement({ quantity: -100, amount: -1200, movement_type: 'waste' })));
    await expectOutcome('unknown movement_type is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_movements/m-bad`), movement({ movement_type: 'shrinkage' })));
    await expectOutcome('missing period_key is denied', false, () => {
        const m = movement(); delete m.period_key;
        return setDoc(doc(db, `workspaces/${WS}/stock_movements/m-nopk`), m);
    });
    // These two are the point of the spec. Either one silently breaks the
    // contract that 1200's balance equals the sum of movement amounts.
    await expectOutcome('UPDATING a movement is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/stock_movements/m1`), { quantity: 99999 }));
    await expectOutcome('DELETING a movement is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/stock_movements/m1`)));

    console.log('\n— fixed_assets: the register depreciation runs over —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance registers an asset', true, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa1`), asset()));
    await expectOutcome('renaming it is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/fixed_assets/fa1`), { name: 'Oven Rational SCC' }));
    // Disposal is a STATUS, never a delete: the asset is referenced by every
    // depreciation journal it generated, and those are immutable.
    await expectOutcome('disposing it is a status change', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/fixed_assets/fa1`), { status: 'disposed' }));
    await expectOutcome('an unknown status is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa-bad`), asset({ status: 'pending' })));
    await expectOutcome('a negative cost is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa-neg`), asset({ cost: -1 })));
    await expectOutcome('a non-numeric life is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa-life`), asset({ useful_life_months: 'three years' })));
    await expectOutcome('an empty name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa-noname`), asset({ name: '' })));
    // Deleting one would leave 1590 carrying a balance nothing explains.
    await expectOutcome('deleting an asset is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/fixed_assets/fa1`)));

    console.log('\n— viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer receipt create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/goods_receipts/gr-viewer`), receipt()));
    await expectOutcome('viewer movement create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_movements/m-viewer`), movement()));
    await expectOutcome('viewer asset create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/fixed_assets/fa-viewer`), asset()));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
