// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Phase 1 — Bank Statement Import & Cash Balance Automation QA.
 *
 * Spec: docs/BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md
 *
 * The Ledger header has a unified "Scan / Import" button. Inside the drawer
 * a tab strip switches between Receipt / Invoice (legacy document-capture)
 * and Bank Statement (the new Phase 1 flow).
 *
 * Static + interaction checks run against the local static server. The
 * "@storage" tests need Firebase Storage enabled on the project (currently
 * blocked at the project level — same status as document-attachment.spec).
 */

const STORAGE_READY = !!process.env.STORAGE_RULES_DEPLOYED;

function tempCsv() {
    const file = path.join(os.tmpdir(), `fluxy-qa-bank-${Date.now()}.csv`);
    fs.writeFileSync(file, 'Date,Description,Debit,Credit,Balance\n2026-05-03,TRSF AWS,450000,0,119550000\n', 'utf8');
    return file;
}

function tempPdf() {
    const buf = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
        '0000000010 00000 n \n0000000053 00000 n \n0000000099 00000 n \ntrailer<</Size 4/Root 1 0 R>>startxref\n150\n%%EOF',
        'utf8'
    );
    const file = path.join(os.tmpdir(), `fluxy-qa-bank-${Date.now()}.pdf`);
    fs.writeFileSync(file, buf);
    return file;
}

function tempExe() {
    const file = path.join(os.tmpdir(), `fluxy-qa-bank-bad-${Date.now()}.exe`);
    fs.writeFileSync(file, Buffer.from('MZ', 'utf8'));
    return file;
}

function tempOversizedPdf() {
    const file = path.join(os.tmpdir(), `fluxy-qa-bank-big-${Date.now()}.pdf`);
    fs.writeFileSync(file, Buffer.alloc(11 * 1024 * 1024, 0));
    return file;
}

async function dismissOnboardingIfPresent(page) {
    const onboardingHeader = page.locator('text=/Welcome to FluxyOS|Let\\u2019s get you set up/');
    if (await onboardingHeader.isVisible().catch(() => false)) {
        const skipBtn = page.getByRole('button', { name: /Skip|Maybe later/i });
        if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
    }
}

/** Open the Scan / Import drawer and switch to the Bank Statement tab. */
async function openBankTab(page) {
    await page.locator('#scan-tx-btn').click();
    await expect(page.locator('#scan-drawer')).not.toHaveClass(/translate-x-full/);
    await page.locator('#scan-tab-bank').click();
    await expect(page.locator('#scan-drawer-bsi-content')).toBeVisible();
}

test.describe('Ledger header — Scan / Import entry point', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/ledger.html');
        await dismissOnboardingIfPresent(page);
        await page.waitForFunction(() => !!window.FluxyBankStatementImport, null, { timeout: 10_000 });
    });

    test('Header shows one Scan / Import button (no separate Import Bank Statement)', async ({ page }) => {
        await expect(page.locator('#scan-tx-btn')).toHaveText(/Scan \/ Import/);
        await expect(page.locator('#import-bank-statement-btn')).toHaveCount(0);
        await expect(page.locator('#download-csv-btn')).toBeVisible();
        await expect(page.getByRole('button', { name: /Add Transaction/ }).first()).toBeVisible();
    });

    test('Drawer opens with both tabs and Receipt / Invoice selected by default', async ({ page }) => {
        await page.locator('#scan-tx-btn').click();
        await expect(page.locator('#scan-drawer')).not.toHaveClass(/translate-x-full/);
        await expect(page.locator('#scan-tab-document')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#scan-tab-bank')).toHaveAttribute('aria-selected', 'false');
        await expect(page.locator('#scan-drawer-content')).toBeVisible();
        await expect(page.locator('#scan-drawer-bsi-content')).toBeHidden();
    });

    test('Switching to Bank Statement tab mounts the upload UI', async ({ page }) => {
        await openBankTab(page);
        await expect(page.locator('#scan-tab-bank')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#scan-drawer-bsi-content [data-bsi-file-input]')).toHaveCount(1);
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/Upload a bank statement/i);
        await expect(page.locator('#scan-drawer-content')).toBeHidden();
    });

    test('Switching back to Receipt / Invoice hides the BSI panel', async ({ page }) => {
        await openBankTab(page);
        await page.locator('#scan-tab-document').click();
        await expect(page.locator('#scan-drawer-bsi-content')).toBeHidden();
        await expect(page.locator('#scan-drawer-content')).toBeVisible();
    });

    test('Closing the drawer resets to the default tab', async ({ page }) => {
        await openBankTab(page);
        await page.locator('#scan-drawer-close-btn').click();
        // The drawer slides out; opening again should land on the default tab.
        await page.waitForTimeout(400);
        await page.locator('#scan-tx-btn').click();
        await expect(page.locator('#scan-tab-document')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#scan-drawer-content')).toBeVisible();
    });
});

