'use strict';

// =============================================================================
// FluxyOS — internal-console roster backfill (one-shot, run by hand).
//
// The internal ops console (/internal) Users list reads the uid-keyed
// `internal_users` index. That index is normally self-populated: each user's
// own client mirrors its row (db-service.syncSelfToInternalIndex), and — as of
// the roster-mirror change — a workspace OWNER's session also mirrors every
// member of its workspace on login (db-service.mirrorWorkspaceMembersToInternalIndex,
// throttled ≤1/5min). See docs/PROJECT_BACKGROUND.md §4j.
//
// That covers everyone going forward, but only once the relevant owner next
// signs in. This script does the immediate, whole-fleet backfill with the
// Admin SDK: it walks EVERY workspace, reads its members subcollection, and
// upserts each member's internal_users/{memberUid} row with the right
// workspace_role + organization — so invited teammates surface in the console
// now, without waiting for their owner to log in.
//
// It mirrors the client's SAFETY exactly:
//   - CREATE a minimal row (identity + workspace_role + organization + safe
//     default statuses) when the member has no internal_users row yet.
//   - On an EXISTING row, PATCH ONLY the roster-owned fields
//     (workspace_role, organization, and email/display_name when missing),
//     and only when they actually changed. It NEVER touches the member's
//     KYC / payment / account status, onboarding_completed, or profile fields —
//     those stay owned by the member's own self-sync and by reviewer decisions.
//
// Pending invites (no Firebase Auth uid yet) are NOT backfilled — internal_users
// is uid-keyed, so there is nothing to key on until the invitee signs up.
//
// Usage:
//   # Dry-run against prod (prints planned writes, writes nothing):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-internal-roster.js --dry-run
//
//   # Apply the backfill:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-internal-roster.js
//
// Flags:
//   --dry-run           plan only, no writes
//   --workspace <id>    limit to a single workspace id (default: all)
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const ONLY_WORKSPACE = flag('workspace', null);

if (admin.apps.length === 0) {
    admin.initializeApp(
        process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {}
    );
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const VALID_ROLES = ['owner', 'admin', 'finance', 'accountant', 'viewer'];

const nullableString = (value, maxLength) => {
    const clean = String(value ?? '').trim().slice(0, maxLength);
    return clean || null;
};

// Resolve the shared org/workspace name the console shows in the Organization
// column. Prefer the denormalized workspaces/{id}.name; fall back to the owner's
// company/onboarding business_name (workspaceId == owner uid by construction).
async function resolveOrgName(workspaceId, wsData) {
    if (wsData && wsData.name) return nullableString(wsData.name, 160);
    try {
        const c = await db.doc(`users/${workspaceId}/settings/company`).get();
        if (c.exists && c.data().business_name) return nullableString(c.data().business_name, 160);
    } catch (_) {}
    try {
        const p = await db.doc(`users/${workspaceId}/onboarding/profile`).get();
        if (p.exists && p.data().business_name) return nullableString(p.data().business_name, 160);
    } catch (_) {}
    return null;
}

// Upsert one member's internal_users row. Returns 'created' | 'updated' |
// 'unchanged' | 'skipped'. Same semantics as db-service.mirrorMemberInternalRow.
async function mirrorMember(memberUid, { email, displayName, organization, workspaceRole }) {
    if (!memberUid) return 'skipped';
    const ref = db.doc(`internal_users/${memberUid}`);
    const snap = await ref.get();

    const org = organization != null ? nullableString(organization, 160) : undefined;
    const role = workspaceRole != null ? nullableString(workspaceRole, 40) : undefined;
    const mail = email != null ? nullableString(email, 160) : undefined;
    const name = displayName != null ? nullableString(displayName, 160) : undefined;

    if (!snap.exists) {
        if (!DRY_RUN) {
            await ref.set({
                user_id: memberUid,
                email: mail || null,
                display_name: name || null,
                business_name: null,
                role: null,
                phone_number: null,
                organization: org || null,
                workspace_role: role || null,
                account_status: 'registered',
                kyc_status: 'not_started',
                payment_status: 'pending',
                onboarding_completed: false,
                kyc_submitted_at: null,
                kyc_reviewed_at: null,
                payment_submitted_at: null,
                payment_verified_at: null,
                plan_id: null,
                payment_amount: null,
                payment_method: null,
                assigned_reviewer_id: null,
                last_internal_note: null,
                risk_level: null,
                created_at: FieldValue.serverTimestamp(),
                updated_at: FieldValue.serverTimestamp()
            });
        }
        return 'created';
    }

    const existing = snap.data() || {};
    const patch = {};
    if (role !== undefined && (existing.workspace_role || null) !== role) patch.workspace_role = role;
    if (org !== undefined && (existing.organization || null) !== org) patch.organization = org;
    if (mail !== undefined && !existing.email && mail) patch.email = mail;
    if (name !== undefined && !existing.display_name && name) patch.display_name = name;
    if (Object.keys(patch).length === 0) return 'unchanged';
    if (!DRY_RUN) {
        patch.updated_at = FieldValue.serverTimestamp();
        await ref.set(patch, { merge: true });
    }
    return 'updated';
}

async function main() {
    console.log(`\nFluxyOS internal-console roster backfill ${DRY_RUN ? '(DRY-RUN)' : '(LIVE)'}`);
    if (ONLY_WORKSPACE) console.log(`Scope: workspace ${ONLY_WORKSPACE}`);
    console.log('');

    const workspaceRefs = ONLY_WORKSPACE
        ? [db.doc(`workspaces/${ONLY_WORKSPACE}`)]
        : await db.collection('workspaces').listDocuments();

    const totals = { workspaces: 0, members: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 };

    for (const wsRef of workspaceRefs) {
        const wsSnap = await wsRef.get();
        const wsData = wsSnap.exists ? (wsSnap.data() || {}) : {};
        const orgName = await resolveOrgName(wsRef.id, wsData);

        const membersSnap = await wsRef.collection('members').get();
        if (membersSnap.empty) continue;
        totals.workspaces++;

        const perWs = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
        for (const memberDoc of membersSnap.docs) {
            const m = memberDoc.data() || {};
            const uid = m.uid || memberDoc.id;
            const role = VALID_ROLES.includes(m.role) ? m.role : 'viewer';
            totals.members++;
            let res = 'skipped';
            try {
                res = await mirrorMember(uid, {
                    email: m.email || null,
                    displayName: m.display_name || null,
                    organization: orgName != null ? orgName : undefined,
                    workspaceRole: role
                });
            } catch (e) {
                console.warn(`  ! ${wsRef.id}/${uid}: ${e.message}`);
            }
            perWs[res]++;
            totals[res]++;
        }
        console.log(
            `  workspace ${wsRef.id} — org="${orgName || '—'}" members=${membersSnap.size} ` +
            `created=${perWs.created} updated=${perWs.updated} unchanged=${perWs.unchanged} skipped=${perWs.skipped}`
        );
    }

    console.log('\n──────────────────────────────────────────────');
    console.log(`Workspaces touched: ${totals.workspaces}`);
    console.log(`Members seen:       ${totals.members}`);
    console.log(`Rows created:       ${totals.created}`);
    console.log(`Rows updated:       ${totals.updated}`);
    console.log(`Rows unchanged:     ${totals.unchanged}`);
    console.log(`Skipped (no uid):   ${totals.skipped}`);
    console.log(DRY_RUN ? '\n(DRY-RUN — no writes were made.)\n' : '\nDone.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
