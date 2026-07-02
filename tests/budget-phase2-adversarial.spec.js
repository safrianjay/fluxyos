// @ts-check
// Exploratory verification — push on Phase 2 edges the happy-path probes miss.
// Try to break it: whitespace reasons, double-submit, drawer state leaks,
// backdrop dismiss, restore round-trip, chip refresh on the ledger.
//
// Entry points (post-Phase C): the assignment drawer opens from the ledger/bill
// row chips (`[data-fluxy-budget-action]`, action = assign | restore) and the
// Excluded records card on /budget-period (restore only). The legacy budget
// detail drawer and the Unallocated queue — the old exclude entry points —
// were removed, so these probes drive the drawer through the chips instead.

const { test, expect } = require('@playwright/test');

const SHOTS = 'test-results/budget-verify/phase2-adv';

function attachLog(page, log) {
    page.on('console', m => {
        if (['error', 'warning', 'pageerror'].includes(m.type())) log.push({ t: m.type(), text: m.text() });
    });
    page.on('pageerror', e => log.push({ t: 'pageerror', text: e.message }));
}

async function suppressPaywall(page) {
    await page.addStyleTag({
        content: '[data-fluxy-paywall]{display:none!important;pointer-events:none!important;}'
    }).catch(() => {});
}

// Open the assignment drawer from the first matching ledger chip.
// `action` narrows to a specific chip mode ('assign' | 'restore'); omit for any.
async function openDrawerViaLedgerChip(page, action) {
    const selector = action
        ? `#ledger-table-body [data-fluxy-budget-action="${action}"]`
        : '#ledger-table-body [data-fluxy-budget-action]';
    await page.goto('/ledger.html');
    await page.waitForSelector('#ledger-table-body tr[data-ledger-id]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const chip = page.locator(selector).first();
    if (await chip.count() === 0) return null;
    await chip.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    return chip;
}

// In assign mode the Submit gate also needs an allocation; pick the current
// one when preselected, else the first real option, so only the reason field
// controls the disabled state under test.
async function ensureAllocationSelected(page) {
    const allocSelect = page.locator('#fbx-assignment-allocation');
    if (!(await allocSelect.isVisible())) return;
    const value = await allocSelect.inputValue();
    if (value) return;
    const firstAllocId = await allocSelect.locator('option').nth(1).getAttribute('value');
    if (firstAllocId) await allocSelect.selectOption(firstAllocId);
}

// Navigate /budget.html → first period row → /budget-period/:id (Phase C route).
async function openFirstPeriodDetail(page) {
    await page.goto('/budget.html');
    await suppressPaywall(page);
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    const firstPeriod = page.locator('#budget-period-body tr[data-action="open-period-detail"]').first();
    await expect(firstPeriod).toBeVisible();
    await firstPeriod.click();
    await expect(page).toHaveURL(/\/budget-period\//);
    await suppressPaywall(page);
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.waitForTimeout(1200);
}

// ── A1: whitespace-only reason must not enable Submit ──────────────────
test('A1: whitespace-only reason keeps Submit disabled', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    const chip = await openDrawerViaLedgerChip(page);
    expect(chip, 'ledger should expose at least one budget chip').not.toBeNull();
    await ensureAllocationSelected(page);

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

    // Close without saving — A3 will check state leak.
    await page.locator('#fbx-assignment-cancel').click();
});

// ── A2: Escape + backdrop close the assignment drawer ─────────────────
test('A2: Esc and backdrop close the assignment drawer', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    const chip = await openDrawerViaLedgerChip(page);
    expect(chip, 'ledger should expose at least one budget chip').not.toBeNull();

    const isOpen = () => page.evaluate(() => !document.getElementById('fbx-assignment-drawer')?.classList.contains('translate-x-full'));
    const reopen = async () => {
        await chip.click();
        await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    };

    // Esc
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const escClosed = !(await isOpen());
    console.log('[A2] Escape closed drawer:', escClosed);

    // Backdrop click
    await reopen();
    await page.locator('#fbx-assignment-backdrop').click({ position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);
    const backClosed = !(await isOpen());
    console.log('[A2] Backdrop closed drawer:', backClosed);

    expect(escClosed).toBe(true);
    expect(backClosed).toBe(true);
});

// ── A3: state leak — reason field clears between opens ────────────────
test('A3: reason field is cleared between opens', async ({ page }) => {
    const chip = await openDrawerViaLedgerChip(page);
    expect(chip, 'ledger should expose at least one budget chip').not.toBeNull();

    // Type a reason, cancel.
    await page.locator('#fbx-assignment-reason').fill('Leftover reason from previous open');
    await page.locator('#fbx-assignment-cancel').click();
    await page.waitForTimeout(300);

    // Open a DIFFERENT record's chip when one exists; re-opening the same
    // record must clear the field just the same.
    const allChips = page.locator('#ledger-table-body [data-fluxy-budget-action]');
    const second = allChips.nth(1);
    if (await second.count() > 0) {
        await second.click();
    } else {
        await allChips.first().click();
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
    const chip = await openDrawerViaLedgerChip(page, 'assign');
    if (!chip) {
        console.log('[A4] no assign chip on the ledger; skipping');
        return;
    }
    await ensureAllocationSelected(page);
    await page.locator('#fbx-assignment-reason').fill('A4 double-submit probe');
    await page.waitForTimeout(150);

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
    // success toasts or one success + one error. We allow 1 because a second
    // success would be a flag.
    expect(toastCount).toBeLessThanOrEqual(1);
});

// ── A5: restore round-trip — excluded card + ledger/bill chip agree ───
// Exclude no longer has a primary UI entry (the legacy detail drawer and the
// Unallocated queue were removed), so the transition INTO excluded is not
// drivable from the UI. Probe the reverse: restore an excluded record from the
// /budget-period Excluded card, confirm the card refreshes (old A7's intent)
// and the record's row chip no longer reads Excluded.
test('A5: restoring an excluded record refreshes the card and flips its chip', async ({ page }) => {
    const log = [];
    attachLog(page, log);
    await openFirstPeriodDetail(page);

    const excludedCard = page.locator('#budget-excluded-card');
    if (await excludedCard.count() === 0 || !(await excludedCard.isVisible())) {
        console.log('[A5] no excluded records on the QA account; skipping');
        return;
    }
    // The card body is a collapsible that starts collapsed — expand it first.
    await page.locator('#budget-excluded-toggle').click();
    await expect(page.locator('#budget-excluded-body')).toBeVisible();
    const restoreButtons = page.locator('#budget-excluded-body [data-phase2-action][data-action-type="restore"]');
    const beforeCount = await restoreButtons.count();
    const firstRestore = restoreButtons.first();
    const recordId = await firstRestore.getAttribute('data-record-id');
    const recordType = await firstRestore.getAttribute('data-record-type');
    console.log('[A5] restoring record:', { recordId, recordType, beforeCount });

    await firstRestore.click();
    await page.waitForSelector('#fbx-assignment-drawer:not(.translate-x-full)', { timeout: 5000 });
    await expect(page.locator('#fbx-assignment-title')).toHaveText('Restore to budget');
    await page.locator('#fbx-assignment-reason').fill('A5 restore round-trip probe');
    await page.locator('#fbx-assignment-submit').click();
    const toast = await page.waitForSelector('#toast-container .text-white', { timeout: 8000 }).then(el => el.textContent()).catch(() => null);
    console.log('[A5] restore toast:', toast?.trim());

    // onDone → loadAndRender re-renders the Excluded card: one fewer row, or
    // the card hides when that was the last excluded record.
    await page.waitForTimeout(2500);
    const afterCount = (await excludedCard.isVisible()) ? await restoreButtons.count() : 0;
    console.log('[A5] excluded rows before/after:', beforeCount, afterCount);
    expect(afterCount).toBe(beforeCount - 1);

    // The record's row chip must not read Excluded any more.
    // Scope the row lookup to the table BODY — `data-bill-id` is also present
    // on the timeline tiles at the top of bill.html, which have no budget chip
    // and would short-circuit the chip read to empty.
    const tableBodyId = recordType === 'bills' ? 'bill-table-body' : 'ledger-table-body';
    const target = recordType === 'bills' ? '/bill.html' : '/ledger.html';
    await page.goto(target);
    await page.waitForSelector(`#${tableBodyId} tr`, { timeout: 20000 });
    await page.waitForTimeout(2000);
    const row = page.locator(`#${tableBodyId} [data-${recordType === 'bills' ? 'bill' : 'ledger'}-id="${recordId}"]`).first();
    if (await row.count() === 0) {
        console.log('[A5] restored record not on the first page of the table; card refresh already verified');
        return;
    }
    const chipText = await row.locator('[data-fluxy-budget-action]').first().evaluate(el => el.previousElementSibling?.textContent || '').catch(() => '');
    console.log('[A5] chip text after restore:', chipText);
    await page.screenshot({ path: `${SHOTS}/A5-after-restore.png`, fullPage: false });
    expect(chipText.toLowerCase()).not.toContain('excluded');
});

// ── A6: assign drawer dropdown lists the active allocations ───────────
test('A6: assignment drawer dropdown contains all active allocations', async ({ page }) => {
    const chip = await openDrawerViaLedgerChip(page, 'assign');
    if (!chip) {
        console.log('[A6] no assign chip on the ledger; skipping');
        return;
    }
    const opts = await page.locator('#fbx-assignment-allocation option').allTextContents();
    console.log('[A6] allocation options:', opts);
    expect(opts.length).toBeGreaterThanOrEqual(2); // placeholder + ≥1 alloc
    // Allocations from the QA account: Marketing / Infrastructure / Operations / SaaS (or similar)
    const optsLower = opts.map(o => o.toLowerCase());
    expect(optsLower.some(o => o.includes('marketing') || o.includes('operations') || o.includes('infrastructure') || o.includes('saas'))).toBe(true);
    await page.locator('#fbx-assignment-cancel').click();
});
