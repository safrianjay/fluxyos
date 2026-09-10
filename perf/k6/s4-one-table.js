// S4 — Four phones, one table. Every 5 seconds all four submit within the same
// second, 20 times. Run perf/cashier.js --speed 0.1 alongside so the kitchen
// takes the ticket mid-burst: rounds after that must start a NEW ticket, never
// vanish. perf/verify.js then checks no line was lost or doubled.
import { sleep } from 'k6';
import { openMenu, orderStatus, placeOrder, tables } from './lib/diner.js';
import { budgets } from './lib/budgets.js';

const T = tables(1)[Number(__ENV.TABLE_INDEX || 0)];

export const options = {
    scenarios: { phones: { executor: 'per-vu-iterations', vus: 4, iterations: Number(__ENV.ROUNDS || 20), maxDuration: '15m' } },
    thresholds: budgets('qr-order', 'qr-order-status')
};

const state = { sitting: null, placed: [] };   // per VU: module state is per-VU in k6
let menu = null;

export default function () {
    if (!menu) {
        menu = openMenu(T);
        const s = orderStatus(T);
        if (s && s.has_order) state.sitting = s.order_id;
    }
    // Land on the same 5-second boundary as the other three phones.
    sleep((5000 - (Date.now() % 5000)) / 1000);
    const it = menu.items.find((i) => !(i.modifier_groups || []).length) || menu.items[0];
    placeOrder(T, [{ item_id: it.id, quantity: 1, options: [], note: '' }], state);
}
