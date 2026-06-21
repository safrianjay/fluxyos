'use strict';

// Workspace team-invitation email. Fired by settings-team.html when an owner/admin
// invites a teammate. The invite DOC (workspaces/{wsId}/invites/{email}) is the
// source of truth and is written client-side under Firestore rules; this function
// only DELIVERS the notification email.
//
// Auth: verifies the caller's Firebase ID token and confirms — via the Admin SDK —
// that the caller is an active owner/admin of the target workspace, and that the
// invite doc actually exists and is pending. Defense in depth on top of the rules.
//
// Sender: hello@fluxyos.com (reply-friendly, 1:1 transactional) — NOT the
// notifications@ mailbox and NOT the paused notify sweep. Gated by its own
// default-off kill switch TEAM_INVITES_ENABLED so it can never blast.
const admin = require('firebase-admin');
const { Resend } = require('resend');
const { initAdmin } = require('./lib/notify-core');
const { buildEmail } = require('../../functions/lib/templates');

const EMAIL_FROM = 'FluxyOS <hello@fluxyos.com>';
const REPLY_TO = 'hello@fluxyos.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const ALLOWED = ['https://fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];

const ROLE_LABELS = { admin: 'Admin', finance: 'Finance', viewer: 'Viewer' };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://fluxyos.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    // Default-off kill switch. Soft-fail (200) so the client treats it as "invite
    // saved, email skipped" rather than an error — the invite doc still exists.
    if (process.env.TEAM_INVITES_ENABLED !== 'true') {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'disabled' }) };
    }

    try {
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'missing token' }) };

        const db = initAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const callerUid = decoded.uid;

        const body = JSON.parse(event.body || '{}');
        const workspaceId = str(body.workspaceId, 200);
        const email = str(body.email || body.inviteId, 200).toLowerCase();
        const role = str(body.role, 20);
        const inviterName = str(body.inviterName, 160) || decoded.name || decoded.email || 'A FluxyOS workspace owner';
        const workspaceName = str(body.workspaceName, 120) || null;

        if (!workspaceId || !email || !isEmail(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_input' }) };
        if (!ROLE_LABELS[role]) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid_role' }) };

        // Authorize: caller must be an active owner/admin of this workspace.
        const callerSnap = await db.doc(`workspaces/${workspaceId}/members/${callerUid}`).get();
        if (!callerSnap.exists) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'not_a_member' }) };
        const caller = callerSnap.data() || {};
        if (caller.status !== 'active' || !['owner', 'admin'].includes(caller.role)) {
            return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'forbidden' }) };
        }

        // The invite must exist and still be pending.
        const inviteSnap = await db.doc(`workspaces/${workspaceId}/invites/${email}`).get();
        if (!inviteSnap.exists || (inviteSnap.data() || {}).status !== 'pending') {
            return { statusCode: 409, headers: cors, body: JSON.stringify({ error: 'invite_not_pending' }) };
        }

        if (!process.env.RESEND_API_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: 'email_not_configured' }) };

        const acceptUrl = `${APP_BASE_URL}/login?invite=${encodeURIComponent(email)}&ws=${encodeURIComponent(workspaceId)}`;
        const { subject, html, text } = buildEmail('team_invite', 'id', {
            inviterName, workspaceName, role, roleLabel: ROLE_LABELS[role], acceptUrl, baseUrl: APP_BASE_URL,
        });

        const resend = new Resend(process.env.RESEND_API_KEY);
        const res = await resend.emails.send({ from: EMAIL_FROM, to: email, reply_to: REPLY_TO, subject, html, text });
        if (res && res.error) throw new Error(res.error.message || 'Resend send error');

        return { statusCode: 200, headers: cors, body: JSON.stringify({ result: 'sent', id: (res && res.data && res.data.id) || null }) };
    } catch (e) {
        console.error('[send-team-invite] failed:', e && e.message ? e.message : e);
        // Soft-fail so the client keeps the invite doc and can re-send later.
        return { statusCode: 200, headers: cors, body: JSON.stringify({ error: String(e && e.message ? e.message : 'server_error').slice(0, 160) }) };
    }
};
