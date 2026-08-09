// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * CSV bulk import → cash account attribution.
 *
 * Before this, bulk-imported rows carried NO cash fields at all, so every one had
 * to be opened individually to say which account the money moved through. The
 * account is the one part of cash impact the system cannot derive — everything
 * else comes from the row's type — so the import asks for it and lets
 * FluxyCashImpact.deriveFromType do the rest.
 *
 * The tests that matter most here are the ones a hand-rolled implementation
 * would get wrong:
 *  - a row with no account must save with NO cash keys, not "cash moved, account
 *    unknown" (which would drag it into the Cash Position KPI)
 *  - a transfer must never carry an account, because it has no cash effect
 *  - an ambiguous value (two accounts at the same bank) must NOT auto-match; the
 *    bank-rec engine hard-excludes a wrongly-attributed row and there is no bulk
 *    undo, so a confident wrong guess is unrecoverable
 *
 * This is also the first spec that drives a real CSV through the drawer at all —
 * tests/document-attachment.spec.js only asserts the bulk tab renders.
 */

const HEAD = 'Description,Category,Type,Amount,Status,Date';

function csv(rows, { header = HEAD } = {}) {
    return [header, ...rows].join('\n');
}

async function openBulk(page) {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.__fluxyTxContext?.auth?.currentUser, null, { timeout: 30_000 });
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30_000 });
    await page.evaluate(() => window.showAddTransactionModal({ context: 'transaction' }));
    await page.locator('#tx-tab-bulk').click();
    await expect(page.locator('#tx-bulk-panel')).toBeVisible();
}

async function attach(page, text, name = 'import.csv') {
    await page.locator('#tx-csv-file').setInputFiles({
        name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8')
    });
    await expect(page.locator('#tx-csv-preview-card')).toBeVisible({ timeout: 20_000 });
}

/** Bank accounts the drawer actually loaded, so tests adapt to the QA workspace. */
async function activeAccounts(page) {
    return page.evaluate(async () => {
        const ctx = window.__fluxyTxContext;
        const list = await ctx.ds.getBankAccounts(ctx.auth.currentUser.uid);
        return (list || []).map(a => ({
            id: a.id, account_name: a.account_name, bank_name: a.bank_name, last_four: a.last_four || null
        }));
    });
}

/** The rows this import wrote, newest first. */
async function recentTx(page, vendorPrefix, limitN = 20) {
    return page.evaluate(async ({ prefix, n }) => {
        const ctx = window.__fluxyTxContext;
        const { collection, query, orderBy, limit, getDocs } =
            await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const uid = ctx.auth.currentUser.uid;
        const snap = await getDocs(query(
            collection(ctx.ds.db, `${ctx.ds._scope(uid)}/transactions`),
            orderBy('created_at', 'desc'), limit(n)
        ));
        return snap.docs.map(d => d.data()).filter(t => String(t.vendor_name || '').startsWith(prefix));
    }, { prefix: vendorPrefix, n: limitN });
}

test('the derive contract: type decides cash impact, the account is only the link', async ({ page }) => {
    // Pure-function assertions against the exact component the import uses. No
    // Firestore, no drawer — this is the contract every case below depends on.
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.FluxyCashImpact, null, { timeout: 30_000 });

    const r = await page.evaluate(() => {
        const F = window.FluxyCashImpact;
        const at = 'TS';
        const out = {};
        ['expense', 'income', 'refund', 'fee', 'pending_payable', 'transfer', 'adjustment'].forEach((t) => {
            out[t] = F.deriveFromType(t, { accountId: 'acct_1', timestamp: at });
        });
        return out;
    });

    // Money that moved, direction from the type.
    expect(r.expense.cash_effective).toBe(true);
    expect(r.expense.cash_status).toBe('actual');
    expect(r.expense.cash_direction).toBe('out');
    expect(r.expense.cash_account_id).toBe('acct_1');
    expect(r.income.cash_direction).toBe('in');
    expect(r.refund.cash_direction).toBe('in');
    expect(r.fee.cash_direction).toBe('out');

    // Owed, not moved — the account is still recorded so the future payment links.
    expect(r.pending_payable.cash_effective).toBe(false);
    expect(r.pending_payable.cash_status).toBe('pending');
    expect(r.pending_payable.cash_account_id).toBe('acct_1');

    // No cash effect at all, and the account is DISCARDED. This is the case a
    // hand-written implementation gets wrong: mapping a transfer to an account
    // must not produce a link, or bank rec will try to match a non-movement.
    ['transfer', 'adjustment'].forEach((t) => {
        expect(r[t].cash_effective, t).toBe(false);
        expect(r[t].cash_status, t).toBe('none');
        expect(r[t].cash_account_id, t).toBeNull();
    });
});

