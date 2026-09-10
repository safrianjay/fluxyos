// S7 — One restaurant wifi. Everything from one IP and, deliberately, WITHOUT
// the perf allowance: 15 diners open and scroll the whole menu in one minute,
// then 25 orders arrive in the next minute. Passes only if no legitimate diner
// is refused (hypothesis H3). Expected to fail on photos.
import { openMenu, orderStatus, browsePhotos, placeOrder, buildCart, tables } from './lib/diner.js';

const TABLES = tables(1);
const ANON = { noAllowance: true };

export const options = {
    scenarios: {
        browse: { executor: 'constant-arrival-rate', rate: 15, timeUnit: '1m', duration: '1m', preAllocatedVUs: 15, maxVUs: 30, exec: 'browse' },
        order: { executor: 'constant-arrival-rate', rate: 25, timeUnit: '1m', duration: '1m', startTime: '1m', preAllocatedVUs: 10, maxVUs: 30, exec: 'order' }
    },
    thresholds: { 'qr_refusals{reason:rate_limited}': ['count==0'] }
};

export function browse() {
    const t = TABLES[Math.floor(Math.random() * TABLES.length)];
    const menu = openMenu(t, ANON);
    if (!menu) return;
    orderStatus(t, [], ANON);
    browsePhotos(t, menu, { hero: 8, cards: 60 }, ANON);
}

let menu = null;
export function order() {
    const t = TABLES[(__ITER + __VU * 7) % TABLES.length];
    if (!menu) menu = openMenu(t, ANON);
    if (menu) placeOrder(t, buildCart(menu), { sitting: null, placed: [] }, { noAllowance: true });
}
