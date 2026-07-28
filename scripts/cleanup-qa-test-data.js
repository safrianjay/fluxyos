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
//   • Bills touch the ledger, so they are ONLY cleaned when you also pass --bills:
//     for each test bill it deletes the bill + its linked payment transaction(s) +
//     the journals sourced from either, then reminds you to rebuild ledger_balances
//     with reconcile-ledger-balances.js.
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
//   # 3) Also prune test bills + their payment txns/journals (then reconcile):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/cleanup-qa-test-data.js --workspace <wsId> --commit --bills
//
// Flags:
//   --workspace <id>   REQUIRED — the QA workspace id (owner uid for owner-run QA).
//   --scope <s>        'workspaces' (default) or 'users' (pre-migration/user-scoped QA).
//   --bills            also delete test bills + linked payment txns + journals.
//   --commit           actually delete (default is dry-run — nothing is written).
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : def; };
const WS = argVal('--workspace', null);
const SCOPE = argVal('--scope', 'workspaces');
const COMMIT = args.includes('--commit');
const WITH_BILLS = args.includes('--bills');

if (!WS) { console.error('Required: --workspace <workspaceId or owner uid>'); process.exit(1); }
if (SCOPE !== 'workspaces' && SCOPE !== 'users') { console.error("--scope must be 'workspaces' or 'users'"); process.exit(1); }

if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
const db = admin.firestore();
const base = `${SCOPE}/${WS}`;

// Strict test markers this suite generates (see tests/*.spec.js).
const isTestVendor = (v) => typeof v.name === 'string' && /^QA /.test(v.name);
const isTestBillVendor = (n) => typeof n === 'string' && /^QA (Bill|Vendor PPN|VPay|FX|Memo|VMaster|WHT|account)/i.test(n);
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

    console.log(`\n${COMMIT ? 'Done.' : 'Dry-run only — re-run with --commit to delete (add --bills to include bills).'}\n`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
