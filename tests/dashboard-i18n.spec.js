// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Consolidated Indonesian smoke for the dashboard (LOCALIZATION_PLAN §12).
 *
 * Every app page loads with localStorage('fluxyos-lang') = 'id' (also the
 * product default since the Bahasa-first flip) and must prove the language
 * engine ran end to end: <title> translated, <html lang="id"> set, and the
 * async-injected sidebar translated by the MutationObserver — with zero page
 * errors. Deep string coverage is checked by `node scripts/i18n-audit.js`;
 * feature-level Bahasa assertions live in tax-center-i18n.spec.js.
 */

// [path, expected Indonesian <title>, hasSidebar]
const PAGES = /** @type {const} */ ([
    ['dashboard.html',              'FluxyOS | Dashboard',                    true],
    ['ledger.html',                 'FluxyOS | Buku Besar & Transaksi',       true],
    ['bill.html',                   'FluxyOS | Tagihan & Pembayaran',         true],
    ['subscription.html',           'FluxyOS | Langganan',                    true],
    ['invoices.html',               'FluxyOS | Invoice',                      true],
    ['budget.html',                 'FluxyOS | Anggaran',                     true],
    ['revenue-sync.html',           'FluxyOS | Revenue Sync',                 true],
    ['net-profit.html',             'FluxyOS | Laba Bersih',                  true],
    ['accounting.html',             'FluxyOS | Pusat Akuntansi',              true],
    ['accounting-records.html',     'FluxyOS | Catatan Akuntansi',            true],
    ['accounting-journal-new.html', 'FluxyOS | Jurnal Manual Baru',           true],
    ['reports.html',                'FluxyOS | Laporan & Ekspor',             true],
    ['tax-center.html',             'FluxyOS | Pusat Pajak',                  true],
    ['integration.html',            'FluxyOS | Integrasi',                    true],
    ['ai.html',                     'FluxyOS | Fluxy AI',                     true],
    ['activity-log.html',           'FluxyOS | Log Audit',                    true],
    ['settings.html',               'FluxyOS | Pengaturan',                   true],
    ['settings-personal.html',      'FluxyOS | Detail Pribadi',               true],
    ['settings-business.html',      'FluxyOS | Bisnis',                       true],
    ['settings-finance.html',       'FluxyOS | Preferensi Keuangan',          true],
    ['settings-language.html',      'FluxyOS | Bahasa & Wilayah',             true],
    ['settings-notifications.html', 'FluxyOS | Notifikasi & Email',           true],
    ['settings-security.html',      'FluxyOS | Tim dan Keamanan',             true],
    ['settings-ai.html',            'FluxyOS | Preferensi AI',                true],
    ['settings-billing.html',       'FluxyOS | Penagihan & Paket',            true],
    ['settings-budget.html',        'FluxyOS | Pengaturan Anggaran',          true],
    ['settings-cash.html',          'FluxyOS | Kas & Rekening Bank',          true],
    ['settings-import-rules.html',  'FluxyOS | Kategori dan Aturan Impor',    true],
    ['settings-whatsapp.html',      'FluxyOS | Koneksi WhatsApp',             true],
]);

for (const [path, title, hasSidebar] of PAGES) {
    test(`${path} renders in Bahasa Indonesia`, async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(String(err)));
        await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));

        await page.goto('/' + path);
        await expect(page).toHaveTitle(title, { timeout: 20000 });
        await expect(page.locator('html')).toHaveAttribute('lang', 'id');
        if (hasSidebar) {
            // Async-injected nav → proves the MutationObserver re-translation.
            await expect(page.locator('#sidebar')).toContainText('Pengaturan', { timeout: 15000 });
        }
        expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    });
}

test('onboarding renders in Bahasa Indonesia (pre-redirect rail)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));
    await page.goto('/onboarding.html');
    // A completed/exempt QA account is redirected to /dashboard once progress
    // loads; the static rail translates at DOMContentLoaded, well before that.
    try {
        await expect(page.locator('.onboarding-rail-title')).toHaveText('Progres penyiapan', { timeout: 5000 });
    } catch (e) {
        if (/\/dashboard/.test(page.url())) test.skip(true, 'QA account already onboarded — redirected before rail assert');
        throw e;
    }
});

test('every accounting error code has an Indonesian message', async ({ page }) => {
    // scripts/i18n-audit.js is structurally blind to these: it harvests string
    // literals from toasts/dialog props, and an error message originates in a
    // `throw new Error(...)` inside db-service/accounting-engine, then reaches the
    // UI as a variable. So the audit would report zero gaps while every accounting
    // failure spoke English to a Bahasa-first user. This closes that hole by
    // asserting coverage against the code table itself, which cannot drift.
    await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));
    await page.goto('/accounting.html');
    await page.waitForFunction(() => !!window.FluxyI18n, null, { timeout: 20000 });

    const out = await page.evaluate(async () => {
        const { GL } = await import('/assets/js/accounting-engine.js?v=' + Date.now());
        const missing = [];
        Object.values(GL).forEach((code) => {
            const key = `gl.${code}`;
            // t() returns the key itself when it has no translation.
            if (window.FluxyI18n.t(key) === key) missing.push(key);
        });
        // Interpolation must actually substitute, or users see a raw {period_key}.
        const sample = window.FluxyI18n.t(`gl.${GL.PERIOD_CLOSED}`, { period_key: '2026-07' });
        return { missing, sample };
    });

    expect(out.missing, `missing Indonesian keys: ${out.missing.join(', ')}`).toEqual([]);
    expect(out.sample).toContain('2026-07');
    expect(out.sample).not.toContain('{period_key}');
});
