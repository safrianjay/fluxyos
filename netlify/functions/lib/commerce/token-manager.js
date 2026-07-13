'use strict';

// =============================================================================
// Commerce Integration Platform — token manager
//
// Owns the commerce_credentials lifecycle: store at connect, hand a valid
// plaintext access token to the sync pipeline, refresh serialized behind a
// Firestore-transaction lock (Shopee's refresh tokens are SINGLE-USE and both
// tokens rotate — a concurrent refresh corrupts the chain), delete at
// disconnect. Plaintext tokens exist only in memory here; never stored
// decrypted, never logged, never returned by any HTTP endpoint.
// See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D1).
// =============================================================================

const admin = require('firebase-admin');
const { encryptToken, decryptToken } = require('./crypto');
const { credentialsDocId } = require('./constants');

const REFRESH_AHEAD_MS = 10 * 60 * 1000;   // refresh when <10 min of life left
const REFRESH_LOCK_MS = 60 * 1000;         // stale-lock takeover after 60s

function credRef(db, workspaceId, platform, shopId) {
    return db.collection('commerce_credentials').doc(credentialsDocId(workspaceId, platform, shopId));
}

// Persist freshly-issued tokens (connect or refresh). `tokens` comes from a
// connector's completeAuth/refreshTokens: { accessToken, refreshToken|null,
// accessExpiresAt (ms|Date|null), refreshExpiresAt (ms|Date|null) }.
function encryptedTokenFields(tokens) {
    const fields = {
        access_token_enc: encryptToken(tokens.accessToken),
        access_expires_at: toTimestamp(tokens.accessExpiresAt),
        refresh_expires_at: toTimestamp(tokens.refreshExpiresAt),
        key_version: 'a',
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Tokopedia has no refresh token (re-mint via client credentials).
    fields.refresh_token_enc = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
    return fields;
}

function toTimestamp(v) {
    if (!v) return null;
    if (v instanceof Date) return admin.firestore.Timestamp.fromDate(v);
    if (typeof v === 'number') return admin.firestore.Timestamp.fromMillis(v);
    if (typeof v.toMillis === 'function') return v;
    return null;
}

async function storeCredentials(db, { workspaceId, accountId, platform, shopId, tokens, platformMeta }) {
    await credRef(db, workspaceId, platform, shopId).set({
        workspace_id: workspaceId,
        account_id: accountId,
        platform,
        shop_id: shopId,
        platform_meta: platformMeta || {},
        refresh_lock_at: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        ...encryptedTokenFields(tokens),
    }, { merge: true });
}

async function deleteCredentials(db, { workspaceId, platform, shopId }) {
    await credRef(db, workspaceId, platform, shopId).delete();
}

// Decrypt the stored credential doc into the shape connectors consume. The
// plaintext lives only in the returned object.
function decryptCredentials(data) {
    const access = data.access_token_enc ? decryptToken(data.access_token_enc) : null;
    const refresh = data.refresh_token_enc ? decryptToken(data.refresh_token_enc) : null;
    return {
        accessToken: access ? access.plaintext : null,
        refreshToken: refresh ? refresh.plaintext : null,
        accessExpiresAt: data.access_expires_at ? data.access_expires_at.toMillis() : null,
        refreshExpiresAt: data.refresh_expires_at ? data.refresh_expires_at.toMillis() : null,
        platform: data.platform,
        shopId: data.shop_id,
        platformMeta: data.platform_meta || {},
        // 'p' on either token ⇒ encrypted with the previous key; re-encrypt on
        // the next write (lazy rotation).
        needsReencrypt: (access && access.keyVersion === 'p') || (refresh && refresh.keyVersion === 'p'),
    };
}

// Hand back a credentials object with a valid access token, refreshing first
// when it expires within REFRESH_AHEAD_MS. The refresh itself is serialized:
// a transaction claims `refresh_lock_at`; the loser of the race waits and
// re-reads. Errors classified: { code: 'auth' } means the refresh token is
// dead → caller marks the account expired and stops retrying.
async function getValidCredentials(db, { workspaceId, platform, shopId, connector, now = Date.now() }) {
    const ref = credRef(db, workspaceId, platform, shopId);
    const snap = await ref.get();
    if (!snap.exists) {
        const err = new Error('credentials not found');
        err.code = 'auth';
        throw err;
    }
    let creds = decryptCredentials(snap.data());

    const fresh = creds.accessExpiresAt === null || creds.accessExpiresAt - now > REFRESH_AHEAD_MS;
    if (fresh) {
        if (creds.needsReencrypt) await _reencrypt(ref, creds);
        return creds;
    }

    // Claim the refresh lock inside a transaction.
    const claimed = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists) return false;
        const lockAt = cur.get('refresh_lock_at');
        if (lockAt && now - lockAt.toMillis() < REFRESH_LOCK_MS) return false; // someone else is refreshing
        tx.update(ref, { refresh_lock_at: admin.firestore.Timestamp.fromMillis(now) });
        return true;
    });

    if (!claimed) {
        // Another worker is refreshing; brief wait then re-read.
        await new Promise((r) => setTimeout(r, 2000));
        const again = await ref.get();
        if (!again.exists) { const e = new Error('credentials deleted during refresh'); e.code = 'auth'; throw e; }
        return decryptCredentials(again.data());
    }

    try {
        const tokens = await connector.refreshTokens({ credentials: creds });
        await ref.update({ ...encryptedTokenFields(tokens), refresh_lock_at: null });
        return {
            ...creds,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || creds.refreshToken,
            accessExpiresAt: tokens.accessExpiresAt ? Number(new Date(tokens.accessExpiresAt)) : null,
            needsReencrypt: false,
        };
    } catch (e) {
        await ref.update({ refresh_lock_at: null }).catch(() => {});
        // Connectors throw { code: 'auth' } for invalid_grant-class failures.
        if (!e.code) e.code = 'refresh_failed';
        throw e;
    }
}

async function _reencrypt(ref, creds) {
    try {
        await ref.update(encryptedTokenFields({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            accessExpiresAt: creds.accessExpiresAt,
            refreshExpiresAt: creds.refreshExpiresAt,
        }));
    } catch (_) { /* best-effort; next writer retries */ }
}

// Sweep helper for the worker's refresh pass: credentials expiring soon.
async function listExpiringCredentials(db, { withinMs = 30 * 60 * 1000, limit = 20, now = Date.now() } = {}) {
    const cutoff = admin.firestore.Timestamp.fromMillis(now + withinMs);
    const snap = await db.collection('commerce_credentials')
        .where('access_expires_at', '<=', cutoff)
        .limit(limit)
        .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
    credRef,
    storeCredentials,
    deleteCredentials,
    decryptCredentials,
    getValidCredentials,
    listExpiringCredentials,
    REFRESH_AHEAD_MS,
};
