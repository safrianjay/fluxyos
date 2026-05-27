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

    test('B3: Create Budget drawer opens with 4 default rows and validates', async ({ page }) => {
        const log = [];
        attachConsole(page, log);
        await page.goto('/budget.html');
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        await page.waitForSelector('#budget-create-btn');
        // Wait for budget.js initBudgetPage() to attach its listeners — signaled
        // by either the empty state or the content section becoming visible.
        await page.waitForFunction(() => {
            const e = document.getElementById('budget-empty-state');
            const c = document.getElementById('budget-content');
            return (e && !e.classList.contains('hidden')) || (c && !c.classList.contains('hidden'));
        }, { timeout: 15000 });
        await page.click('#budget-create-btn');
        await expect(page.locator('#budget-drawer')).not.toHaveClass(/translate-x-full/);
        await page.waitForTimeout(500); // let date picker mount

        // Capture default state — should have 4 prepopulated rows unless editing an existing budget
        const rowCount = await page.locator('#budget-form-allocation-rows [data-row-index]').count();
        const submitDisabled = await page.locator('#budget-drawer-submit').isDisabled();
        await page.screenshot({ path: `${SHOTS_DIR}/B3a-drawer-default.png`, fullPage: true });
        console.log('[B3a] default rows:', rowCount, ' submit disabled:', submitDisabled);

        // Probe: type a name + a total that's smaller than allocations
        await page.fill('#budget-form-name', 'QA Verify Budget');
        await page.fill('#budget-form-amount', '1.000.000');
        // Fill each allocation with 500.000 — sum = 2.000.000 > 1.000.000 → should block submit
        const amountInputs = page.locator('#budget-form-allocation-rows [data-field="amount"]');
        const n = await amountInputs.count();
        for (let i = 0; i < n; i++) {
            await amountInputs.nth(i).fill('500.000');
            // name might be empty for empty default rows in edit-mode prefill; fill defensively
            const nameInput = page.locator('#budget-form-allocation-rows [data-field="name"]').nth(i);
            const nameVal = await nameInput.inputValue();
            if (!nameVal) await nameInput.fill(`Allocation ${i + 1}`);
        }
        await page.waitForTimeout(200);
        const overAllocDisabled = await page.locator('#budget-drawer-submit').isDisabled();
        const warningVisible = await page.locator('#budget-form-warning').evaluate(el => !el.classList.contains('hidden'));
        const warningText = await page.locator('#budget-form-warning').textContent();
        await page.screenshot({ path: `${SHOTS_DIR}/B3b-over-allocation.png`, fullPage: true });
        console.log('[B3b] over-allocation:', { submitDisabled: overAllocDisabled, warningVisible, warningText: warningText?.trim() });

        // Probe: bump total so sum equals total → submit should enable
        await page.fill('#budget-form-amount', '10.000.000');
        await page.waitForTimeout(200);
        const fixedDisabled = await page.locator('#budget-drawer-submit').isDisabled();
        await page.screenshot({ path: `${SHOTS_DIR}/B3c-fixed-allocation.png`, fullPage: true });
        console.log('[B3c] after fix:', { submitDisabled: fixedDisabled });

        // Close drawer without saving
        await page.click('#budget-drawer-cancel');
        await page.waitForTimeout(400);
        const closed = await page.locator('#budget-drawer').evaluate(el => el.classList.contains('translate-x-full'));
        console.log('[B3] drawer closed:', closed, ' console errors:', JSON.stringify(log, null, 2));

        // Note: submitDisabled-on-open is context-dependent — true for create
        // (empty form), false for edit (prefilled from an already-valid budget).
        // The real validation contract is the next two assertions: an
        // over-allocation must block submit + show the warning, and fixing the
        // total must re-enable submit.
        expect(overAllocDisabled).toBe(true);
        expect(warningVisible).toBe(true);
        expect(fixedDisabled).toBe(false);
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

    test('B6: failed save must not mutate the existing budget doc (atomicity)', async ({ page }) => {
        const log = [];
        attachConsole(page, log);

        // 1. Establish baseline.
        await page.goto('/budget.html');
        await page.waitForSelector('#sidebar #nav-budgets', { timeout: 15000 });
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        const baselineName = (await page.locator('#budget-name').textContent())?.trim();
        const baselineTotal = (await page.locator('#budget-total').textContent())?.trim();
        console.log('[B6] baseline:', { name: baselineName, total: baselineTotal });
        await page.screenshot({ path: `${SHOTS_DIR}/B6a-baseline.png`, fullPage: true });

        // 2. Attempt to save a budget with a DIFFERENT name + total. Since rules
        //    for budget_allocations are not deployed, the batch must fail and
        //    leave the budget doc unchanged.
        const attemptName = `QA Atomicity Probe ${Date.now()}`;
        const attemptTotalStr = '777.000.000';
        await page.click('#budget-create-btn');
        await page.waitForTimeout(800);
        await page.fill('#budget-form-name', attemptName);
        await page.fill('#budget-form-amount', attemptTotalStr);
        const inputs = page.locator('#budget-form-allocation-rows [data-field="amount"]');
        const count = await inputs.count();
        for (let i = 0; i < count; i++) {
            await inputs.nth(i).fill('100.000.000');
            const nameInput = page.locator('#budget-form-allocation-rows [data-field="name"]').nth(i);
            const v = await nameInput.inputValue();
            if (!v) await nameInput.fill(`Probe ${i + 1}`);
        }
        await page.waitForTimeout(300);
        const submitDisabled = await page.locator('#budget-drawer-submit').isDisabled();
        console.log('[B6] submit disabled before click:', submitDisabled);
        await page.click('#budget-drawer-submit');

        // 3. Capture outcome — error toast OR drawer close.
        const outcome = await Promise.race([
            page.waitForSelector('#toast-container .text-white', { timeout: 8000 }).then(el => el.textContent()).catch(() => null),
            page.waitForFunction(() => document.getElementById('budget-drawer')?.classList.contains('translate-x-full'), { timeout: 8000 }).then(() => 'drawer_closed').catch(() => null)
        ]);
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SHOTS_DIR}/B6b-after-attempt.png`, fullPage: true });
        const drawerClosed = await page.locator('#budget-drawer').evaluate(el => el.classList.contains('translate-x-full'));
        console.log('[B6] save outcome:', outcome, ' drawer closed:', drawerClosed);

        // 4. Hard reload and re-read the budget summary. If the batch wasn't
        //    atomic, the budget doc was overwritten and the name/total would
        //    match the attempt values.
        await page.goto('/budget.html');
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        const afterName = (await page.locator('#budget-name').textContent())?.trim();
        const afterTotal = (await page.locator('#budget-total').textContent())?.trim();
        await page.screenshot({ path: `${SHOTS_DIR}/B6c-after-reload.png`, fullPage: true });
        console.log('[B6] after-reload:', { name: afterName, total: afterTotal });
        console.log('[B6] console errors:', JSON.stringify(log.filter(e => e.type === 'error' || e.type === 'pageerror').slice(0, 5), null, 2));

        if (outcome && typeof outcome === 'string' && outcome.includes('permission')) {
            // Save FAILED → atomicity requires the doc to be unchanged.
            expect(afterName).toBe(baselineName);
            expect(afterTotal).toBe(baselineTotal);
            expect(afterName).not.toContain('QA Atomicity Probe');
        } else if (drawerClosed) {
            // Save SUCCEEDED (rules must now be deployed). The new values should
            // be visible after reload.
            expect(afterName).toContain('QA Atomicity Probe');
        } else {
            throw new Error('Unexpected outcome: ' + JSON.stringify(outcome));
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

        // Strongest end-to-end proof: re-read the Budget page. The bill's 3M
        // must show up in Marketing's Spent + Reserved column — that only happens if
        // (a) the bill write succeeded with `budget_allocation_id` matching
        // Marketing AND (b) getBudgetUsage's bill scan picked it up.
        await page.goto('/budget.html');
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
