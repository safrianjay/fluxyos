// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Integration Center smoke (Phase 2 — Commerce Integration Platform).
 *
 * The page is rebuilt on the standard app shell with live commerce_accounts
 * binding. This spec proves, against the real project (QA account via
 * storageState, EN pinned by setup-auth):
 *   - shell + sidebar render, zero page errors
 *   - the Commerce tab shows the 3 platform cards (default "Not connected"
 *     when the QA workspace has no connected accounts)
 *   - category tabs switch panels; coming-soon categories render provider
 *     chips with a Coming soon badge and NO buttons (no dead actions)
 *   - the connect action exists for a managing role (QA account = owner)
 *
 * Backend (/api/v1/commerce/*) is Phase 3 — no connect flow is exercised.
 */

test('integration center renders shell, cards, and tabs', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/integration.html');
    await expect(page).toHaveTitle('FluxyOS | Integrations', { timeout: 20000 });

    // App shell (D6 layout regression contract)
    await expect(page.locator('.fluxy-page-shell .fluxy-page-canvas')).toHaveCount(1);
    await expect(page.locator('.integrations-shell')).toBeVisible();
    await expect(page.locator('#sidebar')).toContainText('Integrations', { timeout: 15000 });

    // Commerce cards replace the skeletons (live snapshot or 4s fallback).
    const cards = page.locator('[data-platform-card]');
    await expect(cards).toHaveCount(3, { timeout: 20000 });
    await expect(page.locator('[data-platform-card="tiktok_shop"]')).toContainText('TikTok Shop');
    await expect(page.locator('[data-platform-card="shopee"]')).toContainText('Shopee');
    await expect(page.locator('[data-platform-card="tokopedia"]')).toContainText('Tokopedia');
    await expect(page.locator('[data-commerce-skeleton]')).toHaveCount(0);

    // QA account is the workspace owner → managing role → Connect buttons
    // (unless an account is already connected, then Manage appears instead).
    const tiktokCard = page.locator('[data-platform-card="tiktok_shop"]');
    await expect(tiktokCard.locator('button')).not.toHaveCount(0);

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('category tabs switch panels; coming-soon panels have no dead buttons', async ({ page }) => {
    await page.goto('/integration.html');
    // The tab strip is static HTML, but its click handlers attach in
    // initIntegrationPage (post-auth). Rendered platform cards prove init ran.
    await expect(page.locator('[data-platform-card]')).toHaveCount(3, { timeout: 20000 });

    // Commerce visible by default, others hidden.
    await expect(page.locator('[data-category-panel="commerce"]')).toBeVisible();
    await expect(page.locator('[data-category-panel="payment"]')).toBeHidden();

    for (const category of ['payment', 'accounting', 'bank', 'marketing', 'communication']) {
        await page.locator(`#integration-tabs [data-category="${category}"]`).click();
        const panel = page.locator(`[data-category-panel="${category}"]`);
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-category-panel="commerce"]')).toBeHidden();
        // Coming soon badge + provider chips, and NO buttons anywhere in the panel.
        await expect(panel).toContainText('Coming soon');
        await expect(panel.locator('[data-provider-chips] span').first()).toBeVisible();
        await expect(panel.locator('button')).toHaveCount(0);
    }

    // Back to Commerce.
    await page.locator('#integration-tabs [data-category="commerce"]').click();
    await expect(page.locator('[data-category-panel="commerce"]')).toBeVisible();
});
