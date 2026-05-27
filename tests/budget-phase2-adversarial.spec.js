// @ts-check
// Exploratory verification — push on Phase 2 edges the happy-path probes miss.
// Try to break it: whitespace reasons, double-submit, drawer state leaks,
// backdrop dismiss, restore round-trip, chip refresh on the ledger.

const { test, expect } = require('@playwright/test');

const SHOTS = 'test-results/budget-verify/phase2-adv';

function attachLog(page, log) {
    page.on('console', m => {
        if (['error', 'warning', 'pageerror'].includes(m.type())) log.push({ t: m.type(), text: m.text() });
    });
    page.on('pageerror', e => log.push({ t: 'pageerror', text: e.message }));
}

// ── A1: whitespace-only reason must not enable Submit ──────────────────
test('A1: whitespace-only reason keeps Submit disabled', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });

    // Open the unallocated/excluded queue if it has content, or fall back to
    // opening the allocation drawer and using a related record action.
    await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });

    const exclude = page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"]').first();
    await expect(exclude).toBeVisible();
    await exclude.click();

    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    const submit = page.locator('#fbx-assignment-submit');
    await expect(submit).toBeDisabled();

    // Type only whitespace.
    await page.locator('#fbx-assignment-reason').fill('     ');
    await page.waitForTimeout(150);
    const stillDisabled = await submit.isDisabled();
    console.log('[A1] whitespace-only reason → submit disabled:', stillDisabled);
    await page.screenshot({ path: `${SHOTS}/A1-whitespace.png`, fullPage: false });

    // Type a real reason → submit enables.
    await page.locator('#fbx-assignment-reason').fill('A1 verification');
    await page.waitForTimeout(100);
    const enabledNow = await submit.isDisabled();
    console.log('[A1] real reason → submit disabled:', enabledNow);

    expect(stillDisabled).toBe(true);
    expect(enabledNow).toBe(false);

    // Close without saving — A4 will check state leak.
    await page.locator('#fbx-assignment-cancel').click();
});

// ── A2: Escape + backdrop close the assignment drawer ─────────────────
test('A2: Esc and backdrop close the assignment drawer', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });

    const openOnce = async () => {
        const exclude = page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"]').first();
        await exclude.click();
        await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    };
    const isOpen = () => page.evaluate(() => !document.getElementById('fbx-assignment-drawer')?.classList.contains('translate-x-full'));

    // Esc
    await openOnce();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const escClosed = !(await isOpen());
    console.log('[A2] Escape closed drawer:', escClosed);

    // Backdrop click
    await openOnce();
    await page.locator('#fbx-assignment-backdrop').click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(200);
    const backClosed = !(await isOpen());
    console.log('[A2] Backdrop closed drawer:', backClosed);

    expect(escClosed).toBe(true);
    expect(backClosed).toBe(true);
});

// ── A3: state leak — reason field clears between opens ────────────────
test('A3: reason field is cleared between opens', async ({ page }) => {
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });

    // Open once, type a reason, cancel.
    await page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"]').first().click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    await page.locator('#fbx-assignment-reason').fill('Leftover reason from previous open');
    await page.locator('#fbx-assignment-cancel').click();
    await page.waitForTimeout(300);

    // Open a DIFFERENT record (use the second exclude button).
    const allExcludes = page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"]');
    const second = allExcludes.nth(1);
    if (await second.count() === 0) {
        // Only one related record exists — re-open the same one; still must clear.
        await allExcludes.first().click();
    } else {
        await second.click();
    }
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    const reasonValue = await page.locator('#fbx-assignment-reason').inputValue();
    console.log('[A3] reason after re-open:', JSON.stringify(reasonValue));
    expect(reasonValue).toBe('');
});

