'use strict';

// =============================================================================
// FluxyOS — remembering an answer for as long as a function stays warm.
//
// WHY THIS EXISTS. The functions run in us-east-2 and Firestore in
// asia-southeast1, so every read is a ~200 ms round trip across the Pacific
// (docs/perf/S1_BASELINE_2026-09-11.md, F2). Moving the functions needs a paid
// plan; not asking the same question twice does not. A warm Lambda instance
// serves request after request, and a QR token's table, an outlet's menu, or a
// photo's signed URL do not change between two diners at the same restaurant.
//
// WHAT IT IS NOT. A shared cache. Each function instance has its own, it
// starts empty on every cold start, and nothing invalidates it — entries simply
// expire. So everything stored here must be an answer that is still acceptable
// `ttlMs` after it was read. Each caller states its staleness budget beside
// the TTL it picks.
//
// `null` and `undefined` are NOT cached: a token that does not exist yet may
// exist in a minute (a card printed right after a stray scan), and a refusal
// cached for a minute would be a card that looks broken for a minute.
// =============================================================================

function createCache({ ttlMs, max = 1000 }) {
    const map = new Map();
    return {
        /** The cached value for `key`, or `loader()`'s — which is then cached. */
        async get(key, loader) {
            const now = Date.now();
            const hit = map.get(key);
            if (hit && hit.expires > now) return hit.value;
            // The PROMISE is stored, so concurrent callers share one load.
            const pending = Promise.resolve().then(loader);
            map.set(key, { value: pending, expires: now + ttlMs });
            if (map.size > max) map.delete(map.keys().next().value);   // oldest first
            try {
                const value = await pending;
                if (value == null) map.delete(key);
                return value;
            } catch (err) {
                map.delete(key);
                throw err;
            }
        },
        /** For the checks. */
        size: () => map.size,
        clear: () => map.clear()
    };
}

// ── The QR token directory ───────────────────────────────────────────────────
//
// Every QR endpoint's first read, and the one whose answer changes least: a
// token names one table in one workspace for the life of the printed card.
//
// Staleness budget: 60 s. A card revoked (table archived, token rotated) keeps
// working for at most a minute on an instance that had already seen it — and
// the till's own table archive is not faster than that to reach a diner who
// already has the menu open.
const directoryCache = createCache({ ttlMs: 60 * 1000, max: 5000 });

/**
 * `pos_table_directory/{token}` as `{ workspace_id, table_id, dimension_id,
 * revoked }`, or null when there is no such token.
 */
function directoryEntry(db, token) {
    return directoryCache.get(token, async () => {
        const snap = await db.doc(`pos_table_directory/${token}`).get();
        if (!snap.exists) return null;
        const d = snap.data() || {};
        return {
            workspace_id: d.workspace_id || null,
            table_id: d.table_id || null,
            dimension_id: d.dimension_id || null,
            revoked: d.revoked === true
        };
    });
}

module.exports = { createCache, directoryEntry, _directoryCache: directoryCache };
