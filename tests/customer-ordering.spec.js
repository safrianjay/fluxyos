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
// ⚠️ AND PINNED TO INDONESIAN.
//
// The page defaults to ENGLISH — a QR menu has to work for the visitor who
// cannot read the outlet's own language, and they are the one person in the
// product who cannot ask anyone to change a setting for them. But this suite
// was written against the Indonesian copy and its ~160 assertions are a record
// of what the page says, so it pins the language the way the dashboard specs
// pin theirs rather than restating every sentence.
//
// The DEFAULT is not left untested by that: see the language-switcher block.
const goTo = async (page, lang = 'id') => {
    // ⚠️ `null` MEANS DO NOT PIN. An init script re-runs on every navigation
    // including a reload, so a test that pins cannot then observe a switch
    // surviving one — it would just be re-pinned on the way back in.
    if (lang !== null) {
        await page.addInitScript((code) => {
            try { window.localStorage.setItem('fluxyos-order-lang', code); } catch (_) { /* private mode */ }
        }, lang);
    }
    return page.goto(`/t/${TOKEN}`);
};

// Adding is a two-step interaction now — every item opens the sheet, even one
// with nothing to choose, so that a note is always reachable. Tests that care
// about the CART rather than the sheet go through this.
async function addPlain(page, name, note) {
    await page.locator('.card', { hasText: name })
        .getByRole('button', { name: /Tambah|Add/ }).click();
    await expect(page.locator('#sheet-item')).toHaveClass(/is-open/);
    if (note) await page.locator('#item-note').fill(note);
    // Satisfy any REQUIRED group by taking its first option. Without this the
    // helper hangs on an item like "Es Kopi Susu" whose size is mandatory —
    // #item-add stays disabled and the click waits forever.
    const required = page.locator('.optgroup[data-select="one_required"]');
    for (let i = 0; i < await required.count(); i += 1) {
        await required.nth(i).locator('input').first().check();
    }
    await page.locator('#item-add').click();
    await expect(page.locator('#sheet-item')).not.toHaveClass(/is-open/);
}

