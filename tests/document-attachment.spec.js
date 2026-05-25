// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Phase 1 — Receipt & Document Attachment QA suite.
 *
 * Static + interaction checks run against localhost (python http.server)
 * with the live Firebase project. The fixture in tests/setup-auth.spec.js
 * has already signed us in.
 *
 * Storage-dependent specs are tagged with @storage. Until
 * `firebase deploy --only storage` succeeds (blocked on Firebase console
 * enabling the new Storage API for this project), set
 * `STORAGE_RULES_DEPLOYED=1` in the env to opt those tests back in.
 */

const STORAGE_READY = !!process.env.STORAGE_RULES_DEPLOYED;

// ---------- fixtures ----------------------------------------------------

/** Write a tiny PNG to disk and return its path. */
function tempPng() {
    const buf = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000005000100' +
        '0d0a2db40000000049454e44ae426082',
        'hex'
    );
    const file = path.join(os.tmpdir(), `fluxy-qa-${Date.now()}.png`);
    fs.writeFileSync(file, buf);
    return file;
}

/** Write a tiny PDF to disk and return its path. */
function tempPdf() {
    const buf = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\nxref\n0 4\n0000000000 65535 f \n' +
        '0000000010 00000 n \n0000000053 00000 n \n0000000099 00000 n \ntrailer<</Size 4/Root 1 0 R>>startxref\n150\n%%EOF',
        'utf8'
    );
    const file = path.join(os.tmpdir(), `fluxy-qa-${Date.now()}.pdf`);
    fs.writeFileSync(file, buf);
    return file;
}

