// =============================================================================
// FluxyOS — re-encode item photos that were stored before they were right-sized
//
// WHAT THIS IS FOR.
//
// `uploadItemImage` stored whatever the owner picked, up to 2 MB, at whatever a
// phone camera produces — for a QR-menu tile that renders about 170x127 CSS px.
// That was fixed on 2026-09-08 (`_rightSizeImage` in db-service.js), but only
// for NEW uploads. Everything already in Storage is still full size, and a menu
// with fifteen of them is still tens of megabytes over restaurant wifi.
//
// This is that backfill. It is a projection of what the client now does on
// upload, so re-running it is idempotent and it can be stopped at any point.
//
// ⚠️ THE SAME ENGINE AS THE BROWSER, DELIBERATELY. There is no image library in
// this project — no sharp, no ImageMagick, no cwebp — and adding one to run a
// backfill once would be a dependency owned forever. Chromium is already here
// via Playwright, and encoding through the same canvas the client uses means
// the output is byte-comparable to a fresh upload rather than merely similar.
//
// ⚠️ THE ORIGINAL IS KEPT unless you ask for `--prune`. These are customers'
// photographs and the resize is lossy; a backfill that quietly destroys the
// master is not one you can change your mind about. Keeping both costs storage
// against the plan quota, which is why the pruning option exists at all.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/backfill-item-images.js
//   ... --workspace <wsId>     just one workspace
//   ... --limit <n>            stop after n items (a careful first run)
//   ... --commit               default is a DRY RUN — nothing is written
//   ... --prune                delete the original as part of a swap
//   ... --prune-orphans        delete photos in an item's folder that its
//                              `image_path` does not point at (see below)
// =============================================================================
//
// ⚠️ `--prune-orphans` IS THE IRREVERSIBLE ONE. The swap keeps the original by
// default, so after a backfill each item's folder holds the photo in use plus
// every superseded one. This deletes the superseded ones — and a deleted object
// is gone, there is no recycle bin behind Cloud Storage.
//
// Its rule is deliberately the tightest one that does the job: for an item whose
// `image_path` names an object, delete that object's SIBLINGS and nothing else.
// An item with NO `image_path` is left completely alone and merely reported —
// there is nothing to compare its files against, so "orphan" would be a guess.
// =============================================================================

const path = require('path');

const MAX_EDGE = 1280;          // matches `_rightSizeImage` in db-service.js
const QUALITY = 0.82;
// A WebP under this is already the shape this backfill produces. A cheap skip
// that avoids downloading and decoding at all — but only a HEURISTIC, and not
// the thing idempotence rests on. See RIGHTSIZED_MARK.
const ALREADY_SMALL = 160 * 1024;

// ⚠️ WHAT ACTUALLY MAKES THIS IDEMPOTENT. Size alone is not enough: a photo that
// comes out at 300KB is within bounds and already ours, but sits above the
// threshold above — so a second run re-encoded it for a 1% gain, and a tenth run
// would have taken 1% off nine times. Caught by re-running the dry run against
// production after the first commit, not by the unit check, which only ever fed
// it a small image.
//
// So every object this script writes is stamped, and a stamped object is never
// touched again whatever its size. Client uploads carry no stamp, which is
// correct — they get processed once and stamped on the way through.
const RIGHTSIZED_MARK = 'rightsized';
const RIGHTSIZED_VERSION = 'v1';

/**
 * Decode, downscale and re-encode one image, in Chromium.
 *
 * Exported so `tests/backfill-item-images.check.js` can exercise it without a
 * service-account key — the encoder is the half of this script that can be
 * wrong in a way nobody notices until a menu looks bad.
 *
 * Returns null when it cannot improve on the input, which the caller treats as
 * "leave this one alone".
 */
