const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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
    test('pricing toggle rewrites each self-serve CTA; enterprise is sales-led', async ({ page }) => {
        await page.goto('/pricing');
        await expect(page.locator('[data-checkout-plan="starter"]')).toHaveAttribute('href', '/checkout?plan=starter&billing=annually');
        await expect(page.locator('[data-checkout-plan="core"]')).toHaveAttribute('href', '/checkout?plan=core&billing=annually');
        await expect(page.locator('[data-checkout-plan="growth"]')).toHaveAttribute('href', '/checkout?plan=growth&billing=annually');
        // Enterprise AI is sales-led: no checkout CTA, a Contact Sales link instead.
        // (:not(.footer-link) — the marketing footer carries its own Contact Sales link.)
        await expect(page.locator('[data-checkout-plan="enterprise"]')).toHaveCount(0);
        await expect(page.locator('a[href="/contact-sales"]:not(.footer-link)')).toContainText('Contact Sales');

        await page.locator('#billing-toggle').click();
        await expect(page.locator('[data-checkout-plan="starter"]')).toHaveAttribute('href', '/checkout?plan=starter&billing=monthly');
        await expect(page.locator('[data-checkout-plan="core"]')).toHaveAttribute('href', '/checkout?plan=core&billing=monthly');
        await expect(page.locator('[data-checkout-plan="growth"]')).toHaveAttribute('href', '/checkout?plan=growth&billing=monthly');
    });

    test('checkout switches package, billing, and metadata-only method panels', async ({ page }, testInfo) => {
        await page.goto('/checkout?plan=growth&billing=annually');
        await expect(page.locator('.back-link')).toContainText('Back to dashboard');
        await expect(page.locator('.back-link')).toHaveAttribute('href', '/dashboard');
        await expect(page.locator('.plan-logo')).toHaveAttribute('src', 'assets/images/favicon.svg');
        await expect(page.locator('.plan-logo')).toHaveAttribute('alt', 'FluxyOS');
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
        await expect(page.locator('#subtotal')).toHaveText('Rp67.080.000');
        await expect(page.locator('#tax')).toHaveText('Rp7.378.800');
        await expect(page.locator('#total-due')).toHaveText('Rp74.458.800');
        await expect(page.locator('.trust-row')).toContainText('Total amount to pay');
        await expect(page.locator('#checkout-payable-total')).toHaveText('Rp74.458.800');

        await page.locator('[data-plan="core"]').click();
        await page.locator('[data-billing="monthly"]').click();
        await expect(page).toHaveURL(/\/checkout\?plan=core&billing=monthly$/);
        await expect(page.locator('#summary-plan-name')).toHaveText('Core Ops');
        await expect(page.locator('#total-due')).toHaveText('Rp3.873.900');
        await expect(page.locator('#checkout-payable-total')).toHaveText('Rp3.873.900');

        await page.locator('[data-method="card"]').click();
        await expect(page.locator('[data-payment-panel="card"]')).toContainText('never collects card number, CVC, or OTP');
        // The voucher code input is the only input on the page — payment
        // sections stay metadata-only (no card number/CVC/OTP fields).
        await expect(page.locator('.payment-box input, .payment-methods input')).toHaveCount(0);
        await expect(page.locator('input')).toHaveCount(1);
        await expect(page.locator('input')).toHaveAttribute('id', 'voucher-input');
        await expect(page.locator('select')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('checkout-desktop.png'), fullPage: true });
    });

    test('trial banner keeps the original visual treatment and upgrades directly to checkout', async ({ page }) => {
        await page.goto('/dashboard');
        // Banner visibility follows the QA account's live billing state
        // (trial-access.js publishes it on window.__fluxyAccessState).
        await page.waitForFunction(() => !!window.__fluxyAccessState, { timeout: 15000 });
        const state = await page.evaluate(() => {
            const s = window.__fluxyAccessState;
            return {
                showBanner: s.showBanner, isBlocked: s.isBlocked,
                isTrialActive: s.isTrialActive, isTrialExpiring: s.isTrialExpiring,
                ctaRoute: s.ctaRoute, subscriptionStatus: s.subscriptionStatus
            };
        });
        console.log('[trial-banner] access state:', state);
        const banner = page.locator('[data-fluxy-trial-banner]');
        if (!state.showBanner || state.isBlocked) {
            // Active paid account (or hard paywall): the slim banner must not render.
            await expect(banner).toHaveCount(0);
            return;
        }
        await expect(banner).toBeVisible();
        if (state.isTrialActive || state.isTrialExpiring) {
            await expect(banner.locator('.fluxy-trial-banner__cta')).toHaveAttribute('href', state.ctaRoute);
        }
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

test.describe('billing internal mirror wiring', () => {
    test('canonical billing writes refresh the internal dashboard index', async () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'assets/js/db-service.js'), 'utf8');
        const createPaymentRequest = source.slice(
            source.indexOf('async createPaymentRequest'),
            source.indexOf('async getPaymentRequestById')
        );
        const submitPaymentRequestForVerification = source.slice(
            source.indexOf('async submitPaymentRequestForVerification'),
            source.indexOf('async getLatestPaymentRequest')
        );

        expect(createPaymentRequest).toContain('syncInternalUserBillingSubscriptionIndex');
        expect(submitPaymentRequestForVerification).toContain('syncInternalUserBillingSubscriptionIndex');
        expect(source).toContain('async syncInternalUserBillingSubscriptionIndex');
        expect(source).toContain("status === 'awaiting_payment'");
        expect(source).toContain("paymentStatus = 'pending'");
        expect(source).toContain("status === 'pending_verification'");
        expect(source).toContain("paymentStatus = 'submitted'");
    });

    test('payment pending page live-confirms internal approval', async () => {
        const dbService = fs.readFileSync(path.join(__dirname, '..', 'assets/js/db-service.js'), 'utf8');
        const pageScript = fs.readFileSync(path.join(__dirname, '..', 'assets/js/payment-pending.js'), 'utf8');
        const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'payment-pending.html'), 'utf8');
        const pageCss = fs.readFileSync(path.join(__dirname, '..', 'assets/css/payment-pending.css'), 'utf8');

        expect(dbService).toContain('onSnapshot');
        expect(dbService).toContain('subscribeInternalUser');
        expect(pageScript).toContain('startInternalStatusListener');
        expect(pageScript).toContain('data.subscribeInternalUser');
        expect(pageScript).toContain("['pending', 'submitted', 'under_review', 'verified', 'rejected'].includes(status)");
        expect(pageScript).toContain("subscription?.status === 'active'");
        expect(pageScript).toContain('scheduleDashboardRedirect');
        expect(pageScript).toContain("window.location.replace('/dashboard')");
        expect(pageHtml).toContain('status-success-icon');
        expect(pageCss).toContain('success-check-draw');
        expect(pageCss).toContain('prefers-reduced-motion');
    });

    test('verified billing approval stamps next billing period', async () => {
        const dbService = fs.readFileSync(path.join(__dirname, '..', 'assets/js/db-service.js'), 'utf8');
        const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
        const storageRules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
        const settingsBilling = fs.readFileSync(path.join(__dirname, '..', 'settings-billing.html'), 'utf8');

        expect(dbService).toContain('_billingPeriodForFrequency');
        expect(dbService).toContain("endDate.setMonth(endDate.getMonth() + 1)");
        expect(dbService).toContain("endDate.setFullYear(endDate.getFullYear() + 1)");
        expect(dbService).toContain('internal.payment_verified_at');
        expect(dbService).toContain('backfillActiveBillingPeriod');
        expect(dbService).toContain('current_period_end');

        expect(rules).toContain('hasValidVerifiedBillingPeriod');
        expect(rules).toContain('isActiveBillingPeriodBackfill');
        expect(rules).toContain("duration.value(32, 'd')");
        expect(rules).toContain("duration.value(367, 'd')");

        expect(settingsBilling).toContain('M9 12.75L11.25 15 15 9.75');
        expect(settingsBilling).toContain('bill-plan-chip-premium');
        expect(settingsBilling).toContain('bill-plan-chip-gold');
        expect(settingsBilling).toContain('bill-plan-chip-core');
        expect(settingsBilling).toContain("summaryCard('Current plan', planLevelChip(o)");
        expect(settingsBilling).toContain('Plan options');
        expect(settingsBilling).toContain('Trial access');
        expect(settingsBilling).toContain('${planName} plan');
        expect(settingsBilling).toContain("o.plan_id === 'growth' && status === 'active'");
        expect(settingsBilling).toContain("o.plan_id === 'core' || o.plan_id === 'basic'");
        expect(settingsBilling).toContain('Team management coming soon');
        expect(settingsBilling).not.toContain('billing-plan-level-label');
        expect(settingsBilling).not.toContain('Loading membership');
        expect(settingsBilling).not.toContain('Trial member');
        expect(settingsBilling).not.toContain('${planName} member');
        expect(settingsBilling).not.toContain('${planName} subscription');
        expect(settingsBilling).not.toContain('Team member management');
        expect(settingsBilling).toContain('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2');
        expect(settingsBilling).toContain('M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4');
        expect(settingsBilling).not.toContain('M5 13l4 4L19 7M4 6h16');
        expect(settingsBilling).not.toContain('M3 7l9-4 9 4M4 7v11h16V7M8 11v4M12 11v4M16 11v4');
    });

    test('trial quotas are wired through config, rules, API, and UI popups', async () => {
        const billingConfig = fs.readFileSync(path.join(__dirname, '..', 'assets/js/billing-config.js'), 'utf8');
        const dbService = fs.readFileSync(path.join(__dirname, '..', 'assets/js/db-service.js'), 'utf8');
        const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
        const storageRules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
        const netlifyApi = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/api.js'), 'utf8');
        const fastApi = fs.readFileSync(path.join(__dirname, '..', 'api/main.py'), 'utf8');
        const trialAccess = fs.readFileSync(path.join(__dirname, '..', 'assets/js/trial-access.js'), 'utf8');
        const sidebarAI = fs.readFileSync(path.join(__dirname, '..', 'assets/js/ai-chat.js'), 'utf8');
        const commandAI = fs.readFileSync(path.join(__dirname, '..', 'assets/js/ai-command-center.js'), 'utf8');
        const documentAttachment = fs.readFileSync(path.join(__dirname, '..', 'assets/js/document-attachment.js'), 'utf8');
        const bankImport = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bank-statement-import.js'), 'utf8');
        const paymentPending = fs.readFileSync(path.join(__dirname, '..', 'assets/js/payment-pending.js'), 'utf8');

        expect(billingConfig).toContain("seat_limit: 1");
        expect(billingConfig).toContain("storage_limit_bytes: 5 * MB");
        expect(billingConfig).toContain("ai_chat_limit: 1");

        expect(dbService).toContain('async assertCanUseStorage');
        expect(dbService).toContain('trial_storage_limit_reached');
        // The trial AI counter doc id; db-service builds the usage_limits path
        // dynamically (`usage_limits/${aiDocId}`), so match the doc id literal.
        expect(dbService).toContain("'ai_chat_trial'");
        expect(dbService).toContain('await this.assertCanUseStorage(userId, file?.size || 0');
        expect(dbService).toContain('await this.assertCanUseStorage(userId, data.file_size || 0');
        expect(dbService).toContain('await this.assertCanUseStorage(userId, file.size || 0');
        expect(paymentPending).toContain('bypassPlanLimit: true');

        expect(rules).toContain('isValidTrialAIUsageCreate');
        expect(rules).toContain('isValidTrialAIUsageUpdate');
        expect(rules).toContain("limitId == 'ai_chat_trial'");
        expect(rules).toContain('data.count == existingData.count + 1');
        // Per-plan monthly AI counter (real numeric gating backstop).
        expect(rules).toContain('isValidPlanAIUsageCreate');
        expect(rules).toContain('planMonthlyAiLimit');
        expect(rules).toContain("limitId.matches('ai_chat_[0-9]{4}-[0-9]{2}')");
        // Per-plan monthly document-processing guard.
        expect(dbService).toContain('async assertCanProcessDocument');
        expect(dbService).toContain('doc_processing_limit_reached');
        // Value-level lockstep: billing-config, netlify function, and FastAPI
        // must expose the SAME per-plan AI quotas (see billing-config.js §comment).
        expect(netlifyApi).toContain('const PLAN_AI_PERIOD_LIMITS = { starter: 10, basic: 30, core: 30, growth: 100, enterprise: null }');
        expect(netlifyApi).toContain('const TRIAL_AI_LIMIT = 1');
        expect(fastApi).toContain('_PLAN_AI_MONTHLY_LIMITS = {"starter": 10, "basic": 30, "core": 30, "growth": 100, "enterprise": None}');
        expect(rules).toContain('respectsTrialStorageSingleFileLimit');
        expect(storageRules).toContain('respectsTrialStorageSingleFileLimit');
        expect(storageRules).toContain('firestore.get(/databases/(default)/documents/users/$(userId)/billing_subscription/current)');

        expect(netlifyApi).toContain('consumeAIQuotaIfNeeded');
        expect(netlifyApi).toContain('trial_ai_limit_reached');
        expect(netlifyApi).toContain('ai_limit_reached');
        expect(netlifyApi).toContain("patchUserDocument(uid, token, 'usage_limits', 'ai_chat_trial'");
        expect(fastApi).toContain('_consume_ai_quota');
        expect(fastApi).toContain('trial_ai_limit_reached');
        expect(fastApi).toContain('_PLAN_AI_MONTHLY_LIMITS');

        expect(trialAccess).toContain('showSubscriptionLimitModal');
        expect(sidebarAI).toContain('maybeShowTrialLimit');
        expect(commandAI).toContain('maybeShowTrialLimit');
        expect(documentAttachment).toContain('maybeShowPlanLimit');
        expect(bankImport).toContain('showSubscriptionLimitModal');
    });
});

