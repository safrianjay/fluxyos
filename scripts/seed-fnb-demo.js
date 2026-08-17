// =============================================================================
// FluxyOS — F&B demo workspace seeder
//
// Builds a realistic Indonesian food-and-beverage workspace so the inventory
// chain can be WALKED rather than described: three outlets, a stocked pantry,
// a fortnight of supplier deliveries, waste, a physical count that produces real
// cost of goods sold, and revenue tagged per outlet.
//
// The three outlets deliberately tell a story, because "which outlet is working"
// is the question /outlet-pnl exists to answer:
//
//   Kemang         healthy  — strong revenue, normal 32% food cost
//   Senopati       thin     — decent food cost, but rent and staff eat the margin
//   Kelapa Gading  losing   — high waste AND high food cost; the one to act on
//
// WHY THIS RUNS IN THE BROWSER, NOT AS AN ADMIN SCRIPT
//
// It calls the same DataService a real user's clicks call, so every journal,
// stock movement and balance row is produced by the actual posting path and
// checked by the actual firestore.rules. An Admin-SDK seeder would have to
// reimplement posting, which is precisely the second set of books
// PRODUCT_STRATEGY §6 forbids — and seeded data that took a different path
// would not prove anything about the product.
//
// USAGE (locally — `scripts/` is pruned from every deploy, so this never ships):
//
//   1. node tests/qa-static-server.js
//   2. open http://127.0.0.1:8765/dashboard.html and sign in AS YOURSELF
//   3. in the console:
//
//        const { seedFnbDemo } = await import('/scripts/seed-fnb-demo.js');
//        await seedFnbDemo();                       // dry run — writes nothing
//        await seedFnbDemo({ confirm: 'WRITE' });   // actually writes
//
// ⚠️ USE A FRESH WORKSPACE. Items, receipts, journals and stock movements are
// immutable by rule — `allow delete: if false` — because they carry accounting
// history. There is no undo. Seeding your live books mixes demo figures into
// real statements permanently.
// =============================================================================

const OUTLETS = [
    { name: 'Kemang',        keep: 0.31, foodCost: 0.32, opexRatio: 0.44, wasteBoost: 1 },
    { name: 'Senopati',      keep: 0.30, foodCost: 0.35, opexRatio: 0.60, wasteBoost: 1 },
    { name: 'Kelapa Gading', keep: 0.18, foodCost: 0.53, opexRatio: 0.78, wasteBoost: 4 }
];

// Base unit is always the smallest unit actually counted. Purchase unit is how
// it arrives from the supplier — the whole reason items carry both.
const ITEMS = [
    // `order` is how many PURCHASE units arrive per delivery; `waste` (optional)
    // is a typical spoilage event in BASE units, for perishables only.
    // Both live on the item rather than in a side table keyed by name: a lookup
    // by name silently yields undefined for a renamed item, and undefined * factor
    // is NaN, which surfaces much later as "quantity must be a whole number".
    { name: 'Beras Pandan Wangi', base: 'g',     buy: ['karung', 25000],  shelf: 'Gudang kering — Rak A', rate: 14,   order: 2 },
    { name: 'Tepung Terigu',      base: 'g',     buy: ['sak', 25000],     shelf: 'Gudang kering — Rak A', rate: 12,   order: 1 },
    { name: 'Gula Pasir',         base: 'g',     buy: ['kg', 1000],       shelf: 'Gudang kering — Rak A', rate: 16,   order: 8 },
    { name: 'Garam Halus',        base: 'g',     buy: ['kg', 1000],       shelf: 'Gudang kering — Rak A', rate: 5,    order: 3 },
    { name: 'Minyak Goreng',      base: 'ml',    buy: ['jerigen', 18000], shelf: 'Gudang kering — Rak B', rate: 18,   order: 1 },
    { name: 'Kecap Manis',        base: 'ml',    buy: ['botol', 620],     shelf: 'Gudang kering — Rak B', rate: 32,   order: 6 },
    { name: 'Saus Sambal',        base: 'ml',    buy: ['botol', 340],     shelf: 'Gudang kering — Rak B', rate: 38,   order: 8 },
    { name: 'Ayam Fillet',        base: 'g',     buy: ['kg', 1000],       shelf: 'Chiller', rate: 42,  order: 12, waste: { qty: 2200, reason: 'Lewat tanggal' } },
    { name: 'Telur Ayam',         base: 'butir', buy: ['peti', 180],      shelf: 'Chiller', rate: 2400, order: 2, waste: { qty: 24,   reason: 'Pecah saat bongkar' } },
    { name: 'Udang Kupas',        base: 'g',     buy: ['kg', 1000],       shelf: 'Freezer', rate: 95,  order: 5,  waste: { qty: 900,  reason: 'Rantai dingin putus' } },
    { name: 'Daging Sapi Giling', base: 'g',     buy: ['kg', 1000],       shelf: 'Freezer', rate: 128, order: 6 },
    { name: 'Kopi Arabika',       base: 'g',     buy: ['kg', 1000],       shelf: 'Bar',     rate: 185, order: 3,  waste: { qty: 400, reason: 'Bubuk kadaluarsa' } }
];

