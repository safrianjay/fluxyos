// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// Authenticated browser regression for CoA Phase 1 against real Firestore
// (deployed rules; superset of accounting-smoke). Verifies: the 32-account
// seed + backfill, business_categories seeding, system badges, an archive →
// reactivate round-trip (leaves the workspace clean), the expanded mapping
// select, and a clean console. Counts asserted here (22 categories, 0 active
// expanded) are Phase-1 facts — update them when Phase 3 activates categories.

test('CoA Phase 1: seed, taxonomy, archive round-trip (live rules)', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|accounting|journal|ledger|chart_of_accounts|business_categories|periods/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    // Reports → Income Statement is the default landing; Overview is a header
    // dropdown rather than a tab (accounting-overview-menu.spec.js).
    await expect(page.locator('[data-acct-panel="income"]')).toBeVisible({ timeout: 30000 });

    // --- Chart of Accounts tab: full expanded seed present.
    await openAccountingTab(page, 'coa');
    await expect(page.locator('#coa-content')).toContainText('Cash & Bank', { timeout: 30000 });
    await expect(page.locator('#coa-content')).toContainText('Owner Drawings (Prive)');
    await expect(page.locator('#coa-content')).toContainText('Cost of Goods Sold');
    await expect(page.locator('#coa-content')).toContainText('Salaries & Wages');
    await expect(page.locator('#coa-content')).toContainText('FX Gain/Loss');
    const coaRows = await page.locator('#coa-content tbody tr').count();
    expect(coaRows).toBeGreaterThanOrEqual(32);
    // SAK column + system badges render.
    await expect(page.locator('#coa-content')).toContainText('SAK Category');
    expect(await page.locator('#coa-content [data-coa-kebab]').count()).toBeGreaterThanOrEqual(10);
    expect((await page.locator('#coa-content').innerText()).includes('System')).toBe(true);

    // --- business_categories seeded through the deployed rules (22 docs) and
    // system_default mappings exist for expanded categories.
    const seeded = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        const [cats, mappings] = await Promise.all([
            ds.getBusinessCategories(uid),
            ds.getAccountingMappings(uid)
        ]);
        return {
            catCount: cats.length,
            builtinActive: cats.filter((c) => c.is_builtin && c.is_active !== false).map((c) => c.name).sort(),
            expandedActive: cats.filter((c) => !c.is_builtin && c.is_active !== false).length,
            rentMapping: mappings.find((m) => m.source_value === 'Rent')?.target_account_code || null,
            rentConfidence: mappings.find((m) => m.source_value === 'Rent')?.confidence || null
        };
    });
    expect(seeded.catCount).toBe(22);
    expect(seeded.builtinActive).toEqual(['Infrastructure', 'Marketing', 'Operations', 'Others', 'Revenue', 'SaaS']);
    expect(seeded.expandedActive).toBe(0);
    expect(seeded.rentMapping).toBe('6420');
    expect(seeded.rentConfidence).toBe('system_default');

    // --- Archive → reactivate round-trip on a non-system account (6450), via the
    // row's kebab (⋮) → Archive/Reactivate menu.
    await page.locator('[data-coa-kebab="6450"]').click();
    await page.locator('.acct-kebab-menu [data-menu-toggle]').click();
    await page.locator('#fluxy-dialog [data-dialog-action="confirm"]').click();
    await expect(page.locator('#coa-content tbody tr', { hasText: 'Travel & Entertainment' })).toContainText(/Archived|Diarsipkan/, { timeout: 30000 });
    // Archived account leaves the GL picker.
    await openAccountingTab(page, 'ledger');
    expect(await page.locator('#ledger-account-select option[value="6450"]').count()).toBe(0);
    // Reactivate to leave the workspace clean.
    await openAccountingTab(page, 'coa');
    await page.locator('[data-coa-kebab="6450"]').click();
    await page.locator('.acct-kebab-menu [data-menu-toggle]').click();
    await page.locator('#fluxy-dialog [data-dialog-action="confirm"]').click();
    await expect(page.locator('#coa-content tbody tr', { hasText: 'Travel & Entertainment' })).toContainText(/Active|Aktif/, { timeout: 30000 });

    // --- Mapping tab select offers the expanded chart.
    await openAccountingTab(page, 'mapping');
    await expect(page.locator('[data-acct-panel="mapping"]')).toBeVisible();
    const mappingHtml = await page.locator('#mapping-preview-content').innerHTML().catch(() => '');
    if (mappingHtml.includes('select')) {
        expect(mappingHtml).toContain('6410');
        expect(mappingHtml).toContain('5100');
    }

    await page.screenshot({ path: 'test-results/coa-phase1-qa.png', fullPage: true });
    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});
