// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * AI scan review: multi-currency, cash impact, and the source document.
 *
 * The extraction API and the FX proxy are both route-stubbed so the assertions
 * are exact — this suite is about what the review step does with an extraction,
 * not about the model's accuracy. Storage-backed saves still hit live Firebase.
 *
 * Currency rules under test:
 *   - Bills keep their own currency (USD stored as cents), converted only when
 *     paid — same convention as the Add Bill drawer and invoices.
 *   - Transactions/subscriptions have no `currency` field in firestore.rules, so
 *     they are converted to IDR at save and the original is kept in `notes`.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const JPEG_1PX = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
    'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
    'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
    'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
    'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
    'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
    'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
    'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
    'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
    'gD//2Q==', 'base64');

function tempPdf() {
    const f = path.join(os.tmpdir(), `qa-cur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.pdf`);
    fs.writeFileSync(f, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF', 'utf8'));
    return f;
}

function tempJpg() {
    const f = path.join(os.tmpdir(), `qa-cur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
    fs.writeFileSync(f, JPEG_1PX);
    return f;
}

/** Stub extraction with a given currency/amount. */
async function stubExtract(page, { currency, amount, vendor = 'Anthropic, PBC' }) {
    await page.route('**/api/v1/bills/extract', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
            ok: true, extraction_source: 'openai',
            data: {
                document_type: 'receipt', vendor_name: vendor, amount, currency,
                category: 'Operations', confidence: { overall: 0.95, amount: 0.95, vendor_name: 0.9, due_date: 0.9, category: 0.9 },
                warnings: []
            }
        })
    }));
}

/** Deterministic FX so assertions are exact. */
async function stubFx(page, rate = 16000) {
    await page.route('**/.netlify/functions/fx-rate*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ rate, date: '2026-07-29', from: 'USD', to: 'IDR', source: 'frankfurter' })
    }));
}

async function openScan(page, url, opener) {
    await page.goto(url);
    await page.waitForFunction((fn) => typeof window[fn] === 'function' && !!window.FluxyMoney, opener, { timeout: 30_000 });
    await page.evaluate((fn) => window[fn](), opener);
    await page.locator('#scan-file-input').first().setInputFiles(tempJpg());
    await page.locator('#scan-start-btn').click();
    await expect(page.locator('#scan-review-form')).toBeVisible({ timeout: 30_000 });
}

function watch(page) {
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    return errs;
}
const real = (e) => e.filter((x) => !/favicon|ERR_BLOCKED_BY_CLIENT|(Listen|Write)\/channel.*ERR_ABORTED/i.test(x));

// ---------------------------------------------------------------------------

test('USD receipt: currency detected, amount keeps cents, FX converts to IDR', async ({ page }) => {
    const errs = watch(page);
    await stubExtract(page, { currency: 'USD', amount: 20 });
    await stubFx(page, 16000);
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');

    // Currency picked up from the document; amount shown in USD convention.
    await expect(page.locator('#scan-review-form select[name="currency"]')).toHaveValue('USD');
    await expect(page.locator('#scan-amount-cur')).toHaveText('(USD)');
    // Canonical USD form — "20.5" would read as $20.05 at a glance.
    await expect(page.locator('#scan-review-form input[name="amount"]')).toHaveValue('20.00');

    // FX block visible with a fetched rate and the converted equivalent.
    await expect(page.locator('#scan-fx-block')).toBeVisible();
    await expect(page.locator('#scan-fx-rate')).toHaveValue('16.000', { timeout: 15_000 });
    await expect(page.locator('#scan-fx-note')).toContainText('$20.00');
    await expect(page.locator('#scan-fx-note')).toContainText('Rp320.000');

    expect(real(errs)).toEqual([]);
});

test('manual rate override wins and recomputes the conversion', async ({ page }) => {
    await stubExtract(page, { currency: 'USD', amount: 20 });
    await stubFx(page, 16000);
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');
    await expect(page.locator('#scan-fx-rate')).toHaveValue('16.000', { timeout: 15_000 });

    await page.locator('#scan-fx-rate').fill('');
    await page.locator('#scan-fx-rate').type('17000');
    await expect(page.locator('#scan-fx-rate')).toHaveValue('17.000');
    await expect(page.locator('#scan-fx-note')).toContainText('Rp340.000');
    await expect(page.locator('#scan-fx-note')).toContainText('your rate');
});

test('amount input groups thousands as you type (IDR)', async ({ page }) => {
    await stubExtract(page, { currency: 'IDR', amount: 1250000 });
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');

    await expect(page.locator('#scan-review-form input[name="amount"]')).toHaveValue('1.250.000');
    const amount = page.locator('#scan-review-form input[name="amount"]');
    await amount.fill('');
    await amount.type('5000000');
    await expect(amount).toHaveValue('5.000.000');
    await amount.fill('');
    await amount.type('12500000');
    await expect(amount).toHaveValue('12.500.000');
    // No FX block for a Rupiah document.
    await expect(page.locator('#scan-fx-block')).toBeHidden();
});

test('switching currency reformats the amount and reveals FX', async ({ page }) => {
    await stubExtract(page, { currency: 'IDR', amount: 1250000 });
    await stubFx(page, 16000);
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');
    await expect(page.locator('#scan-fx-block')).toBeHidden();

    await page.locator('#scan-review-form select[name="currency"]').selectOption('USD');
    await expect(page.locator('#scan-amount-cur')).toHaveText('(USD)');
    await expect(page.locator('#scan-fx-block')).toBeVisible();
    await expect(page.locator('#scan-fx-rate')).toHaveValue('16.000', { timeout: 15_000 });
});

test('cash impact shows on a scanned transaction and follows the type', async ({ page }) => {
    await stubExtract(page, { currency: 'IDR', amount: 500000 });
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');

    const cash = page.locator('#scan-cash-impact');
    await expect(cash).toContainText('Cash impact');
    await expect(cash.locator('[data-cash-impact="actual"]')).toBeVisible();
    await expect(cash.locator('[data-cash-dir="out"]')).toBeVisible();

    // Expense defaults to cash out; income flips it to cash in.
    await page.locator('#scan-review-form select[name="type"]').selectOption('income');
    await expect(cash.locator('[data-cash-dir="in"]')).toHaveClass(/bg-white/);
});

test('scanned bill shows "no immediate cash impact" instead of a cash control', async ({ page }) => {
    await stubExtract(page, { currency: 'IDR', amount: 900000 });
    await openScan(page, '/bill.html', 'openScanBillDrawer');
    const cash = page.locator('#scan-cash-impact');
    await expect(cash).toContainText('No immediate cash impact');
    await expect(cash).toContainText('Cash moves when you mark this bill paid');
    await expect(cash.locator('[data-cash-impact="actual"]')).toHaveCount(0);
});

test('review step shows the source document, never a second upload prompt', async ({ page }) => {
    await stubExtract(page, { currency: 'IDR', amount: 500000 });
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');
    const src = page.locator('#scan-source-doc');
    await expect(src).toContainText('Source document');
    await expect(src).toContainText('.jpg');
    await expect(src).toContainText('Attached automatically when you save');
    await expect(src.locator('#scan-source-replace')).toBeVisible();
    // No dropzone in the review step.
    await expect(page.locator('#scan-review-form')).not.toContainText(/Drag|Choose a file|Upload a file/i);
});

test('USD transaction saves the converted Rupiah amount and records the original', async ({ page }) => {
    const vendor = `QA USD ${Date.now()}`;
    await stubExtract(page, { currency: 'USD', amount: 20, vendor });
    await stubFx(page, 16000);
    await openScan(page, '/ledger.html', 'openScanTransactionDrawer');
    await expect(page.locator('#scan-fx-rate')).toHaveValue('16.000', { timeout: 15_000 });

    await page.locator('#scan-save-btn').click();
    await expect(page.locator('#scan-drawer')).toHaveClass(/translate-x-full/, { timeout: 60_000 });

    const tx = await page.evaluate(async (v) => {
        const ctx = window.__fluxyTxContext;
        const rows = await ctx.ds.getTransactions(ctx.auth.currentUser.uid, 50);
        const r = rows.find((x) => x.vendor_name === v);
        return r ? { amount: r.amount, notes: r.notes || '', cash_status: r.cash_status, cash_direction: r.cash_direction, currency: r.currency } : null;
    }, vendor);

    expect(tx, 'transaction created').toBeTruthy();
    expect(tx.amount, '$20 @ 16000 = Rp320.000 stored as IDR').toBe(320000);
    expect(tx.notes).toContain('$20.00');
    expect(tx.notes).toContain('16.000');
    expect(tx.currency, 'transactions have no currency field in rules').toBeUndefined();
    // Cash impact from the review step rode along.
    expect(tx.cash_status).toBe('actual');
    expect(tx.cash_direction).toBe('out');
});

test('USD bill keeps its own currency in cents, no conversion', async ({ page }) => {
    const vendor = `QA USD bill ${Date.now()}`;
    await stubExtract(page, { currency: 'USD', amount: 20.5, vendor });
    await stubFx(page, 16000);
    await openScan(page, '/bill.html', 'openScanBillDrawer');
    await expect(page.locator('#scan-review-form input[name="amount"]')).toHaveValue('20.50');

    await page.locator('#scan-save-btn').click();
    await expect(page.locator('#scan-drawer')).toHaveClass(/translate-x-full/, { timeout: 60_000 });

    const bill = await page.evaluate(async (v) => {
        const ctx = window.__fluxyBillsContext;
        const rows = await ctx.ds.getBills(ctx.auth.currentUser.uid);
        const r = rows.find((x) => x.vendor_name === v);
        return r ? { amount: r.amount, currency: r.currency, payment_status: r.payment_status } : null;
    }, vendor);

    expect(bill, 'bill created').toBeTruthy();
    expect(bill.currency).toBe('USD');
    expect(bill.amount, '$20.50 stored as 2050 cents').toBe(2050);
    expect(bill.payment_status).toBe('unpaid');
});

test('attachments section: dropzone collapses once a file is attached', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => !!window.__fluxyBillsContext?.auth?.currentUser, null, { timeout: 30_000 });
    await page.locator('[data-action="review"]').first().click();
    const box = page.locator('#bill-attachments');
    await expect(box).toBeVisible();

    const wasEmpty = await box.locator('[data-doc-index]').count() === 0;
    if (wasEmpty) await expect(box).toContainText('Attach a document');

    await box.locator('input[type="file"]').setInputFiles(tempPdf());
    await expect(box.locator('[data-doc-index]').first()).toBeVisible({ timeout: 30_000 });

    // The prominent dropzone is gone; a quiet "add another" replaces it.
    await expect(box).not.toContainText('Attach a document');
    await expect(box).toContainText('Add another document');
    // A PDF keeps a typed badge instead of the generic grey sheet icon.
    // (Image rows swap the badge for a real thumbnail — covered elsewhere.)
    await expect(box.locator('[data-doc-thumb]').last()).toContainText('PDF');
    await expect(box.locator('button[data-doc-act="replace"]').first()).toBeVisible();
});
