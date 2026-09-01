// @ts-check
const { test, expect } = require('@playwright/test');

async function mountSharedPickerFixture(page, options) {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.FluxyDateRangePicker?.mount);
    await page.evaluate((pickerOptions) => {
        document.getElementById('shared-picker-fixture')?.remove();
        const host = document.createElement('div');
        host.id = 'shared-picker-fixture';
        document.body.appendChild(host);
        window.sharedPickerFixtureRange = null;
        window.sharedPickerFixture = window.FluxyDateRangePicker.mount(host, {
            ...pickerOptions,
            onChange: (range) => {
                window.sharedPickerFixtureRange = range;
            }
        });
    }, options);
}

// Render the expected label IN THE BROWSER, not in Node.
//
// The label is produced by Chrome's `toLocaleDateString`; computing the
// expectation with Node's meant comparing two different ICU versions, and they
// disagree. September is the month where that shows: Chrome renders "Sept 2026",
// Node "Sep 2026", so these three specs went red on 2026-09-01 having passed
// every day of August — a date-dependent failure with nothing to do with the
// code under test. Asking the same engine that drew the label what the label
// should be removes the boundary entirely.
async function formatMonth(page, date) {
    return page.evaluate((iso) => new Date(iso).toLocaleDateString(
        (window.FluxyI18n?.locale?.() || 'en-US'), { month: 'short', year: 'numeric' }
    ), date.toISOString());
}

const monthlyFilterPages = [
    { path: '/ledger.html', picker: '#ledger-date-range-picker' },
    { path: '/revenue-sync.html', picker: '#revenue-date-range-picker' },
    { path: '/bill.html', picker: '#bill-date-range-picker' }
];

for (const { path, picker } of monthlyFilterPages) {
    test(`${path} month arrows remain monthly`, async ({ page }) => {
        const currentMonth = new Date();
        const previousMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
        await page.goto(path);

        const host = page.locator(picker);
        const thisMonth = await formatMonth(page, currentMonth);
        const lastMonth = await formatMonth(page, previousMonth);
        await expect(host.locator('[data-drp-label]')).toHaveText(thisMonth);
        await host.locator('[data-drp-prev]').click();
        await expect(host.locator('[data-drp-label]')).toHaveText(lastMonth);
        await host.locator('[data-drp-next]').click();
        await expect(host.locator('[data-drp-label]')).toHaveText(thisMonth);
    });
}

test('shared date picker keeps month scope when returning to the current month', async ({ page }) => {
    await mountSharedPickerFixture(page, {
        start: '2026-06-01',
        end: '2026-06-30',
        maxDate: '2026-06-01'
    });

    const fixture = page.locator('#shared-picker-fixture');
    await expect(fixture.locator('[data-drp-label]')).toHaveText('Jun 2026');

    await fixture.locator('[data-drp-prev]').click();
    await expect(fixture.locator('[data-drp-label]')).toHaveText('May 2026');

    await fixture.locator('[data-drp-next]').click();
    await expect(fixture.locator('[data-drp-label]')).toHaveText('Jun 2026');
    expect(await page.evaluate(() => window.sharedPickerFixture.getRange())).toEqual({
        start: '2026-06-01',
        end: '2026-06-30'
    });
});

test('shared date picker keeps deliberate single-day ranges day-scoped', async ({ page }) => {
    await mountSharedPickerFixture(page, {
        start: '2026-05-15',
        end: '2026-05-15',
        maxDate: '2026-06-01'
    });

    const fixture = page.locator('#shared-picker-fixture');
    await fixture.locator('[data-drp-next]').click();
    // The picker formats via FluxyI18n.locale() — 'en-GB' in the EN-pinned
    // suite, so single days render day-first ("16 May 2026").
    await expect(fixture.locator('[data-drp-label]')).toHaveText('16 May 2026');
    expect(await page.evaluate(() => window.sharedPickerFixture.getRange())).toEqual({
        start: '2026-05-16',
        end: '2026-05-16'
    });
});
