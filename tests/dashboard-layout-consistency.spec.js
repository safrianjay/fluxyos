// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Dashboard Content Width Standard.
 *
 * Transactions, Revenue Sync, and Bills are the baseline. Every data-heavy
 * operational page must use the shared dashboard content container
 * (`.fluxy-page-shell` → `.fluxy-page-canvas`, 1540px), so content width and
 * left/right edges match across the platform. This verifies Budgets, Invoices,
 * and the budget management views align to the reference, and that no page
 * introduces horizontal overflow at desktop or mobile.
 */

const REFERENCE = ['/ledger.html', '/revenue-sync.html', '/bill.html'];
const MIGRATED = ['/budget.html', '/invoices.html', '/budget-period.html', '/budget-allocation.html'];
const ALL = [...REFERENCE, ...MIGRATED];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function canvasWidth(page, url) {
    await page.goto(url);
    await page.waitForSelector('.fluxy-page-canvas', { timeout: 20_000 });
    return page.evaluate(() => {
        const canvas = document.querySelector('.fluxy-page-canvas');
        const shell = document.querySelector('.fluxy-page-shell');
        const root = document.documentElement;
        return {
            hasCanvas: !!canvas,
            hasShell: !!shell,
            canvasWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
            overflow: root.scrollWidth - root.clientWidth
        };
    });
}

test('every data-heavy page uses the shared 1540px canvas at the same width (desktop)', async ({ page }) => {
    // Wide enough that the 1540px cap engages (sidebar 220 + padding 64 + 1540).
    await page.setViewportSize({ width: 1920, height: 1080 });

    const widths = {};
    for (const url of ALL) {
        const m = await canvasWidth(page, url);
        expect(m.hasShell, `${url} must use .fluxy-page-shell`).toBeTruthy();
        expect(m.hasCanvas, `${url} must use .fluxy-page-canvas`).toBeTruthy();
        expect(m.overflow, `${url} must not create horizontal page overflow`).toBeLessThanOrEqual(1);
        widths[url] = m.canvasWidth;
    }

    // Every page's canvas must match the Transactions baseline exactly.
    const baseline = widths['/ledger.html'];
    expect(baseline, 'baseline canvas width should be the 1540px cap').toBeGreaterThan(1400);
    for (const url of ALL) {
        expect(Math.abs(widths[url] - baseline), `${url} canvas width (${widths[url]}) must match Transactions (${baseline})`).toBeLessThanOrEqual(1);
    }
});

test('migrated pages have no horizontal overflow at mobile (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const url of MIGRATED) {
        const m = await canvasWidth(page, url);
        expect(m.overflow, `${url} must not overflow horizontally at 375px`).toBeLessThanOrEqual(1);
    }
});