// Load AND clear the identity gate. Almost every test needs the menu, and the
// gate is deliberately not dismissible any other way — see the dedicated tests
// below for the gate's own behaviour.
async function open(page, lang) {
    await goTo(page, lang);
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
        // Two fields and a button — no explanatory paragraph ABOVE them. The
        // labels say what is wanted; the reason the number is wanted rides
        // under the CTA, read at the moment of committing.
        await expect(page.locator('.welcome-lead, .welcome-lede')).toHaveCount(0);
        await expect(gate).not.toContainText('Isi data Anda sekali saja');
        // The gate's tint is the WHOLE SHEET, never a band across the top: a
        // band is a second surface and reads as a header bolted onto a form.
        // The foot must therefore paint nothing of its own — and there is no
        // head at all any more, which the title assertion above pins.
        expect(await gate.locator('.sheet-foot').evaluate((el) =>
            getComputedStyle(el).backgroundColor), 'the foot paints its own surface')
            .toBe('rgba(0, 0, 0, 0)');
        await expect(gate.locator('.sheet-head')).toHaveCount(0);
        // Light, because the CTA is navy and would vanish on a dark ground.
        const tint = await gate.evaluate((el) => getComputedStyle(el).backgroundImage);
        expect(tint, 'the sheet carries the tint itself').not.toBe('none');

        // NO heading and NO sub-line. The hero stack says what this is and two
        // labelled fields say what to do; a title over that is a third thing to
        // read before the first thing to do. The dialog is named by
        // `aria-label` instead, since there is no heading left to point at.
        await expect(page.locator('#welcome-title, #welcome-sub')).toHaveCount(0);
        await expect(gate).toHaveAttribute('aria-label', /.+/);
        expect(await gate.getAttribute('aria-labelledby'),
            'aria-labelledby points at an element that no longer exists').toBeNull();

        // A plain label-above-input, and the input must draw its own box. Two
        // earlier passes lost that — tall cards with the label stacked over the
        // value, then one grouped card with leading icons — and both read as a
        // read-only detail row rather than somewhere to type.
        const field = await page.locator('#welcome-name').evaluate((el) => {
            const cs = getComputedStyle(el);
            return { border: parseFloat(cs.borderTopWidth), radius: cs.borderTopLeftRadius };
        });
        expect(field.border, 'the input draws no border of its own').toBeGreaterThan(0);
        expect(field.radius).not.toBe('0px');
        // Sentence case, not the caps of the earlier pass.
        expect(await page.locator('#welcome-name-field label')
            .evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');

        // It is not dismissible by any of the usual routes.
        await page.locator('#scrim').click({ position: { x: 10, y: 10 } });
        await expect(gate).toHaveClass(/is-open/);
        await page.keyboard.press('Escape');
        await expect(gate).toHaveClass(/is-open/);

        // Empty is refused, and says which field.
        await page.locator('#welcome-go').click();
        await expect(gate).toHaveClass(/is-open/);
        await expect(page.locator('#welcome-error')).toContainText('nama');
        // The CARD draws the border now, so the flag lives on the card — on the
        // input it would style an element that draws none.
        await expect(page.locator('#welcome-name-field')).toHaveClass(/is-invalid/);

        // A short number is refused too — nine digits is the shortest real
        // Indonesian mobile.
        await page.locator('#welcome-name').fill('Sinta');
        await page.locator('#welcome-phone').fill('0812');
        await page.locator('#welcome-go').click();
        await expect(gate).toHaveClass(/is-open/);
        await expect(page.locator('#welcome-phone-field')).toHaveClass(/is-invalid/);

        // Digits are counted, not characters, so a formatted number passes.
        await page.locator('#welcome-phone').fill('+62 812-3456-7890');
        await page.locator('#welcome-go').click();
        await expect(gate).not.toHaveClass(/is-open/);
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);
    });

    test("THE GATE'S HERO IS THE REAL STATUS LADDER, IN FOCUS", async ({ page }) => {
        // Built from data, not shipped as an asset: no request on restaurant
        // wifi, and it cannot look like stock art. A hand-drawn SVG food scene
        // was tried here and cut for looking exactly like stock art.
        await stub(page);
        // Artwork ships for this outlet, so undeclare it — the card stack is
        // what every outlet without one gets, and it has to stand on its own.
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                const el = document.getElementById('welcome-art');
                if (el) el.dataset.src = '';
            });
        });
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });

        const notes = page.locator('#welcome-art .welcome-note');
        await expect(notes).toHaveCount(3);
        // The same words the Pesanan tab uses, so the diner meets the
        // vocabulary here and recognises it there.
        await expect(notes.nth(0)).toContainText('Diterima');
        await expect(notes.nth(1)).toContainText('Siap');
        await expect(notes.nth(2)).toContainText('Diantar');

        // ONE card is in focus and the neighbours are blurred back — the whole
        // point of the device. Three equal cards is a list, not a hero.
        const blur = (n) => notes.nth(n).evaluate((el) => getComputedStyle(el).filter);
        expect(await blur(1), 'the middle card is the focused one').toBe('none');
        expect(await blur(0)).toMatch(/blur/);
        expect(await blur(2)).toMatch(/blur/);

        // ⚠️ IT MUST NOT PROMISE A MESSAGE THE PRODUCT NEVER SENDS. FluxyOS
        // pushes the diner nothing — staff read the name off the ticket — so
        // dressing these as notifications would be a lie told in pixels.
        const art = (await page.locator('#welcome-art').innerText()).toLowerCase();
        for (const word of ['whatsapp', 'notifikasi', 'sms', 'pesan masuk']) {
            expect(art, `the hero implies an automated "${word}"`).not.toContain(word);
        }

        // It sits ABOVE the fields with a deliberate break — not the 8px the
        // vertical-rhythm rule treats as the floor, and not touching.
        const box = await page.locator('#welcome-art').boundingBox();
        const field = await page.locator('#welcome-name-field').boundingBox();
        const gap = field.y - (box.y + box.height);
        expect(gap, 'the hero and the first field have collapsed together')
            .toBeGreaterThanOrEqual(12);
    });

    // A stand-in for the shipped file, so the branch is exercised without a
    // binary in the repo.
    const ART_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160">'
        + '<rect width="300" height="160" fill="#CDE8DA"/></svg>';

    test('ADDING TO THE CART DOES NOT REBUILD THE MENU, SO PHOTOS ARE NOT REFETCHED', async ({ page }) => {
        // ⚠️ THE REPORTED BUG. `paintMenu()` is called from eight places, most of
        // them cart edits, and it assigned `host.innerHTML` every time — which
        // destroys every <img> and re-requests every photo. On a menu with
        // pictures that is a burst of requests on every tap, and the ones that
        // lost the race stayed blank: "sometimes the product images do not load".
        await stub(page);
        let imageRequests = 0;
        await page.route('**/qr-menu-image**', (route) => {
            imageRequests += 1;
            return route.fulfill({
                status: 200,
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#ccc"/></svg>'
            });
        });
        await open(page);
        await expect(page.locator('.card').first()).toBeVisible();

        // Identity of the actual DOM NODES, not a count — a rebuild replaces
        // every one of them, and that is what re-requests the photos. Stamped
        // on every grid image, so a rebuild cannot survive by luck.
        const stampAll = () => page.evaluate(() =>
            [...document.querySelectorAll('#menu .card-media img')].map((el) => {
                el.dataset.probe = el.dataset.probe || String(Math.random());
                return el.dataset.probe;
            }));
        const before = await stampAll();
        expect(before.length, 'no photographed card to measure').toBeGreaterThan(0);
        const requestsBefore = imageRequests;

        await addPlain(page, 'Es Kopi Susu');

        // The badge updated…
        const badge = page.locator('[data-qty="i_latte"]');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('1');
        // …and every grid image is the SAME element it was.
        expect(await stampAll(), 'the grid was rebuilt on a cart change').toEqual(before);

        // The item sheet loads its own hero photo, which is one legitimate
        // request. What must not happen is the GRID reloading — that would cost
        // one per photographed card, every tap.
        expect(imageRequests - requestsBefore,
            'the grid refetched its photos when the cart changed')
            .toBeLessThanOrEqual(1);
    });

    test('the add control is a "+", and the count is a badge', async ({ page }) => {
        // The button's label has to be CONSTANT — it is what lets a cart change
        // skip the rebuild above. The count moved to a badge for that reason,
        // and the "+" leaves the price the room it needed.
        await stub(page);
        await open(page);
        const card = page.locator('.card', { hasText: 'Es Kopi Susu' });
        const btn = card.locator('.add-btn');
        await expect(btn).toBeVisible();
        // A glyph, not a word: no text node to change when the cart does.
        expect((await btn.innerText()).trim()).toBe('');
        await expect(btn.locator('svg')).toHaveCount(1);
        // Still announced properly to a screen reader.
        expect(await btn.getAttribute('aria-label')).toContain('Es Kopi Susu');
        // Hidden until there is something to count.
        await expect(card.locator('[data-qty]')).toBeHidden();
    });

    test('a photo that fails once is RETRIED before the card gives up on it', async ({ page }) => {
        // A single failed request used to hide the photo permanently, so one
        // blip on restaurant wifi cost that dish its picture for the life of the
        // page — with nothing on screen to say why.
        await stub(page);
        let hits = 0;
        await page.route('**/qr-menu-image**', (route) => {
            hits += 1;
            if (hits === 1) return route.fulfill({ status: 503, body: 'nope' });
            return route.fulfill({
                status: 200,
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#8b5"/></svg>'
            });
        });
        await open(page);
        const img = page.locator('.card-media img').first();
        await expect(img).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => img.evaluate((el) => el.naturalWidth),
            { timeout: 10_000, message: 'the photo was never retried' }).toBeGreaterThan(0);
        await expect(img).not.toHaveClass(/failed/);
    });

    test('the confirmation shows the supplied artwork, on an absolute path', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Es Kopi Susu');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 20_000 });

        const art = page.locator('.done-art');
        await expect(art).toBeVisible();
        // ⚠️ ABSOLUTE. Under `/t/<token>` a relative `assets/…` resolves to
        // `/t/assets/…`, which the catch-all rewrite serves as 200-with-HTML —
        // it would fail while LOOKING like it loaded.
        expect(await art.getAttribute('src')).toBe('/assets/images/order-success.png');
        // And it DECODES — a broken image passes every assertion above.
        expect(await art.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        // The drawn tick it replaced is gone.
        await expect(page.locator('.done-mark')).toHaveCount(0);
    });

    test('A CATEGORY TAB SWIPE CANNOT DRAG THE WHOLE PAGE', async ({ page }) => {
        // ⚠️ SCROLL CHAINING. When a horizontal scroller hits its end the browser
        // hands the rest of the gesture to the PARENT, which pans the page
        // sideways — the reported bug. Every horizontal rail on this page has to
        // contain it, not just the one that was noticed.
        await stub(page);
        await open(page);
        for (const sel of ['#chips', '.recos-rail', '#hero-rail']) {
            const rail = page.locator(sel);
            if (!(await rail.count())) continue;
            expect(await rail.evaluate((el) => getComputedStyle(el).overscrollBehaviorX),
                `${sel} lets a swipe chain out to the page`).toBe('contain');
        }
        // And nothing may make the document pannable in the first place.
        // ⚠️ EITHER PROPERTY. `clip` is what the page wants — `hidden` makes
        // body a scroll container and silently breaks every `position: sticky`
        // descendant — but `hidden` is the declared fallback for Safari < 16,
        // so this pins the job rather than the spelling.
        expect(await page.evaluate(() => getComputedStyle(document.body).overflowX))
            .toMatch(/^(hidden|clip)$/);
        expect(await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('THE CART SHOWS SERVICE AND TAX, WITH THEIR RATES', async ({ page }) => {
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                ...MENU,
                pricing: {
                    tax_enabled: true, tax_label: 'PPN', tax_rate_percent: 11,
                    tax_inclusive: false, service_enabled: true,
                    service_rate_percent: 5, service_taxable: true
                }
            })
        }));
        // ⚠️ The page must actually LOAD the shared pricing module. It did not
        // for a while — the script tag was missing — and the only symptom was a
        // silent TypeError that left the cart bar unrendered.
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await open(page);
        expect(await page.evaluate(() => typeof window.FluxyPosPricing),
            'order.html is not loading pos-pricing.js').toBe('object');
        await addPlain(page, 'Americano');          // 22.000
        expect(errors, 'the page threw while pricing the cart').toEqual([]);
        await page.locator('#cart-open').click();

        const totals = page.locator('#cart-totals');
        // The percentage rides with the label: "Layanan Rp1.100" invites exactly
        // the question the rate answers.
        await expect(totals).toContainText('Layanan');
        await expect(totals).toContainText('5%');
        await expect(totals).toContainText('PPN');
        await expect(totals).toContainText('11%');

        // 22.000 + 5% service = 1.100; 11% of 23.100 = 2.541 → 25.641.
        const grand = await totals.locator('.line.grand .num').innerText();
        expect(grand.replace(/\D/g, '')).toBe('25641');
        // ⚠️ The floating bar must agree. Two totals on one screen that disagree
        // is worse than either alone.
        expect((await page.locator('#cart-total').innerText()).replace(/\D/g, ''))
            .toBe('25641');
    });

    test('EARLIER ORDERS SURVIVE PAYMENT, AND CAN BE REORDERED', async ({ page }) => {
        // ⚠️ THE REPORTED BUG. The status endpoint deliberately skips PAID
        // orders — from the table's side that sitting is over. But the DEVICE
        // knows what it ordered, and after paying and reordering a diner still
        // wants to see it. Straight after payment there is no live order at all,
        // which is exactly when this sheet used to show an empty state to
        // someone holding a receipt.
        await stub(page);
        const history = [{
            order_id: 'o_prev', order_number: '2026-09-05-001', status: 'paid',
            lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 2,
                gross_amount: 44000, note: null, modifiers: [] }],
            subtotal: 44000, discount_total: 0, service_charge_amount: 2200,
            tax_amount: 5082, total_amount: 51282,
            pricing: { tax_label: 'PPN', tax_rate_percent: 11, tax_inclusive: false,
                service_rate_percent: 5 },
            placed_at: Date.now() - 30 * 60 * 1000
        }];
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ has_order: false, lines: [], history })
        }));
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        const panel = page.locator('.ohistory');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.orders-empty-title')).toHaveText(/tidak ada pesanan aktif/i);
        await panel.locator('summary').click();
        await expect(panel).toContainText('2026-09-05-001');
        await expect(panel).toContainText('Americano');
        // The old bill's OWN rates, not whatever is configured now.
        await expect(panel).toContainText('5%');
        await expect(panel).toContainText('11%');

        // And it can be ordered again. Resolved against TODAY's menu, never
        // replayed from the old line — a repriced item must not arrive in the
        // cart at yesterday's price.
        await panel.getByRole('button', { name: /pesan lagi/i }).click();
        await expect(page.locator('#view-cart')).toBeVisible();
        await expect(page.locator('#cart-lines')).toContainText('Americano');
        await expect(page.locator('#cart-count')).toHaveText('2');
    });

    test('THE COMMIT BAR ACTUALLY STICKS, AND CARRIES WHO THE ORDER IS FOR', async ({ page }) => {
        // ⚠️ IT WAS `position: sticky; bottom: 0` AND NEVER STUCK. Sticky needs
        // somewhere to stick FROM — the element has to be able to sit lower than
        // where it is pinned. This bar is the LAST child of its section, so its
        // natural position already IS the bottom of its containing block and the
        // sticky range was zero. It read as sticky in the stylesheet and behaved
        // like a plain block on the page.
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await addPlain(page, 'Nasi Goreng Kampung');
        await page.locator('#cart-open').click();

        const foot = page.locator('.page-foot');
        await expect(foot).toBeVisible();
        expect(await foot.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');

        // Visible at the top of the page…
        const viewport = page.viewportSize();
        let box = await foot.boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        // …and still visible after scrolling to the bottom, which is the whole
        // claim. On a long order the commit must never be something you hunt for.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(150);
        box = await foot.boundingBox();
        expect(box.y, 'the commit bar scrolled away with the page')
            .toBeLessThan(viewport.height);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

        // Nothing is trapped underneath it.
        // ⚠️ THE CLEARANCE IS MEASURED, NOT A CONSTANT. It was a hardcoded
        // `96px` — exactly the bar's height on the day it was written — so
        // restyling the bar trapped the last panel under it with nothing to
        // say so. This assertion is what caught that; the guard below is what
        // stops the constant coming back.
        // ⚠️ MEASURED FROM THE TAB, NOT THE BAR. The identity row now sits
        // ABOVE the white card, so the bar's own top edge understates how much
        // of the screen is covered.
        const lastPanel = await page.locator('.page-body > *').last().boundingBox();
        const whoBox = await page.locator('#cart-who').boundingBox();
        const coveredFrom = Math.min(box.y, whoBox ? whoBox.y : box.y);
        expect(lastPanel.y + lastPanel.height,
            'the last panel is hidden behind the commit bar').toBeLessThanOrEqual(coveredFrom + 1);
        const reserved = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--foot-space').trim());
        expect(reserved, '--foot-space was never measured').toMatch(/^\d+px$/);
        expect(parseFloat(reserved),
            'the reserved space is smaller than the bar it is reserving for')
            .toBeGreaterThanOrEqual(box.y + box.height - coveredFrom);

        // And it carries who the order is for — the last thing checked before
        // committing belongs beside the commit.
        await expect(foot.locator('#cart-who')).toContainText('Sinta');
        await expect(foot.locator('#cart-submit')).toBeVisible();
    });

    test('dragging the category tabs cannot scroll the page at all', async ({ page }) => {
        // `overscroll-behavior` only stops the CHAIN once a scroller hits its
        // end. A drag that starts on the strip and moves diagonally still panned
        // the page up and down — the second half of the reported bug.
        await stub(page);
        await open(page);
        expect(await page.locator('#chips').evaluate((el) => getComputedStyle(el).touchAction),
            'a diagonal drag on the tabs can still take the page with it')
            .toBe('pan-x');

        // ⚠️ NOT applied to the tall rails. They are 300px and 46vh, and
        // blocking vertical there would turn most of the first screen into a
        // dead zone for scrolling.
        for (const sel of ['.recos-rail', '#hero-rail']) {
            if (!(await page.locator(sel).count())) continue;
            expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).touchAction),
                `${sel} blocks vertical scrolling over a large area`).not.toBe('pan-x');
        }
    });

    test('THE SEARCH FIELD AND THE TABS BOTH STAY WHILE THE MENU SCROLLS', async ({ page }) => {
        // A menu long enough to actually scroll — three cards fit on one screen
        // and a sticky test on a page that cannot move proves nothing.
        const LONG = {
            ...MENU,
            items: Array.from({ length: 24 }, (_, n) => ({
                id: `i_${n}`, name: `Dish ${n}`, category: n % 2 ? 'Kopi' : 'Makanan',
                price: 20000 + n * 1000, has_image: false, modifier_groups: []
            })).concat([{ id: 'i_solo', name: 'Nasi Uduk Spesial', category: 'Makanan',
                price: 45000, has_image: false, modifier_groups: [] }])
        };
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(LONG)
        }));
        await open(page);
        await expect(page.locator('.card').first()).toBeVisible();

        const search = page.locator('.menu-search');
        const chips = page.locator('#chips');
        const top = await search.boundingBox();

        // Far enough that the hero and the outlet card are long gone.
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(250);

        const scrolled = await search.boundingBox();
        const chipBox = await chips.boundingBox();
        expect(await page.evaluate(() => window.scrollY),
            'the page did not actually scroll').toBeGreaterThan(300);

        // ⚠️ THE TAB STRIP STUCK ON ITS OWN AND THE SEARCH FIELD DID NOT, so a
        // diner half way down a long menu could change category but had to
        // scroll back to the top to search it. They filter the same list.
        expect(scrolled.y, 'the search field scrolled away with the page')
            .toBeLessThan(top.y);
        expect(scrolled.y, 'the search field is off the top of the screen')
            .toBeGreaterThanOrEqual(0);
        expect(scrolled.y, 'the search field is not pinned near the top')
            .toBeLessThan(40);
        // And in the order they are read: search above tabs, still touching.
        expect(chipBox.y).toBeGreaterThanOrEqual(scrolled.y + scrolled.height - 1);
        expect(chipBox.y - (scrolled.y + scrolled.height),
            'the two halves of the sticky block came apart').toBeLessThan(16);

        // The strip must be OPAQUE, or cards scroll visibly through it.
        const bg = await page.locator('.menu-sticky')
            .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg, 'the sticky strip is see-through').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        // Still usable where it now sits — a pinned control that cannot be
        // typed into is decoration.
        await page.locator('#search').fill('Nasi Uduk');
        await expect(page.locator('.card')).toHaveCount(1);
    });

    test('THE ITEM SHEET NEVER SHOWS A HOLE WHERE THE PHOTO GOES', async ({ page }) => {
        // ⚠️ THE SLOWEST THING ON THIS PAGE. A menu photo is a Netlify function,
        // a Firestore read, a signed URL and a 302 to Storage before a byte of
        // JPEG moves, and on restaurant wifi that is visible — reported by Jay
        // as "some image isn't load fast, especially when I open the bottom
        // sheet". Nothing here makes it instant. What it must not do is look
        // like a sheet that FAILED while it is merely a sheet that is arriving.
        await stub(page);
        await open(page);

        await page.locator('.card', { hasText: 'Es Kopi Susu' }).click();
        const hero = page.locator('.detail-hero');
        await expect(page.locator('#sheet-item')).toHaveClass(/is-open/);

        // The holding layer is BEHIND the photo, always present, never removed
        // — so there is no frame in which the box is empty.
        await expect(hero).toHaveClass(/is-loading/);
        const held = await hero.evaluate((el) => ({
            bg: getComputedStyle(el).backgroundImage,
            glyph: !!el.querySelector(':scope > svg'),
            overlaid: getComputedStyle(el.querySelector('img')).position
        }));
        expect(held.glyph, 'nothing stands in for the photo while it loads').toBe(true);
        expect(held.bg, 'the holding state is a bare grey box').not.toBe('none');
        expect(held.overlaid, 'the photo does not sit over the holding layer').toBe('absolute');

        // Once it arrives it is revealed, and the glyph goes.
        await expect(hero).toHaveClass(/is-ready/);
        // Polled, not sampled: the reveal is a 0.18s fade and a single read
        // lands mid-transition on whatever value the compositor is at.
        await expect.poll(async () => Number(await hero.locator('img')
            .evaluate((el) => getComputedStyle(el).opacity))).toBe(1);

        // ⚠️ AND THE STATE BEFORE THAT IS REAL, not a class nobody honours.
        // Driven from the DOM rather than by starving the network: holding the
        // image route open also starves the hero gallery, and the page never
        // finishes loading at all.
        await hero.evaluate((el) => el.classList.remove('is-ready'));
        await expect.poll(async () => Number(await hero.locator('img')
            .evaluate((el) => getComputedStyle(el).opacity)),
        { message: 'a half-decoded photo is shown instead of fading in' }).toBe(0);
        expect(await hero.evaluate((el) =>
            getComputedStyle(el.querySelector(':scope > svg')).display),
        'the glyph is gone while the photo is still coming').not.toBe('none');
    });

    test('a category with no rail still clears the tabs', async ({ page }) => {
        // ⚠️ THE ONE PLACE TWO BLOCKS TOUCHED. The rail carries its own 8px to
        // the tabs; without it the first row of cards sat almost against them.
        // Every other gap between a control and the content it filters is 8.
        await stub(page);
        await open(page);
        const gap = await page.locator('#menu')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
        expect(gap).toBe(8);
    });

    test('EVERY TOTAL ON THE CART PAGE IS THE SAME NUMBER', async ({ page }) => {
        // ⚠️ THE BUTTON PRINTED THE SUBTOTAL. The panel said "Total Rp232.000"
        // and the order button directly beneath it said Rp200.000 — a diner
        // commits to a figure while looking at a different one, and finds out
        // which was true when the bill arrives. The bar, the panel and the
        // button now read one priced figure computed once.
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                ...MENU,
                pricing: {
                    tax_enabled: true, tax_label: 'PPN', tax_rate_percent: 11,
                    tax_inclusive: false, service_enabled: true,
                    service_rate_percent: 5, service_taxable: true
                }
            })
        }));
        await open(page);
        await addPlain(page, 'Americano');

        // The floating bar on the menu.
        const bar = (await page.locator('#cart-total').innerText()).replace(/\D/g, '');
        await page.locator('#cart-open').click();

        const panel = page.locator('#cart-totals .line.grand .num').first();
        const panelTotal = (await panel.innerText()).replace(/\D/g, '');
        const button = (await page.locator('#cart-submit-total').innerText()).replace(/\D/g, '');

        expect(button, 'the order button does not state what will be charged').toBe(panelTotal);
        expect(bar, 'the menu bar and the cart panel disagree').toBe(panelTotal);

        // And it is genuinely the PRICED total, not the subtotal — otherwise
        // all three could agree on the wrong number.
        const sub = (await page.locator('#cart-totals .line').first().innerText()).replace(/\D/g, '');
        expect(Number(panelTotal), 'service and tax are missing from the total')
            .toBeGreaterThan(Number(sub));
    });

    test('THE VISIT TOTAL NEVER FOLDS A PAID BILL INTO WHAT IS OWED', async ({ page }) => {
        // ⚠️ THE WHOLE POINT. A settled order is money that has already changed
        // hands, and the ledger has a posted sale saying so. Folding it into
        // "what you owe" asks the customer to pay it twice — which is the one
        // way to make this worse than the two separate totals it replaces.
        await stub(page);
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, order_id: 'o_now', order_number: '2026-09-05-002',
                status: 'served', stage: 4, stage_label: 'Diantar',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                    gross_amount: 22000, note: null, modifiers: [] }],
                subtotal: 22000, discount_total: 0, service_charge_amount: 0,
                tax_amount: 0, total_amount: 22000, paid_amount: 0,
                pricing: null, placed_at: Date.now() - 5 * 60 * 1000,
                history: [{
                    order_id: 'o_prev', order_number: '2026-09-05-001', status: 'paid',
                    lines: [{ item_id: 'i_latte', item_name: 'Es Kopi Susu', quantity: 2,
                        gross_amount: 56000, note: null, modifiers: [] }],
                    subtotal: 56000, discount_total: 0, service_charge_amount: 0,
                    tax_amount: 0, total_amount: 56000, pricing: null,
                    placed_at: Date.now() - 60 * 60 * 1000
                }]
            })
        }));
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        const visit = page.locator('.osession');
        await expect(visit).toBeVisible({ timeout: 15_000 });
        const figure = async (label) => (await visit.locator('.line', { hasText: label })
            .locator('.num').innerText()).replace(/\D/g, '');

        // Everything ordered this visit…
        expect(await figure('Semua pesanan')).toBe('78000');    // 56.000 + 22.000
        // …what is already settled, shown as a deduction…
        expect(await figure('Sudah dibayar')).toBe('56000');
        // …and only the live order is payable.
        expect(await figure('Perlu dibayar'),
            'a paid bill was folded into what the customer still owes').toBe('22000');

        // The live order's own panel is untouched — it still states ITS total,
        // which is what the cashier will take.
        const own = await page.locator('.opanel.totals:not(.osession) .line.grand .num').innerText();
        expect(own.replace(/\D/g, '')).toBe('22000');
    });

    test('a visit with nothing settled shows no summary at all', async ({ page }) => {
        // With one order the order's total IS the visit total, and restating it
        // would be a panel that adds a number without adding a fact.
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 20_000 });
        await page.locator('#done-status').click();
        await expect(page.locator('#sheet-orders')).toHaveClass(/is-open/);
        await expect(page.locator('.osession')).toHaveCount(0);
    });

    // The bill cases the spec enumerates, driven through the sheet.
    const billSheet = (page, over) => page.route('**/qr-order-status**', (route) =>
        route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, order_id: 'o_now', order_number: '2026-09-05-002',
                status: 'served', stage: 4, stage_label: 'Diantar',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                    gross_amount: 100000, note: null, modifiers: [] }],
                subtotal: 100000, discount_total: 0, service_charge_amount: 0,
                tax_amount: 0, total_amount: 100000, paid_amount: 0,
                pricing: null, placed_at: Date.now() - 5 * 60 * 1000, history: [],
                ...over
            })
        }));

    test('SERVED IS NOT PAID — an unpaid bill states its whole total', async ({ page }) => {
        // ⚠️ ORDER STATUS AND PAYMENT STATUS ARE DIFFERENT FACTS. A delivered
        // order whose money has not been collected is still owed in full, and
        // the sheet must never let "served" imply "settled".
        await stub(page);
        await billSheet(page, {});
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        const totals = page.locator('.opanel.totals').first();
        await expect(totals).toContainText('Ringkasan pembayaran', { timeout: 15_000 });
        expect((await totals.locator('.line.grand .num').first().innerText()).replace(/\D/g, ''))
            .toBe('100000');
        // Nothing paid, so no "sudah dibayar" row — a zero printed as a fact is
        // noise, and it invites the reader to check arithmetic that is not there.
        await expect(totals).not.toContainText('Sudah dibayar');
        // The CTA carries the figure rather than making them scroll for it.
        await expect(page.locator('#bill-btn')).toContainText('100.000');
    });

    test('A PART-PAID BILL SHOWS TOTAL, PAID AND WHAT IS LEFT', async ({ page }) => {
        // `paid_amount` was returned by the endpoint and read by nothing, so a
        // customer who had already handed over 60.000 was shown the full
        // 100.000 with no sign of it.
        await stub(page);
        await billSheet(page, { paid_amount: 60000 });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        const totals = page.locator('.opanel.totals').first();
        await expect(totals).toContainText('Sudah dibayar', { timeout: 15_000 });
        const grand = await totals.locator('.line.grand .num').allInnerTexts();
        expect(grand[0].replace(/\D/g, ''), 'total pesanan').toBe('100000');
        expect(grand[1].replace(/\D/g, ''), 'sisa tagihan').toBe('40000');
        // And the CTA asks for the REMAINDER, never the original total.
        await expect(page.locator('#bill-btn')).toContainText('40.000');
        await expect(page.locator('#bill-btn')).not.toContainText('100.000');
    });

    test('a fully paid bill asks for nothing more', async ({ page }) => {
        await stub(page);
        await billSheet(page, { paid_amount: 100000 });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        const totals = page.locator('.opanel.totals').first();
        await expect(totals).toContainText('Sisa tagihan', { timeout: 15_000 });
        const grand = await totals.locator('.line.grand .num').allInnerTexts();
        expect(grand[1].replace(/\D/g, ''), 'a settled bill still asks for money').toBe('0');
    });

    test('TICKETS SPLIT AT THE KITCHEN; THE BILL DOES NOT', async ({ page }) => {
        // ⚠️ THE CORRECTION. A round placed after the kitchen has the previous
        // ticket is its OWN order — a cook handed a merged ticket cannot tell
        // which lines are new and will make the served ones again. The diner
        // must never pay for that separation: two tickets, one total.
        await stub(page);
        const ticket = (id, no, status, stage, name, amount) => ({
            order_id: id, order_number: no, status, stage,
            stage_label: stage === 4 ? 'Sudah diantar' : 'Sedang disiapkan',   // the real STAGE map
            lines: [{ item_id: 'i_americano', item_name: name, quantity: 1,
                gross_amount: amount, note: null, modifiers: [] }],
            subtotal: amount, discount_total: 0, service_charge_amount: 0,
            tax_amount: 0, total_amount: amount, paid_amount: 0,
            pricing: null, placed_at: Date.now() - 10 * 60 * 1000
        });
        const orders = [
            ticket('o2', '2026-09-06-002', 'submitted', 2, 'Mie Goreng', 30000),
            ticket('o1', '2026-09-06-001', 'served', 4, 'Nasi Goreng', 50000)
        ];
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, ...orders[0], lines: orders[0].lines,
                note: null, history: [], orders,
                session: {
                    order_count: 2, subtotal: 80000, discount_total: 0,
                    service_charge_amount: 0, tax_amount: 0,
                    total_amount: 80000, paid_amount: 0, outstanding: 80000
                }
            })
        }));
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        // BOTH tickets are visible, each keeping its own progress — that is what
        // the kitchen works from and what the diner watches per round.
        const tickets = page.locator('.oticket');
        await expect(tickets).toHaveCount(2, { timeout: 15_000 });
        await expect(tickets.nth(0)).toContainText('2026-09-06-002');
        await expect(tickets.nth(0)).toContainText('Mie Goreng');
        await expect(tickets.nth(1)).toContainText('2026-09-06-001');
        await expect(tickets.nth(1)).toContainText('Sudah diantar');

        // ⚠️ AND ONE BILL. 50.000 + 30.000, never just the newest ticket.
        const totals = page.locator('.opanel.totals').first();
        expect((await totals.locator('.line.grand .num').first().innerText()).replace(/\D/g, ''))
            .toBe('80000');
        await expect(page.locator('#bill-btn')).toContainText('80.000');
        await expect(page.locator('#bill-btn'), 'the CTA quoted only the newest ticket')
            .not.toContainText('30.000');

        // ⚠️ AND THE BADGE COUNTS THE SITTING. It read `lines` — the newest
        // ticket's — so the tab whose whole job is "here is what you have
        // ordered" showed 1 for a diner holding two rounds.
        await expect(page.locator('#tab-orders-badge')).toHaveText('2');
    });

    test('a SERVED ticket stays on the bill — stage does not decide what is owed', async ({ page }) => {
        // Jay's example, verbatim: #001 Nasi Goreng served, #002 Mie Goreng
        // still being cooked, customer asks for the bill. Whether an order is
        // billed is decided by paid-or-not, never by how far along it is — and
        // `qr-request-bill` moves BOTH tickets to awaiting_payment, or the
        // cashier settles the newest round and leaves the first meal open.
        await stub(page);
        const line = (name, amount) => [{ item_id: 'i_americano', item_name: name,
            quantity: 1, gross_amount: amount, note: null, modifiers: [] }];
        const orders = [
            { order_id: 'o2', order_number: '002', status: 'sent', stage: 2,
                stage_label: 'Sedang disiapkan', lines: line('Mie Goreng', 30000),
                subtotal: 30000, discount_total: 0, service_charge_amount: 0,
                tax_amount: 0, total_amount: 30000, paid_amount: 0,
                pricing: null, placed_at: Date.now() - 60_000 },
            { order_id: 'o1', order_number: '001', status: 'served', stage: 4,
                stage_label: 'Sudah diantar', lines: line('Nasi Goreng', 50000),
                subtotal: 50000, discount_total: 0, service_charge_amount: 0,
                tax_amount: 0, total_amount: 50000, paid_amount: 0,
                pricing: null, placed_at: Date.now() - 30 * 60_000 }
        ];
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, ...orders[0], lines: orders[0].lines,
                note: null, history: [], orders,
                session: {
                    order_count: 2, subtotal: 80000, discount_total: 0,
                    service_charge_amount: 0, tax_amount: 0,
                    total_amount: 80000, paid_amount: 0, outstanding: 80000
                }
            })
        }));

        let billBody = null;
        await page.route('**/qr-request-bill', (route) => {
            billBody = JSON.parse(route.request().postData() || '{}');
            return route.fulfill({
                status: 200, contentType: 'application/json',
                // Two tickets moved, which is the server-side half of the rule.
                body: JSON.stringify({ ok: true, already: false, order_count: 2,
                    order_numbers: ['002', '001'], order_number: '002' })
            });
        });

        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        // The served ticket is still shown, and still counted.
        await expect(page.locator('.oticket')).toHaveCount(2, { timeout: 15_000 });
        await expect(page.locator('#bill-btn')).toContainText('80.000');

        // Asking for the bill is a statement about the TABLE — one call, and
        // the server moves every live ticket behind it.
        await page.locator('#bill-btn').click();
        await expect(page.locator('#bill-btn')).toContainText('Ketuk lagi');
        await page.locator('#bill-btn').click();
        await expect.poll(() => billBody, { timeout: 15_000 }).not.toBe(null);
        expect(Object.keys(billBody), 'the request names the table, not an order')
            .toEqual(['token']);
    });

    test('a single ticket shows no ticket list — it would restate the panel above', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 20_000 });
        await page.locator('#done-status').click();
        await expect(page.locator('#sheet-orders')).toHaveClass(/is-open/);
        await expect(page.locator('.otickets')).toHaveCount(0);
    });

    // ── The hero ────────────────────────────────────────────────────────
    //
    // Two independent blocks: `.hero` knows about photos, `.outlet-card` knows
    // about the outlet. The card OVERLAPS the image rather than sitting under a
    // hard cut, and it is compact by construction — two rows, and a third is the
    // thing to resist.
    // ⚠️ RELATIVE TO NOW, NOT A FIXED CLOCK. These were 11:00–23:00 with Sunday
    // shut, and the suite ran at 23:17: the outlet read as closed, the
    // closed-store sheet covered the menu, and — now that the sheet is a hard
    // stop with no way out — every hero test below hung at an identity gate
    // that would never open. A fixture that only works before 11pm is one that
    // fails on the evening somebody is working late. Same class of bug as the
    // nocturnal POS board failures.
    //
    // Open all day, every day, except ONE day that is guaranteed not to be
    // today — so "closed" is still a state the hours panel has to render.
    const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const SHUT_DAY = WEEK[(new Date().getDay() + 3) % 7];
    const HOURS = WEEK.map((day) => (day === SHUT_DAY
        ? { day, closed: true, open: null, close: null }
        : { day, closed: false, open: '00:00', close: '23:59' }));
    const withHero = (over = {}) => ({
        ...MENU,
        outlet_info: { address: 'Jl. Kemang Raya 1', phone: '021 555 0000', hours: HOURS },
        ...over
    });
    const heroMenu = (page, body) => page.route('**/qr-menu?**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body)
    }));

    test('THE CARD OVERLAPS THE IMAGE, AND STAYS COMPACT', async ({ page }) => {
        await stub(page);
        await heroMenu(page, withHero());
        await open(page);

        const hero = await page.locator('#hero').boundingBox();
        const card = await page.locator('.outlet-card').boundingBox();
        const app = await page.locator('#app').boundingBox();

        // Full bleed — edge to edge of the app column, not inset.
        expect(Math.round(hero.width)).toBe(Math.round(app.width));
        // It FLOATS UP over the image edge rather than sitting below a hard cut.
        expect(hero.y + hero.height - card.y,
            'the card no longer overlaps the image').toBeGreaterThan(24);

        // ⚠️ COMPACT IS THE CONSTRAINT, so it is measured rather than trusted.
        // Two rows: the name, then one row carrying the table, the status and
        // both actions. A third row is what this assertion exists to catch.
        expect(card.height, `the outlet card grew to ${Math.round(card.height)}px`)
            .toBeLessThan(130);
        await expect(page.locator('.outlet-card > *:not([hidden])')).toHaveCount(2);

        // The scrim must never eat a swipe or a tap.
        expect(await page.locator('.hero-scrim')
            .evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
        // And the page itself must not scroll sideways.
        expect(await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('the gallery swipes, and the indicators follow', async ({ page }) => {
        await stub(page);
        await heroMenu(page, withHero({ has_cover: true }));
        await open(page);

        // A cover plus every photographed dish. The fixture has one.
        const slides = page.locator('.hero-slide');
        await expect(slides).toHaveCount(2, { timeout: 15_000 });
        await expect(page.locator('#hero-count')).toHaveText('1 / 2');
        await expect(page.locator('.hero-dot')).toHaveCount(2);

        await page.locator('#hero-rail').evaluate((el) => { el.scrollLeft = el.clientWidth; });
        await expect(page.locator('#hero-count')).toHaveText('2 / 2');
        expect(await page.evaluate(() =>
            [...document.querySelectorAll('.hero-dot')].findIndex((d) => d.classList.contains('is-on'))))
            .toBe(1);
    });

    test('ONE photo is not a gallery — no dots, no counter', async ({ page }) => {
        // An indicator for something that cannot move says "swipe me" and then
        // does not. The fixture's single photographed item is the only slide.
        await stub(page);
        await heroMenu(page, withHero());
        await open(page);
        await expect(page.locator('.hero-slide')).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator('#hero-count')).toBeHidden();
        await expect(page.locator('.hero-dot')).toHaveCount(0);
    });

    test('an outlet with no photograph falls back to the gradient', async ({ page }) => {
        await stub(page);
        await heroMenu(page, withHero({
            has_cover: false,
            items: MENU.items.map((i) => ({ ...i, has_image: false }))
        }));
        await open(page);
        await expect(page.locator('.hero-slide.is-empty')).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator('#hero-count')).toBeHidden();
        // The card still reads over it.
        await expect(page.locator('#outlet-name')).toHaveText(MENU.outlet);
    });

    test('THE OPEN STATUS OPENS THE WEEK, WITH TODAY MARKED', async ({ page }) => {
        await stub(page);
        await heroMenu(page, withHero());
        await open(page);

        const status = page.locator('#outlet-status');
        await expect(status).toBeVisible({ timeout: 15_000 });
        // A green dot and a closing time is a CLAIM, and a diner arriving late
        // deserves to check it — which is why the status is a button.
        await expect(page.locator('#outlet-hours')).toBeHidden();
        await status.click();
        await expect(page.locator('#outlet-hours')).toBeVisible();
        await expect(page.locator('.outlet-hours-row')).toHaveCount(7);
        await expect(page.locator('.outlet-hours-row.is-today')).toHaveCount(1);
        await expect(status).toHaveAttribute('aria-expanded', 'true');
        // One day of the week is shut in the fixture, and "Tutup" is a real
        // answer — asserted by COUNT, because which day it is has to move with
        // the calendar for the reason described at HOURS.
        await expect(page.locator('.outlet-hours-row', { hasText: 'Tutup' })).toHaveCount(1);
    });

    test('an outlet with no hours claims nothing', async ({ page }) => {
        // A green dot nobody entered would be a status the product invented.
        await stub(page);
        await heroMenu(page, withHero({
            outlet_info: { address: null, phone: null, hours: [] }
        }));
        await open(page);
        await expect(page.locator('#outlet-name')).toHaveText(MENU.outlet, { timeout: 15_000 });
        await expect(page.locator('#outlet-status')).toBeHidden();
        // And neither action is offered without the field it needs.
        await expect(page.locator('#act-directions')).toBeHidden();
        await expect(page.locator('#act-call')).toBeHidden();
    });

    test('Directions and Call carry the outlet\'s own details', async ({ page }) => {
        await stub(page);
        await heroMenu(page, withHero());
        await open(page);
        await expect(page.locator('#act-directions')).toBeVisible({ timeout: 15_000 });
        expect(await page.locator('#act-directions').getAttribute('href'))
            .toContain(encodeURIComponent('Jl. Kemang Raya 1'));
        // A dialable number: punctuation stripped, digits kept.
        expect(await page.locator('#act-call').getAttribute('href')).toBe('tel:0215550000');
        // Both on the SAME row as the status — that grouping is the constraint.
        const statusBox = await page.locator('#outlet-status').boundingBox();
        const callBox = await page.locator('#act-call').boundingBox();
        expect(Math.abs((statusBox.y + statusBox.height / 2) - (callBox.y + callBox.height / 2)))
            .toBeLessThan(24);
    });

    // ── Rekomendasi Kami ────────────────────────────────────────────────
    //
    // The owner's own picks, marked per item in Inventory. A rail above the menu
    // it is drawn from.
    // ALL THREE, so the rail genuinely overflows at the test viewport. Now that
    // a card is a grid column rather than a hand-picked 208px, two of them fit
    // on screen and the scroll assertion below would pass on a rail that could
    // not scroll — green for the wrong reason.
    const withRecos = (over = {}) => ({
        ...MENU,
        items: MENU.items.map((i) => ({ ...i, recommended: true })),
        ...over
    });

    test('THE RECOMMENDATIONS RAIL SITS BETWEEN THE CHIPS AND THE MENU', async ({ page }) => {
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(withRecos())
        }));
        await open(page);

        const rail = page.locator('#recos');
        await expect(rail).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#recos-title')).toHaveText(/rekomendasi/i);
        // ONLY the marked items, never the whole menu.
        const cards = page.locator('.reco-card');
        await expect(cards).toHaveCount(3);
        await expect(cards.first()).toContainText('Es Kopi Susu');

        // Position is the spec, not an accident: below the category chips and
        // above the menu they are drawn from.
        const chips = await page.locator('#chips').boundingBox();
        const box = await rail.boundingBox();
        const menu = await page.locator('#menu').boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(chips.y + chips.height - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(menu.y + 1);

        // ⚠️ THE RAIL FOLLOWS THE GRID, exactly. A hand-picked card width is how
        // a rail ends up looking like a different component that happens to be
        // nearby — both read `--card-w`, so they cannot drift.
        const recoCard = await page.locator('.reco-card').first().boundingBox();
        const gridCard = await page.locator('.grid .card').first().boundingBox();
        expect(Math.abs(recoCard.width - gridCard.width),
            `rail card ${Math.round(recoCard.width)}px vs grid card ${Math.round(gridCard.width)}px`)
            .toBeLessThan(1.5);
        // And the first card starts on the grid's own left edge. `scroll-snap-align:
        // start` snaps to the SCROLLPORT edge and ignores padding, so without a
        // matching `scroll-padding` the rail rests scrolled by its own inset and
        // the first card sits flush against the screen.
        expect(Math.abs(recoCard.x - gridCard.x),
            'the first card does not line up with the menu below it').toBeLessThan(1.5);
        expect(await page.locator('.recos-rail').evaluate((el) => el.scrollLeft),
            'the rail rests scrolled, eating its own left inset').toBe(0);

        // 8px between the tab strip and the title, as specified.
        const section = await page.locator('#recos').boundingBox();
        const title = await page.locator('#recos-title').boundingBox();
        expect(Math.round(title.y - section.y)).toBe(8);

        // Its own ground, so it does not read as the first row of the menu.
        expect(await page.locator('#recos').evaluate((el) => getComputedStyle(el).backgroundImage))
            .not.toBe('none');
        // The outlet's name is already on the card directly above; restating it
        // here was the redundancy CLAUDE.md bans on eyebrows.
        await expect(page.locator('.recos-sub')).toHaveCount(0);

        // It scrolls horizontally, and the PAGE does not.
        const overflows = await page.locator('.recos-rail')
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflows, 'the rail does not scroll — cards were wrapped or shrunk').toBe(true);
        expect(await page.evaluate(() =>
            document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('THE RAIL IS WARM, AND THE SPARKLE IS ACTUALLY VISIBLE', async ({ page }) => {
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            // has_image: false throughout — see the three-shot note below.
            body: JSON.stringify(withRecos({
                items: MENU.items.map((i) => ({ ...i, recommended: true, has_image: false }))
            }))
        }));
        await open(page);
        const rail = page.locator('#recos');
        await expect(rail).toBeVisible({ timeout: 15_000 });

        // Warm, not cool. Asserted as a RELATIONSHIP rather than a hex, so
        // retuning the exact tint does not fail a test about the mood.
        const rgb = await rail.evaluate((el) => {
            const m = getComputedStyle(el).backgroundImage.match(/rgba?\(([^)]+)\)/);
            return m ? m[1].split(',').map((n) => parseFloat(n)) : null;
        });
        expect(rgb, 'the rail lost its gradient').not.toBeNull();
        expect(rgb[0], 'the rail is not warmer than it is cool').toBeGreaterThan(rgb[2]);

        // ⚠️ A PALE GRADIENT, NEVER A SOLID ORANGE PANEL. Orange backgrounds are
        // prohibited project-wide; the gradient is the carve-out.
        expect(await rail.evaluate((el) =>
            getComputedStyle(el).backgroundImage.includes('gradient'))).toBe(true);

        const spark = page.locator('.recos-sparkle');
        await expect(spark).toHaveCount(1);
        await expect(spark).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('.recos-sparkle svg')).toHaveCount(5);

        // ⚠️ THE ASSERTION THE FIRST VERSION OF THIS TEST WAS MISSING.
        //
        // It checked that the layer's z-index was -1 and passed, and the stars
        // were invisible the entire time: `#recos` is `position: relative` and
        // paints its OWN gradient, so a negative z-index child goes behind that
        // background rather than behind the cards. Every property was correct
        // and nothing could be seen — which is what an assertion about a CSS
        // VALUE buys you when the claim is about a picture.
        //
        // So: render the strip, hide the layer, render it again, and require
        // the two to differ. That cannot pass on stars nobody can see.
        // ⚠️ WHERE THE STAR ACTUALLY PAINTS, not what its stylesheet claims.
        //
        // The first version of this test asserted `z-index === '-1'` and passed
        // while the stars were invisible the whole time: `#recos` is
        // `position: relative` and paints its OWN gradient, so a child at a
        // negative z-index goes behind THAT rather than behind the cards. Every
        // property was correct and nothing could be seen — which is what an
        // assertion about a CSS VALUE buys you when the claim is about a
        // picture. A pixel diff replaced it and was worse: it passed on a
        // hidden layer, because a stub photo decoded between the two frames and
        // that was the difference it found.
        //
        // `elementsFromPoint` returns the hit-test stack topmost-first, which
        // follows paint order. Above `#recos` means in front of the section's
        // background; that is the whole claim, and it is one integer comparison
        // on both engines instead of a screenshot that has to hold still.
        const paint = await spark.evaluate((el) => {
            el.style.pointerEvents = 'auto';          // hit-testing only, restored below
            const star = el.querySelector('.s1');
            const r = star.getBoundingClientRect();
            const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            el.style.pointerEvents = '';
            return { star: stack.indexOf(star), section: stack.indexOf(document.getElementById('recos')) };
        });
        expect(paint.star, 'the star is not painted at its own coordinates at all')
            .toBeGreaterThanOrEqual(0);
        expect(paint.section, 'the star is not inside the rail').toBeGreaterThan(-1);
        expect(paint.star,
            'the star paints BEHIND the section background — drawn, animated, invisible')
            .toBeLessThan(paint.section);

        // And still behind the cards, and still untappable.
        const layer = await spark.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { z: Number(cs.zIndex), pe: cs.pointerEvents };
        });
        const content = await page.locator('.recos-rail')
            .evaluate((el) => Number(getComputedStyle(el).zIndex));
        expect(layer.z, 'the sparkle sits above the cards').toBeLessThan(content);
        expect(layer.pe, 'the sparkle can swallow a tap').toBe('none');
    });

    test('a card in the rail opens the item, like every other card', async ({ page }) => {
        // ⚠️ THE BUG THIS PINS: `#recos` is a SIBLING of `#menu`, and the
        // delegated open handler was bound to `#menu`. The rail's cards looked
        // perfectly tappable and did nothing at all.
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(withRecos())
        }));
        await open(page);
        await page.locator('.reco-card', { hasText: 'Es Kopi Susu' })
            .getByRole('button', { name: /tambah/i }).click();
        // The item SHEET, not a straight add — a recommended dish carries options
        // like any other, and a button that skipped them would cart the wrong thing.
        await expect(page.locator('#sheet-item')).toHaveClass(/is-open/, { timeout: 15_000 });
        await expect(page.locator('#item-title')).toHaveText('Es Kopi Susu');
    });

    test('a recommendation with no photo stays legible instead of going muddy', async ({ page }) => {
        // Most items have no photo (items.md §9), so this is the COMMON case.
        // A dark scrim over a pastel tint turns the card to grey sludge and reads
        // as a loading failure, so a photoless card inverts to ink on light.
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(withRecos())
        }));
        await open(page);
        // Two of the three fixture items carry no photo.
        const plain = page.locator('.reco-card.is-plain');
        await expect(plain).toHaveCount(2);
        const ink = await plain.first().locator('.card-name').evaluate((el) => getComputedStyle(el).color);
        const onPhoto = await page.locator('.reco-card:not(.is-plain) .card-name')
            .evaluate((el) => getComputedStyle(el).color);
        expect(ink, 'the photoless card kept the white-on-photo treatment').not.toBe(onPhoto);
    });

    test('the rail is a BROWSE affordance — it gets out of the way when searching', async ({ page }) => {
        // A diner who has typed a dish has said what they want. A fixed rail of
        // something else at the top of their results is the page arguing.
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(withRecos())
        }));
        await open(page);
        await expect(page.locator('#recos')).toBeVisible();

        await page.locator('#search').fill('americano');
        await expect(page.locator('#recos')).toBeHidden();
        await page.locator('#search').fill('');
        await expect(page.locator('#recos')).toBeVisible();

        // Same for a category tab.
        await page.locator('.chip', { hasText: 'Kopi' }).click();
        await expect(page.locator('#recos')).toBeHidden();
    });

    test('an outlet that has recommended nothing gets no heading', async ({ page }) => {
        // An empty rail under a title is a promise the outlet has not made.
        await stub(page);
        await open(page);
        await expect(page.locator('#recos')).toBeHidden();
        await expect(page.locator('.reco-card')).toHaveCount(0);
    });

    test('THE GATE NEVER GOES LOOKING FOR ARTWORK THAT WAS NOT DECLARED', async ({ page }) => {
        // ⚠️ DECLARED, NOT PROBED. The obvious build — try `.svg`, then `.png`,
        // then `.webp` — costs every diner three or four 404s on restaurant
        // wifi at every outlet that ships none, and Chromium logs each as a
        // console error. This is the guard against reintroducing that.
        const asked = [];
        await stub(page);
        await page.route('**/assets/images/order-welcome.*', (route) => {
            asked.push(new URL(route.request().url()).pathname);
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ART_SVG });
        });
        // Artwork now ships, so undeclare it — this test is about the outlet
        // that has none, which is what every other outlet is until one is made
        // for it.
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                const el = document.getElementById('welcome-art');
                if (el) el.dataset.src = '';
            });
        });
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });

        await expect(page.locator('#welcome-art .welcome-note')).toHaveCount(3);
        await expect(page.locator('#welcome-art')).not.toHaveClass(/has-asset/);
        expect(asked, 'the page went looking for artwork that was never declared')
            .toEqual([]);
    });

    test('THE SHIPPED ILLUSTRATION TAKES THE STAGE, AND IS NOT HEAVY', async ({ page }) => {
        await stub(page);
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });

        const art = page.locator('#welcome-art');
        await expect(art).toHaveClass(/has-asset/);
        // It REPLACES the fallback rather than stacking on top of it.
        await expect(art.locator('.welcome-note')).toHaveCount(0);
        // Artwork brings its own composition, so the stage drops the mask and
        // the dot field — fading someone's illustration out at its edges is
        // not a treatment, it is damage.
        expect(await art.evaluate((el) => getComputedStyle(el).maskImage
            || getComputedStyle(el).webkitMaskImage)).toBe('none');
        // It DECODES — a broken-image box passes every assertion above.
        await expect.poll(async () => art.locator('img').evaluate((el) => el.naturalWidth),
            { timeout: 10_000 }).toBeGreaterThan(0);

        // ⚠️ WEIGHT IS A FEATURE HERE. This is a diner's phone on restaurant
        // wifi, and the page's whole design is one fast round trip. The
        // supplied source was a 1.4MB PNG; anything near that must not creep
        // back in through a re-export.
        const res = await page.request.get('/assets/images/order-welcome.webp');
        expect(res.ok()).toBeTruthy();
        const bytes = (await res.body()).length;
        expect(bytes, `the hero illustration is ${Math.round(bytes / 1024)}KB`)
            .toBeLessThan(120 * 1024);
    });

    test('a declared illustration that will not decode falls back, not to a broken box', async ({ page }) => {
        // A typo in the path, a format the browser will not read, a file that
        // never deployed. Any of them would otherwise leave a broken-image box
        // where the hero should be, saying nothing about why.
        await stub(page);
        await page.route('**/assets/images/order-welcome.webp', (route) =>
            route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }));
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });

        const art = page.locator('#welcome-art');
        await expect(art).not.toHaveClass(/has-asset/);
        // The card stack was always a complete design, not a placeholder.
        await expect(art.locator('.welcome-note')).toHaveCount(3);
        await expect(art.locator('img')).toHaveCount(0);
        // And the sheet is still usable, which is the point.
        await expect(page.locator('#welcome-name')).toBeVisible();
        await expect(page.locator('#welcome-go')).toBeVisible();
    });

    test('THE HEADER IS THE RESTAURANT, WITH A SCRIM THAT KEEPS IT LEGIBLE', async ({ page }) => {
        // The gradient is the FALLBACK, not the intended look. A cover photo
        // belongs here, and the owner-facing control (POS settings) is not
        // built — so the placeholder is the outlet's first photographed item,
        // served by the endpoint the grid already uses.
        await stub(page);
        await open(page);

        const shot = page.locator('.hero-slide img').first();
        await expect(shot).toBeVisible({ timeout: 15_000 });
        expect(await shot.getAttribute('src'),
            'the hero is not the token-authenticated image endpoint')
            .toContain('qr-menu-image');
        // ⚠️ NEVER a URL handed over in the menu payload. That was tried on
        // 2026-09-05 and did not work — qr-menu's initAdmin sets no
        // storageBucket, so the signed-URL call threw and the catch turned it
        // into "this outlet has no photo", silently. The deeper reason it stays
        // out: a URL in that payload is a second way to reach Storage, bypassing
        // the rate limiter, the revoked-token check and the path guard.
        const payloadHasUrl = await page.evaluate(async (t) => {
            const r = await fetch(`/.netlify/functions/qr-menu?token=${t}`);
            const j = await r.json();
            return typeof j.cover_image === 'string' && /https?:/.test(j.cover_image);
        }, TOKEN).catch(() => false);
        expect(payloadHasUrl, 'qr-menu handed out a Storage URL').toBe(false);

        // ⚠️ THE SCRIM IS NOT DECORATION. The back button, the photo counter and
        // the card's top edge all sit on a photograph nobody has seen — a lit
        // dish on a white plate erases every one of them. A photo layer with no
        // dark layer over it is the bug this pins.
        const scrim = await page.locator('.hero-scrim')
            .evaluate((el) => getComputedStyle(el).backgroundImage);
        expect(scrim, 'the hero photo has no scrim over it')
            .toMatch(/linear-gradient\(.*rgba\(11, 15, 25/);
    });

    test('a shipped cover photo takes the header, through the image endpoint', async ({ page }) => {
        await stub(page);
        // The menu says only WHETHER a cover exists; the bytes come from the
        // endpoint every item photo uses.
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ...MENU, has_cover: true })
        }));
        await open(page);
        // The owner's own cover LEADS the gallery. Dish photos follow it, so a
        // shop that has uploaded one is not shown its food first.
        const first = page.locator('.hero-slide img').first();
        await expect(first).toBeVisible({ timeout: 15_000 });
        const src = await first.getAttribute('src');
        expect(src).toContain('cover=1');
        expect(src, 'the owner\'s cover fell back to an item photo').not.toContain('item=');
    });

    test('A SHEET SITS ON THE KEYBOARD, AND THE PAGE BEHIND IT CANNOT SCROLL', async ({ page }) => {
        // Both halves of one iOS defect, reported as "a gap appears between the
        // bottom sheet and the background when I fill in the name".
        //
        // A `position: fixed` sheet is anchored to the LAYOUT viewport, which the
        // software keyboard does not shrink — and `overflow: hidden` on body does
        // not hold on iOS, so Safari scrolled the document to reveal the focused
        // input and dragged the sheet with it. The menu then showed through the
        // strip underneath.
        //
        // No headless browser raises a software keyboard, so this drives the
        // mechanism: `--kb-inset` is what syncKeyboardInset() writes, and the
        // sheet must be positioned and sized off it.
        await stub(page);
        await goTo(page);
        const gate = page.locator('#sheet-welcome');
        await expect(gate).toHaveClass(/is-open/, { timeout: 15_000 });

        // UNROUNDED. Rounding each endpoint separately lets the delta below
        // land a pixel out on fractional layout — which is measurement noise
        // reported as a design failure. Round the delta once instead.
        const geometry = () => gate.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { liftedBy: window.innerHeight - r.bottom, height: r.height };
        });

        // A few pixels of viewport jitter is NOT a keyboard, and treating it as
        // one would nudge every sheet by a hairline — WebKit reported 5px on a
        // cold load and left exactly the seam this fix removes.
        expect(await page.evaluate(() => getComputedStyle(document.documentElement)
            .getPropertyValue('--kb-inset').trim())).toBe('0px');

        // Flush against the bottom with no keyboard up. POLLED, because the
        // `is-open` class lands 260ms before the slide-in transform finishes —
        // a single read here measures the sheet mid-entrance. 1px of tolerance
        // on top, for fractional layout.
        await expect
            .poll(async () => Math.abs((await geometry()).liftedBy),
                  { timeout: 5_000, message: 'the sheet settles flush to the bottom' })
            .toBeLessThanOrEqual(1);
        const resting = await geometry();

        // A 300px keyboard lifts the sheet by exactly 300px — not "somewhere
        // above it" — and takes that much off the room it has to be tall in.
        // The DELTA is the claim, and it cancels the sub-pixel above.
        await page.evaluate(() =>
            document.documentElement.style.setProperty('--kb-inset', '300px'));
        const lifted = await geometry();
        expect(Math.round(lifted.liftedBy - resting.liftedBy)).toBe(300);
        expect(lifted.height).toBeLessThanOrEqual(844 - 300 - 12 + 1);
        expect(lifted.height).toBeLessThanOrEqual(resting.height);

        // And the page behind is out of flow at its offset, not merely
        // `overflow: hidden` — which iOS ignores.
        expect(await page.evaluate(() => getComputedStyle(document.body).position))
            .toBe('fixed');
    });

    test('closing a sheet returns the menu to where it was, not to the top', async ({ page }) => {
        // The scroll lock takes the body out of flow, so releasing it has to put
        // the offset back — otherwise every sheet a diner opens halfway down a
        // long menu spits them out at the top of it.
        await stub(page);
        await open(page);
        await page.evaluate(() => window.scrollTo(0, 400));
        const before = await page.evaluate(() => Math.round(window.pageYOffset));
        expect(before).toBeGreaterThan(0);

        // Opened from the FIXED tab bar. Clicking a menu card would make
        // Playwright scroll it into view first, changing the offset the lock
        // records — the test would then be about Playwright, not about the lock,
        // and it passed or failed depending on how far images had loaded.
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('#sheet-orders')).toHaveClass(/is-open/);
        expect(await page.evaluate(() => getComputedStyle(document.body).position))
            .toBe('fixed');

        await page.locator('#scrim').click({ position: { x: 10, y: 10 } });
        await expect(page.locator('#sheet-orders')).not.toHaveClass(/is-open/);

        expect(await page.evaluate(() => Math.round(window.pageYOffset))).toBe(before);
        expect(await page.evaluate(() => getComputedStyle(document.body).position))
            .not.toBe('fixed');
    });

    test('a returning diner mid-sitting is not asked twice', async ({ page }) => {
        const capture = {};
        await stub(page, { capture });
        await open(page);                       // fills the gate
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);

        // The table is now IN the sitting this device just started.
        capture.status = {
            has_order: true, order_id: 'ord_1', order_number: '2026-09-03-007',
            status: 'sent', stage: 2, stage_label: 'Sedang disiapkan',
            lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                      gross_amount: 22000, note: null, modifiers: [] }],
            note: null, subtotal: 22000, service_charge_amount: 0, tax_amount: 0,
            discount_total: 0, total_amount: 22000, paid_amount: 0, placed_at: Date.now()
        };
        await page.reload();
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });
        // Same sitting, same person — straight to the food.
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);
    });

    test('THE SITTING DIES; THE DINER IS NOT MADE A STRANGER AGAIN', async ({ page }) => {
        // The fraud shape this guards: pay, leave, reopen the saved link the
        // next day and keep ordering to a table you have already settled. The
        // session used to be one global key holding only a name, so the page had
        // no way to know its sitting was long since paid and cleared.
        //
        // What it must NOT do is treat "the sitting ended" as "we have never met
        // you". Re-asking the name protected nothing — the server accepts a
        // sitting-less order from any caller, because a printed QR makes a fresh
        // scan and a reopened link byte-identical — while charging the diner
        // their name, their number and their whole cart for a second round.
        const capture = {};
        await stub(page, { capture });
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);
        expect(capture.body.sitting, 'the first order starts a sitting').toBeFalsy();
        expect(capture.body.customer_name).toBe('Sinta');

        // The cashier settles the bill. `qr-order-status` stops returning it,
        // so the table reads clear.
        capture.status = { has_order: false, lines: [] };
        // The toast self-dismisses after 2.6s, which is shorter than a cold
        // WebKit boot — latch what it said instead of racing it.
        await page.addInitScript(() => {
            window.__toastLog = [];
            document.addEventListener('DOMContentLoaded', () => {
                const el = document.getElementById('toast');
                if (!el) return;
                new MutationObserver(() => {
                    if (el.classList.contains('is-open')) window.__toastLog.push(el.textContent);
                }).observe(el, { attributes: true, attributeFilter: ['class'] });
            });
        });
        await page.reload();
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });

        // The sitting is gone — said, not asked.
        await expect
            .poll(() => page.evaluate(() => (window.__toastLog || []).join(' ')), { timeout: 15_000 })
            .toContain('sudah selesai');
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);
        // Nothing carried over from the settled round.
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);

        // The next order opens a NEW sitting rather than continuing the dead
        // one, and still carries who it is for.
        capture.body = null;
        await addPlain(page, 'Nasi Goreng');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 15_000 });
        expect(capture.body.sitting, 'the dead sitting is not resent').toBeFalsy();
        expect(capture.body.customer_name, 'identity survived the settled bill').toBe('Sinta');
    });

    test('AN ORDER INTO A SETTLED SITTING OPENS A NEW ONE, IN ONE TAP', async ({ page }) => {
        // The bill is settled at the till while this page is still open, so the
        // next order carries a sitting the table is no longer in and the server
        // refuses it with `sitting_ended`.
        //
        // That refusal only ever meant "you cannot APPEND to that". It used to
        // be handled as a teardown — cart emptied, identity forgotten, the
        // identity gate back over the menu, and the notice explaining why
        // written into the cart the diner had just been navigated away from. The
        // diner's second attempt then worked, which is what made it read as the
        // page randomly asking for their name again.
        const capture = {};
        await stub(page, { capture });
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);
        await page.locator('#done-more').click();

        // Refuse ONLY an order that claims the dead sitting. An order that
        // claims none is a new sitting and is accepted — which is exactly what
        // the server does, and what makes the retry legitimate rather than a
        // way of talking a refusal into a yes.
        const sent = [];
        await page.route('**/qr-order', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            sent.push(body);
            if (body.sitting) {
                return route.fulfill({
                    status: 409, contentType: 'application/json',
                    body: JSON.stringify({ error: 'sitting_ended' })
                });
            }
            return route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({
                    ok: true, order_id: 'ord_2', order_number: '2026-09-03-008',
                    total_amount: 45000, rejected_lines: 0
                })
            });
        });

        await addPlain(page, 'Nasi Goreng');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();

        // ONE tap lands on the confirmation, not on the identity gate.
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 15_000 });
        await expect(page.locator('#done-number')).toHaveText('2026-09-03-008');
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);

        // Two requests: the refused one carrying the dead sitting, then the same
        // order as a new sitting. Same `client_ref` both times — the refusal
        // happens before the idempotency ref is written, so this stays one order
        // however it lands.
        expect(sent).toHaveLength(2);
        expect(sent[0].sitting, 'the first attempt claims the dead sitting').toBeTruthy();
        expect(sent[1].sitting, 'the retry opens a new sitting').toBeFalsy();
        expect(sent[1].client_ref).toBe(sent[0].client_ref);
        expect(sent[1].customer_name, 'identity was never torn down').toBe('Sinta');
        expect(sent[1].lines, 'the cart survived the refusal').toEqual(sent[0].lines);
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

        // Every CARD is 3:4 and identical, photo or placeholder. The card is now
        // the tile — the photo fills it and the name sits across the bottom —
        // so a ragged card is a ragged row. A square source image once stretched
        // its tile because `height: 100%` in an aspect-ratio box resolves to
        // auto; the image is absolutely positioned to stop that.
        const tiles = await page.locator('.card').evaluateAll((els) => els.map((e) => {
            const r = e.getBoundingClientRect();
            return { ratio: +(r.width / r.height).toFixed(2), h: Math.round(r.height) };
        }));
        tiles.forEach((t) => expect(t.ratio).toBeCloseTo(0.75, 1));
        expect(new Set(tiles.map((t) => t.h)).size,
            'cards are not all the same height — the grid will look ragged').toBe(1);
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

        // The active tab is a solid navy pill with white content — the same ink
        // as the cart bar, so the two primary surfaces read as one system. An
        // orange wash was tried here and looked muddy at this size.
        const active = page.locator('.tab[aria-current="true"]');
        await expect(active).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect(active).toHaveCSS('background-color', 'rgb(11, 15, 25)');

        // The cart bar floats ABOVE the tab bar — they must never overlap.
        // Polled, because it SLIDES in over 240ms.
        await addPlain(page, 'Americano');
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
                discount_total: 0, total_amount: 68000, paid_amount: 0,
                // The real endpoint always returns this; the hero shows how
                // long the order has been in, which is half of what a waiting
                // diner opened the sheet to learn.
                placed_at: Date.now() - 14 * 60 * 1000
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
        await expect(sheet).toContainText('Sedang dimasak');   // the diner's word, not the till's
        await expect(sheet).toContainText('Kentang Goreng');
        await expect(sheet).toContainText('tidak asin');       // the line note
        await expect(sheet).toContainText('Large');            // the modifier
        await expect(sheet).toContainText('Sendok garpu 2');   // the order note
        await expect(sheet.locator('.totals .grand .num')).toHaveText('Rp68.000');

        // ⚠️ THREE STEPS, NOT SEVEN AND NOT FOUR. The till's ladder has seven
        // because a cook and a cashier need them; a person at a table has three
        // questions — is it cooking, is it here, what do I owe. `sent` is the
        // first of the three.
        await expect(sheet.locator('.ostage-pip')).toHaveCount(3);
        await expect(sheet.locator('.ostage-pip.done')).toHaveCount(1);
        // Exactly ONE step is the current one. Three filled rules would say
        // "done, done, done" rather than "you are here".
        await expect(sheet.locator('.ostage-pip.now')).toHaveCount(1);

        // One illustration, for the step it is actually on.
        await expect(sheet.locator('.ostage-art')).toHaveAttribute('src', /cooked\.webp$/);
        await expect(sheet.locator('.ostage-now')).toHaveText('Sedang dimasak');
        // ⚠️ THE TICKET NUMBER LIVES WITH THE TITLE, not under the picture: it
        // is the reference a diner reads out to staff, and the illustration is
        // the answer to a different question.
        await expect(page.locator('#orders-no')).toHaveText('2026-09-03-004');
        await expect(page.locator('#orders-no')).toBeVisible();
        await expect(page.locator('#orders-sub')).toContainText('Meja A04');
        await expect(page.locator('#orders-sub')).toContainText('lalu');   // how long ago
        // And no subtitle promising a WhatsApp message on a screen the diner is
        // already reading.
        await expect(sheet.locator('.ostage-hint')).toHaveCount(0);

        // Lines carry the same thumbnail treatment as the order page, so a
        // diner recognises a dish rather than re-reading its name.
        await expect(sheet.locator('.oline .cartline-thumb')).toHaveCount(2);
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

    test('ASKING FOR THE BILL TAKES TWO TAPS AND ENDS THE SITTING', async ({ page }) => {
        const capture = {
            status: {
                has_order: true, order_number: '2026-09-03-011', status: 'served',
                stage: 4, stage_label: 'Sudah diantar',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                          gross_amount: 22000, note: null, modifiers: [] }],
                note: null, subtotal: 22000, service_charge_amount: 0, tax_amount: 0,
                discount_total: 0, total_amount: 22000, paid_amount: 0,
                placed_at: Date.now() - 20 * 60 * 1000
            }
        };
        let billCalls = 0;
        await stub(page, { capture });
        await page.route('**/qr-request-bill', async (route) => {
            billCalls += 1;
            // The server is the source of truth for the new state, so the page
            // repaints from a fresh status rather than assuming.
            capture.status = { ...capture.status, status: 'awaiting_payment',
                stage: 5, stage_label: 'Menunggu pembayaran' };
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, already: false, order_number: '2026-09-03-011' }) });
        });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('.ostage')).toBeVisible();

        const btn = page.locator('#bill-btn');
        await expect(btn).toBeVisible();

        // ONE tap only arms it. Ending the sitting by brushing a button while
        // scrolling is not a thing that should be possible.
        await btn.click();
        expect(billCalls, 'the first tap must not call the server').toBe(0);
        await expect(btn).toContainText('konfirmasi');
        await expect(page.locator('#bill-hint')).toContainText('pindai QR lagi');

        await btn.click();
        expect(billCalls).toBe(1);

        // Once asked for, there is nothing left to press.
        await expect(btn).toBeHidden();
        await expect(page.locator('.ostage-now')).toHaveText('Pembayaran');
        await expect(page.locator('.ostage-art')).toHaveAttribute('src', /payment\.webp$/);
        // ⚠️ THE GREEN STRIP IS GONE and its sentence is the step's subtitle.
        // It was answering "what is happening now", which is what this line is
        // for; below the steps it was a second status making the same claim.
        await expect(page.locator('.bill-called')).toHaveCount(0);
        await expect(page.locator('.ostage-hint')).toContainText('bayar di kasir');
        // And the page says what happens next: paying frees the table, and
        // ordering again means scanning again.
        await expect(page.locator('.orders-foot')).toContainText('Pindai QR');
    });

    test('the bill cannot be asked for before the food arrives', async ({ page }) => {
        // A bill requested while the kitchen is still cooking summons a cashier
        // to a table that is waiting on its order. Before it is served the
        // honest action is "order something else".
        const capture = {
            status: {
                has_order: true, order_number: '2026-09-04-002', status: 'sent',
                stage: 2, stage_label: 'Sedang disiapkan',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                          gross_amount: 22000, note: null, modifiers: [] }],
                note: null, subtotal: 22000, service_charge_amount: 0, tax_amount: 0,
                discount_total: 0, total_amount: 22000, paid_amount: 0,
                placed_at: Date.now() - 5 * 60 * 1000
            }
        };
        await stub(page, { capture });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('.ostage')).toBeVisible();

        await expect(page.locator('#bill-btn')).toBeHidden();
        await expect(page.locator('#bill-hint')).toBeHidden();
        // Adding more is always available, and it puts the menu back.
        await expect(page.locator('#orders-add')).toBeVisible();
        await page.locator('#orders-add').click();
        await expect(page.locator('#sheet-orders')).not.toHaveClass(/is-open/);
        await expect(page.locator('#view-menu')).toBeVisible();
    });

    test('the progress icons are drawn at full size, not a quarter of it', async ({ page }) => {
        // They render in a 24-unit box. Passing one to the 48-unit helper the
        // category rail uses put each glyph in the top-left corner at quarter
        // scale — which is exactly what shipped.
        const capture = {
            status: {
                has_order: true, order_number: '2026-09-04-003', status: 'sent',
                stage: 2, stage_label: 'Sedang disiapkan',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                          gross_amount: 22000, note: null, modifiers: [] }],
                note: null, subtotal: 22000, service_charge_amount: 0, tax_amount: 0,
                discount_total: 0, total_amount: 22000, paid_amount: 0, placed_at: Date.now()
            }
        };
        await stub(page, { capture });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('.ostage')).toBeVisible();

        // ⚠️ THE ILLUSTRATION MUST ACTUALLY DECODE AND HAVE ROOM. It replaced a
        // drawn glyph with a file, which is a new way for this block to fail —
        // a wrong path renders a broken-image box and every other assertion
        // here still passes.
        const art = page.locator('.ostage-art');
        const drawn = await art.evaluate((el) => ({
            ok: el.complete && el.naturalWidth > 0,
            h: Math.round(el.getBoundingClientRect().height),
            w: Math.round(el.getBoundingClientRect().width)
        }));
        expect(drawn.ok, 'the step illustration did not load').toBe(true);
        expect(drawn.h, 'the illustration is too small to read').toBeGreaterThan(90);
        expect(drawn.w).toBeGreaterThan(60);
        // It is decoration, so it must be out of the accessibility tree — the
        // step name beside it is the text a screen reader should read.
        expect(await art.getAttribute('alt')).toBe('');
    });

    test('THE THREE STEPS MAP THE WHOLE OF THE TILL\'S SEVEN', async ({ page }) => {
        // ⚠️ EVERY SERVER STATUS LANDS SOMEWHERE. The till has seven and the
        // diner sees three, so the mapping is the feature — a status that falls
        // through shows the wrong picture, which is worse than showing none.
        // `ready` belongs under COOKING on purpose: food plated in the pass is
        // still food that has not arrived at the table.
        const cases = [
            { status: 'open', stage: 1, step: 1, art: /cooked/, label: 'Sedang dimasak' },
            { status: 'submitted', stage: 1, step: 1, art: /cooked/, label: 'Sedang dimasak' },
            { status: 'sent', stage: 2, step: 1, art: /cooked/, label: 'Sedang dimasak' },
            { status: 'ready', stage: 3, step: 1, art: /cooked/, label: 'Sedang dimasak' },
            { status: 'served', stage: 4, step: 2, art: /served/, label: 'Sudah diantar' },
            { status: 'awaiting_payment', stage: 5, step: 3, art: /payment/, label: 'Pembayaran' },
            { status: 'paid', stage: 6, step: 3, art: /payment/, label: 'Pembayaran' }
        ];

        await stub(page);
        let live = cases[0];
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, order_id: 'o1', order_number: '2026-09-07-001',
                status: live.status, stage: live.stage, stage_label: 'x',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                    gross_amount: 22000, note: null, modifiers: [] }],
                note: null, history: [], orders: [],
                subtotal: 22000, discount_total: 0, service_charge_amount: 0,
                tax_amount: 0, total_amount: 22000, paid_amount: 0,
                pricing: null, placed_at: Date.now() - 5 * 60 * 1000
            })
        }));
        await open(page);

        for (const c of cases) {
            live = c;
            await page.locator('.tab[data-tab="orders"]').click();
            await expect(page.locator('.ostage')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.ostage-now'), `${c.status} names the wrong step`)
                .toHaveText(c.label, { timeout: 15_000 });
            await expect(page.locator('.ostage-art'), `${c.status} shows the wrong picture`)
                .toHaveAttribute('src', c.art);
            await expect(page.locator('.ostage-pip.done'),
                `${c.status} fills the wrong number of steps`).toHaveCount(c.step);
            await expect(page.locator('.ostage-pip.now')).toHaveCount(1);

            // ⚠️ ESCAPE, NOT THE SCRIM. A scrim click is hit-tested, and on
            // WebKit one landed while the sheet was still animating open and
            // was swallowed — the next iteration then timed out clicking a tab
            // the still-open sheet was covering. Escape is a document handler
            // with nothing to hit. Asserted closed before moving on, so a
            // swallowed dismissal fails here rather than somewhere downstream.
            await page.keyboard.press('Escape');
            await expect(page.locator('#sheet-orders')).not.toHaveClass(/is-open/);
        }

        // And the gradient panel and the four-glyph track are gone for good.
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('.ostat')).toHaveCount(0);
        await expect(page.locator('.track-step')).toHaveCount(0);
    });

    test('the empty state is the basket, not a grey tile', async ({ page }) => {
        await stub(page);
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();

        const art = page.locator('.orders-empty-art');
        await expect(art).toBeVisible({ timeout: 15_000 });
        await expect(art).toHaveAttribute('src', /emptychart\.webp$/);
        expect(await art.evaluate((el) => el.complete && el.naturalWidth > 0),
            'the empty-state illustration did not load').toBe(true);
        expect(await art.getAttribute('alt'), 'decoration must stay out of the a11y tree').toBe('');
    });

    // ── Past closing time ───────────────────────────────────────────────
    //
    // A QR code on a table is readable at 23.00 by someone who walked past a
    // dark window. The page used to load a full menu and an ordering form.

    test('A CLOSED SHOP SAYS SO BEFORE IT ASKS FOR A NAME', async ({ page }) => {
        const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const tomorrow = DAYS[(new Date().getDay() + 1) % 7];
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...MENU,
                outlet_info: {
                    // Shut every day except tomorrow, so "now" is closed
                    // wherever in the week this test happens to run.
                    hours: DAYS.map((day) => (day === tomorrow
                        ? { day, closed: false, open: '09:00', close: '17:00' }
                        : { day, closed: true }))
                }
            })
        }));
        await goTo(page);

        const closed = page.locator('#sheet-closed');
        await expect(closed).toHaveClass(/is-open/, { timeout: 15_000 });

        // ⚠️ THE ORDER OF TWO FACTS. Asking for a name and number and only then
        // saying the kitchen is shut is the wrong way round; the gate waits.
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);

        await expect(closed).toContainText('tutup');
        // An apology, because this is the shop's inconvenience, not the diner's.
        await expect(closed).toContainText(/Mohon maaf|maaf/i);
        const art = page.locator('#closed-art');
        await expect(art).toHaveAttribute('src', /storeclose\.webp$/);
        expect(await art.evaluate((el) => el.complete && el.naturalWidth > 0),
            'the closed illustration did not load').toBe(true);

        // And WHEN to come back, which is the only useful thing left to say.
        await expect(page.locator('#closed-hours')).toBeVisible();
        await expect(page.locator('#closed-hours')).toContainText('09.00');

        // ⚠️ AND THERE IS NO WAY PAST IT. Jay's call, overriding the earlier
        // dismissible version: an outlet that is shut does not want an order,
        // and a menu you can still browse invites one. No button, and neither
        // of the two gestures that close every other sheet on this page does
        // anything here.
        await expect(page.locator('#closed-go')).toHaveCount(0);
        await expect(closed.locator('button')).toHaveCount(0);

        await page.locator('#scrim').click({ force: true });
        await expect(closed, 'the scrim dismissed a hard stop').toHaveClass(/is-open/);
        await page.keyboard.press('Escape');
        await expect(closed, 'Escape dismissed a hard stop').toHaveClass(/is-open/);

        // And the diner is never asked for a name they cannot use.
        await expect(page.locator('#sheet-welcome')).not.toHaveClass(/is-open/);
    });

    test('an open shop, and a shop that set no hours, are never interrupted', async ({ page }) => {
        const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const today = DAYS[new Date().getDay()];
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...MENU,
                outlet_info: { hours: [{ day: today, closed: false, open: '00:00', close: '23:59' }] }
            })
        }));
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });
        await expect(page.locator('#sheet-closed')).not.toHaveClass(/is-open/);
    });

    test('a shop with no hours set makes no claim about being shut', async ({ page }) => {
        // ⚠️ SILENCE IS NOT "CLOSED". Most outlets have never filled hours in,
        // and telling every one of their customers the kitchen is shut would be
        // the single most damaging thing this sheet could do.
        await stub(page);          // MENU carries no outlet_info at all
        await goTo(page);
        await expect(page.locator('#sheet-welcome')).toHaveClass(/is-open/, { timeout: 15_000 });
        await expect(page.locator('#sheet-closed')).not.toHaveClass(/is-open/);
    });

    test('THE WARM FIELD IS THE SAME ONE ON EVERY SHEET THAT OPENS ON A PICTURE',
        async ({ page }) => {
            // ⚠️ ONE CLASS, THREE SHEETS. Each of these used to put its
            // illustration on white, where artwork drawn on its own cream
            // ground reads as a pasted rectangle. They share `.art-field` so a
            // fourth sheet cannot arrive with its own idea of the treatment.
            const capture = {};
            await stub(page, { capture });
            await page.route('**/qr-order', (route) => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, order_id: 'ord_1',
                    order_number: '2026-09-07-007', total_amount: 22000, rejected_lines: 0 })
            }));
            await open(page);
            await addPlain(page, 'Americano');
            await page.locator('#cart-open').click();
            await page.locator('#cart-submit').click();
            await expect(page.locator('#sheet-done')).toHaveClass(/is-open/, { timeout: 15_000 });

            const field = page.locator('#sheet-done .art-field');
            await expect(field).toHaveCount(1);
            const warm = await field.evaluate((el) => {
                const bg = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number);
                return { r: bg[0], g: bg[1], b: bg[2] };
            });
            expect(warm.r, 'the confirmation art sits on a cool ground')
                .toBeGreaterThan(warm.b);
            expect(warm.r - warm.b, 'the tint is too faint to be the warm field')
                .toBeGreaterThan(8);

            // ⚠️ AND IT REACHES THE SHEET'S EDGES. The field is full-bleed via
            // negative margins that undo the body's inset; if those two numbers
            // drift, a white rim appears down each side and the block reads as
            // a card rather than as the top of the sheet.
            const [f, sheet] = await Promise.all([
                field.boundingBox(),
                page.locator('#sheet-done').boundingBox()
            ]);
            expect(Math.abs(f.x - sheet.x), 'a white rim on the left').toBeLessThan(1.5);
            expect(Math.abs((f.x + f.width) - (sheet.x + sheet.width)),
                'a white rim on the right').toBeLessThan(1.5);
        });

    test('the warm field does not touch the panel below it', async ({ page }) => {
        await stub(page);
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, order_id: 'o1', order_number: '2026-09-07-001',
                status: 'sent', stage: 2, stage_label: 'x',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                    gross_amount: 22000, note: null, modifiers: [] }],
                note: null, history: [], orders: [], subtotal: 22000, discount_total: 0,
                service_charge_amount: 0, tax_amount: 0, total_amount: 22000,
                paid_amount: 0, pricing: null, placed_at: Date.now() - 60_000
            })
        }));
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('.ostage')).toBeVisible({ timeout: 15_000 });

        // Two blocks that touch read as one, and the panel then looks like the
        // last row of the illustration area. 6px was the floor Jay asked for.
        //
        // ⚠️ ONE EVALUATE, NOT TWO BOUNDING BOXES. The sheet re-renders when a
        // status refresh lands, and two separate round trips can straddle that
        // — the numbers then come from different layouts and the gap they
        // describe never existed. It failed on WebKit only, which is just where
        // the timing happened to land.
        const gap = await page.evaluate(() => {
            const art = document.querySelector('.ostage').getBoundingClientRect();
            const panel = document.querySelector('#orders-body .opanel').getBoundingClientRect();
            return panel.top - art.bottom;
        });
        expect(gap, 'the warm field and the order panel are touching')
            .toBeGreaterThanOrEqual(6);
    });

    test('THE COMMIT BAR IS INK, WITH THE IDENTITY SEATED ABOVE IT', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();

        const btn = page.locator('#cart-submit');
        const who = page.locator('#cart-who');
        await expect(who).toContainText('Sinta');

        // ⚠️ INK, NOT ORANGE. It was orange for exactly one commit; every other
        // primary in the product is ink and one orange button on one screen
        // reads as a mistake rather than as emphasis.
        const fill = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
        const rgb = fill.match(/[\d.]+/g).map(Number);
        expect(rgb[0], 'the commit button went back to orange').toBeLessThan(60);

        // ⚠️ ABOVE THE WHITE CARD, seated on its top edge like a tab on a
        // folder. It used to sit inside the bar tucked under the button.
        const foot = page.locator('.page-foot');
        const [wb, fb] = await Promise.all([who.boundingBox(), foot.boundingBox()]);
        expect(wb.y + wb.height, 'the identity tab is not seated on the card')
            .toBeLessThanOrEqual(fb.y + 2);
        expect(wb.y + wb.height, 'the identity tab floats away from the card')
            .toBeGreaterThan(fb.y - 4);
        // ⚠️ EDGE TO EDGE. Inset by 16px it read as a floating chip that
        // happened to be near the button; full width it is the bar's own top
        // course, which is what makes the two a single block.
        expect(Math.round(wb.width), 'the identity strip is not full width')
            .toBe(Math.round(fb.width));
        expect(Math.round(wb.x)).toBe(Math.round(fb.x));

        // ⚠️ OPAQUE. At this position it floats over the MENU, not over the
        // bar's white — a translucent fill shows menu cards through the diner's
        // own name. The base layer under the wash is what guarantees that.
        const bg = await who.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { colour: cs.backgroundColor, image: cs.backgroundImage };
        });
        const tint = bg.colour.match(/[\d.]+/g).map(Number);
        expect(tint[3] === undefined || tint[3] === 1,
            'the identity strip is see-through').toBe(true);
        // A wash and a texture, which is what carries the warmth — never a
        // solid block of brand orange.
        expect(bg.image, 'the strip lost its wash').toContain('gradient');

        // Three parts, so "is this me" and "will they reach me" are two glances
        // rather than one grey string.
        await expect(who.locator('.who-badge')).toHaveCount(1);
        await expect(who.locator('.who-name')).toHaveText('Sinta');
        await expect(who.locator('.who-phone')).toContainText('0812');
        // The badge is decoration; the name beside it is the text that matters.
        await expect(who.locator('.who-badge')).toHaveAttribute('aria-hidden', 'true');

        // A long name must not push the number off the strip.
        const [nameBox, phoneBox] = await Promise.all([
            who.locator('.who-name').boundingBox(),
            who.locator('.who-phone').boundingBox()
        ]);
        expect(phoneBox.x + phoneBox.width,
            'the phone chip overflows the strip').toBeLessThanOrEqual(wb.x + wb.width + 1);
        expect(nameBox.x + nameBox.width,
            'the name runs under the phone chip').toBeLessThanOrEqual(phoneBox.x + 1);
    });

    test('THE TAB BAR GETS OUT OF THE WAY WHILE THE MENU MOVES', async ({ page }) => {
        // A floating bar over a two-column grid of photographs costs a row of
        // cards on a 390px screen — but only while someone is READING. The
        // moment they are scrolling, the labels are not being read.
        const LONG = {
            ...MENU,
            items: Array.from({ length: 24 }, (_, n) => ({
                id: `i_${n}`, name: `Dish ${n}`, category: 'Kopi',
                price: 20000 + n * 500, has_image: false, modifier_groups: []
            }))
        };
        await stub(page);
        await page.route('**/qr-menu?**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(LONG)
        }));
        await open(page);
        await expect(page.locator('.card').first()).toBeVisible();

        const bar = page.locator('.tabbar-inner');
        const tall = (await bar.boundingBox()).height;
        const reserved = () => page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--tabbar-space').trim());
        const spaceBefore = await reserved();

        // Keep it moving through its own transition — one wheel tick and an
        // immediate read lands mid-animation and measures nothing.
        for (let i = 0; i < 6; i += 1) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(60);
        }
        await page.waitForTimeout(120);
        const short = (await bar.boundingBox()).height;
        expect(short, 'the tab bar did not shrink while scrolling').toBeLessThan(tall - 10);

        // ⚠️ IT COMPACTS, IT NEVER LEAVES. This bar is how a diner reaches
        // their order; the hide-on-scroll-down pattern would take the way out
        // of a long menu away at the bottom of that menu, which is where they
        // are most likely to want it.
        await expect(page.locator('.tabbar')).toBeVisible();
        await expect(page.locator('.tab[data-tab="orders"]')).toBeVisible();

        // ⚠️ AND THE PAGE MUST NOT REFLOW. `--tabbar-space` is the bottom
        // spacer AND the cart bar's offset; re-measuring it against the shrunk
        // bar would move the whole page under the reader's thumb on every
        // scroll frame. It stays at the full height.
        expect(await reserved(), 'the reserved space moved with the bar')
            .toBe(spaceBefore);

        // It comes back when the page settles.
        await page.waitForTimeout(500);
        const again = (await bar.boundingBox()).height;
        expect(Math.abs(again - tall), 'the bar never came back').toBeLessThan(1.5);
    });

    test('A TABLE THAT ASKED FOR ITS BILL CANNOT BE ORDERED INTO', async ({ page }) => {
        // ⚠️ REPORTED FROM PRODUCTION with two `409 (Conflict)` in the console.
        // The Pesanan sheet already hid "add to order" once the bill was
        // called, but the order page went on offering a commit button that the
        // server could only refuse — and the failure handler re-enabled it, so
        // every tap bought another 409.
        let posts = 0;
        await stub(page);
        await page.route('**/qr-order', async (route) => {
            posts += 1;
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'bill_requested' })
            });
        });
        await page.route('**/qr-order-status**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                has_order: true, order_id: 'o1', order_number: '2026-09-08-001',
                status: 'awaiting_payment', stage: 5, stage_label: 'x',
                lines: [{ item_id: 'i_americano', item_name: 'Americano', quantity: 1,
                    gross_amount: 22000, note: null, modifiers: [] }],
                note: null, history: [], orders: [], subtotal: 22000, discount_total: 0,
                service_charge_amount: 0, tax_amount: 0, total_amount: 22000,
                paid_amount: 0, pricing: null, placed_at: Date.now() - 60_000
            })
        }));
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();

        // Said BEFORE the tap, and the commit is not offered at all.
        await expect(page.locator('#cart-notice')).toContainText('sudah diminta', { timeout: 15_000 });
        await expect(page.locator('#cart-submit')).toBeDisabled();
        expect(posts, 'the page sent an order it already knew would be refused').toBe(0);
    });

    test('a refusal does not re-arm the button for another one', async ({ page }) => {
        // The race the check above cannot cover: somebody else at the table
        // asks for the bill between this page painting and this diner tapping.
        // The FIRST 409 is unavoidable; a second one is a bug.
        let posts = 0;
        const capture = {};
        await stub(page, { capture });
        await page.route('**/qr-order', async (route) => {
            posts += 1;
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'bill_requested' })
            });
        });
        await open(page);                      // status says no live order yet
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();

        const btn = page.locator('#cart-submit');
        await expect(btn).toBeEnabled();
        await btn.click();
        await expect(page.locator('#cart-notice')).toContainText('sudah diminta');
        expect(posts).toBe(1);

        // ⚠️ AND IT STAYS DOWN. The server is ahead of our last poll; believing
        // it is what stops the diner collecting refusals.
        await expect(btn).toBeDisabled();
        await page.waitForTimeout(300);
        expect(posts, 'the button re-armed and sent a second doomed order').toBe(1);
    });

    test('a paid sitting is not shown to the next diner', async ({ page }) => {
        // The endpoint excludes paid orders, so a fresh scan sees the empty
        // state rather than the previous party's settled bill. Measured on the
        // live directory before the fix: 8 of 9 tables would have shown one,
        // up to Rp51.281.667 and 69 hours old.
        await stub(page, { capture: { status: { has_order: false, lines: [] } } });
        await open(page);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('#sheet-orders .orders-empty')).toBeVisible();
        // No bill button either: there is no sitting to end.
        await expect(page.locator('#orders-foot')).toBeHidden();
    });

    test('an empty table says so rather than showing a blank sheet', async ({ page }) => {
        await stub(page);
        await open(page);
        await expect(page.locator('#tab-orders-badge')).not.toHaveClass(/on/);
        await page.locator('.tab[data-tab="orders"]').click();
        await expect(page.locator('#sheet-orders .orders-empty')).toContainText('Belum ada pesanan');
    });

    test('THE CARD OWNS IDENTITY; THE IMAGE OWNS THE IMPRESSION', async ({ page }) => {
        await stub(page);
        await open(page);

        // Name and table live on the CARD now, not in a gradient band.
        const card = page.locator('.outlet-card');
        await expect(card.locator('h1')).toHaveText('Kopi Senja Kemang', { timeout: 15_000 });
        await expect(card.locator('#table-label')).toHaveText('Meja A04');

        // The monogram is gone WITH the band. It stood in for a picture the page
        // did not have; once the hero carries a photograph, two initials in a
        // rounded square are a placeholder competing with the real thing.
        await expect(page.locator('#outlet-mark')).toHaveCount(0);

        // Search moved OUT of the header and under the card. It is a filter on
        // the menu, and it now sits with the chips that do the same job.
        await expect(page.locator('.hero #search')).toHaveCount(0);
        const search = await page.locator('.menu-search').boundingBox();
        const cardBox = await card.boundingBox();
        const chips = await page.locator('#chips').boundingBox();
        expect(search.y).toBeGreaterThan(cardBox.y + cardBox.height - 1);
        expect(chips.y).toBeGreaterThan(search.y);

        // The eyebrow that once sat above the name said "Pesan dari meja Anda" —
        // exactly what the headline and the table line already say. A label
        // restating the headline is prohibited (CLAUDE.md).
        await expect(page.locator('.brandline')).toHaveCount(0);
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

    test('a photo FILLS the card, and the till still does not crop', async ({ page }) => {
        await stub(page);
        await open(page);

        const img = page.locator('.card', { hasText: 'Es Kopi Susu' }).locator('.card-media img');
        await expect(img).toBeVisible();
        // ⚠️ `cover` HERE, AND THIS REVERSES items.md §9 for the diner's menu —
        // Jay's call, 2026-09-05. §9 banned cropping because it loses what
        // identifies a dish; that held while the name sat in a body BELOW the
        // photo. In a full-image card the name is set across the picture, so
        // identification never depends on the crop, and the uncropped photo is
        // one tap away in the item sheet.
        await expect(img).toHaveCSS('object-fit', 'cover');

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

    test('EVERY item opens the sheet, even with nothing to choose', async ({ page }) => {
        await stub(page);
        await open(page);

        // Americano has no modifier groups. It used to add straight to the cart
        // — one tap faster, and it quietly removed the only place a diner can
        // say "no ice". A plain item is the one most likely to need a note
        // precisely because it has no options to express it.
        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        const sheet = page.locator('#sheet-item');
        await expect(sheet).toHaveClass(/is-open/);
        await expect(page.locator('#item-title')).toHaveText('Americano');

        // Nothing to choose, so the sheet is the note and says so.
        await expect(sheet.locator('.opt-hint')).toBeVisible();
        await expect(page.locator('#item-note')).toBeVisible();
        await expect(page.locator('#item-add')).toBeEnabled();

        // Nothing lands in the cart until the sheet is confirmed.
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);
        await page.locator('#item-note').fill('tanpa es');
        await page.locator('#item-add').click();
        await expect(page.locator('#cart-count')).toHaveText('1');
        await expect(page.locator('#cart-total')).toHaveText('Rp22.000');

        // The note rides on the line.
        await page.locator('#cart-open').click();
        await expect(page.locator('#view-cart')).toContainText('tanpa es');
    });

    test('the card has no stepper — quantity is edited in the cart', async ({ page }) => {
        await stub(page);
        await open(page);
        await page.locator('.card', { hasText: 'Americano' }).getByRole('button', { name: 'Tambah' }).click();
        await page.locator('#item-note').fill('tanpa es');
        await page.locator('#item-add').click();
        await expect(page.locator('#cart-count')).toHaveText('1');

        // A "+" on the card could only ever bump ONE of the ways this item can
        // now sit in the cart — the plain, note-less line — so tapping it on a
        // card reading "1" would silently create a SECOND line without the note.
        const card = page.locator('.card', { hasText: 'Americano' });
        await expect(card.locator('[data-inc]')).toHaveCount(0);
        await expect(card.locator('[data-dec]')).toHaveCount(0);
        // It shows the count on a BADGE and reopens the sheet instead. The count
        // moved off the button so the button's markup never changes with the
        // cart — which is what lets an add skip the grid rebuild that was
        // re-requesting every photo.
        await expect(card.locator('[data-qty]')).toHaveText('1');
        expect((await card.locator('.add-btn').innerText()).trim()).toBe('');

        // Quantity lives in the cart, where each line is visible.
        await page.locator('#cart-open').click();
        await page.locator('#cart-lines [data-cinc]').first().click();
        await expect(page.locator('#cart-count')).toHaveText('2');
        await expect(page.locator('#cart-lines .cartline')).toHaveCount(1);
    });

    test('LIHAT PESANAN OPENS A PAGE, NOT A BOTTOM SHEET', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await addPlain(page, 'Nasi Goreng');

        await page.locator('#cart-open').click();
        await expect(page.locator('#view-cart')).toBeVisible();
        // The sheet it replaced is gone from the document entirely.
        await expect(page.locator('#sheet-cart')).toHaveCount(0);
        // A real screen: the menu behind it is not showing through.
        await expect(page.locator('#view-menu')).toBeHidden();

        // Its own header, with a way back.
        await expect(page.locator('#cart-outlet')).toHaveText('Kopi Senja Kemang');
        await expect(page.locator('#cart-table')).toHaveText('Meja A04');

        // Floating chrome stands down: the CTA is already pinned to the bottom,
        // and a cart bar over it would be the same action twice.
        await expect(page.locator('.tabbar')).toBeHidden();
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);

        await expect(page.locator('#cart-lines .cartline')).toHaveCount(2);
        await expect(page.locator('#cart-totals .grand .num')).toHaveText('Rp67.000');
        await expect(page.locator('#cart-who')).toContainText('Sinta');

        // It has a history entry, so the phone's own back gesture returns to
        // the menu instead of leaving the restaurant's page altogether.
        expect(new URL(page.url()).hash).toBe('#pesanan');
        await page.goBack();
        await expect(page.locator('#view-menu')).toBeVisible();
        // …and the cart bar is still there, with the cart still in it. show()
        // strips it on any non-menu view and only paintCart() puts it back.
        await expect(page.locator('#cartbar')).toHaveClass(/is-open/);
        await expect(page.locator('#cart-count')).toHaveText('2');
    });

    test('THE ORDER BUTTON IS STICKY ON A LONG ORDER', async ({ page }) => {
        await stub(page);
        await open(page);
        // Enough lines to push the page well past one screen.
        for (const n of ['Es Kopi Susu', 'Americano', 'Nasi Goreng']) await addPlain(page, n);
        await page.locator('#cart-open').click();
        await expect(page.locator('#view-cart')).toBeVisible();

        const vh = page.viewportSize().height;
        const visible = async () => {
            const b = await page.locator('.page-foot').boundingBox();
            return b.y + b.height <= vh + 2 && b.y + b.height > 0;
        };
        // On arrival…
        expect(await visible(), 'the CTA is not on screen when the page opens').toBe(true);
        // …and after scrolling. It used to sit 566px below the fold: the view
        // was a `min-height: 100dvh` flex column, so it GREW instead of letting
        // its body scroll, and the whole document scrolled the footer away.
        await page.evaluate(() => window.scrollTo(0, 4000));
        await page.waitForTimeout(250);
        expect(await visible(), 'the CTA scrolled off the screen').toBe(true);
        // OUT OF FLOW, without naming which mechanism. This line read
        // `toHaveCSS('position', 'sticky')` and pinned the implementation
        // instead of the outcome — so when `sticky` turned out to be the wrong
        // tool (the bar is the last child of its section, so its sticky range is
        // zero) the assertion was the thing standing in the way of fixing it.
        expect(await page.locator('.page-foot')
            .evaluate((el) => getComputedStyle(el).position))
            .toMatch(/fixed|sticky/);
    });

    test('every order line shows what it is', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Es Kopi Susu');   // has_image: true in the fixture
        await addPlain(page, 'Americano');      // has_image: false
        await page.locator('#cart-open').click();

        const thumbs = page.locator('.cartline-thumb');
        await expect(thumbs).toHaveCount(2);
        // A photo where there is one, the placeholder where there is not —
        // every line gets a tile, so the column never goes ragged.
        await expect(thumbs.nth(0).locator('img')).toHaveCount(1);
        await expect(thumbs.nth(1).locator('img')).toHaveCount(0);
        await expect(thumbs.nth(1).locator('svg')).toBeVisible();

        // Small enough to stay a review screen rather than becoming a menu.
        const box = await thumbs.first().boundingBox();
        expect(box.width).toBeGreaterThan(40);
        expect(box.width).toBeLessThan(70);
    });

    test('QUANTITY IS SET IN THE SHEET, BEFORE ADDING', async ({ page }) => {
        await stub(page);
        await open(page);

        await page.locator('.card', { hasText: 'Es Kopi Susu' })
            .getByRole('button', { name: /Tambah|Add/ }).click();
        await page.locator('.opt', { hasText: 'Large' }).locator('input').check();

        // Starts at one, and cannot go below it.
        await expect(page.locator('#item-qty')).toHaveText('1');
        await expect(page.locator('#item-qty-dec')).toBeDisabled();
        await expect(page.locator('#item-add-total')).toHaveText('Rp34.000');

        await page.locator('#item-qty-inc').click();
        await expect(page.locator('#item-qty')).toHaveText('2');
        await expect(page.locator('#item-qty-dec')).toBeEnabled();
        // The button shows what will actually be added — unit price INCLUDING
        // the option, times the quantity — so no arithmetic is left to the diner.
        await expect(page.locator('#item-add-total')).toHaveText('Rp68.000');

        await page.locator('#item-add').click();
        // Two of the same thing is ONE line of two, not two lines.
        await expect(page.locator('#cart-count')).toHaveText('2');
        await page.locator('#cart-open').click();
        await expect(page.locator('#cart-lines .cartline')).toHaveCount(1);
        await expect(page.locator('#cart-totals .grand .num')).toHaveText('Rp68.000');
    });

    test('the order page carries the extras a review screen needs', async ({ page }) => {
        const capture = {};
        await stub(page, { capture });
        await open(page);
        await addPlain(page, 'Nasi Goreng');
        await page.locator('#cart-open').click();

        // "Lengkapi pesanan Anda" suggests from categories the cart does NOT
        // already contain — a drink to someone who ordered food, rather than a
        // fourth variation of what they just picked.
        const rail = page.locator('#cart-suggest .suggest');
        expect(await rail.count()).toBeGreaterThan(0);
        await expect(rail.first()).not.toContainText('Nasi Goreng');
        await rail.first().click();
        await expect(page.locator('#cart-lines .cartline')).toHaveCount(2);

        // The note is behind a toggle rather than occupying the panel with an
        // empty box most orders never use.
        await expect(page.locator('#cart-note')).toBeHidden();
        await page.locator('#cart-note-toggle').click();
        await expect(page.locator('#cart-note')).toBeVisible();
        await page.locator('#cart-note').fill('pedas sedang');

        // Cutlery is folded into the note on submit — pos_orders has no cutlery
        // field, and the note is the only thing the kitchen reads.
        await page.locator('#cart-cutlery').check();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);
        expect(capture.body.note).toBe('pedas sedang · Tanpa sendok garpu');
    });

    test('emptying the cart returns to the menu', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await expect(page.locator('#view-cart')).toBeVisible();
        await page.locator('#cart-lines [data-cdec]').first().click();
        // There is nothing left to review, so the page steps aside rather than
        // sitting there empty.
        await expect(page.locator('#view-menu')).toBeVisible();
        await expect(page.locator('#cartbar')).not.toHaveClass(/is-open/);
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

        await addPlain(page, 'Americano');
        await addPlain(page, 'Nasi Goreng');
        await page.locator('#cart-open').click();

        const cart = page.locator('#view-cart');
        await expect(cart).toBeVisible();
        await expect(cart.locator('#cart-lines .cartline')).toHaveCount(2);
        await expect(page.locator('#cart-totals .grand .num')).toHaveText('Rp67.000');

        await page.locator('#cart-lines [data-cinc]').first().click();
        await expect(page.locator('#cart-totals .grand .num')).toHaveText('Rp89.000');
        await page.locator('#cart-lines [data-cdec]').first().click();
        await page.locator('#cart-lines [data-cdec]').first().click();
        await expect(cart.locator('#cart-lines .cartline')).toHaveCount(1);
        await expect(page.locator('#cart-totals .grand .num')).toHaveText('Rp45.000');
    });

    test('THE BROWSER SENDS NO PRICES — only ids and quantities', async ({ page }) => {
        const capture = {};
        await stub(page, { capture });
        await open(page);

        // One plain item and one with two options, so the payload covers both.
        await addPlain(page, 'Americano');
        await page.locator('.card', { hasText: 'Es Kopi Susu' })
            .getByRole('button', { name: /Tambah|Add/ }).click();
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
        await expect(page.locator('#view-cart')).toContainText('Sinta');
        // TYPED AND SUBMITTED WITH NOTHING IN BETWEEN. The note used to be read
        // only when paintCart() re-ran, so a note written just before tapping
        // was dropped and the order posted without it — no error, the kitchen
        // simply never saw the request.
        await page.locator('#cart-note-toggle').click();
        await page.locator('#cart-note').fill('sendok garpu 2');
        await expect(page.locator('#cart-submit')).toContainText('Order Sekarang');
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);

        const body = capture.body;
        expect(body.token).toBe(TOKEN);
        expect(body.customer_name).toBe('Sinta');
        expect(body.note, 'the order note never reached the request').toBe('sendok garpu 2');
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

    test('the confirmation is a SHEET over the menu, with confetti', async ({ page }) => {
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();

        const done = page.locator('#sheet-done');
        await expect(done).toHaveClass(/is-open/);
        // A sheet, not a takeover: the menu is what the diner wants to be
        // looking at, and the order is confirmed rather than concluded.
        await expect(page.locator('#view-menu')).toBeVisible();
        await expect(page.locator('#view-cart')).toBeHidden();

        // Hierarchy: mark, then what happened, then the number staff call out.
        await expect(done.locator('.done-art')).toBeVisible();
        await expect(done.locator('.done-title')).toHaveText('Pesanan terkirim');
        await expect(done.locator('#done-number')).toHaveText('2026-09-03-007');

        // Confetti runs and then cleans up after itself — nothing left
        // animating behind the sheet.
        await expect(page.locator('#confetti')).toHaveClass(/is-on/);
        expect(await page.locator('#confetti i').count()).toBeGreaterThan(20);
        // …and it can never intercept a tap.
        await expect(page.locator('#confetti')).toHaveCSS('pointer-events', 'none');
        await expect(page.locator('#confetti')).not.toHaveClass(/is-on/, { timeout: 8_000 });
        expect(await page.locator('#confetti i').count()).toBe(0);
    });

    test('the confirmation sheet can be dismissed', async ({ page }) => {
        // It could not: `closeSheets` never knew about it, so the CTA removed
        // the scrim and left the sheet on screen with nothing behind it.
        await stub(page);
        await open(page);
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();
        await page.locator('#cart-submit').click();
        const done = page.locator('#sheet-done');
        await expect(done).toHaveClass(/is-open/);
        // The overlay is there while it is up.
        await expect(page.locator('#scrim')).toHaveClass(/is-open/);

        await page.locator('#done-more').click();
        await expect(done).not.toHaveClass(/is-open/);
        await expect(page.locator('#scrim')).not.toHaveClass(/is-open/);
        await expect(page.locator('#view-menu')).toBeVisible();
    });

    test('no stray markup renders below the page', async ({ page }) => {
        // Removing a two-line HTML comment left its second line orphaned, so
        // `answer the two questions … -->` rendered as visible page text under
        // everything else.
        await stub(page);
        await open(page);
        const stray = await page.evaluate(() => {
            const junk = [];
            document.body.childNodes.forEach((n) => {
                if (n.nodeType === 3 && n.textContent.trim()) junk.push(n.textContent.trim().slice(0, 60));
            });
            return junk;
        });
        expect(stray, 'loose text nodes directly in <body>').toEqual([]);
        expect(await page.locator('body').innerText()).not.toContain('seated diner');
    });

    test('the confirmation shows the order number and clears the cart', async ({ page }) => {
        await stub(page);
        await open(page);

        await addPlain(page, 'Americano');
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
        // ⚠️ IN ENGLISH, because nothing pinned a language here — which makes
        // this the assertion that the DEFAULT is English. Every other test in
        // the file goes through `goTo`, which pins Indonesian.
        await expect(page.locator('#error-title')).toHaveText('Table code not found');
    });

    // ── Language ────────────────────────────────────────────────────────
    //
    // The page shipped Indonesian-only. It is read by a stranger on their own
    // phone in a restaurant, which makes the diner who cannot read the outlet's
    // language the one user in the product who cannot ask anyone for help.

    test('ENGLISH IS THE DEFAULT, AND THE WHOLE PAGE IS IN IT', async ({ page }) => {
        await stub(page);
        // No pin — the real first visit.
        await page.goto(`/t/${TOKEN}`);

        const gate = page.locator('#sheet-welcome');
        await expect(gate).toHaveClass(/is-open/, { timeout: 15_000 });
        // The gate is the FIRST thing a diner meets, so it is the first thing
        // that has to be readable.
        await expect(page.locator('#welcome-go')).toHaveText('Start ordering');
        await expect(page.locator('label[for="welcome-name"]')).toHaveText('Name');
        await expect(page.locator('#welcome-name')).toHaveAttribute('placeholder', 'Your name');

        await page.locator('#welcome-name').fill('Sinta');
        await page.locator('#welcome-phone').fill('0812 3456 7890');
        await page.locator('#welcome-go').click();
        await expect(gate).not.toHaveClass(/is-open/);

        // ⚠️ AND THE PARTS NO STATIC PASS REACHES. Almost everything a diner
        // reads on this page is built into `innerHTML` by a render function and
        // carries no `data-i18n` — a switcher that walked only the markup would
        // translate the tab bar and leave the menu behind it in Indonesian.
        await expect(page.locator('#chips .chip').first()).toContainText('All');
        await expect(page.locator('#search')).toHaveAttribute('placeholder', 'Search the menu…');
        await expect(page.locator('.tab[data-tab="orders"]')).toContainText('Orders');
        await expect(page.locator('#table-label')).toHaveText('Table A04');
        expect(await page.getAttribute('html', 'lang')).toBe('en');
    });

    test('THE SWITCHER IS A BOTTOM SHEET, AND IT REPAINTS WHAT IS ALREADY DRAWN', async ({ page }) => {
        await stub(page);
        await open(page, 'en');

        // Top-right of the hero, over the scrim rather than under it.
        const btn = page.locator('#lang-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText(/EN/);
        const hero = await page.locator('#hero').boundingBox();
        const box = await btn.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(hero.x + hero.width);
        expect(box.x, 'the switcher is not in the right half').toBeGreaterThan(hero.x + hero.width / 2);
        expect(box.y).toBeLessThan(hero.y + hero.height / 2);

        // A SHEET, like every other choice on this page.
        await btn.click();
        const sheet = page.locator('#sheet-lang');
        await expect(sheet).toHaveClass(/is-open/);
        await expect(page.locator('#scrim')).toHaveClass(/is-open/);
        // Each language named in ITSELF, so someone who cannot read the current
        // one can still find theirs.
        await expect(sheet.locator('.lang-opt')).toHaveCount(2);
        await expect(sheet.locator('.lang-opt[data-lang="en"]')).toContainText('English');
        await expect(sheet.locator('.lang-opt[data-lang="id"]')).toContainText('Bahasa Indonesia');
        await expect(sheet.locator('.lang-opt[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');

        await sheet.locator('.lang-opt[data-lang="id"]').click();
        await expect(sheet).not.toHaveClass(/is-open/);

        // ⚠️ THE MENU BEHIND IT, NOT JUST THE CHROME. This is the assertion the
        // whole feature rests on: `paintMenu` skips a repaint when the visible
        // item ids have not changed — and they have not — so a switcher that
        // trusted it would leave every rendered surface in the old language.
        await expect(btn).toHaveText(/ID/);
        await expect(page.locator('#chips .chip').first()).toContainText('Semua');
        await expect(page.locator('#search')).toHaveAttribute('placeholder', 'Cari menu…');
        await expect(page.locator('.tab[data-tab="orders"]')).toContainText('Pesanan');
        await expect(page.locator('#table-label')).toHaveText('Meja A04');
        expect(await page.getAttribute('html', 'lang')).toBe('id');
    });

    test('the chosen language survives a reload', async ({ page }) => {
        await stub(page);
        await open(page, null);          // the default, unpinned — see goTo
        await page.locator('#lang-btn').click();
        await page.locator('.lang-opt[data-lang="id"]').click();

        await page.reload();
        // ⚠️ NOT BACK TO THE DEFAULT. A diner who switched once should not have
        // to do it again because the kitchen took a while and the tab reloaded.
        await expect(page.locator('#welcome-go')).toHaveText('Mulai pesan', { timeout: 15_000 });
        await expect(page.locator('#lang-btn')).toHaveText(/ID/);
    });

    test('THE KITCHEN NOTE DOES NOT FOLLOW THE DINER INTO ENGLISH', async ({ page }) => {
        const capture = {};
        await stub(page, { capture });
        await open(page, 'en');
        await addPlain(page, 'Americano');
        await page.locator('#cart-open').click();

        await page.locator('#cart-cutlery').check();
        await page.locator('#cart-submit').click();
        await expect(page.locator('#sheet-done')).toHaveClass(/is-open/);

        // ⚠️ TWO AUDIENCES, ONE PAGE. This string is composed into the note that
        // PRINTS IN THE KITCHEN, and the cook reading it did not change the
        // language — the diner did. Translating it would put English on an
        // Indonesian kitchen ticket, which is the opposite of helping.
        expect(capture.body.note).toContain('Tanpa sendok garpu');
        // The diner's own screen, meanwhile, is in the language they chose.
        await expect(page.locator('#done-title')).toHaveText('Order sent');
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
