// =============================================================================
// FluxyOS — Workspace data-sharing end-to-end test (emulator-only)
//
// Reproduces the reported bug ("invited member sees 0 data") and proves the fix
// at the data/rules layer — the layer the self-heal in
// assets/js/workspace-service.js drives the client onto:
//
//   1. Owner seeds workspaces/{owner} with transactions/bills/subscriptions.
//   2. STRANDED: before joining, the invitee CANNOT read the owner's finance
//      data (this is the "0 data" state — resolution would fall back to the
//      invitee's own empty workspaces/{inviteeUid}).
//   3. HEAL: the invitee accepts the pending invite (the exact acceptInvite
//      batch: member create + invite flip), exactly as healFromStoredInvite does.
//   4. SHARED: the invitee now reads the SAME transactions/bills/subscriptions
//      as the owner, and collectionGroup(members) resolves them onto the owner
//      workspace (not their own).
//
// Scenario B covers the OWNER counterpart — the trial-owner "Missing or
// insufficient permissions" bug: with workspace mode on, an owner who has no
// members/{uid} doc is DENIED reading/writing their own workspaces/{uid}
// finance data, and the resolveWorkspace() owner self-heal (ensureWorkspace)
// creates the doc so the very next read passes.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/team-data-sharing-emulator-test.mjs"
//
// Talks only to the local emulators; exits non-zero on any failed expectation.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc,
    serverTimestamp, writeBatch, collectionGroup, query, where, getDocs, Timestamp
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';

