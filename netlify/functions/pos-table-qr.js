'use strict';

const admin = require('firebase-admin');
const QRCode = require('qrcode');
const { allowOriginHeader } = require('./lib/allowed-origins');
const { withLogo, logoPercent, LOGO_ECC } = require('./lib/qr-logo');

// =============================================================================
// FluxyOS — the QR codes a restaurant prints and puts on its tables.
//
//     POST /.netlify/functions/pos-table-qr
//     Authorization: Bearer <Firebase ID token>
//     { workspaceId, tableIds?: [...] }   // omit tableIds for every table
//
// WHY THIS EXISTS. `pos_tables.qr_token` has been minted on table creation
// since the POS shipped, and `pos_table_directory` resolves it, and
// `order.html` renders the menu it points at — but nothing in the product ever
// DISPLAYED it. The whole customer-ordering feature was complete and
// unreachable: there was no way for a restaurant to obtain the link, let alone
// a card for the table.
//
// WHY SERVER-SIDE. The browser already knows the token, so this is not about
// secrecy. It is about not vendoring a QR encoder: the CSP allows scripts only
// from 'self' plus four Google hosts, so a client-side encoder means committing
// a library into assets/ and owning its correctness forever. `qrcode` is
// already a dependency here, already used by `scripts/make-qr.js`, and the
// output of THIS function is decoded back by Apple's Vision framework in
// `tests/pos-table-qr.check.js` — by a different implementation than the one
// that wrote it, which is the only round trip that proves a phone can read it.
//
// ⚠️ A QR IS THE ONE ARTEFACT WHOSE FAILURE IS TOTAL AND INVISIBLE. It looks
// exactly like a QR code and it does not scan. On a laminated card, in front of
// customers, with no error anywhere. Everything here is arranged around that.
// =============================================================================

// The origin the printed card points at. Deliberately NOT derived from the
// request: a card printed from a deploy preview must still send diners to
// production, and the alternative is a laminated sheet pointing at a URL that
// stopped existing when the preview expired.
const ORDER_ORIGIN = process.env.ORDER_BASE_URL || 'https://order.fluxyos.com';

// ERROR CORRECTION H (30%), because the card carries the F-logo.
//
// This was Q while the card had no logo. A centre knockout DELETES DATA, and
// the only reason the symbol still reads is Reed-Solomon recovery — so a logo
// forces H, the same reasoning `scripts/make-qr.js` applies to the event
// poster. Q survived a clean 600px raster in testing, but that proves nothing
// about margin left over: the knockout has already spent part of the budget
// that is supposed to absorb glare, smudges and a worn corner on a laminated
// card. Measured with Apple's Vision framework, M+logo failed outright.
//
// H'S ONLY COST IS MODULE DENSITY, AND IT IS CANCELLED IN THE PRINT SIZE. For a
// real 43-char token H is 49x49 (plus the 4-module quiet zone each side = 57).
// At the old 40mm card that would be 0.70mm per module; the card is 47mm
// instead, which puts it back at 0.82mm — identical scan geometry to the
// logo-less Q version, with 30% recovery and the logo on top. See CARD_MM.
const ECC = LOGO_ECC;

// The printed width of the symbol, in millimetres, mirrored by `.pos-qr-img` in
// pos.html and asserted in tests/pos-table-qr.spec.js. Shrink it and every card
// silently becomes harder to scan; nothing else in the system would notice.
const CARD_MM = 47;

// Spec-minimum quiet zone. Below 4 modules, scanners struggle.
const MARGIN = 4;

const MAX_TABLES = 200;

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
    return admin;
}

