#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/seed.js — build the load-test restaurant in a QA workspace.
//
// Part of the Lunch Rush test plan (docs/PERF_TEST_PLAN.md §2 and §7). Creates,
// in the `qa+id@fluxyos.com` workspace by default:
//
//   - 40 tables in each active outlet ("1".."40", zones Indoor / Teras / Bar)
//   - a 60-dish menu, POS-visible, with categories, modifiers, six
//     recommendations and a photo on every dish
//   - outlet pricing (the market's sales tax + 5% service) on outlets that
//     have no settings yet
//   - REGISTERED QR tokens, via the same `pos-table-qr` call the till's
//     "Table QR codes" button makes
//
// and writes perf/.fixtures.json (every token, table and dish) plus
// perf/out/qr-cards.html (the printable cards, to scan with a real phone).
//
// WHY IT DRIVES A BROWSER. Every write goes through DataService, in a signed-in
// page, so it passes the real firestore.rules and produces exactly the documents
// a person clicking through the till would — the same reason
// scripts/seed-fnb-demo.js runs in the browser. An Admin-SDK seeder would prove
// nothing about the path the load test is meant to exercise.
//
// WHY TOKENS ARE REGISTERED BY `pos-table-qr` AND NOT HERE. `qr-menu` only
// resolves tokens present in `pos_table_directory`, which is deny-all to every
// client; printing is what registers them (docs/data-model/pos.md §5). Writing
// the directory directly would skip the one step every real restaurant goes
// through.
//
// IDEMPOTENT. Tables are matched by (outlet, label), dishes by name, and a dish
// that already has a photo keeps it. Re-running only fills gaps, then
// re-exports — so it is also how you refresh perf/.fixtures.json.
//
// SAFETY. Refuses any account that is not `qa+<cc>@fluxyos.com`. The main
// Playwright account is deliberately NOT allowed: `npm run qa` writes there and
// its globalTeardown voids orders, so load residue and suite residue would
// corrupt each other. Nothing here settles a bill or posts a journal.
//
// Usage:
//   node tests/qa-static-server.js &          # the app, served locally
//   node perf/seed.js                         # dry run: signs in, plans, writes nothing
//   node perf/seed.js --commit                # build it
//   node perf/seed.js --export                # only re-export fixtures + cards
//
// Flags:
//   --account <cc>     which .qa/firebase-test-account-<cc>.md   (default: id)
//   --tables <n>       tables per outlet                         (default: 40)
//   --items <n>        dishes, max 60                            (default: 60)
//   --outlets <a,b>    outlet names to seed                      (default: every active outlet)
//   --no-photos        skip photo generation
//   --no-pricing       leave outlet tax/service untouched
//   --headed           show the browser
// =============================================================================

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const ACCOUNT = String(flag('account', 'id')).toLowerCase();
const COMMIT = has('commit');
const EXPORT_ONLY = has('export');
const TABLES = Math.max(1, Math.min(200, Number(flag('tables', 40)) || 40));
const ITEMS = Math.max(1, Math.min(60, Number(flag('items', 60)) || 60));
const OUTLETS = flag('outlets', '') ? flag('outlets', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const PHOTOS = !has('no-photos');
const PRICING = !has('no-pricing');
const HEADED = has('headed');

const APP = process.env.QA_BASE_URL || 'http://127.0.0.1:8765';
// Registration goes to the site that carries FIREBASE_SERVICE_ACCOUNT
// (pos.md §5: the till site does not), verification to the diner's origin.
const QR_FN = process.env.PERF_QR_FN || 'https://dashboard.fluxyos.com/.netlify/functions/pos-table-qr';
const ORDER_ORIGIN = process.env.PERF_ORDER_ORIGIN || 'https://order.fluxyos.com';

const QA_EMAIL = /^qa\+[a-z]{2}@fluxyos\.com$/;

// ── The menu ────────────────────────────────────────────────────────────────
// A plausible Jakarta all-day menu. Prices are raw integer rupiah. The mix is
// deliberate: modifiers on drinks and noodles exercise the modifier path in
// `qr-order`, and six recommendations fill the "Rekomendasi Kami" rail.
const SUGAR = { id: 'gula', name: 'Gula', select: 'one_required', options: [
    { id: 'normal', name: 'Normal', price_delta: 0 },
    { id: 'less', name: 'Kurang manis', price_delta: 0 },
    { id: 'none', name: 'Tanpa gula', price_delta: 0 }] };
const SIZE = { id: 'ukuran', name: 'Ukuran', select: 'one_optional', options: [
    { id: 'reg', name: 'Regular', price_delta: 0 },
    { id: 'lg', name: 'Large', price_delta: 6000 }] };
const SPICE = { id: 'pedas', name: 'Level pedas', select: 'one_required', options: [
    { id: 'l0', name: 'Tidak pedas', price_delta: 0 },
    { id: 'l1', name: 'Sedang', price_delta: 0 },
    { id: 'l2', name: 'Pedas', price_delta: 0 },
    { id: 'l3', name: 'Extra pedas', price_delta: 2000 }] };
const TOPPING = { id: 'tambahan', name: 'Tambahan', select: 'many', options: [
    { id: 'telur', name: 'Telur mata sapi', price_delta: 5000 },
    { id: 'keju', name: 'Keju', price_delta: 6000 },
    { id: 'kerupuk', name: 'Kerupuk', price_delta: 3000 }] };

const MENU = [
    ['Nasi Goreng Kampung', 'Makanan', 38000, [SPICE, TOPPING], true],
    ['Nasi Goreng Seafood', 'Makanan', 52000, [SPICE, TOPPING]],
    ['Nasi Ayam Bakar Madu', 'Makanan', 45000, [SPICE], true],
    ['Nasi Ayam Penyet', 'Makanan', 39000, [SPICE]],
    ['Nasi Rendang Sapi', 'Makanan', 58000, []],
    ['Nasi Campur Bali', 'Makanan', 55000, [SPICE]],
    ['Nasi Uduk Komplit', 'Makanan', 36000, []],
    ['Nasi Liwet Teri', 'Makanan', 42000, [SPICE]],
    ['Soto Ayam Lamongan', 'Makanan', 34000, []],
    ['Soto Betawi', 'Makanan', 48000, []],
    ['Sop Buntut', 'Makanan', 85000, [], true],
    ['Iga Bakar Kecap', 'Makanan', 89000, [SPICE]],
    ['Gado-Gado Jakarta', 'Makanan', 32000, [SPICE]],
    ['Sate Ayam Madura', 'Makanan', 40000, []],
    ['Sate Kambing', 'Makanan', 62000, []],
    ['Ikan Bakar Jimbaran', 'Makanan', 78000, [SPICE]],
    ['Cumi Goreng Tepung', 'Makanan', 46000, []],
    ['Tahu Telur Surabaya', 'Makanan', 30000, []],
    ['Mie Goreng Jawa', 'Mie', 36000, [SPICE, TOPPING]],
    ['Mie Ayam Bakso', 'Mie', 35000, [SPICE, TOPPING], true],
    ['Mie Kuah Seafood', 'Mie', 48000, [SPICE]],
    ['Kwetiau Goreng Sapi', 'Mie', 45000, [SPICE, TOPPING]],
    ['Bihun Goreng Ayam', 'Mie', 34000, [SPICE]],
    ['Bakmi Hainam', 'Mie', 42000, []],
    ['Laksa Betawi', 'Mie', 44000, []],
    ['Indomie Goreng Special', 'Mie', 28000, [TOPPING]],
    ['Pisang Goreng Keju', 'Camilan', 25000, []],
    ['Tahu Crispy', 'Camilan', 22000, []],
    ['Tempe Mendoan', 'Camilan', 20000, []],
    ['Kentang Goreng', 'Camilan', 26000, []],
    ['Singkong Goreng', 'Camilan', 22000, []],
    ['Risoles Mayo', 'Camilan', 24000, []],
    ['Lumpia Semarang', 'Camilan', 28000, []],
    ['Cireng Rujak', 'Camilan', 21000, []],
    ['Roti Bakar Coklat Keju', 'Camilan', 27000, []],
    ['Es Teh Manis', 'Minuman', 12000, [SUGAR, SIZE]],
    ['Es Jeruk Peras', 'Minuman', 18000, [SUGAR, SIZE]],
    ['Es Teler', 'Minuman', 28000, [], true],
    ['Es Campur', 'Minuman', 26000, []],
    ['Jus Alpukat', 'Minuman', 25000, [SUGAR]],
    ['Jus Mangga', 'Minuman', 24000, [SUGAR]],
    ['Es Kelapa Muda', 'Minuman', 22000, [SUGAR]],
    ['Wedang Jahe', 'Minuman', 16000, [SUGAR]],
    ['Air Mineral', 'Minuman', 8000, []],
    ['Lemon Tea', 'Minuman', 18000, [SUGAR, SIZE]],
    ['Kopi Susu Gula Aren', 'Kopi', 25000, [SUGAR, SIZE], true],
    ['Americano', 'Kopi', 24000, [SIZE]],
    ['Cappuccino', 'Kopi', 30000, [SUGAR, SIZE]],
    ['Cafe Latte', 'Kopi', 30000, [SUGAR, SIZE]],
    ['Kopi Tubruk', 'Kopi', 15000, [SUGAR]],
    ['Vietnam Drip', 'Kopi', 22000, [SUGAR]],
    ['Matcha Latte', 'Kopi', 32000, [SUGAR, SIZE]],
    ['Coklat Panas', 'Kopi', 26000, [SUGAR]],
    ['Klepon', 'Dessert', 18000, []],
    ['Dadar Gulung', 'Dessert', 18000, []],
    ['Es Krim Durian', 'Dessert', 30000, []],
    ['Pudding Gula Merah', 'Dessert', 22000, []],
    ['Martabak Manis Mini', 'Dessert', 32000, []],
    ['Serabi Kuah Kinca', 'Dessert', 20000, []],
    ['Bubur Sumsum', 'Dessert', 18000, []]
];

function readCreds(cc) {
    const file = path.join(ROOT, '.qa', `firebase-test-account-${cc}.md`);
    if (!fs.existsSync(file)) {
        throw new Error(`Missing .qa/firebase-test-account-${cc}.md — see docs/QA_TEST_ACCOUNT.md.`);
    }
    const raw = fs.readFileSync(file, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    if (!email || !password) throw new Error(`Could not parse Email + Password from ${path.basename(file)}.`);
    if (!QA_EMAIL.test(email)) {
        throw new Error(`Refusing ${email}: perf/seed.js only runs against qa+<cc>@fluxyos.com accounts.`);
    }
    return { email, password };
}

async function serverUp() {
    try { return (await fetch(`${APP}/login.html`)).ok; } catch (_) { return false; }
}

const log = (...a) => console.log('[perf-seed]', ...a);

async function main() {
    const { email, password } = readCreds(ACCOUNT);
    if (!(await serverUp())) {
        throw new Error(`Nothing is serving ${APP}. Start it with: node tests/qa-static-server.js`);
    }
    log(`account   : ${email}`);
    log(`mode      : ${EXPORT_ONLY ? 'export only' : (COMMIT ? 'COMMIT (writes)' : 'dry run (no writes)')}`);

    const browser = await chromium.launch({ headless: !HEADED });
    const page = await browser.newPage();
    page.on('pageerror', (e) => log('page error:', e.message));
    page.on('console', (m) => { if (m.text().startsWith('[perf-seed]')) console.log(m.text()); });

    // ── Sign in exactly as tests/setup-auth.spec.js does ─────────────────────
    await page.goto(`${APP}/login.html`);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('form button[type="submit"]').click();
    const dashboard = page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 90_000 });
    const verifyGate = page.locator('#verify-view')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .then(() => page.locator('#verify-skip-link').click())
        .catch(() => {});
    await Promise.race([dashboard, verifyGate]);
    await page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 90_000 });
    // The workspace must be resolved before the first operational read, or
    // `_scope` falls back (PROJECT_BACKGROUND §4, rule 4).
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, null, { timeout: 60_000 });

    const plan = { tables: TABLES, items: MENU.slice(0, ITEMS), outlets: OUTLETS, photos: PHOTOS, pricing: PRICING,
        write: COMMIT && !EXPORT_ONLY };

    const result = await page.evaluate(async (plan) => {
        const say = (...a) => console.log('[perf-seed]', ...a);
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { default: DataService } = await import('/assets/js/db-service.js');
        const app = getApps()[0];
        const user = getAuth(app).currentUser;
        if (!user) throw new Error('Not signed in.');
        if (window.FluxyWorkspace && typeof window.FluxyWorkspace.whenReady === 'function') {
            await window.FluxyWorkspace.whenReady();
        }
        const ws = window.FluxyWorkspace || {};
        const ds = new DataService(app);
        ds.setActor(user.uid, ws.role || null);
        const uid = user.uid;

        say(`workspace : ${ws.name || '(unnamed)'} ${ws.id} · country ${ws.country || '?'}`);

        // ── Outlets ────────────────────────────────────────────────────────
        const dims = await ds.getDimensions(uid);
        let outlets = dims.filter((d) => d.type === 'outlet' && d.status !== 'archived');
        if (plan.outlets) outlets = outlets.filter((o) => plan.outlets.includes(o.name));
        outlets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        if (!outlets.length) throw new Error('No active outlet to seed. Create one in POS Settings first.');
        say(`outlets   : ${outlets.map((o) => o.name).join(', ')}`);

        // ── Tables ─────────────────────────────────────────────────────────
        const zoneFor = (n) => (n <= Math.ceil(plan.tables * 0.6) ? 'Indoor'
            : n <= Math.ceil(plan.tables * 0.85) ? 'Teras' : 'Bar');
        const seatsFor = (n) => [2, 4, 4, 6, 2, 4][n % 6];
        let tables = await ds.getPosTables(uid, { includeArchived: false });
        let made = 0;
        for (const o of outlets) {
            const have = new Set(tables.filter((t) => t.dimension_id === o.id).map((t) => String(t.label).toLowerCase()));
            const missing = [];
            for (let n = 1; n <= plan.tables; n += 1) if (!have.has(String(n))) missing.push(n);
            say(`tables    : ${o.name} has ${have.size}, ${missing.length} to create`);
            if (!plan.write) continue;
            for (const n of missing) {
                await ds.savePosTable(uid, {
                    label: String(n), dimension_id: o.id, seats: seatsFor(n), zone: zoneFor(n), sort: n
                }, { create: true });
                made += 1;
            }
        }
        if (made) tables = await ds.getPosTables(uid, { includeArchived: false });

        // ── Menu ───────────────────────────────────────────────────────────
        let items = await ds.getItems(uid);
        const byName = new Map(items.map((i) => [String(i.name).toLowerCase(), i]));
        const toMake = plan.items.filter(([name]) => !byName.has(name.toLowerCase()));
        say(`menu      : ${plan.items.length - toMake.length} of ${plan.items.length} dishes exist, ${toMake.length} to create`);
        if (plan.write) {
            for (const [name, category, price, groups, recommended] of toMake) {
                await ds.saveItem(uid, {
                    name,
                    type: 'stock',
                    base_unit: 'porsi',
                    units: [],
                    // A dish, not a shelf item: untracked, so the till never
                    // warns "out of stock" on a menu nobody has received stock for.
                    track_stock: false,
                    is_sold: true,
                    sales_price: price,
                    pos_visible: true,
                    pos_recommended: recommended === true,
                    pos_category: category,
                    pos_sort: plan.items.findIndex((m) => m[0] === name),
                    pos_modifier_groups: groups
                }, { create: true });
            }
            if (toMake.length) items = await ds.getItems(uid);
        }
        const menuNames = new Set(plan.items.map(([n]) => n.toLowerCase()));
        const dishes = items.filter((i) => menuNames.has(String(i.name).toLowerCase()));

        // ── Photos ─────────────────────────────────────────────────────────
        // Synthetic, but weighted like real ones: detail and grain put the
        // right-sized WebP near the ~100 KB a real 1280px dish photo lands at
        // (docs/data-model/items.md §9), so byte counts in the image tests
        // mean something. A flat gradient would compress to 5 KB and make
        // every photo look instant.
        const hues = { Makanan: 24, Mie: 38, Camilan: 45, Minuman: 190, Kopi: 28, Dessert: 330 };
        function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
        async function photoFor(item, grain) {
            const W = 1600, H = 1200;
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const g = c.getContext('2d');
            const r = rnd([...item.name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
            const hue = hues[item.pos_category] ?? 20;
            const bg = g.createLinearGradient(0, 0, W, H);
            bg.addColorStop(0, `hsl(${hue + 10}, 35%, 30%)`); bg.addColorStop(1, `hsl(${hue - 10}, 30%, 14%)`);
            g.fillStyle = bg; g.fillRect(0, 0, W, H);
            for (let i = 0; i < 40; i += 1) {         // table-top grain
                g.fillStyle = `hsla(${hue}, 25%, ${10 + r() * 25}%, 0.25)`;
                g.fillRect(0, r() * H, W, 2 + r() * 10);
            }
            const plate = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 470);
            plate.addColorStop(0, '#fbfaf7'); plate.addColorStop(0.85, '#e9e5dd'); plate.addColorStop(1, '#bdb6aa');
            g.fillStyle = plate; g.beginPath(); g.arc(W / 2, H / 2, 470, 0, Math.PI * 2); g.fill();
            g.filter = 'blur(3px)';
            for (let i = 0; i < 260; i += 1) {        // the food
                const a = r() * Math.PI * 2, d = r() * 300;
                g.fillStyle = `hsl(${hue + (r() * 60 - 30)}, ${45 + r() * 40}%, ${25 + r() * 45}%)`;
                g.beginPath();
                g.ellipse(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, 12 + r() * 60, 8 + r() * 40, r() * 3, 0, Math.PI * 2);
                g.fill();
            }
            g.filter = 'none';
            const img = g.getImageData(0, 0, W, H); const px = img.data;
            for (let i = 0; i < px.length; i += 4) {  // sensor grain
                const n = (r() - 0.5) * grain;
                px[i] += n; px[i + 1] += n; px[i + 2] += n;
            }
            g.putImageData(img, 0, 0);
            g.font = '600 44px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
            g.fillText(item.name, 48, H - 56);
            const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
            return new File([blob], `${item.name.replace(/\W+/g, '_').toLowerCase()}.jpg`, { type: 'image/jpeg' });
        }
        const needPhoto = plan.photos ? dishes.filter((d) => !d.image_path) : [];
        say(`photos    : ${dishes.length - needPhoto.length} of ${dishes.length} dishes have one, ${needPhoto.length} to generate`);
        const sizes = [];
        if (plan.write) {
            for (const d of needPhoto) {
                // Aim for 70–160 KB after right-sizing; nudge the grain if not.
                let grain = 26, file = null, sized = null;
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    file = await photoFor(d, grain);
                    sized = await ds._rightSizeImage(file);
                    if (sized.size < 70 * 1024) grain *= 1.6;
                    else if (sized.size > 160 * 1024) grain *= 0.6;
                    else break;
                }
                const up = await ds.uploadItemImage(uid, d.id, file);
                await ds.setItemImage(uid, d.id, up.storagePath);
                sizes.push(up.fileSize);
            }
            if (sizes.length) {
                const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024);
                say(`photos    : uploaded ${sizes.length}, average ${avg} KB after right-sizing`);
            }
        }

        // ── Pricing ────────────────────────────────────────────────────────
        // Only outlets with NO settings doc: an existing one is somebody's
        // decision. Hours are written open all day, because a settings doc with
        // no hours normalizes to "closed every day" and the diner page would
        // hard-stop every test diner (order.html maybeShowClosed).
        const priced = [];
        if (plan.pricing) {
            for (const o of outlets) {
                const cur = await ds.getPosOutletSettings(uid, o.id).catch(() => null);
                if (cur && cur.exists) { say(`pricing   : ${o.name} already configured, left alone`); continue; }
                // The market's own tax word and rate (PPN 11 / GST 9 / SST 8 /
                // VAT 12) — never a hardcoded PPN, which is the exact bug a
                // Singapore outlet shipped with (docs/MULTI_MARKET_ARCHITECTURE.md).
                const M = window.FluxyMoney;
                const taxLabel = (M && M.defaultTaxLabel(ws.country)) || 'PPN';
                const taxRate = (M && M.defaultTaxRate(ws.country)) || 11;
                say(`pricing   : ${o.name} → ${taxLabel} ${taxRate}% + service 5%, open 00:00–23:59`);
                if (!plan.write) continue;
                await ds.savePosOutletSettings(uid, o.id, {
                    tax_enabled: true, tax_label: taxLabel, tax_rate_percent: taxRate, tax_inclusive: false,
                    service_enabled: true, service_rate_percent: 5, service_taxable: true,
                    hours: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                        .map((day) => ({ day, closed: false, open: '00:00', close: '23:59' }))
                });
                priced.push(o.name);
            }
        }

        const idToken = await user.getIdToken();
        return {
            workspaceId: ws.id,
            country: ws.country || null,
            idToken,
            outlets: outlets.map((o) => ({
                id: o.id,
                name: o.name,
                tables: tables.filter((t) => t.dimension_id === o.id && t.status !== 'archived')
                    .sort((a, b) => Number(a.label) - Number(b.label) || String(a.label).localeCompare(String(b.label)))
                    .map((t) => ({ id: t.id, label: t.label, zone: t.zone || null, seats: t.seats || null, token: t.qr_token }))
            })),
            items: dishes.map((d) => ({
                id: d.id, name: d.name, price: d.sales_price, category: d.pos_category || null,
                recommended: d.pos_recommended === true, has_photo: !!d.image_path || needPhoto.some((n) => n.id === d.id),
                modifier_groups: (d.pos_modifier_groups || []).map((g) => ({
                    id: g.id, select: g.select, options: g.options.map((op) => ({ id: op.id, price_delta: op.price_delta }))
                }))
            }))
        };
    }, plan);

    await browser.close();

    if (!COMMIT && !EXPORT_ONLY) {
        log('dry run finished — nothing written. Re-run with --commit to build it.');
        return;
    }

    // ── Register every token: the till's "Table QR codes" call ─────────────
    const res = await fetch(QR_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${result.idToken}` },
        body: JSON.stringify({ workspaceId: result.workspaceId })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`pos-table-qr answered ${res.status} ${JSON.stringify(body)}`);
    const cards = body.cards || [];
    log(`qr        : ${cards.length} cards generated and registered (${body.missing_token || 0} tables without a token)`);

    // ── Prove one token end to end, from the diner's origin ───────────────
    const first = result.outlets.find((o) => o.tables.length);
    let verified = null;
    if (first) {
        const tok = first.tables[0].token;
        const m = await fetch(`${ORDER_ORIGIN}/.netlify/functions/qr-menu?token=${encodeURIComponent(tok)}`);
        const mj = await m.json().catch(() => ({}));
        const n = Array.isArray(mj.items) ? mj.items.length : (mj.menu && Array.isArray(mj.menu.items) ? mj.menu.items.length : null);
        verified = { status: m.status, items: n, table: `${first.name} ${first.tables[0].label}` };
        log(`verify    : qr-menu for ${verified.table} → HTTP ${m.status}${n != null ? `, ${n} dishes` : ''}`);
        if (!m.ok) log('verify    : ⚠️ the menu did not resolve — check the order site carries FIREBASE_SERVICE_ACCOUNT (pos.md §5).');
    }

    // ── Fixtures + printable cards ────────────────────────────────────────
    const byTable = new Map(cards.map((c) => [c.table_id, c]));
    const fixtures = {
        generated_at: new Date().toISOString(),
        account: ACCOUNT,
        workspace_id: result.workspaceId,
        country: result.country,
        order_origin: ORDER_ORIGIN,
        functions_base: `${ORDER_ORIGIN}/.netlify/functions/`,
        verified,
        outlets: result.outlets.map((o) => ({
            ...o,
            tables: o.tables.map((t) => ({ ...t, url: (byTable.get(t.id) || {}).url || `${ORDER_ORIGIN}/t/${t.token}`,
                registered: byTable.has(t.id) }))
        })),
        items: result.items
    };
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(__dirname, '.fixtures.json'), JSON.stringify(fixtures, null, 2));

    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const sections = fixtures.outlets.map((o) => `
<h2>${esc(o.name)} <small>${o.tables.length} tables</small></h2>
<div class="grid">${o.tables.map((t) => {
        const c = byTable.get(t.id);
        return `<figure>${c ? c.svg : '<p>not registered</p>'}<figcaption><b>Table ${esc(t.label)}</b> · ${esc(t.zone || '')}<br><a href="${esc(t.url)}">open menu</a></figcaption></figure>`;
    }).join('')}</div>`).join('');
    fs.writeFileSync(path.join(outDir, 'qr-cards.html'), `<!doctype html><meta charset="utf-8">
<title>Load-test QR cards — ${esc(result.workspaceId)}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#0B0F19}h2 small{font-weight:400;color:#5C6577}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
figure{margin:0;border:1px solid #DCE0E7;border-radius:8px;padding:12px;text-align:center}
figure svg{width:100%;height:auto}figcaption{margin-top:6px;font-size:13px}a{color:#C2410C}</style>
<h1>Load-test QR cards</h1><p>QA workspace only. Generated ${esc(fixtures.generated_at)}. Scan one with a phone to walk the diner journey by hand.</p>
${sections}`);

    const tableCount = fixtures.outlets.reduce((s, o) => s + o.tables.length, 0);
    log(`fixtures  : perf/.fixtures.json — ${fixtures.outlets.length} outlets, ${tableCount} tables, ${fixtures.items.length} dishes`);
    log('cards     : perf/out/qr-cards.html');
}

main().catch((e) => { console.error('[perf-seed] FAILED:', e.message); process.exit(1); });
