'use strict';

// Trial extension, triggered from the Internal Operations Console
// (internal.html → Users → row "Extend Trial" menu). Extends a single user's
// trial by 1 week / 2 weeks / 1 month and records an internal audit entry.
//
// Why a server function: the canonical trial lives in the user-scoped doc
// users/{uid}/billing_subscription/current, whose writes require the signed-in
// owner (firestore.rules isOwner). The console is credential-gated, not signed
// in as the target user, so it cannot write that doc from the browser. This
// endpoint uses the Firebase Admin SDK (bypasses rules), mirroring the proven
// write set in scripts/extend-grace-trial.js.
//
// Auth: same MVP posture as send-lead-outreach — the console has no Firebase
// Auth, so this is gated by the shared INTERNAL_API_TOKEN passed in the
// `x-internal-token` header. NOT production-grade; move to a server-verified
// admin session with the rest of the console.
const admin = require('firebase-admin');

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED = ['https://fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];

// Extension durations offered by the console dropdown.
const DURATIONS = {
    '1w': { label: '1 week', apply: (d) => new Date(d.getTime() + 7 * DAY_MS) },
    '2w': { label: '2 weeks', apply: (d) => new Date(d.getTime() + 14 * DAY_MS) },
    '1m': { label: '1 month', apply: addOneMonth },
};

// Calendar month (mirrors addMonths in scripts/extend-grace-trial.js).
function addOneMonth(start) {
    const d = new Date(start.getTime());
    d.setMonth(d.getMonth() + 1);
    return d;
}

let _initialized = false;
function initAdmin() {
    if (!_initialized) {
        if (!admin.apps.length) {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
            if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
        }
        _initialized = true;
    }
    return admin.firestore();
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-internal-token',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    try {
        // --- Internal token gate ---
        const expected = process.env.INTERNAL_API_TOKEN;
        const got = (event.headers && (event.headers['x-internal-token'] || event.headers['X-Internal-Token'])) || '';
        if (!expected) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'token_not_configured' }) };
        if (got !== expected) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized' }) };

        // --- Validate input ---
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }
        const uid = str(body.uid, 160);
        const durationKey = str(body.duration, 8);
        const actorUsername = str(body.actor_username, 80) || 'fluxyos admin';
        if (!uid) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_uid' }) };
        const duration = DURATIONS[durationKey];
        if (!duration) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_duration' }) };

        const db = initAdmin();
        const { Timestamp, FieldValue } = admin.firestore;

        // --- Read canonical subscription; only live trials may be extended ---
        const subRef = db.doc(`users/${uid}/billing_subscription/current`);
        const snap = await subRef.get();
        const before = snap.exists ? snap.data() : null;
        if (!before || before.status !== 'trialing') {
            // Server-side guard: never extend a paid/active/expired/absent account,
            // even if the API is called directly. Mirrors the console UI gating.
            return {
                statusCode: 409,
                headers: cors,
                body: JSON.stringify({ error: 'not_trialing', status: before ? before.status : null }),
            };
        }

        // --- Compute new end additively: max(now, current end) + duration ---
        const now = new Date();
        const oldEndTs = before.trial_ends_at && typeof before.trial_ends_at.toDate === 'function'
            ? before.trial_ends_at : null;
        const oldEndDate = oldEndTs ? oldEndTs.toDate() : null;
        const base = oldEndDate && oldEndDate.getTime() > now.getTime() ? oldEndDate : now;
        const newEndDate = duration.apply(base);
        const newEndTs = Timestamp.fromDate(newEndDate);
        const daysRemaining = Math.ceil(Math.max(0, newEndTs.toMillis() - now.getTime()) / DAY_MS);
        const accessStatus = daysRemaining <= 1 ? 'trial_expiring' : 'trial_active';

        // --- Commit all writes atomically ---
        const batch = db.batch();

        // 1) Canonical owner subscription — source of truth for the trial guard.
        //    Keep the original trial_started_at; only push the end out.
        batch.set(subRef, {
            status: 'trialing',
            trial_ends_at: newEndTs,
            updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 2) Workspace plan summary members read (workspaceId == uid).
        batch.set(db.doc(`workspaces/${uid}`), {
            subscription_status: 'trialing',
            plan_synced_at: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 3) Internal ops-console access mirror (drives Access badge + Trial left).
        batch.set(db.doc(`internal_users/${uid}`), {
            access_status: accessStatus,
            trial_ends_at: newEndTs,
            trial_days_remaining: daysRemaining,
            updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 4) Audit trail — surfaced in the console's Audit tab.
        batch.set(db.collection('internal_audit_logs').doc(), {
            actor_uid: null,
            actor_username: actorUsername,
            actor_role: 'internal_admin',
            action: 'trial.extended',
            target_user_id: uid,
            before: { status: before.status, trial_ends_at: oldEndTs || null },
            after: { status: 'trialing', trial_ends_at: newEndTs },
            extension_duration: duration.label,
            reason: `Trial extended by ${duration.label} from the ops console`,
            source: 'internal_dashboard',
            created_at: FieldValue.serverTimestamp(),
        });

        await batch.commit();

        return {
            statusCode: 200,
            headers: cors,
            body: JSON.stringify({
                result: 'extended',
                trial_ends_at: newEndTs.toMillis(),
                trial_days_remaining: daysRemaining,
                access_status: accessStatus,
                extension_duration: duration.label,
            }),
        };
    } catch (e) {
        console.error('[extend-trial] failed:', e && e.message ? e.message : e);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: String(e && e.message ? e.message : 'server_error').slice(0, 160) }) };
    }
};
