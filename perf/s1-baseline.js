#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/s1-baseline.js — S1: one diner, end to end, with the till watching.
// (docs/PERF_TEST_PLAN.md §8, Phase 1.) Zero load: every number here is the
// floor the load runs are compared against.
//
// 1. PAGE LOAD on a real table link at order.fluxyos.com, Pixel 7 profile:
//      cold ×5 on Lighthouse's mobile throttling (150 ms RTT, 1.6 Mbps down,
//      750 Kbps up, CPU ×4) · warm ×3 (same browser, reloaded) · cold ×3
//      unthrottled, which separates the network from the server.
//    Captured from Chrome's own network events (CDP): every request, its
//    bytes, whether it came from cache, and — for photos — the function's
//    302 and the Cloud Storage fetch as two separate hops.
// 2. THE JOURNEY, unthrottled: pass the name gate, scroll the whole menu,
//    order two dishes, check the order, add a second round, ask for the bill.
// 3. THE TILL, open on the same outlet the whole time (local pos.html against
//    production Firebase, instrumented by perf/lib/till-hook.js): how long a
//    QR order takes to reach it, how many refreshes each change causes, and
//    what one refresh reads.
//
// Voids its own orders before and after (perf/reset.js).
//
//   node perf/s1-baseline.js                 # Kemang table 12
//   node perf/s1-baseline.js --table 5 --outlet Senopati
// Writes perf/out/s1-<stamp>/results.json and report.md.
// =============================================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { chromium, devices } = require('playwright');
const { readCreds, readFixtures, ensureServer, signIn, withDataService, APP, stamp, outDir } = require('./lib/session');
const { reset } = require('./reset');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const COLD = Number(flag('cold', 5));
const WARM = Number(flag('warm', 3));
const FAST = Number(flag('fast', 3));

// Lighthouse's default mobile throttling, so the numbers compare with any
// Lighthouse report anyone runs later.
const MOBILE_4G = { latency: 150, downloadThroughput: (1638.4 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

const log = (...a) => console.log('[perf-s1]', ...a);
const ms = (n) => (n == null || !isFinite(n) ? null : Math.round(n));
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const kb = (b) => Math.round((b || 0) / 1024);

function kind(url) {
    if (/\/t\/[A-Za-z0-9_-]+/.test(url)) return 'document';
    if (url.includes('/qr-menu-image')) return 'photo';
    if (url.includes('/qr-menu?')) return 'qr-menu';
    if (url.includes('/qr-order-status')) return 'qr-order-status';
    if (url.includes('/qr-order')) return 'qr-order';
    if (url.includes('/qr-request-bill')) return 'qr-request-bill';
    if (url.includes('storage.googleapis.com')) return 'photo';
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return 'font';
    if (/\.js(\?|$)/.test(url)) return 'script';
    if (/\.(webp|png|svg|jpg)(\?|$)/.test(url)) return 'image';
    return 'other';
}

/** Chrome's network log for one page, via CDP. Redirect hops kept apart. */
async function capture(page, { throttle = false } = {}) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    if (throttle) {
        await cdp.send('Network.emulateNetworkConditions', { offline: false, ...MOBILE_4G });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    }
    const reqs = new Map();
    cdp.on('Network.requestWillBeSent', (e) => {
        const r = reqs.get(e.requestId);
        if (r && e.redirectResponse) {
            r.hops.push({ url: r.url, status: e.redirectResponse.status, end: e.timestamp,
                server: serverMs(e.redirectResponse.timing), fromCache: !!e.redirectResponse.fromDiskCache });
            r.url = e.request.url;
        } else if (!r) {
            reqs.set(e.requestId, { url: e.request.url, first: e.request.url, method: e.request.method,
                start: e.timestamp, wall: e.wallTime * 1000, hops: [] });
        }
    });
    cdp.on('Network.responseReceived', (e) => {
        const r = reqs.get(e.requestId); if (!r) return;
        r.status = e.response.status;
        r.server = serverMs(e.response.timing);
        r.fromCache = !!(e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker);
    });
    cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.fromCache = true; });
    cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
    cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });
    return { cdp, reqs };
}

