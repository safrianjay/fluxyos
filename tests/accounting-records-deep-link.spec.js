// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: record-centric "View" links on the Accounting Records drilldown.
 *
 * Bills and subscriptions appear as supporting context behind an Income
 * Statement line. Their "View Bill" / "View Subscription" links must deep-link
 * to the specific record (`?record=<id>`) — not just open the destination page
 * on its current month — so the destination snaps its range, locates, scrolls
 * to, and highlights the row. This exercises the db-service `_incomeSourceRoute`
 * change end-to-end through a real click.
 *
 * Read-only: reuses the page's authenticated Firebase session; never writes.
 */

// Bills/subscriptions classify into these Income Statement sections.
const CANDIDATE_SECTIONS = ['operating_expenses', 'cost_of_revenue'];

test.beforeEach(async ({ page }) => {
    await installTrialPaywallBypass(page);
});

function dayKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

// A wide range maximizes the chance the QA account has at least one supporting
// bill/subscription record to click; the deep-link itself is period-agnostic.
function widePeriodParam() {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${dayKey(start)}..${dayKey(end)}`;
}

async function waitForRecordsReady(page) {
    await page.waitForSelector('#acct-records-body', { state: 'attached' });
    // Loading is done once the spinner is hidden AND either the content or the
    // error panel is shown. (A comma waitForSelector would only watch the first
    // DOM match — the always-hidden error panel — so check both explicitly.)
    await page.waitForFunction(() => {
        const loading = document.querySelector('#acct-records-loading');
        const content = document.querySelector('#acct-records-content');
        const error = document.querySelector('#acct-records-error');
        const loadingDone = !!loading && loading.classList.contains('hidden');
        const shown = (!!content && !content.classList.contains('hidden'))
            || (!!error && !error.classList.contains('hidden'));
        return loadingDone && shown;
    }, null, { timeout: 20_000 });
}

// Walk the candidate sections until one renders a bill/subscription "View" link.
async function findSupportingRecordLink(page) {
    const period = widePeriodParam();
    for (const section of CANDIDATE_SECTIONS) {
        await page.goto(`/accounting-records.html?section=${section}&period=${encodeURIComponent(period)}`);
        await waitForRecordsReady(page);
        const link = page.locator('a.acct-records-link', { hasText: /View Bill|View Subscription/ }).first();
        if (await link.count()) {
            const href = (await link.getAttribute('href')) || '';
            const label = (await link.textContent() || '').trim();
            return { link, href, label, section };
        }
    }
    return null;
}

test('Accounting Records "View Bill/Subscription" link is record-centric and opens the record', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    // Land once to confirm an authenticated session exists.
    await page.goto('/accounting-records.html');
    await waitForRecordsReady(page);

    const found = await findSupportingRecordLink(page);
    test.skip(!found, 'QA account has no bill/subscription supporting records in the last ~12 months to exercise the click-through.');

    // The link must carry the record id, not just the bare destination page.
    expect(found.href, `link "${found.label}" should deep-link the record`).toMatch(/[?&]record=/);

    const isBill = /\/bill\b/.test(found.href);
    const isSubscription = /\/subscription\b/.test(found.href);
    expect(isBill || isSubscription, `unexpected destination: ${found.href}`).toBeTruthy();

    await found.link.click();
    await page.waitForURL(/[?&]record=/, { timeout: 20_000 });

    if (isBill) {
        // Bills open the detail drawer (range snaps to the bill's own month first).
        await expect(page.locator('#bill-drawer')).not.toHaveClass(/translate-x-full/, { timeout: 15_000 });
    } else {
        // Subscriptions load in full and highlight the located row.
        await page.waitForSelector('#sub-table-body', { timeout: 15_000 });
        const recordId = decodeURIComponent((found.href.match(/[?&]record=([^&]+)/) || [])[1] || '');
        await expect(page.locator(`#sub-table-body [data-subscription-id="${recordId}"]`))
            .toBeVisible({ timeout: 15_000 });
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
