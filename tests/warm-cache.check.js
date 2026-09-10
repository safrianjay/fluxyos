'use strict';

// =============================================================================
// The per-instance cache the QR functions use to stop asking Firestore — ~200 ms
// away across the Pacific — the same question twice (lib/warm-cache.js).
//
// What would go wrong silently if it broke:
//   - caching a REFUSAL: a token not found once would stay "not found" — a
//     freshly printed card that looks dead for a minute
//   - caching an ERROR: one Firestore blip becomes a minute of failures
//   - never expiring: a revoked card, a price change, a removed dish would
//     outlive their budget on every warm instance
//   - no cap: a warm instance that has seen every token grows without bound
//
// Run: node tests/warm-cache.check.js
// =============================================================================

const path = require('path');
const { createCache, directoryEntry, _directoryCache } =
    require(path.join(__dirname, '..', 'netlify/functions/lib/warm-cache.js'));

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log('\nwarm cache\n');

    // ── A hit does not call the loader again ────────────────────────────────
    const c = createCache({ ttlMs: 200 });
    let loads = 0;
    const loader = async () => { loads += 1; return { n: loads }; };
    const a = await c.get('k', loader);
    const b = await c.get('k', loader);
    is(loads, 1, 'a second read inside the TTL is answered from memory');
    is(a === b, true, '…with the same value');

    // ── It expires ──────────────────────────────────────────────────────────
    await wait(250);
    await c.get('k', loader);
    is(loads, 2, 'after the TTL the loader runs again');

    // ── Concurrent callers share one load ───────────────────────────────────
    let slow = 0;
    const slowLoader = async () => { slow += 1; await wait(50); return 'v'; };
    const both = await Promise.all([c.get('s', slowLoader), c.get('s', slowLoader), c.get('s', slowLoader)]);
    is(slow, 1, 'three simultaneous misses cause ONE load');
    is(both.every((v) => v === 'v'), true, '…and all three get its answer');

    // ── Refusals and errors are never cached ────────────────────────────────
    let nulls = 0;
    await c.get('none', async () => { nulls += 1; return null; });
    await c.get('none', async () => { nulls += 1; return null; });
    is(nulls, 2, 'null is not cached — a missing token may exist a minute later');

    let errs = 0;
    const boom = async () => { errs += 1; throw new Error('blip'); };
    await c.get('err', boom).catch(() => {});
    let rethrown = false;
    await c.get('err', boom).catch(() => { rethrown = true; });
    is(errs, 2, 'an error is not cached — one blip must not become a minute of failures');
    is(rethrown, true, '…and it still reaches the caller');

    // ── The cap ─────────────────────────────────────────────────────────────
    const small = createCache({ ttlMs: 60_000, max: 3 });
    for (const k of ['a', 'b', 'c', 'd']) await small.get(k, async () => k);
    is(small.size(), 3, 'the cache never holds more than its cap');
    let reloadedA = false;
    await small.get('a', async () => { reloadedA = true; return 'a'; });
    is(reloadedA, true, '…evicting the OLDEST entry first');

    // ── directoryEntry: the shape every endpoint relies on ──────────────────
    _directoryCache.clear();
    let dirReads = 0;
    const docs = {
        'pos_table_directory/live': { workspace_id: 'w1', table_id: 't1', dimension_id: 'd1', revoked: false, extra: 'x' },
        'pos_table_directory/gone': { workspace_id: 'w1', table_id: 't2', dimension_id: 'd1', revoked: true }
    };
    const db = { doc: (p) => ({ get: async () => { dirReads += 1; return { exists: p in docs, data: () => docs[p] }; } }) };
    const live = await directoryEntry(db, 'live');
    is(JSON.stringify(live), JSON.stringify({ workspace_id: 'w1', table_id: 't1', dimension_id: 'd1', revoked: false }),
        'a directory entry carries exactly workspace, table, outlet and revoked');
    await directoryEntry(db, 'live');
    is(dirReads, 1, 'the second lookup of a token is answered from memory');
    is((await directoryEntry(db, 'gone')).revoked, true, 'a revoked entry says so (callers refuse it)');
    is(await directoryEntry(db, 'never'), null, 'an unknown token is null');
    const before = dirReads;
    await directoryEntry(db, 'never');
    is(dirReads, before + 1, '…and is asked again next time, not remembered as missing');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nwarm cache: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ warm-cache check threw:', err);
    process.exit(1);
});
