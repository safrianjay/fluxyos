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
    // Split tender (2026-08-30). The settlement split is what the posting rule
    // reads to decide how much lands in 1000 vs 1030, so a validator that does
    // not list these keys refuses the whole write — `hasOnly` rejects an unlisted
    // key outright rather than dropping it — and the sale is lost at the till.
    await expectOutcome('cashier appends a SPLIT-tender revenue row', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/pos-tx-split`),
            posTx({ pos_cash_amount: 50000, pos_clearing_amount: 30000 })));

    // Tax and service charge (2026-09-05). Same shape of trap as the split
    // tender above and the `cash`/`clearing` incident of 2026-08-31: POS-SALE
    // credits 2100 PPN Keluaran and 4100 Service Charge from these two keys, and
    // a validator that does not list them refuses the ENTIRE sale — silently,
    // with the order marked paid and no revenue posted.
    await expectOutcome('cashier appends a row carrying TAX and SERVICE', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/pos-tx-tax`),
            posTx({
                pos_cash_amount: 96000, pos_clearing_amount: 0,
                pos_tax_amount: 11000, pos_service_amount: 5000
            })));

    // hasRole() is true for an owner, so `||` short-circuits into the
    // wsValidTxCreate clause and the lean cashier validator is never reached.
    // Both must therefore accept an IDENTICAL payload — this is exactly how a
    // missing `icon` once refused the write for everyone. Adding a key to one
    // validator and not the other reproduces it, and only this case sees it.
    console.log('  · the same payload, written by an OWNER');
    await setMemberRole(uid, 'owner');
    await expectOutcome('OWNER writes the same split-tender row', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/owner-tx-split`),
            posTx({ pos_cash_amount: 50000, pos_clearing_amount: 30000, icon: '💰' })));
    await expectOutcome('OWNER writes the same TAX + SERVICE row', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/owner-tx-tax`),
            posTx({
                pos_cash_amount: 96000, pos_clearing_amount: 0,
                pos_tax_amount: 11000, pos_service_amount: 5000, icon: '💰'
            })));
    await setMemberRole(uid, 'cashier');

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

    console.log('\n— who the order is for —');
    // Captured at CREATE, because a dine-in needs a table and a cover count and a
    // takeaway needs a way to call the customer back — and both are known before
    // the first item is rung up. Every field is optional: a queue does not wait
    // while a cashier types a phone number.
    await setMemberRole(uid, 'finance');
    await expectOutcome('an order with customer, phone and covers is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-guest`), order({
            order_number: 'G-1', customer_name: 'Pak Budi', customer_phone: '0812-3456-7890', guest_count: 4
        })));
    await expectOutcome('an order with none of them is still allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-noguest`), order({ order_number: 'G-2' })));
    await expectOutcome('a 200-character customer name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-longname`), order({
            order_number: 'G-3', customer_name: 'x'.repeat(200)
        })));
    await expectOutcome('a fractional cover count is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-halfguest`), order({
            order_number: 'G-4', guest_count: 2.5
        })));
    await expectOutcome('a negative cover count is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-negguest`), order({
            order_number: 'G-5', guest_count: -1
        })));
    // A cashier is the role that actually takes these details at the counter.
    await setMemberRole(uid, 'cashier');
    await expectOutcome('a cashier may take the customer details too', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_orders/o-guest-cashier`), order({
            order_number: 'G-6', customer_name: 'Ibu Sari', guest_count: 2
        })));

    console.log('\n— the settlement split: the field NAMES are the contract —');
    // The bug this exists for, 2026-08-30 → 2026-08-31: the DAL helper returned
    // `{ cash, clearing }` and both call sites spread it straight into a
    // transaction. Neither name is in wsValidTxCreate's hasOnly list, so every
    // POS write carrying them was refused — sales were marked paid and never
    // reached the ledger, and refunds failed outright. Nothing went red: the
    // sale emitter catches and defers to a retry sweep, and the retry rebuilt
    // the same permanently-invalid payload every time.
    //
    // hasOnly denials are the quietest rule failure there is — an unknown field
    // is refused with the same opaque message as a stolen document — so the two
    // shapes are pinned here rather than left to be re-derived at a counter.
    await setMemberRole(uid, 'owner');
    const settleTx = (extra) => ({
        amount: 20000, vendor_name: 'Order 20260831-024', category: 'Sales',
        type: 'refund', icon: '\ud83d\udcb8', status: 'Completed',
        timestamp: new Date(), created_at: serverTimestamp(),
        source: 'pos', accounting_status: 'pending', dimension_id: 'outlet-kemang',
        pos_order_id: 'o1', pos_discount_amount: 0, pos_discount_reason: null,
        pos_settlement: 'cash', pos_refund_reason: 'Salah pesan', ...extra
    });
    await expectOutcome('a refund carrying tax and service is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/refund-tax`),
            settleTx({
                pos_cash_amount: 20000, pos_clearing_amount: 0,
                pos_tax_amount: 2200, pos_service_amount: 1000
            })));
    await expectOutcome('a refund carrying pos_cash_amount / pos_clearing_amount is allowed', true, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/tx-split-ok`),
            settleTx({ pos_cash_amount: 20000, pos_clearing_amount: 0 })));
    await expectOutcome('the same refund with bare `cash` / `clearing` is DENIED', false, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/tx-split-bad`),
            settleTx({ cash: 20000, clearing: 0 })));
    await expectOutcome('a POS SALE with bare `cash` / `clearing` is DENIED too', false, () =>
        setDoc(doc(db, `workspaces/${WS}/transactions/tx-sale-bad`),
            settleTx({ type: 'income', icon: '\ud83d\udcb0', pos_refund_reason: null, cash: 20000, clearing: 0 })));

    console.log('\n— pos_reservations: a claim on a table in the future —');
    // What rules can and cannot do here is worth being explicit about, because
    // the gap looks like an oversight and is not: "this table is already booked
    // at 19:00" is a QUERY across the collection, and rules can only get() a
    // document whose id they already know. Double-booking is therefore refused
    // in savePosReservation and createPosOrder — a business rule, not a security
    // boundary. What IS proven below is the shape of the claim and who may make
    // one.
    await setMemberRole(uid, 'cashier');
    const reservation = (o = {}) => ({
        dimension_id: 'outlet-kemang', table_id: 't12', table_label: 'A04',
        guest_name: 'Maya', guest_phone: '0812', guest_email: null,
        party_size: 4, starts_at: new Date('2026-09-15T19:00:00+07:00'),
        duration_minutes: 90, source: 'phone', note: null,
        status: 'confirmed', order_id: null, seated_at: null,
        released_at: null, release_reason: null, version: 1,
        created_at: serverTimestamp(), updated_at: serverTimestamp(),
        created_by: uid, updated_by: uid, ...o
    });

    // A cashier answers the phone. A reservation book only the owner can write
    // to is a paper diary with extra steps.
    await expectOutcome('cashier takes a reservation', true, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), reservation()));
    await expectOutcome('a reservation with no guest name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-noname`), reservation({ guest_name: '' })));
    await expectOutcome('a party of zero is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-zero`), reservation({ party_size: 0 })));
    await expectOutcome('a fractional party is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-frac`), reservation({ party_size: 2.5 })));
    // Both directions are silent failures with opposite shapes: a zero-minute
    // sitting holds nothing, a twelve-hour one takes a table out of service for
    // a whole service by typo.
    await expectOutcome('a zero-minute sitting is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-inst`), reservation({ duration_minutes: 0 })));
    await expectOutcome('a sitting longer than ten hours is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-forever`), reservation({ duration_minutes: 900 })));
    // The guest's own words, dictated over the phone — the reason these are
    // bounded in rules and not only in the DAL.
    await expectOutcome('an 81-character guest name is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-long`), reservation({ guest_name: 'x'.repeat(81) })));
    await expectOutcome('a booking created already seated is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-seated`), reservation({ status: 'arrived' })));
    await expectOutcome('a booking created with an order attached is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-order`), reservation({ order_id: 'o1' })));
    await expectOutcome('an unknown field is denied (hasOnly)', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-extra`), reservation({ vip: true })));

    // Version advances by exactly one, as on orders and shifts: two hosts on
    // stale devices is the same race two waiters on one table are.
    await expectOutcome('seating the booking is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), {
            version: 2, status: 'arrived', order_id: 'o1', seated_at: serverTimestamp()
        }));
    await expectOutcome('a stale device re-using version 2 is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), { version: 2, status: 'completed' }));
    await expectOutcome('closing it out is allowed', true, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), {
            version: 3, status: 'completed', released_at: serverTimestamp()
        }));
    await expectOutcome('an unknown status is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), { version: 4, status: 'maybe' }));
    await expectOutcome('moving a booking to another outlet is denied', false, () =>
        updateDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`), { version: 4, dimension_id: 'outlet-other' }));
    // Never deleted: a cancelled booking is a fact about the evening, and
    // deleting it hides the no-show it may have become.
    await expectOutcome('nobody deletes a reservation', false, () =>
        deleteDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`)));

    // The boundary that matters. `cashier` is not a finance role, but it IS a
    // till role — reading the book is the whole job of the person on the door.
    await expectOutcome('a cashier reads the book', true, () =>
        getDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`)));
    await setMemberRole(uid, 'viewer');
    await expectOutcome('a viewer reads the book', true, () =>
        getDoc(doc(db, `workspaces/${WS}/pos_reservations/r1`)));
    await expectOutcome('a viewer may NOT write one', false, () =>
        setDoc(doc(db, `workspaces/${WS}/pos_reservations/r-viewer`), reservation()));

    console.log('\n— the audit trail the till writes —');
    // EVERY POS AUDIT WRITE WAS DENIED FROM 2026-08-21 TO 2026-09-02.
    //
    // `isValidWorkspaceAuditLog` validates `target_collection` against an
    // allowlist, and none of the four POS collections were on it. The DAL logs
    // ten actions across them; all ten were refused. Nothing went red, because
    // `_auditCreateBestEffort` catches and warns — correct for an audit write
    // (losing the log must never lose the sale), and exactly why it went
    // unnoticed: the Activity Log had no POS entries, which looks identical to
    // nobody using the till.
    //
    // The cases below are the REAL actions the DAL emits, spelled the way it
    // spells them, so a renamed collection breaks this rather than the trail.
    const auditLog = (o = {}) => ({
        actor_uid: uid, action: 'pos_order.refunded', target_collection: 'pos_orders',
        target_id: 'o1', before: null, after: {}, source: 'dashboard',
        created_at: serverTimestamp(), ...o
    });

    // A CASHIER is who performs most of these, so they are the role that has to
    // be able to write them. `audit_logs` create is `isMember`, not a finance
    // role, which is what makes that work.
    await setMemberRole(uid, 'cashier');
    const posAudits = [
        ['pos_order.paid', 'pos_orders'],
        ['pos_order.refunded', 'pos_orders'],
        ['pos_order.voided', 'pos_orders'],
        ['pos_shift.opened', 'pos_shifts'],
        ['pos_shift.closed', 'pos_shifts'],
        ['pos_table.created', 'pos_tables'],
        ['pos_table.updated', 'pos_tables'],
        ['pos_table.layout_saved', 'pos_tables'],
        ['pos_reservation.created', 'pos_reservations'],
        ['pos_reservation.no_show', 'pos_reservations']
    ];
    for (const [action, target] of posAudits) {
        await expectOutcome(`cashier logs ${action}`, true, () =>
            setDoc(doc(db, `workspaces/${WS}/audit_logs/al-${action.replace(/\./g, '-')}`),
                auditLog({ action, target_collection: target })));
    }

    // `pos_table.layout_saved` passes a NULL target id, which
    // `_auditCreateBestEffort` normalises to ''. The rule requires a string, so
    // the empty one has to be acceptable or that action alone would keep failing.
    await expectOutcome('an empty target_id is accepted (layout_saved sends null)', true, () =>
        setDoc(doc(db, `workspaces/${WS}/audit_logs/al-empty-target`),
            auditLog({ action: 'pos_table.layout_saved', target_collection: 'pos_tables', target_id: '' })));

    // The seed action denied the same way.
    await setMemberRole(uid, 'owner');
    await expectOutcome('business_categories.seeded is logged', true, () =>
        setDoc(doc(db, `workspaces/${WS}/audit_logs/al-bizcat`),
            auditLog({ action: 'business_categories.seeded', target_collection: 'business_categories', target_id: '' })));

    // The allowlist is still an allowlist. Widening it to anything would make
    // target_collection a free-text field and the trail unfilterable.
    await expectOutcome('an unknown target_collection is still denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/audit_logs/al-bogus`),
            auditLog({ target_collection: 'not_a_collection' })));
    // Impersonating another actor stays denied — the whole point of the trail.
    await expectOutcome('logging as someone else is denied', false, () =>
        setDoc(doc(db, `workspaces/${WS}/audit_logs/al-spoof`),
            auditLog({ actor_uid: 'someone-else' })));

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
