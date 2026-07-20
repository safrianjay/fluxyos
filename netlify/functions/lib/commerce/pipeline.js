'use strict';

// =============================================================================
// Commerce Integration Platform — sync pipeline
//
// Runs one sync job end to end:
//   connector fetch → normalize (validate) → upsert commerce_* docs
//   → finance mapping → ledger writes (create() idempotent) → account status.
//
// Used inline by commerce-sync-worker (small jobs) and by
// commerce-sync-background (chunked initial/reconcile imports with cursor
// persistence). All layer boundaries per docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md.
// =============================================================================

const registry = require('./registry');
const tokenManager = require('./token-manager');
const { normalizeBatch, commerceTransactionFromOrder } = require('./normalize');
const financeMap = require('./finance-map');
const store = require('./store');

// Fetch every page of one kind within a window. Cursor loop bounded to keep a
// single call finite; callers chunk long ranges (Shopee caps windows at 15d).
async function fetchAll(connector, kind, { credentials, since, until, maxPages = 20 }) {
    const fetcher = { order: 'fetchOrders', refund: 'fetchRefunds', settlement: 'fetchSettlements' }[kind];
    const items = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
        const res = await connector[fetcher]({ credentials, since, until, cursor });
        items.push(...(res.items || []));
        cursor = res.nextCursor || null;
        if (!cursor) break;
    }
    return items;
}

// Sync one window for one account. Returns stats. Throws with err.code='auth'
// when credentials are dead (caller marks the account expired, no retry).
async function syncWindow(db, { workspaceId, account, since, until, jobId = null }) {
    const connector = registry.get(account.platform);
    if (!connector) throw new Error(`no connector registered for '${account.platform}'`);
    if (!registry.isConfigured(account.platform)) throw new Error(`platform '${account.platform}' is not configured`);

    const credentials = await tokenManager.getValidCredentials(db, {
        workspaceId,
        platform: account.platform,
        shopId: account.shop_id,
        connector,
    });

    const stats = { orders: 0, refunds: 0, settlements: 0, ledger_writes: 0, rejects: 0 };
    const accountId = account.id;

    // ---- orders (source of truth for the order-level money math; REQUIRED —
    // a failure here (including a missing scope) aborts the job, since there
    // is nothing to sync without it).
    const rawOrders = await fetchAll(connector, 'order', { credentials, since, until });
    const orders = normalizeBatch(connector, 'order', rawOrders, { accountId });
    await recordRejects(db, workspaceId, accountId, jobId, orders.rejects, stats);
    stats.orders = await store.upsertCommerceDocs(db, workspaceId, 'commerce_orders', orders.valid, store.idForOrder);

    // ---- refunds & settlements (OPTIONAL — independent of the order-level
    // revenue math). A `forbidden` error (app not granted this endpoint's
    // scope, e.g. TikTok's Return & Refund API) must never abort the whole
    // sync or expire the account: the data type is recorded as degraded and
    // the run continues so orders still post to the ledger. Any OTHER error
    // (auth, network, unknown) still aborts — only a confirmed scope gap
    // gets this soft-fail treatment.
    const degraded = Array.isArray(account.degraded_scopes) ? account.degraded_scopes : [];
    const syncOptional = async (kind, collectionName, idFor) => {
        try {
            const raw = await fetchAll(connector, kind, { credentials, since, until });
            const batch = normalizeBatch(connector, kind, raw, { accountId });
            await recordRejects(db, workspaceId, accountId, jobId, batch.rejects, stats);
            const written = await store.upsertCommerceDocs(db, workspaceId, collectionName, batch.valid, idFor);
            // Self-heal: the scope was enabled since the last run.
            if (degraded.includes(kind)) await store.clearScopeGap(db, workspaceId, accountId, kind);
            return { batch, written };
        } catch (e) {
            if (e.code !== 'forbidden') throw e;
            await store.recordScopeGap(db, workspaceId, { accountId, jobId, kind, message: e.message });
            return { batch: { valid: [], rejects: [] }, written: 0 };
        }
    };

    const refundResult = await syncOptional('refund', 'commerce_refunds', store.idForRefund);
    stats.refunds = refundResult.written;

    const settlementResult = await syncOptional('settlement', 'commerce_settlements', store.idForSettlement);
    stats.settlements = settlementResult.written;
    const settlements = settlementResult.batch;

    // ---- universal commerce transactions (derived from orders)
    const commerceTxs = orders.valid
        .filter((o) => o.status === 'completed' || o.status === 'paid' || o.status === 'shipped')
        .map((o) => ({ tx: commerceTransactionFromOrder(o), order: o }));
    await store.upsertCommerceDocs(
        db, workspaceId, 'commerce_transactions',
        commerceTxs.map(({ tx }) => tx), store.idForCommerceTx
    );

    // ---- finance mapping → ledger (auto_post gate per D2)
    const autoPost = account.auto_post !== false;
    for (const { tx, order } of commerceTxs) {
        const commerceTxId = store.idForCommerceTx(tx);
        if (!autoPost) {
            await store.markCommerceTxLedger(db, workspaceId, commerceTxId, { status: 'pending_review', refs: null });
            continue;
        }
        const timestamp = order.order_created_at || new Date();
        const entries = financeMap.mapCommerceTransaction(tx, { account, timestamp });
        const { created } = await store.writeLedgerEntries(db, workspaceId, entries);
        stats.ledger_writes += created;
        await store.markCommerceTxLedger(db, workspaceId, commerceTxId, {
            status: 'posted',
            refs: Object.fromEntries(entries.map((e) => [e.data.type, e.id])),
        });
    }
    if (autoPost) {
        for (const stl of settlements.valid.filter((s) => s.status === 'paid')) {
            const entries = financeMap.mapSettlement(stl, { account, timestamp: stl.processed_at || new Date() });
            const { created } = await store.writeLedgerEntries(db, workspaceId, entries);
            stats.ledger_writes += created;
        }
    }

    return stats;
}

