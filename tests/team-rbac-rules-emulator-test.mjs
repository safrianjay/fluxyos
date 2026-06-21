// =============================================================================
// FluxyOS — Workspace Team Management & RBAC firestore.rules test (emulator-only)
//
// Verifies the STAGE 1 workspace rules:
//   - owner can bootstrap their own workspace (id == uid) + owner member doc,
//   - non-members cannot read members,
//   - only owner/admin can create invites,
//   - an invitee whose token email matches a pending invite can self-join,
//   - a non-invited / wrong-email user cannot self-join,
//   - a finance member cannot manage the team,
//   - active members can append audit logs; outsiders cannot.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/team-rbac-rules-emulator-test.mjs"
//
// Talks only to the local emulators; exits non-zero on any failed expectation.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc,
    setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch,
    collectionGroup, query, where, getDocs
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';

// One isolated Firebase app per user so each carries its own auth token.
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

const memberDoc = (uid, email, role) => ({
    uid, email, display_name: null, role, status: 'active',
    invited_by: null, joined_at: serverTimestamp(), updated_at: serverTimestamp(),
});
const inviteDoc = (email, role, inviterUid) => ({
    email, role, status: 'pending', invited_by: inviterUid, invited_by_email: 'owner@test.com',
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
    expires_at: null, accepted_by: null, accepted_at: null,
});

