'use strict';

/**
 * Server-side (Admin SDK) workspace scope resolution for finance data.
 *
 * Finance/operational collections were migrated `users/{uid}/*` ->
 * `workspaces/{workspaceId}/*` on 2026-06-22 and the app has written ONLY to the
 * workspace scope since (`window.FLUXY_WORKSPACE_MODE = true`, sidebar-loader.js).
 * The `users/{uid}/*` copy was deliberately left behind as the rollback net, so a
 * server that still reads it does NOT fail loudly — it returns a ledger frozen at
 * the migration date. Recent periods (this week, last week) then compute as 0 even
 * though the user has records, while older months still look plausible.
 *
 * Anything server-side that reads finance data must resolve its scope here.
 * See docs/PROJECT_BACKGROUND.md §4 and docs/WORKSPACE_TEAM_MANAGEMENT_STAGE2.md.
 */

function isValidScopeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * Resolve the workspace that owns this user's finance data.
 * 1. `user_workspaces/{uid}` reverse-lookup pointer — written on workspace
 *    bootstrap (incl. the migration) and on invite acceptance, so it is correct
 *    for owners AND invited members.
 * 2. Seeding rule: for a single-user account `workspaceId == uid`.
 */
async function resolveWorkspaceId(db, uid) {
    if (!isValidScopeId(uid)) return null;
    try {
        const snap = await db.doc(`user_workspaces/${uid}`).get();
        const data = (snap.exists && snap.data()) || {};
        if (isValidScopeId(data.default)) return data.default;
        const ids = Array.isArray(data.workspaceIds) ? data.workspaceIds.filter(isValidScopeId) : [];
        if (ids.length) return ids[0];
    } catch (_e) { /* fall through to the seeding rule */ }
    try {
        if ((await db.doc(`workspaces/${uid}`).get()).exists) return uid;
    } catch (_e) { /* fall through */ }
    return null;
}

/**
 * The parent paths to read finance collections from, in priority order:
 * the resolved workspace first, the legacy user path last (pre-migration
 * accounts and rollback safety).
 */
async function resolveFinanceScopes(db, uid) {
    const workspaceId = await resolveWorkspaceId(db, uid);
    const scopes = [];
    if (workspaceId) scopes.push(`workspaces/${workspaceId}`);
    if (!workspaceId || workspaceId !== uid) scopes.push(`workspaces/${uid}`);
    scopes.push(`users/${uid}`);
    return [...new Set(scopes)];
}

// A voided ledger entry is reversed, not deleted. Every app surface excludes it
// (DataService._activeTransactions), so server-side readers must too.
function isVoidedTransaction(record = {}) {
    return record?.is_voided === true || String(record?.status || '').trim().toLowerCase() === 'voided';
}

async function readCollection(db, scopePath, name, limit, orderByField) {
    let ref = db.collection(`${scopePath}/${name}`);
    if (orderByField) {
        // Newest-first so a capped read always contains the most recent records —
        // an unordered capped read is document-ID ordered and can omit the current
        // and previous weeks entirely on a large ledger.
        try {
            const snap = await ref.orderBy(orderByField, 'desc').limit(limit).get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (_e) {
            // Ordered read unavailable — fall back to the plain capped read rather
            // than reporting an empty ledger.
            ref = db.collection(`${scopePath}/${name}`);
        }
    }
    const snap = await ref.limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Read one finance collection from the first scope that holds records.
 * `orderByField` (e.g. 'timestamp') makes the capped read newest-first.
 * Returns `{ records, scope }`; `scope` is null when nothing was found anywhere.
 */
async function readFinanceCollection(db, scopes, name, limit, { orderByField = null, logger = console } = {}) {
    for (const scopePath of scopes) {
        try {
            const records = await readCollection(db, scopePath, name, limit, orderByField);
            if (records.length) return { records, scope: scopePath };
        } catch (e) {
            (logger.warn || console.warn)(`finance read failed: ${scopePath}/${name}`, { error: e.message });
        }
    }
    return { records: [], scope: null };
}

module.exports = {
    isValidScopeId,
    resolveWorkspaceId,
    resolveFinanceScopes,
    isVoidedTransaction,
    readFinanceCollection,
};