test.describe('Bank Statement tab — file validation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/ledger.html');
        await dismissOnboardingIfPresent(page);
        await page.waitForFunction(() => !!window.FluxyBankStatementImport, null, { timeout: 10_000 });
        await openBankTab(page);
    });

    test('Stage button is disabled until a file is chosen', async ({ page }) => {
        await expect(page.locator('[data-bsi-stage]')).toBeDisabled();
    });

    test('Rejects unsupported file type with friendly message', async ({ page }) => {
        const fileInput = page.locator('#scan-drawer-bsi-content [data-bsi-file-input]');
        await fileInput.setInputFiles(tempExe());
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/Unsupported file type|wrong format/i);
        await expect(page.locator('[data-bsi-stage]')).toBeDisabled();
    });

    test('Rejects oversized PDF (>10 MB)', async ({ page }) => {
        const fileInput = page.locator('#scan-drawer-bsi-content [data-bsi-file-input]');
        await fileInput.setInputFiles(tempOversizedPdf());
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/10 MB|larger/i);
        await expect(page.locator('[data-bsi-stage]')).toBeDisabled();
    });

    test('Accepts valid CSV and enables Stage button', async ({ page }) => {
        const fileInput = page.locator('#scan-drawer-bsi-content [data-bsi-file-input]');
        const csv = tempCsv();
        await fileInput.setInputFiles(csv);
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(path.basename(csv));
        await expect(page.locator('[data-bsi-stage]')).toBeEnabled();
    });

    test('Accepts valid PDF and enables Stage button', async ({ page }) => {
        const fileInput = page.locator('#scan-drawer-bsi-content [data-bsi-file-input]');
        const pdf = tempPdf();
        await fileInput.setInputFiles(pdf);
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(path.basename(pdf));
        await expect(page.locator('[data-bsi-stage]')).toBeEnabled();
    });

    test('Remove button clears the staged file', async ({ page }) => {
        const fileInput = page.locator('#scan-drawer-bsi-content [data-bsi-file-input]');
        await fileInput.setInputFiles(tempCsv());
        await expect(page.locator('[data-bsi-stage]')).toBeEnabled();
        await page.locator('#scan-drawer-bsi-content [data-bsi-clear-file]').click();
        await expect(page.locator('[data-bsi-stage]')).toBeDisabled();
    });
});

test.describe('Ledger regression — existing features untouched', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/ledger.html');
        await dismissOnboardingIfPresent(page);
    });

    test('Add Transaction drawer still opens with single + bulk tabs', async ({ page }) => {
        await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function');
        await page.evaluate(() => window.showAddTransactionModal({}));
        await expect(page.locator('#global-tx-modal')).toBeVisible();
        await expect(page.locator('#tx-amount')).toBeVisible();
        await expect(page.locator('#tx-tab-bulk')).toBeVisible();
        await page.evaluate(() => window.closeAddTransactionModal());
    });

    test('Ledger search, date picker, and sort headers still render', async ({ page }) => {
        await expect(page.locator('#ledger-search-input')).toBeVisible();
        await expect(page.locator('#ledger-date-range-picker')).toBeVisible();
        await expect(page.locator('button.ledger-sort-btn[data-sort-key="date"]')).toBeVisible();
        await expect(page.locator('button.ledger-sort-btn[data-sort-key="amount"]')).toBeVisible();
    });

    test('Receipt / Invoice scan flow still renders its upload step', async ({ page }) => {
        await page.locator('#scan-tx-btn').click();
        await expect(page.locator('#scan-drawer-content')).toBeVisible();
        // document-capture.js drives a data-step attribute on the content
        // container. Phase 1 default is "upload" online or "offline" offline;
        // either is fine — we only care that the legacy renderer is active.
        await expect(page.locator('#scan-drawer-content')).toHaveAttribute('data-step', /upload|offline/, { timeout: 5_000 });
    });
});

test.describe('Bank statement import — end-to-end @storage', () => {
    test.skip(!STORAGE_READY, 'Set STORAGE_RULES_DEPLOYED=1 once firestore.rules and storage.rules ship.');

    test('Staging a CSV creates a draft + uploads file + shows summary', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

        await page.goto('/ledger.html');
        await dismissOnboardingIfPresent(page);
        await page.waitForFunction(() => !!window.FluxyBankStatementImport);
        await openBankTab(page);
        await page.locator('#scan-drawer-bsi-content [data-bsi-file-input]').setInputFiles(tempCsv());
        await page.locator('[data-bsi-stage]').click();

        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/Import draft/i, { timeout: 30_000 });
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/Automated extraction is not connected yet/i);
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/Review table/i);

        const confirmBtn = page.locator('button:has-text("Confirm Import")');
        await expect(confirmBtn).toBeDisabled();

        await page.locator('[data-bsi-reject]').click();
        await expect(page.locator('#scan-drawer-bsi-content')).toContainText(/rejected/i, { timeout: 10_000 });

        if (consoleErrors.length) {
            console.log('BSI_E2E_CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));
        }
    });
});
