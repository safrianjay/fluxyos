// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

/**
 * Sales-deck screenshot capture harness (throwaway, not a regression suite).
 *
 * Drives the live QA workspace (authenticated + seeded via storageState) and
 * captures 3-4 real in-app states per feature for the GTM sales deck — page
 * heroes, drawers, tabs, drill-downs, and charts. Dashboard/app focused.
 *
 * Output: test-results/sales-deck/<name>.png
 * Run:    npx playwright test sales-deck-shots
 */

const DIR = 'test-results/sales-deck';
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function suppressChrome(page) {
    await page.addStyleTag({
        content: [
            '[data-fluxy-paywall]{display:none!important;pointer-events:none!important;}',
            '.fluxy-tour-overlay,.fluxy-tour-popover{display:none!important;pointer-events:none!important;}',
            '.fluxy-tour-highlight{box-shadow:none!important;outline:none!important;}',
            '.platform-learning-section{display:none!important;}',
        ].join('')
    }).catch(() => {});
}
async function stopTours(page) {
    await page.addInitScript(() => {
        try { sessionStorage.removeItem('fluxy_pending_tour'); sessionStorage.removeItem('fluxy_pending_tours'); } catch (e) {}
    });
}
async function open(page, path) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sidebar', { timeout: 20000 });
    await suppressChrome(page);
    await page.waitForTimeout(3200);
    await suppressChrome(page);
}
async function shot(page, name) {
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
}
async function elshot(page, name, selector) {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await el.screenshot({ path: `${DIR}/${name}.png` });
}
function guard(results, name, fn) {
    return fn().then(() => results.ok.push(name))
               .catch(e => results.failed.push({ name, error: String(e).slice(0, 160) }));
}

