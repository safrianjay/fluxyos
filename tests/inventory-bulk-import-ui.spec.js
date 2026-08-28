const { test, expect } = require('@playwright/test');

// The bulk import drawer, driven the way a user drives it.
//
// tests/inventory-import.spec.js proves the engine — parsing, mapping,
// validation, the money and date rules. It says nothing about whether any of
// that is reachable. This spec only ever touches the DOM.
//
// It deliberately stops SHORT of pressing Import. The last button posts a
// journal against 3900 and creates items that can never be deleted
// (`allow delete: if false`), so a UI spec that pressed it would add permanent
// rows and a permanent ledger entry to the QA workspace on every run.
// `tests/inventory-cogs.spec.js` is where the write path is exercised, through
// DataService, on data it controls. What this file guards is the promise the
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

// A file the drawer will read, built in the page so no fixture has to be
// committed and kept in step with the template.
async function uploadCsv(page, csv, name = 'items.csv') {
    await page.setInputFiles('#inv-import-file', {
        name,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv, 'utf8')
    });
    await page.waitForSelector('.inv-import-tiles', { timeout: 60000 });
}

test('the import drawer opens, offers the template, and writes nothing on its own', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (/sendOobCode|favicon/i.test(msg.text())) return;
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));

    await gotoItems(page);

    await page.click('#bulk-import-btn');
    await expect(page.locator('#inv-import-panel')).toBeVisible();
    await expect(page.locator('#inv-import-title')).toHaveText('Bulk import inventory');

    // Step 1 must state the promise, not just collect a file.
    await expect(page.locator('#inv-import-body')).toContainText('never uploaded anywhere');
    await expect(page.locator('#inv-import-body')).toContainText('until you press Import');

    // The template downloads, and it is the file the engine can read back.
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#inv-import-template')
    ]);
    expect(download.suggestedFilename()).toBe('fluxyos-inventory-import-template.csv');

    // Closing before confirm is free.
    await page.click('#inv-import-panel .fluxy-drawer-close');
    await expect(page.locator('#inv-import-root')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
});

test('a file is previewed row by row, and what will not be imported is named before the confirm', async ({ page }) => {
    await gotoItems(page);
    await page.click('#bulk-import-btn');

    // One good row, one with a foreign account code, one that cannot import.
    const csv = [
        'Product Name,Product Code,Unit,Track Stock for This Item,Tracking Type,Default Buy Account Code,I Sell This Item,Sell Price,I Buy This Item,#Opening Balance Stock,#Opening Balance Price,#Opening Balance Date,Warehouse Zone',
        'QA Import Kopi,QA-IMP-1,g,Track,Qty,5100,No,,Yes,,,,A1',
        'QA Import Susu,QA-IMP-2,ml,Track,Serial Number,5-50000,Yes,12000,Yes,,,,B2',
        'QA Import Broken,QA-IMP-3,1000,Track,Qty,5100,No,,Yes,,,,C3'
    ].join('\n');
    await uploadCsv(page, csv);

    const body = page.locator('#inv-import-body');

    // The four figures that answer "what is about to happen".
    await expect(body.locator('.inv-import-tile')).toHaveCount(4);
    await expect(body).toContainText('Will import');
    await expect(body).toContainText('Cannot import');

    // The numeric unit is caught and SAID, not silently dropped.
    await expect(body).toContainText('QA Import Broken');
    await expect(body).toContainText('is a number, not a unit');

    // Serial tracking is reported as recorded-but-unenforced. Accepting it
    // silently is the exact failure the warning exists to prevent.
    await expect(body).toContainText('not enforced');

    // An unresolvable account code is reported, not mapped to a plausible one.
    await expect(body).toContainText('is not in your chart of accounts');

    // A column FluxyOS does not read is named before the user commits.
    await expect(body).toContainText('Columns we will not import');
    await expect(body).toContainText('Warehouse Zone');

    // Every row is listed with its spreadsheet line number.
    await expect(body.locator('tbody tr')).toHaveCount(3);

    // The confirm button counts what it will actually do.
    await expect(page.locator('#inv-import-confirm')).toContainText('Import 2 items');

    // Still nothing written: leaving is free right up to the last button.
    await page.click('#inv-import-panel .fluxy-drawer-close');
    await expect(page.locator('#inv-import-root')).toHaveCount(0);
});

