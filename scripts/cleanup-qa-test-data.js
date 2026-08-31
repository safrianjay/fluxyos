'use strict';

// =============================================================================
// FluxyOS — prune Playwright e2e test data from a QA workspace (run by hand).
//
// The e2e suite creates real records (vendors, keyword/vendor mappings, and —
// for money-movement coverage — bills + their payment transactions/journals).
// Firestore rules block client deletes, so cleanup runs via the Admin SDK.
//
// SAFE BY DEFAULT:
//   • Dry-run unless you pass --commit (prints what it WOULD delete, writes nothing).
//   • Only touches docs whose test markers match the strict patterns this suite
//     uses ("QA …" vendors/bills; vendor__qa-* / keyword__scan* / keyword__kw*
//     mappings). Nothing else is matched.
//   • Bills and invoices touch the ledger, so they are ONLY cleaned when you also
//     pass --bills / --invoices: for each test record it deletes the source doc +
//     its linked payment transaction(s) + the journals sourced from either (invoices
//     also drop their items subcollection), then reminds you to rebuild
//     ledger_balances with reconcile-ledger-balances.js.
//
// Usage:
//   # 1) Dry-run (recommended first) — vendors + mappings:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/cleanup-qa-test-data.js --workspace <wsId|ownerUid>
//
//   # 2) Commit vendors + mappings:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/cleanup-qa-test-data.js --workspace <wsId> --commit
//
//   # 3) Also prune test bills + invoices + their payment txns/journals (then reconcile):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/cleanup-qa-test-data.js --workspace <wsId> --commit --bills --invoices
//
// Flags:
//   --workspace <id>   REQUIRED — the QA workspace id (owner uid for owner-run QA).
//   --scope <s>        'workspaces' (default) or 'users' (pre-migration/user-scoped QA).
//   --bills            also delete test bills + linked payment txns + journals.
//   --invoices         also delete test invoices + INV-PAY txns + journals + items.
//   --accounts         prune QA chart-of-accounts rows: DELETE the ones that never
//                      posted, ARCHIVE (never delete) any that carry journal lines.
//   --pos              VOID stray till orders left open by interrupted specs, and
//                      take QA fixture items off the till menu. Deletes nothing.
//   --commit           actually delete (default is dry-run — nothing is written).
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : def; };
const WS = argVal('--workspace', null);
const SCOPE = argVal('--scope', 'workspaces');
const COMMIT = args.includes('--commit');
const WITH_BILLS = args.includes('--bills');
const WITH_INVOICES = args.includes('--invoices');
const WITH_ACCOUNTS = args.includes('--accounts');
const WITH_POS = args.includes('--pos');

if (!WS) { console.error('Required: --workspace <workspaceId or owner uid>'); process.exit(1); }
if (SCOPE !== 'workspaces' && SCOPE !== 'users') { console.error("--scope must be 'workspaces' or 'users'"); process.exit(1); }

if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
const db = admin.firestore();
const base = `${SCOPE}/${WS}`;

// Strict test markers this suite generates (see tests/*.spec.js).
const isTestVendor = (v) => typeof v.name === 'string' && /^QA /.test(v.name);
const isTestBillVendor = (n) => typeof n === 'string' && /^QA (Bill|Vendor PPN|VPay|FX|Memo|VMaster|WHT|account)/i.test(n);
// Invoice e2es all use a "QA …" customer_name (QA Inv Partial, QA Combine, QA USD,
// QA Receive, QA Invoice Pay/Void, QA PPN/WHT Customer, QA Customer).
const isTestInvoiceCustomer = (n) => typeof n === 'string' && /^QA /.test(n);
// Chart-of-accounts rows the CoA e2es create. Every run of coa-create-account.spec.js
// leaks one account per creating test — custom accounts are archive-only in the
// product, so nothing reclaims them and the QA picker fills with noise.
const isTestAccount = (a) => typeof a.name === 'string'
    && /^QA (Custom Expense|Locked|Editable|Renamed)/i.test(a.name)
    && a.is_system !== true;
// Till fixtures are stamped with a prefix + a timestamp by the POS specs.
const isTestItem = (i) => typeof i.name === 'string' && /^(QA-[A-Z]+-\d|RULECHECK-)/.test(i.name);

