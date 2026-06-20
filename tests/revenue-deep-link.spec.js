// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: universal record deep-linking on the Revenue Sync page.
 *
 * A revenue row opened from another page (`/revenue-sync?record=<id>`) — e.g.
 * from Fluxy AI results — must open regardless of the page's current date
 * filter, even when the row sits in a previous month. Revenue rows are income
 * transactions, so the fix snaps the range to the record's own month before the
 * first load (`prepareLinkedRevenueRecordRange`), then locates, scrolls to,
 * highlights, and opens it. The user must never see "not in the currently
 * loaded range".
 *
 * Read-only: it reuses the page's already-authenticated Firebase session to
 * pick a real income transaction; it never writes to Firestore.
 */

const REVENUE_TYPES = new Set(['income', 'revenue', 'refund', 'pending_receivable']);

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

async function waitForRevenueReady(page) {
    await page.waitForSelector('#revenue-table-body');
    // A period with no revenue renders the empty-state container instead of
    // overwriting the tbody placeholder, so accept either signal as "loaded".
    await page.waitForFunction(() => {
        const body = document.querySelector('#revenue-table-body');
        const empty = document.querySelector('#revenue-empty-state');
        const emptyVisible = !!empty && !empty.classList.contains('hidden');
        const bodyReady = !!body && !/Loading your revenue/.test(body.textContent || '');
        return emptyVisible || bodyReady;
    }, null, { timeout: 20_000 });
}

async function pickRevenue(page, revenueTypes) {
    return page.evaluate(async (types) => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const user = authMod.getAuth(app).currentUser;
        if (!app || !user) return { error: 'no-auth' };
        const db = fsMod.getFirestore(app);
        const q = fsMod.query(
            fsMod.collection(db, `users/${user.uid}/transactions`),
            fsMod.orderBy('timestamp', 'desc'),
            fsMod.limit(400)
        );
        const snap = await fsMod.getDocs(q);
        const allow = new Set(types);
        const now = new Date();
        const curKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        let previousMonth = null;
        let currentMonth = null;
        snap.forEach(d => {
            const data = d.data();
            // Only rows the Revenue Sync page actually renders (income-side, not voided).
            const isVoided = data.is_voided === true || String(data.status || '').trim().toLowerCase() === 'voided';
            if (isVoided || !allow.has(String(data.type || '').toLowerCase())) return;
            const t = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate() : null;
            if (!t) return;
            const key = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
            const rec = { id: d.id, key };
            if (key === curKey) { if (!currentMonth) currentMonth = rec; }
            else if (!previousMonth) { previousMonth = rec; }
        });
        return { curKey, previousMonth, currentMonth, total: snap.size };
    }, revenueTypes);
}

test('deep-link opens a PREVIOUS-month revenue row regardless of the date filter', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/revenue-sync.html');
    await waitForRevenueReady(page);

    const picked = await pickRevenue(page, [...REVENUE_TYPES]);
    test.skip(!!picked.error, 'No authenticated Firebase session available');
    test.skip(!picked.previousMonth, `QA account has no income row outside the current month (${picked.curKey}); cannot exercise cross-month deep-link.`);

    const target = picked.previousMonth;
    const defaultLabel = (await page.locator('#revenue-date-range-picker [data-drp-label]').textContent() || '').trim();

    await page.goto(`/revenue-sync.html?record=${encodeURIComponent(target.id)}`);
    await waitForRevenueReady(page);

    // The detail drawer must slide in (translate-x-full removed).
    await expect(page.locator('#revenue-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 10_000 });

    // The range must have snapped to the record's month (label changed away from
    // the default current-month label).
    const snappedLabel = (await page.locator('#revenue-date-range-picker [data-drp-label]').textContent() || '').trim();
    expect(snappedLabel).not.toEqual(defaultLabel);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('deep-link to a non-existent revenue row does not crash the page', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('/revenue-sync.html?record=__does_not_exist__deadbeef');
    await waitForRevenueReady(page);

    await expect(page.locator('#revenue-drawer')).toHaveClass(/translate-x-full/);
    // Page still usable (the tbody may be hidden behind the empty state when the
    // current period has no revenue, so assert an always-present control instead).
    await expect(page.locator('#revenue-search-input')).toBeVisible();
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
