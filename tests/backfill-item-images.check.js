// =============================================================================
// FluxyOS — the item-photo backfill, without a service-account key
//
// `scripts/backfill-item-images.js` rewrites customers' photographs in place.
// The Firestore and Storage half needs production credentials and is Jay's to
// run; the ENCODER half is the part that can be wrong in a way nobody notices
// until a menu looks bad, and it needs nothing but a browser. So it is exercised
// here, against images generated on the spot.
//
// ⚠️ IDEMPOTENCE IS THE ASSERTION THAT MATTERS. A backfill that re-encodes its
// own output loses a little more quality every run, and this one is meant to be
// safe to stop and restart.
// =============================================================================
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));
const { rightSize, nextPath, thumbPathFor, MAX_EDGE, THUMB_EDGE, THUMB_QUALITY } = require(
    path.join(__dirname, '..', 'scripts', 'backfill-item-images.js'));

let failures = 0;
const is = (actual, expected, label) => {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) {
        // Truncated: one of these values is an image buffer.
        const show = (v) => String(JSON.stringify(v)).slice(0, 120);
        console.log(`      expected ${show(expected)}, got ${show(actual)}`);
    }
};
const ok = (cond, label) => is(!!cond, true, label);

/** A plausible photograph, detailed enough not to compress to nothing. */
async function photo(page, w, h, quality = 0.92) {
    const b64 = await page.evaluate(async ({ w, h, quality }) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#8B4513'); g.addColorStop(0.5, '#E8C39E'); g.addColorStop(1, '#2F4F4F');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        for (let n = 0; n < 3000; n += 1) {
            x.fillStyle = `hsl(${(n * 37) % 360} 70% ${30 + (n % 50)}%)`;
            x.fillRect((n * 71) % w, (n * 131) % h, Math.max(4, w / 120), Math.max(4, h / 120));
        }
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
        return btoa(s);
    }, { w, h, quality });
    return Buffer.from(b64, 'base64');
}

(async () => {
    console.log('\nitem photo backfill\n');

    // ── The path guard, which needs no browser ──────────────────────────────
    //
    // ⚠️ `qr-menu-image.js` REFUSES any `image_path` outside the item's own
    // tree, so a rewritten path that climbs one directory is a photo that stops
    // resolving for every diner.
    const old = 'workspaces/ws1/items/it1/1725800000000_IMG 2481.jpg';
    const next = nextPath(old, 'image/webp');
    ok(next.startsWith('workspaces/ws1/items/it1/'),
        'the rewritten path stays inside the item\'s own directory');
    ok(next.endsWith('.webp'), 'the extension follows the encoding');
    ok(!/\s/.test(next), 'spaces in the original name do not survive into a Storage path');
    ok(next !== old, 'the new object never overwrites the original in place');

    // ── The stamp, which is what idempotence actually rests on ──────────────
    //
    // ⚠️ SIZE ALONE IS NOT ENOUGH, and believing it was is the bug this
    // assertion exists for. A photo that lands at 300KB is within bounds and
    // already ours, but above `ALREADY_SMALL` — so a second run re-encoded it
    // for a 1% gain, and a tenth run would have taken 1% off nine times. Found
    // by re-running the dry run against production after the first commit; the
    // browser assertions below never caught it because they only ever fed the
    // encoder a small image.
    const fs = require('fs');
    const script = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'backfill-item-images.js'), 'utf8');
    ok(/metadata: \{ metadata: \{ \[RIGHTSIZED_MARK\]: RIGHTSIZED_VERSION \} \}/.test(script),
        'every object this script writes is stamped');
    ok(/\(meta\.metadata \|\| \{\}\)\[RIGHTSIZED_MARK\]/.test(script),
        'a stamped object is skipped at any size');
    // The stamp must be read BEFORE the size heuristic, or a large stamped
    // object falls through to the very branch the stamp exists to bypass.
    ok(script.indexOf('[RIGHTSIZED_MARK]) { skipped') < script.indexOf('size <= ALREADY_SMALL'),
        'the stamp is checked before the size heuristic');

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('about:blank');

    // ── A phone photograph ──────────────────────────────────────────────────
    const big = await photo(page, 3024, 4032);
    const sized = await rightSize(page, big, 'image/jpeg');
    ok(sized, 'a phone photograph is re-encoded');
    if (sized) {
        console.log(`      ${(big.length / 1024).toFixed(0)}KB → `
            + `${(sized.bytes.length / 1024).toFixed(0)}KB `
            + `(${sized.before.w}x${sized.before.h} → ${sized.width}x${sized.height})`);
        is(Math.max(sized.width, sized.height), MAX_EDGE, `the longest edge is capped at ${MAX_EDGE}`);
        // Portrait stays portrait: orientation is not carried onto a canvas, and
        // a sideways menu photo is the failure this guards.
        ok(sized.height > sized.width, 'a portrait photograph comes back portrait');
        ok(sized.bytes.length < big.length / 5, 'it gets meaningfully smaller');
        is(sized.contentType, 'image/webp', 'it is stored as WebP');

        // ⚠️ IDEMPOTENT. Feeding the output back in must find nothing to gain,
        // or every re-run of the backfill degrades every photo a little more.
        const again = await rightSize(page, sized.bytes, sized.contentType);
        is(again, null, 'running the backfill over its own output is a no-op');
    }

    // ── Things it must leave alone ──────────────────────────────────────────
    const small = await photo(page, 320, 240, 0.7);
    is(await rightSize(page, small, 'image/jpeg'), null,
        'an already-small photo is left exactly as it is');

    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    is(await rightSize(page, junk, 'image/jpeg'), null,
        'a file that will not decode is left alone rather than replaced with nothing');

    // ── The small copy (`--thumbs`, 2026-09-11) ─────────────────────────────
    // The realistic input is a photo that is ALREADY right-sized (1280px WebP):
    // that is what every item holds after the 2026-09-08 backfill.
    const thumbOpts = { maxEdge: THUMB_EDGE, quality: THUMB_QUALITY, thumb: true };
    if (sized) {
        const copy = await rightSize(page, sized.bytes, sized.contentType, thumbOpts);
        ok(copy, 'a right-sized 1280px photo gets a small copy');
        if (copy) {
            is(Math.max(copy.width, copy.height), THUMB_EDGE, `the copy's longest edge is ${THUMB_EDGE}`);
            ok(copy.height > copy.width, '…still portrait');
            ok(copy.bytes.length < sized.bytes.length / 2, `…and well under half the bytes (${(sized.bytes.length / 1024).toFixed(0)}KB → ${(copy.bytes.length / 1024).toFixed(0)}KB)`);
            is(copy.contentType, 'image/webp', '…as WebP');
        }
    }
    is(await rightSize(page, small, 'image/jpeg', thumbOpts), null,
        'a photo no bigger than a copy gets no copy — readers fall back to it');
    is(thumbPathFor('workspaces/w/items/i/1757300000000_nasi.webp', 'image/webp'),
        'workspaces/w/items/i/1757300000000_nasi__w640.webp',
        'the copy is named exactly as uploadItemImage names it');
    const client = require('fs').readFileSync(path.join(__dirname, '..', 'assets/js/db-service.js'), 'utf8');
    ok(/storagePath\.replace\(\/\\\.\[\^\.\/\]\+\$\/, ''\) \+ '__w640'/.test(client),
        '…and the client still names it that way');
    ok(/f\.name === inUse \|\| \(thumbInUse && f\.name === thumbInUse\)/.test(script),
        '--prune-orphans keeps the small copy — it is in use too');

    await browser.close();

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nitem photo backfill: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ backfill check threw:', err);
    process.exit(1);
});
