const { test, expect } = require('@playwright/test');

// =============================================================================
// POS Settings — what an outlet charges, when it opens, and what diners see.
//
// The one assertion that matters most here is the BILL PREVIEW. An owner typing
// a tax rate is being shown what their customers will be charged, and a preview
// that agreed with the form but not with the till would be a confident wrong
// number — this codebase's whole failure mode. So the page runs the real
// `pos-pricing.js`, and this spec proves the number on screen is the one that
// module produces rather than something the page computed for itself.
//
// ⚠️ IT ASSERTS THE FIXTURE RATHER THAN SKIPPING ON IT. A spec that quietly
// skips when the QA workspace has no outlet is indistinguishable from one that
// passed, which is how two pos-ui specs sat green for weeks without running.
// =============================================================================

test.describe('POS Settings', () => {
    test('the page is the five sections, on one outlet', async ({ page }) => {
        await page.goto('/settings-pos');

        // `#pos-outlet` is in the static markup, so it is visible long before its
        // options exist — counting them straight away measures the page's paint,
        // not its data. The body unhiding is the real "settings loaded" signal.
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 20_000 });

        // Asserted, never skipped. If the QA workspace really had no outlet the
        // page would be showing the empty state instead, and this says so rather
        // than passing quietly.
        await expect(page.locator('#pos-no-outlet'),
            'the QA workspace has no outlet — POS settings are per-outlet, so there is nothing to configure')
            .toBeHidden();
        expect(await page.locator('#pos-outlet option').count()).toBeGreaterThan(0);
        for (const heading of [
            'Outlet information', 'Opening & closing hours', 'Homepage image',
            'VAT & service fee', 'Discount rules'
        ]) {
            await expect(page.getByRole('heading', { name: heading })).toBeVisible();
        }

        // Seven days, every one of them answerable. "Closed" is a real answer and
        // the default, so a day nobody has set does not advertise hours.
        await expect(page.locator('.pos-hours-row')).toHaveCount(7);
    });

    test('THE BILL PREVIEW IS THE REAL PRICING MODULE, NOT THE PAGE\'S OWN MATHS', async ({ page }) => {
        await page.goto('/settings-pos');
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 20_000 });

        // The module the till and the diner's phone both run must be present here.
        expect(await page.evaluate(() => typeof window.FluxyPosPricing === 'object'),
            'the settings preview is not loading the shared pricing module').toBe(true);

        await page.locator('#pos-tax-enabled').check();
        await page.locator('#pos-tax-rate').fill('11');
        await page.locator('#pos-service-enabled').check();
        await page.locator('#pos-service-rate').fill('5');
        await page.locator('#pos-tax-inclusive').selectOption('false');
        await page.locator('#pos-service-taxable').selectOption('true');

        // 100.000 base + 5% service = 5.000; 11% of 105.000 = 11.550 → 116.550.
        const expected = await page.evaluate(() => window.FluxyPosPricing.computeBillTotals({
            subtotal: 100000,
            discountTotal: 0,
            settings: {
                tax_enabled: true, tax_rate_percent: 11, tax_inclusive: false,
                service_enabled: true, service_rate_percent: 5, service_taxable: true
            }
        }));
        expect(expected.total, 'the module itself changed').toBe(116550);

        const shown = await page.locator('.pos-preview-row.is-total .num').innerText();
        const digits = (s) => s.replace(/\D/g, '');
        expect(digits(shown),
            'the preview disagrees with the module the till prices bills with')
            .toBe(String(expected.total));
    });

    test('inclusive pricing is explained as what it is, not left to be inferred', async ({ page }) => {
        await page.goto('/settings-pos');
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 20_000 });

        await page.locator('#pos-tax-enabled').check();
        await page.locator('#pos-tax-rate').fill('11');
        await page.locator('#pos-service-enabled').uncheck();
        await page.locator('#pos-tax-inclusive').selectOption('true');

        // The bill does NOT go up — the tax was always in the price. An owner who
        // thinks inclusive mode adds 11% will price their menu 11% wrong, so the
        // page says which part of the money stops being theirs.
        const total = await page.locator('.pos-preview-row.is-total .num').innerText();
        expect(total.replace(/\D/g, '')).toBe('100000');
        await expect(page.locator('#pos-preview-note')).toContainText(/already include/i);
        await expect(page.locator('#pos-preview-note')).toContainText(/remit|collect/i);

        // Exclusive is the other statement, and it must not claim tax is income.
        await page.locator('#pos-tax-inclusive').selectOption('false');
        const added = await page.locator('.pos-preview-row.is-total .num').innerText();
        expect(added.replace(/\D/g, '')).toBe('111000');
        await expect(page.locator('#pos-preview-note')).toContainText(/money you owe, not income/i);
    });

    test('a discount preset can be created and archived, and says what it will record', async ({ page }) => {
        await page.goto('/settings-pos');
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 20_000 });

        const name = `QA preset ${Date.now()}`;
        await page.locator('#pos-preset-add').click();
        await page.locator('#pos-preset-name').fill(name);
        await page.locator('#pos-preset-kind').selectOption('percent');
        await page.locator('#pos-preset-value').fill('20');
        await page.locator('#pos-preset-form button[type="submit"]').click();

        const row = page.locator('.pos-preset-row', { hasText: name });
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row).toContainText('20%');
        // The till REQUIRES a reason on every discount — it is the only record of
        // why money was given away — so a preset with no reason typed falls back
        // to its own name rather than leaving the cashier to invent one.
        await expect(row.locator('.pos-preset-meta')).toContainText(name);

        // Archived, never deleted: a preset applied to real sales is a fact about
        // those sales, and the reason on them points back to it.
        page.once('dialog', (d) => d.accept());
        await row.getByRole('button', { name: 'Archive' }).click();
        const confirm = page.locator('button', { hasText: /^Archive$/ }).last();
        if (await confirm.isVisible().catch(() => false)) await confirm.click();
        await expect(page.locator('.pos-preset-row', { hasText: name })).toHaveCount(0, { timeout: 15_000 });
    });

    test('a rate above 100% is refused before it can reach a bill', async ({ page }) => {
        await page.goto('/settings-pos');
        await expect(page.locator('#pos-settings-body')).toBeVisible({ timeout: 20_000 });

        // ⚠️ A rate typed as 1100 instead of 11 fails nowhere on its own — it
        // produces a plausible, enormous, wrong number on every receipt and a
        // matching liability. Bounded in rules, in the DAL, and here.
        const clamped = await page.evaluate(() => window.FluxyPosPricing.computeBillTotals({
            subtotal: 100000, discountTotal: 0,
            settings: { tax_enabled: true, tax_rate_percent: 1100, service_enabled: false }
        }));
        expect(clamped.total, 'a runaway rate reached the bill').toBeLessThanOrEqual(200000);

        // And the input itself will not accept one.
        expect(await page.locator('#pos-tax-rate').getAttribute('max')).toBe('100');
    });
});