/** Time the server spent: request fully sent → first response byte. */
function serverMs(t) { return t ? ms(t.receiveHeadersStart != null ? t.receiveHeadersStart - t.sendEnd : t.receiveHeadersEnd - t.sendEnd) : null; }

const VITALS = () => {
    window.__vitals = { lcp: null, cls: 0, firstPhoto: null, gate: null };
    try {
        new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__vitals.lcp = e.startTime; }); })
            .observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => { l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__vitals.cls += e.value; }); })
            .observe({ type: 'layout-shift', buffered: true });
    } catch (_) { /* old engine */ }
    document.addEventListener('load', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && /qr-menu-image/.test(t.src) && window.__vitals.firstPhoto == null) {
            window.__vitals.firstPhoto = performance.now();
        }
    }, true);
};

/** One page load, up to the name gate and the first photo. */
async function pageLoad(context, url, { throttle, page: reuse = null }) {
    const page = reuse || await context.newPage();
    if (!reuse) await page.addInitScript(VITALS);
    const { cdp, reqs } = await capture(page, { throttle });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('#sheet-welcome.is-open, #view-menu:not([hidden]) .card', { timeout: 60_000 }).catch(() => {});
    const gateAt = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => window.__vitals && window.__vitals.firstPhoto != null, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);                 // let LCP settle and trailing photos land
    const v = await page.evaluate(() => ({ ...window.__vitals, nav: performance.getEntriesByType('navigation')[0]?.toJSON() }));
    await cdp.detach().catch(() => {});

    const all = [...reqs.values()];
    const doc = all.find((r) => kind(r.first) === 'document');
    const base = doc ? doc.start : Math.min(...all.map((r) => r.start));
    const rel = (x) => (x == null ? null : ms((x - base) * 1000));
    const menu = all.find((r) => kind(r.first) === 'qr-menu');
    const photos = all.filter((r) => r.first.includes('/qr-menu-image'));
    const firstPhoto = photos.filter((r) => r.end).sort((a, b) => a.end - b.end)[0];
    const bytes = {}; const counts = {};
    all.forEach((r) => { const k = kind(r.first); bytes[k] = (bytes[k] || 0) + (r.bytes || 0); counts[k] = (counts[k] || 0) + 1; });
    const out = {
        wall_ms: Date.now() - t0,
        ttfb: v.nav ? ms(v.nav.responseStart) : null,
        dom_ready: v.nav ? ms(v.nav.domContentLoadedEventEnd) : null,
        gate_or_menu: ms(gateAt),
        lcp: ms(v.lcp),
        cls: v.cls != null ? Math.round(v.cls * 1000) / 1000 : null,
        menu_request_start: rel(menu && menu.start),
        menu_done: rel(menu && menu.end),
        menu_server: menu ? menu.server : null,
        menu_from_cache: !!(menu && menu.fromCache),
        first_photo_painted: ms(v.firstPhoto),
        first_photo_fn_hop: firstPhoto && firstPhoto.hops[0] ? ms((firstPhoto.hops[0].end - firstPhoto.start) * 1000) : null,
        first_photo_storage_hop: firstPhoto && firstPhoto.hops[0] ? ms((firstPhoto.end - firstPhoto.hops[0].end) * 1000) : null,
        photo_fn_server: median(photos.map((r) => r.hops[0] && r.hops[0].server)),
        photos_requested: photos.length,
        photos_from_cache: photos.filter((r) => r.fromCache || (r.hops[0] && r.hops[0].fromCache)).length,
        requests: all.length,
        bytes_total_kb: kb(all.reduce((s, r) => s + (r.bytes || 0), 0)),
        bytes_kb: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, kb(b)])),
        counts
    };
    if (!reuse) await page.close();
    return out;
}

function summarize(runs) {
    const keys = ['ttfb', 'dom_ready', 'gate_or_menu', 'lcp', 'menu_done', 'menu_server', 'first_photo_painted',
        'first_photo_fn_hop', 'first_photo_storage_hop', 'photo_fn_server', 'bytes_total_kb', 'requests', 'photos_from_cache', 'photos_requested'];
    const o = { runs: runs.length };
    keys.forEach((k) => { const xs = runs.map((r) => r[k]); o[k] = { median: median(xs), min: Math.min(...xs.filter((x) => x != null)), max: Math.max(...xs.filter((x) => x != null)) }; });
    o.cls = { median: median(runs.map((r) => r.cls)) };
    return o;
}

