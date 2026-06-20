// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Fluxy AI launcher button restyle.
 *
 * Every Fluxy AI launcher (topbar `toggleFluxyAI` buttons + the records-subpage
 * `*ask-ai` buttons) must render as the shared `.fluxy-ai-btn` pill: white body,
 * gradient border, gradient sparkle icon, gradient label — applied by the shared
 * enhancer in shared-dashboard.js. The old orange treatment must be gone, the
 * label preserved, and pages must stay console-clean.
 */

// Cover both selector branches: inline-onclick pages and the id$="ask-ai" pages.
// (dashboard.html is excluded — it has no topbar launcher pill; its AI affordance
// is the contextual "Ask Fluxy AI about this period" CTA in the brain orb panel.)
const PAGES = [
    '/ledger.html',
    '/revenue-sync.html',
    '/bill.html',
    '/invoices.html',
    '/budget.html',
    '/accounting.html',
    '/accounting-records.html',
    '/balance-sheet-records.html'
];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

test('every Fluxy AI launcher renders as the shared gradient pill', async ({ page }) => {
    for (const url of PAGES) {
        const consoleErrors = [];
        page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${url} ${msg.text()}`); });
        page.on('pageerror', err => consoleErrors.push(`${url} ${String(err)}`));

        await page.goto(url);
        const btn = page.locator('.fluxy-ai-btn').first();
        await expect(btn, `${url} should have a .fluxy-ai-btn launcher`).toBeAttached({ timeout: 15_000 });

        const info = await page.evaluate(() => {
            const el = document.querySelector('.fluxy-ai-btn');
            if (!el) return null;
            const icon = el.querySelector('.fluxy-ai-btn-icon');
            const label = el.querySelector('.fluxy-ai-btn-label');
            const cs = getComputedStyle(el);
            const labelCs = label ? getComputedStyle(label) : null;
            return {
                hasIcon: !!icon,
                labelText: label ? (label.textContent || '').trim() : '',
                radius: parseFloat(cs.borderTopLeftRadius),
                // Gradient text is achieved via transparent text-fill.
                labelFill: labelCs ? labelCs.webkitTextFillColor : '',
                stillOrange: /orange/i.test(el.className) || cs.backgroundColor === 'rgb(255, 237, 213)'
            };
        });

        expect(info, `${url} launcher present`).not.toBeNull();
        expect(info.hasIcon, `${url} launcher has the gradient sparkle icon`).toBeTruthy();
        expect(info.labelText, `${url} launcher keeps a Fluxy AI label`).toMatch(/Fluxy AI/i);
        expect(info.radius, `${url} launcher is a pill (rounded-full)`).toBeGreaterThan(100);
        expect(info.labelFill, `${url} label uses gradient (transparent text-fill)`).toMatch(/rgba?\(0, 0, 0, 0\)|transparent/);
        expect(info.stillOrange, `${url} launcher must drop the old orange treatment`).toBeFalsy();

        expect(consoleErrors, `console errors on ${url}: ${consoleErrors.join(' | ')}`).toEqual([]);
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
    }
});

test('clicking the restyled launcher still opens Fluxy AI', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/ledger.html');
    const btn = page.locator('.fluxy-ai-btn').first();
    await expect(btn).toBeVisible({ timeout: 15_000 });

    // Neutralize the orthogonal AI access guard so the drawer opens regardless of
    // the QA account's trial state, then confirm the launcher still toggles it.
    await page.evaluate(() => {
        if (window.FluxyAccessGuard) window.FluxyAccessGuard.requireAIUsage = () => true;
    });
    await btn.click();
    // The chat drawer mounts a close button (#close-chat) when open.
    await expect(page.locator('#close-chat')).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
