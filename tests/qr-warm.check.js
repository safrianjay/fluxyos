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
//   - the warm-up scheduler coming back and spending the Free plan's function
//     quota again (it was removed on 2026-09-11; Cloud Run keeps one instance up)
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

    // ── The scheduler is OFF (2026-09-11) ────────────────────────────────────
    // `qr-warm` pinged all five every 5 minutes and cost ~39k of the Free
    // plan's 125k monthly invocations (team-wide) while warming only half to
    // three-quarters of first diners (instances stay warm 2.5-4 min). The
    // diner functions moved to Cloud Run with one always-on instance instead
    // (services/qr, docs/perf/LOAD_2026-09-11.md). A scheduler brought back
    // would spend that quota again, so its return is a deliberate act.
    is(fs.existsSync(path.join(ROOT, 'netlify/functions/qr-warm.js')), false, 'no warm-up scheduler is deployed');
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    is(/\[functions\."qr-warm"\]/.test(toml), false, '…and no cron for one is declared');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nqr warm: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\n✗ qr-warm check threw:', e); process.exit(1); });