test.describe('checkout voucher UI', () => {
    test('voucher section sits under billing frequency with normalized input', async ({ page }) => {
        await page.goto('/checkout?plan=growth&billing=monthly');

        // Placement: Billing frequency → Voucher code → Payment method.
        const sectionTitles = await page.locator('.form-panel .section-title').allTextContents();
        const billingIndex = sectionTitles.indexOf('Billing frequency');
        const voucherIndex = sectionTitles.indexOf('Voucher code');
        const methodIndex = sectionTitles.indexOf('Payment method');
        expect(billingIndex).toBeGreaterThan(-1);
        expect(voucherIndex).toBe(billingIndex + 1);
        expect(methodIndex).toBe(voucherIndex + 1);

        // Hidden until a voucher is applied.
        await expect(page.locator('#voucher-row')).toBeHidden();
        await expect(page.locator('#voucher-applied')).toBeHidden();

        // Input normalizes to uppercase and strips invalid characters.
        await page.locator('#voucher-input').fill('fluxy 20!');
        await expect(page.locator('#voucher-input')).toHaveValue('FLUXY20');

        // Empty apply shows the inline validation message without touching totals.
        const totalBefore = await page.locator('#total-due').textContent();
        await page.locator('#voucher-input').fill('');
        await page.locator('#voucher-apply').click();
        await expect(page.locator('#voucher-error')).toBeVisible();
        await expect(page.locator('#voucher-error')).toHaveText('Enter a voucher code first.');
        await expect(page.locator('#total-due')).toHaveText(totalBefore);
    });

    test('voucher section does not overflow at 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 900 });
        await page.goto('/checkout?plan=growth&billing=monthly');
        await expect(page.locator('#voucher-input')).toBeVisible();
        await expect(page.locator('#voucher-apply')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
