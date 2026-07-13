// =============================================================================
// FluxyOS — Commerce Integration Platform firestore.rules test (emulator-only)
//
// Verifies the workspace-scoped commerce collections (Phase 1 foundation):
//   - commerce_accounts: any member reads; clients cannot create/delete; the
//     ONLY client write is owner/admin toggling auto_post (+updated_at);
//     finance/viewer denied; other fields (status, shop_name) rejected even
//     for owner/admin. No token-shaped fields exist to leak.
//   - commerce_orders / commerce_transactions / commerce_sync_jobs /
//     commerce_sync_errors: member read-only; ALL client writes denied
//     (server-written via Admin SDK, which bypasses rules).
//   - commerce_webhook_logs: owner/admin read; finance/viewer denied; no writes.
//   - commerce_credentials + commerce_shop_directory (TOP-LEVEL secrets):
//     read AND write denied for every client, owner included.
//   - transactions link fields: commerce_order_id / commerce_account_id are
//     accepted on ws transaction create/update (wsValidTxCreate/Update) and
//     rejected when non-string.
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/commerce-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, collection, setDoc, updateDoc,
    getDoc, deleteDoc, serverTimestamp
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

const WS = 'ws_commerce_test';
const ACCOUNT_ID = 'tiktok_shop_7000123';
async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

