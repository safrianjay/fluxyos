// @ts-check
// Accounting Center navigation helper.
//
// The Accounting Center uses a two-level nav (docs/ACCOUNTING_CENTER_IA.md):
// a primary group row, then a child row showing only the active group's views.
// Child buttons for inactive groups carry the `hidden` attribute, so clicking a
// view directly fails Playwright's actionability check. Always route through
// openAccountingTab() instead of clicking `[data-acct-tab=…]` by hand.

const GROUP_OF_TAB = {
    overview: 'overview',
    income: 'reports',
    balance: 'reports',
    cashflow: 'reports',
    aging: 'reports',
    journals: 'ledger',
    ledger: 'ledger',
    trial: 'ledger',
    coa: 'setup',
    mapping: 'setup',
    vendors: 'setup',
    close: 'close',
    cleanup: 'close'
};

/**
 * Open an Accounting Center view, selecting its parent group first.
 * @param {import('@playwright/test').Page} page
 * @param {keyof typeof GROUP_OF_TAB} tab
 */
async function openAccountingTab(page, tab) {
    const group = GROUP_OF_TAB[tab];
    if (!group) throw new Error(`Unknown Accounting Center tab: ${tab}`);
    await page.locator(`[data-acct-group="${group}"]`).click();
    // Single-view groups hide the child row (a one-button row is filler), so the
    // group click alone selects the view — mirror what a user can actually do.
    const child = page.locator(`[data-acct-tab="${tab}"]`);
    if (await child.isVisible().catch(() => false)) await child.click();
    await page.waitForSelector(`[data-acct-panel="${tab}"]`, { state: 'visible' });
}

module.exports = { openAccountingTab, GROUP_OF_TAB };
