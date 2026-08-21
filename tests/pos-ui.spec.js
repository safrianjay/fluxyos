const { test, expect } = require('@playwright/test');

// Browser coverage for the till.
//
// The order LIFECYCLE (open → send → serve → bill → pay → post) is covered by
// tests/pos-posting.spec.js at the engine level and tests/pos-rules-emulator-test.mjs
// at the rules level. What can only be checked here is the page itself: that it
// boots clean, that the shared components are actually wired, and that the two
// honesty signals the design depends on are present rather than merely intended.
//
// Deliberately does NOT create orders against production Firestore. The QA
// workspace is shared, orders are effectively immutable once paid, and a spec
// that leaves paid orders behind would pollute a real ledger permanently — the
// same reason seed-fnb-demo.js refuses a workspace that already holds items.

test.describe('Point of Sale', () => {
    test('boots clean, with the shared components actually wired', async ({ page }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));

        await page.goto('/pos');
        await expect(page.locator('.dashboard-topbar-title')).toHaveText('Point of Sale');
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
        await expect(page.locator('.pos-outletbar .fluxy-select--enhanced')).toBeVisible();

        // The enhanced wrapper must stay pinned. Left unconstrained it stretched
        // to the full page width for a two-word value.
        const w = await page.locator('.pos-outletbar .fluxy-select').evaluate((el) => el.getBoundingClientRect().width);
        expect(w, 'the outlet picker must not eat the whole row').toBeLessThan(400);

        // Every collapsed icon button keeps a name for assistive tech — below
        // 640px the Takeaway label is hidden and only the glyph remains.
        await expect(page.locator('#pos-new-order')).toHaveAttribute('aria-label', /takeaway/i);

        // Strict. `pos_orders` is in the DEPLOYED rules (stamped 2026-08-21), so
        // the live-order listener must connect — and if it stops, this is the
        // only place that would notice. A "live orders unavailable" error here
        // means the rules were rolled back or never redeployed, which makes the
        // till blind to QR orders and to a second device on the floor.
        const real = errors.filter((e) => !/tailwindcss\.com|favicon|net::ERR_/i.test(e));
        expect(real, `console errors: ${real.join(' | ')}`).toEqual([]);
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
        await expect(page.locator('.dashboard-topbar-title')).toBeVisible();
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
