// =============================================================================
// FluxyOS — bill payment against a REALISTIC bill (emulator-only)
//
// Regression for a production-only failure: marking a bill paid returned
// "Missing or insufficient permissions" while the same code passed every
// existing emulator test.
//
// The cause was fixture leanness. bill-mark-paid-rules-emulator-test.mjs pays a
// 10-key bill; a real one carries budget assignment, tax + withholding, an
// attachment, a currency, bill numbering and outstanding tracking — 30+ keys.
// Firestore re-validates the ENTIRE resulting document on update, and
// wsValidBillUpdate is a 57-key hasOnly plus ten sub-validators, so the real
// document exhausted the rules evaluation budget. The fix is
// isValidBillPayTransition: a flat, per-transition validator evaluated first,
// the same remedy invoices needed for open -> paid.
//
// So this test pays a bill that is deliberately FAT. If someone reverts the
// lean validator, this fails and the lean-fixture tests still pass.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/bill-pay-heavy-doc-emulator-test.mjs"
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc,
    serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import admin from 'firebase-admin';

// The heavy bill is seeded through the ADMIN SDK, which bypasses rules.
// Not a convenience: wsValidBillCreate itself exceeds the 1000-expression
// budget on a fully-scanned bill (see the note at the bottom of this file), so
// a client create cannot put the fixture in place. Seeding as admin isolates
// the transition under test — the client UPDATE — from that separate problem.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
admin.initializeApp({ projectId: 'fluxyos' });
const adminDb = admin.firestore();

function makeUserCtx(name) {
    const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' }, name);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return { app, db, auth };
}

let passed = 0, failed = 0;
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

// A bill shaped like one a real workspace actually holds.
const heavyBill = (uid) => ({
    amount: 89500000,
    vendor_name: 'PT Global Sukses',
    category: 'Operations',
    type: 'pending_payable',
    status: 'Upcoming',
    icon: '💸',
    timestamp: Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
    due_date: Timestamp.fromDate(new Date('2026-08-15T03:00:00Z')),
    invoice_date: Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
    payment_status: 'unpaid',
    currency: 'IDR',
    bill_number: 'BILL-202608-0022',
    invoice_number: 'INV/2026/VIII/119',
    outstanding_amount: 89500000,
    amount_paid: 0,
    // budget assignment
    budget_id: 'budget-1',
    budget_allocation_id: 'alloc-1',
    budget_match_method: 'auto',
    budget_match_status: 'matched',
    budget_impact_status: 'committed',
    budget_assignment_reason: 'Matched by category',
    budget_assignment_updated_at: serverTimestamp(),
    budget_assignment_updated_by: uid,
    // NOTE: tax + withholding fields are deliberately ABSENT. With them the
    // CREATE itself exceeds the 1000-expression budget — a separate, still-open
    // problem tracked below. This fixture matches a real scanned bill without
    // PPN, which is what the reported failure was.
    // capture provenance + attachment
    source: 'scan',
    created_via: 'ai_bill_scan',
    extraction_status: 'reviewed',
    extraction_source: 'openai',
    extraction_confidence: 0.94,
    document_type: 'invoice',
    source_file_name: 'invoice.pdf',
    source_file_mime_type: 'application/pdf',
    source_file_size_bytes: 220144,
    invoice_status: 'attached',
    attached_documents: [{ document_id: 'doc-1', role: 'invoice', storage_path: 'p/doc-1.pdf', attached_at: null }],
    // accounting link
    account_code: '6400',
    account_name: 'Operations Expense',
    accounting_status: 'posted',
    journal_ref: 'jrn-1'
});

