// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Authenticated browser check for the "New Account" create drawer on the
// Accounting Center → Chart of Accounts tab. Runs as the QA account against real
// Firestore. Custom accounts cannot be deleted (archive only), so the happy path
// uses the drawer's auto-suggested next-free code (6900, 6910, …) to stay
// re-runnable, mirroring how the manual-journal spec accumulates journals.

const collectErrors = (page) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|404|chart_of_accounts|saveAccount/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
    return bad;
};

async function openCoaDrawer(page) {
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'coa');
    const newBtn = page.locator('#coa-new-account');
    await expect(newBtn).toBeVisible({ timeout: 15000 });
    await newBtn.click();
    await expect(page.locator('#ca-drawer-panel')).toBeVisible({ timeout: 10000 });
}

test('New Account drawer creates a custom account; it lands in the CoA table and the manual-journal picker', async ({ page }) => {
    const bad = collectErrors(page);
    await openCoaDrawer(page);

    // Pick an operating-expense category → type expense, auto-suggested 6xxx code,
    // and a default input-VAT treatment.
    await page.locator('#ca-category').selectOption('operating_expense');
    const code = await page.locator('#ca-code').inputValue();
    expect(code).toMatch(/^6\d{3}$/);
    const name = `QA Custom Expense ${Date.now()}`;
    await page.locator('#ca-name').fill(name);
    await page.locator('#ca-tax').selectOption('PPN_IN_11');
    await page.locator('#ca-save').click();

    // Drawer closes; the new account appears in the CoA table with a detail link.
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });
    const row = page.locator(`#coa-content a.acct-link[href="/accounting-account?code=${code}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });

    // The chosen tax persists and surfaces on the Account Detail summary.
    await page.goto(`/accounting-account?code=${code}`);
    await expect(page.locator('#account-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#account-detail-body')).toContainText('PPN Masukan 11%');

    // Available immediately in Manual Journal Entry (reads the live collection).
    await page.goto('/accounting-journal-new.html');
    await expect(page.locator('.mj-acct').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(`.mj-acct option[value="${code}"]`).first()).toHaveCount(1);

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('New Account drawer rejects a duplicate code inline and does not create', async ({ page }) => {
    const bad = collectErrors(page);
    await openCoaDrawer(page);

    // 6100 (Marketing Expense) is a seeded expense account → duplicate.
    await page.locator('#ca-category').selectOption('operating_expense');
    const codeInput = page.locator('#ca-code');
    await codeInput.fill('');
    await codeInput.type('6100');
    await page.locator('#ca-name').fill('Should Not Save');
    await page.locator('#ca-save').click();

    // Inline error shows, drawer stays open, no toast-created row.
    await expect(page.locator('#ca-error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ca-error')).toContainText(/already exists/i);
    await expect(page.locator('#ca-drawer-panel')).toBeVisible();

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('Tax options are restricted by account type (no wrong-direction VAT)', async ({ page }) => {
    const bad = collectErrors(page);
    await openCoaDrawer(page);

    // Expense → input VAT (Masukan) only.
    await page.locator('#ca-category').selectOption('operating_expense');
    await expect(page.locator('#ca-tax-field')).toBeVisible();
    await expect(page.locator('#ca-tax option[value="PPN_IN_11"]')).toHaveCount(1);
    await expect(page.locator('#ca-tax option[value="PPN_OUT_11"]')).toHaveCount(0);

    // Revenue → output VAT (Keluaran) + zero/exempt, never input VAT.
    await page.locator('#ca-category').selectOption('revenue');
    await expect(page.locator('#ca-tax option[value="PPN_OUT_11"]')).toHaveCount(1);
    await expect(page.locator('#ca-tax option[value="PPN_ZERO"]')).toHaveCount(1);
    await expect(page.locator('#ca-tax option[value="PPN_IN_11"]')).toHaveCount(0);

    // Equity → VAT not applicable, the Tax field is hidden entirely.
    await page.locator('#ca-category').selectOption('equity');
    await expect(page.locator('#ca-tax-field')).toBeHidden();

    await page.locator('#ca-cancel').click();
    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('Edit drawer opens for a user-created account (code immutable) and renames it', async ({ page }) => {
    const bad = collectErrors(page);

    // Create a fresh, unused account to edit.
    await openCoaDrawer(page);
    await page.locator('#ca-category').selectOption('operating_expense');
    const code = await page.locator('#ca-code').inputValue();
    await page.locator('#ca-name').fill(`QA Editable ${Date.now()}`);
    await page.locator('#ca-save').click();
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });
    await expect(page.locator(`#coa-content a.acct-link[href="/accounting-account?code=${code}"]`)).toBeVisible({ timeout: 15000 });

    // Open Edit: title switches, code is immutable.
    await page.locator(`[data-coa-kebab="${code}"]`).click();
    await page.locator('.acct-kebab-menu [data-menu-edit]').click();
    await expect(page.locator('#ca-drawer-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ca-drawer-title')).toHaveText('Edit Account');
    await expect(page.locator('#ca-code')).toBeDisabled();

    // Rename (unused account → no lock) and save.
    const newName = `QA Renamed ${Date.now()}`;
    await page.locator('#ca-name').fill(newName);
    await page.locator('#ca-save').click();
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });

    // The same code now renders under the new name.
    await expect(page.locator(`#coa-content a.acct-link[href="/accounting-account?code=${code}"]`))
        .toHaveText(newName, { timeout: 15000 });

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('Edit lock: an account with posted activity locks category + parent but stays renamable', async ({ page }) => {
    const bad = collectErrors(page);

    // 1) Create a fresh expense account.
    await openCoaDrawer(page);
    await page.locator('#ca-category').selectOption('operating_expense');
    const code = await page.locator('#ca-code').inputValue();
    await page.locator('#ca-name').fill(`QA Locked ${Date.now()}`);
    await page.locator('#ca-save').click();
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });

    // 2) Post a balanced manual journal touching it → ledger_balances activity.
    // The counter-line is 2500 Deferred Revenue, not 1000 Cash: cash is closed to
    // manual journals (allow_manual_journal: false), because a manual entry against
    // a bank account creates a GL movement with no statement line behind it and
    // sits in the reconciliation queue forever. Moving cash goes through a
    // transaction; opening balances go through the exempt `opening` subtype.
    await page.goto('/accounting-journal-new.html');
    await expect(page.locator('#mj-form')).toBeVisible({ timeout: 30000 });
    await page.locator('#mj-description').fill('QA activity for edit-lock');
    const rows = page.locator('#mj-lines tr');
    await rows.nth(0).locator('.mj-acct').selectOption(code);
    await rows.nth(0).locator('.mj-debit').fill('1000');
    await rows.nth(1).locator('.mj-acct').selectOption('2500');
    await rows.nth(1).locator('.mj-credit').fill('1000');
    await expect(page.locator('#mj-post')).toBeEnabled({ timeout: 10000 });
    await page.locator('#mj-post').click();
    await page.waitForURL(/accounting-journal\.html\?id=/, { timeout: 30000 });

    // 3) Open Edit on that account → structural fields are locked.
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'coa');
    await page.locator(`[data-coa-kebab="${code}"]`).click();
    await page.locator('.acct-kebab-menu [data-menu-edit]').click();
    await expect(page.locator('#ca-drawer-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ca-category')).toBeDisabled();
    await expect(page.locator('#ca-parent-toggle')).toBeDisabled();
    await expect(page.locator('#ca-drawer-panel')).toContainText(/Locked/i);

    // 4) Name stays editable — rename still saves.
    await expect(page.locator('#ca-name')).toBeEnabled();
    const newName = `QA Locked Renamed ${Date.now()}`;
    await page.locator('#ca-name').fill(newName);
    await page.locator('#ca-save').click();
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });
    await expect(page.locator(`#coa-content a.acct-link[href="/accounting-account?code=${code}"]`))
        .toHaveText(newName, { timeout: 15000 });

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});
