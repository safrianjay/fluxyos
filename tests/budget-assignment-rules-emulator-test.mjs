// =============================================================================
// FluxyOS — budget assignment firestore.rules regression test (emulator-only)
//
// Verifies record-level budget assignment writes for legacy records that already
// carry an old `updated_at` or legacy `date` field. Run via:
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/budget-assignment-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore,
    connectFirestoreEmulator,
    doc,
    collection,
    writeBatch,
    updateDoc,
    serverTimestamp
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

async function expectAllowed(label, run) {
    try {
        await run();
        passed++;
        console.log(`  PASS (allowed)  ${label}`);
    } catch (err) {
        failed++;
        console.error(`  FAIL (should allow)  ${label} -> ${err?.code || err?.message}`);
    }
}

async function expectDenied(label, run) {
    try {
        await run();
        failed++;
        console.error(`  FAIL (should deny)  ${label}`);
    } catch (err) {
        const denied = err?.code === 'permission-denied'
            || /permission|PERMISSION/.test(String(err?.message));
        if (denied) {
            passed++;
            console.log(`  PASS (denied)   ${label}`);
        } else {
            failed++;
            console.error(`  FAIL (unexpected error)  ${label} -> ${err?.code || err?.message}`);
        }
    }
}

function txRef(uid, txId) {
    return doc(db, `users/${uid}/transactions/${txId}`);
}

function billRef(uid, billId) {
    return doc(db, `users/${uid}/bills/${billId}`);
}

function auditRef(uid) {
    return doc(collection(db, `users/${uid}/audit_logs`));
}

function auditPayload(uid, targetCollection, targetId, budgetId, allocationId) {
    return {
        actor_uid: uid,
        actor_role: null,
        action: 'budget_assignment.update',
        target_collection: targetCollection,
        target_id: targetId,
        before: {},
        after: { budget_id: budgetId, budget_allocation_id: allocationId },
        reason: 'good',
        source: 'dashboard',
        created_at: serverTimestamp()
    };
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    const txId = 'legacy-budget-assignment-tx';
    const billId = 'legacy-budget-assignment-bill';
    const budgetId = 'period-budget-1';
    const allocationId = 'allocation-saas';
    const legacyDate = '2026-06-09';
    const recordTimestamp = admin.firestore.Timestamp.fromDate(new Date('2026-06-09T12:00:00Z'));

    await adminDb.doc(`users/${uid}/transactions/${txId}`).set({
        amount: 1500000,
        vendor_name: 'Grand indo marketing',
        category: 'Marketing',
        type: 'expense',
        status: 'Completed',
        icon: '$',
        date: legacyDate,
        timestamp: recordTimestamp,
        created_at: recordTimestamp,
        updated_at: admin.firestore.Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
        updated_by: uid
    });

    await expectAllowed('transaction assignment with stale updated_at + preserved legacy date', () => {
        const batch = writeBatch(db);
        batch.update(txRef(uid, txId), {
            budget_id: budgetId,
            budget_allocation_id: allocationId,
            budget_match_method: 'manual',
            budget_match_status: 'matched',
            budget_match_confidence: 1,
            budget_exclusion_reason: null,
            budget_assignment_reason: 'good',
            budget_assignment_updated_at: serverTimestamp(),
            budget_assignment_updated_by: uid,
            updated_at: serverTimestamp(),
            updated_by: uid
        });
        batch.set(auditRef(uid), auditPayload(uid, 'transactions', txId, budgetId, allocationId));
        return batch.commit();
    });

    await expectDenied('transaction assignment cannot change legacy date', () => updateDoc(txRef(uid, txId), {
        date: '2026-06-10',
        budget_assignment_reason: 'change date should fail',
        budget_assignment_updated_at: serverTimestamp(),
        budget_assignment_updated_by: uid,
        updated_at: serverTimestamp(),
        updated_by: uid
    }));

    await adminDb.doc(`users/${uid}/bills/${billId}`).set({
        amount: 1500000,
        vendor_name: 'Grand indo marketing',
        category: 'Marketing',
        type: 'expense',
        status: 'Upcoming',
        icon: '$',
        date: legacyDate,
        timestamp: recordTimestamp,
        due_date: admin.firestore.Timestamp.fromDate(new Date('2026-06-20T12:00:00Z')),
        payment_status: 'unpaid'
    });

    await expectAllowed('bill assignment with preserved legacy date', () => {
        const batch = writeBatch(db);
        batch.update(billRef(uid, billId), {
            budget_id: budgetId,
            budget_allocation_id: allocationId,
            budget_match_method: 'manual',
            budget_match_status: 'matched',
            budget_impact_status: 'committed',
            budget_exclusion_reason: null,
            budget_assignment_reason: 'good',
            budget_assignment_updated_at: serverTimestamp(),
            budget_assignment_updated_by: uid
        });
        batch.set(auditRef(uid), auditPayload(uid, 'bills', billId, budgetId, allocationId));
        return batch.commit();
    });

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error('FATAL', err);
    process.exit(1);
});
