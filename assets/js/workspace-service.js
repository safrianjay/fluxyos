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

        const active = memberships.filter((x) => x.status === 'active');
        const chosen = active.find((x) => x.workspaceId === preferred) || active[0] || null;

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
                    frequency: d.billing_frequency || null
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
