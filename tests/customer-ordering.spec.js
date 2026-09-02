const { test, expect } = require('@playwright/test');

// =============================================================================
// The QR customer surface — the one page in the product loaded by someone who
// is not a FluxyOS customer, on their own phone, in a restaurant.
//
// EVERY ENDPOINT IS STUBBED. This is deliberate and not a shortcut: the page's
// contract with the server is exactly three HTTP calls, so stubbing them tests
// the contract instead of the weather. It also makes the assertion that matters
// most reachable — WHAT THE BROWSER SENDS — which no amount of clicking through
// a live system can inspect.
//
// IT RUNS ON WEBKIT TOO, and that is the point of half of it. The page is
// mobile-Safari-first and its central interactions are injected bottom sheets;
// on 2026-09-02 that combination produced a Safari-only failure on /bill.html
// (Chromium 420px vs WebKit 1440px for the same dialog) because the Tailwind
// Play CDN does not generate utilities for runtime DOM in time. This page
// carries no Tailwind for that reason, and the sheet-geometry assertions below
// are what keeps it true.
// =============================================================================

const TOKEN = 'tok_playwright_fixture_0001';

// A 1x1 transparent PNG — enough to prove the tile requests and paints a photo.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

const MENU = {
    outlet: 'Kopi Senja Kemang',
    table: 'A04',
    currency: 'IDR',
    categories: ['Kopi', 'Makanan'],
    items: [
        {
            id: 'i_latte', name: 'Es Kopi Susu', category: 'Kopi', price: 28000,
            has_image: true,
            modifier_groups: [
                {
                    id: 'g_size', name: 'Ukuran', select: 'one_required',
                    options: [
                        { id: 'o_reg', name: 'Regular', price_delta: 0 },
                        { id: 'o_large', name: 'Large', price_delta: 6000 }
                    ]
                },
                {
                    id: 'g_extra', name: 'Tambahan', select: 'many',
                    options: [{ id: 'o_shot', name: 'Extra shot', price_delta: 5000 }]
                }
            ]
        },
        { id: 'i_americano', name: 'Americano', category: 'Kopi', price: 22000, has_image: false, modifier_groups: [] },
        { id: 'i_nasgor', name: 'Nasi Goreng Kampung', category: 'Makanan', price: 45000, has_image: false, modifier_groups: [] }
    ]
};

/** Stub the three public endpoints and capture what the page POSTs. */
async function stub(page, { menuStatus = 200, capture = {} } = {}) {
    await page.route('**/qr-menu?**', (route) => route.fulfill({
        status: menuStatus,
        contentType: 'application/json',
        body: JSON.stringify(menuStatus === 200 ? MENU : { error: 'not_found' })
    }));
    await page.route('**/qr-menu-image?**', (route) => route.fulfill({
        status: 200, contentType: 'image/png', body: PNG
    }));
    await page.route('**/qr-order', async (route) => {
        capture.body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true, order_id: 'ord_1', order_number: '2026-09-03-007',
                total_amount: 99000, rejected_lines: 0
            })
        });
    });
}

const open = (page) => page.goto(`/order.html?t=${TOKEN}`);

