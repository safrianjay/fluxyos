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
const { rightSize, nextPath, MAX_EDGE } = require(
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

    await browser.close();

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nitem photo backfill: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ backfill check threw:', err);
    process.exit(1);
});
