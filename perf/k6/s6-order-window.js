// S6 — The 50-order window (hypothesis H1, Critical).
//
// qr-order and qr-order-status read the WORKSPACE's 50 newest orders and look
// for the table's order among them. This opens a sitting on table A, pushes 60
// newer orders onto other tables, then asks table A the three questions a
// diner's phone asks. Each check PASSES when the system behaves correctly.
// On the code as of 2026-09-11 they are expected to FAIL — that is the finding.
//
// Run perf/reset.js first (A must start empty) and afterwards.
// Paced at ~18 orders a minute to stay under the 20/min per-IP limit.
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { openMenu, orderStatus, placeOrder, requestBill, tables } from './lib/diner.js';

const ALL = tables(3);
const A = ALL[39];                                  // the last table of the first outlet
const OTHERS = ALL.filter((t) => t.token !== A.token).slice(0, Number(__ENV.NEWER || 60));
const broken = new Counter('s6_broken');

export const options = {
    scenarios: { window: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '20m' } },
    thresholds: { s6_broken: ['count==0'] }
};

export default function () {
    const menu = openMenu(A);
    const plain = menu.items.find((i) => !(i.modifier_groups || []).length);
    const line = [{ item_id: plain.id, quantity: 1, options: [], note: '' }];

    const a = { sitting: null, placed: [] };
    const first = placeOrder(A, line, a, { scenario: 's6-A-round1' });
    if (!first) { broken.add(1); console.error('S6: round one on table A was refused — reset and retry'); return; }
    console.log(`S6: table ${A.outlet} ${A.label} opened ${first.order_number} (${first.order_id})`);

    OTHERS.forEach((t, i) => {
        placeOrder(t, line, { sitting: null, placed: [] }, { scenario: 's6-newer' });
        if (i % 10 === 9) console.log(`S6: ${i + 1} newer orders placed`);
        sleep(3.4);
    });

    // 1. Reopening the page: is A's order still A's?
    const s = orderStatus(A, a.placed);
    const seen = !!(s && s.has_order && s.order_id === first.order_id);
    if (!check(s, { 'after 60 newer orders, table A still sees its own order': () => seen })) broken.add(1);

    // 2. Round two from the same phone: joins the sitting, or is told it ended?
    const sittingBefore = a.sitting;
    const round2 = placeOrder(A, line, a, { scenario: 's6-A-round2' });
    const joined = !!(round2 && round2.order_id === sittingBefore);
    if (!check(round2, { 'round two joins the sitting instead of starting a new one': () => joined })) broken.add(1);

    // 3. The bill for the table.
    const billed = requestBill(A);
    if (!check(billed, { 'table A can still ask for its bill': () => billed })) broken.add(1);

    // 4. With a bill requested, nobody may open a ticket behind it.
    const behind = placeOrder(A, line, { sitting: null, placed: [] }, { scenario: 's6-A-behind-bill' });
    if (!check(behind, { 'no new ticket opens behind a requested bill': () => behind === null })) broken.add(1);
}