test.describe('QR customer ordering', () => {
    test.use({ viewport: { width: 390, height: 844 } });   // iPhone-sized, the real case

    test('renders the menu for the scanned table', async ({ page }) => {
        await stub(page);
        await open(page);

        // The diner must know WHERE they are before anything else: a menu with
        // no table is a menu that will send food to the wrong place.
        await expect(page.locator('#outlet-name')).toHaveText('Kopi Senja Kemang');
        await expect(page.locator('#table-label')).toHaveText('Meja A04');

        await expect(page.locator('.row')).toHaveCount(3);
        await expect(page.locator('.row-name').first()).toBeVisible();

        // Rp with NO space, dot thousands. The rule is stated in three docs and
        // the prototype this page came from got it wrong throughout.
        await expect(page.locator('.row', { hasText: 'Americano' }).locator('.row-price'))
            .toHaveText('Rp22.000');

        // Numbers must not be monospace — a monospace face renders a slashed
        // zero and is banned project-wide.
        const family = await page.locator('.row-price').first()
            .evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
        expect(family).toContain('inter');
        expect(family).not.toContain('mono');
        expect(family).not.toContain('fira');
    });

    test('a photo loads and keeps its aspect ratio', async ({ page }) => {
        await stub(page);
        await open(page);

        const img = page.locator('.row', { hasText: 'Es Kopi Susu' }).locator('.thumb img');
        await expect(img).toBeVisible();
        // `contain`, matching the till exactly. `cover` crops the part of a dish
        // that identifies it, and the SAME photo appears on both surfaces — one
        // of them would be wrong and nobody could tell which.
        await expect(img).toHaveCSS('object-fit', 'contain');

        // An item with no photo gets no tile at all, not an empty box.
        await expect(page.locator('.row', { hasText: 'Americano' }).locator('.thumb')).toHaveCount(0);
    });

    test('category chips and search narrow the menu', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.chip', { hasText: 'Makanan' }).click();
        await expect(page.locator('.row')).toHaveCount(1);
        await expect(page.locator('.row-name')).toHaveText('Nasi Goreng Kampung');

        await page.locator('.chip', { hasText: 'Semua' }).click();
        await expect(page.locator('.row')).toHaveCount(3);

        await page.locator('#search').fill('nasi');
        await expect(page.locator('.row')).toHaveCount(1);

        await page.locator('#search').fill('zzz');
        await expect(page.locator('.empty')).toBeVisible();
    });

    test('an item with no options adds in one tap', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.row', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();

        await expect(page.locator('#cartbar')).toHaveClass(/is-open/);
        await expect(page.locator('#cart-count')).toHaveText('1');
        await expect(page.locator('#cart-total')).toHaveText('Rp22.000');

        // The row becomes a stepper, so a second one does not need the sheet.
        await page.locator('.row', { hasText: 'Americano' }).locator('[data-inc]').click();
        await expect(page.locator('#cart-total')).toHaveText('Rp44.000');
        await page.locator('.row', { hasText: 'Americano' }).locator('[data-dec]').click();
        await expect(page.locator('#cart-total')).toHaveText('Rp22.000');
    });

    test('the option sheet is laid out correctly and priced live', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.row', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
        const sheet = page.locator('#sheet-item');
        await expect(sheet).toHaveClass(/is-open/);

        // ── THE WEBKIT ASSERTION ────────────────────────────────────────────
        // A bottom sheet must be at most the viewport wide, anchored to the
        // bottom, and shorter than the screen. This is precisely what failed in
        // Safari when the structure came from CDN-generated utilities: the
        // dialog rendered as a raw full-width block, 1440px in a 420px frame.
        const vw = page.viewportSize();
        // Polled, because `is-open` is set the instant the class lands and the
        // sheet then SLIDES for 260ms. Measuring immediately catches it still
        // below the fold and reports a layout bug that is really a stopwatch
        // bug — while a sheet that genuinely never arrives still fails here.
        await expect.poll(async () => {
            const b = await sheet.boundingBox();
            return Math.round((b.y + b.height) - vw.height);
        }, { timeout: 3_000 }).toBeLessThanOrEqual(1);

        const box = await sheet.boundingBox();
        expect(box.width).toBeLessThanOrEqual(vw.width + 1);
        expect(box.height).toBeLessThan(vw.height);
        // On screen, not scrolled off the top.
        expect(box.y).toBeGreaterThan(0);

        // A required group with nothing chosen blocks the add, so the kitchen
        // never receives a half-specified line.
        await expect(page.locator('#item-add')).toBeDisabled();

        await page.locator('.opt', { hasText: 'Large' }).locator('input').check();
        await expect(page.locator('#item-add')).toBeEnabled();
        await expect(page.locator('#item-add-total')).toHaveText('Rp34.000');   // 28.000 + 6.000

        await page.locator('.opt', { hasText: 'Extra shot' }).locator('input').check();
        await expect(page.locator('#item-add-total')).toHaveText('Rp39.000');   // + 5.000

        await page.locator('#item-add').click();
        await expect(sheet).not.toHaveClass(/is-open/);
        await expect(page.locator('#cart-total')).toHaveText('Rp39.000');
    });

    test('the cart sheet edits quantities and totals correctly', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.row', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.row', { hasText: 'Nasi Goreng' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('#cart-open').click();

        const cart = page.locator('#sheet-cart');
        await expect(cart).toHaveClass(/is-open/);
        await expect(cart.locator('.cartline')).toHaveCount(2);
        await expect(cart.locator('.totals .grand .num')).toHaveText('Rp67.000');

        await cart.locator('[data-cinc]').first().click();
        await expect(cart.locator('.totals .grand .num')).toHaveText('Rp89.000');
        await cart.locator('[data-cdec]').first().click();
        await cart.locator('[data-cdec]').first().click();
        await expect(cart.locator('.cartline')).toHaveCount(1);
        await expect(cart.locator('.totals .grand .num')).toHaveText('Rp45.000');
    });

    test('THE BROWSER SENDS NO PRICES — only ids and quantities', async ({ page }) => {
        const capture = {};
        await stub(page, { capture });
        await open(page);

        // One plain item and one with two options, so the payload covers both.
        await page.locator('.row', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.row', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.opt', { hasText: 'Large' }).locator('input').check();
        await page.locator('.opt', { hasText: 'Extra shot' }).locator('input').check();
        // TYPING THE NOTE BEFORE THE TAP IS THE POINT, not incidental colour.
        // On WebKit the tap blurs the textarea, the blur fires `change`, and a
        // DOM mutation in that handler made Safari drop the click outright —
        // the diner tapped "Tambah" and nothing happened. Chromium dispatches
        // the click either way, so this sequence is the only thing that catches
        // it. Keep the fill immediately before the click.
        await page.locator('#item-note').fill('tidak terlalu manis');
        await page.locator('#item-add').click();
        await expect(page.locator('#cart-count')).toHaveText('2');

        await page.locator('#cart-open').click();
        await page.locator('#cust-name').fill('Sinta');
        await page.locator('#cart-submit').click();
        await expect(page.locator('#view-done')).toBeVisible();

        const body = capture.body;
        expect(body.token).toBe(TOKEN);
        expect(body.customer_name).toBe('Sinta');
        expect(body.lines).toHaveLength(2);

        // The whole point. A price anywhere in this payload means the server has
        // something it could be tempted to trust.
        const serialized = JSON.stringify(body);
        for (const forbidden of ['price', 'unit_price', 'amount', 'total', 'delta']) {
            expect(serialized).not.toContain(forbidden);
        }

        const latte = body.lines.find((l) => l.item_id === 'i_latte');
        expect(latte.quantity).toBe(1);
        expect(latte.options.sort()).toEqual(['o_large', 'o_shot']);
        expect(latte.note).toBe('tidak terlalu manis');

        // A client_ref must ride along, or a retried POST on restaurant wifi
        // becomes a second kitchen ticket and a double bill.
        expect(typeof body.client_ref).toBe('string');
        expect(body.client_ref.length).toBeGreaterThan(8);
    });

    test('the confirmation shows the order number and clears the cart', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.row', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();

        await expect(page.locator('#done-number')).toHaveText('2026-09-03-007');
        // The cart bar must not hover over the confirmation offering to re-send
        // an order that has already been sent.
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);

        await page.locator('#done-more').click();
        await expect(page.locator('#view-menu')).toBeVisible();
        await expect(page.locator('#cart-count')).toHaveText('0');
    });

    test('a dead token says so instead of showing an empty menu', async ({ page }) => {
        await stub(page, { menuStatus: 404 });
        await open(page);

        await expect(page.locator('#view-error')).toBeVisible();
        await expect(page.locator('#view-menu')).toBeHidden();
        await expect(page.locator('#error-title')).toHaveText('Kode ini tidak aktif');
    });

    test('no token at all is a clear instruction, not a broken page', async ({ page }) => {
        await stub(page);
        await page.goto('/order.html');
        await expect(page.locator('#error-title')).toHaveText('Kode meja tidak ditemukan');
    });

    test('the page loads no Tailwind and no Firebase', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => requested.push(r.url()));
        await stub(page);
        await open(page);
        await expect(page.locator('.row').first()).toBeVisible();

        // Both are deliberate absences with a documented reason, and both are
        // the kind of thing a later "just add the SDK" edit would reintroduce
        // without anyone noticing.
        expect(requested.filter((u) => u.includes('tailwind'))).toHaveLength(0);
        expect(requested.filter((u) => u.includes('firebase') || u.includes('gstatic.com/firebasejs')))
            .toHaveLength(0);
    });

    test('the console stays clean', async ({ page }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));

        await stub(page);
        await open(page);
        await page.locator('.row', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.opt', { hasText: 'Large' }).locator('input').check();
        await page.locator('#item-add').click();
        await page.locator('#cart-open').click();

        expect(errors).toEqual([]);
    });
});
