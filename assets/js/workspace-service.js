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
    baseCurrency: null, // immutable accounting currency; null = not yet read (treat as IDR)
    country: null,      // ISO 3166-1 alpha-2 business country, set with the currency
};

/**
 * Push the workspace base currency into the money seam so every formatter in the
 * app renders in it. Fail-safe: an unknown or absent code leaves the seam on its
 * IDR default rather than throwing — a formatter must never break a page.
 */
// The base currency survives a failed read.
//
// It used to be recovered ONLY from the workspace profile fetch, which lives in a
// try/catch labelled "name/plan optional" — written when that read fetched just a
// display name. It is not optional: when the read fails (blocked Firestore
// channel, offline, rules hiccup) the seam silently reverts to IDR and a peso
// workspace renders "Rp887.878.700". Caching the last known good value per uid
// means a transient failure degrades to the PREVIOUS answer, not to the wrong one.
const CCY_CACHE_KEY = 'fluxy_base_ccy';

// Last currency this tab actually READ, per uid. resolveWorkspace runs more than
// once per page — the page calls it and so does sidebar-loader — and it used to
// reset the seam to IDR at the start of EVERY run. A second run whose profile
// read was slow or blocked therefore left every formatter on rupiah even though
// the first run had already resolved PHP. The currency now only ever moves
// FORWARD to a freshly-read value; nothing resets it to a default.
let lastKnownCurrency = { uid: null, ccy: null, country: null };

function readCachedCurrency(uid) {
    if (lastKnownCurrency.uid === uid && lastKnownCurrency.ccy) return lastKnownCurrency;
    // localStorage, not sessionStorage: a workspace's accounting currency is
    // immutable, so once read it is safe to reuse across tabs and reloads. That
    // makes a blocked or flaky read cost nothing after the first success.
    for (const store of [localStorage, sessionStorage]) {
        try {
            const c = JSON.parse(store.getItem(CCY_CACHE_KEY) || 'null');
            if (c && c.uid === uid && c.ccy) return c;
        } catch (_) { /* try the next store */ }
    }
    return null;
}

function writeCachedCurrency(uid, ccy, country) {
    if (!uid || !ccy) return;
    lastKnownCurrency = { uid, ccy, country: country || null };
    const payload = JSON.stringify({ uid, ccy, country: country || null });
    for (const store of [localStorage, sessionStorage]) {
        try { store.setItem(CCY_CACHE_KEY, payload); } catch (_) { /* non-fatal */ }
    }
}

function applyBaseCurrency(code) {
    try {
        if (typeof window !== 'undefined' && window.FluxyMoney) {
            window.FluxyMoney.setBaseCurrency(code || window.FluxyMoney.DEFAULT_BASE);
            // Repaint static prefix chips ("Rp" beside an amount input) now that
            // the real currency is known. They are plain HTML and cannot
            // interpolate, so this is the only thing that corrects them.
            window.FluxyMoney.paintSymbols();
            window.FluxyMoney.paintCurrencyNames();
            window.FluxyMoney.paintCountryExamples();
        }
    } catch (_) { /* formatting must never break resolution */ }
}

