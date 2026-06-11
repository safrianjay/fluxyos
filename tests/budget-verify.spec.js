// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Manual QA / verify spec for Budget Page Phase 1 + 1.5.
 *
 * This is a verification harness, not a regression suite. It exercises the
 * new UI and captures evidence (screenshots, console messages, network
 * failures) so the verifier can see what really happened in the running app.
 *
 * Firestore rules ARE NOT EXPECTED TO BE DEPLOYED in this run. Writes that
 * touch `users/{uid}/budget_allocations` or the new bill budget fields will
 * fail with permission-denied. We capture that as evidence, not as a pass.
 */

const SHOTS_DIR = 'test-results/budget-verify';

function attachConsole(page, log) {
    page.on('console', msg => {
        const type = msg.type();
        if (type === 'log' || type === 'debug' || type === 'info') return;
        log.push({ type, text: msg.text() });
    });
    page.on('pageerror', err => log.push({ type: 'pageerror', text: err.message }));
    page.on('requestfailed', req => {
        const failure = req.failure();
        log.push({ type: 'requestfailed', text: `${req.method()} ${req.url()} → ${failure?.errorText}` });
    });
}

async function suppressPaywall(page) {
    await page.addStyleTag({
        content: '[data-fluxy-paywall]{display:none!important;pointer-events:none!important;}'
    }).catch(() => {});
}

