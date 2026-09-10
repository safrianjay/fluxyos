// S3 — The lunch rush (docs/PERF_TEST_PLAN.md §5, §8 Phase 3). The headline run.
//
// Active diners follow the plan's 90-minute profile: ramp to peak over 20 min,
// a coach party (+30%) at minute 33, hold to 60, taper to 0 by 80, idle 10.
// Each VU is one phone; ~2.5 phones share a table, and the first phone at each
// table asks for the bill. Run perf/cashier.js alongside, or tables never clear.
//
//   k6 run -e RUN=s3-1x -e SCALE=1 --console-output perf/out/s3-1x/orders.log \
//          --summary-export perf/out/s3-1x/summary.json perf/k6/s3-lunch-rush.js
//
// SCALE=1 → 100 diners over 40 tables (one outlet). SCALE=3 → 300 over 120.
// TIME=0.05 compresses the whole run (and every think time) for a smoke test.
import { visit, tables } from './lib/diner.js';
import { budgets, dur } from './lib/budgets.js';

const SCALE = Math.max(1, Number(__ENV.SCALE || 1));
const TABLES = tables(SCALE);
const PEAK = Math.round(100 * SCALE * Number(__ENV.PEAK_FACTOR || 1));
const COACH = Math.round(PEAK * 1.3);

export const options = {
    scenarios: {
        rush: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: dur('20m'), target: PEAK },
                { duration: dur('13m'), target: PEAK },
                { duration: dur('2m'), target: COACH },
                { duration: dur('5m'), target: COACH },
                { duration: dur('2m'), target: PEAK },
                { duration: dur('18m'), target: PEAK },
                { duration: dur('20m'), target: 0 },
                { duration: dur('10m'), target: 0 }
            ],
            gracefulRampDown: dur('20m'),
            gracefulStop: dur('20m')
        }
    },
    thresholds: budgets('qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill', 'first_photo_ms')
};

export default function () {
    const t = TABLES[(__VU - 1) % TABLES.length];
    visit(t, { host: __VU <= TABLES.length });
}
