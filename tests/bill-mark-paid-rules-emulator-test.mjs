// =============================================================================
// FluxyOS — bill "mark as paid → ledger" firestore.rules test (emulator-only)
//
// Verifies the rules change that lets marking a bill paid post a linked expense:
//   - transactions create accepts the new `linked_bill_id` key (string),
//   - bills update accepts `linked_transaction_id` + `updated_at`/`updated_by`
//     alongside the unpaid→paid + committed→converted_to_actual transition,
//   - the create+update batch commits together,
//   - bad shapes (non-string link ids) are still DENIED.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/bill-mark-paid-rules-emulator-test.mjs"
//
// Talks only to the local emulators; exits non-zero on any failed expectation.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, collection,
    setDoc, updateDoc, serverTimestamp, writeBatch, Timestamp
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

function billCreatePayload() {
    return {
        amount: 1250000,
        vendor_name: 'AWS',
        category: 'Infrastructure',
        type: 'pending_payable',
        status: 'Upcoming',
        icon: '💸',
        timestamp: serverTimestamp(),
        due_date: serverTimestamp(),
        payment_status: 'unpaid',
        budget_impact_status: 'committed'
    };
}

function paymentTxPayload(billId) {
    return {
        amount: 1250000,
        vendor_name: 'AWS',
        category: 'Infrastructure',
        type: 'expense',
        status: 'Completed',
        icon: '💸',
        timestamp: Timestamp.fromDate(new Date()),
        notes: 'Payment for bill AWS',
        linked_bill_id: billId,
        cash_effective: true,
        cash_status: 'actual',
        cash_direction: 'out',
        cash_account_id: null,
        cash_source: 'manual',
        cash_match_status: 'manual',
        cash_effective_at: Timestamp.fromDate(new Date()),
        created_at: serverTimestamp()
    };
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    const billRef = doc(db, `users/${uid}/bills/bill_pay_test`);

    console.log('\n— setup: create an unpaid bill —');
    await expectOutcome('create unpaid bill', true, () => setDoc(billRef, billCreatePayload()));

    console.log('\n— mark paid: bad shapes must be DENIED —');
    await expectOutcome('tx create with non-string linked_bill_id', false, () => {
        const txRef = doc(collection(db, `users/${uid}/transactions`));
        return setDoc(txRef, { ...paymentTxPayload(12345), linked_bill_id: 12345 });
    });
    await expectOutcome('bill update with non-string linked_transaction_id', false, () => updateDoc(billRef, {
        payment_status: 'paid',
        budget_impact_status: 'converted_to_actual',
        linked_transaction_id: 999,
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    console.log('\n— mark paid: the real batch (tx create + bill update) is ALLOWED —');
    const txRef = doc(collection(db, `users/${uid}/transactions`));
    await expectOutcome('mark paid batch: expense create + bill update', true, () => {
        const batch = writeBatch(db);
        batch.set(txRef, paymentTxPayload(billRef.id));
        batch.update(billRef, {
            payment_status: 'paid',
            budget_impact_status: 'converted_to_actual',
            linked_transaction_id: txRef.id,
            updated_at: serverTimestamp(),
            updated_by: uid
        });
        return batch.commit();
    });

    console.log('\n— sanity: a plain expense WITHOUT linked_bill_id still works —');
    await expectOutcome('plain expense create (no link)', true, () => {
        const ref = doc(collection(db, `users/${uid}/transactions`));
        const p = paymentTxPayload(billRef.id);
        delete p.linked_bill_id;
        return setDoc(ref, p);
    });

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