const isTestMapping = (m) =>
    (m.source_type === 'vendor' && /^qa /i.test(String(m.source_value || '')))
    || (m.source_type === 'keyword' && /^(scan|kw)\d/i.test(String(m.source_value || '')));

const preview = (arr, fn) => arr.length ? ` → ${arr.slice(0, 5).map(fn).join(', ')}${arr.length > 5 ? ' …' : ''}` : '';

async function main() {
    console.log(`\nQA cleanup — ${base} — ${COMMIT ? 'COMMIT (deleting)' : 'DRY-RUN (no writes)'}${WITH_BILLS ? ' +bills' : ''}\n`);

    // 1) Vendors — no ledger impact.
    const vDel = (await db.collection(`${base}/vendors`).get()).docs.filter((d) => isTestVendor(d.data()));
    console.log(`Vendors:  ${vDel.length} test docs${preview(vDel, (d) => d.data().name)}`);
    if (COMMIT) for (const d of vDel) await d.ref.delete();

    // 2) accounting_mappings — suggestion layer, no ledger impact.
    const mDel = (await db.collection(`${base}/accounting_mappings`).get()).docs.filter((d) => isTestMapping(d.data()));
    console.log(`Mappings: ${mDel.length} test docs${preview(mDel, (d) => d.id)}`);
    if (COMMIT) for (const d of mDel) await d.ref.delete();

    // 3) Bills (+ linked payment txns + journals) — ledger-touching, opt-in only.
    if (WITH_BILLS) {
        const bDel = (await db.collection(`${base}/bills`).get()).docs.filter((d) => isTestBillVendor(d.data().vendor_name));
        let txCount = 0, jCount = 0;
        for (const b of bDel) {
            const bill = b.data();
            const txIds = new Set();
            if (bill.linked_transaction_id) txIds.add(bill.linked_transaction_id);
            (await db.collection(`${base}/transactions`).where('linked_bill_id', '==', b.id).get()).forEach((t) => txIds.add(t.id));
            const uniq = [...txIds];
            txCount += uniq.length;
            for (const sid of [b.id, ...uniq]) {
                const js = await db.collection(`${base}/journals`).where('source.id', '==', sid).get();
                jCount += js.size;
                if (COMMIT) for (const j of js.docs) await j.ref.delete();
            }
            if (COMMIT) {
                for (const tid of uniq) await db.doc(`${base}/transactions/${tid}`).delete();
                await b.ref.delete();
            }
        }
        console.log(`Bills:    ${bDel.length} test docs (+ ${txCount} payment txns, ${jCount} journals)`);
        if (bDel.length && COMMIT) console.log(`\n  ⚠ Rebuild balances now:  node scripts/reconcile-ledger-balances.js --commit  (see that script's --help)`);
    }

    // 4) Invoices (+ INV-PAY txns + journals + items) — ledger-touching, opt-in only.
    if (WITH_INVOICES) {
        const iDel = (await db.collection(`${base}/invoices`).get()).docs.filter((d) => isTestInvoiceCustomer(d.data().customer_name));
        let txCount = 0, jCount = 0, itemCount = 0;
        for (const inv of iDel) {
            const data = inv.data();
            const txIds = new Set();
            if (data.linked_transaction_id) txIds.add(data.linked_transaction_id);
            if (data.last_payment_transaction_id) txIds.add(data.last_payment_transaction_id);
            (await db.collection(`${base}/transactions`).where('linked_invoice_id', '==', inv.id).get()).forEach((t) => txIds.add(t.id));
            const uniq = [...txIds];
            txCount += uniq.length;
            // INV-ISSUE is sourced from the invoice; INV-PAY from each payment txn.
            for (const sid of [inv.id, ...uniq]) {
                const js = await db.collection(`${base}/journals`).where('source.id', '==', sid).get();
                jCount += js.size;
                if (COMMIT) for (const j of js.docs) await j.ref.delete();
            }
            const items = await db.collection(`${base}/invoices/${inv.id}/items`).get();
            itemCount += items.size;
            if (COMMIT) {
                for (const it of items.docs) await it.ref.delete();
                for (const tid of uniq) await db.doc(`${base}/transactions/${tid}`).delete();
                await inv.ref.delete();
            }
        }
        console.log(`Invoices: ${iDel.length} test docs (+ ${txCount} payment txns, ${jCount} journals, ${itemCount} items)`);
        if (iDel.length && COMMIT) console.log(`\n  ⚠ Rebuild balances now:  node scripts/reconcile-ledger-balances.js --commit  (see that script's --help)`);
    }

    // N) Chart of accounts — the ONLY collection here where deletion can orphan
    // history, so it is split two ways: an account with no journal line and no
    // ledger_balances row never posted anything and is deleted outright; one that
    // DID post is archived (is_active:false), never deleted, because its journal
    // lines denormalize the code and a General Ledger drill-down would dead-end.
    // That mirrors the product rule — archive via is_active, never hard-delete.
    if (WITH_ACCOUNTS) {
        const accts = (await db.collection(`${base}/chart_of_accounts`).get()).docs.filter((d) => isTestAccount(d.data()));
        const used = new Set();
        (await db.collection(`${base}/ledger_balances`).get()).forEach((d) => {
            const c = d.data().account_code;
            if (c && (Number(d.data().debit_total) || Number(d.data().credit_total))) used.add(String(c));
        });
        (await db.collection(`${base}/journals`).get()).forEach((d) => {
            (d.data().lines || []).forEach((l) => { if (l.account_code) used.add(String(l.account_code)); });
        });
        const toArchive = accts.filter((d) => used.has(String(d.data().code)) && d.data().is_active !== false);
        const toDelete = accts.filter((d) => !used.has(String(d.data().code)));
        const alreadyArchived = accts.length - toArchive.length - toDelete.length;
        console.log(`Accounts: ${accts.length} test docs → ${toDelete.length} unused (delete), ${toArchive.length} used (archive), ${alreadyArchived} already archived`
            + preview(toDelete, (d) => d.data().code));
        if (COMMIT) {
            for (const d of toDelete) await d.ref.delete();
            for (const d of toArchive) await d.ref.set({ is_active: false, updated_at: new Date() }, { merge: true });
        }
    }

    // ── Till residue ────────────────────────────────────────────────────────
    // Nothing here is DELETED. An order is voided, which is the product's own
    // way of retiring one and leaves the reason behind; an item is taken off the
    // menu, because items are never deleted at all (their stock movements and
    // journal lines are immutable history).
    //
    // `awaiting_payment` and `paid` are deliberately NOT voidable. Both have had
    // money applied — a void would strand a real payment, and for `paid` it would
    // leave posted revenue with no order behind it. Those are a refund's job.
    // Measured on the QA workspace 2026-09-01: 369 orders, of which 63 open,
    // 2 served and 2 sent were interrupted-spec residue, all from a single day.
    if (WITH_POS) {
        const VOIDABLE = ['open', 'served', 'sent'];
        const orders = (await db.collection(`${base}/pos_orders`).get()).docs;
        const stray = orders.filter((d) => VOIDABLE.includes(d.data().status));
        const held = orders.filter((d) => d.data().status === 'awaiting_payment');
        console.log(`POS orders: ${orders.length} total → ${stray.length} stray to void`
            + preview(stray, (d) => `${d.id.slice(0, 6)}:${d.data().status}`));
        if (held.length) {
            console.log(`  ⚠ ${held.length} awaiting_payment left alone — money has partially landed;`
                + ' voiding would strand it. Refund or settle these by hand.');
        }
        if (COMMIT) {
            for (const d of stray) {
                await d.ref.set({
                    status: 'void',
                    void_reason: 'QA workspace cleanup',
                    voided_at: new Date(),
                    updated_at: new Date()
                }, { merge: true });
            }
        }

        const items = (await db.collection(`${base}/items`).get()).docs;
        const onMenu = items.filter((d) => d.data().pos_visible && isTestItem(d.data()));
        console.log(`POS menu: ${items.length} items → ${onMenu.length} QA fixtures to un-publish`
            + preview(onMenu, (d) => d.data().name));
        if (COMMIT) {
            for (const d of onMenu) await d.ref.set({ pos_visible: false, updated_at: new Date() }, { merge: true });
        }
    }

    console.log(`\n${COMMIT ? 'Done.' : 'Dry-run only — re-run with --commit to apply (add --bills / --invoices / --accounts / --pos to include them).'}\n`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
