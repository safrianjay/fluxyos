// @ts-check
const { test, expect } = require('@playwright/test');

// Completes Bank Reconciliation Phase B: the un-reconcile UI (undo a wrong link
// before certification). This exercises the DAL round-trip the UI depends on —
// reconcile an existing transaction against a statement row, then un-reconcile
// it — against real Firestore + deployed rules. UI internals live in an IIFE
// (window.FluxyBankStatementImport) and are not import-testable; this guards the
// behavior the button triggers: db-service.unreconcileStatementRow.

test('Bank recon: un-reconcile clears the transaction recon stamp and re-opens the row', async ({ page }) => {
    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!(window.__fluxyTxContext && window.__fluxyTxContext.auth && window.__fluxyTxContext.auth.currentUser), null, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const ds = window.__fluxyTxContext.ds;
        const uid = window.__fluxyTxContext.auth.currentUser.uid;
        ds.setActor(uid);
        const stamp = Date.now();

        // An existing ledger transaction the statement will reconcile against.
        const txRef = await ds.addTransaction(uid, {
            amount: 450000, type: 'expense', vendor_name: `QA Recon ${stamp}`,
            category: 'Operations', status: 'Completed', icon: '💸',
            timestamp: new Date('2026-05-03T05:00:00Z')
        });
        const txId = txRef.id;

        // A one-row statement import (draft, not certified).
        const importRef = await ds.createBankStatementImport(uid, {
            file_name: `qa-recon-${stamp}.csv`, file_mime_type: 'text/csv',
            extraction_status: 'completed', review_status: 'needs_review',
            statement_start_date: new Date('2026-05-01T00:00:00Z'),
            statement_end_date: new Date('2026-05-31T00:00:00Z'),
            row_count: 1
        });
        const importId = importRef.id;

        const [rowMeta] = await ds.addBankStatementRows(uid, importId, [{
            row_index: 0, transaction_date: new Date('2026-05-03T05:00:00Z'),
            description_raw: `TRSF QA RECON ${stamp}`, debit: 450000, credit: 0,
            match_status: 'new', review_status: 'pending'
        }]);
        const rowId = rowMeta.id;

        // Confirm with a reconcile action linking the row to the existing tx
        // (mirrors what the review table posts on "Reconcile").
        const confirm = await ds.confirmBankStatementImport(uid, importId, [{
            id: rowId, action: 'reconcile', debit: 450000, credit: 0,
            match: { transaction_id: txId, rule: 'R2', confidence: 'exact' }
        }]);
        const afterReconcile = await ds.getTransactionById(uid, txId);

        // Un-reconcile the row (the button's action).
        await ds.unreconcileStatementRow(uid, importId, rowId);
        const afterUndo = await ds.getTransactionById(uid, txId);
        const rowsAfter = await ds.getBankStatementRows(uid, importId);
        const rowAfter = rowsAfter.find((x) => x.id === rowId) || {};

        // Un-reconcile must be blocked once the statement is certified — first
        // re-reconcile so there is a link to protect, then certify, then try.
        await ds.confirmBankStatementImport(uid, importId, [{
            id: rowId, action: 'reconcile', debit: 450000, credit: 0,
            match: { transaction_id: txId, rule: 'R2', confidence: 'exact' }
        }]);
        // Certification needs a linked bank account + a closing balance.
        const acct = await ds.addManualBankAccount(uid, {
            account_name: `QA Recon Bank ${stamp}`, bank_name: 'QA Bank',
            current_balance: 0, balance_date: new Date('2026-05-01T00:00:00Z')
        });
        await ds.updateBankStatementImport(uid, importId, { bank_account_id: acct.id, closing_balance: 1000000 });
        await ds.certifyBankStatementImport(uid, importId);
        let blockedError = null;
        try { await ds.unreconcileStatementRow(uid, importId, rowId); }
        catch (e) { blockedError = e && e.message ? e.message : String(e); }

        return {
            matchedCount: confirm && confirm.matched,
            reconStatus: afterReconcile.recon_status,
            reconImportId: afterReconcile.recon_import_id,
            undoStatus: afterUndo.recon_status === undefined ? null : afterUndo.recon_status,
            undoImportId: afterUndo.recon_import_id === undefined ? null : afterUndo.recon_import_id,
            rowMatchedTxId: rowAfter.matched_transaction_id === undefined ? null : rowAfter.matched_transaction_id,
            rowReviewStatus: rowAfter.review_status,
            blockedError
        };
    });

    // Reconcile stamped the existing transaction.
    expect(r.matchedCount).toBe(1);
    expect(r.reconStatus).toBe('reconciled');
    expect(r.reconImportId).toBeTruthy();

    // Un-reconcile cleared the stamp and re-opened the row.
    expect(r.undoStatus).toBeNull();
    expect(r.undoImportId).toBeNull();
    expect(r.rowMatchedTxId).toBeNull();
    expect(r.rowReviewStatus).toBe('pending');

    // Once certified, un-reconcile is refused.
    expect(r.blockedError).toMatch(/certified/i);
});
