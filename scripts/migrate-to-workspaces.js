'use strict';

// =============================================================================
// FluxyOS — STAGE 2 data migration: users/{uid}/* → workspaces/{uid}/*
//
// One-shot, idempotent copier for the finance/operational collections. Seeding
// rule: workspaceId == owner uid, so this is a pure path copy with NO id
// remapping. It also bootstraps the workspace profile, owner membership, and the
// reverse-lookup pointer. It does NOT delete source data (users/{uid}/* stays as
// a fallback) and it does NOT move per-identity collections (billing/onboarding/
// settings/usage_limits/ai_chats stay user-scoped). See
// docs/WORKSPACE_TEAM_MANAGEMENT_STAGE2.md.
//
// Usage:
//   # Emulator dry-run (recommended first):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-to-workspaces.js <uid> --dry-run
//   # Single account against prod (needs GOOGLE_APPLICATION_CREDENTIALS):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-to-workspaces.js <uid>
//   # All users (after single-account verification):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/migrate-to-workspaces.js --all
//
// Exits non-zero if any per-collection source/destination count mismatches.
// =============================================================================

const admin = require('firebase-admin');

// Collections that MOVE to the workspace (must match db-service _scope routing).
//
// ⚠️ STALE AND DELIBERATELY UNCHANGED. This list is the Stage 2 snapshot — the
// collections that existed when the one-shot migration ran. It is missing every
// collection added since: the accounting kernel (journals, counters,
// ledger_balances, periods, chart_of_accounts, business_categories), vendors,
// the Tax Center, and Commerce. Those were created directly under workspaces/
// after the cutover, so they never needed migrating and this script has not been
// re-run.
//
// Do NOT treat it as the finance-collection registry. The current list lives in
// `scripts/qa-run.js` FINANCE_COLLECTIONS and `docs/PROJECT_BACKGROUND.md` §4
// rule 2. If this script is ever re-run — for a restore, or to migrate a
// workspace that predates the cutover — reconcile against that list FIRST or it
// will silently under-migrate.
//
// That three files must be kept in sync by hand is the point made in
// `docs/ERP_ARCHITECTURE_REVIEW.md` §3.5.
const FINANCE_COLLECTIONS = [
    'transactions', 'bills', 'subscriptions', 'budgets', 'budget_allocations',
    'invoices', 'audit_logs', 'bank_accounts', 'bank_balance_snapshots',
    'bank_statement_imports', 'documents', 'report_exports', 'accounting_mappings',
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const TARGET_UID = args.find((a) => !a.startsWith('--')) || null;

if (admin.apps.length === 0) {
    admin.initializeApp(
        process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {}
    );
}
const db = admin.firestore();

// Recursively copy a document (and all its subcollections) to a destination ref.
async function copyDocRecursive(srcRef, destRef) {
    const snap = await srcRef.get();
    if (snap.exists && !DRY_RUN) await destRef.set(snap.data());
    const subcols = await srcRef.listCollections();
    for (const sub of subcols) {
        const childDocs = await sub.listDocuments();
        for (const child of childDocs) {
            await copyDocRecursive(child, destRef.collection(sub.id).doc(child.id));
        }
    }
}

async function copyCollection(uid, col) {
    const srcCol = db.collection(`users/${uid}/${col}`);
    const destCol = db.collection(`workspaces/${uid}/${col}`);
    const docs = await srcCol.listDocuments();
    let n = 0;
    for (const d of docs) {
        await copyDocRecursive(d, destCol.doc(d.id));
        n++;
    }
    // Top-level destination count (subcollections verified by recursion).
    const destCount = DRY_RUN ? '(dry-run)' : (await destCol.listDocuments()).length;
    const ok = DRY_RUN || destCount >= docs.length;
    console.log(`    ${col}: src=${docs.length} dest=${destCount} ${ok ? 'OK' : 'MISMATCH'}`);
    return { col, src: docs.length, dest: DRY_RUN ? docs.length : destCount, ok };
}

async function resolveWorkspaceName(uid) {
    try {
        const c = await db.doc(`users/${uid}/settings/company`).get();
        if (c.exists && c.data().business_name) return c.data().business_name;
    } catch (_) {}
    try {
        const p = await db.doc(`users/${uid}/onboarding/profile`).get();
        if (p.exists && p.data().business_name) return p.data().business_name;
    } catch (_) {}
    return null;
}

async function bootstrapWorkspace(uid) {
    if (DRY_RUN) { console.log('    (dry-run) would bootstrap workspace + owner member + pointer'); return; }
    const name = await resolveWorkspaceName(uid);
    let email = null, displayName = null;
    try { const u = await admin.auth().getUser(uid); email = u.email || null; displayName = u.displayName || null; } catch (_) {}
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.doc(`workspaces/${uid}`).set({ owner_uid: uid, name, created_at: now, updated_at: now }, { merge: true });
    await db.doc(`workspaces/${uid}/members/${uid}`).set({
        uid, email, display_name: displayName, role: 'owner', status: 'active',
        invited_by: null, joined_at: now, updated_at: now,
    }, { merge: true });
    await db.doc(`user_workspaces/${uid}`).set({
        workspaceIds: admin.firestore.FieldValue.arrayUnion(uid), default: uid, updated_at: now,
    }, { merge: true });
}

async function migrateUser(uid) {
    console.log(`\n  Migrating ${uid}${DRY_RUN ? ' (dry-run)' : ''}`);
    await bootstrapWorkspace(uid);
    const results = [];
    for (const col of FINANCE_COLLECTIONS) results.push(await copyCollection(uid, col));
    return results;
}

async function listAllUserUids() {
    const uids = [];
    let pageToken;
    do {
        const res = await admin.auth().listUsers(1000, pageToken);
        res.users.forEach((u) => uids.push(u.uid));
        pageToken = res.pageToken;
    } while (pageToken);
    return uids;
}

(async () => {
    if (!ALL && !TARGET_UID) {
        console.error('Usage: node scripts/migrate-to-workspaces.js <uid> [--dry-run] | --all [--dry-run]');
        process.exit(2);
    }
    const uids = ALL ? await listAllUserUids() : [TARGET_UID];
    console.log(`Migrating ${uids.length} user(s). DRY_RUN=${DRY_RUN}`);
    let anyMismatch = false;
    for (const uid of uids) {
        const results = await migrateUser(uid);
        if (results.some((r) => !r.ok)) anyMismatch = true;
    }
    console.log(`\nDone. ${anyMismatch ? 'SOME MISMATCHES — investigate before flipping the flag.' : 'All counts OK.'}`);
    process.exit(anyMismatch ? 1 : 0);
})().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
