// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: Activity Log page (/activity-log).
 *
 * Read-only smoke against the real Firebase QA session:
 *   - the page loads clean (no CSP/404/Firebase/uncaught console errors),
 *   - it renders either the activity table or its empty state,
 *   - the sidebar "Activity Log" nav item is visible for an owner (audit.read),
 *   - clicking a row opens the Activity Details drawer with a change view,
 *   - WIB date format + Rp currency render correctly,
 *   - the page has no horizontal overflow at 375px.
 *
 * It never writes to Firestore — it only reads the QA account's own audit logs.
 */

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForActivityReady(page) {
    await page.waitForSelector('#activity-table-body');
    // A workspace with no activity renders the empty-state container instead of
    // overwriting the tbody placeholder, so accept either signal as "loaded".
    await page.waitForFunction(() => {
        const body = document.querySelector('#activity-table-body');
        const empty = document.querySelector('#activity-empty-state');
        const emptyVisible = !!empty && !empty.classList.contains('hidden');
        const bodyReady = !!body && !/Loading activity/.test(body.textContent || '');
        return emptyVisible || bodyReady;
    }, null, { timeout: 25_000 });
}

// Firestore's WebChannel teardown on navigation (net::ERR_ABORTED) and the
// shared connection-guard probe (connection-guard.js → a no-cors GET to
// firestore.googleapis.com whose 404 the browser still logs as a failed
// resource) are benign, app-wide network noise — not errors this page causes.
// Match them by request URL so genuine page errors (a 404 on a referenced
// asset, a CSP violation, or a thrown/caught exception logged from our own
// code) are still caught.
function isBenignFirestoreNoise(msg) {
    try {
        const url = (typeof msg.location === 'function' ? msg.location().url : '') || '';
        return url.includes('firestore.googleapis.com');
    } catch (_) { return false; }
}

function trackConsole(page) {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !isBenignFirestoreNoise(msg)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    return consoleErrors;
}

test('Activity Log loads clean and renders table or empty state', async ({ page }) => {
    const consoleErrors = trackConsole(page);

    await page.goto('/activity-log.html');
    await waitForActivityReady(page);

    // Page chrome.
    await expect(page.locator('h1', { hasText: 'Activity Log' })).toBeVisible();

    // Owner/admin (audit.read) → the sidebar nav item is revealed.
    await expect(page.locator('#nav-activity-log')).toBeVisible({ timeout: 15_000 });

    const rowCount = await page.locator('#activity-table-body tr[data-action="open"]').count();
    if (rowCount === 0) {
        // No audit history for the QA account yet — the empty state must show and
        // the page must still be clean and usable.
        await expect(page.locator('#activity-empty-state')).toBeVisible();
    } else {
        // Header columns present.
        await expect(page.locator('.fluxy-table-header')).toContainText('Module');
        await expect(page.locator('.fluxy-table-header')).toContainText('Date & Time');

        // WIB date format ("DD Mon YYYY" + "HH:MM WIB") renders in the first row.
        const firstRow = page.locator('#activity-table-body tr[data-action="open"]').first();
        await expect(firstRow).toContainText('WIB');

        // Any rendered currency uses the no-space "Rp1.234" format (never "Rp 1.234").
        const bodyText = (await page.locator('#activity-table-body').textContent()) || '';
        expect(bodyText).not.toMatch(/Rp\s\d/);
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('clicking a row opens the Activity Details drawer with changes', async ({ page }) => {
    const consoleErrors = trackConsole(page);

    await page.goto('/activity-log.html');
    await waitForActivityReady(page);

    const rows = page.locator('#activity-table-body tr[data-action="open"]');
    const rowCount = await rows.count();
    test.skip(rowCount === 0, 'QA account has no audit activity to inspect.');

    // Drawer starts off-screen.
    await expect(page.locator('#activity-drawer')).toHaveClass(/translate-x-full/);

    await rows.first().click();

    // Drawer slides in and shows derived detail.
    await expect(page.locator('#activity-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 10_000 });
    await expect(page.locator('#activity-drawer-content')).toContainText('Action');
    await expect(page.locator('#activity-drawer-content')).toContainText('Changes');
    await expect(page.locator('#activity-drawer-content')).toContainText('WIB');

    // Closing via the backdrop returns it off-screen.
    await page.locator('#activity-drawer-close-footer').click();
    await expect(page.locator('#activity-drawer')).toHaveClass(/translate-x-full/);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('"View Record" link points at a deep-link route when present', async ({ page }) => {
    trackConsole(page);
    await page.goto('/activity-log.html');
    await waitForActivityReady(page);

    const viewLinks = page.locator('#activity-table-body a[data-view-record]');
    const n = await viewLinks.count();
    test.skip(n === 0, 'No deep-linkable (transaction/bill/subscription) activity for the QA account.');

    const href = await viewLinks.first().getAttribute('href');
    expect(href).toMatch(/^\/(ledger|bill|subscription)\?record=.+/);
});

test('no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/activity-log.html');
    await waitForActivityReady(page);

    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page overflows by ${overflow}px at 375`).toBeLessThanOrEqual(1);
});
