// =============================================================================
// FluxyOS — pos_tables + pos_orders + the cashier boundary (emulator-only)
//
// Two things are being proven here, and the second matters far more than the
// first.
//
// 1. The order state machine. `paid` is DERIVED — an order reaches it only when
//    the money recorded against it covers the bill. If a client could assert the
//    flag it would emit revenue for a table that never paid, and nothing
//    downstream would question it.
//
// 2. The cashier boundary. `cashier` is the first role in this product that is
//    NOT a finance role. Every other role is built on READ_CAPS, which carries
//    transactions.read and accounting.read — so the failure mode being guarded
//    against is a well-meaning edit that adds 'cashier' to a `viewer` list "for
//    consistency" and hands a workspace's books to its floor staff. These cases
//    fail loudly the moment that happens.
//
// Schema: docs/data-model/pos.md · design: docs/POS_IMPLEMENTATION_PLAN.md §9
//
// Run via:
//   firebase emulators:exec --only firestore,auth \
//     "node tests/pos-rules-emulator-test.mjs"
// =============================================================================

import { createRequire } from 'module';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
    getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc,
    deleteDoc, getDoc, serverTimestamp
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
const adminDb = admin.firestore();

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

let passed = 0;
let failed = 0;
async function expectOutcome(label, shouldAllow, run) {
    try {
        await run();
        if (shouldAllow) { passed++; console.log(`  PASS (allowed)  ${label}`); }
        else { failed++; console.error(`  FAIL (should have been DENIED)  ${label}`); }
    } catch (err) {
        const denied = err?.code === 'permission-denied' || /permission|PERMISSION/.test(String(err?.message));
        if (!shouldAllow && denied) { passed++; console.log(`  PASS (denied)   ${label}`); }
        else { failed++; console.error(`  FAIL ${shouldAllow ? '(should have been ALLOWED)' : '(unexpected error)'}  ${label} → ${err?.code || err?.message}`); }
    }
}

const WS = 'ws_pos_test';

function table(overrides = {}) {
    return {
        label: '12', dimension_id: 'outlet-kemang', seats: 4, zone: 'Lantai 1',
        qr_token: 'x'.repeat(43), status: 'active', sort: 12,
        created_at: serverTimestamp(), updated_at: serverTimestamp(),
        ...overrides
    };
}

function order(overrides = {}) {
    return {
        order_number: 'KMG-2026-08-21-001', dimension_id: 'outlet-kemang',
        table_id: 't12', table_label: '12', channel: 'staff', status: 'open',
        lines: [{ line_id: 'l1', item_id: 'nasgor', item_name: 'Nasi Goreng', quantity: 2,
            unit_price: 45000, gross_amount: 90000, discount_amount: 0, discount_reason: null, note: null }],
        subtotal: 90000, discount_amount: 0, discount_reason: null, discount_total: 0,
        service_charge_amount: 0, tax_amount: 0, total_amount: 90000,
        payments: [], paid_amount: 0, note: null, version: 1,
        opened_at: new Date(), paid_at: null, voided_at: null, void_reason: null,
        transaction_id: null, stock_adjustment_id: null,
        refund_transaction_id: null, refund_reason: null, refunded_at: null,
        created_at: serverTimestamp(), updated_at: serverTimestamp(),
        created_by: 'qa', updated_by: 'qa',
        ...overrides
    };
}

// A POS-shaped transaction: what the till appends when a sale closes.
function posTx(overrides = {}) {
    return {
        amount: 80000, vendor_name: 'Meja 12', category: 'Sales', type: 'income',
        status: 'Completed', timestamp: new Date(), created_at: serverTimestamp(),
        source: 'pos', accounting_status: 'pending',
        pos_order_id: 'o1', pos_discount_amount: 10000, pos_discount_reason: 'Promo',
        pos_settlement: 'cash', dimension_id: 'outlet-kemang',
        ...overrides
    };
}

function saleAdjustment(overrides = {}) {
    return {
        adjustment_type: 'sale', dimension_id: 'outlet-kemang',
        lines: [{ item_id: 'rice', quantity: -300, amount: -3600 }],
        total_amount: -3600, status: 'posted', reference: 'POS KMG-001',
        timestamp: new Date(), created_at: serverTimestamp(),
        ...overrides
    };
}