// ── The till ────────────────────────────────────────────────────────────────
async function openTill(browser, creds, outletId) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => log('till page error:', e.message));
    await page.route('**/assets/js/pos.js*', async (route) => {
        const resp = await route.fetch();
        const body = await resp.text();
        await route.fulfill({ response: resp, body: `import '/perf/lib/till-hook.js';\n${body}` });
    });
    await signIn(page, creds);
    await page.evaluate((id) => localStorage.setItem('fluxyos-pos-outlet', id), outletId);
    const t0 = Date.now();
    await page.goto(`${APP}/pos`, { timeout: 60_000 });
    await page.waitForFunction(() => window.__tillProbe && window.__tillProbe.refreshes.length > 0, null, { timeout: 90_000 });
    return { page, bootMs: Date.now() - t0 };
}

const probe = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__tillProbe)));

/** When did the till first hear about `orderId` in `status`, and first show it? */
function tillSaw(p, orderId, status, afterWall) {
    const snap = p.snapshots.find((s) => s.at >= afterWall && s.rows.some(([id, st]) => id === orderId && (!status || st === status)));
    const shown = p.refreshes.find((r) => r.end >= afterWall && r.active.some(([id, st]) => id === orderId && (!status || st === status)));
    return { heard: snap ? ms(snap.at - afterWall) : null, shown: shown ? ms(shown.end - afterWall) : null };
}

// ── The journey ─────────────────────────────────────────────────────────────
async function add(page, name) {
    await page.locator('.card', { hasText: name }).getByRole('button', { name: /Tambah|Add/ }).first().click();
    await page.locator('#sheet-item.is-open').waitFor();
    const required = page.locator('#sheet-item .optgroup[data-select="one_required"]');
    for (let i = 0; i < await required.count(); i += 1) await required.nth(i).locator('input').first().check();
    await page.locator('#item-add').click();
    await page.locator('#sheet-item.is-open').waitFor({ state: 'detached' }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('#sheet-item.is-open'), null, { timeout: 10_000 });
}

/** Submit the cart; on a refusal, wait for the next rate-limit minute and tap again, as a diner would. */
async function submit(page, reqs, attempts) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        // A refused order leaves the cart open with its notice, so a retry
        // taps Submit again — exactly what the diner does.
        if (!(await page.locator('#cart-submit').isVisible())) {
            await page.locator('#cart-open').click();
            await page.locator('#cart-submit').waitFor({ state: 'visible' });
        }
        // Clear the previous refusal first, or the race below finds the OLD
        // notice and calls a successful retry a refusal.
        await page.evaluate(() => { const n = document.getElementById('cart-notice'); if (n) n.innerHTML = ''; });
        const before = new Set(reqs.keys());
        const t0 = Date.now();
        await page.locator('#cart-submit').click();
        const outcome = await Promise.race([
            page.locator('#sheet-done.is-open').waitFor({ timeout: 45_000 }).then(() => 'done'),
            page.locator('#cart-notice .notice').waitFor({ timeout: 45_000 }).then(() => 'refused')
        ]).catch(() => 'timeout');
        const post = [...reqs.entries()].filter(([id, r]) => !before.has(id) && kind(r.first) === 'qr-order').map(([, r]) => r).pop();
        const rec = { attempt, outcome, ui_ms: Date.now() - t0, http: post && post.status, server_ms: post && post.server,
            round_trip_ms: post && post.end ? ms((post.end - post.start) * 1000) : null,
            response_end_wall: post && post.end ? post.wall + (post.end - post.start) * 1000 : null,
            tap_wall: post ? post.wall : null,
            notice: outcome === 'refused' ? (await page.locator('#cart-notice .notice').innerText().catch(() => '')) : null };
        attempts.push(rec);
        if (outcome === 'done') return rec;
        log(`order attempt ${attempt}: ${outcome} (HTTP ${rec.http}) — "${rec.notice || ''}"`);
        const wait = 61_000 - (Date.now() % 60_000);
        log(`waiting ${Math.round(wait / 1000)} s for the next minute window, then tapping again`);
        await page.waitForTimeout(wait);
    }
    return attempts[attempts.length - 1];
}

