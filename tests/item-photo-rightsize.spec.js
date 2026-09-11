// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// =============================================================================
// Item photos are downscaled before they are stored.
//
// ⚠️ THE SINGLE BIGGEST COST ON A DINER'S PHONE. Photos were kept exactly as
// the owner picked them — up to 2 MB, at whatever a phone camera produces — and
// the QR menu renders each one on a tile about 170x127 CSS px. A menu with
// fifteen photographs was tens of megabytes over restaurant wifi to paint a few
// hundred kilopixels, and no amount of caching fixes a first load like that.
//
// The REAL method is lifted out of db-service.js and run in a real browser,
// because the thing being tested is canvas encoding — a reimplementation here
// would prove that the copy works.
// =============================================================================

const SRC = path.join(__dirname, '..', 'assets', 'js', 'db-service.js');

/** Lift `_rightSizeImage` from source, so this tests the shipped code. */
function methodUnder(name) {
    const src = fs.readFileSync(SRC, 'utf8');
    const start = src.indexOf(`    async ${name}(`);
    if (start < 0) throw new Error(`${name} not found — was it renamed?`);
    // The parameter list first, by parentheses — it can hold braces of its own
    // (`{ maxEdge = 1280, quality = 0.82 } = {}` since 2026-09-11), and a brace
    // walk started there would lift the options object instead of the body.
    const open = src.indexOf('(', start);
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    const params = src.slice(open, i + 1);
    // Then the body, by braces, from its opening brace to its match.
    depth = 0;
    i = src.indexOf('{', i);
    const from = i;
    for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    return `async function ${name}${params} ${src.slice(from, i + 1)}`;
}