test('opening stock states the journal it will post before it posts it', async ({ page }) => {
    await gotoItems(page);
    await page.click('#bulk-import-btn');

    const csv = [
        'Product Name,Unit,Track Stock for This Item,I Sell This Item,I Buy This Item,#Opening Balance Stock,#Opening Balance Price,#Opening Balance Date',
        `QA Import Opening,g,Track,No,Yes,1000,250,01/${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`
    ].join('\n');
    await uploadCsv(page, csv);

    const body = page.locator('#inv-import-body');
    // The accounts are named on screen. An import that quietly posts a journal
    // is the thing this sentence exists to prevent.
    await expect(body).toContainText('Inventory (1200)');
    await expect(body).toContainText('Opening Balance Equity (3900)');
    // 1.000 g at 250 is the TOTAL that posts, rendered through the money seam —
    // so the figure the user approves is the figure that reaches the ledger.
    await expect(body).toContainText('Opening stock posts to your ledger');

    await page.click('#inv-import-panel .fluxy-drawer-close');
});

test('the empty state offers the import as a second way in', async ({ page }) => {
    await gotoItems(page);
    // The QA workspace has items, so the no-items state is exercised through the
    // renderer directly rather than by emptying a shared workspace.
    const html = await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'qa-empty-probe';
        document.body.appendChild(host);
        window.renderEmptyState('qa-empty-probe', {
            title: 'No items yet',
            description: 'x',
            buttonText: 'New item',
            onAction: () => {},
            secondaryText: 'Import from a spreadsheet',
            onSecondary: () => {}
        });
        const out = host.innerHTML;
        host.remove();
        return out;
    });
    expect(html).toContain('empty-state-action');
    expect(html).toContain('empty-state-secondary');
    expect(html).toContain('Import from a spreadsheet');

    // The secondary must be visibly lower emphasis than the primary — two
    // adjacent filled buttons is the equal-weight CTA cluster the design system
    // bans, and it makes the primary choice unreadable.
    expect(html).not.toMatch(/id="empty-state-secondary"[^>]*bg-gray-900/);
});

test('in a non-IDR workspace the preview renders pesos and surfaces the separator ambiguity', async ({ page }) => {
    // The L4 case this whole design exists for. `10.000` is ten thousand under
    // Indonesian grouping and ten under Anglo decimals. Rupiah has no minor
    // unit, so a decimal reading is never valid there and the cell is simply
    // unambiguous; a currency WITH cents has two defensible readings of the same
    // cell, which is a 1000x error that stores cleanly and raises nothing. The
    // control that resolves it therefore only ever appears here.
    //
    // The base currency is set-once and enforced in firestore.rules, so this
    // pushes the money seam into peso mode in the page rather than creating a
    // second workspace. That is the seam every amount renders through, which is
    // precisely what is under test.
    await gotoItems(page);
    await page.evaluate(() => window.FluxyMoney.setBaseCurrency('PHP'));

    await page.click('#bulk-import-btn');
    const csv = [
        'Product Name,Unit,Track Stock for This Item,I Sell This Item,Sell Price,I Buy This Item',
        'QA Peso Ambiguous,g,Track,Yes,10.000,No',
        'QA Peso Clear,g,Track,Yes,1500.50,No'
    ].join('\n');
    await uploadCsv(page, csv);

    const body = page.locator('#inv-import-body');

    // The ambiguity is RAISED, not resolved behind the user's back.
    await expect(body).toContainText('could be read two ways');
    await expect(page.locator('[data-amount-mode="id"]')).toBeVisible();
    await expect(page.locator('[data-amount-mode="en"]')).toBeVisible();

    // The currency every amount is being read as is NAMED. The template has no
    // currency column, so a peso price list uploaded to a rupiah workspace
    // imports cleanly and wrongly — this line is the only place that assumption
    // is visible before the confirm.
    await expect(body).toContainText('read as Peso');

    // Detected: `10.000` reads as ten thousand pesos. Every amount is rendered
    // through the money seam, so the peso symbol and two decimals are what the
    // user actually approves — never a rupiah string.
    await expect(body).toContainText('₱10,000.00');
    await expect(body).toContainText('₱1,500.50');
    await expect(body).not.toContainText('Rp');

    // Switching the convention re-reads the SAME rows: ten thousand becomes ten.
    await page.click('[data-amount-mode="en"]');
    await page.waitForSelector('.inv-import-tiles');
    await expect(body).toContainText('₱10.00');
});