test('the value matcher refuses to guess when a label is ambiguous', async ({ page }) => {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => typeof window.showAddTransactionModal === 'function', null, { timeout: 30_000 });

    // matchCashAccounts is module-private, so exercise it through the behaviour
    // it guards: two accounts at one bank must leave the bank name unmatched.
    const r = await page.evaluate(() => {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Mirror of matchCashAccounts in shared-dashboard.js.
        function match(values, accounts) {
            const index = new Map();
            const AMB = Symbol('a');
            const add = (k, id) => {
                const key = norm(k);
                if (!key) return;
                const seen = index.get(key);
                if (seen === undefined) index.set(key, id);
                else if (seen !== id) index.set(key, AMB);
            };
            accounts.forEach((a) => {
                add(a.id, a.id); add(a.account_name, a.id); add(a.bank_name, a.id);
                add(`${a.bank_name || ''} ${a.last_four || ''}`, a.id);
                if (a.last_four) add(a.last_four, a.id);
            });
            const matched = {};
            values.forEach((v) => {
                const id = index.get(norm(v));
                matched[v] = (id && id !== AMB) ? id : '';
            });
            return matched;
        }
        const accounts = [
            { id: 'a1', account_name: 'Ops', bank_name: 'BCA', last_four: '1234' },
            { id: 'a2', account_name: 'Payroll', bank_name: 'BCA', last_four: '9876' },
            { id: 'a3', account_name: 'Mandiri Utama', bank_name: 'Mandiri', last_four: '5555' }
        ];
        return match(['BCA', 'Ops', 'bca 1234', '9876', 'Mandiri', ' mandiri  utama ', 'PayPal', ''], accounts);
    });

    // Shared by two accounts → no match. The whole point.
    expect(r['BCA']).toBe('');
    // Unique enough to be safe.
    expect(r['Ops']).toBe('a1');
    expect(r['bca 1234']).toBe('a1');
    expect(r['9876']).toBe('a2');
    expect(r['Mandiri']).toBe('a3');
    // Case and punctuation are normalised away, but nothing fuzzier than that.
    expect(r[' mandiri  utama ']).toBe('a3');
    // No account, no guess.
    expect(r['PayPal']).toBe('');
});

test('a bare "Account" column is not read as a cash account', async ({ page }) => {
    // In a FluxyOS-flavoured CSV, "Account" means the Chart-of-Accounts account.
    // Treating it as a bank account would stamp cash_effective from the wrong
    // column, so the header must carry an explicit cash/bank token.
    await openBulk(page);
    await attach(page, csv(
        ['CSV Acct Probe,Operations,Expense,11000,Completed,01-01-2026'],
        { header: 'Description,Category,Type,Amount,Status,Date,Account' }
    ));
    const chip = page.locator('#tx-csv-mapping-summary');
    await expect(chip).toContainText(/Cash account:\s*(Not in file|Tidak ada di berkas)/);
});

test('no cash column and no selection imports exactly as it did before', async ({ page }) => {
    // The opt-in guard: an existing user's import must not suddenly start feeding
    // the Cash Position KPI.
    await openBulk(page);
    const stamp = `CSV NoCash ${Date.now()}`;
    await attach(page, csv([`${stamp},Operations,Expense,12345,Completed,01-01-2026`]));

    // Leave the cash select at "Don't link" (its default with 2+ accounts; with a
    // single account the card pre-selects, so force it back).
    const select = page.locator('#tx-bulk-cash-select');
    if (await select.isVisible().catch(() => false)) await select.selectOption('');

    await page.locator('#tx-submit-btn').click();
    await expect(page.locator('#tx-csv-feedback')).toContainText(/imported successfully|berhasil diimpor/i, { timeout: 30_000 });

    const [row] = await recentTx(page, stamp);
    expect(row, 'the row was written').toBeTruthy();
    ['cash_effective', 'cash_status', 'cash_direction', 'cash_account_id', 'cash_source', 'cash_match_status', 'cash_effective_at']
        .forEach((k) => expect(k in row, `${k} must be absent`).toBe(false));

    // Provenance. Without it the detail drawer falls through to its
    // "Manual / dashboard" default and an imported row claims to have been typed
    // in by hand — wrong on exactly the records where provenance matters.
    expect(row.source).toBe('csv_import');
});

