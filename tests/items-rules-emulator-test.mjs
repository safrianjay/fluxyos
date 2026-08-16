// =============================================================================
// FluxyOS — items firestore.rules test (emulator-only)
//
// The inventory master: ingredients, finished goods, and menu items.
//
// Rules deliberately stop at six inline field checks. units[] and conversion
// factors are validated in inventory-engine.js because rules cannot iterate an
// array cheaply and the evaluation budget is real (incidents recorded at
// firestore.rules lines 3367, 3526, 3546). This spec therefore covers the
// boundary rules OWN — role gates, the type enum, base_unit presence, status,
// and no-delete — and deliberately asserts that a nonsense units[] is NOT
// rejected here, so the split stays visible rather than being assumed.
//
// Schema: docs/data-model/items.md
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/items-rules-emulator-test.mjs"
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

const WS = 'ws_items_test';

function item(overrides = {}) {
    return {
        name: 'Tepung Terigu', name_key: 'tepung terigu', type: 'stock',
        base_unit: 'g', units: [{ code: 'kg', factor: 1000, role: 'purchase' }],
        sku: 'FLR-001', default_cogs_account_code: '5100', notes: null,
        status: 'active', created_at: serverTimestamp(), updated_at: serverTimestamp(),
        ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    console.log('\n— items: finance+ writes —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance creates a stock item', true, () =>
        setDoc(doc(db, `workspaces/${WS}/items/flour`), item()));
    await expectOutcome('a composite (recipe) item is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/items/nasgor`), item({
            name: 'Nasi Goreng', name_key: 'nasi goreng', type: 'composite',
            base_unit: 'porsi', units: [], sku: null
        })));
    await expectOutcome('an item with no alternate units is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/items/telur`), item({
            name: 'Telur', name_key: 'telur', base_unit: 'pcs', units: [], sku: 'EGG-001'
        })));
    await expectOutcome('archiving via status is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/items/telur`), { status: 'archived', updated_at: serverTimestamp() }));

    console.log('\n— items: what rules DO reject —');
    await expectOutcome('unknown type is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/bad-type`), item({ type: 'service' })));
    await expectOutcome('empty name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/no-name`), item({ name: '' })));
    await expectOutcome('name over 120 chars is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/long`), item({ name: 'x'.repeat(121) })));
    await expectOutcome('missing base_unit is denied', false, () => {
        const i = item(); delete i.base_unit;
        return setDoc(doc(db, `workspaces/${WS}/items/no-base`), i);
    });
    await expectOutcome('empty base_unit is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/empty-base`), item({ base_unit: '' })));
    await expectOutcome('unknown status is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/bad-status`), item({ status: 'deleted' })));
    // Stock movements and journal lines will reference items, and both are
    // immutable — archive is the only exit.
    await expectOutcome('deleting an item is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/items/flour`)));

    console.log('\n— items: what rules deliberately do NOT reject —');
    // These are the engine's job (INV_002 / INV_004 / INV_005). Asserting that
    // rules let them through keeps the division of labour explicit: if someone
    // later tightens rules to iterate units[], this test tells them they have
    // changed the contract, not just added a check.
    await expectOutcome('a fractional conversion factor passes RULES (engine rejects it)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/items/loose`), item({
            name: 'Susu', name_key: 'susu', base_unit: 'ml', sku: 'MLK-001',
            units: [{ code: 'cup', factor: 236.588 }]
        })));
    await expectOutcome('a duplicate SKU passes RULES (the DAL enforces uniqueness)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/items/dupe-sku`), item({
            name: 'Tepung Lain', name_key: 'tepung lain', sku: 'FLR-001'
        })));

    console.log('\n— items: viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/viewer-item`), item({ name: 'Nope', name_key: 'nope', sku: null })));
    await expectOutcome('viewer update is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/items/flour`), { name: 'Renamed' }));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
