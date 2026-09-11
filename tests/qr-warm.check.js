'use strict';

// =============================================================================
// The QR diner functions are kept warm, and the warm-up is exactly as cheap as
// it claims (netlify/functions/lib/warmup.js, qr-warm.js).
//
// Silent failures this guards:
//   - a function that checks the METHOD first never answers the warm-up for a
//     POST endpoint (qr-order, qr-request-bill) — 405, still cold
//   - a warm-up that touches the rate limiter leaves a counter document per
//     ping in `rate_limits`, which has no TTL
//   - the cron in code drifting from netlify.toml (storage-token-sweep did)
//   - qr-warm dropping out of SCHEDULED_FUNCTIONS: it would run from all four
//     sites and ping four times over
//
// No credentials, no network. Run: node tests/qr-warm.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FN = (f) => fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
const { isWarmup, warmup } = require(path.join(ROOT, 'netlify/functions/lib/warmup.js'));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (a, b, label) => (JSON.stringify(a) === JSON.stringify(b) ? ok(label) : fail(`${label}\n      expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`));

(async () => {
    console.log('\nqr warm\n');
    const FIVE = ['qr-menu', 'qr-menu-image', 'qr-order', 'qr-order-status', 'qr-request-bill'];

    // ── Every endpoint answers the warm-up before it checks the method ──────
    for (const f of FIVE) {
        const src = FN(`${f}.js`);
        const warm = src.indexOf('if (isWarmup(event)) return warmup(');
        const method = src.search(/if \(event\.httpMethod !== '(GET|POST)'\)/);
        is(warm > 0 && warm < method, true, `${f} answers ?warm=1 before its method check`);
    }

    // ── The warm-up is one read of a missing document, nothing else ─────────
    const lib = FN('lib/warmup.js').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    is(/consume|rate_limits|directoryEntry|createCache/.test(lib), false, 'the warm-up never touches the limiter or the caches');
    is(isWarmup({ httpMethod: 'GET', queryStringParameters: { warm: '1' } }), true, 'GET ?warm=1 is a warm-up');
    is(isWarmup({ httpMethod: 'POST', queryStringParameters: { warm: '1' } }), false, '…a POST never is (an order is never mistaken for one)');
    is(isWarmup({ httpMethod: 'GET', queryStringParameters: { warm: '0' } }), false, '…nor warm=0');
    let reads = 0;
    const fakeDb = { doc: (p) => ({ get: async () => { reads += 1; is(p, 'pos_table_directory/warmup-probe', 'it reads the one missing document'); return { exists: false }; } }) };
    const res = await warmup(() => fakeDb, { 'Access-Control-Allow-Origin': 'x' });
    is([res.statusCode, reads, /^warm;dur=\d+$/.test(res.headers['Server-Timing']), res.headers['Cache-Control']], [204, 1, true, 'no-store'],
        'a warm-up answers 204, one read, timed, never cached');
    const broken = await warmup(() => { throw new Error('no credentials'); });
    is(broken.statusCode, 503, 'a warm-up that cannot reach Firestore says so (503) instead of throwing');

    // ── The schedule, and where it runs ─────────────────────────────────────
    const warmSrc = FN('qr-warm.js');
    const cron = (/const CRON = '([^']+)'/.exec(warmSrc) || [])[1];
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    const tomlCron = (/\[functions\."qr-warm"\]\s*\n\s*schedule = "([^"]+)"/.exec(toml) || [])[1];
    is(!!cron && cron === tomlCron, true, `the cron in code equals netlify.toml (${cron} / ${tomlCron})`);
    is(/schedule\(CRON,/.test(warmSrc), true, '…and the in-code wrapper uses it');
    const deploy = fs.readFileSync(path.join(ROOT, 'scripts/prepare-deploy.js'), 'utf8');
    const listed = (deploy.match(/const SCHEDULED_FUNCTIONS = \[([\s\S]*?)\];/) || [])[1] || '';
    is(/'qr-warm\.js'/.test(listed), true, 'qr-warm is in SCHEDULED_FUNCTIONS — it runs from the dashboard site only');
    is(/order\.fluxyos\.com/.test(warmSrc), true, 'it warms the ORDER site, where diners call');
    is(FIVE.every((f) => warmSrc.includes(`'${f}'`)), true, 'it warms all five diner functions');
    is(/ops_heartbeats\/qr-warm/.test(warmSrc), true, 'every run leaves a heartbeat, so a cron that never registered is visible');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nqr warm: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\n✗ qr-warm check threw:', e); process.exit(1); });