(async () => {
    const owner = makeUserCtx('owner');
    const invitee = makeUserCtx('invitee');
    const outsider = makeUserCtx('outsider');
    await signUp(owner, 'owner@test.com');
    await signUp(invitee, 'invitee@test.com');
    await signUp(outsider, 'outsider@test.com');

    const wsId = owner.uid; // seeding rule: workspaceId == owner uid
    const wsRef = (ctx) => doc(ctx.db, `workspaces/${wsId}`);
    const memberRef = (ctx, mid) => doc(ctx.db, `workspaces/${wsId}/members/${mid}`);
    const inviteRef = (ctx, email) => doc(ctx.db, `workspaces/${wsId}/invites/${email}`);

    // 1. Owner bootstraps their own workspace + owner membership.
    await expectOutcome('owner creates own workspace profile', true, () =>
        setDoc(wsRef(owner), { owner_uid: owner.uid, name: 'Acme', created_at: serverTimestamp(), updated_at: serverTimestamp() }));
    await expectOutcome('owner creates own owner-member doc', true, () =>
        setDoc(memberRef(owner, owner.uid), memberDoc(owner.uid, 'owner@test.com', 'owner')));

    // 2. A different user cannot create a foreign workspace id.
    await expectOutcome('outsider cannot create workspace under someone else id', false, () =>
        setDoc(doc(outsider.db, `workspaces/${owner.uid}/members/${outsider.uid}`), memberDoc(outsider.uid, 'outsider@test.com', 'admin')));

    // 3. Non-member cannot read members.
    await expectOutcome('outsider cannot read members', false, () => getDoc(memberRef(outsider, owner.uid)));

    // 4. Owner can create an invite.
    await expectOutcome('owner creates invite (finance)', true, () =>
        setDoc(inviteRef(owner, 'invitee@test.com'), inviteDoc('invitee@test.com', 'finance', owner.uid)));

    // 5. Owner cannot mint an invite with role=owner.
    await expectOutcome('owner cannot invite as owner role', false, () =>
        setDoc(inviteRef(owner, 'x@test.com'), inviteDoc('x@test.com', 'owner', owner.uid)));

    // 6. Outsider cannot create an invite (no team.manage).
    await expectOutcome('outsider cannot create invite', false, () =>
        setDoc(inviteRef(outsider, 'z@test.com'), inviteDoc('z@test.com', 'viewer', outsider.uid)));

    // 7. Wrong-email user cannot self-join from someone else's invite.
    await expectOutcome('outsider cannot self-join invitee invite', false, () =>
        setDoc(memberRef(outsider, outsider.uid), memberDoc(outsider.uid, 'outsider@test.com', 'finance')));

    // 8. Invitee (email matches pending invite) self-joins: member create + invite accept in one batch.
    await expectOutcome('invitee accepts invite (self-join batch)', true, async () => {
        const batch = writeBatch(invitee.db);
        batch.set(memberRef(invitee, invitee.uid), memberDoc(invitee.uid, 'invitee@test.com', 'finance'));
        batch.update(inviteRef(invitee, 'invitee@test.com'), { status: 'accepted', accepted_by: invitee.uid, accepted_at: serverTimestamp(), updated_at: serverTimestamp() });
        await batch.commit();
    });

    // 9. Invitee role must match the invite role (cannot self-elevate).
    await expectOutcome('invitee cannot self-join as admin', false, () =>
        setDoc(memberRef(outsider, outsider.uid), memberDoc(outsider.uid, 'outsider@test.com', 'admin')));

    // 10. Finance member cannot manage the team (create invite / add member).
    await expectOutcome('finance member cannot create invite', false, () =>
        setDoc(inviteRef(invitee, 'new@test.com'), inviteDoc('new@test.com', 'viewer', invitee.uid)));

    // 11. Active member can append an audit log; outsider cannot.
    const auditPayload = { actor_uid: '__SELF__', action: 'member.invite', target_collection: 'invites', target_id: 'invitee@test.com', before: null, after: null, reason: null, source: 'dashboard', created_at: serverTimestamp() };
    await expectOutcome('member appends audit log', true, () =>
        setDoc(doc(invitee.db, `workspaces/${wsId}/audit_logs/a1`), { ...auditPayload, actor_uid: invitee.uid }));
    await expectOutcome('outsider cannot append audit log', false, () =>
        setDoc(doc(outsider.db, `workspaces/${wsId}/audit_logs/a2`), { ...auditPayload, actor_uid: outsider.uid }));

    // 12. Owner can read audit logs; finance member cannot (audit.read = owner/admin).
    await expectOutcome('owner reads audit logs', true, () => getDoc(doc(owner.db, `workspaces/${wsId}/audit_logs/a1`)));
    await expectOutcome('finance member cannot read audit logs', false, () => getDoc(doc(invitee.db, `workspaces/${wsId}/audit_logs/a1`)));

    // ---- STAGE 2: finance-record RBAC ----
    const stranger = makeUserCtx('stranger');
    await signUp(stranger, 'stranger@test.com');
    // Owner adds outsider as a viewer (direct add by owner/admin).
    await expectOutcome('owner adds outsider as viewer', true, () =>
        setDoc(memberRef(owner, outsider.uid), memberDoc(outsider.uid, 'outsider@test.com', 'viewer')));

    const txDoc = () => ({
        amount: 250000, vendor_name: 'AWS', category: 'Infrastructure', type: 'expense',
        status: 'Completed', icon: '💸', timestamp: serverTimestamp(), created_at: serverTimestamp(),
    });
    const txRef = (ctx, id) => doc(ctx.db, `workspaces/${wsId}/transactions/${id}`);

    await expectOutcome('finance member creates transaction', true, () => setDoc(txRef(invitee, 't1'), txDoc()));
    await expectOutcome('viewer member cannot create transaction', false, () => setDoc(txRef(outsider, 't2'), txDoc()));
    await expectOutcome('non-member cannot create transaction', false, () => setDoc(txRef(stranger, 't3'), txDoc()));
    await expectOutcome('viewer member can read transaction', true, () => getDoc(txRef(outsider, 't1')));
    await expectOutcome('non-member cannot read transaction', false, () => getDoc(txRef(stranger, 't1')));

    // ---- Workspace resolution via collection-group (members read own docs) ----
    await expectOutcome('member resolves workspace via collectionGroup(members)', true, async () => {
        const snap = await getDocs(query(collectionGroup(invitee.db, 'members'), where('uid', '==', invitee.uid)));
        if (snap.empty) throw new Error('no membership found for self');
    });
    await expectOutcome('cannot collectionGroup-query another user\'s memberships', false, () =>
        getDocs(query(collectionGroup(outsider.db, 'members'), where('uid', '==', owner.uid))));

    // ---- Member-management boundaries: OWNER only; no self-edit/self-remove ----
    const adminUser = makeUserCtx('adminuser');
    await signUp(adminUser, 'admin@test.com');
    await expectOutcome('owner adds an admin', true, () =>
        setDoc(memberRef(owner, adminUser.uid), memberDoc(adminUser.uid, 'admin@test.com', 'admin')));

    // Admin may invite + revoke, but may NOT change roles or remove members.
    await expectOutcome('admin can create invite', true, () =>
        setDoc(inviteRef(adminUser, 'newhire@test.com'), inviteDoc('newhire@test.com', 'finance', adminUser.uid)));
    await expectOutcome('admin CANNOT change a member role', false, () =>
        updateDoc(memberRef(adminUser, invitee.uid), { role: 'viewer', updated_at: serverTimestamp() }));
    await expectOutcome('admin CANNOT remove a member', false, () =>
        deleteDoc(memberRef(adminUser, outsider.uid)));

    // Owner may change a non-self, non-owner member's role.
    await expectOutcome('owner changes finance member role to viewer', true, () =>
        updateDoc(memberRef(owner, invitee.uid), { role: 'viewer', updated_at: serverTimestamp() }));
    // No self-modification, even for the owner.
    await expectOutcome('owner CANNOT change own role', false, () =>
        updateDoc(memberRef(owner, owner.uid), { role: 'admin', updated_at: serverTimestamp() }));
    // No self-removal for any member.
    await expectOutcome('member CANNOT remove themselves', false, () =>
        deleteDoc(memberRef(outsider, outsider.uid)));
    await expectOutcome('admin CANNOT remove themselves', false, () =>
        deleteDoc(memberRef(adminUser, adminUser.uid)));
    // Owner can remove a non-owner member.
    await expectOutcome('owner removes a member', true, () =>
        deleteDoc(memberRef(owner, outsider.uid)));

    // ---- Denormalized workspace plan: owner writes, admins cannot, members read ----
    await expectOutcome('owner sets workspace plan summary', true, () =>
        updateDoc(wsRef(owner), { plan_id: 'growth', plan_name: 'Growth Engine', subscription_status: 'active', billing_frequency: 'monthly', plan_synced_at: serverTimestamp() }));
    await expectOutcome('admin CANNOT change workspace plan', false, () =>
        updateDoc(wsRef(adminUser), { plan_name: 'Free', subscription_status: 'trialing' }));
    await expectOutcome('admin can rename workspace', true, () =>
        updateDoc(wsRef(adminUser), { name: 'Acme Renamed', updated_at: serverTimestamp() }));
    await expectOutcome('member reads workspace plan', true, () => getDoc(wsRef(adminUser)));

    console.log(`\nTeam RBAC rules: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('Test harness error:', e); process.exit(1); });
