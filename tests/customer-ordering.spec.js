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
    await page.route('**/qr-order-status?**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(capture.status || { has_order: false, lines: [] })
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

// ⚠️ THE PRINTED ROUTE, NOT `/order.html?t=`.
//
// This spec used the query form until 2026-09-03 and that is exactly how a
// silent money bug reached production: under `/t/<token>` a RELATIVE
// `assets/js/money-format.js` resolves to `/t/assets/js/money-format.js`, the
// `/t/*` rule rewrites it to this same page, the browser gets 200-with-HTML
// instead of a script, `window.FluxyMoney` is undefined, and every price on
// the menu renders `20000` instead of `Rp20.000`. No error, no crash, a
// plausible wrong number on a diner's phone.
//
// The query form exercised none of that. Drive what is printed on the card.
const goTo = (page) => page.goto(`/t/${TOKEN}`);

// Load AND clear the identity gate. Almost every test needs the menu, and the
// gate is deliberately not dismissible any other way — see the dedicated tests
// below for the gate's own behaviour.
async function open(page) {
    await goTo(page);
    const gate = page.locator('#sheet-welcome');
    await expect(gate).toHaveClass(/is-open/, { timeout: 15_000 });
    await page.locator('#welcome-name').fill('Sinta');
    await page.locator('#welcome-phone').fill('0812 3456 7890');
    await page.locator('#welcome-go').click();
    await expect(gate).not.toHaveClass(/is-open/);
}

test.describe('QR customer ordering', () => {
    test.use({ viewport: { width: 390, height: 844 } });   // iPhone-sized, the real case

    test('renders the menu for the scanned table', async ({ page }) => {
        await stub(page);
        await open(page);

        // The diner must know WHERE they are before anything else: a menu with
        // no table is a menu that will send food to the wrong place.
        await expect(page.locator('#outlet-name')).toHaveText('Kopi Senja Kemang');
        await expect(page.locator('#table-label')).toHaveText('Meja A04');

        await expect(page.locator('.card')).toHaveCount(3);
        await expect(page.locator('.card-name').first()).toBeVisible();

        // Rp with NO space, dot thousands. The rule is stated in three docs and
        // the prototype this page came from got it wrong throughout.
        await expect(page.locator('.card', { hasText: 'Americano' }).locator('.card-price'))
            .toHaveText('Rp22.000');

        // Numbers must not be monospace — a monospace face renders a slashed
        // zero and is banned project-wide.
        const family = await page.locator('.card-price').first()
            .evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
        expect(family).toContain('inter');
        expect(family).not.toContain('mono');
        expect(family).not.toContain('fira');
    });

    test('THE MONEY SEAM LOADS UNDER THE PRINTED /t/ ROUTE', async ({ page }) => {
        await stub(page);
        await open(page);

        // The regression this exists for. A relative asset path under /t/ is
        // swallowed by the /t/* rewrite and comes back as HTML with a 200, so
        // the failure is not a 404 and not an exception — it is FluxyMoney
        // quietly missing and every amount rendering as a bare integer.
        const hasMoney = await page.evaluate(() => typeof window.FluxyMoney === 'object'
            && typeof window.FluxyMoney.formatBase === 'function');
        expect(hasMoney, 'window.FluxyMoney did not load under /t/<token>').toBe(true);

        // Stated twice on purpose: the seam being present, and a rendered price
        // actually carrying the symbol. A future page could load the script and
        // still forget to route an amount through it.
        await expect(page.locator('.card', { hasText: 'Americano' }).locator('.card-price'))
            .toHaveText('Rp22.000');
        const anyBare = await page.evaluate(() => [...document.querySelectorAll('.card-price')]
            .some((el) => /^\s*\d+\s*$/.test(el.textContent)));
        expect(anyBare, 'a price rendered as a bare integer — the money seam is missing').toBe(false);
    });

    test('every asset the page loads is reachable under /t/', async ({ page }) => {
        // The general form of the same defect: any relative src/href on this
        // page resolves under /t/ and silently returns the page itself.
        const wrong = [];
        page.on('response', (r) => {
            const u = new URL(r.url());
            if (!/\.(js|css|svg|png|woff2?)$/.test(u.pathname)) return;
            const type = r.headers()['content-type'] || '';
            if (type.includes('text/html')) wrong.push(`${u.pathname} -> ${type}`);
        });
        await stub(page);
        await open(page);
        await expect(page.locator('.card').first()).toBeVisible();
        expect(wrong, `asset(s) served as HTML by the /t/* rewrite:\n  ${wrong.join('\n  ')}`)
            .toEqual([]);
    });

    test('THE IDENTITY GATE BLOCKS ORDERING UNTIL IT IS FILLED', async ({ page }) => {
        await stub(page);
        await goTo(page);

        const gate = page.locator('#sheet-welcome');
        await expect(gate).toHaveClass(/is-open/, { timeout: 15_000 });
        // Asked AFTER the menu paints. A form on a blank screen gives the diner
        // nothing to judge the request against.
        await expect(page.locator('.card').first()).toBeVisible();
        // Two fields and a button — no explanatory paragraph. The labels say
        // what is wanted and the sheet title says why.
        await expect(page.locator('.welcome-lead')).toHaveCount(0);
        await expect(gate).not.toContainText('Isi data Anda sekali saja');

        // It is not dismissible by any of the usual routes.
        await page.locator('#scrim').click({ position: { x: 10, y: 10 } });
        await expect(gate).toHaveClass(/is-open/);
        await page.keyboard.press('Escape');
        await expect(gate).toHaveClass(/is-open/);

        // Empty is refused, and says which field.
        await page.locator('#welcome-go').click();
        await expect(gate).toHaveClass(/is-open/);
        await expect(page.locator('#welcome-error')).toContainText('nama');
        await expect(page.locator('#welcome-name')).toHaveClass(/invalid/);

        // A short number is refused too — nine digits is the shortest real
        // Indonesian mobile.
        await page.locator('#welcome-name').fill('Sinta');
        await page.locator('#welcome-phone').fill('0812');
        await page.locator('#welcome-go').click();
        await expect(gate).toHaveClass(/is-open/);
        await expect(page.locator('#welcome-phone')).toHaveClass(/invalid/);

        // Digits are counted, not characters, so a formatted number passes.
        await page.locator('#welcome-phone').fill('+62 812-3456-7890');
        await page.locator('#welcome-go').click();
        await expect(gate).not.toHaveClass(/is-open/);
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);
    });

    test('a returning diner is not asked twice', async ({ page }) => {
        await stub(page);
        await open(page);                       // fills the gate
        await page.reload();
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });
        // Same browser, same person — the second round goes straight to food.
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);

        // And the identity still rides on the order.
        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('#cart-open').click();
        await expect(page.locator('#sheet-cart')).toContainText('Sinta');
    });

    test('the menu is a two-column grid', async ({ page }) => {
        await stub(page);
        await open(page);

        const grid = page.locator('.grid').first();
        await expect(grid).toBeVisible();
        expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length))
            .toBe(2);

        // Two cards per row means two cards sharing a top edge.
        const boxes = await page.locator('.card').evaluateAll((els) =>
            els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(boxes[0]).toBe(boxes[1]);

        // Every media tile is 4:3 and identical, photo or placeholder. A square
        // source image once stretched its tile and left the grid ragged —
        // `height: 100%` in an aspect-ratio box resolves to auto.
        const tiles = await page.locator('.card-media').evaluateAll((els) => els.map((e) => {
            const r = e.getBoundingClientRect();
            return { ratio: +(r.width / r.height).toFixed(2), h: Math.round(r.height) };
        }));
        tiles.forEach((t) => expect(t.ratio).toBeCloseTo(1.33, 1));
        expect(new Set(tiles.map((t) => t.h)).size,
            'media tiles are not all the same height — the grid will look ragged').toBe(1);
    });

    test('category tabs carry drawn icons, not emoji', async ({ page }) => {
        await stub(page);
        await open(page);

        const tabs = page.locator('#chips .chip');
        await expect(tabs).toHaveCount(3);                 // Semua + two categories
        await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');

        // Every tab has an inline SVG. Emoji are a per-device font lottery: the
        // same category renders as a flat glyph on one Android, a 3D sticker on
        // an iPhone, and a blank box on some.
        for (let i = 0; i < 3; i += 1) {
            await expect(tabs.nth(i).locator('.cat-ico svg')).toBeVisible();
        }
        const text = await page.locator('#chips').innerText();
        expect(/\p{Extended_Pictographic}/u.test(text), 'an emoji reached the category rail').toBe(false);

        // The icon is matched on keywords in the free-string category name —
        // there is no category entity to key off. Kopi must not get the same
        // glyph as Makanan.
        const paths = await tabs.evaluateAll((els) =>
            els.map((e) => e.querySelector('.cat-ico svg').innerHTML));
        expect(new Set(paths).size, 'every category drew the same icon').toBe(3);
    });

    test('the floating tab bar sits clear of the bottom edge', async ({ page }) => {
        await stub(page);
        await open(page);

        const bar = page.locator('.tabbar-inner');
        await expect(bar).toBeVisible();
        const box = await bar.boundingBox();
        const vh = page.viewportSize().height;
        // Detached, not pinned: the bottom edge is where the thumb rests and
        // where iOS puts its home indicator, so a bar flush to it collects
        // accidental taps.
        expect(vh - (box.y + box.height)).toBeGreaterThan(6);

        // TWO tabs. A "Keranjang" tab used to sit here opening the same sheet
        // the floating cart bar opens — one action behind two controls, which
        // made the prominent one compete with itself.
        await expect(page.locator('.tab')).toHaveCount(2);
        await expect(page.locator('.tab[data-tab="cart"]')).toHaveCount(0);
        await expect(page.locator('.tab[data-tab="help"]')).toHaveCount(0);

        // The active tab is ORANGE — the brand accent, as a colour and a 10%
        // wash, never a filled orange background.
        const active = page.locator('.tab[aria-current="true"]');
        await expect(active).toHaveCSS('color', 'rgb(234, 88, 12)');
        const bg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg).toContain('rgba(234, 88, 12');

        // The cart bar floats ABOVE the tab bar — they must never overlap.
        // Polled, because it SLIDES in over 240ms.
        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await expect.poll(async () => {
            const c = await page.locator('#cartbar button').boundingBox();
            return Math.round((c.y + c.height) - box.y);
        }, { timeout: 3_000 }).toBeLessThanOrEqual(1);
    });

    test('Pesanan shows what the table has actually ordered', async ({ page }) => {
        const capture = {
            status: {
                has_order: true,
                order_number: '2026-09-03-004',
                status: 'sent', stage: 2, stage_label: 'Sedang disiapkan',
                lines: [
                    { item_name: 'Kentang Goreng', quantity: 2, gross_amount: 40000,
                      note: 'tidak asin', modifiers: [] },
                    { item_name: 'Es Kopi Susu', quantity: 1, gross_amount: 28000,
                      note: null, modifiers: ['Large'] }
                ],
                note: 'Sendok garpu 2',
                subtotal: 68000, service_charge_amount: 0, tax_amount: 0,
                discount_total: 0, total_amount: 68000, paid_amount: 0
            }
        };
        await stub(page, { capture });
        await open(page);

        // The badge counts what is already on the table, before anything is
        // tapped — someone else may have ordered, or this is a second round.
        await expect(page.locator('#tab-orders-badge')).toHaveClass(/on/);
        await expect(page.locator('#tab-orders-badge')).toHaveText('3');

        await page.locator('.tab[data-tab="orders"]').click();
        const sheet = page.locator('#sheet-orders');
        await expect(sheet).toHaveClass(/is-open/);

        await expect(sheet).toContainText('2026-09-03-004');
        await expect(sheet).toContainText('Sedang disiapkan');
        await expect(sheet).toContainText('Kentang Goreng');
        await expect(sheet).toContainText('tidak asin');       // the line note
        await expect(sheet).toContainText('Large');            // the modifier
        await expect(sheet).toContainText('Sendok garpu 2');   // the order note
        await expect(sheet.locator('.totals .grand .num')).toHaveText('Rp68.000');

        // Four steps, two of them reached. The till's ladder has seven and uses
        // words a diner has no reason to know.
        await expect(sheet.locator('.track-step')).toHaveCount(4);
        await expect(sheet.locator('.track-step.done')).toHaveCount(2);
    });

    test('a slow stale response never overwrites a newer one', async ({ page }) => {
        // The exact failure seen in production: the boot fetch is taken before
        // any order exists, so it answers "no orders" — and if it lands AFTER
        // the refresh that follows placing an order, it blanks the sheet and
        // the badge seconds after the diner watched their order go through.
        const empty = { has_order: false, lines: [] };
        const full = {
            has_order: true, order_number: '2026-09-03-009', status: 'sent',
            stage: 2, stage_label: 'Sedang disiapkan',
            lines: [{ item_name: 'Kentang Goreng', quantity: 2, gross_amount: 40000, note: null, modifiers: [] }],
            note: null, subtotal: 40000, service_charge_amount: 0, tax_amount: 0,
            discount_total: 0, total_amount: 40000, paid_amount: 0
        };

        let call = 0;
        await page.route('**/qr-menu?**', (r) => r.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(MENU) }));
        await page.route('**/qr-menu-image?**', (r) => r.fulfill({
            status: 200, contentType: 'image/png', body: PNG }));
        await page.route('**/qr-order-status?**', async (route) => {
            call += 1;
            // The FIRST request is the slow, stale one.
            const body = call === 1 ? empty : full;
            if (call === 1) await new Promise((r) => setTimeout(r, 2500));
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });

        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        // The newer response paints…
        await expect(page.locator('#sheet-orders')).toContainText('2026-09-03-009', { timeout: 10_000 });
        // …and the stale one, landing later, must not undo it.
        await page.waitForTimeout(2500);
        await expect(page.locator('#sheet-orders')).toContainText('2026-09-03-009');
        await expect(page.locator('#tab-orders-badge')).toHaveText('2');
        await expect(page.locator('#tab-orders-badge')).toHaveClass(/on/);
    });

    test('an empty table says so rather than showing a blank sheet', async ({ page }) => {
        await stub(page);
        await open(page);
        await expect(page.locator('#tab-orders-badge')).not.toHaveClass(/on/);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('#sheet-orders .empty')).toContainText('Belum ada pesanan');
    });

    test('the header is the business and the table, on one line', async ({ page }) => {
        await stub(page);
        await open(page);

        const head = page.locator('.masthead');
        await expect(head.locator('h1')).toHaveText('Kopi Senja Kemang');
        await expect(head.locator('.table-chip')).toContainText('Meja A04');

        // The eyebrow that used to sit above this said "Pesan dari meja Anda" —
        // exactly what the headline and the chip already say. A label restating
        // the headline is prohibited (CLAUDE.md), and removing it gave the menu
        // back the vertical space the header was spending on it.
        await expect(page.locator('.brandline')).toHaveCount(0);
        await expect(head).not.toContainText('Pesan dari meja');

        // Side by side, not stacked: same vertical band.
        const h1 = await head.locator('h1').boundingBox();
        const chip = await head.locator('.table-chip').boundingBox();
        const overlap = Math.min(h1.y + h1.height, chip.y + chip.height) - Math.max(h1.y, chip.y);
        expect(overlap, 'the table chip is not on the same line as the name').toBeGreaterThan(0);

        // AND IT MUST HOLD FOR A LONG NAME, which is the case that broke it in
        // production: a real outlet called "QA-CNT-1786886530917 Outlet" wrapped
        // the chip onto a second line. The name truncates now; the chip never
        // moves. `min-width: 0` on the flex item is what makes that work.
        await page.evaluate(() => {
            document.getElementById('outlet-name').textContent =
                'Restoran Padang Sederhana Bintang Lima Cabang Kemang Selatan Raya';
        });
        const longH1 = await head.locator('h1').boundingBox();
        const longChip = await head.locator('.table-chip').boundingBox();
        const stillOverlap = Math.min(longH1.y + longH1.height, longChip.y + longChip.height)
            - Math.max(longH1.y, longChip.y);
        expect(stillOverlap, 'a long business name pushed the table chip onto its own line')
            .toBeGreaterThan(0);
        // The chip keeps its full width — it is the thing that must stay legible.
        expect(Math.abs(longChip.width - chip.width)).toBeLessThan(1);
        const clipped = await head.locator('h1').evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(clipped, 'the long name should be truncated, not overflowing').toBe(true);

        // And the header must not hog the screen — the menu is what the diner
        // came for. It sat at ~104px with the eyebrow.
        expect(h1.y + h1.height).toBeLessThan(90);
    });

    test('the splash shows the FluxyOS loader, not a bare spinner', async ({ page }) => {
        // Held open by stalling the menu response, because the loader is only
        // on screen until the first paint otherwise.
        let release;
        await page.route('**/qr-menu?**', async (route) => {
            await new Promise((r) => { release = r; });
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MENU) });
        });
        await page.route('**/qr-menu-image?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
        page.goto(`/t/${TOKEN}`).catch(() => {});

        await expect(page.locator('#view-loading .loader-card')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#view-loading .loader-card img')).toBeVisible();
        await expect(page.locator('#view-loading .loader-halo')).toHaveCount(2);
        expect(await page.locator('#view-loading .loader-star').count()).toBeGreaterThan(3);
        // The F itself, not a generic glyph.
        await expect(page.locator('#view-loading .loader-card img'))
            .toHaveAttribute('src', '/assets/images/favicon.svg');

        if (release) release();
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#view-loading')).toBeHidden();
    });

    test('nothing sits between the categories and the menu', async ({ page }) => {
        await stub(page);
        await open(page);
        // No promo banner, no interstitial: chips, then food.
        const chips = await page.locator('#chips').boundingBox();
        const firstRow = await page.locator('.card, .group-head').first().boundingBox();
        expect(firstRow.y - (chips.y + chips.height)).toBeLessThan(60);
    });

    test('a photo loads and keeps its aspect ratio', async ({ page }) => {
        await stub(page);
        await open(page);

        const img = page.locator('.card', { hasText: 'Es Kopi Susu' }).locator('.card-media img');
        await expect(img).toBeVisible();
        // `contain`, matching the till exactly. `cover` crops the part of a dish
        // that identifies it, and the SAME photo appears on both surfaces — one
        // of them would be wrong and nobody could tell which.
        await expect(img).toHaveCSS('object-fit', 'contain');

        // An item with no photo gets a PLACEHOLDER tile, not nothing. A list
        // where only some rows have a tile reads as broken rather than as
        // incomplete: the names stop aligning and the eye loses the column.
        const bare = page.locator('.card', { hasText: 'Americano' }).locator('.card-media');
        await expect(bare).toHaveCount(1);
        await expect(bare).toHaveClass(/is-placeholder/);
        await expect(bare.locator('svg')).toBeVisible();
        await expect(bare.locator('img')).toHaveCount(0);

        // Both tiles are the same size, which is the entire point of the
        // placeholder — a ragged left edge is what it exists to prevent.
        const a = await img.locator('xpath=..').boundingBox();
        const b = await bare.boundingBox();
        expect(Math.abs(a.width - b.width)).toBeLessThan(1);
        expect(Math.abs(a.height - b.height)).toBeLessThan(1);
    });

    test('category chips and search narrow the menu', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.chip', { hasText: 'Makanan' }).click();
        await expect(page.locator('.card')).toHaveCount(1);
        await expect(page.locator('.card-name')).toHaveText('Nasi Goreng Kampung');

        await page.locator('.chip', { hasText: 'Semua' }).click();
        await expect(page.locator('.card')).toHaveCount(3);

        await page.locator('#search').fill('nasi');
        await expect(page.locator('.card')).toHaveCount(1);

        await page.locator('#search').fill('zzz');
        // Scoped to the menu: the orders sheet is pre-painted on boot and has
        // its own empty state, so a bare `.empty` matches two elements.
        await expect(page.locator('#menu .empty')).toBeVisible();
    });

    test('an item with no options adds in one tap', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();

        await expect(page.locator('#cartbar')).toHaveClass(/is-open/);
        await expect(page.locator('#cart-count')).toHaveText('1');
        await expect(page.locator('#cart-total')).toHaveText('Rp22.000');

        // The row becomes a stepper, so a second one does not need the sheet.
        await page.locator('.card', { hasText: 'Americano' }).locator('[data-inc]').click();
        await expect(page.locator('#cart-total')).toHaveText('Rp44.000');
        await page.locator('.card', { hasText: 'Americano' }).locator('[data-dec]').click();
        await expect(page.locator('#cart-total')).toHaveText('Rp22.000');
    });

    test('the option sheet is laid out correctly and priced live', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.card', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
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

        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.card', { hasText: 'Nasi Goreng' }).getByRole('button', { name: 'Tambah' }).click();
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
        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.card', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
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
        // The name is no longer typed here — the gate collected it before the
        // first tap, and the cart only confirms who the order goes out under.
        await expect(page.locator('#sheet-cart')).toContainText('Sinta');
        await expect(page.locator('#cart-submit')).toContainText('Order Sekarang');
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

        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
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
        // `goTo`, not `open` — a dead token never reaches a menu, so the
        // identity gate correctly never opens and there is nothing to fill.
        await goTo(page);

        await expect(page.locator('#view-error')).toBeVisible();
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);
        await expect(page.locator('#view-menu')).toBeHidden();
        await expect(page.locator('#error-title')).toHaveText('Kode ini tidak aktif');
    });

    test('no token at all is a clear instruction, not a broken page', async ({ page }) => {
        await stub(page);
        // Reached by typing the bare domain off a card, which serves order.html
        // with no token segment at all.
        await page.goto('/order.html');
        await expect(page.locator('#error-title')).toHaveText('Kode meja tidak ditemukan');
    });

    test('the page loads no Tailwind and no Firebase', async ({ page }) => {
        const requested = [];
        page.on('request', (r) => requested.push(r.url()));
        await stub(page);
        await open(page);
        await expect(page.locator('.card').first()).toBeVisible();

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
        await page.locator('.card', { hasText: 'Es Kopi Susu' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('.opt', { hasText: 'Large' }).locator('input').check();
        await page.locator('#item-add').click();
        await page.locator('#cart-open').click();

        expect(errors).toEqual([]);
    });
});
