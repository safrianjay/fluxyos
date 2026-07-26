// =============================================================================
// FluxyOS — CoA Phase 1 firestore.rules test (emulator-only)
//
// Verifies the workspace-scoped business_categories collection (founder-facing
// category taxonomy) and the tightened chart_of_accounts invariant:
//   - business_categories: role gates (finance+ write, viewer read-only),
//     lean field validation, no delete (deactivate via is_active).
//   - chart_of_accounts: `code` can never diverge from the doc id; viewers
//     cannot write; partial merge updates (archive flip) still pass.
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/business-categories-rules-emulator-test.mjs"
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

const WS = 'ws_bizcat_test';

function category(overrides = {}) {
    return {
        name: 'Rent', name_id: 'Sewa', type: 'expense', default_account_code: '6420',
        icon: null, color: null, is_active: false, is_builtin: false, sort_order: 7,
        created_at: serverTimestamp(), ...overrides
    };
}

function account(code, overrides = {}) {
    return {
        code, name: 'Rent Expense', name_id: 'Beban Sewa', type: 'expense', subtype: null,
        sak_category: 'operating_expense', parent_code: '6400', is_system: false,
        normal_balance: 'debit', is_active: true, currency: 'IDR',
        entity_id: WS, opening_balance: 0, created_at: serverTimestamp(), ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    console.log('\n— business_categories: finance+ writes —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance creates a valid category', true, () =>
        setDoc(doc(db, `workspaces/${WS}/business_categories/rent`), category()));
    await expectOutcome('finance deactivates a category (is_active flip)', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/business_categories/rent`), { is_active: false, updated_at: serverTimestamp() }));
    await expectOutcome('missing name is denied', false, () => {
        const c = category(); delete c.name;
        return setDoc(doc(db, `workspaces/${WS}/business_categories/no-name`), c);
    });
    await expectOutcome('name over 80 chars is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/business_categories/long-name`), category({ name: 'x'.repeat(81) })));
    await expectOutcome('missing default_account_code is denied', false, () => {
        const c = category(); delete c.default_account_code;
        return setDoc(doc(db, `workspaces/${WS}/business_categories/no-acct`), c);
    });
    await expectOutcome('non-bool is_active is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/business_categories/bad-active`), category({ is_active: 'yes' })));
    await expectOutcome('deleting a category is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/business_categories/rent`)));

    console.log('\n— business_categories: viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer create is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/business_categories/viewer-cat`), category()));
    await expectOutcome('viewer update is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/business_categories/rent`), { is_active: true }));

    console.log('\n— chart_of_accounts: code == doc id invariant —');
    await setMemberRole(uid, 'accountant');
    await expectOutcome('accountant creates an account whose code matches the id', true, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6420`), account('6420')));
    await expectOutcome('code diverging from doc id is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6421`), account('9999')));
    await expectOutcome('update rewriting code to another value is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6420`), { code: '6499' }));
    await expectOutcome('archive flip via partial merge is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6420`), { is_active: false, updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('hard-delete is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6420`)));

    console.log('\n— chart_of_accounts: viewer is read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer account write is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/chart_of_accounts/6430`), account('6430')));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
