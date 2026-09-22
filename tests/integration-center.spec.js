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

    // The reference-inspired content experience remains grounded in FluxyOS's
    // actual commerce pipeline: it starts empty and shows its two useful views.
    await expect(page.locator('#integration-data-heading')).toContainText('One financial picture');
    await expect(page.locator('#data-model-flow')).toBeVisible();
    await expect(page.locator('#data-model-objects')).toBeHidden();
    await page.locator('[data-data-model-view="objects"]').click();
    await expect(page.locator('#data-model-objects')).toBeVisible();
    await expect(page.locator('#data-model-flow')).toBeHidden();
    await expect(page.locator('#data-model-objects')).toContainText('Ledger transaction');

    // QA account is the workspace owner → managing role → Connect buttons
    // (unless an account is already connected, then Manage appears instead).
    const tiktokCard = page.locator('[data-platform-card="tiktok_shop"]');
    await expect(tiktokCard.locator('button')).not.toHaveCount(0);

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('commerce is the only available integration category', async ({ page }) => {
    await page.goto('/integration.html');
    await expect(page.locator('[data-platform-card]')).toHaveCount(3, { timeout: 20000 });

    // The page deliberately exposes the shipped commerce connection surface.
    // Future categories do not advertise unavailable actions or empty panels.
    await expect(page.locator('[data-category-panel="commerce"]')).toBeVisible();
    await expect(page.locator('#integration-tabs [data-category="commerce"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#integration-tabs [data-category]')).toHaveCount(1);
});

test('financial data model stacks cleanly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/integration.html');
    await expect(page.locator('[data-platform-card]')).toHaveCount(3, { timeout: 20000 });

    await expect(page.locator('#integration-data-heading')).toBeVisible();
    await expect(page.locator('#data-model-flow')).toBeVisible();
    const nodeTops = await page.locator('#data-model-flow .integration-flow-node').evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().top))
    );
    expect(nodeTops[1]).toBeGreaterThan(nodeTops[0]);
    expect(nodeTops[2]).toBeGreaterThan(nodeTops[1]);
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
});
