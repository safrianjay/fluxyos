// S5 — New-table burst: 30 tables at one outlet place their FIRST order inside
// ten seconds. Every new ticket takes a number from ONE counter document per
// outlet per day (hypothesis H4). perf/verify.js checks the numbers are
// unique and gap-free.
//
// ⚠️ qr-order allows 20 per minute per IP. From one machine without the perf
// allowance, ~10 of the 30 are refused 429 by design — that is reported, and
// is why this scenario needs PERF_KEY.
import { sleep } from 'k6';
import { openMenu, placeOrder, buildCart, tables } from './lib/diner.js';
import { budgets } from './lib/budgets.js';

const N = Number(__ENV.TABLES || 30);
const TABLES = tables(1).slice(0, N);

export const options = {
    scenarios: { burst: { executor: 'per-vu-iterations', vus: TABLES.length, iterations: 1, maxDuration: '5m' } },
    thresholds: { ...budgets('qr-order'), 'http_req_duration{name:qr-order}': ['p(99)<3000'] }
};

export function setup() {
    // One menu read for everyone, so the burst is only the orders.
    return { menu: openMenu(TABLES[0]) };
}

export default function (data) {
    const t = TABLES[__VU - 1];
    sleep(Math.random() * 10);                          // all inside ten seconds
    placeOrder(t, buildCart(data.menu), { sitting: null, placed: [] });
}
