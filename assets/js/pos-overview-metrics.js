(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FluxyPosOverviewMetrics = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const toMs = (value) => {
        if (!value) return null;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
        return Number.isFinite(ms) ? ms : null;
    };
    const inRange = (value, startMs, endMs) => { const ms = toMs(value); return ms != null && ms >= startMs && ms <= endMs; };
    const merchandiseNet = (o) => Math.max(0, Math.round(Number(o?.total_amount) || 0)
        - Math.max(0, Math.round(Number(o?.service_charge_amount) || 0))
        - Math.max(0, Math.round(Number(o?.tax_amount) || 0)));
    const stableKey = (o) => {
        if (!o) return null;
        if (o.channel === 'connector') {
            const source = String(o.connector_source || o.source_name || '').trim();
            const id = String(o.source_order_id || o.external_order_id || '').trim();
            return source && id ? `connector:${source}:${id}` : null;
        }
        return o.id ? `pos:${o.id}` : null;
    };
    function dedupeOrders(rows) {
        const map = new Map(); const gaps = [];
        (rows || []).forEach((row) => {
            const key = stableKey(row); if (!key) { gaps.push(row); return; }
            const prior = map.get(key);
            if (!prior || (toMs(row.updated_at) || 0) >= (toMs(prior.updated_at) || 0)) map.set(key, row);
        });
        return { rows: [...map.values()], gaps, duplicateCount: Math.max(0, (rows || []).length - gaps.length - map.size) };
    }
    const orderGross = (o) => (o?.lines || []).length
        ? o.lines.reduce((s, l) => s + Math.max(0, Math.round(Number(l.gross_amount) || 0)), 0)
        : Math.max(0, Math.round(Number(o?.subtotal) || 0));
    function lineNetShares(o) {
        const lines = Array.isArray(o?.lines) ? o.lines : [];
        const bases = lines.map((l) => Math.max(0, Math.round(Number(l.gross_amount) || 0) - Math.max(0, Math.round(Number(l.discount_amount) || 0))));
        const base = bases.reduce((s, n) => s + n, 0); const discount = Math.max(0, Math.round(Number(o?.discount_amount) || 0)); let used = 0;
        return lines.map((line, i) => { const share = i === lines.length - 1 ? Math.min(bases[i], Math.max(0, discount - used)) : Math.min(bases[i], base ? Math.round(discount * bases[i] / base) : 0); used += share; return { line, net: Math.max(0, bases[i] - share) }; });
    }
    function addProducts(target, order, sign) {
        lineNetShares(order).forEach(({ line, net }) => {
            const id = String(line.item_id || '').trim(); const name = String(line.item_name || 'Unknown product').trim() || 'Unknown product'; const key = id || `name:${name.toLowerCase()}`;
            const row = target.get(key) || { id: id || null, name, units: 0, netSales: 0 };
            row.units += sign * (Number(line.quantity) || 0); row.netSales += sign * net; target.set(key, row);
        });
    }
    function addPayments(target, order, sign) {
        const payments = (order?.payments || []).filter((p) => p?.status === 'settled');
        const collected = payments.reduce((s, p) => s + Math.max(0, Math.round(Number(p.amount) || 0)), 0); const net = merchandiseNet(order); let used = 0;
        payments.forEach((p, i) => { const raw = Math.max(0, Math.round(Number(p.amount) || 0)); const amount = i === payments.length - 1 ? Math.max(0, net - used) : (collected ? Math.round(net * raw / collected) : 0); used += amount; const key = String(p.method || 'unknown').trim() || 'unknown'; target.set(key, (target.get(key) || 0) + sign * amount); });
    }
    const modeOf = (o) => o.table_id ? 'dine_in' : (o.table_id === null ? 'takeaway' : 'unknown');
    function calculate(rows, { startMs, endMs }) {
        const deduped = dedupeOrders(rows);
        const completed = deduped.rows.filter((o) => !o.voided_at && inRange(o.paid_at, startMs, endMs));
        const refundOrders = deduped.rows.filter((o) => o.refund_transaction_id && inRange(o.refunded_at, startMs, endMs));
        const voidOrders = deduped.rows.filter((o) => o.status === 'void' && inRange(o.voided_at, startMs, endMs));
        const grossSales = completed.reduce((s, o) => s + orderGross(o), 0); const discounts = completed.reduce((s, o) => s + Math.max(0, Math.round(Number(o.discount_total) || 0)), 0); const refunds = refundOrders.reduce((s, o) => s + merchandiseNet(o), 0);
        const modes = new Map(); const products = new Map(); const payments = new Map();
        completed.forEach((o) => { const mode = modeOf(o); const row = modes.get(mode) || { mode, count: 0, netSales: 0 }; row.count++; row.netSales += merchandiseNet(o); modes.set(mode, row); addProducts(products, o, 1); addPayments(payments, o, 1); });
        refundOrders.forEach((o) => {
            const mode = modeOf(o); const row = modes.get(mode) || { mode, count: 0, netSales: 0 };
            row.netSales -= merchandiseNet(o); modes.set(mode, row);
            addProducts(products, o, -1); addPayments(payments, o, -1);
        });
        const netPosSales = grossSales - discounts - refunds;
        return { completedTransactions: completed.length, grossSales, discounts, refunds, refundCount: refundOrders.length, netPosSales, averageOrderValue: completed.length ? Math.round(netPosSales / completed.length) : null, cancellations: voidOrders.length, modes: [...modes.values()], products: [...products.values()], payments: [...payments].map(([method, amount]) => ({ method, amount })), completed, refundOrders, voidOrders, quality: { excludedConnectorRows: deduped.gaps.length, duplicateRows: deduped.duplicateCount } };
    }
    function compare(current, previous, key) { const now = Number(current?.[key]) || 0; const before = Number(previous?.[key]) || 0; return { absolute: now - before, percent: before === 0 ? null : (now - before) / Math.abs(before) * 100 }; }
    function bucket(analytics, { hourly, locale = 'en-GB', timeZone = 'Asia/Jakarta' }) {
        const fmt = new Intl.DateTimeFormat(locale, hourly ? { timeZone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23' } : { timeZone,year:'numeric',month:'2-digit',day:'2-digit' });
        const keyOf = (v) => { const p = Object.fromEntries(fmt.formatToParts(new Date(toMs(v))).map((x) => [x.type, x.value])); return hourly ? `${p.year}-${p.month}-${p.day} ${p.hour}:00` : `${p.year}-${p.month}-${p.day}`; };
        const out = new Map();
        analytics.completed.forEach((o) => { const key = keyOf(o.paid_at); const row = out.get(key) || { key, sales:0, orders:0 }; row.sales += merchandiseNet(o); row.orders++; out.set(key,row); });
        analytics.refundOrders.forEach((o) => { const key = keyOf(o.refunded_at); const row = out.get(key) || { key, sales:0, orders:0 }; row.sales -= merchandiseNet(o); out.set(key,row); });
        return [...out.values()].sort((a,b) => a.key.localeCompare(b.key));
    }
    return { toMs, inRange, merchandiseNet, stableKey, dedupeOrders, orderGross, lineNetShares, calculate, compare, bucket };
}));
