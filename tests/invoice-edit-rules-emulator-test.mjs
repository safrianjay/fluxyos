// =============================================================================
// FluxyOS — invoice "finalize only" edit firestore.rules test (emulator-only)
//
// Verifies the rules change that lets a finalized-but-unsent (open + no
// sent_at) invoice stay fully editable, while a SENT invoice locks back to
// metadata-only edits and item writes are blocked. Run via:
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/invoice-edit-rules-emulator-test.mjs"
//
// Talks only to the local emulators; exits non-zero on any failed expectation.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, collection,
    setDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';

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

function invoiceCreatePayload(uid) {
    return {
        invoice_number: 'INV-202606-0001',
        status: 'draft',
        currency: 'IDR',
        customer_name: 'PT Maju Bersama',
        customer_email: 'billing@maju.com',
        customer_language: 'English',
        issue_date: serverTimestamp(),
        due_date: serverTimestamp(),
        due_terms: 'due_in_30_days',
        item_count: 1,
        subtotal_amount: 1000000,
        tax_amount: 0,
        tax_rate_percent: null,
        discount_amount: 0,
        total_amount: 1000000,
        amount_due: 1000000,
        memo: null,
        footer: null,
        payment_collection_method: 'request_payment',
        payment_link_enabled: false,
        payment_page_url: null,
        finalized_at: null,
        sent_at: null,
        paid_at: null,
        voided_at: null,
        void_reason: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: uid,
        updated_by: uid
    };
}

function itemPayload(overrides = {}) {
    return {
        description: 'Consulting',
        quantity: 1,
        unit_price: 1000000,
        amount: 1000000,
        position: 0,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        ...overrides
    };
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    const invId = 'inv_edit_test';
    const invRef = doc(db, `users/${uid}/invoices/${invId}`);
    const itemsCol = collection(db, `users/${uid}/invoices/${invId}/items`);
    const itemRef = doc(itemsCol, 'item1');

    console.log('\n— setup: draft + item, then finalize-only —');
    await expectOutcome('create draft invoice', true, () => setDoc(invRef, invoiceCreatePayload(uid)));
    await expectOutcome('create item on draft', true, () => setDoc(itemRef, itemPayload()));
    await expectOutcome('finalize draft -> open (no sent)', true, () => updateDoc(invRef, {
        status: 'open',
        finalized_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    console.log('\n— finalize-only (open + unsent): full edits allowed —');
    await expectOutcome('edit open-unsent: customer + amounts', true, () => updateDoc(invRef, {
        customer_name: 'PT Maju Bersama (rev)',
        subtotal_amount: 2000000,
        total_amount: 2000000,
        amount_due: 2000000,
        item_count: 2,
        due_date: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('update item on open-unsent', true, () => updateDoc(itemRef, {
        description: 'Consulting (revised)',
        quantity: 2,
        unit_price: 1000000,
        amount: 2000000,
        updated_at: serverTimestamp()
    }));
    await expectOutcome('add item on open-unsent', true, () => setDoc(doc(itemsCol, 'item2'), itemPayload({ description: 'Setup fee', position: 1 })));
    await expectOutcome('delete item on open-unsent', true, () => deleteDoc(doc(itemsCol, 'item2')));

    console.log('\n— record sent: metadata-only update —');
    await expectOutcome('record sent_at on open invoice', true, () => updateDoc(invRef, {
        sent_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    console.log('\n— after sent: full edits + item writes must be DENIED —');
    await expectOutcome('edit sent: change customer_name', false, () => updateDoc(invRef, {
        customer_name: 'Hacker Co',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('edit sent: change amounts', false, () => updateDoc(invRef, {
        total_amount: 1,
        amount_due: 1,
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('update item after sent', false, () => updateDoc(itemRef, {
        description: 'tampered',
        quantity: 1,
        unit_price: 1,
        amount: 1,
        updated_at: serverTimestamp()
    }));
    await expectOutcome('add item after sent', false, () => setDoc(doc(itemsCol, 'item3'), itemPayload({ description: 'Sneaky', position: 2 })));
    await expectOutcome('delete item after sent', false, () => deleteDoc(itemRef));

    console.log('\n— after sent: memo/footer metadata edit still allowed —');
    await expectOutcome('edit sent: memo/footer only', true, () => updateDoc(invRef, {
        memo: 'Thanks for your business',
        footer: 'Wire to BCA 123',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