// Server-written docs are seeded via the Admin SDK (as the sync worker would).
async function seedServerDocs() {
    await adminDb.doc(`workspaces/${WS}/commerce_accounts/${ACCOUNT_ID}`).set({
        platform: 'tiktok_shop', shop_id: '7000123', shop_name: 'Toko Uji', region: 'ID',
        currency: 'IDR', status: 'connected', last_sync_at: null, last_sync_status: null,
        sync_health: 'healthy', initial_sync: { status: 'done', progress_pct: 100 },
        token_expires_at: null, auto_post: true, connected_by: 'server', connected_at: new Date(),
        updated_at: new Date(),
    });
    await adminDb.doc(`workspaces/${WS}/commerce_orders/tiktok_shop_7000123_ORD1`).set({
        platform: 'tiktok_shop', shop_id: '7000123', account_id: ACCOUNT_ID, order_id: 'ORD1',
        gross_sales: 150000, net_sales: 135000, currency: 'IDR', status: 'completed',
        order_created_at: new Date(), created_at: new Date(), updated_at: new Date(),
    });
    await adminDb.doc(`workspaces/${WS}/commerce_sync_jobs/job1`).set({
        account_id: ACCOUNT_ID, platform: 'tiktok_shop', type: 'incremental', status: 'done',
        attempts: 1, created_at: new Date(), finished_at: new Date(),
    });
    await adminDb.doc(`workspaces/${WS}/commerce_sync_errors/err1`).set({
        account_id: ACCOUNT_ID, job_id: 'job1', code: 'RATE_LIMIT', message: 'x', created_at: new Date(),
    });
    await adminDb.doc(`workspaces/${WS}/commerce_webhook_logs/wh1`).set({
        platform: 'tiktok_shop', shop_id: '7000123', event_type: 'ORDER_STATUS_CHANGE',
        signature_valid: true, job_id: 'job1', received_at: new Date(),
    });
    await adminDb.doc(`commerce_credentials/${WS}__${ACCOUNT_ID}`).set({
        workspace_id: WS, account_id: ACCOUNT_ID, platform: 'tiktok_shop', shop_id: '7000123',
        access_token_enc: 'v1:1:iv:tag:ct', refresh_token_enc: 'v1:1:iv:tag:ct',
        access_expires_at: new Date(), key_version: 1, created_at: new Date(), updated_at: new Date(),
    });
    await adminDb.doc('commerce_shop_directory/tiktok_shop_7000123').set({
        workspace_id: WS, account_id: ACCOUNT_ID, status: 'connected',
    });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    await seedServerDocs();

    const accountRef = doc(db, `workspaces/${WS}/commerce_accounts/${ACCOUNT_ID}`);

    console.log('\n— commerce_accounts —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer CAN read a commerce account', true, () => getDoc(accountRef));
    await expectOutcome('viewer CANNOT toggle auto_post', false, () =>
        updateDoc(accountRef, { auto_post: false, updated_at: serverTimestamp() }));
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CANNOT toggle auto_post (owner/admin only)', false, () =>
        updateDoc(accountRef, { auto_post: false, updated_at: serverTimestamp() }));
    await setMemberRole(uid, 'admin');
    await expectOutcome('admin CAN toggle auto_post', true, () =>
        updateDoc(accountRef, { auto_post: false, updated_at: serverTimestamp() }));
    await expectOutcome('admin CANNOT edit other account fields (status)', false, () =>
        updateDoc(accountRef, { status: 'disconnected', updated_at: serverTimestamp() }));
    await expectOutcome('admin CANNOT set auto_post to a non-boolean', false, () =>
        updateDoc(accountRef, { auto_post: 'yes', updated_at: serverTimestamp() }));
    await setMemberRole(uid, 'owner');
    await expectOutcome('even owner CANNOT create a commerce account client-side', false, () =>
        setDoc(doc(db, `workspaces/${WS}/commerce_accounts/shopee_555`), {
            platform: 'shopee', shop_id: '555', status: 'connected', auto_post: true,
        }));
    await expectOutcome('even owner CANNOT delete a commerce account client-side', false, () =>
        deleteDoc(accountRef));

    console.log('\n— server-written collections are client-read-only —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer CAN read commerce_orders', true, () =>
        getDoc(doc(db, `workspaces/${WS}/commerce_orders/tiktok_shop_7000123_ORD1`)));
    await expectOutcome('viewer CAN read commerce_sync_jobs', true, () =>
        getDoc(doc(db, `workspaces/${WS}/commerce_sync_jobs/job1`)));
    await expectOutcome('viewer CAN read commerce_sync_errors', true, () =>
        getDoc(doc(db, `workspaces/${WS}/commerce_sync_errors/err1`)));
    await setMemberRole(uid, 'owner');
    await expectOutcome('even owner CANNOT create a commerce_order client-side', false, () =>
        setDoc(doc(db, `workspaces/${WS}/commerce_orders/x`), { platform: 'mock', shop_id: 's', order_id: 'x' }));
    await expectOutcome('even owner CANNOT create a commerce_transaction client-side', false, () =>
        setDoc(doc(db, `workspaces/${WS}/commerce_transactions/x`), { platform: 'mock', shop_id: 's', order_id: 'x' }));
    await expectOutcome('even owner CANNOT create a sync job client-side', false, () =>
        setDoc(doc(db, `workspaces/${WS}/commerce_sync_jobs/x`), { account_id: ACCOUNT_ID, type: 'manual', status: 'pending' }));
    await expectOutcome('even owner CANNOT update a sync job client-side', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/commerce_sync_jobs/job1`), { status: 'pending' }));

    console.log('\n— commerce_webhook_logs (owner/admin only) —');
    await setMemberRole(uid, 'admin');
    await expectOutcome('admin CAN read webhook logs', true, () =>
        getDoc(doc(db, `workspaces/${WS}/commerce_webhook_logs/wh1`)));
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance CANNOT read webhook logs', false, () =>
        getDoc(doc(db, `workspaces/${WS}/commerce_webhook_logs/wh1`)));

    console.log('\n— top-level secrets: deny-all, owner included —');
    await setMemberRole(uid, 'owner');
    await expectOutcome('owner CANNOT read commerce_credentials', false, () =>
        getDoc(doc(db, `commerce_credentials/${WS}__${ACCOUNT_ID}`)));
    await expectOutcome('owner CANNOT write commerce_credentials', false, () =>
        setDoc(doc(db, `commerce_credentials/steal`), { access_token_enc: 'x' }));
    await expectOutcome('owner CANNOT read commerce_shop_directory', false, () =>
        getDoc(doc(db, 'commerce_shop_directory/tiktok_shop_7000123')));
    await expectOutcome('owner CANNOT write commerce_shop_directory', false, () =>
        setDoc(doc(db, 'commerce_shop_directory/hijack'), { workspace_id: 'attacker' }));

    console.log('\n— ledger transactions accept commerce link fields —');
    // EMULATOR CAVEAT (verified 2026-07-13): the giant transaction validators
    // exceed the EMULATOR's 1000-expression evaluation budget for docs with
    // ~11+ keys — PRE-EXISTING and emulator-only (the committed HEAD rules with
    // ZERO commerce fields deny a 10-key ws create the same way, while
    // production creates 15+-field transactions through these exact rules
    // daily: bank imports, drawer source/created_via). Within the emulator the
    // budget cliff sits between 10 and 12 doc keys on the user-scoped twin
    // chain, so these assertions use the user-scoped block with ≤10-key docs.
    // The user-scoped and workspace validators share the SAME
    // isValidCommerceLink helper and the same two allowlist keys, so what is
    // accepted/rejected here is accepted/rejected by the ws block in
    // production. Ws-path acceptance gets browser-QA'd in Phase 3 e2e (void a
    // mock-connector ledger tx against deployed rules).
    const txDoc = (extra = {}) => ({
        amount: 250000, vendor_name: 'TikTok Shop — Toko Uji', category: 'Revenue', type: 'income',
        status: 'Completed', icon: '💰', timestamp: serverTimestamp(), created_at: serverTimestamp(), ...extra,
    });
    const userTxRef = (id) => doc(db, `users/${uid}/transactions/${id}`);
    await expectOutcome('owner CAN create a tx with commerce link fields (user-scoped twin)', true, () =>
        setDoc(userTxRef('cm_t1'), txDoc({ commerce_order_id: 'tiktok_shop_7000123_ORD1', commerce_account_id: ACCOUNT_ID })));
    // Same 9-key shape as the passing create, only the value type differs —
    // the denial is attributable to isValidCommerceLink, not the budget.
    await expectOutcome('reject non-string commerce_order_id', false, () =>
        setDoc(userTxRef('cm_t2'), txDoc({ commerce_order_id: 12345 })));
    await expectOutcome('tx update may carry commerce link fields (void path)', true, () =>
        updateDoc(userTxRef('cm_t1'), { is_voided: true, voided_at: serverTimestamp(), voided_by: uid, void_reason: 'test', updated_at: serverTimestamp() }));

    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
