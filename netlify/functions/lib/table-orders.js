'use strict';

// =============================================================================
// FluxyOS — the orders at ONE table, newest first.
//
// ⚠️ WHY THIS EXISTS (docs/perf/LOAD_2026-09-11.md, H1 — Critical). qr-order,
// qr-order-status and qr-request-bill used to read the WORKSPACE's 50 newest
// orders and look for the table's among them. Past 50 newer orders anywhere in
// the workspace, a table still mid-meal simply vanished from that window: the
// load test's lunch rush refused 36 live sittings `sitting_ended` (each 50-88
// orders behind), the page re-sent those rounds as brand-new sittings, the
// diner's first order disappeared from their phone, and a bill request would
// have missed it. At one 40-table outlet that took about 35 minutes.
//
// The fix asks the question directly: this table's orders. It needs a
// composite index — `pos_orders`: table_id ASC, created_at DESC — declared in
// firestore.indexes.json and deployed with `firebase deploy --only
// firestore:indexes` BEFORE this code.
//
// ⚠️ IF THE INDEX IS NOT THERE, THIS FALLS BACK rather than failing. A query
// that needs a missing index throws FAILED_PRECONDITION, and throwing here
// would refuse every QR order in production. The fallback is the old
// workspace window — the exact behaviour this replaces, bug included — and it
// logs loudly so a missing index is found in the function logs, not by diners.
//
// 25, not 50: this is ONE table's history, and the live sitting is always its
// newest few tickets. Every caller still filters by table and liveness, so the
// fallback's mixed-table result is handled the same way it always was.
// =============================================================================

const PER_TABLE = 25;
let warned = false;
const WORKSPACE_WINDOW = 50;

function isMissingIndex(err) {
    const code = err && err.code;
    return code === 9 || code === 'failed-precondition'
        || /FAILED_PRECONDITION|requires an index|index is currently building/i.test(String((err && err.message) || ''));
}

/** A QuerySnapshot of the table's orders, newest first. */
async function tableOrders(db, workspaceId, tableId) {
    const col = db.collection(`workspaces/${workspaceId}/pos_orders`);
    try {
        return await col.where('table_id', '==', tableId)
            .orderBy('created_at', 'desc').limit(PER_TABLE).get();
    } catch (err) {
        if (!isMissingIndex(err)) throw err;
        // Once per warm instance: loud enough to be found, not a log flood.
        if (!warned) {
            warned = true;
            console.error('[table-orders] ⚠️ pos_orders (table_id, created_at) index missing or building — '
                + 'falling back to the workspace window, which loses busy tables. Deploy firestore.indexes.json.',
            err && err.message);
        }
        return col.orderBy('created_at', 'desc').limit(WORKSPACE_WINDOW).get();
    }
}

module.exports = { tableOrders, isMissingIndex, PER_TABLE };
