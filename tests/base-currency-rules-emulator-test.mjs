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

    // ---- holds_stock -------------------------------------------------------
    //
    // The direct answer to "do you hold stock", asked at onboarding and read by
    // feature-access.js ahead of the business category. `hasOnly` on
    // isValidWorkspaceProfile means an UNDEPLOYED rules file rejects the whole
    // workspace write, not just the field — so onboarding breaks entirely if the
    // client ships first. That is what these assert.
    //
    // Exercised through UPDATE rather than create: `allow create` requires
    // workspaceId == uid, so a signed-in user gets exactly one create and the
    // currency case above already spent it. Both paths call the same validator.
    console.log('\n— holds_stock —');
    const WS_STOCK = 'ws_stock_answer';
    await seedWorkspace(WS_STOCK, uid);

    await expectOutcome('holds_stock true is accepted', true, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { holds_stock: true, updated_at: serverTimestamp() }));

    // FALSE is a real answer, not an absent one. If the validator only accepted
    // truthy values the "no" branch would be unwritable and every such workspace
    // would silently fall back to its category.
    await expectOutcome('holds_stock false is accepted', true, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { holds_stock: false, updated_at: serverTimestamp() }));

    // NOT set-once, unlike country/base_currency: a consultancy that opens a
    // shop genuinely changes answer, and nothing already recorded is re-read
    // because of it.
    await expectOutcome('the owner may change the answer later', true, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { holds_stock: true, updated_at: serverTimestamp() }));

    await expectOutcome('holds_stock must be a boolean, not a string', false, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { holds_stock: 'yes', updated_at: serverTimestamp() }));

    // Its twin, for POS. Same shape, same hasOnly consequence: an undeployed
    // ruleset rejects the whole workspace write, not just the key.
    await expectOutcome('sells_at_counter true is accepted', true, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { sells_at_counter: true, updated_at: serverTimestamp() }));
    await expectOutcome('sells_at_counter false is accepted', true, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { sells_at_counter: false, updated_at: serverTimestamp() }));
    await expectOutcome('sells_at_counter must be a boolean', false, () =>
        updateDoc(doc(db, `workspaces/${WS_STOCK}`), { sells_at_counter: 1, updated_at: serverTimestamp() }));

    // ---- a non-IDR workspace can actually operate ------------------------
    //
    // Before D3 these validators asserted `data.currency == 'IDR'`, so a
    // Philippine workspace could not create a bank account at all. Not a soft
    // default — a write rejection on day one.
    console.log('\n— a PHP workspace can create finance records —');
    const WS_PH = 'ws_ph_ops';
    await seedWorkspace(WS_PH, uid, { country: 'PH', base_currency: 'PHP' });

    await expectOutcome('PHP bank account', true, () =>
        setDoc(doc(db, `workspaces/${WS_PH}/bank_accounts/acc1`), {
            account_name: 'BPI Main', bank_name: 'BPI', currency: 'PHP',
            source_type: 'manual', status: 'active',
            latest_balance: 12500000, latest_balance_at: serverTimestamp(),
            sync_status: 'manual',
            created_at: serverTimestamp(), updated_at: serverTimestamp()
        }));

    await expectOutcome('PHP budget', true, () =>
        setDoc(doc(db, `workspaces/${WS_PH}/budgets/b1`), {
            name: 'Q3', period_type: 'quarterly',
            period_start: serverTimestamp(), period_end: serverTimestamp(),
            currency: 'PHP', total_budget: 50000000, status: 'active',
            created_at: serverTimestamp(), updated_at: serverTimestamp()
        }));

    // The set is bounded — an unsupported currency is still refused.
    await expectOutcome('a THB bank account is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS_PH}/bank_accounts/acc2`), {
            account_name: 'Bangkok', bank_name: 'BBL', currency: 'THB',
            source_type: 'manual', status: 'active',
            latest_balance: 1000, latest_balance_at: serverTimestamp(),
            sync_status: 'manual',
            created_at: serverTimestamp(), updated_at: serverTimestamp()
        }));

    // ---- a business must be able to invoice in its OWN currency -----------
    console.log('\n— face currencies include the workspace currency —');
    await expectOutcome('a PHP invoice in a PHP workspace', true, () =>
        setDoc(doc(db, `workspaces/${WS_PH}/invoices/inv1`), {
            invoice_number: 'INV-202608-0001', status: 'draft', currency: 'PHP',
            customer_name: 'Cliente', customer_email: 'c@example.com', customer_language: 'English',
            issue_date: serverTimestamp(), due_terms: 'due_in_30_days', item_count: 1,
            subtotal_amount: 1250000, tax_amount: 0, discount_amount: 0,
            total_amount: 1250000, amount_due: 1250000,
            payment_collection_method: 'manual_only', payment_link_enabled: false,
            payment_page_url: null, created_at: serverTimestamp(), updated_at: serverTimestamp(),
            created_by: uid, updated_by: uid
        }));

    await expectOutcome('an unsupported face currency (THB) is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS_PH}/invoices/inv2`), {
            invoice_number: 'INV-202608-0002', status: 'draft', currency: 'THB',
            customer_name: 'Cliente', customer_email: 'c@example.com', customer_language: 'English',
            issue_date: serverTimestamp(), due_terms: 'due_in_30_days', item_count: 1,
            subtotal_amount: 1000, tax_amount: 0, discount_amount: 0,
            total_amount: 1000, amount_due: 1000,
            payment_collection_method: 'manual_only', payment_link_enabled: false,
            payment_page_url: null, created_at: serverTimestamp(), updated_at: serverTimestamp(),
            created_by: uid, updated_by: uid
        }));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
