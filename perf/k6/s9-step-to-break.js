// S9 — Step to breaking. The S3 visit, think times compressed ×0.2 so each
// diner generates five times the request rate, in 10-minute steps of 1×, 2×,
// 5× and 10× peak. Aborts on its own once errors pass 1%.
//
// ⚠️ SHARED WITH PRODUCTION. The functions and Firestore serve real
// restaurants. This refuses to start unless CONFIRM=off-peak, and must only be
// run 15:00–17:00 or after 22:00 WIB with production error rates on screen.
import { visit, tables } from './lib/diner.js';
import { budgets, dur } from './lib/budgets.js';

if (__ENV.CONFIRM !== 'off-peak') {
    throw new Error('S9 loads shared production infrastructure. Re-run with -e CONFIRM=off-peak, off-peak only.');
}

const TABLES = tables(3);
const P = 100;

export const options = {
    scenarios: {
        steps: {
            executor: 'ramping-vus', startVUs: 0,
            stages: [
                { duration: dur('2m'), target: P }, { duration: dur('8m'), target: P },
                { duration: dur('2m'), target: 2 * P }, { duration: dur('8m'), target: 2 * P },
                { duration: dur('2m'), target: 5 * P }, { duration: dur('8m'), target: 5 * P },
                { duration: dur('2m'), target: 10 * P }, { duration: dur('8m'), target: 10 * P },
                { duration: dur('2m'), target: 0 }
            ],
            gracefulRampDown: '2m'
        }
    },
    thresholds: {
        ...budgets('qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill', 'first_photo_ms'),
        http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '1m' }]
    }
};

export default function () {
    const t = TABLES[(__VU - 1) % TABLES.length];
    visit(t, { host: __VU <= TABLES.length });
}
