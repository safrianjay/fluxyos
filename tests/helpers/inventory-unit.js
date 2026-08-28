// Set a unit in the item drawer without every spec knowing how the widget works.
//
// The stock/purchase unit fields used to be bare text inputs, so specs did
// `page.fill('#item-base-unit', 'g')`. They are dropdowns now — a text box that
// looked like the Name field above it invited "100" as a perfectly reasonable
// answer, and the app could only explain afterwards why that was wrong.
//
// The dropdown is what a user touches; `#item-base-unit` is still the value of
// record that `saveItem` reads. This helper hides that split, so the next time
// the widget changes it is one edit here rather than a dozen across the suite.
//
// `Other…` is the escape hatch for a unit not on the list, and is exercised by
// passing something the list does not carry.

// The purchase-unit picker was removed from this drawer on 2026-08-29 — a
// purchase unit is now defined on the receipt line, where the delivery note is
// in hand. Only the stock unit is set here.
const PICKER = {
    base: { select: '#item-base-unit-pick', input: '#item-base-unit' },
};
const OTHER = '__other__';

/**
 * @param {import('@playwright/test').Page} page
 * @param {'base'} field
 * @param {string} value  a unit code, e.g. 'g'. Anything not on the list routes
 *                        through `Other…` automatically.
 */
async function setUnit(page, field, value) {
    const { select, input } = PICKER[field];
    const onList = await page.locator(`${select} option[value="${value}"]`).count();
    if (onList) {
        await page.selectOption(select, value);
        return;
    }
    // Not on the list — take the Other… path and type it.
    await page.selectOption(select, OTHER);
    await page.fill(input, value);
}

/** Read back what the drawer will actually save, whichever path set it. */
async function unitValue(page, field) {
    return page.inputValue(PICKER[field].input);
}

module.exports = { setUnit, unitValue, PICKER, OTHER };
