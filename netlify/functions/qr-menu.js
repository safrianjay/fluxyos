'use strict';

const { allowOriginHeader } = require('./lib/allowed-origins');
// The same file the till and qr-order run. A cart that totals differently
// from the order it becomes is a customer told one number and charged
// another — which is the whole reason this module is shared rather than
// reimplemented per surface.
const pricing = require('../../assets/js/pos-pricing.js');
const { consumeApprox, ipKey, clientIp, tooManyRequests } = require('./lib/rate-limit');
const { createCache, directoryEntry } = require('./lib/warm-cache');
const { isWarmup, warmup } = require('./lib/warmup');

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

// ── Remembered between diners (docs/perf/S1_BASELINE_2026-09-11.md, F2) ────
//
// Each Firestore read from this function crosses the Pacific (~200 ms), and
// this endpoint made eight of them in a row: 2.9 s of server time before a
// diner saw anything. Every table of an outlet shares one menu, so a warm
// instance answers the second table's scan from memory.
//
// Staleness budget: 30 s in memory, then up to CACHE_SECONDS in a browser or
// at Netlify's edge — ninety seconds end to end, inside the "couple of
// minutes" promised above for a price change or a sold-out dish.
const MEMO_MS = 30 * 1000;
const outletCache = createCache({ ttlMs: MEMO_MS, max: 500 });
const tableCache = createCache({ ttlMs: MEMO_MS, max: 5000 });

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

/**
 * The diner-facing items, projected and sorted. The same two gates
 * `getPosMenu` applies, and nothing a customer must not receive.
 */
function projectItems(itemsSnap) {
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
            // ⚠️ THE SECOND WHITELIST. `getPosMenu` has one for the till and
            // this one serves the diner; a field added to only one of them
            // works on one surface and silently does nothing on the other.
            recommended: i.pos_recommended === true,
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
    return items;
}

/**
 * Everything about an outlet a menu needs, in ONE round trip: the workspace
 * (currency, country, fallback name), the outlet's own name, its settings, and
 * the visible items. Nothing here depends on the table, so every table of the
 * outlet shares the answer.
 */