const SUPPLIERS = ['CV Sumber Pangan', 'PT Boga Nusantara', 'Toko Bahan Jaya'];

const OPEX = [
    { vendor: 'Sewa Ruko',            category: 'Operations', share: 0.42 },
    { vendor: 'PLN & Air',            category: 'Operations', share: 0.13 },
    { vendor: 'Gaji Tim Dapur',       category: 'Operations', share: 0.45 }
];

const rupiah = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(10, 30, 0, 0); return d; };

// `outlets` / `items` narrow the seed (the spec uses one of each to exercise the
// real write path without dumping a full demo set into the QA workspace).
// `allowExisting` overrides the already-has-inventory guard — a deliberate,
// informed choice, which is why it is separate from `confirm`.
export async function seedFnbDemo({
    confirm = null, outlets = OUTLETS, items: itemDefs = ITEMS, allowExisting = false
} = {}) {
    const dryRun = confirm !== 'WRITE';

    const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const { default: DataService } = await import('/assets/js/db-service.js');

    const app = getApps()[0];
    if (!app) throw new Error('Open an app page (e.g. /dashboard) and sign in first.');
    const user = getAuth(app).currentUser;
    if (!user) throw new Error('Not signed in.');

    const ds = new DataService(app);
    ds.setActor(user.uid, (window.FluxyWorkspace || {}).role || null);
    const uid = user.uid;
    const ws = (window.FluxyWorkspace || {});

    const log = (...a) => console.log('[seed]', ...a);
    log(`workspace : ${ws.name || '(unnamed)'}  ${ws.id || uid}`);
    log(`signed in : ${user.email}`);

    // Refuse to seed a workspace that already holds inventory — mixing demo
    // figures into real books is not undoable.
    const existing = await ds.getItems(uid);
    if (existing.length) {
        log(`\u26a0 this workspace already has ${existing.length} item(s).`);
        if (!dryRun && !allowExisting) {
            throw new Error('Refusing to seed a workspace that already has items — demo figures '
                + 'would mix into real statements permanently. Use a fresh workspace, or pass '
                + '{ allowExisting: true } if you genuinely mean to add to this one.');
        }
    }

    if (dryRun) {
        log('DRY RUN — nothing will be written.');
        log(`would create: ${outlets.length} outlets, ${itemDefs.length} items,`
            + ` ${outlets.length * 3} deliveries, ${outlets.length * itemDefs.filter((i) => i.waste).length} waste records,`
            + ` ${outlets.length} stock counts, ${outlets.length * 3} opex bills,`
            + ` ${outlets.length * 6} revenue transactions.`);
        outlets.forEach((o) => log(`   · ${o.name} — food cost ${Math.round(o.foodCost * 100)}%, opex ${Math.round(o.opexRatio * 100)}% of revenue`));
        log('re-run as seedFnbDemo({ confirm: "WRITE" }) to apply. THIS CANNOT BE UNDONE.');
        return { dryRun: true };
    }

    // ── Master data ──────────────────────────────────────────────────────────
    const dims = {};
    for (const o of outlets) {
        dims[o.name] = await ds.saveDimension(uid, { name: o.name, type: 'outlet' }, { create: true });
        log(`outlet  ${o.name}`);
    }

    const items = {};
    for (const it of itemDefs) {
        const [code, factor] = it.buy;
        items[it.name] = await ds.saveItem(uid, {
            name: it.name,
            type: 'stock',
            base_unit: it.base,
            // The base unit is implicit at factor 1, so `units` only carries the
            // larger unit the supplier delivers in.
            units: factor > 1 ? [{ code, factor, role: 'purchase' }] : [],
            storage_location: it.shelf
        }, { create: true });
        log(`item    ${it.name}  (${it.base}${factor > 1 ? `, buys by ${code}` : ''})`);
    }

    const summary = [];

    for (const o of outlets) {
        const dim = dims[o.name];

        // ── Deliveries, spread across the fortnight ──────────────────────────
        for (let d = 0; d < 3; d++) {
            const lines = itemDefs.map((it) => {
                const [, factor] = it.buy;
                const qty = it.order * factor;
                return { item_id: items[it.name].id, quantity: qty, amount: Math.round(qty * it.rate) };
            });
            await ds.createGoodsReceipt(uid, {
                vendor_name: SUPPLIERS[d % SUPPLIERS.length],
                dimension_id: dim.id,
                reference: `DN-${o.name.slice(0, 3).toUpperCase()}-${1040 + d}`,
                received_at: daysAgo(12 - d * 5),
                lines
            });
        }

        // ── Waste, BEFORE the count ──────────────────────────────────────────
        // Recorded as it happens, so it reduces the system quantity and the count
        // that follows measures consumption only. This is what stops waste being
        // counted twice, and it posts to 5150 rather than COGS so gross margin
        // still exposes the loss.
        let wasteValue = 0;
        for (const it of itemDefs.filter((i) => i.waste)) {
            const res = await ds.createStockAdjustment(uid, {
                adjustment_type: 'waste',
                dimension_id: dim.id,
                reference: it.waste.reason,
                lines: [{ item_id: items[it.name].id, quantity: it.waste.qty * o.wasteBoost }]
            });
            wasteValue += Math.abs(res.total_amount);
        }

        // ── The physical count ───────────────────────────────────────────────
        // Counted against what is really on hand now, so the variance is genuine
        // consumption rather than a number invented for the demo.
        const onHand = await ds.getStockOnHand(uid, { byDimension: true });
        const countLines = itemDefs.map((it) => {
            const bucket = onHand[`${items[it.name].id}__${dim.id}`] || { quantity: 0 };
            return {
                item_id: items[it.name].id,
                counted_quantity: Math.round(bucket.quantity * o.keep),
                expected_system_quantity: bucket.quantity
            };
        }).filter((l) => l.expected_system_quantity > 0);

        const count = await ds.createStockAdjustment(uid, {
            adjustment_type: 'count',
            dimension_id: dim.id,
            reference: 'Stock opname mingguan',
            lines: countLines
        });
        const cogs = Math.abs(count.total_amount);

        // ── Revenue, sized from the ACTUAL posted COGS ───────────────────────
        // Derived rather than hardcoded, so each outlet's gross margin really is
        // the food cost its story claims.
        const revenue = Math.round(cogs / o.foodCost);
        const perDay = Math.round(revenue / 6);
        for (let d = 0; d < 6; d++) {
            await ds.addTransaction(uid, {
                vendor_name: `Penjualan harian — ${o.name}`,
                category: 'Revenue',
                type: 'income',
                amount: d === 5 ? revenue - perDay * 5 : perDay,
                status: 'Completed',
                icon: 'cash',
                dimension_id: dim.id,
                timestamp: Timestamp.fromDate(daysAgo(6 - d))
            });
        }

        // ── Operating costs, as bills ────────────────────────────────────────
        // Rent, utilities and staff are the costs that decide whether an outlet
        // is actually viable — and until bills carried a dimension, every outlet
        // looked more profitable than it was.
        const opexTotal = Math.round(revenue * o.opexRatio);
        for (const b of OPEX) {
            await ds.addBill(uid, {
                vendor_name: `${b.vendor} — ${o.name}`,
                category: b.category,
                type: 'expense',
                amount: Math.round(opexTotal * b.share),
                status: 'Upcoming',
                payment_status: 'unpaid',
                icon: 'building',
                due_date: Timestamp.fromDate(daysAgo(-7)),
                timestamp: Timestamp.fromDate(daysAgo(3)),
                dimension_id: dim.id
            });
        }

        const net = revenue - cogs - wasteValue - opexTotal;
        summary.push({ outlet: o.name, revenue, cogs, waste: wasteValue, opex: opexTotal, net });
        log(`${o.name.padEnd(14)} revenue ${rupiah(revenue)} · COGS ${rupiah(cogs)}`
            + ` · waste ${rupiah(wasteValue)} · opex ${rupiah(opexTotal)} · net ${rupiah(net)}`);
    }

    log('done. Open /outlet-pnl and pick this month.');
    console.table(summary.map((s) => ({
        Outlet: s.outlet,
        Revenue: rupiah(s.revenue),
        COGS: rupiah(s.cogs),
        Waste: rupiah(s.waste),
        Opex: rupiah(s.opex),
        Net: rupiah(s.net),
        'Gross margin': `${(((s.revenue - s.cogs) / s.revenue) * 100).toFixed(1)}%`
    })));
    return { dryRun: false, summary };
}

export default seedFnbDemo;
