const { test, expect } = require('@playwright/test');

// =============================================================================
// Product photos on the POS card.
//
// Optional everywhere, and the two things that matter about them:
//
// 1. THE RATIO IS KEPT. `object-fit: contain`, not `cover`. Both preserve the
//    image's own proportions; `cover` does it by CROPPING to fill the tile, and
//    on a menu the part that gets cut is often the part that identifies the
//    product — the neck of a bottle, the ends of a platter. The tile itself
//    stays a fixed 4:3 so the grid keeps one rhythm; letting each card take its
//    photo's height would rag the catalogue and move every tap target the moment
//    an image finished loading, which on a till is worse than a letterbox.
//
// 2. NO PUBLIC URL EVER. `getDownloadURL()` mints a permanent link that Firebase
//    serves with Security Rules BYPASSED — this codebase removed it from the
//    document path for exactly that reason, and proved the hole by fetching one
//    with curl and getting HTTP 200. A menu photo behind one would make a
//    workspace's products readable by anyone who ever saw the link. What is
//    stored on the item is a STORAGE PATH; the till resolves it through an
//    authenticated read into a short-lived, origin-bound blob URL.
//
// The upload half writes to real Storage and reads back through real
// storage.rules, because `storage.rules` does not ship with `git push` — it is a
// separate deploy, and a spec that only tested the rendering would go green
// against rules that were never released.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

// A 4x3 PNG. Tiny on purpose — this proves the path, not the pixels.
const PNG_4x3 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAHElEQVQIW2NkYGD4z'
    + 'wAFjDAGNgFsijASsCnCKgcAVfIDATT7lLcAAAAASUVORK5CYII=';

test('a product photo round-trips to Storage and never becomes a public URL', async ({ page }) => {
    await page.goto('/inventory.html');
    // `attached`, not visible: the file input is deliberately hidden and driven
    // by the "Choose image" button, so waiting for visibility waits forever.
    await page.waitForSelector('#item-photo-file', { state: 'attached', timeout: 30000 });
    // The DOM is ready well before AUTH is, and `_scope()` needs a resolved
    // workspace or the upload lands outside the shared tree. Waiting on the
    // signed-in user is the page's own readiness signal.
    await page.waitForFunction(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        if (!getApps().length) return false;
        const auth = getAuth(getApps()[0]);
        await auth.authStateReady();
        return !!auth.currentUser;
    }, null, { timeout: 40000 });

    const result = await page.evaluate(async (b64) => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;

        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'spec-photo.png', { type: 'image/png' });

        // A real item, so the storage path is keyed by a real id.
        const item = await ds.saveItem(uid, {
            name: `QA Photo Item ${Date.now()}`,
            type: 'stock',
            base_unit: 'pcs'
        }, { create: true });

        const up = await ds.uploadItemImage(uid, item.id, file);
        // setItemImage, not saveItem — saveItem validates a whole item draft and
        // refuses a payload carrying only a photo. This spec found that.
        await ds.setItemImage(uid, item.id, up.storagePath);

        // Read it back the way the till does: authenticated, no download token.
        const url = await ds.getItemImageObjectURL(uid, up.storagePath);
        const readBack = (await ds.getItems(uid)).find((i) => i.id === item.id);

        return {
            itemId: item.id,
            storagePath: up.storagePath,
            objectUrl: url,
            storedOnItem: readBack ? readBack.image_path : null,
            // Whatever the till renders must not be a firebasestorage.googleapis
            // link — that is the shape a download token produces.
            looksPublic: /^https?:\/\//i.test(url)
        };
    }, PNG_4x3);

    // The upload really happened against real rules. Before `storage.rules` was
    // deployed this threw permission-denied, which is the point of testing it.
    expect(result.storagePath).toMatch(/^workspaces\/[^/]+\/items\/[^/]+\//);
    expect(result.storedOnItem, 'the path did not survive the round trip to Firestore')
        .toBe(result.storagePath);

    // The read is a blob: URL — origin-bound, dead when the tab closes, and
    // impossible to paste into a chat and open elsewhere.
    expect(result.objectUrl.startsWith('blob:'), `expected a blob URL, got ${result.objectUrl}`).toBe(true);
    expect(result.looksPublic, 'a public download URL reached the till').toBe(false);
});