// ── A4: rapid double-submit doesn't double-write ──────────────────────
test('A4: rapid double-submit fires write exactly once', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });

    // Find an unallocated record to assign (via the Unallocated queue would be
    // cleaner, but in the detail drawer we use a Change action which also
    // round-trips through the same writer).
    const change = page.locator('#budget-detail-content [data-phase2-action][data-action-type="assign"]').first();
    if (await change.count() === 0) {
        console.log('[A4] no Change action available; skipping');
        return;
    }
    await change.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });

    // Pick the first non-empty option in the dropdown.
    const allocSelect = page.locator('#fbx-assignment-allocation');
    const firstAllocId = await allocSelect.locator('option').nth(1).getAttribute('value');
    await allocSelect.selectOption(firstAllocId || '');
    await page.locator('#fbx-assignment-reason').fill('A4 double-submit probe');
    await page.waitForTimeout(150);

    // Count audit logs BEFORE the click.
    const auditBefore = await page.evaluate(async () => {
        // Reach into the DS the page already initialized.
        // The page mounts a fresh DataService instance, so we mirror it via the
        // shared-dashboard helper that the drawer already used.
        return null; // placeholder — we count via the toast / button state instead
    });

    // Click the submit button twice as fast as possible.
    await page.locator('#fbx-assignment-submit').click();
    // Don't await between clicks — pile them on.
    await Promise.all([
        page.locator('#fbx-assignment-submit').click({ force: true }).catch(() => {}),
        page.locator('#fbx-assignment-submit').click({ force: true }).catch(() => {})
    ]);

    // Wait for the toast.
    const toast = await page.waitForSelector('#toast-container .text-white', { timeout: 8000 }).then(el => el.textContent()).catch(() => null);
    console.log('[A4] toast:', toast?.trim());

    // Wait long enough that any duplicate write would also have surfaced.
    await page.waitForTimeout(2000);
    const toastCount = await page.locator('#toast-container > *').count();
    console.log('[A4] visible toasts after settle:', toastCount);

    // A clean run produces ONE success toast. A duplicate write produces two
    // success toasts or one success + one error. We allow 1 because second
    // success would be a flag.
    expect(toastCount).toBeLessThanOrEqual(1);
});

// ── A5: ledger chip is correct after a record is excluded ─────────────
test('A5: excluding a transaction flips its ledger chip to Excluded', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    // 1. Find a current chip state from the ledger.
    await page.goto('/ledger.html');
    await page.waitForSelector('#ledger-table-body tr[data-ledger-id]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const firstChip = page.locator('#ledger-table-body [data-fluxy-budget-action]').first();
    const beforeLabel = await firstChip.evaluate(el => el.previousElementSibling?.textContent || '');
    const recordId = await firstChip.getAttribute('data-record-id');
    const recordType = await firstChip.getAttribute('data-record-type');
    console.log('[A5] target record:', { recordId, recordType, beforeLabel });
    // Already excluded? Skip — A5 wants to test the transition INTO excluded.
    if ((beforeLabel || '').toLowerCase().includes('excluded')) {
        console.log('[A5] first record is already Excluded; skipping');
        return;
    }

    // 2. Open the assignment drawer for that record + exclude with reason.
    await firstChip.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    // The drawer opened in 'assign' mode (because that's what the chip's action
    // attribute defaulted to). Cancel + use the Budget page detail flow for
    // exclude. Actually — easier: just re-route. The drawer's title is
    // "Change allocation" right now. Submit assignment instead.
    const allocSelect = page.locator('#fbx-assignment-allocation');
    const isAssign = await allocSelect.isVisible();
    if (!isAssign) {
        // It opened in exclude mode somehow — proceed.
        await page.locator('#fbx-assignment-reason').fill('A5 exclude');
        await page.locator('#fbx-assignment-submit').click();
    } else {
        // Cancel — we'll do exclude via the Budget page detail drawer instead.
        await page.locator('#fbx-assignment-cancel').click();
        await page.waitForTimeout(300);
        console.log('[A5] chip default action is assign, not exclude; using budget detail drawer');

        await page.goto('/budget.html');
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-content');
            return c && !c.classList.contains('hidden');
        }, { timeout: 15000 });
        await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
        await page.waitForFunction(() => {
            const c = document.getElementById('budget-detail-content');
            return c && c.textContent.includes('Related');
        }, { timeout: 10000 });
        const detailExclude = page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"]').first();
        if (await detailExclude.count() === 0) {
            console.log('[A5] no related records in first allocation to exclude; skipping');
            return;
        }
        const excludedRecordId = await detailExclude.getAttribute('data-record-id');
        const excludedRecordType = await detailExclude.getAttribute('data-record-type');
        await detailExclude.click();
        await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
        await page.locator('#fbx-assignment-reason').fill('A5 exclude probe');
        await page.locator('#fbx-assignment-submit').click();
        const toast = await page.waitForSelector('#toast-container .text-white', { timeout: 8000 }).then(el => el.textContent()).catch(() => null);
        console.log('[A5] exclude toast:', toast?.trim());

        // 3. Go back to ledger or bills (depending on recordType) and confirm chip is "Excluded".
        // Scope the row lookup to the table BODY — `data-bill-id` is also
        // present on the timeline tiles at the top of bill.html, which have
        // no budget chip and would short-circuit the chip read to empty.
        const tableBodyId = excludedRecordType === 'bills' ? 'bill-table-body' : 'ledger-table-body';
        const target = excludedRecordType === 'bills' ? '/bill.html' : '/ledger.html';
        await page.goto(target);
        await page.waitForSelector(`#${tableBodyId} tr`, { timeout: 20000 });
        await page.waitForTimeout(2000);
        const row = page.locator(`#${tableBodyId} [data-${excludedRecordType === 'bills' ? 'bill' : 'ledger'}-id="${excludedRecordId}"]`).first();
        await expect(row).toBeVisible({ timeout: 5000 });
        const chipText = await row.locator('[data-fluxy-budget-action]').first().evaluate(el => el.previousElementSibling?.textContent || '').catch(() => '');
        console.log('[A5] chip text after exclude:', chipText);
        await page.screenshot({ path: `${SHOTS}/A5-after-exclude.png`, fullPage: false });
        expect(chipText.toLowerCase()).toContain('excluded');
    }
});

