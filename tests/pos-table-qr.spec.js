const { test, expect } = require('@playwright/test');

// =============================================================================
// The till can produce the cards a restaurant puts on its tables.
//
// This surface is the missing half of customer ordering: `pos_tables.qr_token`
// has been minted since the POS shipped and `order.fluxyos.com` renders the
// menu it points at, but nothing ever DISPLAYED it — the feature was complete
// and unreachable by a diner.
//
// THE ENDPOINT IS STUBBED, the layout is not. What is worth asserting in a
// browser is the physical result: that a card is the size the error-correction
// level was chosen against, and that printing produces cards rather than a
// screenshot of the till. `tests/pos-table-qr.check.js` covers the other half —
// that the symbol itself decodes, verified by Apple's Vision framework.
// =============================================================================

// A real 41x41 symbol, produced by the same `qrcode` call the function makes,
// so the on-screen measurements below are of the real artefact.
const { execFileSync } = require('child_process');
const path = require('path');

const CARD_URL = 'https://order.fluxyos.com/t/qeawOAYXbotmBvtICayrt0g-3mvPaBekO8-Ifj5wwm8';
const SVG = execFileSync('node', ['-e', `
    const QRCode = require('${path.join(__dirname, '..', 'node_modules/qrcode')}');
    QRCode.toString(${JSON.stringify(CARD_URL)}, {
        type: 'svg', errorCorrectionLevel: 'Q', margin: 4,
        color: { dark: '#0B0F19', light: '#FFFFFF' }
    }).then((s) => process.stdout.write(s));
`], { encoding: 'utf8' });

const RESPONSE = {
    error_correction: 'Q',
    missing_token: 0,
    cards: [
        { table_id: 't1', label: 'A01', zone: 'Teras', url: CARD_URL, svg: SVG },
        { table_id: 't2', label: 'A02', zone: null, url: CARD_URL, svg: SVG }
    ]
};

// Two tables, seeded through the till's own test seam. The QA workspace's
// outlets may hold no tables at all, and a spec that is green because the floor
// was empty is indistinguishable from one that passed.
const TABLES = [
    { id: 't1', label: 'A01', zone: 'Teras', dimension_id: 'qa', seats: 4, status: 'active' },
    { id: 't2', label: 'A02', zone: null, dimension_id: 'qa', seats: 2, status: 'active' }
];

async function openTill(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25_000 });
    // The till's own readiness signal — enabled at the end of the first
    // refresh(). Seeding before that lands freezes a half-painted page.
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 40_000 });
    await page.click('#nav-container [data-view="tables"]');
    await expect(page.locator('.pos-view[data-view="tables"]')).toBeVisible();
    await page.evaluate((tables) => window.__posSeedFloor(tables, []), TABLES);
}

async function openSheet(page, body = RESPONSE) {
    await page.route('**/pos-table-qr', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body)
    }));
    await openTill(page);
    // The button lives on the floor-plan bar and is gated on `pos.manage` — the
    // same capability as re-laying the room.
    const btn = page.locator('#pos-qr-btn');
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await btn.click();
    await expect(page.locator('#pos-qr-sheet')).toBeVisible();
}

test.describe('POS table QR codes', () => {
    test('a cashier-visible button opens a sheet of real cards', async ({ page }) => {
        await openSheet(page);

        const cards = page.locator('.pos-qr-card');
        await expect(cards).toHaveCount(2);
        await expect(cards.first().locator('.pos-qr-label')).toHaveText('A01');
        // The symbol is inlined as SVG, not an <img> — nothing to 404, nothing
        // to load, and it prints at whatever resolution the printer has.
        await expect(cards.first().locator('.pos-qr-img svg')).toBeVisible();
        await expect(cards.nth(1).locator('.pos-qr-label')).toHaveText('A02');
        // The zone is shown when there is one and omitted when there is not.
        await expect(cards.first().locator('.pos-qr-zone')).toHaveText('Teras');
        await expect(cards.nth(1).locator('.pos-qr-zone')).toHaveCount(0);
    });

    test('THE CARD IS THE PHYSICAL SIZE THE SYMBOL WAS DESIGNED FOR', async ({ page }) => {
        await openSheet(page);

        // 40mm at 96dpi is ~151px. The error-correction level (Q, not H) was
        // chosen against a 40mm card: 41x41 modules is 0.82mm per module, which
        // a phone reads at arm's length in restaurant lighting. Shrinking this
        // box silently makes every printed card harder to scan, and nothing
        // else in the system would notice.
        const box = await page.locator('.pos-qr-img').first().boundingBox();
        const mm = box.width / (96 / 25.4);
        expect(mm).toBeGreaterThan(38);
        expect(mm).toBeLessThan(42);
        // Square, or the symbol is distorted and stops decoding.
        expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    });

    test('printing produces cards, not a screenshot of the till', async ({ page }) => {
        await openSheet(page);
        await page.emulateMedia({ media: 'print' });

        // The app shell must be gone. A print that includes the sidebar wastes
        // the page and puts a cashier's screen on paper.
        await expect(page.locator('#sidebar')).toBeHidden();
        await expect(page.locator('.pos-qr-bar')).toBeHidden();
        // The cards must survive.
        await expect(page.locator('.pos-qr-card')).toHaveCount(2);
        await expect(page.locator('.pos-qr-img svg').first()).toBeVisible();

        // A card must never be split across two pages — half a QR is not a QR.
        const breakInside = await page.locator('.pos-qr-card').first()
            .evaluate((el) => getComputedStyle(el).breakInside);
        expect(breakInside).toBe('avoid');

        await page.emulateMedia({ media: 'screen' });
    });

    test('tables with no code are declared, not quietly dropped', async ({ page }) => {
        await openSheet(page, { ...RESPONSE, missing_token: 2 });
        // A restaurant counting cards against tables would otherwise find the
        // gap at the worst possible moment.
        const note = page.locator('.pos-qr-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('2 tables');
        // …and the note is for the screen only; it must not print on a card sheet.
        await page.emulateMedia({ media: 'print' });
        await expect(note).toBeHidden();
        await page.emulateMedia({ media: 'screen' });
    });

    test('a refusal is explained, not swallowed', async ({ page }) => {
        await page.route('**/pos-table-qr', (route) => route.fulfill({
            status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' })
        }));
        await openTill(page);
        const btn = page.locator('#pos-qr-btn');
        await expect(btn).toBeVisible({ timeout: 30_000 });
        await btn.click();
        await expect(page.locator('#pos-qr-body')).toContainText('permission');
    });

    test('the sheet closes and leaves the till usable', async ({ page }) => {
        await openSheet(page);
        await page.locator('#pos-qr-close').click();
        await expect(page.locator('#pos-qr-sheet')).toBeHidden();
        await expect(page.locator('#pos-tables')).toBeVisible();
    });
});