function publish() {
    const snapshot = {
        id: state.id,
        role: state.role,
        status: state.status,
        uid: state.uid,
        ready: state.ready,
        name: state.name,
        plan: state.plan,
        baseCurrency: state.baseCurrency,
        country: state.country,
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

// ── Readiness ────────────────────────────────────────────────────────────────
//
// The base currency is a PRECONDITION for rendering money, not a nice-to-have.
// Before this, sidebar-loader.js and each page both called resolveWorkspace
// independently and whichever finished first decided what the user saw: the page
// could format every figure while the seam was still on its IDR default, so a
// peso workspace rendered "Rp" until something happened to repaint. That is the
// flicker on Overview and the stale "Rp" on the settings pages — one bug.
//
// `whenWorkspaceReady()` gives every surface a single thing to await, and
// `inFlight` collapses concurrent callers onto one resolution instead of racing.
let inFlight = null;
let readyResolve = null;
const readyPromise = new Promise((res) => { readyResolve = res; });
let isReady = false;

function markReady() {
    if (isReady) return;
    isReady = true;
    try { readyResolve(publish()); } catch (_) {}
    try {
        if (typeof document !== 'undefined') {
            // Reveal the app: money surfaces are skeleton-masked until here.
            document.documentElement.classList.remove('fluxy-booting');
            document.dispatchEvent(new CustomEvent('fluxy:workspace-ready'));
        }
    } catch (_) {}
}

// FAILSAFE. markReady() normally fires when resolveWorkspace settles, but a page
// that never calls it (signed out, a thrown import, an offline SDK) must not be
// left masked forever. Showing the IDR default is a cosmetic error; a permanently
// skeletoned app is a broken product. 6s is far beyond a normal resolve.
if (typeof window !== 'undefined') {
    setTimeout(() => {
        if (!isReady) {
            console.warn('[workspace-service] readiness failsafe fired — revealing with the default currency');
            markReady();
        }
    }, 6000);
}

/**
 * Resolves once the workspace (and therefore the base currency) is known.
 * Already-resolved callers get it immediately. NEVER rejects — a page must not
 * be stranded because resolution failed; the seam falls back to IDR by design.
 */
function whenWorkspaceReady() { return readyPromise; }

/** True once the base currency is settled. For synchronous render guards. */
function workspaceReady() { return isReady; }

/**
 * Resolve the workspace + role for `user`. Best-effort; returns the published
 * snapshot. Safe to call repeatedly (e.g. on every auth state change).
 *
 * Concurrent calls for the SAME user share one in-flight resolution — page code
 * and sidebar-loader both call this on every load, and two parallel runs meant
 * two sets of reads and a nondeterministic winner.
 */
async function resolveWorkspace(app, user) {
    if (inFlight && inFlight.uid === (user && user.uid)) return inFlight.promise;
    const promise = _resolveWorkspace(app, user).finally(() => {
        if (inFlight && inFlight.promise === promise) inFlight = null;
        markReady();
    });
    inFlight = { uid: user && user.uid, promise };
    return promise;
}

async function _resolveWorkspace(app, user) {
    if (!user || !user.uid) {
        try { sessionStorage.removeItem('fluxy_ws'); } catch (_) {}
        Object.assign(state, { id: null, role: null, status: null, uid: null, ready: false, name: null, plan: null, baseCurrency: null, country: null });
        applyBaseCurrency(null);
        return publish();
    }
    state.uid = user.uid;
    // Seed from the last known good value FOR THIS USER. Resetting unconditionally
    // to IDR (as this did) meant any failed profile read landed on the wrong
    // currency rather than the previous one. A different uid gets no seed, so
    // signing into another account can never inherit the last one's currency.
    const cachedCcy = readCachedCurrency(user.uid);
    if (cachedCcy) {
        // Known currency for THIS user — keep it in force while we re-resolve.
        state.baseCurrency = cachedCcy.ccy;
        state.country = cachedCcy.country;
        applyBaseCurrency(cachedCcy.ccy);
    } else if (lastKnownCurrency.uid && lastKnownCurrency.uid !== user.uid) {
        // A DIFFERENT user signed in — the previous currency must not leak, and
        // there is nothing cached for this one, so fall back to the default.
        lastKnownCurrency = { uid: null, ccy: null, country: null };
        for (const store of [localStorage, sessionStorage]) {
            try { store.removeItem(CCY_CACHE_KEY); } catch (_) {}
        }
        state.baseCurrency = null;
        state.country = null;
        applyBaseCurrency(null);
    }
    // Otherwise leave the seam alone: a re-resolve for the same user must never
    // knock a resolved currency back to the default while it re-reads.
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
        // Apply the shared long-polling setting on first touch (resolveDb) so a
        // blocked WebChannel (Brave Shields etc.) can't strand resolution either.
        const { resolveDb } = await import('/assets/js/firestore-db.js');
        const db = resolveDb(app);

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

        // SELF-HEAL (owner): we resolved to the user's OWN workspace but never
        // confirmed an active members doc (ready=false). Every finance read
        // (workspaces/{uid}/transactions, /bills, /budgets …) would be
        // permission-denied in that state — those rules require an active
        // members/{uid} doc, and the owner-bootstrap read exception only covers
        // the workspace + members docs themselves, not the finance data. So
        // provision the owner workspace + membership NOW (the rules explicitly
        // allow this self-create) so the very next finance read on THIS load
        // passes isMember(). This previously ran only on settings-team, which is
        // why an owner who never opened Team settings hit "Missing or insufficient
        // permissions" on the ledger/dashboard. Idempotent + best-effort — a
        // failure just leaves the owner-of-self fallback in place. Mirrors
        // healFromStoredInvite (the invited-member equivalent).
        if (user.uid && state.id === user.uid && state.role === 'owner' && state.ready !== true) {
            try {
                const { default: DataService } = await import('/assets/js/db-service.js');
                const ds = new DataService(app);
                ds.setActor(user.uid);
                await ds.ensureWorkspace(user.uid, { email: user.email || null, displayName: user.displayName || null });
                state.status = 'active';
                state.ready = true;
            } catch (e) {
                console.warn('[workspace-service] owner membership bootstrap failed', e);
            }
        }

        // 3) Workspace profile. The NAME and PLAN here are cosmetic; the BASE
        //    CURRENCY is not — it decides how every stored integer is read. So this
        //    read gets one retry, and a total failure keeps the cached value rather
        //    than falling through to IDR.
        let wsSnap = null;
        for (let attempt = 0; attempt < 2 && !wsSnap; attempt += 1) {
            try {
                // SERVER read, never the cache. The SDK serves getDoc() from
                // IndexedDB when the realtime channel is degraded — and that
                // channel is exactly what ad blockers and strict privacy modes
                // break. A workspace stamped with base_currency AFTER its doc was
                // last cached therefore kept resolving to the old copy, so a peso
                // workspace rendered rupiah on every load with no way to recover.
                // Falls back to the cached read when the server is unreachable.
                try {
                    wsSnap = await fs.getDocFromServer(fs.doc(db, `workspaces/${state.id}`));
                } catch (_) {
                    wsSnap = await fs.getDoc(fs.doc(db, `workspaces/${state.id}`));
                }
            } catch (e) {
                if (attempt === 0) { await new Promise((r) => setTimeout(r, 400)); continue; }
                console.warn('[workspace-service] profile read failed; keeping cached currency', state.baseCurrency || 'IDR', e);
            }
        }
        try {
            if (wsSnap && wsSnap.exists()) {
                const d = wsSnap.data() || {};
                state.name = d.name || null;
                // Base currency + country are IMMUTABLE workspace financial config
                // (docs/PROJECT_BACKGROUND.md §4). Publishing them here is what makes
                // every money formatter currency-aware: applyToPage() awaits this
                // resolve before the page's first finance read, so nothing renders
                // money before the base currency is known. Absent means IDR — a
                // missing field can never show the wrong symbol.
                state.baseCurrency = d.base_currency || null;
                state.country = d.country || null;
                applyBaseCurrency(state.baseCurrency);
                writeCachedCurrency(user.uid, state.baseCurrency, state.country);
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
        // LAST RESORT: the workspace doc gave us no currency (read blocked, or a
        // cached copy that predates the field). onboarding/profile mirrors
        // base_currency and is a DIFFERENT document with its own cache entry, so
        // one poisoned entry cannot decide the whole app's currency. Only ever
        // used to FILL a gap — it never overrides a value the workspace supplied.
        if (!state.baseCurrency) {
            try {
                const profSnap = await fs.getDocFromServer(fs.doc(db, `users/${user.uid}/onboarding/profile`))
                    .catch(() => fs.getDoc(fs.doc(db, `users/${user.uid}/onboarding/profile`)));
                const pd = (profSnap && profSnap.exists()) ? (profSnap.data() || {}) : {};
                if (pd.base_currency) {
                    console.info('[workspace-service] currency recovered from onboarding profile', pd.base_currency);
                    state.baseCurrency = pd.base_currency;
                    state.country = state.country || pd.country || null;
                    applyBaseCurrency(state.baseCurrency);
                    writeCachedCurrency(user.uid, state.baseCurrency, state.country);
                }
            } catch (_) { /* genuinely unavailable — the IDR default stands */ }
        }
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

export { resolveWorkspace, getWorkspace, whenWorkspaceReady, workspaceReady };

// Expose for classic-script consumers.
if (typeof window !== 'undefined') {
    window.FluxyWorkspace = Object.assign(window.FluxyWorkspace || {}, {
        resolve: resolveWorkspace,
        get: getWorkspace,
        whenReady: whenWorkspaceReady,
        isReady: workspaceReady,
        can: (capability) => false, // replaced by publish() once resolved
    });
}