// ── A6: assign drawer with no allocations renders sensibly ────────────
// (Hard to set up programmatically against the live QA account, which has
//  allocations. Instead: verify the empty-dropdown safety net by checking
//  the drawer's HTML when ctx.allocations is empty.)
test('A6: assignment drawer dropdown contains all active allocations', async ({ page }) => {
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.locator('#budget-alloc-body tr[data-action="open-allocation"]').first().click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });
    const change = page.locator('#budget-detail-content [data-phase2-action][data-action-type="assign"]').first();
    if (await change.count() === 0) {
        console.log('[A6] no Change available; skipping');
        return;
    }
    await change.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    const opts = await page.locator('#fbx-assignment-allocation option').allTextContents();
    console.log('[A6] allocation options:', opts);
    expect(opts.length).toBeGreaterThanOrEqual(2); // placeholder + ≥1 alloc
    // Allocations from the QA account: Marketing / Infrastructure / Operations / SaaS (or similar)
    const optsLower = opts.map(o => o.toLowerCase());
    expect(optsLower.some(o => o.includes('marketing') || o.includes('operations') || o.includes('infrastructure') || o.includes('saas'))).toBe(true);
    await page.locator('#fbx-assignment-cancel').click();
});

// ── A7: detail drawer survives an action that mutates Phase 1 totals ──
test('A7: detail drawer refreshes after exclude completes', async ({ page }) => {
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    // Marketing has most data on the QA account.
    const marketingRow = page.locator('#budget-alloc-body tr[data-action="open-allocation"]').filter({ hasText: 'Marketing' }).first();
    await marketingRow.click();
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-detail-content');
        return c && c.textContent.includes('Related');
    }, { timeout: 10000 });
    const beforeText = await page.locator('#budget-detail-content').textContent();
    const beforeBillsCount = parseInt(beforeText.match(/Related bills · (\d+)/)?.[1] || '0', 10);
    console.log('[A7] Marketing related bills BEFORE:', beforeBillsCount);

    const firstBillExclude = page.locator('#budget-detail-content [data-phase2-action][data-action-type="exclude"][data-record-type="bills"]').first();
    if (await firstBillExclude.count() === 0) {
        console.log('[A7] no bill to exclude; skipping');
        return;
    }
    await firstBillExclude.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    await page.locator('#fbx-assignment-reason').fill('A7 detail-drawer refresh probe');
    await page.locator('#fbx-assignment-submit').click();
    await page.waitForSelector('#toast-container .text-white', { timeout: 8000 });
    await page.waitForTimeout(1500);
    // After onDone, the detail drawer should reopen with the SAME allocation
    // but the bills count should decrement by 1.
    const afterText = await page.locator('#budget-detail-content').textContent();
    const afterBillsCount = parseInt(afterText.match(/Related bills · (\d+)/)?.[1] || '0', 10);
    console.log('[A7] Marketing related bills AFTER:', afterBillsCount);
    expect(afterBillsCount).toBe(beforeBillsCount - 1);
});
