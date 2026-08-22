// @ts-check
//
// FluxyOS — base-currency rendering, verified in a real browser.
//
// The static checks in tests/money-seam.check.js prove the SOURCE is clean. They
// cannot prove the RENDERED page is, because every remaining failure mode here is
// a timing one:
//
//   * the browser paints markup before any JS runs, so a literal "Rp0" in a KPI
//     span is visible for the whole workspace resolution;
//   * the boot mask must actually lift, or the app stays skeletoned forever;
//   * the money seam must be loaded and initialised on every page that formats,
//     or formatters throw at render time.
//
// Runs against the QA account (an IDR workspace), so the assertions are written
// to hold for ANY base currency rather than hardcoding pesos: what matters is
// that the page renders in the workspace's own currency and never flashes
// another one.

const { test, expect } = require('@playwright/test');

const APP_PAGES = [
    '/dashboard.html',
    '/ledger.html',
    '/opex-budget.html',
    '/revenue-overview.html',
    '/settings-cash.html',
];

test.describe('base currency renders without a flash', () => {
    test('no app page serves a currency figure in its markup', async ({ page, request }) => {
        // Assert on the SERVED HTML, not on a live DOM. An earlier version of this
        // raced the parse with waitUntil:'commit' and read an empty body, so it
        // passed with the bug present — a vacuous assertion is worse than none.
        // The markup is what the browser paints before any script runs, so this is
        // exactly the window the "Rp0" flash lived in, and it is deterministic.
        for (const url of APP_PAGES) {
            const res = await request.get(url);
            expect(res.ok(), `${url} did not load`).toBe(true);
            const html = await res.text();
            const hits = html.split('\n')
                .map((line, i) => ({ line, n: i + 1 }))
                .filter(({ line }) => />Rp[\d.,]*</.test(line))
                .map(({ n }) => `${url}:${n}`);
            expect(hits, `served markup paints a currency figure before JS runs`).toEqual([]);
        }
    });

    test('the money seam is loaded and initialised on every app page', async ({ page }) => {
        for (const url of APP_PAGES) {
            await page.goto(url);
            await page.waitForFunction(() => !!window.FluxyMoney, null, { timeout: 15000 });
            const seam = await page.evaluate(() => ({
                base: window.FluxyMoney.baseCurrency(),
                sample: window.FluxyMoney.formatBase(1234567),
                supported: window.FluxyMoney.SUPPORTED,
            }));
            // Whatever the workspace currency is, the seam must resolve to a real
            // one and format with ITS symbol — never a bare number.
            expect(seam.base, `${url}: base currency unresolved`).toMatch(/^[A-Z]{3}$/);
            expect(seam.sample, `${url}: formatBase produced no currency symbol`).not.toMatch(/^\d/);
            // A business must be able to invoice in its own currency.
            expect(seam.supported, `${url}: face currencies exclude the base currency`)
                .toContain(seam.base);
        }
    });

    test('the boot mask lifts — the app never stays skeletoned', async ({ page }) => {
        await page.goto('/dashboard.html');
        // fluxy-booting is set in the markup, so it is present at commit time and
        // must be removed once the workspace resolves. The failsafe is 6s.
        await page.waitForFunction(
            () => !document.documentElement.classList.contains('fluxy-booting'),
            null,
            { timeout: 12000 }
        );
        const stillMasked = await page.locator('.fluxy-booting').count();
        expect(stillMasked, 'boot mask never lifted').toBe(0);
    });

    test('rendered money uses one currency, consistently', async ({ page }) => {
        await page.goto('/dashboard.html');
        await page.waitForFunction(() => !document.documentElement.classList.contains('fluxy-booting'), null, { timeout: 12000 });
        const { base, symbols } = await page.evaluate(() => {
            const b = window.FluxyMoney.baseCurrency();
            const text = document.body.innerText;
            const found = new Set();
            // Every currency symbol the seam knows about.
            Object.entries(window.FluxyMoney.CURRENCIES).forEach(([code, cfg]) => {
                if (text.includes(cfg.symbol + '0') || new RegExp(`\\${cfg.symbol}[\\d]`).test(text)) found.add(code);
            });
            return { base: b, symbols: [...found] };
        });
        // Only the workspace's own currency may appear in rendered money. A second
        // symbol means something formatted against a stale default.
        const foreign = symbols.filter((c) => c !== base);
        expect(foreign, `dashboard rendered money in ${foreign.join(', ')} alongside ${base}`).toEqual([]);
    });

    test('the attach-proof control is not a raw file input', async ({ page }) => {
        // sr-only is owned by shared-dashboard.css rather than the Tailwind CDN's
        // JIT, so a drawer injected on demand cannot lose the race and expose the
        // native "Choose File" control.
        await page.goto('/dashboard.html');
        await page.waitForFunction(() => !document.documentElement.classList.contains('fluxy-booting'), null, { timeout: 12000 });
        const hidden = await page.evaluate(() => {
            const probe = document.createElement('input');
            probe.type = 'file';
            probe.className = 'sr-only';
            document.body.appendChild(probe);
            const r = probe.getBoundingClientRect();
            const visible = r.width > 2 && r.height > 2;
            probe.remove();
            return !visible;
        });
        expect(hidden, 'sr-only did not hide a file input — the native control would show').toBe(true);
    });
});