// The roles holding `pos.manage` in perms-service.js — tables, outlets, menu
// pricing and visibility. A CASHIER IS DELIBERATELY NOT HERE: they operate the
// till, they do not re-lay the room or print its cards. Mirrored by hand
// because perms-service.js is an ES module the functions runtime cannot import.
const MAY_MANAGE = ['owner', 'admin', 'finance', 'accountant'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The URL a diner's camera resolves. `/t/<token>` is the printed form. */
function cardUrl(token) {
    return `${ORDER_ORIGIN}/t/${token}`;
}

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': allowOriginHeader(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    const json = (statusCode, body) => ({
        statusCode,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    });

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

    try {
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!idToken) return json(401, { error: 'missing_token' });

        const sdk = initAdmin();
        const db = sdk.firestore();
        const decoded = await admin.auth().verifyIdToken(idToken);
        const callerUid = decoded.uid;

        let body;
        try { body = JSON.parse(event.body || '{}'); }
        catch (_) { return json(400, { error: 'invalid_json' }); }

        const workspaceId = str(body.workspaceId, 200);
        if (!workspaceId) return json(400, { error: 'workspaceId_required' });

        // Authorize against the workspace's own member record — never against a
        // role the client claims. Same posture as send-team-invite.js.
        const memberSnap = await db.doc(`workspaces/${workspaceId}/members/${callerUid}`).get();
        if (!memberSnap.exists) return json(403, { error: 'not_a_member' });
        const member = memberSnap.data() || {};
        if (member.status !== 'active' || !MAY_MANAGE.includes(member.role)) {
            return json(403, { error: 'forbidden' });
        }

        const wanted = Array.isArray(body.tableIds)
            ? body.tableIds.map((t) => str(t, 200)).filter(Boolean).slice(0, MAX_TABLES)
            : null;

        const snap = await db.collection(`workspaces/${workspaceId}/pos_tables`).get();
        const tables = [];
        snap.forEach((d) => {
            const t = d.data() || {};
            // An archived table's card should not be reprinted — the token is
            // revoked in the directory and the card would resolve to nothing.
            if (t.status === 'archived') return;
            if (wanted && !wanted.includes(d.id)) return;
            if (typeof t.qr_token !== 'string' || !t.qr_token) return;
            tables.push({ id: d.id, ...t });
        });

        if (!tables.length) return json(200, { cards: [], missing_token: 0 });

        // Tables created before `qr_token` existed carry none. They are counted
        // and reported rather than silently omitted: a print sheet that is
        // quietly short by two cards is worse than one that says so.
        const total = wanted ? wanted.length : snap.size;

        tables.sort((a, b) => String(a.zone || '').localeCompare(String(b.zone || ''))
            || String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true }));

        const cards = [];
        for (const t of tables) {
            const url = cardUrl(t.qr_token);
            // Throws on anything the encoder cannot represent, BEFORE any SVG
            // is produced — so a bad token is an error here rather than a card
            // that prints and does not scan.
            QRCode.create(url, { errorCorrectionLevel: ECC });
            const svg = withLogo(await QRCode.toString(url, {
                type: 'svg',
                errorCorrectionLevel: ECC,
                margin: MARGIN,
                color: { dark: '#0B0F19', light: '#FFFFFF' }
            }));
            cards.push({
                table_id: t.id,
                label: str(t.label, 40),
                zone: t.zone ? str(t.zone, 40) : null,
                url,
                svg
            });
        }

        return json(200, {
            cards,
            // How many tables were asked about but have no card. The UI says so.
            missing_token: Math.max(0, total - cards.length),
            error_correction: ECC,
            card_mm: CARD_MM
        });
    } catch (err) {
        const code = err && err.code;
        if (typeof code === 'string' && code.startsWith('auth/')) {
            return json(401, { error: 'invalid_token' });
        }
        console.error('[pos-table-qr]', err && err.message);
        return json(500, { error: 'server_error' });
    }
};

// Exported for `tests/pos-table-qr.check.js`, which encodes a card with these
// exact constants, rasterises the SVG and decodes it back with Apple's Vision
// framework. Testing a COPY of these values would prove only that the copy
// agrees with itself — the point is to verify what actually ships.
exports.__test = { cardUrl, ECC, MARGIN, ORDER_ORIGIN, MAY_MANAGE, CARD_MM, withLogo, logoPercent };