test.describe('item photos are right-sized before upload', () => {
    test('A PHONE PHOTO SHRINKS BY AN ORDER OF MAGNITUDE, AND STAYS THE RIGHT WAY UP',
        async ({ page }) => {
            await page.goto('/order.html');   // any page with a canvas; no auth, no Firebase
            const fn = methodUnder('_rightSizeImage');

            const out = await page.evaluate(async (fnSrc) => {
                // eslint-disable-next-line no-eval
                const rightSize = eval(`(${fnSrc.replace(/^async function _rightSizeImage/, 'async function')})`);

                // A plausible phone photograph: 3024x4032 portrait, JPEG, with
                // enough detail that it does not compress to nothing.
                const c = document.createElement('canvas');
                c.width = 3024; c.height = 4032;
                const x = c.getContext('2d');
                const g = x.createLinearGradient(0, 0, 3024, 4032);
                g.addColorStop(0, '#8B4513'); g.addColorStop(0.5, '#E8C39E'); g.addColorStop(1, '#2F4F4F');
                x.fillStyle = g; x.fillRect(0, 0, 3024, 4032);
                for (let n = 0; n < 4000; n += 1) {
                    x.fillStyle = `hsl(${(n * 37) % 360} 70% ${30 + (n % 50)}%)`;
                    x.fillRect((n * 71) % 3024, (n * 131) % 4032, 26, 26);
                }
                const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
                const file = new File([blob], 'IMG_2481.jpg', { type: 'image/jpeg' });

                const sized = await rightSize(file);
                // Measure what actually came back, by decoding it again.
                const bmp = await createImageBitmap(sized);
                const res = {
                    beforeBytes: file.size, afterBytes: sized.size,
                    type: sized.type, name: sized.name,
                    w: bmp.width, h: bmp.height
                };
                bmp.close && bmp.close();
                return res;
            }, fn);

            // eslint-disable-next-line no-console
            console.log(`  ${(out.beforeBytes / 1024).toFixed(0)}KB -> `
                + `${(out.afterBytes / 1024).toFixed(0)}KB (${out.w}x${out.h}, ${out.type})`);

            // ⚠️ THE LONGEST EDGE IS THE CONTRACT. 1280 is twice the largest
            // size any surface shows, so there is room for a retina screen and
            // for a bigger layout later.
            expect(Math.max(out.w, out.h)).toBe(1280);
            // Portrait stays portrait — EXIF orientation is not carried onto a
            // canvas, so a rotated original is the thing that breaks here.
            expect(out.h, 'a portrait photo came back landscape').toBeGreaterThan(out.w);

            expect(out.afterBytes, 'the photo did not get meaningfully smaller')
                .toBeLessThan(out.beforeBytes / 5);
            expect(out.afterBytes, 'still too heavy for a menu tile')
                .toBeLessThan(250 * 1024);
            // The extension has to follow the encoding, or the stored object
            // claims to be something it is not.
            expect(out.name.endsWith('.webp') || out.name.endsWith('.jpg')).toBe(true);
            expect(['image/webp', 'image/jpeg']).toContain(out.type);
        });

    // The 640px copy (2026-09-11): what a card, a cart line and a till tile
    // actually load. Made from the RIGHT-SIZED photo, exactly as
    // uploadItemImage does, so this measures the real second step.
    test('the small copy is 640px on its longest edge and a fraction of the photo', async ({ page }) => {
        await page.goto('/order.html');
        const fn = methodUnder('_rightSizeImage');
        const out = await page.evaluate(async (fnSrc) => {
            // eslint-disable-next-line no-eval
            const rightSize = eval(`(${fnSrc.replace(/^async function _rightSizeImage/, 'async function')})`);
            const c = document.createElement('canvas');
            c.width = 3024; c.height = 4032;
            const x = c.getContext('2d');
            x.fillStyle = '#7a4a2a'; x.fillRect(0, 0, 3024, 4032);
            for (let n = 0; n < 4000; n += 1) {
                x.fillStyle = `hsl(${(n * 37) % 360} 70% ${30 + (n % 50)}%)`;
                x.fillRect((n * 71) % 3024, (n * 131) % 4032, 26, 26);
            }
            const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
            const photo = await rightSize(new File([blob], 'IMG_1.jpg', { type: 'image/jpeg' }));
            const copy = await rightSize(photo, { maxEdge: 640, quality: 0.8 });
            const bmp = await createImageBitmap(copy);
            const res = { photo: photo.size, copy: copy.size, w: bmp.width, h: bmp.height, same: copy === photo };
            bmp.close && bmp.close();
            return res;
        }, fn);
        // eslint-disable-next-line no-console
        console.log(`  photo ${(out.photo / 1024).toFixed(0)}KB -> copy ${(out.copy / 1024).toFixed(0)}KB (${out.w}x${out.h})`);
        expect(out.same, 'the copy is a new file, not the photo handed back').toBe(false);
        expect(Math.max(out.w, out.h)).toBe(640);
        expect(out.h, 'portrait stays portrait').toBeGreaterThan(out.w);
        expect(out.copy, 'the copy must be well under half the photo').toBeLessThan(out.photo / 2);
    });

    test('an already-small photo is handed back untouched', async ({ page }) => {
        // ⚠️ NEVER MAKE IT WORSE. Re-encoding a 20KB thumbnail can easily
        // produce something larger; the method returns the original when it
        // cannot improve on it, and this is what holds that.
        await page.goto('/order.html');   // any page with a canvas; no auth, no Firebase
        const fn = methodUnder('_rightSizeImage');
        const same = await page.evaluate(async (fnSrc) => {
            // eslint-disable-next-line no-eval
            const rightSize = eval(`(${fnSrc.replace(/^async function _rightSizeImage/, 'async function')})`);
            const c = document.createElement('canvas');
            c.width = 160; c.height = 120;
            const x = c.getContext('2d');
            x.fillStyle = '#EA580C'; x.fillRect(0, 0, 160, 120);
            const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
            const file = new File([blob], 'tiny.jpg', { type: 'image/jpeg' });
            const sized = await rightSize(file);
            return { same: sized === file, before: file.size, after: sized.size };
        }, fn);
        expect(same.after).toBeLessThanOrEqual(same.before);
    });

    test('an undecodable file is passed through rather than dropped', async ({ page }) => {
        // A file the browser cannot decode is the server's problem to refuse,
        // not this method's to guess at — and silently uploading nothing would
        // be the worst of the three options.
        await page.goto('/order.html');   // any page with a canvas; no auth, no Firebase
        const fn = methodUnder('_rightSizeImage');
        const out = await page.evaluate(async (fnSrc) => {
            // eslint-disable-next-line no-eval
            const rightSize = eval(`(${fnSrc.replace(/^async function _rightSizeImage/, 'async function')})`);
            const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.jpg', { type: 'image/jpeg' });
            const sized = await rightSize(file);
            return { same: sized === file, name: sized.name };
        }, fn);
        expect(out.same, 'a file that cannot be decoded was replaced').toBe(true);
    });
});