async function journey(browser, url, till, dir) {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    try {
        return await journeySteps(page, url, till);
    } catch (e) {
        await page.screenshot({ path: path.join(dir, 'journey-failure.png') }).catch(() => {});
        throw e;
    } finally {
        await context.close();
    }
}

async function journeySteps(page, url, till) {
    await page.addInitScript(VITALS);
    const { reqs } = await capture(page);
    const steps = {};

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#sheet-welcome.is-open').waitFor({ timeout: 60_000 });
    await page.locator('#welcome-name').fill('Perf Baseline');
    await page.locator('#welcome-phone').fill('0812 3456 7890');
    await page.locator('#welcome-go').click();
    await page.locator('#sheet-welcome.is-open').waitFor({ state: 'detached' }).catch(() => {});
    await page.locator('.card').first().waitFor();

    // Scroll the whole menu the way a thumb does, and count what the photos cost.
    const s0 = Date.now();
    for (let i = 0; i < 80; i += 1) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(200);
        if (await page.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 4)) break;
    }
    await page.waitForTimeout(3000);
    const photoReqs = [...reqs.values()].filter((r) => r.first.includes('/qr-menu-image'));
    steps.scroll = {
        ms: Date.now() - s0,
        photos_on_page: await page.evaluate(() => document.querySelectorAll('img[src*="qr-menu-image"]').length),
        photos_painted: await page.evaluate(() => [...document.images].filter((i) => /qr-menu-image/.test(i.src) && i.complete && i.naturalWidth > 0).length),
        photo_requests: photoReqs.length,
        photo_kb: kb(photoReqs.reduce((s, r) => s + (r.bytes || 0), 0)),
        fn_hop_ms_median: median(photoReqs.map((r) => r.hops[0] && ms((r.hops[0].end - r.start) * 1000))),
        storage_hop_ms_median: median(photoReqs.map((r) => r.hops[0] && r.end && ms((r.end - r.hops[0].end) * 1000)))
    };
    await page.evaluate(() => window.scrollTo(0, 0));

    // Round one: a plain dish and a drink with a required option.
    await add(page, 'Air Mineral');
    await add(page, 'Es Teh Manis');
    const round1Attempts = [];
    const r1 = await submit(page, reqs, round1Attempts);
    steps.round1 = { attempts: round1Attempts };
    // The page keeps the ids it placed under fluxyos_placed_orders_<token>.
    const orderId = await page.evaluate(() => {
        try {
            const k = Object.keys(localStorage).find((x) => x.startsWith('fluxyos_placed_orders_'));
            const ids = JSON.parse(localStorage.getItem(k) || '[]');
            return ids[ids.length - 1] || null;
        } catch (_) { return null; }
    });
    await page.waitForTimeout(8000);
    let p = await probe(till.page);
    const id1 = orderId || (p.snapshots.length ? p.snapshots[p.snapshots.length - 1].rows[0][0] : null);
    steps.round1.order_id = id1;
    steps.round1.till = r1.tap_wall ? tillSaw(p, id1, null, r1.tap_wall) : null;

    // The orders sheet: qr-order-status.
    await page.locator('#done-more').click().catch(() => {});
    const statusBefore = new Set(reqs.keys());
    await page.locator('.tab[data-tab="orders"]').click();
    await page.locator('#sheet-orders.is-open').waitFor();
    await page.waitForTimeout(2500);
    const st = [...reqs.entries()].filter(([id, r]) => !statusBefore.has(id) && kind(r.first) === 'qr-order-status').map(([, r]) => r).pop();
    steps.status = st ? { http: st.status, server_ms: st.server, round_trip_ms: ms((st.end - st.start) * 1000) } : null;

    // Round two, appended to the same ticket (the kitchen has not taken it).
    await page.locator('#orders-add').click().catch(() => {});
    await page.waitForTimeout(500);
    await add(page, 'Klepon');
    const round2Attempts = [];
    const r2 = await submit(page, reqs, round2Attempts);
    await page.waitForTimeout(8000);
    p = await probe(till.page);
    steps.round2 = { attempts: round2Attempts, till: r2.tap_wall ? tillSaw(p, id1, null, r2.tap_wall) : null };

    // The kitchen, from the till: sent → ready → served. The bill button only
    // appears once food is served (order.html), and each step is a cashier's
    // tap whose write latency is worth knowing on its own.
    steps.kitchen = await withDataService(till.page, async (id) => {
        const { ds, uid } = window.__perf;
        const out = [];
        for (const st of ['sent', 'ready', 'served']) {
            const t0 = performance.now();
            await ds.setPosOrderStatus(uid, id, st);
            out.push({ to: st, ms: Math.round(performance.now() - t0) });
        }
        return out;
    }, id1);

    // The bill: two taps.
    await page.locator('#done-more').click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.tab[data-tab="menu"]').click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('.tab[data-tab="orders"]').click();
    await page.locator('#bill-btn').waitFor({ state: 'visible', timeout: 30_000 });
    const billBefore = new Set(reqs.keys());
    await page.locator('#bill-btn').click();
    await page.locator('#bill-btn').click();
    await page.waitForTimeout(8000);
    const bill = [...reqs.entries()].filter(([id, r]) => !billBefore.has(id) && kind(r.first) === 'qr-request-bill').map(([, r]) => r).pop();
    p = await probe(till.page);
    const billWall = bill ? bill.wall : null;
    steps.bill = bill ? { http: bill.status, server_ms: bill.server, round_trip_ms: ms((bill.end - bill.start) * 1000),
        till: billWall ? tillSaw(p, id1, 'awaiting_payment', billWall) : null } : null;

    return steps;
}

