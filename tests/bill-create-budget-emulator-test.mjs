// =============================================================================
// FluxyOS — how rich a bill may be before rules run out of budget (emulator)
//
// Firestore evaluates at most 1000 expressions per request and re-validates the
// WHOLE document, so the bill validators — which walk every optional field of
// every feature ever shipped — have a hard ceiling on document richness. Past
// it, an ordinary create fails as "Missing or insufficient permissions", which
// reads like a rules bug and is really a budget overrun.
//
// This test walks a bill up in field groups and asserts where the ceiling sits.
// It is a TRIPWIRE, not a spec: if someone adds a field or a check to the bill
// validators, the ceiling moves down and a shape that used to save stops
// saving. Better to fail here than in a user's browser.
//
// History of the ceiling, measured not estimated:
//   before          22 keys — an ordinary budgeted bill already failed
//   lean validators 38 keys — enums/caps kept, redundant type checks dropped
//   null-free create 47 keys — the maximal shape, AI-scanned + budgeted +
//                    accounting-linked + full PPN and PPh withholding
//
// EVERY shape below must now create. A single added field or check can push the
// maximal one back over, and nothing else in the suite would notice.
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/bill-create-budget-emulator-test.mjs"
// =============================================================================

import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'k' }, 'probe');
const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const cred = await createUserWithEmailAndPassword(auth, `probe${Date.now()}@t.com`, 'passw0rd!');
const uid = cred.user.uid, WS = uid;
await setDoc(doc(db, `workspaces/${WS}`), { name: 'P', owner_uid: uid, created_at: serverTimestamp(), updated_at: serverTimestamp() }).catch(() => {});
await setDoc(doc(db, `workspaces/${WS}/members/${uid}`), { uid, email: cred.user.email, display_name: null, role: 'owner', status: 'active', invited_by: null, joined_at: serverTimestamp(), updated_at: serverTimestamp() }).catch(() => {});

const base = {
    amount: 89500000, vendor_name: 'PT Global Sukses', category: 'Operations',
    type: 'pending_payable', status: 'Upcoming', icon: '💸',
    timestamp: Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')),
    due_date: Timestamp.fromDate(new Date('2026-08-15T03:00:00Z')),
    payment_status: 'unpaid'
};
const groups = {
    numbering: { currency: 'IDR', bill_number: 'BILL-202608-0022', invoice_number: 'INV/119', outstanding_amount: 89500000, amount_paid: 0 },
    budget: { budget_id: 'b1', budget_allocation_id: 'a1', budget_match_method: 'auto', budget_match_status: 'matched', budget_impact_status: 'committed', budget_assignment_reason: 'x', budget_assignment_updated_at: serverTimestamp(), budget_assignment_updated_by: uid },
    accounting: { account_code: '6400', account_name: 'Operations Expense', accounting_status: 'posted', journal_ref: 'j1' },
    capture: { source: 'bill_scan', created_via: 'ai_bill_capture', extraction_status: 'reviewed', extraction_source: 'openai', extraction_confidence: 0.94, document_type: 'invoice', invoice_date: Timestamp.fromDate(new Date('2026-08-03T03:00:00Z')), source_file_name: 'i.pdf', source_file_mime_type: 'application/pdf', source_file_size_bytes: 220144, invoice_status: 'attached', attached_documents: [{ document_id: 'd1', role: 'invoice', storage_path: 'p', attached_at: null }] },
    tax: { tax_code: 'PPN_11', tax_rate_percent: 11, tax_amount: 8865000, taxable_base: 80635000, vendor_npwp: '01.234', faktur_number: '010.000', withholding_rate: 2, withholding_type: 'PPh 23', withholding_code: 'PPH23' }
};

// Shapes that MUST save. `tax` is expected to fail until the null clauses go.
const order = ['numbering', 'budget', 'accounting', 'capture', 'tax'];
const mustPass = new Set(['base', 'numbering', 'budget', 'accounting', 'capture', 'tax']);
let failures = 0;
let payload = { ...base };
let n = 0;
const tryCreate = async (key, label, body) => {
    let ok = true;
    try { await setDoc(doc(db, `workspaces/${WS}/bills/p${n++}`), body); }
    catch (e) { ok = false; }
    const keys = Object.keys(body).length;
    if (mustPass.has(key) && !ok) { failures++; console.error(`  FAIL    ${label} (${keys} keys) must be creatable`); }
    else console.log(`  ${ok ? 'OK     ' : 'over   '} ${label} (${keys} keys)`);
};
await tryCreate('base', 'base', payload);
for (const g of order) {
    payload = { ...payload, ...groups[g] };
    await tryCreate(g, '+ ' + g, payload);
}
console.log(failures === 0 ? '\nALL PASSED' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
