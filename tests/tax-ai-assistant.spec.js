// @ts-check
const { test, expect } = require('@playwright/test');

// Phase 5: AI Tax Assistant foundation. Two halves, both read-only:
//   1. Deterministic compliance insights on the Overview tab (runComplianceChecks in
//      tax-engine.js) — posts a withholding bill WITHOUT a bukti potong and asserts
//      the MISSING_BUPOT finding renders.
//   2. Fluxy AI drawer context — detectPage resolves 'tax', FluxyAIContext.get()
//      carries the live tax figures, and the drawer shows the Tax Center context
//      card + tax-aware prompt chips. No prompt is submitted (backend not running
//      under the static QA server) — same scope as fluxy-ai-context.spec.js.

test('Tax Center: compliance insights render and the AI drawer is tax-aware', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Seed: PKP profile + a withholding bill with NO bukti potong (guaranteed finding).
    await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        await ds.saveTaxProfile(uid, { pkp_status: 'pkp', npwp: '01.234.567.8-901.000', default_ppn_rate: 11 });
        await ds.addBill(uid, {
            amount: 5000000, vendor_name: 'QA AI Vendor', category: 'Operations', type: 'expense',
            status: 'Completed', icon: '💸', withholding_rate: 2, withholding_type: 'PPh 23', withholding_code: 'PPH23'
            // deliberately no bukti_potong_no
        });
    });
    await page.reload();
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // 1) Deterministic insight renders.
    await expect(page.locator('[data-insight="MISSING_BUPOT"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-insight="MISSING_BUPOT"]')).toContainText(/bukti potong/i);

    // 2) Page detection + live context.
    const detected = await page.evaluate(() => window.FluxyAIContext.detectPage());
    expect(detected).toBe('tax');
    const ctx = await page.evaluate(() => window.FluxyAIContext.get());
    expect(ctx.pageTitle).toBe('Tax Center');
    expect(ctx.summary.some((r) => r.label === 'PPN payable')).toBe(true);
    expect(ctx.summary.some((r) => r.label === 'Compliance issues')).toBe(true);

    // 3) Drawer: context card + tax-aware chips (access guard stubbed like the
    //    existing fluxy-ai-context spec; no prompt submitted).
    await page.evaluate(() => {
        if (window.FluxyAccessGuard) window.FluxyAccessGuard.requireAIUsage = () => true;
        window.toggleFluxyAI(true);
    });
    await expect(page.locator('#ai-chat-window.active')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ai-context-title')).toHaveText('Tax Center');
    const rows = await page.locator('.ai-context-row').count();
    expect(rows).toBeGreaterThan(0);
    const chips = await page.locator('.prompt-chip').allTextContents();
    expect(chips.some((c) => /PPN|faktur|withholding|filing/i.test(c))).toBe(true);

    expect(consoleErrors, `page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
