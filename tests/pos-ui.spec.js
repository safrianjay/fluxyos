const { test, expect } = require('@playwright/test');
const { startTakeawayOrder } = require('./helpers/pos-order');
const { auditSpacing, MIN_GAP } = require('./helpers/spacing-audit');

// Browser coverage for the till.
//
// The order LIFECYCLE (open → send → serve → bill → pay → post) is covered by
// tests/pos-posting.spec.js at the engine level and tests/pos-rules-emulator-test.mjs
// at the rules level. What can only be checked here is the page itself: that it
// boots clean, that the shared components are actually wired, and that the two
// honesty signals the design depends on are present rather than merely intended.
//
// Most of this file deliberately does NOT create orders against production
// Firestore. The QA workspace is shared, orders are effectively immutable once
// paid, and a spec that leaves paid orders behind would pollute a real ledger
// permanently — the same reason seed-fnb-demo.js refuses a workspace that
// already holds items.
//
// ONE spec is exempt, by decision on 2026-08-31: the paid-order spec rings up a
// real sale and refunds it again. The alternative was worse. It depended on the
// workspace happening to contain a paid order, which it usually does not, so it
// skipped — and a spec that is green because it never ran is indistinguishable
// from one that passed. Refund is also the single most dangerous button on the
// till and the one nobody exercises by hand.
//
// It leaves nothing behind: the sale is refunded in the same spec, and the
// refund IS the last assertion rather than a courtesy. What it does leave is
// ledger MOVEMENT — a sale and its reversal, netting zero — which is the price
// of covering this path at all.

