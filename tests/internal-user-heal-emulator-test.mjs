// =============================================================================
// FluxyOS — Internal console legacy-poison self-heal (emulator-only)
//
// Reproduces the reported bug: a reviewer action in the Internal Operations
// Console ("Approve KYC") fails with "Missing or insufficient permissions"
// because the target internal_users doc holds a stray access_status='trialing'
// (a billing status an older client mirrored in, BEFORE the rule constrained
// access_status). The internal_users UPDATE rule re-validates the ENTIRE doc via
// isValidInternalUser, so the stale invalid field bricks every reviewer action
// on that user — even though the action only touches status fields.
//
// The poison is seeded with the Admin SDK (bypasses rules — as the old client
// did under the old rules); the reviewer actions go through the client SDK
// (rules enforced), exactly like production.
//
// Proves the fix (db-service.updateInternalUserStatus → _healInternalEnumFields):
// folding an access_status correction into the SAME batch makes the merged doc
// valid, so the action succeeds and repairs the doc at once.
//
//   firebase emulators:exec --only firestore "node tests/internal-user-heal-emulator-test.mjs"
// =============================================================================
import admin from 'firebase-admin';
import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, collection,
    writeBatch, serverTimestamp,
} from 'firebase/firestore';

// Admin SDK auto-targets the emulator via FIRESTORE_EMULATOR_HOST (set by
// `firebase emulators:exec`) and bypasses security rules — used only to seed the
// legacy-poisoned doc that the current rules would refuse to create.
admin.initializeApp({ projectId: 'fluxyos' });
const adminDb = admin.firestore();

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' }, 'internal-heal');
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

let passed = 0, failed = 0;
async function expectOutcome(label, shouldAllow, run) {
    try {
        await run();
        if (shouldAllow) { passed++; console.log(`  PASS (allowed)  ${label}`); }
        else { failed++; console.error(`  FAIL (should DENY) ${label}`); }
    } catch (err) {
        const denied = err?.code === 'permission-denied' || /permission/i.test(String(err?.message));
        if (!shouldAllow && denied) { passed++; console.log(`  PASS (denied)   ${label}`); }
        else { failed++; console.error(`  FAIL ${shouldAllow ? '(should ALLOW)' : '(unexpected)'} ${label} → ${err?.code || err?.message}`); }
    }
}
function expectEqual(label, actual, expected) {
    if (actual === expected) { passed++; console.log(`  PASS            ${label}`); }
    else { failed++; console.error(`  FAIL ${label} → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

const auditLog = (uid, action) => (b) => {
    b.set(doc(collection(db, 'internal_audit_logs')), {
        actor_uid: null, actor_username: 'fluxyos admin', actor_role: 'internal_admin',
        action, target_user_id: uid, before: null, after: null, reason: null,
        source: 'internal_dashboard', created_at: serverTimestamp(),
    });
};

const uid = 'poisoned-kyc-user';
const ref = doc(db, `internal_users/${uid}`);

// Seed the poisoned doc via Admin (rules bypassed) — access_status='trialing' is
// a billing status not in the internal enum, as an older client left it.
await adminDb.doc(`internal_users/${uid}`).set({
    user_id: uid, email: 'demo@example.com', business_name: 'Bisnis Demo',
    account_status: 'kyc_submitted', kyc_status: 'submitted', payment_status: 'pending',
    access_status: 'trialing', trial_days_remaining: 2,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
});
console.log('  seeded poisoned internal_users doc (access_status=trialing) via Admin');

// BUG — status-only update (what the OLD code sent) is DENIED: the merged doc
// still carries access_status='trialing', which fails isValidInternalUser.
await expectOutcome('BUG: status-only kyc.approve is denied (stale access_status)', false, async () => {
    const b = writeBatch(db);
    b.update(ref, { kyc_status: 'approved', account_status: 'payment_pending', kyc_reviewed_at: serverTimestamp(), updated_at: serverTimestamp() });
    auditLog(uid, 'kyc.approve')(b);
    await b.commit();
});

// FIX — the healed update folds access_status→'trial_active' into the SAME batch,
// so the merged doc validates and the action succeeds.
await expectOutcome('FIX: kyc.approve + access_status heal is allowed', true, async () => {
    const b = writeBatch(db);
    b.update(ref, { access_status: 'trial_active', kyc_status: 'approved', account_status: 'payment_pending', kyc_reviewed_at: serverTimestamp(), updated_at: serverTimestamp() });
    auditLog(uid, 'kyc.approve')(b);
    await b.commit();
});

const after = (await getDoc(ref)).data();
expectEqual('HEALED: access_status corrected', after.access_status, 'trial_active');
expectEqual('HEALED: kyc_status approved', after.kyc_status, 'approved');

console.log(`\nInternal console self-heal: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
