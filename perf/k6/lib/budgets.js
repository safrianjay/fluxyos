// The budgets in docs/PERF_TEST_PLAN.md §3/§6, as k6 thresholds. A run that
// breaks one exits non-zero, and the summary names which.
import http from 'k6/http';

// A 409 is an ANSWER (sitting_ended, bill_requested, order_closed), not a
// failure — the refusals counter records each by reason. A 429 or a 5xx is a
// failure.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

export const BUDGETS = {
    'http_req_duration{name:qr-menu}': ['p(95)<800'],
    'http_req_duration{name:qr-menu-image}': ['p(95)<400'],
    'http_req_duration{name:qr-order}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{name:qr-order-status}': ['p(95)<600'],
    'http_req_duration{name:qr-request-bill}': ['p(95)<1000'],
    first_photo_ms: ['p(95)<2500'],
    http_req_failed: ['rate<0.001']
};

/** Only the budgets for endpoints a scenario actually calls. */
export function budgets(...names) {
    const out = {};
    Object.entries(BUDGETS).forEach(([k, v]) => {
        if (k === 'http_req_failed' || names.some((n) => k.includes(`name:${n}`) || k === n)) out[k] = v;
    });
    return out;
}

/** Scale a duration string like '20m' by TIME (a smoke run uses TIME=0.02). */
export function dur(s) {
    const scale = Number(__ENV.TIME || 1);
    const m = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(s);
    const secs = Number(m[1]) * ({ s: 1, m: 60, h: 3600 })[m[2]] * scale;
    return `${Math.max(1, Math.round(secs))}s`;
}
