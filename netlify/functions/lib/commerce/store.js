'use strict';

// =============================================================================
// Commerce Integration Platform — Admin-SDK storage layer
//
// Every write the pipeline makes goes through here: normalized commerce docs
// (idempotent upserts on deterministic ids), ledger transactions (create()
// fail-if-exists — the structural duplicate guard), account status, webhook
// logs, sync errors, audit logs. The Admin SDK bypasses firestore.rules; the
// rules keep CLIENTS read-only on all of it.
// See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D1, D2, §4).
// =============================================================================

const crypto = require('crypto');
const admin = require('firebase-admin');
const { accountId: makeAccountId, orderDocId, settlementDocId, AUDIT_SOURCE } = require('./constants');

const FV = () => admin.firestore.FieldValue;

function wsPath(workspaceId, collectionName) {
    return `workspaces/${workspaceId}/${collectionName}`;
}

function toTimestamp(v) {
    if (!v) return null;
    if (v instanceof Date) return admin.firestore.Timestamp.fromDate(v);
    if (typeof v === 'number') return admin.firestore.Timestamp.fromMillis(v);
    if (typeof v.toMillis === 'function') return v;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? admin.firestore.Timestamp.fromMillis(parsed) : null;
}

// ---------------------------------------------------------------- accounts

async function upsertAccount(db, workspaceId, account) {
    const id = makeAccountId(account.platform, account.shop_id);
    await db.doc(`${wsPath(workspaceId, 'commerce_accounts')}/${id}`).set({
        ...account,
        updated_at: FV().serverTimestamp(),
    }, { merge: true });
    return id;
}

async function updateAccount(db, workspaceId, accountId, patch) {
    await db.doc(`${wsPath(workspaceId, 'commerce_accounts')}/${accountId}`)
        .set({ ...patch, updated_at: FV().serverTimestamp() }, { merge: true });
}

async function getAccount(db, workspaceId, accountId) {
    const snap = await db.doc(`${wsPath(workspaceId, 'commerce_accounts')}/${accountId}`).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Webhook shop→workspace lookup (top-level, deny-all to clients).
async function setShopDirectory(db, { platform, shopId, workspaceId, accountId, status = 'connected' }) {
    await db.doc(`commerce_shop_directory/${makeAccountId(platform, shopId)}`).set({
        workspace_id: workspaceId,
        account_id: accountId,
        status,
        updated_at: FV().serverTimestamp(),
    }, { merge: true });
}

async function lookupShopDirectory(db, platform, shopId) {
    const snap = await db.doc(`commerce_shop_directory/${makeAccountId(platform, shopId)}`).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return data.status === 'connected' ? data : null;
}

// -------------------------------------------------- normalized commerce docs

// Upsert normalized docs on deterministic ids (update, never duplicate).
// Batched in chunks of 400 (Firestore batch cap 500).
async function upsertCommerceDocs(db, workspaceId, collectionName, docs, idFor) {
    let written = 0;
    for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach((docData) => {
            const ref = db.doc(`${wsPath(workspaceId, collectionName)}/${idFor(docData)}`);
            batch.set(ref, {
                ...docData,
                order_created_at: toTimestamp(docData.order_created_at),
                order_updated_at: toTimestamp(docData.order_updated_at),
                approved_at: toTimestamp(docData.approved_at),
                processed_at: toTimestamp(docData.processed_at),
                created_at: FV().serverTimestamp(),
                updated_at: FV().serverTimestamp(),
            }, { merge: true });
            written += 1;
        });
        await batch.commit();
    }
    return written;
}

const idForOrder = (o) => orderDocId(o.platform, o.shop_id, o.order_id);
const idForRefund = (r) => `${r.platform}_${r.shop_id}_rf_${r.refund_id}`;
const idForSettlement = (s) => settlementDocId(s.platform, s.shop_id, s.settlement_id);
const idForCommerceTx = (t) => `${t.platform}_${t.shop_id}_${t.order_id}`;

// -------------------------------------------------------------- ledger

// Write finance-mapped ledger entries with create() semantics: an entry id
// that already exists is skipped (retries / webhook-poll overlap can never
// duplicate a ledger transaction). Returns { created, skipped }.
async function writeLedgerEntries(db, workspaceId, entries) {
    let created = 0;
    let skipped = 0;
    for (const entry of entries) {
        const ref = db.doc(`${wsPath(workspaceId, 'transactions')}/${entry.id}`);
        const payload = {
            ...entry.data,
            timestamp: toTimestamp(entry.data.timestamp) || admin.firestore.Timestamp.now(),
            created_at: FV().serverTimestamp(),
        };
        // Firestore rejects undefined values — set only when present.
        if (entry.data.cash_effective_at) payload.cash_effective_at = toTimestamp(entry.data.cash_effective_at);
        try {
            await ref.create(payload);
            created += 1;
        } catch (e) {
            if (e.code === 6 /* ALREADY_EXISTS */) { skipped += 1; continue; }
            throw e;
        }
    }
    return { created, skipped };
}

