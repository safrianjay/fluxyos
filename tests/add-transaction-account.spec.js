// @ts-check
const { test, expect } = require('@playwright/test');

// The Add Transaction drawer replaced the 10-option "Type" field with a founder
// friendly "Direction" select + a searchable, grouped Chart-of-Accounts "Account"
// picker (fluxy-account-picker.js). The account auto-fills to what the posting
// engine would resolve and stays editable. This is a UI/wiring smoke — it never
// saves, so it mutates no Firestore data. Posting behaviour (account_code override)
// is unit-tested in accounting-engine.spec.js; rules in the kernel emulator test.

test('Add Transaction drawer shows Direction + a searchable Account picker', async ({ page }) => {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30000 });
    await page.waitForFunction(() => typeof window.FluxyAccountPicker === 'object', null, { timeout: 30000 });

    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction', defaultType: 'expense', defaultCategory: 'Operations' }));
    await expect(page.locator('#tx-amount')).toBeVisible({ timeout: 10000 });

    // Direction replaces Type: the visible control is #tx-direction (Money in/out/
    // Transfer/Adjustment + Advanced). The old visible Type <select> is gone (a
    // hidden carrier keeps the id for downstream wiring, so it must NOT be visible).
    await expect(page.locator('#tx-direction')).toHaveCount(1);
    await expect(page.locator('#tx-direction')).toBeAttached();
    const directionValues = await page.$$eval('#tx-direction option', (os) => os.map((o) => o.value));
    expect(directionValues).toEqual(expect.arrayContaining(['in', 'out', 'transfer', 'adjustment', 'refund', 'fee', 'tax']));

    // The hidden #tx-type carrier is derived from Direction (default expense).
    await expect(page.locator('#tx-type')).toHaveValue('expense');
    await page.selectOption('#tx-direction', 'in');
    await expect(page.locator('#tx-type')).toHaveValue('income');
    await page.selectOption('#tx-direction', 'out');
    await expect(page.locator('#tx-type')).toHaveValue('expense');

    // Account field + picker mount are present.
    await expect(page.locator('#tx-account-field')).toBeVisible();
    // The picker mounts asynchronously (needs the chart) — wait for its trigger.
    const trigger = page.locator('#tx-account-mount .fluxy-acct-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });

    // It auto-fills to the kernel's resolved account for an Operations expense.
    await expect.poll(async () => page.$eval('#tx-account-mount input[name="account_code"]', (el) => el.value), { timeout: 15000 })
        .not.toEqual('');

    // Open the picker → search input + grouped options render, each with a code.
    await trigger.click();
    const search = page.locator('.fluxy-acct-menu .fluxy-acct-search');
    await expect(search).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.fluxy-acct-menu .fluxy-acct-option').first()).toBeVisible();
    await expect(page.locator('.fluxy-acct-menu .fluxy-acct-group-label').first()).toBeVisible();

    // Search narrows the list (by code or name).
    await search.fill('office');
    await expect.poll(async () => page.locator('.fluxy-acct-menu .fluxy-acct-option').count(), { timeout: 5000 })
        .toBeGreaterThan(0);
    const firstMatch = await page.locator('.fluxy-acct-menu .fluxy-acct-option').first().innerText();
    expect(firstMatch.toLowerCase()).toContain('office');

    // Pick it → the trigger reflects the chosen account (code · name + badge).
    await page.locator('.fluxy-acct-menu .fluxy-acct-option').first().click();
    await expect(page.locator('#tx-account-mount .fluxy-acct-trigger .fluxy-acct-badge')).toBeVisible();

    // Switch Direction to Money in → the picker now offers revenue accounts.
    await page.selectOption('#tx-direction', 'in');
    await trigger.click();
    await expect(page.locator('.fluxy-acct-menu .fluxy-acct-badge[data-type="revenue"]').first()).toBeVisible({ timeout: 5000 });
    // No expense badge should be offered under Money in.
    await expect(page.locator('.fluxy-acct-menu .fluxy-acct-badge[data-type="expense"]')).toHaveCount(0);

    // Transfer hides the Account field (no categorizing account needed).
    await page.keyboard.press('Escape');
    await page.selectOption('#tx-direction', 'transfer');
    await expect(page.locator('#tx-account-field')).toBeHidden();

    expect(errs, `console/page errors:\n${errs.join('\n')}`).toEqual([]);
});
