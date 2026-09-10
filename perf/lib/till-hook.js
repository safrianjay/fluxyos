// =============================================================================
// perf/lib/till-hook.js — instruments the till WITHOUT changing it.
//
// perf/s1-baseline.js serves pos.js with one line prepended:
//     import '/perf/lib/till-hook.js';
// Module imports evaluate before the importing module's body, and this file
// imports db-service.js by the same URL pos.js does — so it is the SAME module
// instance, and wrapping DataService.prototype here is wrapping the methods the
// till is about to call. Nothing ships: perf/ is pruned from every deploy.
//
// Records on window.__tillProbe:
//   calls[]      every wrapped read: name, start/end (ms, page clock), wall
//                clock, result size
//   refreshes[]  each getPosOverview: start, end, active order ids + statuses
//   snapshots[]  each live-listener delivery: wall clock, order ids + statuses
//   inflight / maxInflight   overlapping refreshes, the H2 question
// =============================================================================
import DataService from '/assets/js/db-service.js';

const P = DataService.prototype;
const probe = window.__tillProbe = { calls: [], refreshes: [], snapshots: [], inflight: 0, maxInflight: 0 };
const wall = () => performance.timeOrigin + performance.now();

const READS = ['getPosOrders', 'getPosTables', 'getPosMenu', 'getStockMovements', 'getOpenPosShift',
    '_holdingReservations', 'getPosDiscountPresets', 'getPosOutletSettings'];

READS.forEach((name) => {
    const orig = P[name];
    if (typeof orig !== 'function') return;
    P[name] = async function (...a) {
        const start = wall();
        const r = await orig.apply(this, a);
        probe.calls.push({ name, start, end: wall(), size: Array.isArray(r) ? r.length : (r ? 1 : 0),
            limit: (a[1] && a[1].limitCount) || null });
        return r;
    };
});

const overview = P.getPosOverview;
P.getPosOverview = async function (...a) {
    const start = wall();
    probe.inflight += 1;
    probe.maxInflight = Math.max(probe.maxInflight, probe.inflight);
    try {
        const r = await overview.apply(this, a);
        const active = (r && r.activeOrders) || [];
        probe.refreshes.push({ start, end: wall(), overlapping: probe.inflight,
            active: active.map((o) => [o.id, o.status]) });
        return r;
    } finally {
        probe.inflight -= 1;
    }
};

const watch = P.watchPosOrders;
P.watchPosOrders = function (userId, opts, onChange) {
    return watch.call(this, userId, opts, (rows) => {
        probe.snapshots.push({ at: wall(), rows: rows.map((o) => [o.id, o.status]) });
        return onChange(rows);
    });
};
