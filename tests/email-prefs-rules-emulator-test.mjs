// =============================================================================
// FluxyOS — email_preferences firestore.rules behavioral test (emulator-only)
//
// Verifies isValidEmailPreferencesSettings, including the optional Email
// Language field: 'id'/'en' (or absent) is ALLOWED, anything else is DENIED.
// Run via:
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/email-prefs-rules-emulator-test.mjs"
//
// Talks only to the local emulators and exits non-zero on any failure.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

let passed = 0;
let failed = 0;

function basePayload() {
    return {
        weekly_digest_enabled: true,
        delivery_day: 'monday',
        delivery_hour: 9,
        timezone: 'Asia/Jakarta',
        metrics: {
            financial_health: true, cash_position: true, bills: true, budgets: true,
            revenue: true, expenses: true, subscriptions: true, vendors: true,
        },
        updated_at: serverTimestamp(),
    };
}

async function expectAllow(label, fn) {
    try { await fn(); passed += 1; console.log(`✅ ALLOW ${label}`); }
    catch (e) { failed += 1; console.log(`❌ ALLOW ${label} — denied: ${e.code || e.message}`); }
}

async function expectDeny(label, fn) {
    try { await fn(); failed += 1; console.log(`❌ DENY ${label} — was allowed`); }
    catch (_e) { passed += 1; console.log(`✅ DENY ${label}`); }
}

const cred = await signInAnonymously(auth);
const uid = cred.user.uid;
const prefsDoc = doc(db, `users/${uid}/settings/email_preferences`);

await expectAllow('full payload without language (legacy shape)', () =>
    setDoc(prefsDoc, basePayload()));

await expectAllow('read own email_preferences', () => getDoc(prefsDoc));

await expectAllow("language: 'id'", () =>
    setDoc(prefsDoc, { ...basePayload(), language: 'id' }));

await expectAllow("language: 'en'", () =>
    setDoc(prefsDoc, { ...basePayload(), language: 'en' }));

await expectDeny("language: 'fr' (unsupported)", () =>
    setDoc(prefsDoc, { ...basePayload(), language: 'fr' }));

await expectDeny('language: non-string', () =>
    setDoc(prefsDoc, { ...basePayload(), language: true }));

await expectDeny('unknown extra key', () =>
    setDoc(prefsDoc, { ...basePayload(), language: 'id', evil: 'x' }));

console.log(`\nemail-prefs rules: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
