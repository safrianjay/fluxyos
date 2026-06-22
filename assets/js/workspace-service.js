// FluxyOS — Workspace resolution service
//
// Resolves the current signed-in user's active workspace + role and publishes it
// as window.FluxyWorkspace so every app surface can ask "what workspace am I in,
// and what may I do here?".
//
// Data model (see docs/SECURITY_SYSTEM.md §3 + the Team Management plan):
//   - workspaces/{workspaceId}                       — workspace profile
//   - workspaces/{workspaceId}/members/{userId}      — { role, status }
//   - user_workspaces/{uid} = { workspaceIds:[], default }  — reverse lookup
//
// Seeding rule: for existing single-user accounts the workspaceId == the owner's
// uid, so resolution is reference-safe and a brand-new account works before any
// migration runs.
//
// FAIL-SAFE: this never throws and always leaves a usable window.FluxyWorkspace.
// If membership can't be read (offline, pre-migration, rules), it falls back to
// "owner of my own workspace" (id == uid) so existing owners are never locked out.

import { can as permCan } from '/assets/js/perms-service.js';

const FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Mutable cached state. Always shaped, never null.
const state = {
    id: null,        // resolved workspaceId
    role: null,      // owner | admin | finance | viewer
    status: null,    // active | pending | removed
    uid: null,       // the signed-in user's uid
    ready: false,    // true once a real members doc was read
    name: null,      // workspace display name, when available
    plan: null,      // denormalized { id, name, status, frequency } — shared by all members
};

function publish() {
    const snapshot = {
        id: state.id,
        role: state.role,
        status: state.status,
        uid: state.uid,
        ready: state.ready,
        name: state.name,
        plan: state.plan,
        isOwner: state.role === 'owner',
        can: (capability) => (state.status === 'active' ? permCan(state.role, capability) : false),
    };
    if (typeof window !== 'undefined') window.FluxyWorkspace = Object.assign(window.FluxyWorkspace || {}, snapshot);
    return snapshot;
}

// Durable invite context the login page persists so a missed one-shot acceptance
// can still be healed on a later authenticated load (see healFromStoredInvite).
const INVITE_HEAL_KEY = 'fluxy_invite_heal';

function readStoredInvite() {
    try {
        let raw = null;
        if (typeof localStorage !== 'undefined') raw = localStorage.getItem(INVITE_HEAL_KEY);
        if (!raw && typeof sessionStorage !== 'undefined') raw = sessionStorage.getItem('fluxy_pending_invite');
        const v = raw ? JSON.parse(raw) : null;
        return (v && v.ws) ? { ws: String(v.ws), invite: String(v.invite || '') } : null;
    } catch (_) { return null; }
}

function clearStoredInvite() {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(INVITE_HEAL_KEY); } catch (_) {}
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('fluxy_pending_invite'); } catch (_) {}
}

// SELF-HEAL an invited member onto the shared workspace. Covers the two ways the
// login-time acceptance can leave a member stranded as a lonely owner of an empty
// workspace: (a) the one-shot acceptInvite didn't run/complete, so no member doc
// exists; or (b) the member doc exists but the members.uid collection-group
// read/index is unavailable, so resolution couldn't see it. We trust the durable
// invite context (the owner's workspace id) the login page stored. Returns
// { workspaceId, role } when the member belongs to that workspace, else null.
async function healFromStoredInvite(app, db, fs, user) {
    const stored = readStoredInvite();
    if (!stored || !stored.ws || stored.ws === user.uid) return null;
    const myEmail = String(user.email || '').trim().toLowerCase();
    // Only ever heal the invite addressed to THIS signed-in user.
    if (stored.invite && stored.invite.trim().toLowerCase() !== myEmail) return null;

    // (b) Membership may already exist — a direct doc read is authoritative and
    // bypasses any collection-group index/rule gap.
    try {
        const meSnap = await fs.getDoc(fs.doc(db, `workspaces/${stored.ws}/members/${user.uid}`));
        if (meSnap.exists()) {
            const m = meSnap.data() || {};
            if ((m.status || 'active') === 'active') {
                clearStoredInvite();
                return { workspaceId: stored.ws, role: m.role || 'viewer' };
            }
            return null; // removed/pending — do not force-join
        }
    } catch (_) { /* fall through to acceptance */ }

    // (a) No member doc yet — accept the pending invite now. Reuse DataService so
    // the write matches the Firestore rules exactly (member create + invite flip +
    // pointer), and exempt the member from the owner KYC gate.
    try {
        const { default: DataService } = await import('/assets/js/db-service.js');
        const ds = new DataService(app);
        ds.setActor(user.uid);
        const res = await ds.acceptInvite(stored.ws, user.uid, {
            email: user.email,
            displayName: user.displayName || null
        });
        await ds.markInvitedMemberExempt(user.uid).catch(() => {});
        clearStoredInvite();
        return { workspaceId: res.workspaceId, role: res.role };
    } catch (_) {
        return null;
    }
}

