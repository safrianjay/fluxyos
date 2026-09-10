#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/report.js — one readable report per load run (docs/PERF_TEST_PLAN.md §9).
//
// Reads whatever the run folder holds and says what it means:
//   summary.json   k6 --summary-export      → verdict against the budgets, per-endpoint latency
//   orders.log     k6 --console-output     → every order attempt, bucketed over time
//   verify.json    perf/verify.js          → the hard budgets (lost / doubled / mispriced)
//   till.ndjson    perf/till-watch.js      → refreshes, reads, time to the board
//   cashier.ndjson perf/cashier.js         → staff write latency
// Missing inputs are skipped and said so, never guessed.
//
//   node perf/report.js --run s3-1x          → perf/out/s3-1x/report.md
// =============================================================================

const fs = require('fs');
const path = require('path');
const { readLog } = require('./verify');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const RUN = flag('run', null);
// Cut the time series at a moment (ISO), e.g. when the load generator's
// machine went to sleep. The k6 summary cannot be cut, so it is then NOT used:
// its percentiles would mix real measurements with sleep artifacts.
const UNTIL = flag('until', null) ? Date.parse(flag('until', null)) : null;
const inWindow = (iso) => !UNTIL || Date.parse(iso) <= UNTIL;
if (!RUN) { console.error('usage: node perf/report.js --run <name>'); process.exit(2); }
const DIR = path.join(__dirname, 'out', RUN);

