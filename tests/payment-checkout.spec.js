const { test, expect } = require('@playwright/test');

const browserIssues = new WeakMap();

test.beforeEach(async ({ page }) => {
    const issues = [];
    browserIssues.set(page, issues);
    page.on('console', message => {
        if (message.type() === 'error') issues.push(`console: ${message.text()}`);
    });
    page.on('pageerror', error => issues.push(`pageerror: ${error.message}`));
    page.on('response', response => {
        const url = new URL(response.url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) && response.status() >= 400) {
            issues.push(`local ${response.status()}: ${response.url()}`);
        }
    });
});

test.afterEach(async ({ page }) => {
    expect(browserIssues.get(page)).toEqual([]);
});

test.describe('authenticated checkout UI', () => {
    test('pricing toggle rewrites each checkout CTA', async ({ page }) => {
        await page.goto('/pricing');
        await expect(page.locator('[data-checkout-plan="core"]')).toHaveAttribute('href', '/checkout?plan=core&billing=annually');
        await expect(page.locator('[data-checkout-plan="growth"]')).toHaveAttribute('href', '/checkout?plan=growth&billing=annually');
        await expect(page.locator('[data-checkout-plan="enterprise"]')).toHaveAttribute('href', '/checkout?plan=enterprise&billing=annually');

        await page.locator('#billing-toggle').click();
        await expect(page.locator('[data-checkout-plan="core"]')).toHaveAttribute('href', '/checkout?plan=core&billing=monthly');
        await expect(page.locator('[data-checkout-plan="growth"]')).toHaveAttribute('href', '/checkout?plan=growth&billing=monthly');
        await expect(page.locator('[data-checkout-plan="enterprise"]')).toHaveAttribute('href', '/checkout?plan=enterprise&billing=monthly');
    });

    test('checkout switches package, billing, and metadata-only method panels', async ({ page }, testInfo) => {
        await page.goto('/checkout?plan=growth&billing=annually');
        const shell = await page.locator('.checkout-shell').evaluate(element => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                left: box.left,
                top: box.top,
                width: box.width,
                minHeight: style.minHeight,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow
            };
        });
        expect(shell).toEqual({
            left: 0,
            top: 0,
            width: 1280,
            minHeight: '720px',
            borderRadius: '0px',
            boxShadow: 'none'
        });
        await expect(page.locator('#summary-plan-name')).toHaveText('Growth Engine');
        await expect(page.locator('#subtotal')).toHaveText('Rp 81.480.000');
        await expect(page.locator('#tax')).toHaveText('Rp 8.962.800');
        await expect(page.locator('#total-due')).toHaveText('Rp 90.442.800');

        await page.locator('[data-plan="core"]').click();
        await page.locator('[data-billing="monthly"]').click();
        await expect(page).toHaveURL(/\/checkout\?plan=core&billing=monthly$/);
        await expect(page.locator('#summary-plan-name')).toHaveText('Core Ops');
        await expect(page.locator('#total-due')).toHaveText('Rp 3.885.000');

        await page.locator('[data-method="card"]').click();
        await expect(page.locator('[data-payment-panel="card"]')).toContainText('never collects card number, CVC, or OTP');
        await expect(page.locator('input')).toHaveCount(0);
        await expect(page.locator('select')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('checkout-desktop.png'), fullPage: true });
    });

    test('trial banner keeps the original visual treatment and upgrades directly to checkout', async ({ page }) => {
        await page.goto('/dashboard');
        const banner = page.locator('[data-fluxy-trial-banner]');
        await expect(banner).toBeVisible();
        await expect(banner.locator('.fluxy-trial-banner__cta')).toHaveAttribute('href', '/checkout?plan=growth&billing=annually');
        await expect(banner).toHaveCSS('background-image', 'linear-gradient(90deg, rgb(255, 247, 237) 0%, rgb(255, 241, 224) 55%, rgb(255, 230, 204) 100%)');
        await expect(banner.locator('.fluxy-trial-banner__icon')).toHaveCSS('color', 'rgb(255, 255, 255)');
    });

    test('invalid query falls back safely and mobile layout does not overflow', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 375, height: 900 });
        await page.goto('/checkout?plan=invalid&billing=weekly');
        await expect(page).toHaveURL(/\/checkout\?plan=growth&billing=annually$/);
        await expect(page.locator('#summary-plan-name')).toHaveText('Growth Engine');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('checkout-mobile.png'), fullPage: true });
    });

    test('legacy payment page redirects to pricing', async ({ page }) => {
        await page.goto('/payment.html');
        await expect(page).toHaveURL(/\/pricing$/);
    });
});

test.describe('guest billing routes', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('checkout redirects logged-out users to login', async ({ page }) => {
        await page.goto('/checkout');
        await expect(page).toHaveURL(/\/login$/, { timeout: 5000 });
    });

    test('payment pending redirects logged-out users to login', async ({ page }) => {
        await page.goto('/payment-pending');
        await expect(page).toHaveURL(/\/login$/, { timeout: 5000 });
    });
});
