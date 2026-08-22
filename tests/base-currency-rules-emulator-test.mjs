// =============================================================================
// FluxyOS — workspace base currency + country firestore.rules test
// (emulator-only)
//
// The base currency decides how every stored integer is READ. IDR stores rupiah
// (minorPerUnit 1); PHP/SGD/MYR store cents (minorPerUnit 100). So flipping it
// after records exist does not "convert" anything — it silently re-prices every
// figure in the workspace by 100x, and re-interprets closed periods whose net
// income is already posted to Retained Earnings.
//
// Hiding the control in Settings is NOT enforcement: this is a static site with
// a client-side Firestore SDK, so firestore.rules IS the backend. These cases
// are the actual guarantee.
//
// Covers:
//   - the enum: only the four supported countries / base currencies
//   - SET-ONCE: absent -> value allowed, value -> different value denied
//   - set-once holds for the OWNER too, not just admins
//   - re-writing the SAME value is allowed (idempotent saves must not break)
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/base-currency-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, serverTimestamp
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

async function seedWorkspace(wsId, uid, extra = {}) {
    await adminDb.doc(`workspaces/${wsId}`).set({
        owner_uid: uid, name: 'Test Co',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        ...extra
    });
    await adminDb.doc(`workspaces/${wsId}/members/${uid}`).set({ uid, role: 'owner', status: 'active' });
}

async function main() {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;

    // ---- enum validation --------------------------------------------------
    console.log('\n— supported values only —');
    const WS_ENUM = 'ws_ccy_enum';
    await seedWorkspace(WS_ENUM, uid);

    await expectOutcome('stamping country=PH + base_currency=PHP is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS_ENUM}`), { country: 'PH', base_currency: 'PHP', updated_at: serverTimestamp() }));

    const WS_BAD = 'ws_ccy_bad';
    await seedWorkspace(WS_BAD, uid);
    await expectOutcome('an unsupported currency (THB) is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_BAD}`), { base_currency: 'THB', updated_at: serverTimestamp() }));
    await expectOutcome('an unsupported country (TH) is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_BAD}`), { country: 'TH', updated_at: serverTimestamp() }));
    await expectOutcome('a full country NAME instead of ISO-2 is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_BAD}`), { country: 'Philippines', updated_at: serverTimestamp() }));
    // USD is a transaction currency, never a base currency in this release.
    await expectOutcome('USD as a BASE currency is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_BAD}`), { base_currency: 'USD', updated_at: serverTimestamp() }));

    // ---- set-once ---------------------------------------------------------
    console.log('\n— set once, then immutable —');
    const WS_LOCK = 'ws_ccy_lock';
    await seedWorkspace(WS_LOCK, uid, { country: 'ID', base_currency: 'IDR' });

    await expectOutcome('re-writing the SAME base currency is allowed (idempotent save)', true, () =>
        updateDoc(doc(db, `workspaces/${WS_LOCK}`), { base_currency: 'IDR', name: 'Renamed Co', updated_at: serverTimestamp() }));

    await expectOutcome('changing IDR -> PHP is denied, even for the owner', false, () =>
        updateDoc(doc(db, `workspaces/${WS_LOCK}`), { base_currency: 'PHP', updated_at: serverTimestamp() }));

    await expectOutcome('changing the country ID -> PH is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_LOCK}`), { country: 'PH', updated_at: serverTimestamp() }));

    // The sneaky one: smuggling the change inside an otherwise-legitimate write.
    await expectOutcome('changing it alongside a legitimate rename is still denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS_LOCK}`), { name: 'New Name', base_currency: 'MYR', updated_at: serverTimestamp() }));

    // Unrelated edits must keep working — the lock is on two fields, not the doc.
    await expectOutcome('renaming the workspace still works with the lock in place', true, () =>
        updateDoc(doc(db, `workspaces/${WS_LOCK}`), { name: 'Still Editable', updated_at: serverTimestamp() }));

    // ---- create path ------------------------------------------------------
    console.log('\n— create carries it too —');
    await expectOutcome('creating own workspace with country + base currency is allowed', true, () =>
        setDoc(doc(db, `workspaces/${uid}`), {
            owner_uid: uid, name: 'Bootstrap Co', country: 'SG', base_currency: 'SGD',
            created_at: serverTimestamp(), updated_at: serverTimestamp()
        }));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
