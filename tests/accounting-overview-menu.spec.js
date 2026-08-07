// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Overview moved out of the section nav and into a header dropdown, replacing
// the Export package button (docs/ACCOUNTING_CENTER_IA.md §Overview).
//
// The move has three ways to go wrong that a smoke test would not catch:
//
//  1. Export package had exactly one entry point — that button. If it is not
//     re-homed in the panel footer, a shipped feature becomes unreachable.
//  2. Books health reads the kernel (trial balance, unposted, period status),
//     which used to load as a side effect of Overview being in KERNEL_TABS.
//     A panel that renders "Loading…" forever is the failure mode.
//  3. Closed by default, the panel hides every blocker it used to show on the
//     landing tab. The attention dot is the only thing that still advertises
//     them, so it is behaviour, not decoration.

const PANEL = '#acct-overview-panel';

async function openAccounting(page) {
    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });
}

test('the header exposes Overview, and Export package is not lost', async ({ page }) => {
    await openAccounting(page);

    const btn = page.locator('#acct-overview-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(PANEL)).toBeHidden();

    // The old tab is gone from both nav rows.
    await expect(page.locator('[data-acct-group="overview"]')).toHaveCount(0);
    await expect(page.locator('[data-acct-tab="overview"]')).toHaveCount(0);

    await btn.click();
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');

    // Both overview cards moved across intact.
    await expect(page.locator('#overview-health')).toBeVisible();
    await expect(page.locator('#overview-actions')).toBeVisible();

    // Export package survives the button it used to own, inside the panel.
    await expect(page.locator('#acct-export-package')).toBeVisible();
});

test('Books health resolves — the kernel still loads without an Overview tab', async ({ page }) => {
    await openAccounting(page);
    await page.locator('#acct-overview-btn').click();

    // The trial-balance row starts at "Loading…" and must resolve on its own:
    // nothing else on the default (Income Statement) landing pulls the kernel.
    await expect(page.locator('#overview-health')).toContainText(/Trial balance/i);
    await expect(page.locator('#overview-health')).not.toContainText(/Loading…/, { timeout: 45000 });
});

test('closes on outside click, on Escape, and when a row navigates away', async ({ page }) => {
    await openAccounting(page);
    const btn = page.locator('#acct-overview-btn');

    await btn.click();
    await expect(page.locator(PANEL)).toBeVisible();
    await page.locator('.dashboard-topbar-title').click();
    await expect(page.locator(PANEL)).toBeHidden();

    await btn.click();
    await expect(page.locator(PANEL)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(PANEL)).toBeHidden();

    // Rows are shortcuts to the view that fixes them; the panel must get out of
    // the way rather than cover the thing the reader just asked for.
    await btn.click();
    await expect(page.locator(PANEL)).toBeVisible();
    const row = page.locator('#overview-health [data-overview-go]').first();
    const target = await row.getAttribute('data-overview-go');
    await row.click();
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator(`[data-acct-panel="${target}"]`)).toBeVisible();
});

test('the attention dot reports what the panel would show', async ({ page }) => {
    await openAccounting(page);
    await page.locator('#acct-overview-btn').click();
    await expect(page.locator('#overview-health')).not.toContainText(/Loading…/, { timeout: 45000 });

    const state = await page.evaluate(() => ({
        dotShown: !document.getElementById('acct-overview-dot').classList.contains('hidden'),
        // "Check" is the bad-state label in healthRow(); cleanup/unposted rows
        // render in the actions table.
        problems: /Check/.test(document.getElementById('overview-health').innerText)
            || /blocks closing|to review/.test(document.getElementById('overview-actions').innerText)
    }));
    // Whatever this workspace's data happens to be, the dot must agree with it —
    // asserting a fixed value would only encode today's QA fixtures.
    expect(state.dotShown, `dot=${state.dotShown} but problems=${state.problems}`).toBe(state.problems);
});

test('the panel stays on screen at 375px and never widens the page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openAccounting(page);
    await page.locator('#acct-overview-btn').click();
    await expect(page.locator(PANEL)).toBeVisible();

    const box = await page.locator(PANEL).boundingBox();
    expect(box.x, 'panel runs off the left edge').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'panel runs off the right edge').toBeLessThanOrEqual(375 + 1);

    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'open panel makes the page scroll horizontally').toBeLessThanOrEqual(1);
});

test('?tab=overview still lands somewhere useful', async ({ page }) => {
    // The app shipped this URL as a real view, and its own health rows linked to
    // it. Honour the intent instead of dropping the reader on a statement.
    await page.goto('/accounting.html?tab=overview');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator('[data-acct-panel="income"]')).toBeVisible();
});

test('the section nav still works with Overview removed', async ({ page }) => {
    await openAccounting(page);
    // Reports is the landing group now that Overview no longer holds the slot.
    await expect(page.locator('[data-acct-group="reports"]')).toHaveClass(/is-active/);
    await expect(page.locator('[data-acct-panel="income"]')).toBeVisible();

    await openAccountingTab(page, 'trial');
    await expect(page.locator('[data-acct-panel="trial"]')).toBeVisible();
});
