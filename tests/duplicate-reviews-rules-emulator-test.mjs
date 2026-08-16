// =============================================================================
// FluxyOS — duplicate_reviews rules test (emulator-only)
//
// Proves the security contract for the duplicate-decision log
// (docs/DUPLICATE_PREVENTION.md), in BOTH scopes:
//
//   1. A well-formed decision is accepted, user-scoped and workspace-scoped.
//   2. The audit log that rides with it (target_collection 'duplicate_reviews')
//      is accepted — the enum was extended in both audit validators.
//   3. Junk is rejected: unknown decision/source/kind enums, an out-of-range
//      score, an over-length reason, a spoofed decided_by, an unknown key.
//   4. The pair a decision describes is IMMUTABLE — only decision/reason/notes
//      can change. Re-pointing primary_id at another record is denied.
//   5. DELETE IS ALWAYS DENIED. "We reviewed this and kept both" is audit
//      evidence; it has to outlive the records it describes.
//   6. A viewer can READ decisions but not write them; a non-member sees none.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/duplicate-reviews-rules-emulator-test.mjs"
//
// Talks only to the local emulators; exits non-zero on any failed expectation.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc,
    deleteDoc, serverTimestamp, writeBatch
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

const review = (uid, extra = {}) => ({
    kind: 'transactions',
    primary_id: 'tx-original',
    duplicate_id: 'tx-copy',
    score: 90,
    rules: ['D2'],
    decision: 'kept_both',
    reason: 'Two genuine deliveries from the same supplier on the same day.',
    source: 'manual',
    notes: '',
    decided_by: uid,
    decided_at: serverTimestamp(),
    created_at: serverTimestamp(),
    ...extra
});

// Small wrapper for the documents cases, which write to a different collection.
async function expect_(ctx, label, shouldAllow, docId, payload) {
    await expectOutcome(label, shouldAllow,
        () => setDoc(doc(ctx.db, `workspaces/${ctx.uid}/documents/${docId}`), payload));
}

const memberDoc = (uid, email, role) => ({
    uid, email, display_name: null, role, status: 'active',
    invited_by: null, joined_at: serverTimestamp(), updated_at: serverTimestamp()
});

