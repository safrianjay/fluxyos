// =============================================================================
// FluxyOS — AI usage quota firestore.rules regression test (emulator-only)
//
// Verifies the `usage_limits` rules for the shared Fluxy AI quota:
//   - trial doc `ai_chat_trial` (lifetime cap 1)
//   - billing-period doc `ai_chat_plan` (limit re-derived from the plan,
//     period_start pinned to the subscription's current_period_start).
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/ai-usage-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, Timestamp } from 'firebase/firestore';

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

const PERIOD_A_MS = Date.UTC(2026, 5, 1); // 2026-06-01
const PERIOD_B_MS = Date.UTC(2026, 6, 1); // 2026-07-01
const PERIOD_A = Timestamp.fromMillis(PERIOD_A_MS); // client SDK Timestamp
const PERIOD_B = Timestamp.fromMillis(PERIOD_B_MS);
const usageRef = (uid, id) => doc(db, `users/${uid}/usage_limits/${id}`);
const trialDoc = (count, limit) => ({ metric: 'ai_chat_requests', scope: 'trial', count, limit });
const planDoc = (count, limit, periodStart) => ({ metric: 'ai_chat_requests', scope: 'plan', period_start: periodStart, count, limit });

// Seed via the admin SDK (bypasses rules). current_period_start must be an ADMIN
// Timestamp; it resolves to the same instant the client writes, so the rules'
// `period_start == current_period_start` equality holds.
async function seedSubscription(uid, planId, status, periodMs) {
    await adminDb.doc(`users/${uid}/billing_subscription/current`).set({
        plan_id: planId,
        status,
        current_period_start: admin.firestore.Timestamp.fromMillis(periodMs),
    }, { merge: false });
}

(async () => {
    const cred = await signInAnonymously(auth);
    const uid = cred.user.uid;

    console.log('=== trial doc (ai_chat_trial), limit 1 ===');
    await expectDenied('create with wrong limit (3)', () => setDoc(usageRef(uid, 'ai_chat_trial'), trialDoc(1, 3)));
    await expectDenied('create with count 2', () => setDoc(usageRef(uid, 'ai_chat_trial'), trialDoc(2, 1)));
    await expectAllowed('create count 1 / limit 1', () => setDoc(usageRef(uid, 'ai_chat_trial'), trialDoc(1, 1)));
    await expectDenied('update to count 2 (over cap)', () => setDoc(usageRef(uid, 'ai_chat_trial'), trialDoc(2, 1)));

    console.log('\n=== plan doc (ai_chat_plan), starter limit 10, period A ===');
    await seedSubscription(uid, 'starter', 'active', PERIOD_A_MS);
    await expectDenied('create with inflated limit (999)', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 999, PERIOD_A)));
    await expectDenied('create count 2 (create must be 1)', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(2, 10, PERIOD_A)));
    await expectDenied('create with forged period_start (B != sub A)', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 10, PERIOD_B)));
    await expectAllowed('create count 1 / limit 10 / period A', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 10, PERIOD_A)));
    await expectAllowed('update +1 (count 2) same period', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(2, 10, PERIOD_A)));
    await expectDenied('update skip to count 4', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(4, 10, PERIOD_A)));
    await expectDenied('update beyond limit (count 11)', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(11, 10, PERIOD_A)));

    console.log('\n=== billing-period reset: subscription advances to period B ===');
    await seedSubscription(uid, 'starter', 'active', PERIOD_B_MS);
    await expectDenied('cannot reset to count 1 with stale period A', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 10, PERIOD_A)));
    await expectAllowed('reset to count 1 with new period B', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 10, PERIOD_B)));
    await expectDenied('cannot re-reset to count 1 same period B', () => setDoc(usageRef(uid, 'ai_chat_plan'), planDoc(1, 10, PERIOD_B)));

    console.log('\n=== delete is blocked ===');
    await expectDenied('client delete denied', () => import('firebase/firestore').then(m => m.deleteDoc(usageRef(uid, 'ai_chat_plan'))));

    console.log(`\n================ RESULT: ${passed} passed, ${failed} failed ================`);
    process.exit(failed ? 1 : 0);
})().catch(err => { console.error('test crashed:', err); process.exit(1); });
