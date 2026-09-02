'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');
const { consume, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');

// =============================================================================
// FluxyOS — the menu a QR customer sees. Public, unauthenticated, read-only.
//
//     GET /.netlify/functions/qr-menu?token=<tableToken>
//
// THE CUSTOMER PAGE NEVER TOUCHES FIRESTORE. That is the whole design
// (`POS_IMPLEMENTATION_PLAN.md` §4: *"static page, no Firebase SDK at all"*),
// and it is not a performance choice — a browser holding a Firestore handle
// needs rules that admit an anonymous reader to a workspace's collections, and
// there is no such rule that stays narrow. Every question the page has is
// answered here instead, so the customer surface costs **zero rules budget**.
//
// WHAT IS DELIBERATELY NOT RETURNED, because a customer must never receive it:
// cost, margin, on-hand stock, supplier, SKU, the workspace id, the table id,
// or any item that is not on the menu. The response is the smallest thing that
// can render a menu.
//
// PRICE IS AUTHORITATIVE HERE, not in the browser (§29). The page displays what
// this returns; when an order endpoint exists it must re-read the price from
// `items.sales_price` again rather than trusting what it is sent back. This
// response is for rendering, never for arithmetic that reaches money.
// =============================================================================

const admin = require('firebase-admin');

// A menu is fetched once per page load, not once per tile, so this can afford
// the dimension an image cannot: a per-IP burst AND a per-token daily cap.
const TOKEN_DAILY_LIMIT = 2000;
const DAY_SECONDS = 24 * 60 * 60;
const IP_BURST_LIMIT = 60;
const IP_BURST_SECONDS = 60;

// Long enough that a customer scrolling a menu is not re-fetching it, short
// enough that a price change or a sold-out item reaches the table within a
// couple of minutes.
const CACHE_SECONDS = 60;

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

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

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': allowOriginHeader(origin),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    const token = String((event.queryStringParameters || {}).token || '');
    // One shape of refusal, so a stranger cannot learn from the difference
    // between two errors whether a token exists.
    const notFound = {
        statusCode: 404,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'not_found' })
    };
    if (!SAFE.test(token)) return notFound;

    try {
        const db = initAdmin().firestore();

        const burst = await consume(db, {
            key: ipKey(clientIp(event.headers || {})),
            limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
        });
        if (!burst.allowed) return tooManyRequests(burst, cors);
        const daily = await consume(db, {
            key: `menu_${token}`, limit: TOKEN_DAILY_LIMIT, windowSeconds: DAY_SECONDS
        });
        if (!daily.allowed) return tooManyRequests(daily, cors);

        const dirSnap = await db.doc(`pos_table_directory/${token}`).get();
        if (!dirSnap.exists) return notFound;
        const dir = dirSnap.data() || {};
        // A revoked token is a printed card that must stop working — the table
        // was archived, or the token rotated. See sync-pos-table-directory.js.
        if (dir.revoked === true) return notFound;
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return notFound;

        const [wsSnap, tableSnap, itemsSnap] = await Promise.all([
            db.doc(`workspaces/${workspaceId}`).get(),
            db.doc(`workspaces/${workspaceId}/pos_tables/${tableId}`).get(),
            db.collection(`workspaces/${workspaceId}/items`).where('pos_visible', '==', true).get()
        ]);
        if (!tableSnap.exists) return notFound;
        const table = tableSnap.data() || {};
        // An archived table's card should already have been revoked, but the
        // directory is a projection and a stale one must not seat anybody.
        if (table.status === 'archived') return notFound;

        const ws = wsSnap.exists ? (wsSnap.data() || {}) : {};
        // The outlet, not the workspace, is what a diner recognises — they are
        // sitting in one branch, not in a company.
        let outletName = ws.name || 'Menu';
        if (table.dimension_id) {
            const dim = await db.doc(`workspaces/${workspaceId}/dimensions/${table.dimension_id}`).get();
            if (dim.exists && dim.data().name) outletName = dim.data().name;
        }

        const items = [];
        itemsSnap.forEach((d) => {
            const i = d.data() || {};
            const price = Number(i.sales_price);
            // The same two conditions `getPosMenu` applies. An item marked
            // visible with no price is a button that cannot be rung up.
            if (!Number.isInteger(price) || price <= 0) return;
            if (i.status === 'archived') return;
            items.push({
                id: d.id,
                name: String(i.name || '').slice(0, 120),
                // `pos_category` IS the taxonomy — a free string on the item,
                // the same one the till builds its chips from. There is no
                // category entity and the customer menu must not invent a
                // second one (docs/CUSTOMER_ORDERING_PLAN_REVIEW.md §2.1).
                category: i.pos_category ? String(i.pos_category).slice(0, 40) : null,
                price,
                // Whether a photo EXISTS, never where it lives. The page asks
                // qr-menu-image for the bytes, so no storage path reaches a
                // customer and no public URL is ever minted.
                has_image: typeof i.image_path === 'string' && !!i.image_path,
                // Options the customer chooses, with their price deltas. What
                // each option CONSUMES is deliberately stripped — that is stock
                // and cost, and none of a diner's business.
                modifier_groups: (Array.isArray(i.pos_modifier_groups) ? i.pos_modifier_groups : [])
                    .slice(0, 10)
                    .map((g) => ({
                        id: String(g.id || ''),
                        name: String(g.name || '').slice(0, 40),
                        select: ['one_required', 'one_optional', 'many'].includes(g.select)
                            ? g.select : 'one_optional',
                        options: (Array.isArray(g.options) ? g.options : []).slice(0, 20).map((o) => ({
                            id: String(o.id || ''),
                            name: String(o.name || '').slice(0, 40),
                            price_delta: Math.round(Number(o.price_delta) || 0)
                        })).filter((o) => o.id && o.name)
                    }))
                    .filter((g) => g.name && g.options.length)
            });
        });

        // Sorted here rather than in the page, so every client agrees and the
        // order survives a page that forgets to sort.
        items.sort((a, b) => String(a.category || '￿').localeCompare(String(b.category || '￿'))
            || a.name.localeCompare(b.name));

        return {
            statusCode: 200,
            headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
            body: JSON.stringify({
                outlet: outletName,
                table: String(table.label || '').slice(0, 40),
                // The page renders every amount through FluxyMoney, which needs
                // the workspace's own currency or a peso menu prints rupiah.
                currency: ['IDR', 'PHP', 'SGD', 'MYR'].includes(ws.base_currency) ? ws.base_currency : 'IDR',
                categories: [...new Set(items.map((i) => i.category).filter(Boolean))],
                items
            })
        };
    } catch (err) {
        console.error('[qr-menu]', err && err.message);
        return notFound;
    }
};