// Stamp ledger linkage back onto the commerce transaction doc.
async function markCommerceTxLedger(db, workspaceId, commerceTxId, { status, refs }) {
    await db.doc(`${wsPath(workspaceId, 'commerce_transactions')}/${commerceTxId}`).set({
        ledger_status: status,
        ledger_refs: refs || null,
        updated_at: FV().serverTimestamp(),
    }, { merge: true });
}

// ---------------------------------------------------------- logs & errors

async function writeSyncError(db, workspaceId, { accountId, jobId, code, message }) {
    await db.collection(wsPath(workspaceId, 'commerce_sync_errors')).add({
        account_id: accountId || null,
        job_id: jobId || null,
        code: String(code || 'error').slice(0, 80),
        severity: 'error',
        message: String(message || '').slice(0, 500),
        created_at: FV().serverTimestamp(),
    });
}

// A missing OPTIONAL scope is a persistent configuration state, not a
// transient failure: it recurs on every sync until the seller enables that
// scope in the marketplace's partner console. Appending a new error doc each
// cycle would write ~288/day per account and bury genuine errors, so this
// uses a deterministic id — one row per (account, kind) that refreshes its
// last_seen_at — and mirrors the state onto the account as `degraded_scopes`
// so the UI can render an actionable notice instead of a wall of red.
async function recordScopeGap(db, workspaceId, { accountId, jobId, kind, message }) {
    const ref = db.doc(`${wsPath(workspaceId, 'commerce_sync_errors')}/scope_${accountId}_${kind}`);
    const payload = {
        account_id: accountId,
        job_id: jobId || null,
        code: `scope_missing_${kind}`,
        severity: 'degraded',
        kind,
        message: String(message || '').slice(0, 500),
        last_seen_at: FV().serverTimestamp(),
    };
    try {
        // create() keeps the ORIGINAL created_at across refreshes, so the
        // drawer can show how long the gap has existed.
        await ref.create({ ...payload, created_at: FV().serverTimestamp() });
    } catch (e) {
        if (e.code !== 6 /* ALREADY_EXISTS */) throw e;
        await ref.update(payload);
    }
    await updateAccount(db, workspaceId, accountId, {
        degraded_scopes: admin.firestore.FieldValue.arrayUnion(kind),
    });
}

// Self-heal: the seller enabled the scope and the fetch now works, so drop
// the notice. Callers only invoke this when the account actually lists the
// kind as degraded, so the happy path costs zero extra writes.
async function clearScopeGap(db, workspaceId, accountId, kind) {
    await db.doc(`${wsPath(workspaceId, 'commerce_sync_errors')}/scope_${accountId}_${kind}`)
        .delete()
        .catch(() => {});
    await updateAccount(db, workspaceId, accountId, {
        degraded_scopes: admin.firestore.FieldValue.arrayRemove(kind),
    });
}

// Webhook delivery log with a deterministic id (platform event id when the
// connector surfaces one, else a body hash) — redeliveries dedupe via create().
async function logWebhook(db, workspaceId, { platform, shopId, eventType, eventId, rawBody, signatureValid, jobId }) {
    const id = eventId
        ? `${platform}_${String(eventId).slice(0, 80)}`
        : `${platform}_${crypto.createHash('sha256').update(rawBody || '').digest('hex').slice(0, 32)}`;
    const ref = db.doc(`${wsPath(workspaceId, 'commerce_webhook_logs')}/${id}`);
    try {
        await ref.create({
            platform,
            shop_id: shopId || null,
            event_type: eventType || null,
            signature_valid: signatureValid !== false,
            job_id: jobId || null,
            received_at: FV().serverTimestamp(),
        });
        return { duplicate: false, id };
    } catch (e) {
        if (e.code === 6 /* ALREADY_EXISTS */) return { duplicate: true, id };
        throw e;
    }
}

// Workspace audit log (schema per isValidWorkspaceAuditLog; source 'integration').
async function writeAudit(db, workspaceId, { actorUid, action, targetCollection, targetId, after }) {
    await db.collection(wsPath(workspaceId, 'audit_logs')).add({
        actor_uid: actorUid || 'system',
        actor_role: null,
        action,
        target_collection: targetCollection,
        target_id: String(targetId || '').slice(0, 200),
        before: null,
        after: after || null,
        reason: null,
        source: AUDIT_SOURCE,
        created_at: FV().serverTimestamp(),
    }).catch((e) => console.warn('[commerce audit] skipped', e.message));
}

module.exports = {
    wsPath,
    toTimestamp,
    upsertAccount,
    updateAccount,
    getAccount,
    setShopDirectory,
    lookupShopDirectory,
    upsertCommerceDocs,
    idForOrder,
    idForRefund,
    idForSettlement,
    idForCommerceTx,
    writeLedgerEntries,
    markCommerceTxLedger,
    writeSyncError,
    recordScopeGap,
    clearScopeGap,
    logWebhook,
    writeAudit,
};
