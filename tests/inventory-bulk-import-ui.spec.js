const { test, expect } = require('@playwright/test');

// Bulk import as the New item drawer's second tab — the Add Transaction
// contract applied to Inventory: one drawer, a segmented control, one shared
// footer button (PROJECT_BACKGROUND §5).
//
// tests/inventory-import.spec.js proves the engine — parsing, mapping,
// validation, the money and date rules. It says nothing about whether any of
// that is reachable. This spec only ever touches the DOM.
//
// It deliberately stops SHORT of pressing Import. That button posts a journal
// against 3900 and creates items that can never be deleted, so a UI spec that
// pressed it would add permanent rows and a permanent ledger entry on every run.
// tests/inventory-import-post.spec.js exercises the write path through
// DataService on data it controls. What this file guards is the promise the
// drawer makes: NOTHING IS WRITTEN BEFORE CONFIRM, and everything that will and
// will not happen is on screen while the user can still walk away.

test.describe.configure({ timeout: 150_000 });

async function gotoItems(page) {
    await page.goto('/inventory?tab=items');
    await page.waitForFunction(
        () => document.querySelector('#inv-kpis .kpi-detail-cell:not([data-skeleton])')
            && !document.getElementById('inv-panel-items').classList.contains('hidden'),
        undefined, { timeout: 60000 }
    );
}

async function openImportTab(page) {
    await page.click('#new-item-btn');
    await page.waitForTimeout(300);
    await page.click('#item-tab-bulk');
    await page.waitForSelector('#inv-import-file', { timeout: 20000 });
}

async function uploadCsv(page, csv, name = 'inventory-list.csv') {
    await page.setInputFiles('#inv-import-file', {
        name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8')
    });
    await page.waitForSelector('#inv-import-preview:not(.hidden)', { timeout: 60000 });
}

const GOOD_CSV = [
    'Product Name,Product Code,Unit,Track Stock for This Item,Tracking Type,Default Buy Account Code,I Sell This Item,Sell Price,I Buy This Item,Warehouse Zone',
    'QA Import Kopi,QA-IMP-1,g,Track,Qty,5100,No,,Yes,A1',
    'QA Import Susu,QA-IMP-2,ml,Track,Serial Number,5-50000,Yes,12000,Yes,B2',
    'QA Import Broken,QA-IMP-3,1000,Track,Qty,5100,No,,Yes,C3'
].join('\n');

test('import is a tab in the New item drawer, not a second button', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) errors.push(m.text());
    });

    await gotoItems(page);

    // The standalone toolbar button is gone — one entry point, like the Ledger.
    expect(await page.locator('#bulk-import-btn').count()).toBe(0);

    await page.click('#new-item-btn');
    await page.waitForTimeout(300);
    await expect(page.locator('#item-tab-single')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#item-save-btn')).toHaveText('Save item');

    await page.click('#item-tab-bulk');
    await page.waitForSelector('#inv-import-file');
    // One drawer: the width does not change between tabs.
    const width = await page.evaluate(() => document.getElementById('item-drawer').getBoundingClientRect().width);
    expect(width).toBe(480);
    // One footer button, and it now names the other job.
    await expect(page.locator('#item-save-btn')).toHaveText('Import items');
    await expect(page.locator('#item-save-btn')).toBeDisabled();
    await expect(page.locator('#item-single-panel')).toBeHidden();

    // And back, with the single form's own validation resumed.
    await page.click('#item-tab-single');
    await expect(page.locator('#item-save-btn')).toHaveText('Save item');
    await expect(page.locator('#item-single-panel')).toBeVisible();

    expect(errors).toEqual([]);
});

test('a file is previewed, and what will not be imported is named before the confirm', async ({ page }) => {
    await gotoItems(page);
    await openImportTab(page);
    await uploadCsv(page, GOOD_CSV);

    const body = page.locator('#item-bulk-panel');

    // The Ledger's preview card: eyebrow, filename, summary sentence, badge.
    await expect(body).toContainText('Inventory import preview');
    await expect(body).toContainText('inventory-list.csv');
    await expect(body).toContainText('2 of 3 rows will be imported.');
    await expect(body).toContainText('1 cannot import');

    // The numeric unit is caught and SAID, not silently dropped.
    await expect(body).toContainText('is a number, not a unit');
    // Serial tracking is reported as recorded-but-unenforced.
    await expect(body).toContainText('not enforced');
    // An unresolvable account code is reported, never mapped to a plausible one.
    await expect(body).toContainText('is not in your chart of accounts');
    // A column FluxyOS does not read is named before the user commits.
    await expect(body).toContainText('Columns we will not import');
    await expect(body).toContainText('Warehouse Zone');

    await expect(page.locator('#item-save-btn')).toHaveText('Import 2 items');
    await expect(page.locator('#item-save-btn')).toBeEnabled();

    // Leaving is free right up to that button.
    await page.click('#item-drawer-close');
    await page.waitForTimeout(200);
    await expect(page.locator('#item-drawer')).toHaveClass(/translate-x-full/);
});

test('mapping chips name a column only when it differs from what we call it', async ({ page }) => {
    await gotoItems(page);
    await openImportTab(page);
    await uploadCsv(page, GOOD_CSV);

    const chips = page.locator('#item-bulk-panel .rounded-full');
    // Template headers match our own field names, so the chip prints the name
    // once — "Product Name: Product Name" is the redundancy this guards.
    await expect(chips.filter({ hasText: 'Name' }).first()).toBeVisible();
    await expect(page.locator('#item-bulk-panel')).not.toContainText('Name: Name');
    await expect(page.locator('#item-bulk-panel')).not.toContainText('Unit: Unit');
    // A column that genuinely is not in the file says so.
    await expect(page.locator('#item-bulk-panel')).toContainText('Opening stock: Not in file');
});

