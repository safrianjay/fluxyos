// Email Language setting — Settings → Notifications & email.
// Verifies the new card renders, saves to Firestore (production rules must
// allow the optional `language` key), persists across reload, and translates
// under the Bahasa dashboard language. Console must stay clean.
const { test, expect } = require('@playwright/test');

test.describe('Email language setting', () => {
    let consoleErrors;

    test.beforeEach(({ page }) => {
        consoleErrors = [];
        page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
        page.on('pageerror', (err) => consoleErrors.push(String(err)));
    });

    test('card renders, saves both values, persists across reload', async ({ page }) => {
        await page.goto('/settings-notifications.html');
        await expect(page.locator('#settings-load-state')).toContainText('Settings ready', { timeout: 20_000 });

        const form = page.locator('#email-language-form');
        await expect(form.getByRole('heading', { name: 'Email language' })).toBeVisible();
        const select = page.locator('#email-language');
        await expect(select.locator('option')).toHaveText(['Bahasa Indonesia', 'English']);

        // Save 'id' → status confirms → survives a reload (round-trips rules).
        await select.selectOption('id');
        await form.getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('#email-language-status')).toHaveText('Email language saved.', { timeout: 15_000 });
        await page.reload();
        await expect(page.locator('#settings-load-state')).toContainText('Settings ready', { timeout: 20_000 });
        await expect(page.locator('#email-language')).toHaveValue('id');

        // Save 'en' back — exercises the second enum value and leaves a clean state.
        await page.locator('#email-language').selectOption('en');
        await page.locator('#email-language-form').getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('#email-language-status')).toHaveText('Email language saved.', { timeout: 15_000 });

        expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    });

    test('card translates under Bahasa dashboard language', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id'));
        await page.goto('/settings-notifications.html');
        await expect(page.locator('#settings-load-state')).toContainText('Pengaturan siap', { timeout: 20_000 });
        await expect(page.locator('#email-language-form')).toContainText('Bahasa email');
        await expect(page.locator('#email-language-form')).toContainText('Berlaku untuk semua email berikutnya.');
        expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    });
});
