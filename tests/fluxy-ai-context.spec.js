// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Fluxy AI context-aware drawer.
 *
 * Verifies the redesigned drawer (assets/js/ai-chat.js + ai-chat.css) and the
 * shared page-context provider (window.FluxyAIContext, defined in
 * sidebar-loader.js). For each page we open the drawer and assert:
 *   - the dark hero header is gone (header background is white)
 *   - the old "Here's what I can analyze" capability intro is gone
 *   - a "Current Context" card renders with the right page title + metric rows
 *   - the suggested prompt chips are page-aware
 *   - window.FluxyAIContext.get() returns the page's summary
 *
 * No prompt is submitted (the /api/v1/brain/chat Netlify function is not running
 * under the static QA server), so this covers the visual + context layer only.
 */

const CASES = [
    { url: '/dashboard.html', page: 'dashboard', title: 'Business Overview', chip: /business doing|fix first|margin|risks/i },
    { url: '/ledger.html', page: 'ledger', title: 'Financial Ledger', chip: /trust this ledger/i },
    { url: '/bill.html', page: 'bills', title: 'Bills', chip: /overdue|need attention|coming soon/i },
    { url: '/revenue-sync.html', page: 'revenue_sync', title: 'Revenue Sync', chip: /revenue/i },
    { url: '/budget.html', page: 'budget', title: /Budget/i, chip: /budget/i },
    { url: '/subscription.html', page: 'subscriptions', title: 'Subscriptions', chip: /saas|renewal|recurring/i },
    { url: '/reports.html', page: 'reports', title: 'Reports & Exports', chip: /report|period|margin|month/i },
];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function openDrawer(page) {
    await page.evaluate(() => {
        if (window.FluxyAccessGuard) window.FluxyAccessGuard.requireAIUsage = () => true;
        window.toggleFluxyAI(true);
    });
    await expect(page.locator('#ai-chat-window.active')).toBeVisible({ timeout: 10_000 });
}

for (const c of CASES) {
    test(`drawer is context-aware on ${c.page}`, async ({ page }) => {
        const consoleErrors = [];
        page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', err => consoleErrors.push(String(err)));

        await page.goto(c.url);
        // Wait for the shared registry to be defined (sidebar-loader.js).
        await page.waitForFunction(() => !!window.FluxyAIContext, null, { timeout: 15_000 });

        // The page registers its provider; detectPage must resolve correctly.
        const detected = await page.evaluate(() => window.FluxyAIContext.detectPage());
        expect(detected, `${c.page}: detectPage`).toBe(c.page);

        await openDrawer(page);

        // 1) No dark hero — header background must be white.
        const headerBg = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-header')).backgroundColor);
        expect(headerBg, `${c.page}: header is white, not dark hero`).toBe('rgb(255, 255, 255)');

        // 2) Capability intro removed.
        const introGone = await page.evaluate(() => !/what I can analyze/i.test(document.getElementById('chat-messages')?.textContent || ''));
        expect(introGone, `${c.page}: old capability intro removed`).toBeTruthy();

        // 3) Current Context card present with the right title.
        const card = page.locator('.ai-context-card');
        await expect(card, `${c.page}: context card present`).toBeVisible();
        await expect(page.locator('.ai-context-eyebrow')).toHaveText(/Current Context/i);
        const titleText = await page.locator('.ai-context-title').textContent();
        if (c.title instanceof RegExp) expect(titleText).toMatch(c.title);
        else expect(titleText?.trim()).toBe(c.title);

        // 4) Context card has at least one metric row.
        const rows = await page.locator('.ai-context-row').count();
        expect(rows, `${c.page}: context card has summary rows`).toBeGreaterThan(0);

        // 5) Page-aware prompt chips.
        const chips = await page.locator('.prompt-chip').allTextContents();
        expect(chips.length, `${c.page}: prompt chips rendered`).toBeGreaterThan(2);
        expect(chips.join(' | '), `${c.page}: chips are page-relevant`).toMatch(c.chip);

        // 6) The provider getter returns a structured summary for this page.
        const ctx = await page.evaluate(() => window.FluxyAIContext.get());
        expect(ctx.page, `${c.page}: context.page`).toBe(c.page);
        expect(Array.isArray(ctx.summary), `${c.page}: context.summary is an array`).toBeTruthy();

        expect(consoleErrors, `console errors on ${c.url}: ${consoleErrors.join(' | ')}`).toEqual([]);
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
    });
}

test('answer evidence renders record_kind deep links', async ({ page }) => {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.FluxyAIContext, null, { timeout: 15_000 });
    await openDrawer(page);

    // Stub the brain endpoint with a canned answer whose evidence spans kinds.
    await page.route('**/api/v1/brain/chat', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true, intent: 'cash_pressure', scope: 'project_finance',
                answer: {
                    intent: 'cash_pressure', scope: 'project_finance', answer_type: 'analysis', confidence: 0.9,
                    period: { label: 'June 2026', start_date: '2026-06-01', end_date: '2026-06-30' },
                    direct_answer: 'Test answer.', key_numbers: [], recommended_actions: [], limitations: [], follow_up_questions: [],
                    insights: [
                        { title: 'Payables', description: 'd', severity: 'warning', evidence: [
                            { id: 'b1', record_kind: 'bill', vendor_name: 'Landlord', formatted_amount: 'Rp300.000' },
                            { id: 't1', record_kind: 'transaction', vendor_name: 'AWS', formatted_amount: 'Rp500.000' },
                        ] },
                        { title: 'Coverage', description: 'd', severity: 'info', evidence: [
                            { id: 's1', record_kind: 'subscription', vendor_name: 'Figma', formatted_amount: 'Rp120.000' },
                            { id: 'r1', record_kind: 'revenue', vendor_name: 'Client', formatted_amount: 'Rp900.000' },
                        ] },
                    ],
                },
                related_records: [],
            }),
        });
    });

    // submitPrompt() calls getAuthToken(), which needs Firebase currentUser to be
    // rehydrated from the stored session — wait for it before submitting.
    await expect.poll(async () => page.evaluate(async () => {
        const m = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        return !!m.getAuth().currentUser;
    }), { timeout: 15_000 }).toBe(true);

    await page.evaluate(() => { document.getElementById('chat-input').value = 'can I cover upcoming bills?'; });
    await page.locator('#chat-form button[type="submit"]').click();

    await expect(page.locator('.evidence-link').first()).toBeVisible({ timeout: 10_000 });
    const hrefs = await page.locator('.evidence-link').evaluateAll(els => els.map(e => e.getAttribute('href')));
    expect(hrefs).toContain('/bill?record=b1');
    expect(hrefs).toContain('/ledger?record=t1');
    expect(hrefs).toContain('/subscription?record=s1');
    expect(hrefs).toContain('/revenue-sync?record=r1');
});

test('drawer is full-width and legible at 480px (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.FluxyAIContext, null, { timeout: 15_000 });
    await openDrawer(page);
    const dims = await page.evaluate(() => {
        const win = document.getElementById('ai-chat-window');
        const card = document.querySelector('.ai-context-card');
        return { winWidth: win.getBoundingClientRect().width, hasCard: !!card, viewport: window.innerWidth };
    });
    // At ≤480px the drawer spans the full viewport (CSS sets width:100vw).
    expect(dims.winWidth, 'mobile drawer is full-width').toBeGreaterThanOrEqual(dims.viewport - 1);
    expect(dims.hasCard, 'context card renders on mobile').toBeTruthy();
});