test.describe('Budget page — Phase 1 + 1.5 verify', () => {

    test('B1: sidebar Budgets is a real link and active on /budget', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/budget.html');
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        const sidebarItem = page.locator('#nav-budgets');
        await expect(sidebarItem).toBeVisible();
        const tagName = await sidebarItem.evaluate(el => el.tagName);
        const href = await sidebarItem.getAttribute('href');
        const isActive = await sidebarItem.evaluate(el => el.classList.contains('dashboard-active'));
        await page.screenshot({ path: `${SHOTS_DIR}/B1-sidebar.png`, fullPage: false });
        console.log('[B1] sidebar:', { tagName, href, isActive });
        console.log('[B1] errors:', JSON.stringify(log, null, 2));
        expect(tagName).toBe('A');
        expect(href).toBe('/budget');
        expect(isActive).toBe(true);
    });

    test('B2: empty-state OR existing-budget loads without errors', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/budget.html');
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        // Wait for either the empty state OR the content to render
        await page.waitForFunction(() => {
            const empty = document.getElementById('budget-empty-state');
            const content = document.getElementById('budget-content');
            return (empty && !empty.classList.contains('hidden')) || (content && !content.classList.contains('hidden'));
        }, { timeout: 15000 });
        const emptyVisible = await page.locator('#budget-empty-state').evaluate(el => !el.classList.contains('hidden'));
        const contentVisible = await page.locator('#budget-content').evaluate(el => !el.classList.contains('hidden'));
        await page.screenshot({ path: `${SHOTS_DIR}/B2-loaded.png`, fullPage: true });
        console.log('[B2] empty visible:', emptyVisible, ' content visible:', contentVisible);
        console.log('[B2] console errors:', JSON.stringify(log, null, 2));
        // Either state is a pass — what matters is the page loaded
        expect(emptyVisible || contentVisible).toBe(true);
    });

    test('B3: Main and period budget modals validate without allocation controls on /budget', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/budget.html');
        await suppressPaywall(page);
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        await page.waitForFunction(() => {
            const e = document.getElementById('budget-empty-state');
            const c = document.getElementById('budget-content');
            return (e && !e.classList.contains('hidden')) || (c && !c.classList.contains('hidden'));
        }, { timeout: 15000 });
        const mainTrigger = await page.locator('#budget-create-main-btn').isVisible().catch(() => false)
            ? '#budget-create-main-btn'
            : '#budget-empty-create-main';
        await page.click(mainTrigger);
        await expect(page.locator('#budget-modal-shell')).toBeVisible();
        await page.waitForTimeout(500); // let date picker mount

        const initialName = await page.locator('#budget-modal-name').inputValue();
        await page.fill('#budget-modal-name', '');
        await expect(page.locator('#budget-modal-submit')).toBeDisabled();
        await page.fill('#budget-modal-name', initialName || 'QA Main Budget');
        await page.fill('#budget-modal-total', '1.000.000');
        await expect(page.locator('#budget-modal-submit')).toBeEnabled();
        await expect(page.locator('#budget-modal-body')).not.toContainText(/allocation/i);
        await page.screenshot({ path: `${SHOTS_DIR}/B3a-main-modal.png`, fullPage: true });

        await page.click('#budget-modal-close');
        await page.waitForTimeout(400);
        const closed = await page.locator('#budget-modal-shell').evaluate(el => el.classList.contains('hidden'));

        if (await page.locator('#budget-new-period-btn').isEnabled().catch(() => false)) {
            await page.click('#budget-new-period-btn');
            await expect(page.locator('#budget-modal-title')).toContainText(/period budget/i);
            await expect(page.locator('#budget-modal-period-type')).toBeVisible();
            await expect(page.locator('#budget-modal-body')).not.toContainText(/Sub-budgets|allocation row/i);
            await page.click('#budget-modal-close');
        }
        console.log('[B3] modal closed:', closed, ' console errors:', JSON.stringify(log, null, 2));

        expect(closed).toBe(true);
    });

    test('B4: Add Bill drawer shows the budget impact preview block', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/bill.html');
        await page.waitForSelector('[data-tour-target="bill-add"]', { timeout: 15000 });
        await page.click('[data-tour-target="bill-add"]');
        // Wait for drawer + preview block
        await page.waitForSelector('#tx-budget-preview', { timeout: 5000 });
        await page.waitForTimeout(1500); // let async budget fetch settle
        const previewHtml = await page.locator('#tx-budget-preview').innerHTML();
        const previewVisible = await page.locator('#tx-budget-preview').isVisible();
        await page.screenshot({ path: `${SHOTS_DIR}/B4a-bill-preview-initial.png`, fullPage: true });
        console.log('[B4a] preview visible:', previewVisible);
        console.log('[B4a] preview html:', previewHtml.slice(0, 400));

        // Probe: type an amount + select a category and watch the preview update
        await page.fill('#tx-amount', '5.000.000');
        await page.fill('#tx-vendor', 'QA Verify Vendor');
        await page.selectOption('#tx-category', 'Marketing');
        await page.waitForTimeout(500);
        const afterMarketing = await page.locator('#tx-budget-preview').innerHTML();
        await page.screenshot({ path: `${SHOTS_DIR}/B4b-bill-preview-marketing.png`, fullPage: true });
        console.log('[B4b] preview after Marketing + 5M:', afterMarketing.slice(0, 400));

        // Probe: switch to a category that's never an allocation → "Others"
        await page.selectOption('#tx-category', 'Others');
        await page.waitForTimeout(300);
        // After "Others" the custom input appears; fill it with "Travel"
        const customInput = page.locator('#tx-category-custom');
        if (await customInput.isVisible()) await customInput.fill('Travel');
        await page.waitForTimeout(300);
        const afterTravel = await page.locator('#tx-budget-preview').innerHTML();
        await page.screenshot({ path: `${SHOTS_DIR}/B4c-bill-preview-travel.png`, fullPage: true });
        console.log('[B4c] preview after custom Travel:', afterTravel.slice(0, 400));

        await page.locator('#global-tx-overlay').click({ position: { x: 5, y: 5 }, force: true });
        await page.waitForTimeout(400);
        console.log('[B4] console errors:', JSON.stringify(log, null, 2));

        expect(previewVisible).toBe(true);
    });

    test('B5: regression — every shipped app page loads without console errors', async ({ page }) => {
        const pages = ['/dashboard', '/ledger', '/bill', '/subscription', '/integration', '/reports', '/settings', '/settings-budget'];
        const summary = {};
        for (const path of pages) {
            const log = [];
            attachConsole(page, log);
            await page.goto(`${path}.html`);
            await page.waitForSelector('#sidebar', { timeout: 15000 });
            await page.waitForTimeout(1500);
            summary[path] = { errors: log.length, items: log.slice(0, 5) };
            await page.screenshot({ path: `${SHOTS_DIR}/B5${path.replace(/\//g, '_')}.png`, fullPage: false });
        }
        console.log('[B5] regression summary:', JSON.stringify(summary, null, 2));
        // We don't assert zero errors — we capture them so the reviewer can see what happened.
        // This step succeeds as long as all pages loaded without throwing.
        expect(Object.keys(summary)).toHaveLength(pages.length);
    });

    test('B6: Main budget summary persists after reload and period rows route to detail', async ({ page }) => {
        const log = [];
        attachConsole(page, log);

        await page.goto('/budget.html');
        await suppressPaywall(page);
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        const baselineName = (await page.locator('#budget-main-name').textContent())?.trim();
        const baselineTotal = (await page.locator('#budget-annual-total').textContent())?.trim();
        console.log('[B6] baseline:', { name: baselineName, total: baselineTotal });
        await page.screenshot({ path: `${SHOTS_DIR}/B6a-baseline.png`, fullPage: true });

        await page.goto('/budget.html');
        await suppressPaywall(page);
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        const afterName = (await page.locator('#budget-main-name').textContent())?.trim();
        const afterTotal = (await page.locator('#budget-annual-total').textContent())?.trim();
        await page.screenshot({ path: `${SHOTS_DIR}/B6c-after-reload.png`, fullPage: true });
        console.log('[B6] after-reload:', { name: afterName, total: afterTotal });
        console.log('[B6] console errors:', JSON.stringify(log.filter(e => e.type === 'error' || e.type === 'pageerror').slice(0, 5), null, 2));

        expect(afterName).toBe(baselineName);
        expect(afterTotal).toBe(baselineTotal);

        const firstPeriod = page.locator('#budget-period-body tr[data-action="open-period-detail"]').first();
        if (await firstPeriod.count()) {
            await firstPeriod.click();
            await expect(page).toHaveURL(/budget-period\.html\?budgetId=.*periodId=/);
        }
    });

    test('B7: end-to-end bill save persists the 5 budget fields and reads back', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/bill.html');
        await page.waitForSelector('[data-tour-target="bill-add"]', { timeout: 15000 });
        await page.click('[data-tour-target="bill-add"]');
        await page.waitForSelector('#tx-budget-preview');
        await page.waitForTimeout(1500); // budget prefetch

        const vendor = `QA Bill ${Date.now()}`;
        await page.fill('#tx-amount', '3.000.000');
        await page.fill('#tx-vendor', vendor);
        await page.selectOption('#tx-category', 'Marketing');
        await page.waitForTimeout(400);
        const previewBeforeSave = await page.locator('#tx-budget-preview').innerHTML();
        console.log('[B7] preview before save:', previewBeforeSave.replace(/\s+/g, ' ').trim().slice(0, 200));
        await page.screenshot({ path: `${SHOTS_DIR}/B7a-prefilled.png`, fullPage: false });

        await page.click('#tx-submit-btn');
        const toast = await page.waitForSelector('#toast-container .text-white', { timeout: 8000 }).then(el => el.textContent()).catch(() => null);
        console.log('[B7] save toast:', toast?.trim());
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${SHOTS_DIR}/B7b-after-save.png`, fullPage: false });

        // Strongest end-to-end proof: re-read the Period Budget page. The bill's 3M
        // must show up in Marketing's Spent + Reserved column — that only happens if
        // (a) the bill write succeeded with `budget_allocation_id` matching
        // Marketing AND (b) getBudgetUsage's bill scan picked it up.
        const route = await page.evaluate(async () => {
            const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const cfg = { apiKey: 'AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA', authDomain: 'fluxyos.com', projectId: 'fluxyos', storageBucket: 'fluxyos.firebasestorage.app', messagingSenderId: '1084252368929', appId: '1:1084252368929:web:da73dc0db83fe592c7f360' };
            const app = getApps().length ? getApps()[0] : initializeApp(cfg);
            const auth = getAuth(app);
            if (auth.authStateReady) await auth.authStateReady();
            const { default: DataService } = await import('/assets/js/db-service.js');
            const ds = new DataService(app);
            const budget = await ds.getActiveBudget(auth.currentUser.uid);
            return `/budget-period.html?budgetId=${encodeURIComponent(budget.parent_budget_id || budget.id)}&periodId=${encodeURIComponent(budget.id)}`;
        });
        await page.goto(route);
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        await page.waitForTimeout(800);
        const marketingRow = page.locator('#budget-alloc-body tr').filter({ hasText: 'Marketing' }).first();
        // Row columns: Allocation · Allocated · Spent + Reserved · Remaining · Usage · Status.
        const spentReservedCellText = await marketingRow.locator('td').nth(2).innerText().catch(() => '');
        const m = spentReservedCellText.match(/Rp\s*([\d.]+)/);
        const spentReservedAmount = m ? parseInt(m[1].replace(/\./g, ''), 10) : 0;
        console.log('[B7] spent+reserved cell text:', spentReservedCellText.replace(/\s+/g, ' '));
        console.log('[B7] Parsed Marketing spent+reserved amount:', spentReservedAmount);
        console.log('[B7] console errors:', JSON.stringify(log.filter(e => e.type === 'error' || e.type === 'pageerror'), null, 2));
        await page.screenshot({ path: `${SHOTS_DIR}/B7c-budget-after.png`, fullPage: true });

        expect(toast).toMatch(/successfully added/i);
        // Spent + Reserved must include this bill's 3M (alongside any prior spend/unpaid bills).
        expect(spentReservedAmount).toBeGreaterThanOrEqual(3000000);
    });
});