// ── Reads per refresh, from collection sizes and the queries in the code ────
async function readModel(wsId) {
    if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
    const db = admin.firestore();
    const count = async (c) => (await db.collection(`workspaces/${wsId}/${c}`).count().get()).data().count;
    const n = {};
    for (const c of ['pos_orders', 'pos_tables', 'items', 'stock_movements', 'pos_shifts', 'pos_reservations']) n[c] = await count(c);
    // getPosOverview: orders(limit 300) + tables(all) + menu→items(all) +
    // movements(limit 1000) + reservations(limit 300); refresh() adds a second
    // getPosMenu (items, all again) and getOpenPosShift (limit 20).
    const per = (x) => Math.min(300, x.pos_orders) + x.pos_tables + 2 * x.items + Math.min(1000, x.stock_movements)
        + Math.min(20, x.pos_shifts) + Math.min(300, x.pos_reservations);
    const mature = { pos_orders: 300, pos_tables: 20, items: 150, stock_movements: 1000, pos_shifts: 20, pos_reservations: 20 };
    return { counts: n, reads_per_refresh: per(n), mature_example: mature, reads_per_refresh_mature: per(mature) };
}

// ── Report ──────────────────────────────────────────────────────────────────
function report(r) {
    const f = (x, u = ' ms') => (x == null ? '—' : `${Number(x).toLocaleString('en-US')}${u}`);
    const m = (o, k, u) => f(o[k] && o[k].median, u);
    const row = (label, k, u = ' ms') => `| ${label} | ${m(r.cold, k, u)} | ${m(r.warm, k, u)} | ${m(r.fast, k, u)} |`;
    const att = (a) => a.map((x) => `${x.outcome === 'done' ? '✓' : '✗'} HTTP ${x.http ?? '—'} · server ${f(x.server_ms)} · round trip ${f(x.round_trip_ms)}${x.notice ? ` · diner saw “${x.notice}”` : ''}`).join('<br>');
    const J = r.journey;
    const budget = (v, lim) => (v == null ? '—' : v <= lim ? `✓ ${f(v)}` : `✗ ${f(v)}`);
    return `# S1 baseline — ${r.table.outlet} table ${r.table.label}

Run ${r.started} → ${r.finished} · workspace \`${r.workspace}\` (qa+id) · generated by \`perf/s1-baseline.js\`.
Zero load: these are the floor every load run is compared against.

## Against the budgets (docs/PERF_TEST_PLAN.md §3)

| Budget | Target | S1 |
|---|---|---|
| LCP, mobile 4G | ≤ 2,500 ms | ${budget(r.cold.lcp.median, 2500)} |
| First photo, mobile 4G | ≤ 2,500 ms | ${budget(r.cold.first_photo_painted.median, 2500)} |
| \`qr-menu\` server time | ≤ 800 ms | ${budget(r.fast.menu_server.median, 800)} |
| Photo function hop, server time | ≤ 400 ms | ${budget(r.fast.photo_fn_server.median, 400)} |
| \`qr-order\` (first accepted attempt) | ≤ 1,500 ms | ${budget((J.round1.attempts.find((a) => a.outcome === 'done') || {}).round_trip_ms, 1500)} |
| \`qr-order-status\` | ≤ 600 ms | ${budget(J.status && J.status.round_trip_ms, 600)} |
| \`qr-request-bill\` | ≤ 1,000 ms | ${budget(J.bill && J.bill.round_trip_ms, 1000)} |
| New order on the till, from the diner's tap | ≤ 3,000 ms | ${budget(J.round1.till && J.round1.till.shown, 3000)} |

## Page load (medians)

| | Cold, mobile 4G ×${r.cold.runs} | Warm, mobile 4G ×${r.warm.runs} | Cold, unthrottled ×${r.fast.runs} |
|---|---|---|---|
${row('Document first byte', 'ttfb')}
${row('Name gate (or menu) on screen', 'gate_or_menu')}
${row('Largest contentful paint', 'lcp')}
${row('Menu data received', 'menu_done')}
${row('`qr-menu` server time', 'menu_server')}
${row('First photo painted', 'first_photo_painted')}
${row('…its function hop (302)', 'first_photo_fn_hop')}
${row('…its storage hop', 'first_photo_storage_hop')}
${row('Photo function server time', 'photo_fn_server')}
${row('Transferred', 'bytes_total_kb', ' KB')}
${row('Requests', 'requests', '')}
${row('Photos served from browser cache', 'photos_from_cache', '')}

CLS (cold, median): ${r.cold.cls.median}.

## The journey (unthrottled)

| Step | Result |
|---|---|
| Scroll the whole menu | ${J.scroll.photo_requests} photo requests · ${J.scroll.photo_kb} KB · ${J.scroll.photos_painted}/${J.scroll.photos_on_page} painted · function hop median ${f(J.scroll.fn_hop_ms_median)} · storage hop median ${f(J.scroll.storage_hop_ms_median)} |
| Round one (2 dishes) | ${att(J.round1.attempts)} |
| …reached the till | heard ${f(J.round1.till && J.round1.till.heard)} · on screen ${f(J.round1.till && J.round1.till.shown)} after the diner tapped (the diner's own confirmation: ${f((J.round1.attempts.find((a) => a.outcome === 'done') || {}).round_trip_ms)}) |
| Order status sheet | ${J.status ? `HTTP ${J.status.http} · server ${f(J.status.server_ms)} · round trip ${f(J.status.round_trip_ms)}` : '—'} |
| Round two (appended) | ${att(J.round2.attempts)} |
| …reached the till | heard ${f(J.round2.till && J.round2.till.heard)} · on screen ${f(J.round2.till && J.round2.till.shown)} after the diner tapped |
| Kitchen steps from the till (write latency) | ${(J.kitchen || []).map((k) => `${k.to} ${f(k.ms)}`).join(' · ') || '—'} |
| Request the bill | ${J.bill ? `HTTP ${J.bill.http} · server ${f(J.bill.server_ms)} · round trip ${f(J.bill.round_trip_ms)} · till on screen ${f(J.bill.till && J.bill.till.shown)} after the tap` : '—'} |

## The till

- Boot to first board: ${f(r.till.boot_ms)}
- During the journey: ${r.till.refreshes} refreshes for ${r.till.snapshots} listener deliveries · at most ${r.till.max_overlapping} refreshes in flight at once
- One refresh reads **${r.reads.reads_per_refresh.toLocaleString('en-US')} documents** here (${Object.entries(r.reads.counts).map(([k, v]) => `${k} ${v}`).join(', ')}), computed from collection sizes and the queries in \`pos-service.js\`.
- On a mature outlet (300+ orders, 1,000+ stock movements, 150 items, 20 tables) the same refresh reads **${r.reads.reads_per_refresh_mature.toLocaleString('en-US')}**.
- Refresh duration: median ${f(r.till.refresh_ms_median)}, slowest ${f(r.till.refresh_ms_max)}.
`;
}

