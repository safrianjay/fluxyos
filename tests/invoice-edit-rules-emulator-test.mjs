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
    setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, Timestamp
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

    console.log('\n— mark paid: forgery attempts must be DENIED —');
    await expectOutcome('forge paid_at without status change', false, () => updateDoc(invRef, {
        paid_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('open -> paid without linked_transaction_id', false, () => updateDoc(invRef, {
        status: 'paid',
        paid_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    const draftRef = doc(db, `users/${uid}/invoices/inv_paid_draft_test`);
    await expectOutcome('create second draft invoice', true, () => setDoc(draftRef, {
        ...invoiceCreatePayload(uid),
        invoice_number: 'INV-202606-0002'
    }));
    await expectOutcome('draft -> paid (must finalize first)', false, () => updateDoc(draftRef, {
        status: 'paid',
        paid_at: serverTimestamp(),
        linked_transaction_id: 'tx_fake',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    console.log('\n— mark paid: open -> paid batch (invoice + income transaction) —');
    const txRef = doc(collection(db, `users/${uid}/transactions`));
    await expectOutcome('mark paid batch: tx create + invoice update', true, () => {
        const batch = writeBatch(db);
        batch.set(txRef, {
            amount: 2000000,
            vendor_name: 'PT Maju Bersama (rev)',
            category: 'Revenue',
            type: 'income',
            status: 'Completed',
            icon: '💰',
            timestamp: Timestamp.fromDate(new Date()),
            invoice_number: 'INV-202606-0001',
            notes: 'Payment for invoice INV-202606-0001',
            created_at: serverTimestamp()
        });
        batch.update(invRef, {
            status: 'paid',
            paid_at: serverTimestamp(),
            linked_transaction_id: txRef.id,
            updated_at: serverTimestamp(),
            updated_by: uid
        });
        return batch.commit();
    });

    console.log('\n— after paid: everything is terminal —');
    await expectOutcome('full edit after paid', false, () => updateDoc(invRef, {
        customer_name: 'Hacker Co',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('memo metadata edit after paid', false, () => updateDoc(invRef, {
        memo: 'late note',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('void after paid', false, () => updateDoc(invRef, {
        status: 'void',
        voided_at: serverTimestamp(),
        void_reason: 'changed my mind',
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('un-pay (paid -> open)', false, () => updateDoc(invRef, {
        status: 'open',
        paid_at: null,
        linked_transaction_id: null,
        updated_at: serverTimestamp(),
        updated_by: uid
    }));
    await expectOutcome('item update after paid', false, () => updateDoc(itemRef, {
        description: 'tampered post-paid',
        quantity: 1,
        unit_price: 1,
        amount: 1,
        updated_at: serverTimestamp()
    }));
    await expectOutcome('item create after paid', false, () => setDoc(doc(itemsCol, 'item4'), itemPayload({ description: 'Late add', position: 3 })));
    await expectOutcome('item delete after paid', false, () => deleteDoc(itemRef));

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