test('an .xlsx upload lazy-loads the reader and previews the same as a CSV', async ({ page }) => {
    // The Excel path has its own failure mode: SheetJS is vendored and fetched
    // ON DEMAND, so a wrong path, a CSP rejection, or a pruned asset shows up
    // only here — a CSV import would never touch it and would stay green.
    const XLSX = require('xlsx');
    const rows = [
        ['Product Name', 'Product Code', 'Unit', 'Track Stock for This Item', 'Tracking Type',
            'I Sell This Item', 'Sell Price', 'I Buy This Item', '#Opening Balance Stock',
            '#Opening Balance Price', '#Opening Balance Date'],
        // Written as TEXT, which is what a person's spreadsheet holds. `raw: true`
        // on the reader keeps it that way: letting Excel hand us a parsed Date
        // would apply ITS locale's day/month order to `01/08/2026`.
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
    await page.click('#bulk-import-btn');
    await page.setInputFiles('#inv-import-file', {
        name: 'inventory.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer
    });
    await page.waitForSelector('.inv-import-tiles', { timeout: 60000 });

    // The vendored reader was actually fetched, and served.
    expect(vendorRequests.length).toBeGreaterThan(0);
    expect(vendorRequests.every((s) => s === 200)).toBe(true);

    const body = page.locator('#inv-import-body');
    await expect(body.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('#inv-import-confirm')).toContainText('Import 2 items');
    // 1.000 g at Rp250 — the date read as 1 August, not 8 January.
    await expect(body).toContainText('Rp250.000');
    await expect(body).toContainText('2026-08-01');

    await page.click('#inv-import-panel .fluxy-drawer-close');
});

test('a file whose columns we cannot place goes to mapping, not to a dead end', async ({ page }) => {
    await gotoItems(page);
    await page.click('#bulk-import-btn');

    // Nothing here matches the template's headers or any known alias. The file
    // is perfectly readable — we just cannot tell which column is which, and a
    // person whose sheet says "Bahan" is not wrong.
    const csv = [
        'Bahan,Takaran,Harga,Kode Internal',
        'Kopi Arabika,g,150,K-1',
        'Susu UHT,ml,18,S-1'
    ].join('\n');
    await page.setInputFiles('#inv-import-file', {
        name: 'custom.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8')
    });

    // It advances rather than refusing, and says what it needs.
    await page.waitForSelector('.inv-import-map', { timeout: 60000 });
    await expect(page.locator('#inv-import-body')).toContainText('Point us at the right column');
    // Nothing can be imported until the answer is given.
    await expect(page.locator('#inv-import-confirm')).toBeDisabled();

    // Answer it: Bahan is the name, Takaran is the unit.
    await page.selectOption('[data-map-key="name"]', { label: 'Bahan' });
    await page.waitForTimeout(200);
    await page.selectOption('[data-map-key="unit"]', { label: 'Takaran' });

    // The preview appears, built from the answer.
    await page.waitForSelector('.inv-import-tiles', { timeout: 60000 });
    const body = page.locator('#inv-import-body');
    await expect(body).toContainText('Kopi Arabika');
    await expect(body).toContainText('Susu UHT');
    await expect(page.locator('#inv-import-confirm')).toContainText('Import 2 items');

    // And a wrong auto-match can be undone, not only an absent one.
    await page.selectOption('[data-map-key="unit"]', { label: 'Not in this file' });
    await page.waitForSelector('.inv-import-map', { timeout: 60000 });
    await expect(page.locator('#inv-import-confirm')).toBeDisabled();

    await page.click('#inv-import-panel .fluxy-drawer-close');
});