(async () => {
    const owner = makeUserCtx('heavy-owner');
    const cred = await createUserWithEmailAndPassword(owner.auth, 'heavy-owner@test.com', 'passw0rd!');
    const uid = cred.user.uid;
    const WS = uid;

    await setDoc(doc(owner.db, `workspaces/${WS}`), {
        name: 'Heavy Co', owner_uid: uid, created_at: serverTimestamp(), updated_at: serverTimestamp()
    }).catch(() => {});
    await setDoc(doc(owner.db, `workspaces/${WS}/members/${uid}`), {
        uid, email: 'heavy-owner@test.com', display_name: null, role: 'owner', status: 'active',
        invited_by: null, joined_at: serverTimestamp(), updated_at: serverTimestamp()
    }).catch(() => {});

    const billPath = `workspaces/${WS}/bills/heavy-1`;
    console.log('\n1. Seed a realistic bill (admin SDK — rules bypassed)');
    await adminDb.doc(billPath).set({
        ...heavyBill(uid),
        timestamp: admin.firestore.Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
        due_date: admin.firestore.Timestamp.fromDate(new Date('2026-08-15T03:00:00Z')),
        invoice_date: admin.firestore.Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
        budget_assignment_updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('  seeded');

    console.log('\n2. PARTIAL payment on that bill');
    await expectOutcome('partial payment updates outstanding + amount_paid', true,
        () => updateDoc(doc(owner.db, billPath), {
            amount_paid: 23500000,
            outstanding_amount: 66000000,
            payment_status: 'partial',
            updated_at: serverTimestamp(),
            updated_by: uid
        }));

    console.log('\n3. FULL payment — the transition that failed in production');
    await expectOutcome('full payment: paid + converted_to_actual + linked transaction', true,
        () => updateDoc(doc(owner.db, billPath), {
            amount_paid: 89500000,
            outstanding_amount: 0,
            payment_status: 'paid',
            budget_impact_status: 'converted_to_actual',
            linked_transaction_id: 'tx-abc',
            updated_at: serverTimestamp(),
            updated_by: uid
        }));

    console.log('\n4. The lean validator must not become a hole');
    await expectOutcome('cannot rewrite the amount through the payment path', false,
        () => updateDoc(doc(owner.db, billPath), {
            amount: 1, payment_status: 'paid', amount_paid: 1, outstanding_amount: 0,
            updated_at: serverTimestamp(), updated_by: uid
        }));
    await expectOutcome('cannot change the vendor through the payment path', false,
        () => updateDoc(doc(owner.db, billPath), {
            vendor_name: 'Someone Else', payment_status: 'paid', amount_paid: 1, outstanding_amount: 0,
            updated_at: serverTimestamp(), updated_by: uid
        }));
    await expectOutcome('rejects a negative outstanding balance', false,
        () => updateDoc(doc(owner.db, billPath), {
            payment_status: 'paid', amount_paid: 1, outstanding_amount: -5,
            updated_at: serverTimestamp(), updated_by: uid
        }));
    await expectOutcome('rejects an unknown payment_status', false,
        () => updateDoc(doc(owner.db, billPath), {
            payment_status: 'settled', amount_paid: 1, outstanding_amount: 0,
            updated_at: serverTimestamp(), updated_by: uid
        }));

    console.log('\n5. The whole payment BATCH, as _payBillOnce commits it');
    await expectOutcome('tx create + bill update + audit log in one batch', true, () => {
        const batch = writeBatch(owner.db);
        batch.set(doc(owner.db, `workspaces/${WS}/transactions/txpay-1`), {
            amount: 66000000, vendor_name: 'PT Global Sukses', category: 'Operations',
            type: 'expense', status: 'Completed', icon: '💸', timestamp: serverTimestamp(),
            created_at: serverTimestamp(), linked_bill_id: 'heavy-1',
            account_code: '6400', account_name: 'Operations Expense'
        });
        batch.update(doc(owner.db, billPath), {
            amount_paid: 89500000, outstanding_amount: 0, payment_status: 'paid',
            budget_impact_status: 'converted_to_actual', linked_transaction_id: 'txpay-1',
            updated_at: serverTimestamp(), updated_by: uid
        });
        batch.set(doc(owner.db, `workspaces/${WS}/audit_logs/al-1`), {
            actor_uid: uid, actor_role: null, action: 'bill.mark_paid',
            target_collection: 'bills', target_id: 'heavy-1',
            before: null, after: { payment_status: 'paid' }, reason: null,
            source: 'dashboard', created_at: serverTimestamp()
        });
        return batch.commit();
    });

    console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
    console.error('Harness error:', err);
    process.exit(1);
});
