// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Editing a transaction must be able to move which account it posts to.
 *
 * buildJournal honours an explicit `account_code` over the category mapping
 * (explicitAccount() in accounting-engine.js) — deliberately, so a hand-picked
 * account beats a guess. Every transaction created since the CoA picker shipped
 * carries one, so before the Edit form had an Account field a recategorised
 * transaction kept posting to its original account: the row read
 * "Infrastructure" while the journal still hit Cost of Goods Sold, with no way
 * to correct it short of voiding.
 *
 * Double-entry itself was never at risk (the edit path reverses and reposts a
 * balanced journal); what broke was faithful classification. These tests pin
 * both: the account moves, and the ledger stays balanced while it does.
 */

async function ctxReady(page) {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.__fluxyTxContext?.auth?.currentUser, null, { timeout: 30_000 });
}

/** Read the transaction plus the accounts its current journal posts to. */
async function readPosting(page, txId) {
    return page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const uid = ctx.auth.currentUser.uid;
        const snap = await getDoc(doc(ctx.ds.db, `${ctx.ds._scope(uid)}/transactions/${id}`));
        const d = snap.data() || {};
        const j = d.journal_ref ? await ctx.ds.getJournalById(uid, d.journal_ref) : null;
        return {
            category: d.category,
            account_code: d.account_code || null,
            journalAccounts: (j?.lines || []).map((l) => l.account_code),
            balanced: j?.is_balanced ?? null,
            totalDebit: j?.total_debit ?? null,
            totalCredit: j?.total_credit ?? null
        };
    }, txId);
}

test('recategorising through the Edit form moves the journal to the new account', async ({ page }) => {
    await ctxReady(page);

    // Seed a transaction pinned to a real expense account, as the Add drawer and
    // the scan review both do.
    const seed = await page.evaluate(async () => {
        const ctx = window.__fluxyTxContext;
        const uid = ctx.auth.currentUser.uid;
        const coa = await ctx.ds.getChartOfAccounts(uid);
        const expenses = coa.filter((a) => a.type === 'expense' && a.status !== 'archived');
        const pinned = expenses.find((a) => a.code === '5100') || expenses[0];
        const ref = await ctx.ds.addTransaction(uid, {
            vendor_name: `COA edit ${Date.now()}`, amount: 100000, category: 'Marketing',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}',
            account_code: pinned.code, account_name: pinned.name
        });
        return { id: ref.id, pinnedCode: pinned.code };
    });

    const before = await readPosting(page, seed.id);
    expect(before.journalAccounts).toContain(seed.pinnedCode);

    // Open the record and switch to the Edit form.
    await page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const row = await ctx.ds.getTransactionById(ctx.auth.currentUser.uid, id);
        window.openTxDetailDrawer(row);
    }, seed.id);
    await page.locator('#tx-detail-edit-btn').click();

    // The Account field exists and is pre-filled with what the record posts to.
    const picker = page.locator('[data-tx-edit-account-mount]');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    await expect(picker).toContainText(seed.pinnedCode, { timeout: 15_000 });

    // Recategorise; the account re-suggests to match the new category.
    await page.locator('#tx-edit-category').fill('Infrastructure');
    await page.locator('#tx-edit-category').dispatchEvent('change');
    await expect(picker).not.toContainText(seed.pinnedCode, { timeout: 15_000 });

    await page.locator('#tx-edit-reason').fill('QA: recategorise to Infrastructure');
    await page.locator('#tx-edit-save-btn').click();
    await expect(page.locator('#tx-detail-overlay')).toBeHidden({ timeout: 30_000 });

    const after = await readPosting(page, seed.id);
    expect(after.category).toBe('Infrastructure');
    expect(after.account_code, 'the pinned account must move with the category').not.toBe(before.account_code);
    expect(after.journalAccounts, 'the journal must stop posting to the old account').not.toContain(seed.pinnedCode);
    expect(after.journalAccounts).toContain(after.account_code);
    // Double-entry was never the thing at risk — assert it stayed intact anyway.
    expect(after.balanced).toBe(true);
    expect(after.totalDebit).toBe(after.totalCredit);
});

test('an account chosen by hand survives a later category edit', async ({ page }) => {
    await ctxReady(page);

    const seed = await page.evaluate(async () => {
        const ctx = window.__fluxyTxContext;
        const uid = ctx.auth.currentUser.uid;
        const ref = await ctx.ds.addTransaction(uid, {
            vendor_name: `COA manual ${Date.now()}`, amount: 55000, category: 'Marketing',
            type: 'expense', status: 'Completed', icon: '\u{1F4B8}'
        });
        const coa = await ctx.ds.getChartOfAccounts(uid);
        const expenses = coa.filter((a) => a.type === 'expense' && a.status !== 'archived');
        return { id: ref.id, target: expenses[expenses.length - 1] };
    });

    await page.evaluate(async (id) => {
        const ctx = window.__fluxyTxContext;
        const row = await ctx.ds.getTransactionById(ctx.auth.currentUser.uid, id);
        window.openTxDetailDrawer(row);
    }, seed.id);
    await page.locator('#tx-detail-edit-btn').click();
    await expect(page.locator('[data-tx-edit-account-mount]')).toBeVisible({ timeout: 15_000 });

    // Pick an account through the real picker (poking the hidden input would not
    // fire the picker's own onChange, so the override would not register), then
    // change the category. The explicit choice must win — that precedence is the
    // whole point of explicitAccount().
    await page.locator('[data-tx-edit-account-mount] .fluxy-acct-trigger').click();
    await page.locator('.fluxy-acct-menu .fluxy-acct-search').fill(seed.target.code);
    await page.locator('.fluxy-acct-menu .fluxy-acct-option').first().click();
    await expect(page.locator('[data-tx-edit-account-mount]')).toContainText(seed.target.code);

    await page.locator('#tx-edit-category').fill('Operations');
    await page.locator('#tx-edit-category').dispatchEvent('change');
    // Give any (incorrect) re-suggestion a chance to fire before asserting.
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-tx-edit-account-mount]')).toContainText(seed.target.code);

    await page.locator('#tx-edit-reason').fill('QA: manual account pin');
    await page.locator('#tx-edit-save-btn').click();
    await expect(page.locator('#tx-detail-overlay')).toBeHidden({ timeout: 30_000 });

    const after = await readPosting(page, seed.id);
    expect(after.account_code, 'a hand-picked account is not overridden by the category').toBe(seed.target.code);
    expect(after.journalAccounts).toContain(seed.target.code);
    expect(after.balanced).toBe(true);
});