test('the card shows the whole photo, undistorted, and falls back to the initial', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await page.waitForSelector('#pos-new-order:not([disabled])', { timeout: 40000 });

    // Seed one menu item WITH a photo and one without, so both branches of the
    // card render in the same pass.
    const shape = await page.evaluate(async (b64) => {
        const host = document.getElementById('pos-menu');
        // Render the two card shapes directly. The image itself is a data: URL
        // here rather than a Storage round trip — this test is about the CSS
        // contract, and the round trip is proven by the spec above.
        host.innerHTML = `
            <button type="button" class="pos-card has-image" data-item="withimg">
                <span class="pos-card-media">
                    <img alt="" src="data:image/png;base64,${b64}">
                </span>
                <span class="pos-card-name">With photo</span>
            </button>
            <button type="button" class="pos-card" data-item="noimg">
                <span class="pos-card-media"><span class="pos-card-initial">NP</span></span>
                <span class="pos-card-name">No photo</span>
            </button>`;
        host.classList.remove('hidden');
        // `has-images` sits on the GRID, not the card. Once any visible item has
        // a photo every tile takes the 4:3 shape, so a part-illustrated menu does
        // not rag — a card with a picture standing 70px taller than the one
        // beside it read as broken rather than as partly illustrated.
        host.classList.add('has-images');
        const img = host.querySelector('img');
        await img.decode().catch(() => {});
        const media = img.closest('.pos-card-media');
        const mediaBox = media.getBoundingClientRect();
        const plainBox = host.querySelector('.pos-card:not(.has-image) .pos-card-media')
            .getBoundingClientRect();
        return {
            objectFit: getComputedStyle(img).objectFit,
            mediaRatio: mediaBox.width / mediaBox.height,
            // The photo-less card gets the SAME tile, which is what keeps the
            // grid on one rhythm.
            plainRatio: plainBox.width / plainBox.height,
            fallbackVisible: !!host.querySelector('.pos-card:not(.has-image) .pos-card-initial')
        };
    }, PNG_4x3);

    // CONTAIN is the whole requirement: the image is scaled to fit, never
    // stretched and never cropped.
    expect(shape.objectFit, 'cover crops the photo — the ratio is kept but the product is cut')
        .toBe('contain');
    // The TILE is a fixed 4:3, so the grid keeps its rhythm whatever shape the
    // photos are. The image letterboxes inside it.
    expect(shape.mediaRatio).toBeGreaterThan(1.25);
    expect(shape.mediaRatio).toBeLessThan(1.42);
    // Every card in an illustrated grid shares the tile, photo or not.
    expect(Math.abs(shape.plainRatio - shape.mediaRatio),
        'a photo-less card kept a different tile height — the grid rags').toBeLessThan(0.05);
    // An item with no photo still gets its initial — the state the till had
    // before images existed, which is what a failed load degrades to.
    expect(shape.fallbackVisible, 'an item without a photo lost its initial').toBe(true);
});

test('the till projects image_path — the whitelist that has dropped fields twice', async ({ page }) => {
    // `getPosMenu` maps an explicit field list. A field added to `items` and not
    // added there arrives as undefined and the feature silently does nothing,
    // which is exactly how pos_modifier_groups and barcode each failed on their
    // first cut. This asserts the projection rather than trusting it.
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    const projected = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const menu = await ds.getPosMenu(getAuth(getApps()[0]).currentUser.uid);
        return menu.length ? Object.prototype.hasOwnProperty.call(menu[0], 'image_path') : 'empty-menu';
    });
    expect(projected, 'image_path is missing from the getPosMenu projection').not.toBe(false);
});
