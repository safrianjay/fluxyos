// S2 — Scan stampede: 200 diners open the menu across 40 tables within five
// minutes and scroll every photo. No ordering. Measures qr-menu, the image
// function, time to first photo, and 429s.
//
// ⚠️ From ONE machine this is one IP: 200 menus × ~68 photos far exceeds the
// 300/min per-IP photo limit. Without the perf allowance (PERF_KEY) the run
// measures the limiter, not the photos — which S7 does on purpose.
import { openMenu, orderStatus, browsePhotos, tables } from './lib/diner.js';
import { budgets, dur } from './lib/budgets.js';

const TABLES = tables(1);
const OPENS = Number(__ENV.OPENS || 200);

export const options = {
    scenarios: {
        stampede: {
            executor: 'constant-arrival-rate',
            rate: Math.round(OPENS / 5), timeUnit: '1m', duration: dur('5m'),
            preAllocatedVUs: 40, maxVUs: 250
        }
    },
    thresholds: budgets('qr-menu', 'qr-menu-image', 'qr-order-status', 'first_photo_ms')
};

export default function () {
    const t = TABLES[Math.floor(Math.random() * TABLES.length)];
    const menu = openMenu(t);
    if (!menu) return;
    orderStatus(t);
    browsePhotos(t, menu, { hero: 8, cards: 60 });
}