test('opening stock states the journal it will post before it posts it', async ({ page }) => {
    await gotoItems(page);
    await openImportTab(page);
    const now = new Date();
    const csv = [
        'Product Name,Unit,Track Stock for This Item,I Sell This Item,I Buy This Item,#Opening Balance Stock,#Opening Balance Price,#Opening Balance Date',
        `QA Import Opening,g,Track,No,Yes,1000,250,01/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    ].join('\n');
    await uploadCsv(page, csv);

    const body = page.locator('#item-bulk-panel');
    // The accounts are named on screen. An import that quietly posts a journal
    // is the thing this sentence exists to prevent.
    await expect(body).toContainText('Inventory (1200)');
    await expect(body).toContainText('Opening Balance Equity (3900)');
    await expect(body).toContainText('Opening stock posts to your ledger');
});

test('a file whose columns we cannot place offers mapping, not a dead end', async ({ page }) => {
    await gotoItems(page);
    await openImportTab(page);

    // Nothing here matches the template or any known alias. The file is
    // perfectly readable — a shop whose sheet says "Bahan" is not wrong.
    await uploadCsv(page, [
        'Bahan,Takaran,Harga',
        'Kopi Arabika,g,150',
        'Susu UHT,ml,18'
    ].join('\n'), 'custom.csv');

    await expect(page.locator('#item-bulk-panel')).toContainText('Map columns');
    await expect(page.locator('#item-save-btn')).toBeDisabled();

    await page.selectOption('[data-map-key="name"]', { label: 'Bahan' });
    await page.waitForTimeout(200);
    await page.selectOption('[data-map-key="unit"]', { label: 'Takaran' });
    await page.waitForTimeout(300);

    await expect(page.locator('#item-bulk-panel')).toContainText('Kopi Arabika');
    await expect(page.locator('#item-save-btn')).toHaveText('Import 2 items');
});

test('in a non-IDR workspace the preview renders pesos and surfaces the separator ambiguity', async ({ page }) => {
    // `10.000` is ten thousand under Indonesian grouping and ten under Anglo
    // decimals. Rupiah has no minor unit, so a decimal reading is never valid
    // there and the cell is simply unambiguous; a currency WITH cents has two
    // defensible readings of the same cell — a 1000x error that stores cleanly
    // and raises nothing. The control that resolves it only appears here.
    await gotoItems(page);
    await page.evaluate(() => window.FluxyMoney.setBaseCurrency('PHP'));
    await openImportTab(page);
    await uploadCsv(page, [
        'Product Name,Unit,Track Stock for This Item,I Sell This Item,Sell Price,I Buy This Item',
        'QA Peso Ambiguous,g,Track,Yes,10.000,No',
        'QA Peso Clear,g,Track,Yes,1500.50,No'
    ].join('\n'));

    const body = page.locator('#item-bulk-panel');
    await expect(body).toContainText('could be read two ways');
    await expect(page.locator('[data-amount-mode="id"]')).toBeVisible();
    // Rendered through the money seam — never a rupiah string. `10.000` reads
    // as ten thousand pesos under Detect.
    await expect(body).toContainText('read as Peso');
    await expect(body).toContainText('₱10,000.00');
    await expect(body).toContainText('₱1,500.50');
    await expect(body).not.toContainText('Rp');

    // Switching the convention re-reads the SAME rows: ten thousand becomes ten.
    // The ambiguity notice goes with it — once the format is stated there is
    // nothing left to be ambiguous about.
    await page.click('[data-amount-mode="en"]');
    await page.waitForTimeout(500);
    await expect(page.locator('#item-bulk-panel')).toContainText('₱10.00');
});

test('an .xlsx upload lazy-loads the reader and previews the same as a CSV', async ({ page }) => {
    // SheetJS is vendored and fetched ON DEMAND, so a wrong path, a CSP
    // rejection or a pruned asset shows up only here — a CSV import never
    // touches it and would stay green.
    const XLSX = require('xlsx');
    const rows = [
        ['Product Name', 'Product Code', 'Unit', 'Track Stock for This Item', 'Tracking Type',
            'I Sell This Item', 'Sell Price', 'I Buy This Item', '#Opening Balance Stock',
            '#Opening Balance Price', '#Opening Balance Date'],
        // Written as TEXT, which is what a person's spreadsheet holds. `raw: true`
        // keeps it that way: letting Excel hand us a parsed Date would apply ITS
        // locale's day/month order to `01/08/2026`.
        ['QA XLSX Kopi', 'QA-X1', 'g', 'Track', 'Qty', 'No', '', 'Yes', '1000', '250', '01/08/2026'],
        ['QA XLSX Gula', 'QA-X2', 'g', 'Track', 'Qty', 'Yes', '5000', 'No', '', '', '']
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Inventory');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const vendorRequests = [];
    page.on('response', (res) => {
        if (/xlsx\.mini\.min\.js/.test(res.url())) vendorRequests.push(res.status());
    });

    await gotoItems(page);
    await openImportTab(page);
    await page.setInputFiles('#inv-import-file', {
        name: 'inventory.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer
    });
    await page.waitForSelector('#inv-import-preview:not(.hidden)', { timeout: 60000 });

    expect(vendorRequests.length).toBeGreaterThan(0);
    expect(vendorRequests.every((s) => s === 200)).toBe(true);

    await expect(page.locator('#item-save-btn')).toHaveText('Import 2 items');
    // 1.000 g at Rp250 — the date read as 1 August, not 8 January.
    await expect(page.locator('#item-bulk-panel')).toContainText('Rp250.000');
});