async function rightSize(page, buffer, contentType) {
    const out = await page.evaluate(async ({ b64, type, MAX, Q }) => {
        const blob = await (await fetch(`data:${type};base64,${b64}`)).blob();
        let src;
        try {
            src = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch (_) {
            return null;                     // undecodable: not ours to guess at
        }
        const scale = Math.min(1, MAX / Math.max(src.width, src.height));
        const w = Math.max(1, Math.round(src.width * scale));
        const h = Math.max(1, Math.round(src.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(src, 0, 0, w, h);
        const before = { w: src.width, h: src.height };
        if (src.close) src.close();

        const encode = (t) => new Promise((res) => canvas.toBlob(res, t, Q));
        let enc = await encode('image/webp');
        // A browser that cannot encode WebP returns PNG and says nothing, and a
        // PNG of a photograph is bigger than the JPEG it came from.
        if (!enc || enc.type !== 'image/webp') enc = await encode('image/jpeg');
        if (!enc) return null;
        const buf = new Uint8Array(await enc.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
        return { b64: btoa(s), type: enc.type, w, h, before };
    }, {
        b64: buffer.toString('base64'),
        type: contentType || 'image/jpeg',
        MAX: MAX_EDGE,
        Q: QUALITY
    });

    if (!out) return null;

    // ⚠️ ALREADY DONE IS NOT "CAN BE SHAVED FURTHER". Re-encoding a WebP that is
    // already within bounds shrinks it AGAIN — lossy over lossy — so without
    // this the backfill would happily re-process its own output and take a
    // little more quality every run. The caller skips these before downloading
    // them; this is the same rule at the layer that can actually see the
    // dimensions, so the guarantee does not depend on the caller getting it
    // right.
    const withinBounds = Math.max(out.before.w, out.before.h) <= MAX_EDGE;
    if (withinBounds && /webp/i.test(contentType || '') && buffer.length <= ALREADY_SMALL) {
        return null;
    }

    const bytes = Buffer.from(out.b64, 'base64');
    // Never make it worse. A small original re-encoded can easily come out
    // heavier, and shipping that would be the opposite of the point.
    if (bytes.length >= buffer.length) return null;
    return { bytes, contentType: out.type, width: out.w, height: out.h, before: out.before };
}

/** `…/1725800000000_photo.jpg` → `…/1757300000000_photo.webp`, same directory. */
function nextPath(oldPath, contentType) {
    const dir = oldPath.slice(0, oldPath.lastIndexOf('/') + 1);
    const file = oldPath.slice(dir.length);
    const base = (file.replace(/^\d+_/, '').replace(/\.[^.]+$/, '') || 'photo')
        .replace(/[^\w.\-]+/g, '_')
        .slice(0, 120);
    const ext = contentType === 'image/webp' ? 'webp' : 'jpg';
    return `${dir}${Date.now()}_${base}.${ext}`;
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

async function main() {
    const admin = require('firebase-admin');
    const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

    const args = process.argv.slice(2);
    const argVal = (name, def = null) => {
        const i = args.indexOf(name);
        return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : def;
    };
    const ONLY_WS = argVal('--workspace');
    const LIMIT = Number(argVal('--limit', '0')) || 0;
    const COMMIT = args.includes('--commit');
    const PRUNE = args.includes('--prune');
    const PRUNE_ORPHANS = args.includes('--prune-orphans');

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key first.');
        process.exit(1);
    }
    if (!admin.apps.length) {
        admin.initializeApp({
            projectId: 'fluxyos',
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app'
        });
    }
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const wsIdsFor = async () => (ONLY_WS
        ? [ONLY_WS]
        : (await db.collection('workspaces').get()).docs.map((d) => d.id));

    if (PRUNE_ORPHANS) {
        const ids = await wsIdsFor();
        let kept = 0; let orphans = 0; let freed = 0; let unreferenced = 0;
        console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} · pruning superseded photos`
            + ` · ${ids.length} workspace(s)\n`);
        for (const wsId of ids) {
            const items = await db.collection(`workspaces/${wsId}/items`).get();
            for (const doc of items.docs) {
                const inUse = typeof (doc.data() || {}).image_path === 'string'
                    ? doc.data().image_path : '';
                const prefix = `workspaces/${wsId}/items/${doc.id}/`;
                const [files] = await bucket.getFiles({ prefix });
                if (!files.length) continue;
                if (!inUse) {
                    // Nothing to compare against — say so, delete nothing.
                    unreferenced += files.length;
                    console.log(`  ? ${wsId}/${doc.id}: ${files.length} file(s), `
                        + 'no image_path — left alone');
                    continue;
                }
                for (const f of files) {
                    if (f.name === inUse) { kept += 1; continue; }
                    orphans += 1;
                    freed += Number((f.metadata || {}).size) || 0;
                    console.log(`  ${COMMIT ? '✓' : '·'} delete ${f.name}`
                        + ` (${kb(Number((f.metadata || {}).size) || 0)})`);
                    if (COMMIT) await f.delete().catch((e) => console.log(`     ✗ ${e.message}`));
                }
            }
        }
        console.log(`\n${kept} in use · ${orphans} superseded`
            + ` ${COMMIT ? 'deleted' : 'would be deleted'} · ${kb(freed)} freed`
            + (unreferenced ? ` · ${unreferenced} left alone (no image_path)` : ''));
        if (!COMMIT) console.log('\nDRY RUN — nothing was deleted. Re-run with --commit.\n');
        else console.log('');
        return;
    }

    const browser = await chromium.launch();
    const page = await browser.newPage();

    const wsIds = await wsIdsFor();

    let seen = 0; let done = 0; let skipped = 0; let failed = 0;
    let bytesBefore = 0; let bytesAfter = 0;

    console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} · ${wsIds.length} workspace(s)`
        + `${PRUNE ? ' · pruning originals' : ''}\n`);

    for (const wsId of wsIds) {
        const items = await db.collection(`workspaces/${wsId}/items`).get();
        for (const doc of items.docs) {
            if (LIMIT && seen >= LIMIT) break;
            const item = doc.data() || {};
            const oldPath = typeof item.image_path === 'string' ? item.image_path : '';
            if (!oldPath) continue;
            seen += 1;

            const label = `${wsId}/${doc.id} ${String(item.name || '').slice(0, 28)}`;
            try {
                const file = bucket.file(oldPath);
                const [meta] = await file.getMetadata();
                const size = Number(meta.size) || 0;
                // Already ours: never re-encode, at any size.
                if ((meta.metadata || {})[RIGHTSIZED_MARK]) { skipped += 1; continue; }
                // Cheap heuristic for anything this script has not written but
                // is plainly already the right shape.
                if (/\.webp$/i.test(oldPath) && size <= ALREADY_SMALL) {
                    skipped += 1;
                    continue;
                }

                const [buf] = await file.download();
                const sized = await rightSize(page, buf, meta.contentType);
                if (!sized) {
                    console.log(`  – ${label}: nothing to gain (${kb(size)})`);
                    skipped += 1;
                    continue;
                }

                bytesBefore += size;
                bytesAfter += sized.bytes.length;
                console.log(`  ${COMMIT ? '✓' : '·'} ${label}: ${kb(size)} → ${kb(sized.bytes.length)}`
                    + ` (${sized.before.w}x${sized.before.h} → ${sized.width}x${sized.height})`);

                if (!COMMIT) { done += 1; continue; }

                // ⚠️ ORDER MATTERS. Upload, then point the item at it, then and
                // only then remove the old object. Any other order leaves a
                // window where `image_path` names a file that is not there yet
                // or is already gone — and the till renders that as a broken
                // tile with nothing to say why.
                const newPath = nextPath(oldPath, sized.contentType);
                await bucket.file(newPath).save(sized.bytes, {
                    contentType: sized.contentType,
                    resumable: false,
                    metadata: { metadata: { [RIGHTSIZED_MARK]: RIGHTSIZED_VERSION } }
                });
                await doc.ref.update({
                    image_path: newPath,
                    updated_at: admin.firestore.FieldValue.serverTimestamp()
                });
                if (PRUNE) await file.delete().catch(() => { /* already gone is fine */ });
                done += 1;
            } catch (err) {
                failed += 1;
                console.log(`  ✗ ${label}: ${err && err.message}`);
            }
        }
        if (LIMIT && seen >= LIMIT) break;
    }

    await browser.close();

    const saved = bytesBefore - bytesAfter;
    console.log(`\n${seen} with photos · ${done} ${COMMIT ? 'rewritten' : 'would be rewritten'}`
        + ` · ${skipped} already fine · ${failed} failed`);
    if (bytesBefore) {
        console.log(`${kb(bytesBefore)} → ${kb(bytesAfter)}  (${kb(saved)} saved, `
            + `${Math.round((saved / bytesBefore) * 100)}%)`);
    }
    if (!COMMIT) console.log('\nDRY RUN — nothing was written. Re-run with --commit.\n');
    else console.log('');
}

module.exports = { rightSize, nextPath, MAX_EDGE, QUALITY, ALREADY_SMALL, RIGHTSIZED_MARK, RIGHTSIZED_VERSION };

// Only when invoked directly, so the check above can require the encoder
// without a service-account key.
if (require.main === module) {
    main().catch((err) => { console.error('\n✗ backfill threw:', err); process.exit(1); });
}