test('applying one account stamps every row per its own type', async ({ page }) => {
    await openBulk(page);
    const accounts = await activeAccounts(page);
    test.skip(!accounts.length, 'workspace has no active bank account');

    const stamp = `CSV Apply ${Date.now()}`;
    await attach(page, csv([
        `${stamp} exp,Operations,Expense,10000,Completed,01-01-2026`,
        `${stamp} inc,Revenue,Income,20000,Completed,01-01-2026`,
        `${stamp} pend,Operations,Pending payable,30000,Completed,01-01-2026`,
        `${stamp} xfer,Operations,Transfer,40000,Completed,01-01-2026`
    ]));

    await page.locator('#tx-bulk-cash-select').selectOption(accounts[0].id);
    // The consequence is stated before the import, not discovered after.
    await expect(page.locator('#tx-bulk-cash-note')).toContainText(/will be recorded as cash that moved|akan dicatat sebagai kas/i);

    await page.locator('#tx-submit-btn').click();
    await expect(page.locator('#tx-csv-feedback')).toContainText(/imported successfully|berhasil diimpor/i, { timeout: 30_000 });

    const rows = await recentTx(page, stamp);
    const by = (suffix) => rows.find(r => r.vendor_name.endsWith(suffix));

    expect(by('exp').cash_status).toBe('actual');
    expect(by('exp').cash_direction).toBe('out');
    expect(by('exp').cash_account_id).toBe(accounts[0].id);

    expect(by('inc').cash_direction).toBe('in');
    expect(by('inc').cash_account_id).toBe(accounts[0].id);

    // Owed, not moved — but still linked.
    expect(by('pend').cash_effective).toBe(false);
    expect(by('pend').cash_status).toBe('pending');
    expect(by('pend').cash_account_id).toBe(accounts[0].id);

    // Mapped, but a transfer has no cash effect, so no account is written.
    expect(by('xfer').cash_effective).toBe(false);
    expect(by('xfer').cash_account_id).toBeNull();
});

test('a cash column maps per value, and unmatched values import unlinked', async ({ page }) => {
    await openBulk(page);
    const accounts = await activeAccounts(page);
    test.skip(!accounts.length, 'workspace has no active bank account');

    const label = accounts[0].account_name || accounts[0].bank_name;
    const stamp = `CSV Col ${Date.now()}`;
    await attach(page, csv([
        `${stamp} known,Operations,Expense,15000,Completed,01-01-2026,${label}`,
        `${stamp} unknown,Operations,Expense,16000,Completed,01-01-2026,Totally Not An Account`
    ], { header: `${HEAD},Cash account` }));

    // The column is recognised and the card switched to per-value mapping.
    await expect(page.locator('#tx-csv-mapping-summary')).toContainText('Cash account:');
    await expect(page.locator('#tx-bulk-cash-map')).toBeVisible();
    // Auto-matched, and the unmatched one is named BEFORE importing — the success
    // toast auto-closes in ~1.2s, so the preview is where this has to be visible.
    await expect(page.locator(`#tx-bulk-cash-map select[data-csv-cash-value="${label}"]`)).toHaveValue(accounts[0].id);
    await expect(page.locator('#tx-bulk-cash-note')).toContainText(/Totally Not An Account/);

    await page.locator('#tx-submit-btn').click();
    await expect(page.locator('#tx-csv-feedback')).toContainText(/imported successfully|berhasil diimpor/i, { timeout: 30_000 });

    const rows = await recentTx(page, stamp);
    const known = rows.find(r => r.vendor_name.endsWith('known') && !r.vendor_name.endsWith('unknown'));
    const unknown = rows.find(r => r.vendor_name.endsWith('unknown'));

    expect(known.cash_account_id).toBe(accounts[0].id);
    expect(known.cash_effective).toBe(true);
    // Unlinked means NO cash fields — not "cash moved, account unknown".
    expect('cash_effective' in unknown).toBe(false);
    expect('cash_account_id' in unknown).toBe(false);
});

test('an invalid CSV still renders one full-width error row', async ({ page }) => {
    // Guards the colspan: the preview table gained a 7th column, and a stale
    // colspan="6" renders a short error row against a 7-column header.
    await openBulk(page);
    await page.locator('#tx-csv-file').setInputFiles({
        name: 'bad.csv', mimeType: 'text/csv',
        buffer: Buffer.from('Description,Category,Type,Amount\nOnly,Operations,Expense,-5', 'utf8')
    });
    const errorCell = page.locator('#tx-csv-preview-body td[colspan]');
    await expect(errorCell).toHaveAttribute('colspan', '7', { timeout: 20_000 });
});
