// S10 — Retries on a flaky network. 30% of orders have their first response
// dropped (the client gives up after 150 ms while the server carries on), then
// are retried with the SAME client_ref, as a phone that lost signal would.
// perf/verify.js must find exactly one order per client_ref and no doubled
// quantities. The race to watch: a retry that lands before the first request
// has written its idempotency record.
import { sleep } from 'k6';
import { openMenu, placeOrder, buildCart, newRef, tables } from './lib/diner.js';

const TABLES = tables(1).slice(20, 30);

export const options = {
    scenarios: { flaky: { executor: 'per-vu-iterations', vus: TABLES.length, iterations: Number(__ENV.ORDERS || 5), maxDuration: '15m' } }
};

let menu = null;
const state = { sitting: null, placed: [] };

export default function () {
    const t = TABLES[__VU - 1];
    if (!menu) menu = openMenu(t);
    const lines = buildCart(menu);
    const clientRef = newRef();
    if (Math.random() < 0.3) {
        placeOrder(t, lines, state, { clientRef, timeout: '150ms', scenario: 's10-dropped' });
        sleep(0.5 + Math.random() * 2);
        placeOrder(t, lines, state, { clientRef, scenario: 's10-retry' });
    } else {
        placeOrder(t, lines, state, { clientRef, scenario: 's10-clean' });
    }
    sleep(4);                       // stay under the 20/min per-IP order limit
}