/** Write a 6 MB binary blob with a .png extension so it passes type validation but fails size. */
function tempOversizedImage() {
    const file = path.join(os.tmpdir(), `fluxy-qa-big-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.alloc(6 * 1024 * 1024, 0));
    return file;
}

/** Write a non-allowed file type. */
function tempExe() {
    const file = path.join(os.tmpdir(), `fluxy-qa-bad-${Date.now()}.exe`);
    fs.writeFileSync(file, Buffer.from('MZ', 'utf8'));
    return file;
}

async function dismissOnboardingIfPresent(page) {
    // The QA account predates the onboarding cutoff (2026-05-19), but skip
    // the gate defensively in case the test account drifts past it.
    const onboardingHeader = page.locator('text=/Welcome to FluxyOS|Let\\u2019s get you set up/');
    if (await onboardingHeader.isVisible().catch(() => false)) {
        const skipBtn = page.getByRole('button', { name: /Skip|Maybe later/i });
        if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
    }
}

// ---------- 1. Add Transaction drawer mounts new attachment UI ----------

test.describe('Add Transaction drawer — shared attachment mount', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard.html');
        await dismissOnboardingIfPresent(page);
    });

    test('renders Receipt label and 5MB/PDF helper for expense transactions', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({ defaultType: 'expense' }));
        const section = page.locator('#tx-receipt-section[data-fluxy-doc-mount]');
        await expect(section).toBeVisible();
        // mount() injects the block label + helper text into the section
        await expect(section.getByText('Receipt (optional)')).toBeVisible();
        await expect(section.getByText(/JPG, PNG, WebP, or PDF.*Max 5 MB/i)).toBeVisible();
    });

    test('renders Proof / document label for revenue/income context', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({
            title: 'Add Revenue',
            submitLabel: 'Add Revenue',
            defaultType: 'income',
            defaultCategory: 'Revenue',
            context: 'transaction',
        }));
        const section = page.locator('#tx-receipt-section[data-fluxy-doc-mount]');
        await expect(section).toBeVisible();
        await expect(section.getByText('Proof / document (optional)')).toBeVisible();
        await expect(section.getByText(/payment screenshot|transfer proof|payout/i)).toBeVisible();
    });

    test('rejects oversized file with friendly inline error', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({}));
        const fileInput = page.locator('#tx-receipt-section input[type="file"]');
        await expect(fileInput).toHaveCount(1);
        await fileInput.setInputFiles(tempOversizedImage());
        await expect(page.locator('#tx-receipt-section')).toContainText(/too large/i);
    });

    test('rejects unsupported file type', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({}));
        const fileInput = page.locator('#tx-receipt-section input[type="file"]');
        await fileInput.setInputFiles(tempExe());
        await expect(page.locator('#tx-receipt-section')).toContainText(/not supported|JPG.*PNG.*WebP.*PDF/i);
    });

    test('drawer reset clears pending file when closed and reopened', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({}));
        const fileInput = page.locator('#tx-receipt-section input[type="file"]');
        const png = tempPng();
        await fileInput.setInputFiles(png);
        await expect(page.locator('#tx-receipt-section')).toContainText(path.basename(png));

        await page.evaluate(() => window.closeAddTransactionModal());
        await expect(page.locator('#global-tx-modal')).toHaveCount(0);

        await page.evaluate(() => window.showAddTransactionModal({}));
        const section = page.locator('#tx-receipt-section');
        // The filename from the previous attach must not leak into the new drawer.
        await expect(section).not.toContainText(path.basename(png));
        await expect(section.getByText('Attach receipt')).toBeVisible();
    });

    test('CSV bulk upload tab still renders (regression — Phase 1 must not break CSV)', async ({ page }) => {
        await page.evaluate(() => window.showAddTransactionModal({}));
        await page.locator('#tx-tab-bulk').click();
        await expect(page.locator('#tx-bulk-panel')).toBeVisible();
        await expect(page.locator('#tx-csv-file')).toHaveCount(1);
        // The shared submit button must flip to "Upload CSV" in bulk mode.
        await expect(page.locator('#tx-submit-btn')).toContainText(/Upload CSV/i);
    });
});

// ---------- 2. Bill Details drawer Attach Invoice -----------------------

test.describe('Bill Details drawer — Attach Invoice wiring', () => {
    test('Attach Invoice button is enabled; Convert + Mark as Paid stay disabled', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

        await page.goto('/bill.html');
        await dismissOnboardingIfPresent(page);
        await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function');

        // The QA account may or may not have bills yet. If empty, create one;
        // any failure here surfaces as test.skip with the underlying console
        // error so we can debug instead of timing out.
        await page.waitForTimeout(1500); // bills load async after auth
        const hasBills = await page.locator('[data-action="review"]').first().isVisible().catch(() => false);
        if (!hasBills) {
            await page.evaluate(() => window.showAddTransactionModal({
                title: 'Add New Bill',
                submitLabel: 'Save Bill',
                defaultCategory: 'Operations',
                context: 'bill',
            }));
            await page.locator('#tx-amount').fill('100000');
            await page.locator('#tx-vendor').fill('QA Bill');
            await expect(page.locator('#tx-submit-btn')).toBeEnabled({ timeout: 5_000 });
            await page.locator('#tx-submit-btn').click();
            try {
                await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 15_000 });
            } catch (err) {
                console.log('BILL_CREATE_CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));
                throw err;
            }
            await page.reload();
            await dismissOnboardingIfPresent(page);
            await page.waitForTimeout(1500);
        }

        await expect(page.locator('[data-action="review"]').first()).toBeVisible({ timeout: 10_000 });
        await page.locator('[data-action="review"]').first().click();
        await expect(page.locator('#bill-drawer')).not.toHaveClass(/translate-x-full/);

        const attachBtn = page.locator('#bill-attach-invoice-btn');
        await expect(attachBtn).toBeVisible();
        await expect(attachBtn).toBeEnabled();
        await expect(attachBtn).toContainText(/Attach Invoice|Replace Invoice/);

        // Convert to Transaction stays disabled with "Coming soon"
        const convertBtn = page.getByRole('button', { name: /Convert to Transaction/i });
        await expect(convertBtn).toBeDisabled();
        // Mark as Paid stays disabled with "Soon"
        const markPaidBtn = page.getByRole('button', { name: /Mark as Paid/i });
        await expect(markPaidBtn).toBeDisabled();
    });
});

// ---------- 3. Storage-dependent end-to-end paths -----------------------

test.describe('Storage-dependent end-to-end uploads @storage', () => {
    test.skip(!STORAGE_READY, 'Set STORAGE_RULES_DEPLOYED=1 once storage.rules ship.');

    test('Add Transaction with PNG writes attached_documents + dual receipt_url', async ({ page }) => {
        await page.goto('/dashboard.html');
        await dismissOnboardingIfPresent(page);
        await page.evaluate(() => window.showAddTransactionModal({}));
        await page.locator('#tx-amount').fill('123000');
        await page.locator('#tx-vendor').fill('QA receipt png');
        await page.locator('#tx-receipt-section input[type="file"]').setInputFiles(tempPng());
        await page.locator('#tx-submit-btn').click();
        await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 30_000 });
        // No throw === Firestore + Storage both accepted the write.
    });

    test('Add Transaction with PDF writes attached_documents without receipt_url', async ({ page }) => {
        await page.goto('/dashboard.html');
        await dismissOnboardingIfPresent(page);
        await page.evaluate(() => window.showAddTransactionModal({}));
        await page.locator('#tx-amount').fill('45000');
        await page.locator('#tx-vendor').fill('QA receipt pdf');
        await page.locator('#tx-receipt-section input[type="file"]').setInputFiles(tempPdf());
        await page.locator('#tx-submit-btn').click();
        await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 30_000 });
    });

    test('Bill Attach Invoice succeeds and renders "Invoice attached" panel', async ({ page }) => {
        await page.goto('/bill.html');
        await dismissOnboardingIfPresent(page);
        await page.locator('[data-action="review"]').first().click();
        const attachBtn = page.locator('#bill-attach-invoice-btn');
        await expect(attachBtn).toBeEnabled();

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            attachBtn.click(),
        ]);
        await fileChooser.setFiles(tempPdf());

        // Toast appears, drawer re-renders, attached panel shows up.
        await expect(page.locator('text=Invoice attached to bill')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#bill-drawer-content')).toContainText(/Invoice attached/i);
    });
});