function makeUserCtx(name) {
    const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' }, name);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return { app, db, auth };
}
async function signUp(ctx, email) {
    const cred = await createUserWithEmailAndPassword(ctx.auth, email, 'passw0rd!');
    ctx.uid = cred.user.uid;
    ctx.email = email;
    return ctx.uid;
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
function expectEqual(label, actual, expected) {
    if (actual === expected) { passed++; console.log(`  PASS            ${label}`); }
    else { failed++; console.error(`  FAIL  ${label} → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

const baseRecord = (extra = {}) => ({
    amount: 1500000, vendor_name: 'Acme Co', category: 'Revenue', type: 'income',
    status: 'Completed', icon: '💰', timestamp: serverTimestamp(), ...extra,
});
const memberDoc = (uid, email, role) => ({
    uid, email, display_name: null, role, status: 'active',
    invited_by: null, joined_at: serverTimestamp(), updated_at: serverTimestamp(),
});
const inviteDoc = (email, role, inviterUid) => ({
    email, role, status: 'pending', invited_by: inviterUid, invited_by_email: 'owner2@test.com',
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
    expires_at: null, accepted_by: null, accepted_at: null,
});

(async () => {
    const owner = makeUserCtx('owner2');
    const invitee = makeUserCtx('invitee2');
    await signUp(owner, 'owner2@test.com');
    await signUp(invitee, 'invitee2@test.com');

    const wsId = owner.uid;                 // seeding rule: workspaceId == owner uid
    const inviteKey = invitee.email.toLowerCase();

    // 1. Owner bootstraps workspace + owner membership, then seeds finance data.
    await expectOutcome('owner creates workspace', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}`), { owner_uid: owner.uid, name: 'Acme', created_at: serverTimestamp(), updated_at: serverTimestamp() }));
    await expectOutcome('owner creates owner-member', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}/members/${owner.uid}`), memberDoc(owner.uid, owner.email, 'owner')));
    await expectOutcome('owner writes a transaction', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}/transactions/tx1`), baseRecord()));
    await expectOutcome('owner writes a bill', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}/bills/bill1`), baseRecord({ category: 'Operations', type: 'expense', icon: '💸', due_date: Timestamp.now(), payment_status: 'unpaid' })));
    await expectOutcome('owner writes a subscription', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}/subscriptions/sub1`), baseRecord({ category: 'SaaS', type: 'expense', icon: '💸', renewal_date: Timestamp.now() })));
    await expectOutcome('owner creates pending invite (finance)', true, () =>
        setDoc(doc(owner.db, `workspaces/${wsId}/invites/${inviteKey}`), inviteDoc(inviteKey, 'finance', owner.uid)));

    // 2. STRANDED — invitee has not joined: every shared read is DENIED. This is
    //    exactly the "0 data" state the bug produced.
    await expectOutcome('STRANDED: invitee cannot read owner transaction', false, () =>
        getDoc(doc(invitee.db, `workspaces/${wsId}/transactions/tx1`)));
    await expectOutcome('STRANDED: invitee cannot read owner bill', false, () =>
        getDoc(doc(invitee.db, `workspaces/${wsId}/bills/bill1`)));

    // 3. HEAL — invitee accepts the invite (the same batch healFromStoredInvite /
    //    acceptInvite performs: member create gated by the pending invite + flip).
    await expectOutcome('HEAL: invitee self-joins from pending invite', true, async () => {
        const batch = writeBatch(invitee.db);
        batch.set(doc(invitee.db, `workspaces/${wsId}/members/${invitee.uid}`), memberDoc(invitee.uid, inviteKey, 'finance'));
        batch.update(doc(invitee.db, `workspaces/${wsId}/invites/${inviteKey}`), {
            status: 'accepted', accepted_by: invitee.uid, accepted_at: serverTimestamp(), updated_at: serverTimestamp(),
        });
        await batch.commit();
    });

    // 4. SHARED — the invitee now reads the SAME data as the owner.
    let txSnap, billSnap, subSnap;
    await expectOutcome('SHARED: invitee reads owner transaction', true, async () => { txSnap = await getDoc(doc(invitee.db, `workspaces/${wsId}/transactions/tx1`)); });
    await expectOutcome('SHARED: invitee reads owner bill', true, async () => { billSnap = await getDoc(doc(invitee.db, `workspaces/${wsId}/bills/bill1`)); });
    await expectOutcome('SHARED: invitee reads owner subscription', true, async () => { subSnap = await getDoc(doc(invitee.db, `workspaces/${wsId}/subscriptions/sub1`)); });
    expectEqual('SHARED: transaction amount matches owner', txSnap?.data()?.amount, 1500000);
    expectEqual('SHARED: bill is the owner-written doc', billSnap?.data()?.category, 'Operations');
    expectEqual('SHARED: subscription is the owner-written doc', subSnap?.data()?.category, 'SaaS');

    // 5. RESOLUTION — collectionGroup(members) finds the invitee's membership in the
    //    OWNER workspace (not their own), which is what workspace-service selects.
    await expectOutcome('RESOLUTION: invitee resolves via collectionGroup(members)', true, async () => {
        const snap = await getDocs(query(collectionGroup(invitee.db, 'members'), where('uid', '==', invitee.uid)));
        const wsIds = [];
        snap.forEach((d) => { const p = d.ref.parent?.parent; if (p) wsIds.push(p.id); });
        const nonSelf = wsIds.filter((id) => id !== invitee.uid);
        if (nonSelf.length !== 1 || nonSelf[0] !== wsId) {
            throw new Error(`expected resolution to owner ws ${wsId}, got ${JSON.stringify(wsIds)}`);
        }
    });
    // Direct member-doc read (the index-independent path healFromStoredInvite uses).
    await expectOutcome('RESOLUTION: invitee can read own member doc in owner ws', true, () =>
        getDoc(doc(invitee.db, `workspaces/${wsId}/members/${invitee.uid}`)));

    // =========================================================================
    // Scenario B — OWNER self-heal (the trial-owner "Missing or insufficient
    // permissions" bug). With FLUXY_WORKSPACE_MODE on, an owner reads
    // workspaces/{uid}/<finance>; that rule requires an ACTIVE members/{uid}
    // doc. ensureWorkspace — now driven centrally by resolveWorkspace's owner
    // self-heal (previously only settings-team) — creates it. Prove the owner is
    // DENIED before the member doc exists and ALLOWED after.
    // =========================================================================
    const owner3 = makeUserCtx('owner3');
    await signUp(owner3, 'owner3@test.com');
    const ws3 = owner3.uid;

    // Owner may create their own workspace doc (bootstrap create exception)...
    await expectOutcome('OWNER-HEAL: owner creates own workspace doc', true, () =>
        setDoc(doc(owner3.db, `workspaces/${ws3}`), { owner_uid: owner3.uid, name: null, created_at: serverTimestamp(), updated_at: serverTimestamp() }));
    // ...but WITHOUT a member doc, finance reads/writes are DENIED (the bug).
    await expectOutcome('OWNER-HEAL(bug): owner cannot read own finance before member doc', false, () =>
        getDoc(doc(owner3.db, `workspaces/${ws3}/transactions/tx1`)));
    await expectOutcome('OWNER-HEAL(bug): owner cannot write finance before member doc', false, () =>
        setDoc(doc(owner3.db, `workspaces/${ws3}/transactions/tx1`), baseRecord()));
    // The fix: bootstrap the owner membership (the exact ensureWorkspace payload).
    await expectOutcome('OWNER-HEAL(fix): owner bootstraps own membership', true, () =>
        setDoc(doc(owner3.db, `workspaces/${ws3}/members/${owner3.uid}`), memberDoc(owner3.uid, owner3.email, 'owner')));
    // Now the very same finance read/write succeeds.
    await expectOutcome('OWNER-HEAL: owner writes finance after bootstrap', true, () =>
        setDoc(doc(owner3.db, `workspaces/${ws3}/transactions/tx1`), baseRecord()));
    let o3Snap;
    await expectOutcome('OWNER-HEAL: owner reads own finance after bootstrap', true, async () => { o3Snap = await getDoc(doc(owner3.db, `workspaces/${ws3}/transactions/tx1`)); });
    expectEqual('OWNER-HEAL: read-back amount matches', o3Snap?.data()?.amount, 1500000);
    await expectOutcome('OWNER-HEAL: resolves via collectionGroup(members)', true, async () => {
        const snap = await getDocs(query(collectionGroup(owner3.db, 'members'), where('uid', '==', owner3.uid)));
        const wsIds = [];
        snap.forEach((d) => { const p = d.ref.parent?.parent; if (p) wsIds.push(p.id); });
        if (!wsIds.includes(ws3)) throw new Error(`expected owner ws ${ws3} in ${JSON.stringify(wsIds)}`);
    });

    console.log(`\nWorkspace data-sharing: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Harness error:', e); process.exit(1); });