const read = (f) => { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch (_) { return null; } };
const readJson = (f) => { const s = read(f); try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const readNd = (f) => (read(f) || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const pct = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : null; };
const n = (x, u = ' ms') => (x == null || !isFinite(x) ? '—' : `${Math.round(x).toLocaleString('en-US')}${u}`);

const ENDPOINTS = ['qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill'];
const BUDGET_TEXT = {
    'qr-menu': 'p95 ≤ 800', 'qr-menu-image': 'p95 ≤ 400', 'qr-order': 'p95 ≤ 1,500 · p99 ≤ 3,000',
    'qr-order-status': 'p95 ≤ 600', 'qr-request-bill': 'p95 ≤ 1,000'
};

function main() {
    const out = [];
    const summary = UNTIL ? null : readJson('summary.json');
    const orders = (fs.existsSync(path.join(DIR, 'orders.log')) ? readLog(path.join(DIR, 'orders.log')) : []).filter((o) => inWindow(o.at));
    const verify = readJson('verify.json');
    const till = readNd('till.ndjson').filter((t) => inWindow(t.at));
    const cashier = readNd('cashier.ndjson').filter((c) => inWindow(c.at));

    const times = orders.map((o) => Date.parse(o.at)).filter(isFinite);
    const from = times.length ? new Date(Math.min(...times)) : null;
    const to = times.length ? new Date(Math.max(...times)) : null;
    out.push(`# Load run \`${RUN}\``, '');
    out.push(`Generated ${new Date().toISOString()} by \`perf/report.js\`${from ? ` · orders from ${from.toISOString()} to ${to.toISOString()}` : ''}.`, '');
    if (UNTIL) out.push(`⚠️ **Cut at ${new Date(UNTIL).toISOString()}.** Everything after it is excluded, and so is the k6 summary (it cannot be cut). Order latency below comes from the per-order log instead.`, '');

    // ── Verdict ───────────────────────────────────────────────────────────
    out.push('## Verdict', '');
    const rows = [];
    if (summary) {
        Object.entries(summary.metrics).forEach(([k, m]) => {
            if (!m.thresholds) return;
            Object.entries(m.thresholds).forEach(([rule, crossed]) => {
                const stat = /^(p\(\d+\)|rate|count)/.exec(rule)[1];
                const v = stat === 'rate' ? m.value : stat === 'count' ? m.count : m[stat];
                rows.push(`| \`${k}\` | ${rule} | ${stat === 'rate' ? `${(v * 100).toFixed(2)}%` : n(v, stat === 'count' ? '' : ' ms')} | ${crossed ? '✗ over' : '✓'} |`);
            });
        });
    }
    if (!summary && orders.length) {
        const ok = orders.filter((o) => o.http === 200).map((o) => o.ms);
        const p95 = pct(ok, 95); const p99 = pct(ok, 99);
        rows.push(`| \`qr-order\` (from orders.log) | p(95)<1500 | ${n(p95)} | ${p95 <= 1500 ? '✓' : '✗ over'} |`);
        rows.push(`| \`qr-order\` (from orders.log) | p(99)<3000 | ${n(p99)} | ${p99 <= 3000 ? '✓' : '✗ over'} |`);
        const failed = orders.filter((o) => o.http === 0 || o.http === 429 || o.http >= 500).length;
        rows.push(`| orders that failed (timeout, 429, 5xx) | 0 | ${failed} of ${orders.length} | ${failed ? '✗' : '✓'} |`);
    }
    if (verify) {
        const P = verify.problems;
        const hard = [['lost orders', P.missing], ['wrong table', P.wrong_table], ['lines lost or doubled', P.lines],
            ['mispriced', P.price], ['number gaps or repeats', P.numbers], ['one retry, two orders', P.idempotency]];
        hard.forEach(([label, list]) => rows.push(`| **${label}** | 0 — hard | ${list.length} | ${list.length ? '✗ BROKEN' : '✓'} |`));
    }
    if (rows.length) out.push('| Measure | Budget | Result | |', '|---|---|---|---|', ...rows, '');
    else out.push('_No summary.json or verify.json in this run folder._', '');
    if (verify && verify.inconclusive) out.push('⚠️ **Integrity inconclusive** — no order was accepted, so nothing was checked.', '');

    // ── Endpoints ─────────────────────────────────────────────────────────
    if (summary) {
        out.push('## Endpoint latency (end to end, from the load generator)', '');
        out.push('| Endpoint | Budget | median | p90 | p95 | max |', '|---|---|---|---|---|---|');
        ENDPOINTS.forEach((e) => {
            const m = summary.metrics[`http_req_duration{name:${e}}`];
            if (m) out.push(`| \`${e}\` | ${BUDGET_TEXT[e]} | ${n(m.med)} | ${n(m['p(90)'])} | ${n(m['p(95)'])} | ${n(m.max)} |`);
        });
        const M = summary.metrics;
        out.push('');
        const line = (label, v) => out.push(`- ${label}: ${v}`);
        if (M.first_photo_ms) line('First photo after the menu arrived (p95)', n(M.first_photo_ms['p(95)']));
        if (M.photo_set_ms) line('Whole photo set for one diner (median)', n(M.photo_set_ms.med));
        if (M.order_ok) line('Orders accepted', `${M.order_ok.passes} of ${M.order_ok.passes + M.order_ok.fails} (${(M.order_ok.value * 100).toFixed(1)}%)`);
        if (M.qr_refusals) line('Refusals of any kind, all endpoints', `${M.qr_refusals.count}`);
        if (M.http_req_failed) line('Requests failed (429, 5xx, timeouts — a 409 is an answer, not a failure)', `${(M.http_req_failed.value * 100).toFixed(2)}% (${M.http_req_failed.passes} of ${M.http_req_failed.passes + M.http_req_failed.fails})`);
        if (M.http_reqs) line('Requests', `${M.http_reqs.count.toLocaleString('en-US')} (${M.http_reqs.rate.toFixed(1)}/s)`);
        if (M.vus_max) line('Peak concurrent diners', `${M.vus_max.max || M.vus_max.value}`);
        out.push('');
    }

    // ── Orders over time ──────────────────────────────────────────────────
    if (orders.length) {
        out.push('## Orders over the run (10-minute buckets)', '');
        out.push('Every attempt the diners made, from `orders.log`. `sitting_ended` retried as a new sitting is how the page recovers — and, past the 50-order window, how a live table loses its own order (plan H1).', '');
        out.push('| Window | Attempts | Accepted | median | p95 | Refused (reason × count) |', '|---|---|---|---|---|---|');
        const start = Math.min(...times);
        const buckets = new Map();
        orders.forEach((o) => {
            const b = Math.floor((Date.parse(o.at) - start) / 600000);
            if (!buckets.has(b)) buckets.set(b, []);
            buckets.get(b).push(o);
        });
        [...buckets.keys()].sort((a, b) => a - b).forEach((b) => {
            const list = buckets.get(b);
            const ok = list.filter((o) => o.http === 200);
            const refused = {};
            list.filter((o) => o.http !== 200).forEach((o) => { const k = `${o.http} ${o.error || ''}`.trim(); refused[k] = (refused[k] || 0) + 1; });
            out.push(`| ${b * 10}–${b * 10 + 10} min | ${list.length} | ${ok.length} | ${n(pct(ok.map((o) => o.ms), 50))} | ${n(pct(ok.map((o) => o.ms), 95))} | ${Object.entries(refused).map(([k, v]) => `${k} × ${v}`).join(', ') || '—'} |`);
        });
        const retried = orders.filter((o) => o.error === 'sitting_ended').length;
        out.push('', `Across the run: ${orders.length} attempts, ${orders.filter((o) => o.http === 200).length} accepted, ${retried} \`sitting_ended\` (each followed by the page's retry as a new sitting).`, '');
    }

    // ── Till ──────────────────────────────────────────────────────────────
    if (till.length) {
        out.push('## The till under this load', '');
        const tabs = [...new Set(till.map((t) => t.tab))];
        out.push('| Tab | Minutes | Listener deliveries | Refreshes | Most in flight | Refresh median / max | Order heard → on the board, p50 / p95 |', '|---|---|---|---|---|---|---|');
        tabs.forEach((tab) => {
            const rs = till.filter((t) => t.tab === tab);
            const lag = rs.flatMap((r) => r.heard_to_board_ms || []);
            out.push(`| ${tab} | ${rs.length} | ${rs.reduce((s, r) => s + r.deliveries, 0)} | ${rs.reduce((s, r) => s + r.refreshes, 0)} | ${Math.max(...rs.map((r) => r.max_overlapping))} | ${n(pct(rs.map((r) => r.refresh_ms_median), 50))} / ${n(Math.max(...rs.map((r) => r.refresh_ms_max || 0)))} | ${n(pct(lag, 50))} / ${n(pct(lag, 95))} |`);
        });
        const perRefresh = Number(flag('reads-per-refresh', 0));
        const refreshes = till.reduce((s, r) => s + r.refreshes, 0);
        const minutes = Math.max(...tabs.map((tab) => till.filter((t) => t.tab === tab).length));
        if (perRefresh) {
            out.push('', `**Reads:** ${refreshes.toLocaleString('en-US')} refreshes × ${perRefresh} documents ≈ **${(refreshes * perRefresh).toLocaleString('en-US')} document reads** from ${tabs.length} till tab(s) in ${minutes} minutes — ≈ ${Math.round(refreshes * perRefresh / minutes * 60).toLocaleString('en-US')} per hour.`);
        }
        out.push('');
    }

    // ── Cashier ───────────────────────────────────────────────────────────
    if (cashier.length) {
        out.push('## Staff writes (the scripted cashier)', '');
        const by = {};
        cashier.forEach((c) => { const k = `${c.from} → ${c.to}`; (by[k] = by[k] || []).push(c); });
        out.push('| Step | Count | Failed | median | p95 | max |', '|---|---|---|---|---|---|');
        Object.entries(by).forEach(([k, list]) => {
            const ms = list.map((c) => c.ms);
            out.push(`| ${k} | ${list.length} | ${list.filter((c) => !c.ok).length} | ${n(pct(ms, 50))} | ${n(pct(ms, 95))} | ${n(Math.max(...ms))} |`);
        });
        const fails = cashier.filter((c) => !c.ok);
        if (fails.length) out.push('', `Failures: ${fails.slice(0, 5).map((f) => `${f.number || f.order_id} ${f.from}→${f.to}: ${f.error}`).join('; ')}`);
        out.push('');
    }

    // ── Integrity detail ──────────────────────────────────────────────────
    if (verify) {
        out.push('## Integrity (`perf/verify.js`)', '');
        out.push(`${verify.attempts} attempts · ${verify.accepted} accepted · ${verify.orders_checked} orders checked against Firestore · ${verify.ghosts} written without an accepted response.`);
        Object.entries(verify.problems).forEach(([k, list]) => {
            if (list.length) out.push(`- **${k}** (${list.length}): \`${JSON.stringify(list.slice(0, 3))}\``);
        });
        out.push('');
    }

    const missing = [['summary.json', summary], ['orders.log', orders.length], ['verify.json', verify], ['till.ndjson', till.length], ['cashier.ndjson', cashier.length]]
        .filter(([, v]) => !v).map(([f]) => f);
    if (missing.length) out.push(`_Not in this run folder: ${missing.join(', ')}._`, '');

    fs.writeFileSync(path.join(DIR, 'report.md'), out.join('\n'));
    console.log(`[perf-report] ${path.relative(process.cwd(), path.join(DIR, 'report.md'))}`);
}

main();