test.describe('Point of Sale', () => {
    test('boots clean, with the shared components actually wired', async ({ page }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));

        await page.goto('/pos');
        // The till has its OWN topbar now — the dashboard's title/subtitle pair is
        // deliberately gone, because the POS is a different experience from the
        // finance app rather than a page inside it.
        await expect(page.locator('#pos-view-title')).toHaveText(/Point of Sale/);
        await page.waitForSelector('#pos-metrics .pos-metric', { timeout: 15000 });

        // The marketing footer must never load on an app page. It auto-runs on
        // include and paints over the entire content area — which is exactly
        // what it did on the first cut of this page.
        expect(await page.locator('footer').count(), 'no marketing footer on an app page').toBe(0);

        // fluxy-select.js must have enhanced the outlet picker. DESIGN_SYSTEM §6
        // bans the native control, and hand-applying `.fluxy-select-native`
        // without the enhancer loaded hides the picker entirely.
        const outlet = page.locator('#pos-outlet');
        await expect(outlet).toHaveAttribute('data-fluxy-enhanced', /.*/);
        // The outlet picker moved into the SIDEBAR, into the slot the workspace
        // switcher used to hold: a cashier belongs to one workspace and never
        // switches it, but switches outlet constantly.
        await expect(page.locator('#entity-switcher-wrap .fluxy-select--enhanced')).toBeVisible();

        // The enhanced wrapper must stay pinned. Left unconstrained it stretched
        // to the full page width for a two-word value.
        const w = await page.locator('#entity-switcher-wrap .fluxy-select').evaluate((el) => el.getBoundingClientRect().width);
        expect(w, 'the outlet picker must not eat the whole row').toBeLessThan(400);

        // Every collapsed icon button keeps a name for assistive tech — below
        // 640px the Takeaway label is hidden and only the glyph remains.
        await expect(page.locator('#pos-new-order')).toHaveAttribute('aria-label', /create an order/i);

        // Strict. `pos_orders` is in the DEPLOYED rules (stamped 2026-08-21), so
        // the live-order listener must connect — and if it stops, this is the
        // only place that would notice. A "live orders unavailable" error here
        // means the rules were rolled back or never redeployed, which makes the
        // till blind to QR orders and to a second device on the floor.
        const real = errors.filter((e) => !/tailwindcss\.com|favicon|net::ERR_/i.test(e));
        expect(real, `console errors: ${real.join(' | ')}`).toEqual([]);
    });

    test('the till reuses the SHARED sidebar with its own menu', async ({ page }) => {
        // The POS is a different EXPERIENCE from the finance app, not a page
        // inside it: a cashier's destinations are the till, the floor, the
        // orders, the book and the drawer — not nineteen links to collections
        // their role is denied. Without this, the shared sidebar creeping back
        // would look like a styling regression rather than the wrong product.
        await page.goto('/pos');
        await page.waitForSelector('#pos-menu .pos-card, #pos-menu-empty', { timeout: 25000 });

        // It is the SAME sidebar component the dashboard uses — same logo, entity
        // switcher, Lucide icons, light theme and profile block — carrying a
        // different MENU. A parallel sidebar would duplicate all of that and
        // drift the first time either side is restyled.
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('#sidebar')).toHaveClass(/app-sidebar-light/);
        await expect(page.locator('#sidebar #logo-container')).toBeVisible();
        await expect(page.locator('#sidebar #profile-area')).toBeVisible();

        const navs = await page.locator('#nav-container [data-view] .sidebar-text').allInnerTexts();
        // Reservations joined the menu on 2026-09-01: a booking holds a table,
        // so the book belongs beside the floor rather than in a calendar
        // elsewhere. Order matters — it sits between the orders and the drawer,
        // which is the order of a service.
        const TILL_NAV = ['Point of Sale', 'Tables', 'Orders', 'Reservations', 'Shift'];
        expect(navs.map((t) => t.trim())).toEqual(TILL_NAV);

        // Icons come from the shared Lucide set, not a second family drawn here.
        expect(await page.locator('#nav-container [data-view] .sidebar-icon').count()).toBe(TILL_NAV.length);

        // No finance destination survives the swap — those are pages this role
        // is denied, and a nav full of permission errors is the bug this fixes.
        for (const gone of ['nav-bills', 'nav-invoices', 'nav-tax-center', 'nav-budgets']) {
            expect(await page.locator(`#nav-container #${gone}`).count(), `${gone} must not be in the till nav`).toBe(0);
        }

        // Every view switches in place. New ROUTES were explicitly out of scope.
        const before = page.url();
        for (const v of ['tables', 'orders', 'shift', 'till']) {
            await page.click(`#nav-container [data-view="${v}"]`);
            await expect(page.locator(`.pos-view[data-view="${v}"]`)).toBeVisible();
            expect(page.url(), 'views must not add routes').toBe(before);
        }

        // Exactly one view at a time, or two order panels fight over the same ids.
        expect(await page.locator('.pos-view:not(.hidden)').count()).toBe(1);
    });

    test('the till figure is labelled operational and points at the accounting one', async ({ page }) => {
        // PRODUCT_STRATEGY §6 forbids a second source of truth. The POS sums
        // pos_orders; the dashboard sums the ledger; they differ until posting
        // runs. The resolution is labelling, and if that label is ever dropped
        // the product quietly grows two revenue numbers.
        await page.goto('/pos');
        await page.waitForSelector('#pos-metrics .pos-metric', { timeout: 15000 });

        const labels = await page.locator('.pos-metric-label').allTextContents();
        const till = labels.find((l) => /at the till|di kasir/i.test(l));
        expect(till, `a money metric must say it is the till's figure — got ${labels.join(' | ')}`).toBeTruthy();
    });

    test('hierarchy holds at 375px', async ({ page }) => {
        // The one page in this app designed mobile-first: it is used standing
        // up, one-handed, during service.
        await page.setViewportSize({ width: 375, height: 750 });
        await page.goto('/pos');
        await page.waitForSelector('#pos-metrics .pos-metric', { timeout: 15000 });

        // Nothing may scroll the body sideways.
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal scroll at 375px').toBeLessThanOrEqual(1);

        // Every tap target on the primary path is reachable with a thumb.
        const small = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('.pos-primary, .pos-method, .pos-table, #pos-new-order').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.height > 0 && r.height < 40) out.push(`${el.id || el.className}:${Math.round(r.height)}px`);
            });
            return out;
        });
        expect(small, `tap targets under 40px: ${small.join(', ')}`).toEqual([]);

        // The page title must still be the first thing read, not displaced.
        await expect(page.locator('#pos-view-title')).toBeVisible();
    });

    test('type stays on the dashboard scale and no background is orange', async ({ page }) => {
        await page.goto('/pos');
        await page.waitForSelector('#pos-metrics .pos-metric', { timeout: 15000 });

        // DESIGN_SYSTEM: 6 steps only (10/12/14/16/20/24). The off-scale sizes
        // this catches are the ones that creep in from copy-pasted markup.
        const offScale = await page.evaluate(() => {
            const allowed = new Set(['10px', '12px', '13px', '14px', '15px', '16px', '20px', '24px']);
            const bad = [];
            document.querySelectorAll('main *').forEach((el) => {
                if (!el.textContent || !el.textContent.trim()) return;
                // The shared topbar title is 18px on EVERY app page
                // (accounting.css:16, dashboard.css:698). Off-scale, but
                // app-wide and pre-existing — a POS spec is the wrong place to
                // fail on it, and fixing it here would only diverge this page
                // from the other forty.
                if (el.closest('.dashboard-main-topbar')) return;
                const fs = getComputedStyle(el).fontSize;
                if (!allowed.has(fs)) bad.push(`${el.tagName}.${el.className}:${fs}`);
            });
            return [...new Set(bad)].slice(0, 10);
        });
        expect(offScale, `off-scale font sizes: ${offScale.join(', ')}`).toEqual([]);

        // Orange backgrounds are banned project-wide — orange is an accent only.
        const orange = await page.evaluate(() => {
            const bad = [];
            document.querySelectorAll('main *').forEach((el) => {
                // `renderEmptyState`'s CTA is `bg-[#EA580C]` — a real violation
                // of the project-wide orange-background ban
                // (shared-dashboard.js:3741), but it is the SHARED component on
                // 14 pages. Changing it belongs in its own change, not smuggled
                // into a POS commit; excluded here so this spec fails only on
                // orange THIS page introduced.
                if (el.id === 'empty-state-action') return;
                const bg = getComputedStyle(el).backgroundColor;
                const m = bg.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (!m) return;
                const [r, g, b] = [+m[1], +m[2], +m[3]];
                // Saturated orange: strong red, mid green, low blue. The tinted
                // #FFF7ED warning surface is deliberately excluded — it is a
                // near-white wash, not an orange fill.
                if (r > 200 && g > 60 && g < 150 && b < 60) bad.push(`${el.tagName}.${el.className}:${bg}`);
            });
            return [...new Set(bad)];
        });
        expect(orange, `orange backgrounds are prohibited: ${orange.join(', ')}`).toEqual([]);
    });

    test('SAVED DISCOUNTS ARE OFFERED AT THE TILL, AND FILL THE REASON TOO', async ({ page }) => {
        // The point of a preset is not the arithmetic — a cashier can already
        // type 20%. It is the REASON. A discount's reason is the only record of
        // why money was given away, and composing one with a customer waiting is
        // how "promo" ends up on a third of them. So the assertion that matters
        // most here is that tapping a preset fills the reason field.
        //
        // ⚠️ IT BUILDS ITS OWN FIXTURE AND TAKES IT BACK DOWN. A version that
        // skipped when the workspace happened to have no preset would be green
        // for the wrong reason, which is the failure two specs in this file
        // already shipped once.
        const name = `QA till preset ${Date.now()}`;
        await page.goto('/settings-pos');
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 25000 });
        await page.locator('#pos-preset-add').click();
        await page.locator('#pos-preset-name').fill(name);
        await page.locator('#pos-preset-kind').selectOption('percent');
        await page.locator('#pos-preset-value').fill('20');
        await page.locator('#pos-preset-reason').fill('Staff meal');
        await page.locator('#pos-preset-scope').selectOption('order');
        await page.locator('#pos-preset-form button[type="submit"]').click();
        await expect(page.locator('.pos-preset-row', { hasText: name })).toBeVisible({ timeout: 20000 });

        try {
            await page.goto('/pos');
            await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
            await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
            await startTakeawayOrder(page);
            await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
            await page.locator('.pos-card:not([disabled])').first().click();
            await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 20000 });

            await page.locator('#pos-discount-btn').click();
            const preset = page.locator('#pos-disc-presets [data-preset]', { hasText: name });
            await expect(preset, 'the saved discount was not offered at the till')
                .toBeVisible({ timeout: 15000 });

            await preset.click();
            // It FILLS the form rather than submitting it. This dialog has an
            // Apply button, and a preset that skipped it would make that button a
            // lie and turn a mis-tap at a counter into money out of the door.
            await expect(page.locator('#pos-disc-why')).toHaveValue('Staff meal');
            const amount = await page.locator('#pos-disc-amt').inputValue();
            expect(amount.replace(/\D/g, ''), 'the preset did not resolve to an amount').not.toBe('');
            expect(Number(amount.replace(/\D/g, '')), 'a 20% preset resolved to nothing').toBeGreaterThan(0);
            // Nothing is applied until Apply is pressed.
            await expect(page.locator('.pos-total-row.is-discount')).toHaveCount(0);
        } finally {
            // Archived whatever happened above, so a failing run does not leave a
            // preset behind for every later run to trip over.
            await page.goto('/settings-pos');
            await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 25000 });
            const row = page.locator('.pos-preset-row', { hasText: name });
            if (await row.count()) {
                page.once('dialog', (d) => d.accept());
                await row.getByRole('button', { name: 'Archive' }).click();
                const confirm = page.locator('button', { hasText: /^Archive$/ }).last();
                if (await confirm.isVisible().catch(() => false)) await confirm.click();
            }
        }
    });

    test('a paid order stays reachable, so refund and reprint are not dead ends', async ({ page }) => {
        // The gap this closes: Refund lives on the order panel, but a paid order
        // leaves the table grid AND used to clear the panel the instant it was
        // paid. The button existed and could never be pressed. A cashier who
        // rings up the wrong dish and takes payment had no exit — void refuses
        // (correctly, the revenue posted), so the order was simply stuck.
        //
        // The surface moved on 2026-08-31: the standalone "paid today" card is
        // gone and paid orders now live behind the Orders board's Completed tab.
        // The old selectors (#pos-paid-card, [data-paid]) still MATCHED NOTHING
        // rather than failing, so this spec skipped itself and the whole refund
        // path silently left coverage.
        //
        // It then skipped for a second reason: the QA workspace simply has no
        // paid order most days. A spec that is green because it did not run is
        // the same failure wearing a different hat, so it now RINGS UP ITS OWN
        // ORDER and refunds it again at the end. See the file header for why
        // that is allowed here and nowhere else in this file.
        await page.goto('/pos');
        await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });

        // ── Ring up a real takeaway sale ────────────────────────────────────
        await expect(page.locator('#pos-new-order'), 'the till never enabled Create Order — no outlet resolved?')
            .toBeEnabled({ timeout: 25000 });
        await startTakeawayOrder(page);

        await page.waitForSelector('.pos-card:not([disabled])', { timeout: 20000 });
        await page.locator('.pos-card:not([disabled])').first().click();
        await expect(page.locator('.pos-line')).toHaveCount(1, { timeout: 20000 });

        // open → sent → served → awaiting_payment.
        //
        // The press has to be RETRIED, not just awaited. `once()` in pos.js
        // returns immediately when `state.busy` is set and leaves no trace in
        // the DOM, so a press that lands during the previous write is swallowed
        // in silence — this loop hung on "Mark served" for twenty seconds
        // because of exactly that. (Worth noting the cashier gets the same
        // silence at a counter; that is a product gap, not a test one.)
        const primary = page.locator('#pos-primary');
        const advance = async () => {
            const before = (await primary.textContent() || '').trim();
            for (let attempt = 0; attempt < 6; attempt += 1) {
                await primary.click();
                try {
                    await expect(primary).not.toHaveText(before, { timeout: 3000 });
                    return;
                } catch { /* press swallowed while busy — press again */ }
            }
            throw new Error(`the till never advanced past "${before}"`);
        };
        // open → sent → served → awaiting_payment is three presses; the extra
        // headroom is for the states a QR order can start in, not for retries —
        // `advance` already handles a swallowed press itself.
        let label = '';
        for (let i = 0; i < 6; i += 1) {
            label = (await primary.textContent() || '').trim();
            if (/pay bill|bayar tagihan/i.test(label)) break;
            await advance();
        }
        await expect(primary, `the order never reached awaiting_payment (stopped at "${label}")`)
            .toHaveText(/pay bill|bayar tagihan/i);

        // The receipt opens in a popup that prints itself. Caught and closed, or
        // it outlives the test and the run hangs on an extra page.
        const receipt = page.waitForEvent('popup', { timeout: 30000 })
            .then((p) => p.close())
            .catch(() => {});


        // Retried for the same reason as the transitions above: this press also
        // goes through `once()`, and the first attempt was swallowed by the
        // refresh that the previous transition had just started.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            // The drawer check comes FIRST. Without it a slow open meant the
            // loop pressed again through the drawer's own overlay, and the retry
            // failed on the thing it had already succeeded at.
            if (await page.locator('#pos-pay-modal').count()) break;
            await primary.click();                   // opens the payment modal
            try {
                await page.locator('#pos-pay-amount').waitFor({ state: 'visible', timeout: 4000 });
                break;
            } catch { /* press swallowed while busy — press again */ }
        }
        await expect(page.locator('#pos-pay-amount'),
            'the payment modal never opened').toBeVisible({ timeout: 15000 });
        // Cash, deliberately OVER-TENDERED, because the difference between what
        // was handed over and what is applied to the bill is where the money bug
        // lived: the till used to send the whole tender as `amount`, so
        // `paid_amount` carried the change too and the shift tally expected the
        // drawer to hold cash that had already been given back. Every
        // over-tender made the close read short by the change.
        await page.locator('#pos-method-row [data-method="cash"]').click();
        const due = await page.evaluate(() => {
            const v = document.getElementById('pos-pay-due').textContent.replace(/\D/g, '');
            return Number(v);
        });
        const tendered = due + 5000;
        await page.fill('#pos-pay-amount', '');
        await page.locator('#pos-pay-amount').type(String(tendered));
        await expect(page.locator('#pos-change-value')).toHaveText(/5\.000/);
        await page.locator('#pos-pay-submit').click();

        // ── What was actually RECORDED ──────────────────────────────────────
        // The bug, in one assertion: `amount` is what the bill absorbed, not
        // what the customer handed over. When the two were the same field, an
        // over-tender inflated `paid_amount` — and `getPosShiftTally` sums
        // exactly that, so the close expected the drawer to still hold the
        // change. Every over-tender read as a short till, silently, and the
        // variance posted to 6700 Cash Over & Short as a loss.
        await expect.poll(async () => (await page.evaluate(() => window.__posOrder()))?.status,
            { timeout: 30000 }).toBe('paid');
        const rec = await page.evaluate(() => window.__posOrder());
        const cash = rec.payments[rec.payments.length - 1];
        expect(cash.method).toBe('cash');
        expect(cash.tender, 'cash is the only tender that puts notes in the drawer').toBe('cash');
        expect(cash.amount_received, 'what the customer handed over').toBe(tendered);
        expect(cash.change_given, 'what went back across the counter').toBe(5000);
        expect(cash.amount, 'only the bill is applied — the change is not revenue').toBe(due);
        expect(rec.paid_amount, 'paid_amount must be the bill, never the tender').toBe(rec.total_amount);

        await expect(page.locator('#pos-order-status')).toHaveText(/paid|lunas/i, { timeout: 30000 });
        await receipt;

        // ── The assertions this spec exists for ─────────────────────────────
        // A paid order opens read-only: no void (the revenue is posted), but a
        // refund and a reprint, which are the only two things left to do to it.
        await expect(page.locator('#pos-void-btn')).toBeHidden();
        await expect(page.locator('#pos-reprint-btn')).toBeVisible();
        await expect(page.locator('#pos-primary')).toHaveText(/close|tutup/i);
        // Refund is finance+ only. The QA account is the owner, so it shows.
        await expect(page.locator('#pos-refund-btn')).toBeVisible();

        // And it is REACHABLE — the whole point of the move to the board. A
        // paid order leaves the table grid, so if the Completed tab does not
        // list it there is no route back to the refund button at all.
        await page.click('#nav-container [data-view="orders"]');
        await page.waitForSelector('#pos-orders-grid .pos-ocard, #pos-orders-empty:not(.hidden)', { timeout: 20000 });
        const done = page.locator('.pos-tab[data-otab="done"]');
        await expect(done, 'the Completed tab is where paid orders live now').toBeVisible();
        await done.click();
        await expect(done).toHaveAttribute('aria-selected', 'true');
        // Matched on the status the card carries, not on position in the grid —
        // a filter that silently failed to apply can no longer feed this spec a
        // non-paid order.
        const paidCards = page.locator('#pos-orders-grid .pos-ocard[data-status="paid"]');
        await expect(paidCards.first(), 'the sale just rung up is not on the Completed tab')
            .toBeVisible({ timeout: 20000 });
        await paidCards.first().click();
        await expect(page.locator('#pos-refund-btn'),
            'reopened from the board, the refund button must still be there').toBeVisible();

        // ── Put the money back ──────────────────────────────────────────────
        // Not politeness: this workspace is a real ledger and the spec runs on
        // every QA pass. The refund is also the last assertion — proving the
        // button works, not merely that it renders.
        await page.click('#pos-refund-btn');
        await page.fill('#pos-refund-why', 'Spec cleanup — automated QA sale');
        await page.locator('button[type="submit"][form="pos-drawer-form"]').click();
        await expect(page.locator('#pos-order-title'))
            .toHaveText(/no order open|belum ada pesanan/i, { timeout: 30000 });
    });

    test('a discount can be entered as a percent, and resolves to Rupiah', async ({ page }) => {
        // Percent is a data-entry convenience only. The ledger holds Rupiah, and
        // a stored percentage would have to be re-applied against a base that
        // can still move — so it is resolved before it is ever saved.
        await page.goto('/pos');
        await page.waitForSelector('#pos-metrics .pos-metric', { timeout: 20000 });

        // The floor plan moved behind the header's "Table Order" button when the
        // catalogue became the primary surface (2026-08-31).
        //
        // This USED to skip when no table was free, which meant one stale open
        // order left on the QA workspace's only table dropped the entire
        // discount flow from coverage indefinitely — and quietly. A discount
        // does not need a table, so the spec now falls back to takeaway instead
        // of skipping. There is no configuration of the workspace in which it
        // does not run.
        await page.click('#pos-tables-btn');
        await page.waitForSelector('.pos-view[data-view="tables"] .pos-table', { timeout: 15000 });
        const free = page.locator('.pos-view[data-view="tables"] .pos-table.is-free');

        if (await free.count() > 0) {
            // Tapping a free table opens the Create Order dialog with the table
            // already answered — it no longer creates on the spot, because the
            // customer details can only be taken at creation.
            await free.first().click();
            await page.locator('#pos-create-modal .pos-modal').waitFor({ state: 'visible', timeout: 10000 });
            // The name is required for both order types — a table nobody can be
            // addressed at is the thing this dialog exists to prevent.
            await page.fill('#pos-create-name', 'QA Dine In');
            await page.click('#pos-create-submit');
            await page.locator('#pos-create-modal').waitFor({ state: 'detached', timeout: 20000 });
        } else {
            // Back to the till, then open a takeaway order.
            await page.click('#nav-container [data-view="till"]');
            await startTakeawayOrder(page);
        }
        // Selecting a table returns to the till — the catalogue is where the
        // next action is, and leaving the cashier on the floor plan after they
        // have chosen a table is a step they would have to undo every time.
        await page.waitForSelector('.pos-view[data-view="till"]:not(.hidden)', { timeout: 10000 });
        await page.waitForSelector('.pos-card:not([disabled])', { timeout: 15000 });
        await page.locator('.pos-card:not([disabled])').first().click();
        await page.waitForSelector('.pos-line', { timeout: 15000 });

        await page.click('#pos-discount-btn');
        await page.click('#pos-disc-mode [data-mode="percent"]');
        await expect(page.locator('#pos-disc-label')).toHaveText(/percent|persen/i);
        await page.fill('#pos-disc-amt', '20');
        // The preview shows the resolved Rupiah before it is committed — a
        // percent a cashier cannot see the value of is a percent they mistype.
        await expect(page.locator('#pos-disc-preview')).toContainText('Rp');

        // Leave without saving: an unfinished discount must not stick.
        await page.locator('#pos-drawer [data-close]').first().click();
        // Asserted on the VALUE, not the absence of the word. The totals stack
        // now always carries an "Extra discount" row (reference parity — it is
        // the row the pencil edits, and hiding it hides the affordance), so
        // "no text matching /discount/" would only be testing the label. What
        // must not have happened is a discount being APPLIED: the extra row
        // stays at zero and no product-discount row appears at all.
        const totals = page.locator('#pos-order-totals');
        await expect(totals).toContainText(/Rp0/);
        await expect(totals).not.toContainText(/Product discount|Diskon produk/i);
        await expect(totals).not.toContainText(/−Rp|-Rp/);

        // Clean up — this spec opened a real order.
        await page.click('#pos-void-btn');
        await page.fill('#pos-void-why', 'Spec cleanup');
        await page.locator('#pos-drawer-form button[type="submit"], button[form="pos-drawer-form"]').first().click();
        await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i, { timeout: 20000 });
    });

    test('a press during a write is refused visibly, not swallowed', async ({ page }) => {
        // `once()` returned null on re-entry and did nothing else — the button
        // stayed lit, the press vanished, and the cashier pressed again. It also
        // cost two spec failures on 2026-08-31 before anyone recognised it,
        // which is exactly the symptom from the outside.
        //
        // Firestore is throttled to make the window observable. Asserting on the
        // real timing would be a race that passes on a fast laptop and ships the
        // bug.
        await page.goto('/pos');
        await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
        await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });

        // Kept installed for the whole test and switched off by a flag rather
        // than unrouted: unrouting mid-flight auto-continues the requests still
        // in the handler, and the second continue throws "Route is already
        // handled".
        let slow = true;
        await page.route('**/google.firestore.v1.Firestore/**', async (route) => {
            if (slow) await new Promise((r) => setTimeout(r, 1200));
            await route.continue().catch(() => {});
        });

        const newOrder = page.locator('#pos-new-order');
        // Through the dialog. "Create Order" only opens a form, and choosing a
        // type only changes which fields it shows — neither is a write. Submit
        // is the press that actually creates the order, and therefore the only
        // one with a window to observe.
        await newOrder.click();
        await page.locator('#pos-create-modal [data-type="takeaway"]').click();
        await page.fill('#pos-create-name', 'QA Takeaway');
        await page.locator('#pos-create-submit').click();

        // Mid-write: the attribute is set and the control refuses the pointer.
        await expect(page.locator('body')).toHaveAttribute('data-pos-busy', '1', { timeout: 5000 });
        const blocked = await newOrder.evaluate((el) => getComputedStyle(el).pointerEvents);
        expect(blocked, 'the button still accepts presses while a write is in flight').toBe('none');

        // And it clears — a stuck busy attribute would brick the till.
        await expect(page.locator('body')).not.toHaveAttribute('data-pos-busy', '1', { timeout: 30000 });
        slow = false;

        // Clean up the order this opened.
        if (await page.locator('#pos-void-btn').isVisible().catch(() => false)) {
            await page.click('#pos-void-btn');
            await page.fill('#pos-void-why', 'Spec cleanup');
            await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
            await expect(page.locator('#pos-order-title'))
                .toHaveText(/no order open|belum ada pesanan/i, { timeout: 20000 });
        }
    });

    test('the floor plan is a room, and management can rearrange it', async ({ page }) => {
        // The floor was an auto-fill CSS grid until 2026-08-31 and it could not
        // work: equal cells that ignore how wide a table actually is, at the
        // ~728px the canvas really gets once the order panel takes its share.
        // Six tables already overlapped. Both facts this asserts — no overlap,
        // nothing through the walls — were false on the shipped page.
        //
        // Writes nothing: it drags and CANCELS. Save is the one path that
        // touches Firestore and it is deliberately not exercised here.
        await page.goto('/pos');
        await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
        await page.click('#nav-container [data-view="tables"]');
        await page.waitForSelector('#pos-floor .pos-table', { timeout: 20000 });
        await page.waitForTimeout(600);

        const geometry = await page.evaluate(() => {
            const floor = document.getElementById('pos-floor');
            const fr = floor.getBoundingClientRect();
            const boxes = [...floor.querySelectorAll('.pos-table')].map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height };
            });
            let overlap = 0, outside = 0;
            for (let i = 0; i < boxes.length; i += 1) {
                const a = boxes[i];
                if (a.x < -1 || a.y < -1 || a.x + a.w > fr.width + 1 || a.y + a.h > fr.height + 1) outside += 1;
                for (let j = i + 1; j < boxes.length; j += 1) {
                    const b = boxes[j];
                    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap += 1;
                }
            }
            return { count: boxes.length, overlap, outside };
        });
        expect(geometry.count, 'the QA outlet has no tables to draw').toBeGreaterThan(0);
        expect(geometry.overlap, 'tables are drawn on top of each other').toBe(0);
        expect(geometry.outside, 'a table is drawn through the wall of the room').toBe(0);

        // Arranging is `pos.manage`. The QA account is the owner, so the toggle
        // is there; a cashier reads the floor and does not redraw the room.
        const toggle = page.locator('#pos-arrange-btn');
        await expect(toggle).toBeVisible();
        await toggle.click();
        await expect(page.locator('.pos-arrange-bar')).toBeVisible();
        await expect(toggle, 'a mode you cannot see you are in').toHaveClass(/is-on/);

        const table = page.locator('#pos-floor .pos-table').first();
        const before = await table.evaluate((el) => `${el.style.left},${el.style.top}`);
        const box = await table.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 80, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(250);

        const after = await table.evaluate((el) => `${el.style.left},${el.style.top}`);
        expect(after, 'dragging did not move the table').not.toBe(before);
        // A drag is not a tap. Opening an order because a manager nudged a table
        // is the failure this guards.
        await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i);

        await page.click('[data-arrange="cancel"]');
        await page.waitForTimeout(500);
        const reverted = await page.locator('#pos-floor .pos-table').first()
            .evaluate((el) => `${el.style.left},${el.style.top}`);
        expect(reverted, 'Cancel left the drag applied').toBe(before);
        await expect(page.locator('.pos-arrange-bar')).toHaveCount(0);
    });

    test('every till view holds its vertical rhythm', async ({ page }) => {
        // The console sweep audits a page in ONE state. The till has FIVE views
        // behind `.hidden`, where every rect is zero and nothing is measurable —
        // so most of this surface was never checked. Each is switched to and
        // audited here, and every view added since must be added to the list.
        //
        // The rule exists because `.fluxy-section-stack > * + *` spaces DIRECT
        // children only: wrapping the views in `.pos-view` dropped every gap to
        // zero at once, and the page read as "weird, tight spacing" rather than
        // as the missing rule it was.
        await page.goto('/pos');
        await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });

        for (const view of ['till', 'tables', 'orders', 'reservations', 'shift']) {
            await page.click(`#nav-container [data-view="${view}"]`);
            await expect(page.locator(`.pos-view[data-view="${view}"]`)).toBeVisible();
            await page.waitForTimeout(500);   // let the view's async render land

            const offenders = await auditSpacing(page);
            expect(offenders,
                `the "${view}" view has sections touching (min ${MIN_GAP}px between stacked cards):\n  `
                + offenders.join('\n  ')
            ).toEqual([]);
        }
    });

    test('the menu fields reached the item drawer', async ({ page }) => {
        // The menu IS `items`. Without these three fields nothing can ever
        // appear on the till, and the POS page would show a permanent empty
        // state with no way for a user to resolve it.
        await page.goto('/inventory');
        await page.waitForSelector('#new-item-btn', { timeout: 15000 });
        await page.click('#new-item-btn');

        await expect(page.locator('#item-price')).toBeVisible();
        await expect(page.locator('#item-pos-visible')).toBeAttached();
        await expect(page.locator('#item-pos-category')).toBeAttached();

        // Live thousands formatting, and the raw integer is what saves.
        await page.fill('#item-price', '45000');
        await expect(page.locator('#item-price')).toHaveValue('45.000');

        // Ticking "show on the till" without a price would put an unbuyable
        // item on the menu, so it is refused at the field.
        await page.fill('#item-price', '');
        await page.click('#item-pos-visible');
        await expect(page.locator('#item-pos-visible')).not.toBeChecked();
    });
});