async function setMemberRole(uid, role) {
    await adminDb.doc(`workspaces/${WS}/members/${uid}`).set({ role, status: 'active', uid });
}

async function main() {
    await signInAnonymously(auth);
    const uid = auth.currentUser.uid;

    // Seed one finance-owned doc the cashier cases below try to read.
    await adminDb.doc(`workspaces/${WS}/transactions/seed-tx`).set({ amount: 1, type: 'income' });
    await adminDb.doc(`workspaces/${WS}/journals/seed-j`).set({ total_debit: 1, total_credit: 1 });
    await adminDb.doc(`workspaces/${WS}/bank_accounts/seed-b`).set({ bank_name: 'BCA', balance: 1 });

    console.log('\n— pos_tables —');
    await setMemberRole(uid, 'finance');
    await expectOutcome('finance creates a table', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_tables/t12`), table()));
    await expectOutcome('a table with no outlet is denied', false, () => {
        const t = table(); delete t.dimension_id;
        return setDoc(doc(db, `workspaces/${WS}/pos_tables/t-noout`), t);
    });
    await expectOutcome('an empty label is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_tables/t-nolabel`), table({ label: '' })));
    await expectOutcome('archiving is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_tables/t12`), { status: 'archived' }));
    await expectOutcome('deleting a table is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/pos_tables/t12`)));

    console.log('\n— pos_orders: the state machine —');
    await expectOutcome('finance opens an order', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), order()));
    await expectOutcome('an order created straight into `paid` is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-paid`), order({ status: 'paid', version: 1 })));
    await expectOutcome('an order created at version 2 is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-v2`), order({ version: 2 })));
    await expectOutcome('an unknown channel is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-ch`), order({ channel: 'telepathy' })));
    await expectOutcome('an unlisted field is denied (hasOnly)', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-extra`), order({ secret_margin: 1 })));

    await expectOutcome('adding a line bumps version to 2', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            status: 'sent', version: 2, subtotal: 135000, total_amount: 135000, updated_at: serverTimestamp()
        }));
    // The concurrency guard. A second device that read at version 1 tries to write
    // version 2 again; without this it would silently drop the first device's line.
    await expectOutcome('a stale device rewriting version 2 is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), { version: 2, total_amount: 90000 }));
    await expectOutcome('skipping a version is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), { version: 9 }));

    // THE invariant: paid is derived from money received, never asserted.
    await expectOutcome('marking paid with NO payment recorded is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            status: 'paid', version: 3, paid_amount: 0, paid_at: new Date()
        }));
    await expectOutcome('marking paid UNDER the total is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            status: 'paid', version: 3, paid_amount: 134999, paid_at: new Date()
        }));
    await expectOutcome('partial payment stays awaiting_payment', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            status: 'awaiting_payment', version: 3, paid_amount: 50000,
            payments: [{ payment_id: 'p1', method: 'cash', provider: 'manual', amount: 50000, status: 'settled' }]
        }));
    await expectOutcome('paid once the money covers the bill', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            status: 'paid', version: 4, paid_amount: 135000, paid_at: new Date(),
            payments: [
                { payment_id: 'p1', method: 'cash', provider: 'manual', amount: 50000, status: 'settled' },
                { payment_id: 'p2', method: 'qris', provider: 'manual', amount: 85000, status: 'settled' }
            ]
        }));

    console.log('\n— the emission stamp: write-once, and the only non-refund path —');
    // Before this transition existed, a paid order could not be stamped at all
    // (the refund validator demands a reason), so `transaction_id` stayed null
    // and the next sweep emitted the SAME sale again. Two transactions, one
    // order, silently.
    await expectOutcome('stamping what a paid order emitted is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            version: 5, transaction_id: 'tx-1', stock_adjustment_id: 'sa-1', updated_at: serverTimestamp()
        }));
    await expectOutcome('re-stamping an already-stamped order is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            version: 6, transaction_id: 'tx-2', updated_at: serverTimestamp()
        }));
    // The guard only means anything on a PAID order — an open one may legitimately
    // change its total, so the fixture has to reach `paid` first.
    await setDoc(doc(db, `workspaces/${WS}/pos_orders/o-stamp`), order({ order_number: 'S-1', table_id: 't20' }));
    await updateDoc(doc(db, `workspaces/${WS}/pos_orders/o-stamp`), {
        version: 2, status: 'paid', paid_amount: 90000, paid_at: new Date(),
        payments: [{ payment_id: 'p1', method: 'cash', provider: 'manual', amount: 90000, status: 'settled' }]
    });
    await expectOutcome('a stamp that also moves the total is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o-stamp`), {
            version: 3, transaction_id: 'tx-x', total_amount: 1
        }));
    await expectOutcome('a stamp that also rewrites the lines is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o-stamp`), {
            version: 3, transaction_id: 'tx-x', lines: []
        }));
    await expectOutcome('a clean stamp on that order is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o-stamp`), {
            version: 3, transaction_id: 'tx-ok', stock_adjustment_id: 'sa-ok'
        }));

    console.log('\n— a paid order is frozen —');
    await expectOutcome('editing the lines of a paid order is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), { version: 6, lines: [] }));
    await expectOutcome('changing the total of a paid order is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), { version: 6, total_amount: 1 }));
    await expectOutcome('a refund with no reason is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), { version: 6, refund_transaction_id: 'tx-r' }));
    await expectOutcome('a refund WITH a reason is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            version: 6, refund_reason: 'Salah pesan', refund_transaction_id: 'tx-r', refunded_at: new Date()
        }));

    console.log('\n— voiding —');
    await expectOutcome('open an order to void', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o2`), order({ order_number: 'KMG-002', table_id: 't13' })));
    await expectOutcome('voiding with no reason is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o2`), { status: 'void', version: 2 }));
    await expectOutcome('voiding WITH a reason is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o2`), {
            status: 'void', version: 2, void_reason: 'Tamu batal', voided_at: new Date()
        }));

    // ========================================================================
    console.log('\n— THE CASHIER BOUNDARY —');
    await setMemberRole(uid, 'cashier');

    console.log('  · what a cashier CAN do');
    await expectOutcome('cashier opens an order', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o3`), order({ order_number: 'KMG-003', table_id: 't14' })));
    await expectOutcome('cashier adds a line', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o3`), { version: 2, status: 'sent', total_amount: 90000 }));
    await expectOutcome('cashier reads the table list', true, () =>
        getDoc(doc(db, `workspaces/${WS}/pos_tables/t12`)));
    await expectOutcome('cashier reads an order', true, () =>
        getDoc(doc(db, `workspaces/${WS}/pos_orders/o3`)));
    await expectOutcome('cashier appends the POS revenue row', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/pos-tx-1`), posTx()));
    await expectOutcome('cashier relieves stock for the sale', true, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_adjustments/pos-sa-1`), saleAdjustment()));

    console.log('  · what a cashier must NEVER do');
    // If any of these start passing, someone added 'cashier' to a finance role
    // list and the workspace's books are now readable by its floor staff.
    await expectOutcome('cashier READING a transaction is denied', false, () =>
        getDoc(doc(db, `workspaces/${WS}/transactions/seed-tx`)));
    await expectOutcome('cashier READING a journal is denied', false, () =>
        getDoc(doc(db, `workspaces/${WS}/journals/seed-j`)));
    await expectOutcome('cashier READING a bank account is denied', false, () =>
        getDoc(doc(db, `workspaces/${WS}/bank_accounts/seed-b`)));
    await expectOutcome('cashier writing a JOURNAL is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/journals/j-cashier`), {
            total_debit: 1, total_credit: 1, lines: [], period_key: '2026-08'
        }));
    await expectOutcome('cashier writing a ledger balance is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/ledger_balances/2026-08__4000`), { debit_total: 0, credit_total: 999 }));
    // The narrowing on the create grant: only POS-shaped rows, only unposted.
    await expectOutcome('cashier writing a NON-pos transaction is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/tx-manual`), posTx({ source: 'manual' })));
    await expectOutcome('cashier writing a pre-POSTED transaction is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/tx-posted`), posTx({ accounting_status: 'posted' })));
    await expectOutcome('cashier writing a stock COUNT is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_adjustments/sa-count`), saleAdjustment({ adjustment_type: 'count' })));
    await expectOutcome('cashier writing a WASTE adjustment is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/stock_adjustments/sa-waste`), saleAdjustment({ adjustment_type: 'waste' })));
    await expectOutcome('cashier EDITING a posted transaction is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/transactions/pos-tx-1`), { amount: 1 }));
    await expectOutcome('cashier repricing the menu is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/items/free-lunch`), {
            name: 'Nasi Goreng', type: 'composite', base_unit: 'porsi', status: 'active', sales_price: 1
        }));
    await expectOutcome('cashier creating a table is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_tables/t-cashier`), table({ label: '99' })));
    // Refunds move money back out — the till-fraud direction.
    await expectOutcome('cashier refunding a paid order is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_orders/o1`), {
            version: 7, refund_reason: 'x', refund_transaction_id: 'tx-r2'
        }));

    console.log('\n— pos_shifts: the cash drawer —');
    await setMemberRole(uid, 'cashier');
    const shift = (o = {}) => ({
        dimension_id: 'outlet-kemang', status: 'open',
        opened_at: new Date(), opened_by: 'qa', opening_float: 200000,
        movements: [], closed_at: null, closed_by: null,
        counted_cash: null, expected_cash: null, variance: null,
        cash_sales: 0, non_cash_sales: 0, order_count: 0, note: null,
        journal_ref: null, accounting_status: null, version: 1,
        created_at: serverTimestamp(), updated_at: serverTimestamp(), ...o
    });

    // A cashier runs their own drawer — they are the one holding the money, so
    // withholding this would make the feature unusable by the role that needs it.
    await expectOutcome('cashier opens a shift', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), shift()));
    await expectOutcome('a negative opening float is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_shifts/s-neg`), shift({ opening_float: -1 })));
    await expectOutcome('a shift created already closed is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_shifts/s-closed`), shift({ status: 'closed', counted_cash: 5 })));
    await expectOutcome('a shift created with a count already in it is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_shifts/s-counted`), shift({ counted_cash: 100 })));

    await expectOutcome('recording a drawer movement is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), {
            version: 2, movements: [{ id: 'm1', kind: 'paid_out', amount: 15000, reason: 'Beli es' }]
        }));
    await expectOutcome('a stale version is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), { version: 2, movements: [] }));
    await expectOutcome('changing the opening float after the fact is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), { version: 3, opening_float: 999999 }));
    await expectOutcome('closing without a count is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), { version: 3, status: 'closed' }));

    await expectOutcome('closing WITH a count is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), {
            version: 3, status: 'closed', counted_cash: 480000,
            expected_cash: 500000, variance: -20000, closed_at: new Date(),
            journal_ref: 'j-var', accounting_status: 'posted'
        }));
    // THE blind-count invariant. A second count entered after the first — with
    // the expected figure now on screen — is not a blind count, and the variance
    // stops measuring anything at all.
    await expectOutcome('recounting a closed drawer is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`), { version: 4, counted_cash: 500000 }));
    await expectOutcome('deleting a shift is denied', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/pos_shifts/s1`)));

    console.log('\n— viewer has no till —');
    await setMemberRole(uid, 'viewer');
    await expectOutcome('viewer creating an order is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-viewer`), order({ order_number: 'V-1' })));
    await expectOutcome('viewer may still read orders', true, () =>
        getDoc(doc(db, `workspaces/${WS}/pos_orders/o3`)));

    console.log('\n— the QR token directory is invisible to every client —');
    await adminDb.doc('pos_table_directory/tok123').set({ workspace_id: WS, table_id: 't12' });
    await setMemberRole(uid, 'owner');
    await expectOutcome('even an OWNER cannot read the token directory', false, () =>
        getDoc(doc(db, 'pos_table_directory/tok123')));
    await expectOutcome('nobody can write the token directory', false, () =>
        setDoc(doc(db, 'pos_table_directory/tok999'), { workspace_id: WS }));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
