// @ts-check
const { test, expect } = require('@playwright/test');

// Authenticated browser smoke for the Tax Center (Indonesia, Phase 1). Runs as the
// QA Firebase account against real Firestore (tax rules must be deployed). Verifies:
// the page boots, the sidebar + tabs render, the company tax profile saves through
// the new rules and persists across a reload, the PPN panel renders, and the console
// is free of CSP / permission-denied / our-module errors.

test('Tax Center loads, profile saves through rules, console clean', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|tax|ppn|company_tax_profile|tax_transactions/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/tax-center.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    // Sidebar routing: the Tax Center nav item is active.
    await expect(page.locator('#nav-tax-center')).toHaveClass(/dashboard-active/, { timeout: 30000 });

    // Wait for the page controller to finish booting (it runs in onAuthStateChanged):
    // the period label is populated by initTaxCenterPage, so this is the app-ready
    // signal before we interact with tabs — avoids racing the async auth callback.
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Overview panel is the default surface.
    await expect(page.locator('[data-tax-panel="overview"]')).toBeVisible({ timeout: 30000 });

    // Company Tax Profile: fill + save + assert it persists across a reload (proves
    // the write + audit log pass the deployed rules and round-trip).
    await page.locator('[data-tax-tab="profile"]').click();
    await expect(page.locator('[data-tax-panel="profile"]')).toBeVisible();

    const npwp = '09.' + String(Date.now()).slice(-9, -6) + '.000.0-000.000';
    await page.locator('#tax-pkp-status').selectOption('pkp').catch(async () => {
        // fluxy-select enhances the native select; fall back to setting the value.
        await page.locator('#tax-pkp-status').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, 'pkp');
    });
    await page.locator('#tax-npwp').fill(npwp);
    await page.locator('#tax-ppn-rate').fill('11');
    await page.locator('#tax-profile-save').click();

    // Direct write-success signal: the toast only shows after saveTaxProfile resolves
    // (the write + audit log were accepted by the deployed rules). KPI flips alongside.
    await expect(page.getByText('Tax profile saved')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#kpi-profile-status')).toHaveText('PKP');

    // Persistence: let the write propagate, then reload and read it back through the
    // rules. A reload immediately after save can read a client-cached prior value, so
    // settle first — this verifies durability, not write latency.
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });
    await page.locator('[data-tax-tab="profile"]').click();
    await expect(page.locator('#tax-npwp')).toHaveValue(npwp, { timeout: 20000 });

    // PPN panel renders (table or empty-state, never an error).
    await page.locator('[data-tax-tab="ppn"]').click();
    await expect(page.locator('[data-tax-panel="ppn"]')).toBeVisible();
    await expect(page.locator('#ppn-summary-body')).not.toBeEmpty({ timeout: 20000 });

    // Date filter (shared picker): stepping one period back re-scopes the page to
    // last month — the derived tax-period label updates (Accounting Center parity).
    const lastMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    await page.locator('#tax-date-range-picker [data-drp-prev]').click();
    await expect(page.locator('#tax-period-label')).toHaveText(lastMonthLabel, { timeout: 20000 });
    await expect(page.locator('#ppn-summary-body')).not.toBeEmpty({ timeout: 20000 });
    // Step forward again so the rest of the spec runs against the current month.
    await page.locator('#tax-date-range-picker [data-drp-next]').click();
    await expect(page.locator('#tax-period-label')).not.toHaveText(lastMonthLabel, { timeout: 20000 });

    // Tax calendar: upcoming deadlines render with day-countdown chips.
    await page.locator('[data-tax-tab="overview"]').click();
    const deadlineRows = page.locator('#tax-deadlines [data-deadline]');
    await expect(deadlineRows.first()).toBeVisible({ timeout: 20000 });
    expect(await deadlineRows.count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#tax-deadlines .fluxy-table-status').first()).toHaveText(/\d+ days? left|Due today/);

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});