test.describe('Sales deck — multi-state capture', () => {

    test('Overview / Command Center', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/dashboard.html');
        await guard(r, 'overview-kpis', async () => shot(page, 'overview-kpis'));
        await guard(r, 'overview-trend', async () => elshot(page, 'overview-trend', '.overview-chart-panel'));
        await open(page, '/revenue-overview.html');
        await guard(r, 'revenue-drill', async () => shot(page, 'revenue-drill'));
        await open(page, '/cash-position.html');
        await guard(r, 'cash-drill', async () => shot(page, 'cash-drill'));
        console.log('[overview]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Fluxy AI', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/ai.html');
        await guard(r, 'ai-home', async () => shot(page, 'ai-home'));
        await guard(r, 'ai-prompts', async () => elshot(page, 'ai-prompts', '#ai-prompt-section'));
        await open(page, '/settings-ai.html');
        await guard(r, 'ai-settings', async () => shot(page, 'ai-settings'));
        console.log('[ai]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Ledger + Receipt Capture', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/ledger.html');
        await guard(r, 'ledger-table', async () => shot(page, 'ledger-table'));
        await guard(r, 'ledger-filters', async () => {
            await page.click('#ledger-filter-trigger');
            await page.waitForSelector('#ledger-filter-panel', { state: 'visible', timeout: 5000 });
            await page.waitForTimeout(500);
            await shot(page, 'ledger-filters');
            await page.keyboard.press('Escape').catch(() => {});
        });
        await guard(r, 'ledger-scan', async () => {
            await page.click('#scan-tx-btn');
            await page.waitForSelector('#scan-drawer', { state: 'visible', timeout: 5000 });
            await page.waitForTimeout(700);
            await suppressChrome(page);
            await shot(page, 'ledger-scan');
            await page.click('#scan-drawer-close-btn').catch(() => {});
        });
        await guard(r, 'ledger-add', async () => {
            await page.waitForTimeout(400);
            await page.click('[data-tour-target="ledger-add-transaction"]');
            await page.waitForSelector('#tx-amount', { state: 'visible', timeout: 5000 });
            await page.waitForTimeout(700);
            await shot(page, 'ledger-add');
        });
        console.log('[ledger]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Revenue Sync', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/revenue-sync.html');
        await guard(r, 'revsync-summary', async () => shot(page, 'revsync-summary'));
        await guard(r, 'revsync-volume', async () => elshot(page, 'revsync-volume', '#revenue-activity-volume'));
        await guard(r, 'revsync-table', async () => elshot(page, 'revsync-table', '#revenue-table-container'));
        console.log('[revsync]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Bills', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/bill.html');
        await guard(r, 'bills-list', async () => shot(page, 'bills-list'));
        await guard(r, 'bills-timeline', async () => elshot(page, 'bills-timeline', '#bill-timeline'));
        await guard(r, 'bills-add', async () => {
            await page.click('[data-tour-target="bill-add"]');
            await page.waitForSelector('#tx-amount', { state: 'visible', timeout: 5000 });
            await page.waitForTimeout(700);
            await shot(page, 'bills-add');
        });
        console.log('[bills]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Invoices', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/invoices.html');
        await guard(r, 'invoices-list', async () => shot(page, 'invoices-list'));
        await guard(r, 'invoices-create', async () => {
            await page.click('#invoice-create-btn');
            await page.waitForTimeout(1200);
            await suppressChrome(page);
            await shot(page, 'invoices-create');
        });
        await guard(r, 'invoices-detail', async () => {
            await open(page, '/invoices.html');
            await page.locator('#invoice-table-body tr').first().click({ timeout: 5000 });
            await page.waitForTimeout(1200);
            await suppressChrome(page);
            await shot(page, 'invoices-detail');
        });
        console.log('[invoices]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Accounting', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/accounting.html');
        await guard(r, 'acct-income', async () => shot(page, 'acct-income'));
        for (const [name, tab] of [['acct-ledger', 'ledger'], ['acct-trial', 'trial'], ['acct-coa', 'coa'], ['acct-aging', 'aging']]) {
            await guard(r, name, async () => {
                await openAccountingTab(page, tab);
                await page.waitForTimeout(900);
                await shot(page, name);
            });
        }
        await guard(r, 'balance-sheet', async () => {
            await openAccountingTab(page, 'balance');
            await page.waitForTimeout(900);
            await shot(page, 'balance-sheet');
        });
        console.log('[accounting]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Budgets', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/budget.html');
        await guard(r, 'budget-main', async () => shot(page, 'budget-main'));
        await guard(r, 'budget-period', async () => {
            const row = page.locator('#budget-period-body tr[data-action="open-period-detail"]').first();
            if (await row.count()) {
                await row.click();
                await page.waitForFunction(() => {
                    const c = document.getElementById('budget-content');
                    return c && !c.classList.contains('hidden');
                }, { timeout: 12000 });
                await page.waitForTimeout(1200);
                await suppressChrome(page);
                await shot(page, 'budget-period');
                await guard(r, 'budget-alloc', async () => elshot(page, 'budget-alloc', '#budget-alloc-body'));
            } else { throw new Error('no period rows'); }
        });
        console.log('[budget]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Tax Center', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/tax-center.html');
        await guard(r, 'tax-overview', async () => shot(page, 'tax-overview'));
        for (const [name, tab] of [['tax-ppn', 'ppn'], ['tax-profile', 'profile']]) {
            await guard(r, name, async () => {
                await page.click(`[data-tax-tab="${tab}"]`);
                await page.waitForTimeout(900);
                await shot(page, name);
            });
        }
        console.log('[tax]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Integrations', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await stopTours(page);
        await open(page, '/integration.html');
        await guard(r, 'integration-commerce', async () => shot(page, 'integration-commerce'));
        await guard(r, 'integration-payment', async () => {
            await page.click('[data-category="payment"]');
            await page.waitForTimeout(800);
            await shot(page, 'integration-payment');
        });
        console.log('[integration]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });

    test('Localization (ID)', async ({ page }) => {
        const r = { ok: [], failed: [] };
        await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));
        await stopTours(page);
        await open(page, '/dashboard.html');
        await guard(r, 'dashboard-id', async () => shot(page, 'dashboard-id'));
        await open(page, '/accounting.html');
        await guard(r, 'accounting-id', async () => shot(page, 'accounting-id'));
        console.log('[localization]', JSON.stringify(r));
        expect(r.ok.length).toBeGreaterThan(0);
    });
});
