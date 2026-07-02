// @ts-check
const { test, expect } = require('@playwright/test');

// Localization pair-edit (LOCALIZATION_PLAN §12): the Tax Center's EN copy must have
// matching formal-register Bahasa keys in dashboard-i18n.js. Loads /tax-center with
// localStorage('fluxyos-lang') = 'id' (set before any page script runs) and asserts
// the walker translated the static copy. EN default is covered by tax-center-smoke.

test('Tax Center renders in formal Bahasa Indonesia when fluxyos-lang=id', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));

    await page.goto('/tax-center.html');
    await expect(page.locator('#tax-period-label')).not.toBeEmpty({ timeout: 30000 });

    // Topbar title + subtitle.
    await expect(page.locator('.dashboard-topbar-title')).toHaveText('Pusat Pajak', { timeout: 15000 });
    await expect(page.locator('.dashboard-topbar-subtitle')).toContainText('Pajak Indonesia');

    // Sidebar group label (async-injected by sidebar-loader; MutationObserver catches it).
    await expect(page.locator('#sidebar')).toContainText('Pajak & Kepatuhan', { timeout: 15000 });

    // Tabs.
    await expect(page.locator('[data-tax-tab="profile"]')).toHaveText('Profil Pajak Perusahaan');
    await expect(page.locator('[data-tax-tab="withholding"]')).toHaveText('Pemotongan');
    await expect(page.locator('[data-tax-tab="corporate"]')).toHaveText('Pajak Badan');
    await expect(page.locator('[data-tax-tab="mappings"]')).toHaveText('Pemetaan');

    // Tax calendar (title + interpolated day-countdown chip via PATTERNS).
    await expect(page.locator('[data-tax-panel="overview"]')).toContainText('Tenggat pajak mendatang');
    await expect(page.locator('#tax-deadlines .fluxy-table-status').first()).toHaveText(/sisa \d+ hari|Jatuh tempo hari ini/, { timeout: 15000 });

    // KPI labels + profile form + actions.
    await expect(page.locator('.acct-kpi-grid').first()).toContainText('PPN Terutang');
    await page.locator('[data-tax-tab="profile"]').click();
    await expect(page.locator('#tax-profile-save')).toHaveText('Simpan profil pajak');
    await expect(page.locator('[data-tax-panel="profile"]')).toContainText('Tarif PPN bawaan (%)');
    await expect(page.locator('#period-compute-btn')).toHaveText('Hitung periode');

    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