// Seed an owner-of-own-workspace fallback so the app is usable pre-migration and
// for fresh accounts. workspaceId == uid (the seeding rule above).
function fallbackToSelf(uid) {
    state.id = uid;
    state.uid = uid;
    state.role = 'owner';
    state.status = 'active';
    state.ready = false; // membership doc not confirmed
    return publish();
}

/**
 * Resolve the workspace + role for `user`. Best-effort; returns the published
 * snapshot. Safe to call repeatedly (e.g. on every auth state change).
 */
async function resolveWorkspace(app, user) {
    if (!user || !user.uid) {
        try { sessionStorage.removeItem('fluxy_ws'); } catch (_) {}
        Object.assign(state, { id: null, role: null, status: null, uid: null, ready: false, name: null, plan: null });
        return publish();
    }
    state.uid = user.uid;
    // Drop any cached workspace id that belongs to a different user (sign-in
    // switch in the same tab) so db-service._scope never reads a cross-user id.
    try {
        const cached = JSON.parse(sessionStorage.getItem('fluxy_ws') || 'null');
        if (cached && cached.uid !== user.uid) sessionStorage.removeItem('fluxy_ws');
    } catch (_) {}
    // Optimistic fallback first so callers always have something usable.
    fallbackToSelf(user.uid);

    let confirmed = false;
    try {
        const fs = await import(FIRESTORE_URL);
        const db = fs.getFirestore(app);

        // 1) Preference hint: which workspace does the pointer point to?
        let preferred = user.uid; // seeding default (owner-of-self)
        try {
            const ptrSnap = await fs.getDoc(fs.doc(db, `user_workspaces/${user.uid}`));
            if (ptrSnap.exists() && typeof (ptrSnap.data() || {}).default === 'string') {
                preferred = ptrSnap.data().default;
            }
        } catch (_) { /* pointer optional */ }

        // 2) AUTHORITATIVE: find the user's own membership docs via a collection-group
        // query (doc.uid == me). This works even if the reverse-lookup pointer is
        // missing/stale, so already-joined members resolve correctly and see the
        // shared workspace data. The pointer only breaks ties for multi-workspace users.
        let memberships = [];
        try {
            const snap = await fs.getDocs(fs.query(fs.collectionGroup(db, 'members'), fs.where('uid', '==', user.uid)));
            snap.forEach((d) => {
                const parent = d.ref.parent && d.ref.parent.parent;
                if (parent) {
                    const m = d.data() || {};
                    memberships.push({ workspaceId: parent.id, role: m.role || 'viewer', status: m.status || 'active' });
                }
            });
        } catch (_) { /* collection-group index/rules unavailable — fall back below */ }

        let active = memberships.filter((x) => x.status === 'active');

        // SELF-HEAL: if no membership in a workspace the user was INVITED to (i.e.
        // any workspace they don't own) surfaced, they'd otherwise resolve to their
        // own — possibly empty — workspace and be stranded. Recover from the durable
        // invite context the login page stored so an invited member converges on the
        // shared workspace on this load, before any finance read happens.
        if (!active.some((x) => x.workspaceId !== user.uid)) {
            const healed = await healFromStoredInvite(app, db, fs, user).catch(() => null);
            if (healed && healed.workspaceId && healed.workspaceId !== user.uid) {
                active = active.filter((x) => x.workspaceId !== healed.workspaceId);
                active.push({ workspaceId: healed.workspaceId, role: healed.role || 'viewer', status: 'active' });
            }
        }

        // Prefer a workspace the user was INVITED to (workspaceId != uid) over their
        // own self-workspace: an invited member's self-workspace, if one exists, is
        // empty, while the shared workspace is always the right home. The pointer
        // hint only breaks ties *within* the preferred set.
        const invitedActive = active.filter((x) => x.workspaceId !== user.uid);
        const pickFrom = invitedActive.length ? invitedActive : active;
        const chosen = pickFrom.find((x) => x.workspaceId === preferred) || pickFrom[0] || null;

        if (chosen) {
            state.id = chosen.workspaceId;
            state.role = chosen.role;
            state.status = 'active';
            state.ready = true;
        } else {
            // Fallback (collection-group unavailable): single pointer-based read,
            // then owner-of-self.
            const memberSnap = await fs.getDoc(fs.doc(db, `workspaces/${preferred}/members/${user.uid}`));
            if (memberSnap.exists()) {
                const m = memberSnap.data() || {};
                state.id = preferred;
                state.role = m.role || 'viewer';
                state.status = m.status || 'active';
                state.ready = true;
            } else if (preferred === user.uid) {
                state.id = user.uid;
                state.role = 'owner';
                state.status = 'active';
                state.ready = false;
            } else {
                state.id = preferred;
                state.role = null;
                state.status = 'removed';
                state.ready = true;
            }
        }

        // 3) Best-effort workspace name + denormalized plan for display.
        try {
            const wsSnap = await fs.getDoc(fs.doc(db, `workspaces/${state.id}`));
            if (wsSnap.exists()) {
                const d = wsSnap.data() || {};
                state.name = d.name || null;
                state.plan = (d.plan_id || d.plan_name || d.subscription_status) ? {
                    id: d.plan_id || null,
                    name: d.plan_name || null,
                    status: d.subscription_status || null,
                    frequency: d.billing_frequency || null,
                    // Denormalized trial timing — lets members inherit the same trial
                    // banner + access verdict without reading the owner's billing doc.
                    trialStartedAt: d.trial_started_at || null,
                    trialEndsAt: d.trial_ends_at || null,
                    periodEndsAt: d.current_period_end || null
                } : null;
            }
        } catch (_) { /* name/plan optional */ }
        confirmed = true;
    } catch (err) {
        // Network/rules error — keep the owner-of-self fallback already published.
        console.warn('[workspace-service] resolve failed, using self fallback', err);
    }
    // Cache the resolved (active) workspace id so db-service._scope can scope
    // finance reads/writes synchronously on the next page load without waiting
    // for re-resolution. Only the confirmed id is cached, never the fallback.
    try {
        if (confirmed && state.id && state.status === 'active') {
            sessionStorage.setItem('fluxy_ws', JSON.stringify({ uid: user.uid, id: state.id }));
        }
    } catch (_) {}
    return publish();
}

/** Synchronous accessor for the current cached workspace snapshot. */
function getWorkspace() {
    return publish();
}

export { resolveWorkspace, getWorkspace };

// Expose for classic-script consumers.
if (typeof window !== 'undefined') {
    window.FluxyWorkspace = Object.assign(window.FluxyWorkspace || {}, {
        resolve: resolveWorkspace,
        get: getWorkspace,
        can: (capability) => false, // replaced by publish() once resolved
    });
}
