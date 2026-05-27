// @ts-check
const { test, expect } = require('@playwright/test');

// Dashboard.html intentionally has no top-right Fluxy AI button (the AI
// entry lives in the sidebar's Command group instead), so the bell skips
// that page by design. Other app pages all anchor on the top button.
test('Notifications bell auto-injects to the left of Fluxy AI on every app page', async ({ page }) => {
    for (const path of ['/budget.html', '/ledger.html', '/bill.html', '/subscription.html', '/integration.html']) {
        await page.goto(path);
        await page.waitForFunction(() => !!document.getElementById('fbx-notif-btn'), { timeout: 10000 });
        // Bell sits immediately before the Fluxy AI button in DOM order.
        const order = await page.evaluate(() => {
            const ai = document.querySelector('button[onclick*="toggleFluxyAI"], [data-tour-target="fluxy-ai-entry"]');
            const wrap = document.getElementById('fbx-notif-wrap');
            if (!ai || !wrap) return 'missing';
            return ai.previousElementSibling === wrap ? 'left' : 'other';
        });
        console.log(`[notif] ${path} → bell position:`, order);
        expect(order).toBe('left');
    }
});

test('Clicking the bell opens a tabbed panel with Variance + Recent activity', async ({ page }) => {
    await page.goto('/budget.html');
    await page.waitForSelector('#fbx-notif-btn', { timeout: 10000 });
    await page.click('#fbx-notif-btn');
    const panel = page.locator('#fbx-notif-panel');
    // classList.contains avoids matching `overflow-hidden` as a false positive.
    await expect.poll(() => panel.evaluate(el => el.classList.contains('hidden'))).toBe(false);
    await expect(page.locator('#fbx-notif-tab-variance')).toBeVisible();
    await expect(page.locator('#fbx-notif-tab-activity')).toBeVisible();

    // Wait for the body to settle (data fetch completes).
    await page.waitForFunction(() => {
        const body = document.getElementById('fbx-notif-body');
        return body && !body.textContent.includes('Loading');
    }, { timeout: 10000 });

    const varianceBody = (await page.locator('#fbx-notif-body').textContent()) || '';
    console.log('[notif] variance body length:', varianceBody.trim().length);

    // Switch to activity tab.
    await page.click('#fbx-notif-tab-activity');
    await page.waitForTimeout(200);
    const activeStyle = await page.locator('#fbx-notif-tab-activity').evaluate(el => el.className);
    expect(activeStyle).toContain('text-[#EA580C]');
    const activityBody = (await page.locator('#fbx-notif-body').textContent()) || '';
    console.log('[notif] activity body length:', activityBody.trim().length);

    await page.screenshot({ path: 'test-results/budget-verify/NOTIF-panel.png', fullPage: false });

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect.poll(() => panel.evaluate(el => el.classList.contains('hidden'))).toBe(true);
});