(async () => {
    const owner = makeUserCtx('dup-owner');
    const viewer = makeUserCtx('dup-viewer');
    const stranger = makeUserCtx('dup-stranger');
    await signUp(owner, 'dup-owner@test.com');
    await signUp(viewer, 'dup-viewer@test.com');
    await signUp(stranger, 'dup-stranger@test.com');

    const wsId = owner.uid;
    // Seed workspace membership up front: sections 1-5 now write to
    // workspaces/, and every one of those rules goes through hasRole().
    await setDoc(doc(owner.db, `workspaces/${wsId}`), {
        name: 'Dup Co', owner_uid: owner.uid, created_at: serverTimestamp(), updated_at: serverTimestamp()
    }).catch(() => {});
    await setDoc(doc(owner.db, `workspaces/${wsId}/members/${owner.uid}`),
        memberDoc(owner.uid, owner.email, 'owner')).catch(() => {});
    // Was `users/${owner.uid}/duplicate_reviews/...`. The user-scoped finance
    // rules were removed 2026-08-16 when the ruleset hit its release ceiling;
    // the app has written these to workspaces/ since Stage 2. Repointed rather
    // than deleted so the shape/validation coverage below survives.
    const uPath = (id) => `workspaces/${wsId}/duplicate_reviews/${id}`;
    const wPath = (id) => `workspaces/${wsId}/duplicate_reviews/${id}`;

    console.log('\n1. USER-SCOPED create');
    await expectOutcome('owner writes a well-formed decision', true,
        () => setDoc(doc(owner.db, uPath('u1')), review(owner.uid)));
    await expectOutcome('a minimal decision (no optional keys) is accepted', true,
        () => setDoc(doc(owner.db, uPath('u2')), {
            kind: 'bills', primary_id: 'bill-1', decision: 'ignored', source: 'scan',
            decided_by: owner.uid, decided_at: serverTimestamp(), created_at: serverTimestamp()
        }));

    console.log('\n2. The audit log that rides with a decision');
    await expectOutcome("audit log with target_collection 'duplicate_reviews'", true, () => {
        const batch = writeBatch(owner.db);
        batch.set(doc(owner.db, uPath('u3')), review(owner.uid));
        batch.set(doc(owner.db, `workspaces/${wsId}/audit_logs/a1`), {
            actor_uid: owner.uid, actor_role: null, action: 'duplicate.kept_both',
            target_collection: 'duplicate_reviews', target_id: 'u3',
            before: null, after: { score: 90 }, reason: 'both genuine',
            source: 'dashboard', created_at: serverTimestamp()
        });
        return batch.commit();
    });

    console.log('\n3. Malformed decisions are rejected');
    const bad = {
        'unknown decision enum': { decision: 'obliterated' },
        'unknown source enum': { source: 'telepathy' },
        'unknown kind enum': { kind: 'receipts' },
        'score above 100': { score: 420 },
        'negative score': { score: -1 },
        'over-length reason': { reason: 'x'.repeat(501) },
        'spoofed decided_by': { decided_by: 'someone-else' },
        'unknown key': { vendor_name: 'PT Leaky' },
        'more than 8 rules': { rules: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'] }
    };
    for (const [label, patch] of Object.entries(bad)) {
        await expectOutcome(label, false,
            () => setDoc(doc(owner.db, uPath(`bad-${label.replace(/\W/g, '')}`)), review(owner.uid, patch)));
    }
    await expectOutcome('missing required primary_id', false,
        () => setDoc(doc(owner.db, uPath('bad-missing')), {
            kind: 'transactions', decision: 'ignored', source: 'manual',
            decided_by: owner.uid, decided_at: serverTimestamp(), created_at: serverTimestamp()
        }));

    console.log('\n4. The pair is immutable; the outcome is not');
    await expectOutcome('resolving a decision + adding a note', true,
        () => updateDoc(doc(owner.db, uPath('u1')), {
            decision: 'voided', notes: 'Voided the later copy.',
            decided_by: owner.uid, decided_at: serverTimestamp()
        }));
    await expectOutcome('re-pointing primary_id at another record', false,
        () => updateDoc(doc(owner.db, uPath('u1')), {
            primary_id: 'tx-something-else', decided_by: owner.uid, decided_at: serverTimestamp()
        }));
    await expectOutcome('rewriting the score', false,
        () => updateDoc(doc(owner.db, uPath('u1')), {
            score: 5, decided_by: owner.uid, decided_at: serverTimestamp()
        }));

    console.log('\n5. Delete is always denied');
    await expectOutcome('owner deletes their own decision', false,
        () => deleteDoc(doc(owner.db, uPath('u1'))));

    console.log('\n5b. documents.file_hash (the D0 file-identity signal)');
    const docBase = (extra = {}) => ({
        file_name: 'receipt.png', file_mime_type: 'image/png', file_size: 1024,
        storage_path: `users/${owner.uid}/documents/d1.png`,
        document_role: 'receipt', source_context: 'transaction',
        upload_status: 'uploaded', extraction_status: 'not_requested',
        review_status: 'not_required',
        created_at: serverTimestamp(), updated_at: serverTimestamp(), ...extra
    });
    await expect_(owner, 'a document WITH a sha-256 hash', true, 'd-hash',
        docBase({ file_hash: 'a'.repeat(64) }));
    await expect_(owner, 'a legacy document with no hash', true, 'd-nohash', docBase());
    await expect_(owner, 'an over-length hash', false, 'd-longhash',
        docBase({ file_hash: 'a'.repeat(65) }));

    console.log('\n6. WORKSPACE-SCOPED — roles');
    await setDoc(doc(owner.db, `workspaces/${wsId}`), {
        name: 'Dup Co', owner_uid: owner.uid, created_at: serverTimestamp(), updated_at: serverTimestamp()
    }).catch(() => {});
    await setDoc(doc(owner.db, `workspaces/${wsId}/members/${owner.uid}`),
        memberDoc(owner.uid, owner.email, 'owner')).catch(() => {});
    await setDoc(doc(owner.db, `workspaces/${wsId}/members/${viewer.uid}`),
        memberDoc(viewer.uid, viewer.email, 'viewer')).catch(() => {});

    await expectOutcome('owner writes a workspace decision', true,
        () => setDoc(doc(owner.db, wPath('w1')), review(owner.uid)));
    await expectOutcome('viewer READS decisions', true,
        () => getDoc(doc(viewer.db, wPath('w1'))).then((s) => {
            if (!s.exists()) throw new Error('viewer could not read the decision');
        }));
    await expectOutcome('viewer WRITES a decision', false,
        () => setDoc(doc(viewer.db, wPath('w2')), review(viewer.uid)));
    await expectOutcome('non-member reads a decision', false,
        () => getDoc(doc(stranger.db, wPath('w1'))).then((s) => {
            if (!s.exists()) throw new Error('permission-denied');
        }));
    await expectOutcome('workspace decision delete', false,
        () => deleteDoc(doc(owner.db, wPath('w1'))));

    console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
    console.error('Harness error:', err);
    process.exit(1);
});