async function main() {
    const fx = readFixtures();
    const creds = readCreds('id');
    const outlet = fx.outlets.find((o) => o.name === flag('outlet', 'Kemang')) || fx.outlets[0];
    const table = outlet.tables.find((t) => t.label === flag('table', '12')) || outlet.tables[0];
    const url = table.url;
    const dir = outDir(`s1-${stamp()}`);
    const started = new Date().toISOString();
    log(`table ${outlet.name} ${table.label} → ${url}`);

    const stop = await ensureServer();
    log('reset:', JSON.stringify(await reset({ log: () => {} })));
    const browser = await chromium.launch();
    try {
        const till = await openTill(browser, creds, outlet.id);
        log(`till open (${till.bootMs} ms to first board)`);

        const cold = [];
        for (let i = 0; i < COLD; i += 1) {
            const ctx = await browser.newContext({ ...devices['Pixel 7'] });
            cold.push(await pageLoad(ctx, url, { throttle: true }));
            await ctx.close();
            log(`cold mobile ${i + 1}/${COLD}: LCP ${cold[i].lcp} ms · first photo ${cold[i].first_photo_painted} ms · ${cold[i].bytes_total_kb} KB`);
        }
        const warm = [];
        {
            const ctx = await browser.newContext({ ...devices['Pixel 7'] });
            const page = await ctx.newPage();
            await page.addInitScript(VITALS);
            await pageLoad(ctx, url, { throttle: true, page });          // prime the cache
            for (let i = 0; i < WARM; i += 1) {
                warm.push(await pageLoad(ctx, url, { throttle: true, page }));
                log(`warm mobile ${i + 1}/${WARM}: LCP ${warm[i].lcp} ms · ${warm[i].photos_from_cache}/${warm[i].photos_requested} photos from cache · ${warm[i].bytes_total_kb} KB`);
            }
            await ctx.close();
        }
        const fast = [];
        for (let i = 0; i < FAST; i += 1) {
            const ctx = await browser.newContext({ ...devices['Pixel 7'] });
            fast.push(await pageLoad(ctx, url, { throttle: false }));
            await ctx.close();
            log(`cold unthrottled ${i + 1}/${FAST}: menu server ${fast[i].menu_server} ms · photo fn server ${fast[i].photo_fn_server} ms`);
        }

        // A fresh minute for the journey: the page loads above spent this
        // one's per-IP allowance (see the S1 finding on the shared limiter).
        await new Promise((r) => setTimeout(r, 61_000 - (Date.now() % 60_000)));
        const p0 = await probe(till.page);
        const j = await journey(browser, url, till, dir);
        const p1 = await probe(till.page);
        log('journey done');

        const during = p1.refreshes.slice(p0.refreshes.length);
        const results = {
            started, finished: new Date().toISOString(), workspace: fx.workspace_id,
            table: { outlet: outlet.name, label: table.label, url },
            cold: summarize(cold), warm: summarize(warm), fast: summarize(fast),
            raw: { cold, warm, fast },
            journey: j,
            till: {
                boot_ms: till.bootMs,
                refreshes: during.length,
                snapshots: p1.snapshots.length - p0.snapshots.length,
                max_overlapping: p1.maxInflight,
                refresh_ms_median: median(during.map((r) => r.end - r.start).map(ms)),
                refresh_ms_max: ms(Math.max(...during.map((r) => r.end - r.start), 0)),
                calls_during: Object.entries(p1.calls.slice(p0.calls.length).reduce((a, c) => { a[c.name] = (a[c.name] || 0) + 1; return a; }, {}))
            },
            reads: await readModel(fx.workspace_id)
        };
        fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
        fs.writeFileSync(path.join(dir, 'report.md'), report(results));
        log(`wrote ${path.relative(process.cwd(), dir)}/report.md`);
        await till.page.context().close();
    } finally {
        await browser.close();
        log('reset:', JSON.stringify(await reset({ log: () => {} }).catch((e) => ({ error: e.message }))));
        stop();
    }
}

main().catch((e) => { console.error('[perf-s1] FAILED:', e.stack || e.message); process.exit(1); });