async function loadOutlet(db, workspaceId, dimensionId) {
    const docs = [db.doc(`workspaces/${workspaceId}`)];
    if (dimensionId) docs.push(db.doc(`workspaces/${workspaceId}/dimensions/${dimensionId}`));
    const [snaps, itemsSnap, cfg] = await Promise.all([
        db.getAll(...docs),
        db.collection(`workspaces/${workspaceId}/items`).where('pos_visible', '==', true).get(),
        // Best-effort, on its own: a menu is what a hungry person is waiting
        // for, and failing it because a configuration document could not be
        // read would be the wrong trade at a table. Settings are keyed BY the
        // outlet, and a table without one has no rates to apply.
        dimensionId
            ? db.doc(`workspaces/${workspaceId}/pos_outlet_settings/${dimensionId}`).get().catch((e) => {
                console.warn('[qr-menu] outlet settings unreadable; menu prices at zero rates', e && e.message);
                return null;
            })
            : Promise.resolve(null)
    ]);
    const ws = snaps[0].exists ? (snaps[0].data() || {}) : {};
    // The outlet, not the workspace, is what a diner recognises — they are
    // sitting in one branch, not in a company.
    let outletName = ws.name || 'Menu';
    if (snaps[1] && snaps[1].exists && snaps[1].data().name) outletName = snaps[1].data().name;

    let outletPricing = pricing.normalizeSettings(null);
    let hasCover = false;
    // What the hero card states about the place itself. Every field is
    // optional and the card drops the control it belongs to when it is
    // missing — a Call button on an outlet with no number is an affordance
    // that lies (DESIGN_SYSTEM 3c).
    let outletInfo = { address: null, phone: null, hours: [] };
    if (cfg && cfg.exists) {
        const data = cfg.data() || {};
        outletPricing = pricing.normalizeSettings(data);
        hasCover = typeof data.cover_image_path === 'string' && !!data.cover_image_path;
        outletInfo = {
            address: typeof data.address === 'string' ? data.address.slice(0, 200) : null,
            phone: typeof data.phone === 'string' ? data.phone.slice(0, 32) : null,
            // Wall-clock strings, exactly as the owner typed them. NOT
            // resolved to "open now" here: the diner is sitting in the
            // restaurant, so their own device clock IS the outlet's local
            // time, and computing it server-side would mean carrying a
            // timezone this endpoint has no better source for.
            hours: Array.isArray(data.hours) ? data.hours.slice(0, 7) : []
        };
    }
    return {
        outletName,
        currency: ['IDR', 'PHP', 'SGD', 'MYR'].includes(ws.base_currency) ? ws.base_currency : 'IDR',
        country: ['ID', 'PH', 'SG', 'MY'].includes(ws.country) ? ws.country : null,
        pricing: outletPricing,
        hasCover,
        outletInfo,
        items: projectItems(itemsSnap)
    };
}

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': allowOriginHeader(origin),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    // Kept warm by the scheduled `qr-warm` — see lib/warmup.js. Before the method
    // check, so the POST endpoints can be warmed with a GET.
    if (isWarmup(event)) return warmup(() => initAdmin().firestore(), cors);
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

    const t0 = Date.now();
    try {
        const db = initAdmin().firestore();

        // ⚠️ ONE ROUND TRIP, NOT FOUR. The two limits and the token lookup do
        // not depend on each other, so they run together — each of them used
        // to wait for the one before it, at ~200 ms a leg. `consumeApprox`
        // rather than a transaction: see its note in lib/rate-limit.js.
        const [burst, daily, dir] = await Promise.all([
            consumeApprox(db, {
                key: ipKey(clientIp(event.headers || {}), 'menu'),
                limit: IP_BURST_LIMIT, windowSeconds: IP_BURST_SECONDS
            }),
            consumeApprox(db, {
                key: `menu_${token}`, limit: TOKEN_DAILY_LIMIT, windowSeconds: DAY_SECONDS
            }),
            directoryEntry(db, token)
        ]);
        const tLimits = Date.now();
        if (!burst.allowed) return tooManyRequests(burst, cors);
        if (!daily.allowed) return tooManyRequests(daily, cors);

        // A revoked token is a printed card that must stop working — the table
        // was archived, or the token rotated. See sync-pos-table-directory.js.
        if (!dir || dir.revoked) return notFound;
        const workspaceId = dir.workspace_id;
        const tableId = dir.table_id;
        if (!workspaceId || !tableId) return notFound;

        // The table and its outlet TOGETHER. The directory already names the
        // outlet, so nothing waits on the table document to learn it.
        const [table, guessed] = await Promise.all([
            tableCache.get(`${workspaceId}/${tableId}`, async () => {
                const snap = await db.doc(`workspaces/${workspaceId}/pos_tables/${tableId}`).get();
                return snap.exists ? (snap.data() || {}) : null;
            }),
            outletCache.get(`${workspaceId}/${dir.dimension_id || ''}`,
                () => loadOutlet(db, workspaceId, dir.dimension_id || null))
        ]);
        if (!table) return notFound;
        // An archived table's card should already have been revoked, but the
        // directory is a projection and a stale one must not seat anybody.
        if (table.status === 'archived') return notFound;

        // The TABLE says which outlet it is in; the directory is a projection
        // written when the card was printed. A table moved to another outlet
        // since then is served that outlet's menu and rates, never the old one.
        const outlet = (table.dimension_id || null) === (dir.dimension_id || null)
            ? guessed
            : await outletCache.get(`${workspaceId}/${table.dimension_id || ''}`,
                () => loadOutlet(db, workspaceId, table.dimension_id || null));
        const items = outlet.items;
        const tDone = Date.now();

        return {
            statusCode: 200,
            headers: {
                ...cors,
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
                // Netlify's edge nearest the diner may answer the next scan of
                // this table itself, and keep answering for another minute
                // while it refetches — the same couple-of-minutes budget.
                'Netlify-CDN-Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
                // Where the time went — see qr-order for why this exists.
                'Server-Timing': `limits;dur=${tLimits - t0}, menu;dur=${tDone - tLimits}, total;dur=${Date.now() - t0}`
            },
            body: JSON.stringify({
                outlet: outlet.outletName,
                table: String(table.label || '').slice(0, 40),
                // The page renders every amount through FluxyMoney, which needs
                // the workspace's own currency or a peso menu prints rupiah.
                currency: outlet.currency,
                // ⚠️ WHAT LANGUAGE THIS MENU IS FOR. The page offers a Bahasa
                // switcher because Indonesia is the home market; a diner in
                // Singapore has no use for it, and a stored 'id' from a Jakarta
                // restaurant would otherwise follow them into a menu whose staff
                // do not read it. Free here — the workspace doc is already read
                // for the currency.
                country: outlet.country,
                categories: [...new Set(items.map((i) => i.category).filter(Boolean))],
                // What this outlet charges on top, so the CART can show the same
                // breakdown the bill will. Without it a diner reads Rp100.000 in
                // their basket and is charged Rp111.000 at the end, and the app
                // never said why.
                //
                // Absent settings send the module's defaults — every flag off —
                // which is exactly what this endpoint described before.
                pricing: outlet.pricing,
                // WHETHER there is a header photo, never a URL to it.
                //
                // ⚠️ This returned a signed URL for about an hour on 2026-09-05,
                // and it never worked: `initAdmin()` here sets no `storageBucket`
                // (qr-menu-image does), so `admin.storage().bucket()` threw on
                // every request and the catch turned it into "no photo".
                // Silent, and indistinguishable from an outlet that had not set
                // one.
                //
                // Fixing the missing line would have been one character of the
                // problem. The rest is that a URL in this payload is a second
                // way for a diner's phone to reach Storage, bypassing the rate
                // limiter, the revoked-token check and the path guard that
                // `qr-menu-image` applies to every menu photo. The page asks
                // that endpoint for `?cover=1` instead.
                has_cover: outlet.hasCover,
                // Address, phone and opening hours — the hero card's own data.
                outlet_info: outlet.outletInfo,
                items
            })
        };
    } catch (err) {
        console.error('[qr-menu]', err && err.message);
        return notFound;
    }
};
