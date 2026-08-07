// =============================================================================
// FluxyOS — KYC review gate: trial-create firestore.rules test (emulator-only)
//
// The KYC gate (assets/js/kyc-gate.js) locks the app for post-cutoff users until
// a reviewer approves them. That lock is client-side UX, exactly like the trial
// paywall — the server-backed half is here: an unapproved, KYC-enforced user
// must not be able to mint a trial subscription even with the overlay bypassed.
//
// Covers isTrialSubscriptionCreate -> passesKycTrialGate:
//   1. kyc_enforced + no internal_users row      -> DENY
//   2. kyc_enforced + kyc_status 'submitted'     -> DENY
//   3. kyc_enforced + kyc_status 'rejected'      -> DENY
//   4. kyc_enforced + kyc_status 'approved'      -> ALLOW
//   5. LEGACY (no kyc_enforced flag) + 'submitted' -> ALLOW  <- regression guard
//      for the entire existing roster, which sits at 'submitted' unreviewed and
//      must keep its trial.
//   6. onboarding_exempt legacy user (invited member) -> ALLOW
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/kyc-trial-gate-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const adminDb = admin.firestore();

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

let passed = 0, failed = 0;
async function expectAllowed(label, run) {
    try { await run(); passed++; console.log(`  PASS (allowed)  ${label}`); }
    catch (err) { failed++; console.error(`  FAIL (should allow)  ${label} -> ${err?.code || err?.message}`); }
}
async function expectDenied(label, run) {
    try { await run(); failed++; console.error(`  FAIL (should deny)  ${label}`); }
    catch (err) {
        const denied = err?.code === 'permission-denied' || /permission/i.test(String(err?.message));
        if (denied) { passed++; console.log(`  PASS (denied)   ${label}`); }
        else { failed++; console.error(`  FAIL (unexpected)  ${label} -> ${err?.code || err?.message}`); }
    }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Seeded with the Admin SDK (bypasses rules), mirroring what completeOnboarding
// writes. `kyc_enforced` is omitted entirely for the legacy cases, which is
// exactly how every pre-cutoff user's doc looks today.
async function seedProgress(uid, { completed = true, exempt = false, kycEnforced = null } = {}) {
    const payload = {
        onboarding_completed: completed,
        onboarding_exempt: exempt,
        eligible_for_onboarding_gate: false,
        current_step: 'complete',
        source: 'onboarding_v2',
        completed_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    if (kycEnforced !== null) payload.kyc_enforced = kycEnforced;
    await adminDb.doc(`users/${uid}/onboarding/progress`).set(payload);
}

async function seedInternal(uid, kycStatus) {
    await adminDb.doc(`internal_users/${uid}`).set({
        user_id: uid,
        email: `${uid}@example.com`,
        account_status: kycStatus === 'approved' ? 'kyc_approved' : 'kyc_submitted',
        kyc_status: kycStatus,
        payment_status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
}

// The exact payload db-service.ensureBillingSubscription writes for a new trial.
// `updated_at` must equal request.time, hence serverTimestamp().
async function createTrial(uid) {
    const startMs = Date.now();
    await setDoc(doc(db, `users/${uid}/billing_subscription/current`), {
        plan_id: 'trial',
        plan_name: 'Trial',
        status: 'trialing',
        billing_frequency: null,
        current_payment_request_id: null,
        trial_started_at: Timestamp.fromMillis(startMs),
        trial_ends_at: Timestamp.fromMillis(startMs + 3 * DAY_MS),
        current_period_start: null,
        current_period_end: null,
        updated_at: serverTimestamp()
    });
}

// Each case runs as its own anonymous user so `isOwner(userId)` holds.
async function asNewUser(fn) {
    await signOut(auth).catch(() => {});
    const cred = await signInAnonymously(auth);
    await fn(cred.user.uid);
}

// 1. Enforced, internal_users row missing entirely.
await asNewUser(async (uid) => {
    await seedProgress(uid, { kycEnforced: true });
    await expectDenied('enforced + no internal row -> trial create denied', () => createTrial(uid));
});

// 2. Enforced, awaiting review.
await asNewUser(async (uid) => {
    await seedProgress(uid, { kycEnforced: true });
    await seedInternal(uid, 'submitted');
    await expectDenied('enforced + kyc submitted -> trial create denied', () => createTrial(uid));
});

// 3. Enforced, rejected.
await asNewUser(async (uid) => {
    await seedProgress(uid, { kycEnforced: true });
    await seedInternal(uid, 'rejected');
    await expectDenied('enforced + kyc rejected -> trial create denied', () => createTrial(uid));
});

// 4. Enforced and approved -> the trial may finally be created, dated from now.
await asNewUser(async (uid) => {
    await seedProgress(uid, { kycEnforced: true });
    await seedInternal(uid, 'approved');
    await expectAllowed('enforced + kyc approved -> trial create allowed', () => createTrial(uid));
});

// 5. REGRESSION GUARD — the entire existing roster. No kyc_enforced flag, and an
// unreviewed 'submitted' KYC status. These users must keep their trial.
await asNewUser(async (uid) => {
    await seedProgress(uid, {});
    await seedInternal(uid, 'submitted');
    await expectAllowed('legacy (no flag) + kyc submitted -> trial create allowed', () => createTrial(uid));
});

// 6. Invited member / legacy exemption, no internal row at all.
await asNewUser(async (uid) => {
    await seedProgress(uid, { completed: false, exempt: true });
    await expectAllowed('exempt member (no flag, no internal row) -> trial create allowed', () => createTrial(uid));
});

console.log(`\nKYC trial gate rules: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
