'use strict';

// =============================================================================
// Commerce Integration Platform — token encryption + OAuth state signing
//
// AES-256-GCM at rest for marketplace OAuth tokens (Phase 0 review D1) and
// HMAC-signed state nonces for the connect redirect flow (D3). Node built-in
// crypto only — no dependencies.
//
// Ciphertext format:  v1:{key_version}:{iv_b64}:{tag_b64}:{ct_b64}
// Key source:         COMMERCE_TOKEN_KEY (base64, MUST decode to 32 bytes)
// Rotation:           encrypt always uses the active key (version 1 + presence
//                     of COMMERCE_TOKEN_KEY_PREVIOUS ⇒ active is version 2 and
//                     so on is overkill for now — we keep an explicit pair:
//                     active key = COMMERCE_TOKEN_KEY (version tag "a"),
//                     previous  = COMMERCE_TOKEN_KEY_PREVIOUS (version "p").
//                     decrypt() tries active first, then previous; the token
//                     manager re-encrypts with the active key on next write.
//
// NEVER log plaintext tokens or key material.
// =============================================================================

const crypto = require('crypto');
const { ENV } = require('./constants');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function _loadKey(envName, { required = true } = {}) {
    const raw = process.env[envName];
    if (!raw) {
        if (required) throw new Error(`${envName} is not set`);
        return null;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
        throw new Error(`${envName} must be base64 of exactly 32 bytes (got ${key.length})`);
    }
    return key;
}

// Encrypt a token string with the ACTIVE key.
function encryptToken(plaintext) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('encryptToken: plaintext must be a non-empty string');
    }
    const key = _loadKey(ENV.COMMERCE_TOKEN_KEY);
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:a:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Decrypt a stored ciphertext. Tries the active key, then the previous key
// (lazy rotation window). Returns { plaintext, keyVersion } — keyVersion 'p'
// means the caller should re-encrypt on its next write. Throws on tamper.
function decryptToken(ciphertext) {
    const parts = String(ciphertext || '').split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') {
        throw new Error('decryptToken: unrecognized ciphertext format');
    }
    const [, version, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');

    const candidates = [];
    const active = _loadKey(ENV.COMMERCE_TOKEN_KEY);
    const previous = _loadKey(ENV.COMMERCE_TOKEN_KEY_PREVIOUS, { required: false });
    // The stamped version is a hint, not a trust decision — GCM's auth tag is
    // what proves the right key. Try in stamped-version order.
    if (version === 'p' && previous) candidates.push(['p', previous], ['a', active]);
    else candidates.push(['a', active], ...(previous ? [['p', previous]] : []));

    let lastErr = null;
    for (const [keyVersion, key] of candidates) {
        try {
            const decipher = crypto.createDecipheriv(ALGO, key, iv);
            decipher.setAuthTag(tag);
            const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
            return { plaintext, keyVersion };
        } catch (e) {
            lastErr = e;
        }
    }
    throw new Error(`decryptToken: authentication failed${lastErr ? '' : ''}`);
}

// ---------------------------------------------------------------------------
// OAuth state: HMAC-SHA256-signed payload binding {uid, workspace, platform}
// to a single-use nonce with a TTL. Format: base64url(json).base64url(hmac).
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 15 * 60 * 1000;

function _stateSecret() {
    const secret = process.env[ENV.COMMERCE_STATE_SECRET];
    if (!secret) throw new Error(`${ENV.COMMERCE_STATE_SECRET} is not set`);
    return secret;
}

function _b64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function signState({ uid, workspaceId, platform }) {
    const payload = {
        uid,
        ws: workspaceId,
        platform,
        nonce: crypto.randomBytes(16).toString('hex'),
        iat: Date.now(),
    };
    const body = _b64url(JSON.stringify(payload));
    const mac = crypto.createHmac('sha256', _stateSecret()).update(body).digest();
    return { state: `${body}.${_b64url(mac)}`, nonce: payload.nonce };
}

// Returns { ok, payload?, reason? }. Does NOT check nonce single-use — the
// caller does that with a create()-tombstone (commerce.js callback).
function verifyState(state) {
    const parts = String(state || '').split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed' };
    const [body, macB64] = parts;
    const expected = crypto.createHmac('sha256', _stateSecret()).update(body).digest();
    let actual;
    try { actual = Buffer.from(macB64, 'base64url'); } catch (_) { return { ok: false, reason: 'malformed' }; }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        return { ok: false, reason: 'bad_signature' };
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) {
        return { ok: false, reason: 'malformed' };
    }
    if (!payload.uid || !payload.ws || !payload.platform || !payload.nonce || !payload.iat) {
        return { ok: false, reason: 'incomplete' };
    }
    if (Date.now() - payload.iat > STATE_TTL_MS) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
}

// Startup self-test (cheap): round-trip with the configured key so a bad key
// fails loudly at cold start instead of corrupting credentials mid-flow.
function selfTest() {
    const probe = 'fluxyos-selftest';
    const { plaintext } = decryptToken(encryptToken(probe));
    if (plaintext !== probe) throw new Error('commerce crypto self-test failed');
    return true;
}

module.exports = { encryptToken, decryptToken, signState, verifyState, selfTest, STATE_TTL_MS };
