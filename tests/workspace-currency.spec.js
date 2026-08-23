// @ts-check
//
// FluxyOS — the workspace's own currency, asserted in a real browser.
//
// This spec runs against a NON-IDR workspace (the chromium-ph project). That is
// the entire point of it. Every other browser check runs against the Indonesian
// QA account, where a currency bug is invisible by construction: rupiah is both
// the correct answer and the fallback, so a page that fails to resolve the
// workspace looks identical to one that resolves it correctly.
//
// The bug that prompted this: checkout resolved the workspace, threw on a
// deleted function, swallowed the error in a catch, and never re-rendered — so a
// peso customer was quoted the rupiah ladder, QRIS and PPN. node --check saw
// valid syntax, the console sweep saw no error because it was caught, and the
// static money guards read source rather than output. Only a peso session sees
// it.
//
// Assertions are written against whatever currency the workspace reports, not a
// hardcoded PHP, so the same spec works for SG/MY when those accounts exist.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Skip the whole file when the non-IDR fixture is absent, so a clone without
// credentials runs green instead of red. Seed one with:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/seed-qa-account.js --country PH
const FIXTURE = path.join(__dirname, '..', '.qa', 'firebase-test-account-ph.md');
test.skip(!fs.existsSync(FIXTURE), 'No non-IDR QA account — see docs/QA_TEST_ACCOUNT.md.');

const PAGES = ['/dashboard.html', '/ledger.html', '/budget.html', '/settings-billing.html'];

async function workspaceCurrency(page) {
    await page.waitForFunction(() => !!window.FluxyMoney, null, { timeout: 15000 });
    await page.waitForFunction(
        () => !document.documentElement.classList.contains('fluxy-booting'),
        null, { timeout: 15000 }
    );
    return page.evaluate(() => ({
        base: window.FluxyMoney.baseCurrency(),
        country: (window.FluxyWorkspace && window.FluxyWorkspace.country) || null,
        symbol: window.FluxyMoney.baseSymbol(),
    }));
}

test.describe('a non-IDR workspace renders in its own currency', () => {
    test('the workspace resolves to a non-IDR currency at all', async ({ page }) => {
        await page.goto('/dashboard.html');
        const { base, country } = await workspaceCurrency(page);
        // If this fails, the fixture is wrong and every assertion below would be
        // vacuously true — so it is checked first and explicitly.
        expect(country, 'QA fixture has no business country').toBeTruthy();
        expect(base, `fixture resolved to ${base}; this project needs a non-IDR workspace to be worth running`)
            .not.toBe('IDR');
    });

    test('no app page renders another currency alongside the base', async ({ page }) => {
        for (const url of PAGES) {
            await page.goto(url);
            const { base } = await workspaceCurrency(page);
            const foreign = await page.evaluate((baseCcy) => {
                const text = document.body.innerText;
                const found = [];
                Object.entries(window.FluxyMoney.CURRENCIES).forEach(([code, cfg]) => {
                    if (code === baseCcy) return;
                    // A bare symbol can appear in prose; require it to be
                    // attached to a digit, which is what a money render looks like.
                    if (new RegExp(`\\${cfg.symbol}\\s?[\\d]`).test(text)) found.push(code);
                });
                return found;
            }, base);
            expect(foreign, `${url} rendered money in ${foreign.join(', ')} on a ${base} workspace`).toEqual([]);
        }
    });

    test('checkout quotes the plan in the billing currency, not the IDR default', async ({ page }) => {
        // The specific regression. Checkout renders once against the IDR default
        // before auth settles, then must re-render once the workspace lands. If
        // the re-render is skipped for any reason, the rupiah ladder stays on
        // screen and the customer is quoted a price we will not charge.
        await page.goto('/checkout.html?plan=growth&billing=annually');
        await page.waitForFunction(() => !!window.FluxyMoney, null, { timeout: 15000 });
        // Give the auth handler its re-render.
        await page.waitForFunction(() => {
            const el = document.getElementById('summary-total');
            return el && el.textContent && el.textContent.trim().length > 1;
        }, null, { timeout: 20000 });

        const total = (await page.locator('#summary-total').textContent() || '').trim();
        const base = await page.evaluate(() => window.FluxyMoney.baseCurrency());
        const symbol = await page.evaluate((c) => window.FluxyMoney.CURRENCIES[c].symbol, base);

        expect(total, `checkout total "${total}" is not in ${base}`).toContain(symbol);
        expect(total, `checkout still shows the rupiah default on a ${base} workspace`).not.toContain('Rp');

        // The tax row must name the local tax, never Indonesia's.
        const taxLabel = (await page.locator('[data-tax-label]').first().textContent() || '');
        expect(taxLabel, `tax row says "${taxLabel}" on a ${base} workspace`).not.toContain('PPN');
    });
});