async function recordRejects(db, workspaceId, accountId, jobId, rejects, stats) {
    stats.rejects += rejects.length;
    for (const reject of rejects.slice(0, 10)) { // cap error-log fanout per batch
        await store.writeSyncError(db, workspaceId, {
            accountId,
            jobId,
            code: `normalize_${reject.kind}`,
            message: `${reject.raw_id}: ${reject.errors.join('; ')}`,
        });
    }
}

// Run a claimed job (worker inline path — incremental/manual/webhook).
// Window: since the account's last successful sync (minus a 30-min overlap
// safety margin), or the last 24h when none.
async function runSmallJob(db, { workspaceId, jobRef, job }) {
    const account = await store.getAccount(db, workspaceId, job.account_id);
    if (!account || account.status === 'disconnected') throw new Error('account not connected');

    const now = new Date();
    const lastSync = account.last_sync_at && account.last_sync_at.toDate ? account.last_sync_at.toDate() : null;
    const since = job.window_start && job.window_start.toDate
        ? job.window_start.toDate()
        : new Date((lastSync ? lastSync.getTime() : now.getTime() - 24 * 3600 * 1000) - 30 * 60 * 1000);
    const until = job.window_end && job.window_end.toDate ? job.window_end.toDate() : now;

    const stats = await syncWindow(db, { workspaceId, account, since, until, jobId: jobRef.id });

    await store.updateAccount(db, workspaceId, account.id, {
        last_sync_at: now,
        last_sync_status: 'ok',
        sync_health: 'healthy',
        status: 'connected',
    });
    return stats;
}

// Failure bookkeeping shared by worker + background: account health + error log.
async function noteJobFailure(db, { workspaceId, job, jobId, error, dead }) {
    const authError = error && error.code === 'auth';
    await store.writeSyncError(db, workspaceId, {
        accountId: job.account_id,
        jobId,
        code: authError ? 'auth' : (error && error.code) || 'sync_failed',
        message: error && error.message ? error.message : String(error),
    });
    await store.updateAccount(db, workspaceId, job.account_id, {
        last_sync_status: 'failed',
        sync_health: dead ? 'failing' : 'degraded',
        ...(authError ? { status: 'expired' } : {}),
    }).catch(() => {});
}

module.exports = { syncWindow, runSmallJob, noteJobFailure, fetchAll };
