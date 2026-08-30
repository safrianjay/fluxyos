// =============================================================================
// FluxyOS — Point of Sale data access
//
// Extracted from db-service.js on 2026-08-30. This is Phase 1 of
// docs/POS_IMPLEMENTATION_PLAN.md §15: before a lean till can be served from
// anywhere, the POS surface has to be a bounded thing you can see the edges of.
// It was 1,011 lines in the middle of a 795 KB file that every page imports.
//
// WHAT THIS IS, AND WHAT IT IS NOT.
//
// These methods are mixed onto DataService.prototype, so `this` is a full
// DataService and every call site is unchanged. **It does not yet shrink the
// till bundle** — pos.html still loads db-service.js, which still loads this.
// Claiming otherwise would be the easy lie here.
//
// What it does buy is the boundary. The POS code now reaches into the rest of
// DataService through exactly NINE methods, and that list is asserted by
// tests/pos-service-boundary.check.js. Nothing can quietly deepen the coupling,
// which is the only thing that would make the standalone extraction impossible
// later.
//
// THE REMAINING DEPENDENCY CONE — what still has to be broken up before this
// file can stand on its own:
//
//   _scope, _resolvedScopeId   the workspace seam. Small, and genuinely shared.
//   _nullableString            a string helper. Trivial to move.
//   _auditCreateBestEffort     audit logging. Small.
//   getItems, getStockMovements  inventory reads. Medium.
//   _resolveSaleConsumption    recipe explosion + weighted-average costing.
//                              Shared with marketplace orders — moving it means
//                              moving inventory costing, not POS code.
//   _postSourceJournal         the accounting posting path. The big one, and
//                              the reason Phase 1 stops here: it reaches the
//                              kernel, which docs say not to touch for a
//                              POS-motivated refactor.
//   addTransaction             used by the QR/connector path.
//
// So the honest sequencing is: the POS DAL was never the hard part. Its POSTING
// and COSTING dependencies are, and they are shared with commerce and
// inventory — which means the next extraction is theirs, not this one's.
// =============================================================================

import {
    collection, query, where, getDocs, getDoc, setDoc, updateDoc,
    serverTimestamp, orderBy, limit, writeBatch, runTransaction, doc,
    Timestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { periodKey as acctPeriodKey } from "./accounting-engine.js";

// The payment methods a till can take. `settlement` is what the posting rules
// read: cash lands in 1000 immediately, QRIS/card sit with the acquirer and
// clear through 1030 on payout. Provider-agnostic on purpose — Midtrans and
// Xendit later add a row here rather than a branch anywhere else
// (docs/POS_IMPLEMENTATION_PLAN.md §11).
export const POS_PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash', settlement: 'cash' },
    { id: 'qris', label: 'QRIS', settlement: 'clearing' },
    { id: 'transfer', label: 'Bank transfer', settlement: 'cash' },
    { id: 'card', label: 'Card', settlement: 'clearing' },
    { id: 'other', label: 'Other', settlement: 'cash' }
];

// Mixed onto DataService.prototype by db-service.js. Written as an object of
// methods rather than a class so `this` stays the DataService instance and not
// one call site changed.
export const POS_METHODS = {

    // ═══════════════════════════════════════════════════════════════════════
    // POINT OF SALE
    //
    // Two collections, because everything else already exists: outlets are
    // `dimensions`, the menu is `items` (a composite item IS a recipe, so its
    // cost is already computable), stock relief is `stock_adjustments`, revenue
    // is `transactions`, and the per-outlet P&L is `ledger_balances_by_dim`.
    // docs/POS_IMPLEMENTATION_PLAN.md §7.
    //
    // `pos_orders` is a NORMALIZED order document. The first-party till is
    // merely its first writer — `channel` distinguishes staff / qr / connector,
    // so a Moka or Majoo connector later writes the same document and everything
    // downstream is shared.
    // ═══════════════════════════════════════════════════════════════════════

    // May THIS session post a journal? A cashier cannot write `journals` or
    // `ledger_balances` at all, and Firestore batches are ATOMIC — so attempting
    // the journal inline would fail the whole write, losing the sale rather than
    // deferring its posting. When false the source rows land
    // `accounting_status: 'pending'` and the existing postPendingJournals sweep
    // picks them up in the next finance session. Exactly the bulk-import and
    // commerce precedent (finance-map.js: "Never post here").
    _canPostJournals() {
        try {
            const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || null;
            if (ws && typeof ws.can === 'function') return !!ws.can('accounting.post');
        } catch (_) { /* fall through */ }
        return true; // non-browser callers (seeders, specs) post normally
    },

    // ── Tables ──────────────────────────────────────────────────────────────

    async getPosTables(userId, { dimensionId = null, includeArchived = false } = {}) {
        try {
            const snap = await getDocs(collection(this.db, `${this._scope(userId)}/pos_tables`));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((t) => includeArchived || t.status !== 'archived')
                .filter((t) => !dimensionId || t.dimension_id === dimensionId)
                .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
                    || String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true }));
        } catch (_) { return []; }
    },

    // 256 bits of CSPRNG output, base64url. Never derived from the table id, a
    // sequence, or a timestamp: a guessable token is a readable menu and a
    // submittable order for someone else's business.
    _newQrToken() {
        const bytes = new Uint8Array(32);
        (globalThis.crypto || window.crypto).getRandomValues(bytes);
        let s = '';
        bytes.forEach((b) => { s += String.fromCharCode(b); });
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    async savePosTable(userId, data = {}, { create = false, tableId = null } = {}) {
        if (!userId) throw new Error('userId required');
        const label = String(data.label || '').trim();
        if (!label) throw new Error('A table needs a name or number.');
        if (label.length > 40) throw new Error('That table name is too long (40 characters max).');
        const dimensionId = String(data.dimension_id || '').trim();
        if (!dimensionId) throw new Error('Pick which outlet this table belongs to.');

        const scope = this._scope(userId);
        const payload = {
            label,
            dimension_id: dimensionId,
            seats: Number.isInteger(Number(data.seats)) && Number(data.seats) > 0 ? Number(data.seats) : null,
            zone: this._nullableString(data.zone, 40),
            status: data.status === 'archived' ? 'archived' : 'active',
            sort: Number.isInteger(Number(data.sort)) ? Number(data.sort) : 0,
            updated_at: serverTimestamp()
        };

        if (create) {
            const existing = await this.getPosTables(userId, { includeArchived: true });
            if (existing.some((t) => t.dimension_id === dimensionId
                && String(t.label).toLowerCase() === label.toLowerCase())) {
                throw new Error(`This outlet already has a table called "${label}".`);
            }
            const ref = doc(collection(this.db, `${scope}/pos_tables`));
            payload.qr_token = this._newQrToken();
            payload.created_at = serverTimestamp();
            await setDoc(ref, payload);
            await this._auditCreateBestEffort(userId, 'pos_table.created', 'pos_tables', ref.id,
                { label, dimension_id: dimensionId });
            return { id: ref.id, ...payload };
        }

        if (!tableId) throw new Error('tableId required');
        await updateDoc(doc(this.db, `${scope}/pos_tables/${tableId}`), payload);
        await this._auditCreateBestEffort(userId, 'pos_table.updated', 'pos_tables', tableId, { label });
        return { id: tableId, ...payload };
    },

    async archivePosTable(userId, tableId, { restore = false } = {}) {
        if (!userId || !tableId) throw new Error('userId and tableId required');
        await updateDoc(doc(this.db, `${this._scope(userId)}/pos_tables/${tableId}`), {
            status: restore ? 'active' : 'archived', updated_at: serverTimestamp()
        });
        await this._auditCreateBestEffort(userId,
            restore ? 'pos_table.reactivated' : 'pos_table.archived', 'pos_tables', tableId, {});
    },

    // ── Menu ────────────────────────────────────────────────────────────────

    // The menu IS `items`: anything with a price that is marked visible. No
    // separate menu collection, so a dish's recipe — and therefore its true cost
    // — is the same record the kitchen already maintains.
    async getPosMenu(userId) {
        const items = await this.getItems(userId);
        return items
            .filter((i) => i.pos_visible === true && Number.isInteger(Number(i.sales_price)) && Number(i.sales_price) > 0)
            .map((i) => ({
                id: i.id, name: i.name, type: i.type,
                sales_price: Number(i.sales_price),
                pos_category: i.pos_category || null,
                base_unit: i.base_unit,
                pos_sort: Number.isInteger(Number(i.pos_sort)) ? Number(i.pos_sort) : 0,
                // A composite with components has a real cost basis; a bare stock
                // item is costed from its own movements. Neither is asserted here
                // — getPosOverview measures it against actual movements.
                has_recipe: i.type === 'composite' && Array.isArray(i.components) && i.components.length > 0
            }))
            .sort((a, b) => (a.pos_sort - b.pos_sort)
                || String(a.pos_category || '').localeCompare(String(b.pos_category || ''))
                || String(a.name).localeCompare(String(b.name)));
    },

    // ── Orders ──────────────────────────────────────────────────────────────

    // The trading day belongs to the BUSINESS, not the device. This used to read
    // the tablet's local calendar, so a till whose clock was set to another zone
    // restarted the per-outlet order numbers mid-service and filed the sales
    // under the wrong day. Resolves from the workspace country via the money
    // seam — see FluxyMoney.businessDayKey.
    _posDayKey(d = new Date()) {
        const m = (typeof window !== 'undefined' && window.FluxyMoney) || null;
        if (m && typeof m.businessDayKey === 'function') return m.businessDayKey(d);
        // The seam is loaded by every page that can reach the till, so this is a
        // last resort rather than a supported path — matching the device is still
        // better than refusing to open an order.
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    },

    // Recompute every derived figure from the lines. Called on every mutation so
    // a total can never drift from what it is a total OF — the client never sends
    // a total, it sends lines.
    _posTotals(order) {
        const lines = Array.isArray(order.lines) ? order.lines : [];
        const subtotal = lines.reduce((s, l) => s + (Number(l.gross_amount) || 0), 0);
        const lineDiscount = lines.reduce((s, l) => s + (Number(l.discount_amount) || 0), 0);
        const orderDiscount = Math.max(0, Number(order.discount_amount) || 0);
        // Clamped: an order discount larger than what is left after line discounts
        // would make the sale negative and post a backwards journal.
        const capped = Math.min(orderDiscount, Math.max(0, subtotal - lineDiscount));
        const discountTotal = lineDiscount + capped;
        const service = Math.max(0, Number(order.service_charge_amount) || 0);
        const tax = Math.max(0, Number(order.tax_amount) || 0);
        const paid = (Array.isArray(order.payments) ? order.payments : [])
            .filter((p) => p && p.status === 'settled')
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        return {
            subtotal,
            discount_amount: capped,
            discount_total: discountTotal,
            service_charge_amount: service,
            tax_amount: tax,
            total_amount: subtotal - discountTotal + service + tax,
            paid_amount: paid
        };
    },

    async createPosOrder(userId, { dimensionId, tableId = null, tableLabel = null, channel = 'staff', note = null, shiftId = null } = {}) {
        if (!userId) throw new Error('userId required');
        if (!dimensionId) throw new Error('Pick an outlet before opening an order.');
        const scope = this._scope(userId);
        const now = new Date();
        const dayKey = this._posDayKey(now);
        // Per-outlet, per-day sequence, reserved transactionally — the same
        // mechanism journal numbers use. Two tills opening at once get 14 and 15,
        // not two 14s. Never derived from a timestamp: staff call the number out.
        const counterRef = doc(this.db, `${scope}/counters/pos-${dimensionId}-${dayKey}`);
        const orderRef = doc(collection(this.db, `${scope}/pos_orders`));

        const seq = await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(counterRef);
            const next = (snap.exists() ? (Number(snap.data().seq) || 0) : 0) + 1;
            tx.set(counterRef, { seq: next, entity_id: this._resolvedScopeId(userId), updated_at: serverTimestamp() }, { merge: true });
            return next;
        });

        const payload = {
            order_number: `${dayKey}-${String(seq).padStart(3, '0')}`,
            dimension_id: dimensionId,
            table_id: tableId || null,
            table_label: tableLabel || null,
            channel: ['staff', 'qr', 'connector'].includes(channel) ? channel : 'staff',
            status: channel === 'qr' ? 'submitted' : 'open',
            lines: [], subtotal: 0, discount_amount: 0, discount_reason: null, discount_total: 0,
            service_charge_amount: 0, tax_amount: 0, total_amount: 0,
            payments: [], paid_amount: 0,
            note: this._nullableString(note, 200),
            // Which drawer rang this up. Null when no shift was open — those
            // sales are real but sit outside every cash count, which is exactly
            // what the POS overview nudges about.
            shift_id: shiftId || null,
            version: 1,
            opened_at: Timestamp.fromDate(now),
            paid_at: null, voided_at: null, void_reason: null,
            transaction_id: null, stock_adjustment_id: null,
            refund_transaction_id: null, refund_reason: null, refunded_at: null,
            created_at: serverTimestamp(), updated_at: serverTimestamp(),
            created_by: this.actorUid || userId, updated_by: this.actorUid || userId
        };
        await setDoc(orderRef, payload);
        return { id: orderRef.id, ...payload };
    },

    // Every order mutation goes through here.
    //
    // `mutate(order)` returns the changed fields. It runs INSIDE a transaction
    // against a fresh read, and `version` must advance by exactly one — which is
    // what makes a second waiter's stale device lose the race loudly instead of
    // silently overwriting the line the first one just added. Last-write-wins on
    // an embedded lines[] loses a dish and nothing reports it
    // (docs/POS_IMPLEMENTATION_PLAN.md §18.2).
    async updatePosOrder(userId, orderId, mutate) {
        if (!userId || !orderId) throw new Error('userId and orderId required');
        const ref = doc(this.db, `${this._scope(userId)}/pos_orders/${orderId}`);
        return runTransaction(this.db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('That order no longer exists.');
            const current = { id: snap.id, ...snap.data() };
            if (current.status === 'void') throw new Error('This order was voided and can no longer be changed.');
            const changes = (await mutate(current)) || {};
            const merged = { ...current, ...changes };
            const totals = this._posTotals(merged);
            const patch = {
                ...changes, ...totals,
                version: (Number(current.version) || 1) + 1,
                updated_at: serverTimestamp(),
                updated_by: this.actorUid || userId
            };
            delete patch.id;
            tx.update(ref, patch);
            return { ...merged, ...totals, version: patch.version };
        });
    },

    async addPosOrderLine(userId, orderId, { itemId, itemName, quantity = 1, unitPrice, note = null }) {
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number of one or more.');
        const price = Number(unitPrice);
        if (!Number.isInteger(price) || price < 0) throw new Error('That item has no valid price.');
        return this.updatePosOrder(userId, orderId, (order) => {
            const lines = [...(order.lines || [])];
            // Same item, same price, no note → bump the existing line rather than
            // stacking duplicates. A kitchen ticket reading "1 × Nasi Goreng"
            // four times is how a portion goes missing.
            const at = lines.findIndex((l) => l.item_id === itemId && !l.note && !note && Number(l.unit_price) === price);
            if (at >= 0) {
                const q = (Number(lines[at].quantity) || 0) + qty;
                lines[at] = { ...lines[at], quantity: q, gross_amount: q * price };
            } else {
                lines.push({
                    line_id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
                    item_id: itemId, item_name: itemName, quantity: qty,
                    unit_price: price, gross_amount: qty * price,
                    discount_amount: 0, discount_reason: null,
                    note: this._nullableString(note, 120)
                });
            }
            return { lines };
        });
    },

    async setPosOrderLineQuantity(userId, orderId, lineId, quantity) {
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty < 0) throw new Error('Quantity must be a whole number.');
        return this.updatePosOrder(userId, orderId, (order) => {
            const lines = (order.lines || [])
                .map((l) => (l.line_id === lineId
                    // The price is the one copied onto the line when it was added,
                    // never today's menu price: a price edited mid-service must
                    // not retroactively change an open order.
                    ? { ...l, quantity: qty, gross_amount: qty * (Number(l.unit_price) || 0) }
                    : l))
                .filter((l) => Number(l.quantity) > 0);
            return { lines };
        });
    },

    // A discount is stored SEPARATELY from the price, never as a lower price.
    // Fold it in and the menu price is gone from the ledger forever: no price
    // integrity, no discount analytics, no anomaly detection (§18.4).
    async setPosOrderDiscount(userId, orderId, { lineId = null, amount = 0, reason = null } = {}) {
        const amt = Math.max(0, Math.round(Number(amount) || 0));
        const why = this._nullableString(reason, 80);
        if (amt > 0 && !why) throw new Error('Say why the discount was given — it is the only record of it.');
        return this.updatePosOrder(userId, orderId, (order) => {
            if (!lineId) return { discount_amount: amt, discount_reason: amt > 0 ? why : null };
            const lines = (order.lines || []).map((l) => (l.line_id === lineId
                ? { ...l, discount_amount: Math.min(amt, Number(l.gross_amount) || 0), discount_reason: amt > 0 ? why : null }
                : l));
            return { lines };
        });
    },

    async setPosOrderStatus(userId, orderId, status) {
        const allowed = ['open', 'submitted', 'sent', 'served', 'awaiting_payment'];
        if (!allowed.includes(status)) throw new Error(`"${status}" is not a status an order can be moved to here.`);
        return this.updatePosOrder(userId, orderId, () => ({ status }));
    },

    async voidPosOrder(userId, orderId, reason) {
        const why = this._nullableString(reason, 200);
        if (!why) throw new Error('A voided order needs a reason — it is the only trace it leaves.');
        const out = await this.updatePosOrder(userId, orderId, (order) => {
            // A paid order has already posted revenue and relieved stock; undoing
            // that is a refund (which reverses both), not a void.
            if (order.status === 'paid') throw new Error('This order is already paid. Refund it instead — a void would leave the revenue posted.');
            return { status: 'void', void_reason: why, voided_at: Timestamp.fromDate(new Date()) };
        });
        await this._auditCreateBestEffort(userId, 'pos_order.voided', 'pos_orders', orderId,
            { reason: why, total_amount: out.total_amount });
        return out;
    },

    // ── Payment ─────────────────────────────────────────────────────────────

    // Manual is a PROVIDER, not a special case. Every downstream consumer — the
    // state machine, the posting rules, reconciliation — is written once against
    // this shape, so Midtrans/Xendit later add a provider rather than a branch
    // (docs/POS_IMPLEMENTATION_PLAN.md §11).
    //
    // Cash settles to 1000 immediately; QRIS/card/e-wallet sit with the acquirer,
    // so they settle through 1030 and clear on payout.

    _posSettlementFor(method) {
        const m = POS_PAYMENT_METHODS.find((x) => x.id === method);
        return m ? m.settlement : 'cash';
    },

    // Split an order's settled payments into the two accounts they land in.
    //
    // NON-CASH TENDER IS EXACT; CASH ABSORBS THE REMAINDER. Nobody overpays a
    // QRIS or a card, and change is only ever given in cash — so a customer who
    // hands over Rp170.000 cash plus Rp80.000 QRIS against a Rp200.000 bill has
    // settled exactly Rp80.000 to clearing and Rp120.000 to cash, with Rp50.000
    // change. Apportioning both sides proportionally would put Rp64.000 in
    // clearing and quietly corrupt the payout reconciliation.
    //
    // `cash` is DERIVED as amount − clearing rather than summed independently,
    // so the two always total the amount exactly. That is what lets the posting
    // rule trust the split without a rounding-tolerance check, and it is why an
    // unbalanced POS journal is not reachable from here.
    // The single largest tender's settlement class. Display and back-compat only
    // — `pos_settlement` stopped deciding the journal when the split shipped, and
    // is kept so rows written before that still read back sensibly and so the
    // receipt can say how the bill was mostly paid.
    _posRefundDominant(order) {
        const byMethod = {};
        (order.payments || [])
            .filter((p) => p.status === 'settled')
            .forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + (Number(p.amount) || 0); });
        const dominant = Object.keys(byMethod).sort((a, b) => byMethod[b] - byMethod[a])[0] || 'cash';
        return this._posSettlementFor(dominant);
    },

    _posSettlementAmounts(order, amount) {
        const total = Math.round(Number(amount) || 0);
        const clearingPaid = (order.payments || [])
            .filter((p) => p.status === 'settled' && this._posSettlementFor(p.method) === 'clearing')
            .reduce((sum, p) => sum + Math.round(Number(p.amount) || 0), 0);
        const clearing = Math.max(0, Math.min(total, clearingPaid));
        return { cash: total - clearing, clearing };
    },

    // Record money received. An order becomes `paid` only when what has been
    // recorded covers the bill — paid is DERIVED, never asserted. Partial
    // payments accumulate; the order stays awaiting_payment until the balance
    // reaches zero.
    async recordPosPayment(userId, orderId, { method = 'cash', amount, reference = null } = {}) {
        const amt = Math.round(Number(amount) || 0);
        if (amt <= 0) throw new Error('Enter how much was received.');
        const methods = POS_PAYMENT_METHODS.map((m) => m.id);
        if (!methods.includes(method)) throw new Error('Pick how the customer paid.');

        const order = await this.updatePosOrder(userId, orderId, (o) => {
            if (o.status === 'paid') throw new Error('This order is already fully paid.');
            if (!(o.lines || []).length) throw new Error('There is nothing on this order to pay for.');
            const payments = [...(o.payments || []), {
                payment_id: `p${Date.now().toString(36)}`,
                method, provider: 'manual', amount: amt,
                reference: this._nullableString(reference, 80),
                status: 'settled',
                received_at: Timestamp.fromDate(new Date()),
                received_by: this.actorUid || userId
            }];
            const totals = this._posTotals({ ...o, payments });
            const settled = totals.paid_amount >= totals.total_amount;
            return {
                payments,
                status: settled ? 'paid' : 'awaiting_payment',
                paid_at: settled ? Timestamp.fromDate(new Date()) : null
            };
        });

        // Only a PAID order emits. An open or partially-paid one has produced no
        // financial event yet, and a voided one never will.
        if (order.status === 'paid') {
            try {
                await this._emitPosSale(userId, order);
            } catch (err) {
                // The money is recorded either way. Emission is retried by
                // `emitUnpostedPosSales`, and the POS overview surfaces the
                // backlog rather than letting it sit silently.
                console.error('[pos] sale recorded but not yet emitted to the ledger:', err && err.message);
            }
        }
        return order;
    },


    // ── The cash drawer ─────────────────────────────────────────────────────
    //
    // A shift is what makes the till reconcilable. Without it an owner has a
    // sales figure and a drawer full of cash and no way to ask whether they
    // agree — which is the single question every close-of-day actually asks.
    //
    // THE OPENING FLOAT DOES NOT POST. Moving cash from the safe to the drawer
    // is an internal movement inside `1000 Cash & Bank`; a journal would be
    // Dr 1000 / Cr 1000, which nets to nothing and fails the balance assertion
    // anyway. The float still changes what the drawer SHOULD hold, so it is
    // arithmetic, not accounting. Counterintuitive enough to be worth stating.
    //
    // Only the VARIANCE posts (POS-SHIFT-VARIANCE → 6700), and only when it is
    // non-zero.

    _shiftExpectedCash(shift) {
        const paidIn = (shift.movements || [])
            .filter((m) => m.kind === 'paid_in').reduce((s, m) => s + (Number(m.amount) || 0), 0);
        const paidOut = (shift.movements || [])
            .filter((m) => m.kind === 'paid_out').reduce((s, m) => s + (Number(m.amount) || 0), 0);
        return Math.round(Number(shift.opening_float) || 0)
            + Math.round(Number(shift.cash_sales) || 0)
            + paidIn - paidOut;
    },

    async getOpenPosShift(userId, { dimensionId } = {}) {
        try {
            const snap = await getDocs(query(
                collection(this.db, `${this._scope(userId)}/pos_shifts`),
                orderBy('created_at', 'desc'), limit(20)
            ));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .find((s) => s.status === 'open' && (!dimensionId || s.dimension_id === dimensionId)) || null;
        } catch (_) { return null; }
    },

    async listPosShifts(userId, { dimensionId = null, limitCount = 20 } = {}) {
        try {
            const snap = await getDocs(query(
                collection(this.db, `${this._scope(userId)}/pos_shifts`),
                orderBy('created_at', 'desc'), limit(limitCount)
            ));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((s) => !dimensionId || s.dimension_id === dimensionId);
        } catch (_) { return []; }
    },

    async openPosShift(userId, { dimensionId, openingFloat = 0, note = null } = {}) {
        if (!userId) throw new Error('userId required');
        if (!dimensionId) throw new Error('Pick an outlet before opening a shift.');
        const float = Math.round(Number(openingFloat) || 0);
        if (float < 0) throw new Error('The opening float cannot be negative.');

        // One drawer per outlet. Two open shifts would each claim the same sales
        // and neither would reconcile. Rules cannot query, so this is the DAL's
        // job — the same class of guard as `sku` uniqueness on items.
        const existing = await this.getOpenPosShift(userId, { dimensionId });
        if (existing) throw new Error('This outlet already has a shift open. Close it before starting another.');

        const ref = doc(collection(this.db, `${this._scope(userId)}/pos_shifts`));
        const payload = {
            dimension_id: dimensionId,
            status: 'open',
            opened_at: Timestamp.fromDate(new Date()),
            opened_by: this.actorUid || userId,
            opening_float: float,
            movements: [],
            closed_at: null, closed_by: null,
            counted_cash: null, expected_cash: null, variance: null,
            cash_sales: 0, non_cash_sales: 0, order_count: 0,
            note: this._nullableString(note, 200),
            journal_ref: null, accounting_status: null,
            version: 1,
            created_at: serverTimestamp(), updated_at: serverTimestamp()
        };
        await setDoc(ref, payload);
        await this._auditCreateBestEffort(userId, 'pos_shift.opened', 'pos_shifts', ref.id,
            { opening_float: float, dimension_id: dimensionId });
        return { id: ref.id, ...payload };
    },

    // Cash in or out of the drawer that is not a sale.
    //
    // PAID OUT posts an ordinary expense — buying ice, paying a courier — because
    // that money genuinely left the business. PAID IN does not: it is almost
    // always change topped up from the safe, which is internal. If a paid-in ever
    // needs to post, it is not a paid-in; it is a sale or a refund and belongs on
    // an order.
    async recordPosShiftMovement(userId, shiftId, { kind, amount, reason, category = 'Operations' } = {}) {
        if (!['paid_in', 'paid_out'].includes(kind)) throw new Error('A drawer movement is either paid in or paid out.');
        const amt = Math.round(Number(amount) || 0);
        if (amt <= 0) throw new Error('Enter how much went in or out.');
        const why = this._nullableString(reason, 120);
        if (!why) throw new Error('Say what the money was for — it is the only record of it.');

        const scope = this._scope(userId);
        const ref = doc(this.db, `${scope}/pos_shifts/${shiftId}`);
        const out = await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('That shift no longer exists.');
            const cur = { id: snap.id, ...snap.data() };
            if (cur.status !== 'open') throw new Error('This shift is closed.');
            const movements = [...(cur.movements || []), {
                id: `m${Date.now().toString(36)}`,
                kind, amount: amt, reason: why,
                at: Timestamp.fromDate(new Date()),
                by: this.actorUid || userId
            }];
            tx.update(ref, { movements, version: (Number(cur.version) || 1) + 1, updated_at: serverTimestamp() });
            return { ...cur, movements, version: (Number(cur.version) || 1) + 1 };
        });

        if (kind === 'paid_out') {
            try {
                await this.addTransaction(userId, {
                    amount: amt, vendor_name: why, category, type: 'expense', icon: '💸',
                    status: 'Completed', timestamp: new Date(), dimension_id: out.dimension_id
                });
            } catch (err) {
                console.error('[pos] paid-out recorded in the drawer but not posted:', err && err.message);
            }
        }
        return out;
    },

    // What the shift sold, read from the orders that carry its id. Exact rather
    // than a time-range guess, which two tills at one outlet would make
    // ambiguous the moment that ships.
    async getPosShiftTally(userId, shiftId) {
        const orders = await this.getPosOrders(userId, { statuses: ['paid'], limitCount: 300 });
        const mine = orders.filter((o) => o.shift_id === shiftId);
        const cashMethods = POS_PAYMENT_METHODS
            .filter((m) => m.settlement === 'cash').map((m) => m.id);
        let cash = 0; let nonCash = 0;
        const byMethod = {};
        mine.forEach((o) => {
            (o.payments || []).filter((p) => p.status === 'settled').forEach((p) => {
                const amt = Number(p.amount) || 0;
                byMethod[p.method] = (byMethod[p.method] || 0) + amt;
                if (cashMethods.includes(p.method)) cash += amt; else nonCash += amt;
            });
            // A refund hands cash back out of the same drawer.
            if (o.refund_transaction_id) cash -= Number(o.total_amount) || 0;
        });
        return { cash_sales: cash, non_cash_sales: nonCash, order_count: mine.length, by_method: byMethod };
    },

    // Close it. `countedCash` is what was physically counted, and the caller is
    // expected NOT to have shown the expected figure first — see closePosShift's
    // note in pos.js. The variance posts only when it is non-zero.
    async closePosShift(userId, shiftId, { countedCash, note = null } = {}) {
        const counted = Math.round(Number(countedCash));
        if (!Number.isFinite(counted) || counted < 0) throw new Error('Enter the cash you counted in the drawer.');

        const scope = this._scope(userId);
        const ref = doc(this.db, `${scope}/pos_shifts/${shiftId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('That shift no longer exists.');
        const shift = { id: snap.id, ...snap.data() };
        if (shift.status !== 'open') throw new Error('This shift is already closed.');

        const tally = await this.getPosShiftTally(userId, shiftId);
        const withSales = { ...shift, cash_sales: tally.cash_sales };
        const expected = this._shiftExpectedCash(withSales);
        const variance = counted - expected;
        const when = new Date();

        const patch = {
            status: 'closed',
            closed_at: Timestamp.fromDate(when),
            closed_by: this.actorUid || userId,
            counted_cash: counted,
            expected_cash: expected,
            variance,
            cash_sales: tally.cash_sales,
            non_cash_sales: tally.non_cash_sales,
            order_count: tally.order_count,
            note: this._nullableString(note, 200) || shift.note || null,
            version: (Number(shift.version) || 1) + 1,
            updated_at: serverTimestamp()
        };

        // A drawer that counted exactly right has nothing to say to the ledger.
        //
        // The SHIFT is the source document and posts directly, exactly as
        // `goods_receipts` and `stock_adjustments` do. An earlier cut also wrote
        // a `transactions` row so the variance would show in the ledger view —
        // which was a double count waiting to happen: that row carried
        // `accounting_status: 'pending'`, so postPendingJournals would have
        // posted it a SECOND time as an ordinary expense, on top of this
        // journal. The variance is visible in the Accounting Center and on
        // /outlet-pnl, which is where a posting belongs.
        if (variance !== 0) {
            const batch = writeBatch(this.db);
            if (this._canPostJournals()) {
                // `patch` itself goes in, so _postSourceJournal stamps
                // journal_ref + accounting_status onto the object that is
                // actually written. Passing a copy — as the first cut did —
                // posts the journal and leaves the shift unable to name it.
                patch.reference = `Shift ${shiftId.slice(0, 6)}`;
                await this._postSourceJournal(userId, batch, 'pos_shifts', ref, patch, { date: when });
                delete patch.reference;
            }
            batch.update(ref, patch);
            await batch.commit();
        } else {
            await updateDoc(ref, patch);
        }

        await this._auditCreateBestEffort(userId, 'pos_shift.closed', 'pos_shifts', shiftId, {
            counted_cash: counted, expected_cash: expected, variance,
            order_count: tally.order_count, dimension_id: shift.dimension_id
        });
        return { id: shiftId, ...shift, ...patch, by_method: tally.by_method };
    },

    // ── Emission: where an operational event becomes a financial one ────────
    //
    // One paid order produces exactly two source documents:
    //   transactions{source:'pos'}          → POS-SALE   (Dr cash|1030, Dr 4900, Cr 4000)
    //   stock_adjustments{type:'sale'}      → CM-ORDER-COGS (Dr 5100, Cr 1200)
    //
    // IDEMPOTENT WITHOUT A FLAG: `transaction_id` being set IS the record that
    // this order has emitted. Same principle as relieveCommerceCogs using the
    // movement's `source` rather than a flag on an immutable order.
    async _emitPosSale(userId, order) {
        if (!order || order.status !== 'paid') return null;
        if (order.transaction_id) return { transaction_id: order.transaction_id, already: true };

        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const when = order.paid_at && typeof order.paid_at.toDate === 'function' ? order.paid_at.toDate() : new Date();
        const canPost = this._canPostJournals();

        // Settlement follows the LARGEST payment: a split bill settling mostly by
        // QRIS belongs in clearing. Mixed-tender splitting across two journals is
        // deferred — it needs a per-payment posting model, not a bigger rule.
        // `pos_settlement` is retained as the DOMINANT method for display and for
        // reading back rows posted before the split existed. It no longer decides
        // the journal — pos_cash_amount / pos_clearing_amount do.

        // `amount` is NET revenue (gross − discount) because every existing
        // revenue surface sums transaction amounts — the dashboard KPI, the
        // income statement, /outlet-pnl. The gross price is recovered inside
        // POS-SALE from pos_discount_amount.
        const net = Math.round(Number(order.total_amount) || 0)
            - Math.round(Number(order.service_charge_amount) || 0)
            - Math.round(Number(order.tax_amount) || 0);
        if (net <= 0) return null;

        const txRef = doc(collection(this.db, `${scope}/transactions`));
        const tx = {
            amount: net,
            vendor_name: order.table_label ? `Meja ${order.table_label}` : `Order ${order.order_number || ''}`.trim(),
            category: 'Sales',
            type: 'income',
            // Required: isValidBaseRecord uses hasAll and lists `icon`. Without
            // it the write is refused for an owner — who is held to the full
            // wsValidTxCreate, since hasRole() short-circuits into that clause
            // before the lean cashier one is ever reached.
            icon: '💰',
            status: 'Completed',
            timestamp: Timestamp.fromDate(when),
            created_at: serverTimestamp(),
            source: 'pos',
            accounting_status: 'pending',
            dimension_id: order.dimension_id || null,
            pos_order_id: order.id,
            pos_discount_amount: Math.round(Number(order.discount_total) || 0),
            pos_discount_reason: this._nullableString(order.discount_reason, 80),
            pos_settlement: this._posRefundDominant(order),
            // How the money ACTUALLY split. A half-cash/half-QRIS bill used to
            // post entirely to whichever side was larger.
            ...this._posSettlementAmounts(order, net),
            pos_refund_reason: null
        };

        const batch = writeBatch(this.db);
        if (canPost) {
            // Posts POS-SALE in the same atomic batch as the row, exactly as
            // addTransaction does. A cashier session skips this — see
            // _canPostJournals — and the sweep posts it later.
            await this._postSourceJournal(userId, batch, 'transactions', txRef, tx, { date: when });
        }
        batch.set(txRef, tx);

        // ── Stock relief. Independent of revenue on purpose: an item with no
        // recipe and no cost basis still sells, it just produces no COGS row.
        // That must be VISIBLE (getPosOverview counts it), never silent.
        let adjRef = null;
        try {
            const [items, movements] = await Promise.all([
                this.getItems(userId, { includeArchived: true }),
                this.getStockMovements(userId, { limitCount: 1000 })
            ]);
            const byId = {}; const bySku = {};
            items.forEach((i) => { byId[i.id] = i; if (i.sku) bySku[String(i.sku).toLowerCase()] = i; });
            const onHand = {};
            movements.forEach((m) => {
                const b = onHand[m.item_id] || (onHand[m.item_id] = { quantity: 0, value: 0 });
                b.quantity += Number(m.quantity) || 0;
                b.value += Number(m.amount) || 0;
            });

            // The SAME resolver a marketplace order uses. Recipes explode,
            // shared ingredients merge, rounding happens once per movement, and
            // an oversell relieves anyway at the last known cost so the gap shows
            // as negative stock rather than a flattering margin.
            const { lines } = this._resolveSaleConsumption({
                soldLines: (order.lines || []).map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) || 0 })),
                byId, bySku, onHand
            });
            const cogs = lines.reduce((s, l) => s + Math.abs(l.amount), 0);

            if (lines.length && cogs > 0) {
                adjRef = doc(collection(this.db, `${scope}/stock_adjustments`));
                const adj = {
                    adjustment_type: 'sale',
                    dimension_id: order.dimension_id || null,
                    reference: `POS ${order.order_number || order.id}`,
                    lines: lines.map((l) => ({ ...l })),
                    total_amount: -cogs,
                    line_count: lines.length,
                    status: 'posted',
                    timestamp: Timestamp.fromDate(when),
                    created_by: this.actorUid || userId,
                    created_at: serverTimestamp()
                };
                if (canPost) await this._postSourceJournal(userId, batch, 'stock_adjustments', adjRef, adj, { date: when });
                batch.set(adjRef, adj);

                const pk = acctPeriodKey(when);
                lines.forEach((l) => {
                    batch.set(doc(collection(this.db, `${scope}/stock_movements`)), {
                        item_id: l.item_id, item_name: l.item_name, dimension_id: order.dimension_id || null,
                        quantity: l.quantity, base_unit: l.base_unit, amount: l.amount,
                        movement_type: 'issue',
                        source: { collection: 'pos_orders', id: order.id },
                        journal_ref: adj.journal_ref || null,
                        period_key: pk, entity_id: entityId,
                        created_by: this.actorUid || userId, created_at: serverTimestamp()
                    });
                });
            }
        } catch (err) {
            // Cost relief failing must never lose the sale. Revenue still posts;
            // the missing COGS shows up as an unrelieved order on the overview.
            console.error('[pos] stock relief skipped for this order:', err && err.message);
        }

        // The stamp goes in the SAME batch as what it stamps. Doing it after the
        // commit left a window where the transaction existed and the order did
        // not know it — and `transaction_id` IS the idempotency key, so the next
        // sweep emitted the sale again. Atomic means both land or neither, and
        // there is no such window.
        batch.update(doc(this.db, `${scope}/pos_orders/${order.id}`), {
            transaction_id: txRef.id,
            stock_adjustment_id: adjRef ? adjRef.id : null,
            version: (Number(order.version) || 1) + 1,
            updated_at: serverTimestamp()
        });

        await batch.commit();

        await this._auditCreateBestEffort(userId, 'pos_order.paid', 'pos_orders', order.id, {
            order_number: order.order_number, total_amount: order.total_amount,
            dimension_id: order.dimension_id, settlement: tx.pos_settlement
        });
        return { transaction_id: txRef.id, stock_adjustment_id: adjRef ? adjRef.id : null };
    },

    // Retry emission for orders that were paid but never reached the ledger —
    // the till lost connectivity mid-commit, or stock relief threw. Idempotent:
    // an order carrying a transaction_id is skipped.
    async emitUnpostedPosSales(userId, { limitCount = 50 } = {}) {
        const orders = await this.getPosOrders(userId, { statuses: ['paid'], limitCount });
        let emitted = 0;
        for (const o of orders) {
            if (o.transaction_id) continue;
            try { await this._emitPosSale(userId, o); emitted++; } catch (_) { /* next sweep */ }
        }
        return { emitted };
    },

    // ── Refund ──────────────────────────────────────────────────────────────

    // Reverses BOTH sides. A refund that reverses revenue but not COGS inverts
    // gross margin silently — the mirror of the defect CM-ORDER-COGS fixed.
    async refundPosOrder(userId, orderId, reason) {
        const why = this._nullableString(reason, 200);
        if (!why) throw new Error('A refund needs a reason.');
        const scope = this._scope(userId);
        const snap = await getDoc(doc(this.db, `${scope}/pos_orders/${orderId}`));
        if (!snap.exists()) throw new Error('That order no longer exists.');
        const order = { id: snap.id, ...snap.data() };
        if (order.status !== 'paid') throw new Error('Only a paid order can be refunded.');
        if (order.refund_transaction_id) throw new Error('This order has already been refunded.');

        const when = new Date();
        const net = Math.round(Number(order.total_amount) || 0);
        const txRef = doc(collection(this.db, `${scope}/transactions`));
        const tx = {
            amount: net,
            vendor_name: order.table_label ? `Meja ${order.table_label}` : `Order ${order.order_number || ''}`.trim(),
            category: 'Sales', type: 'refund', icon: '💸', status: 'Completed',
            timestamp: Timestamp.fromDate(when), created_at: serverTimestamp(),
            source: 'pos', accounting_status: 'pending',
            dimension_id: order.dimension_id || null,
            pos_order_id: order.id,
            pos_discount_amount: 0, pos_discount_reason: null,
            // Money goes back the way it came in. This was hardcoded to 'cash',
            // so every refund of a QRIS or card sale credited 1000 Cash — money
            // that was never in the drawer — and left the float stranded in 1030
            // forever. Derived from the ORDER's own payments, so a refund mirrors
            // the tender that paid for it.
            pos_settlement: this._posRefundDominant(order),
            ...this._posSettlementAmounts(order, net),
            pos_refund_reason: why
        };

        const batch = writeBatch(this.db);
        if (this._canPostJournals()) {
            await this._postSourceJournal(userId, batch, 'transactions', txRef, tx, { date: when });
        }
        batch.set(txRef, tx);
        await batch.commit();

        // Put the stock back, by an OPPOSING movement rather than by editing the
        // original — movements are immutable for the same reason journals are.
        if (order.stock_adjustment_id) {
            try {
                const adjSnap = await getDoc(doc(this.db, `${scope}/stock_adjustments/${order.stock_adjustment_id}`));
                if (adjSnap.exists()) {
                    const orig = adjSnap.data();
                    const back = (orig.lines || []).map((l) => ({ ...l, quantity: -l.quantity, amount: -l.amount }));
                    const total = back.reduce((s, l) => s + l.amount, 0);
                    if (back.length && total !== 0) {
                        const rRef = doc(collection(this.db, `${scope}/stock_adjustments`));
                        const rAdj = {
                            adjustment_type: 'count', dimension_id: order.dimension_id || null,
                            reference: `POS refund ${order.order_number || order.id}`,
                            lines: back, total_amount: total, line_count: back.length, status: 'posted',
                            timestamp: Timestamp.fromDate(when),
                            created_by: this.actorUid || userId, created_at: serverTimestamp()
                        };
                        const b2 = writeBatch(this.db);
                        if (this._canPostJournals()) await this._postSourceJournal(userId, b2, 'stock_adjustments', rRef, rAdj, { date: when });
                        b2.set(rRef, rAdj);
                        const pk = acctPeriodKey(when);
                        back.forEach((l) => {
                            b2.set(doc(collection(this.db, `${scope}/stock_movements`)), {
                                item_id: l.item_id, item_name: l.item_name, dimension_id: order.dimension_id || null,
                                quantity: l.quantity, base_unit: l.base_unit, amount: l.amount,
                                movement_type: 'adjustment',
                                source: { collection: 'pos_orders', id: `${order.id}__refund` },
                                journal_ref: rAdj.journal_ref || null,
                                period_key: pk, entity_id: this._resolvedScopeId(userId),
                                created_by: this.actorUid || userId, created_at: serverTimestamp()
                            });
                        });
                        await b2.commit();
                    }
                }
            } catch (err) {
                console.error('[pos] refund posted but stock was not returned:', err && err.message);
            }
        }

        await updateDoc(doc(this.db, `${scope}/pos_orders/${orderId}`), {
            refund_transaction_id: txRef.id, refund_reason: why,
            refunded_at: Timestamp.fromDate(when),
            version: (Number(order.version) || 1) + 1
        });
        await this._auditCreateBestEffort(userId, 'pos_order.refunded', 'pos_orders', orderId,
            { reason: why, amount: net });
        return { refund_transaction_id: txRef.id };
    },

    // ── Reads ───────────────────────────────────────────────────────────────

    async getPosOrders(userId, { dimensionId = null, statuses = null, sinceDate = null, limitCount = 200 } = {}) {
        try {
            const snap = await getDocs(query(
                collection(this.db, `${this._scope(userId)}/pos_orders`),
                orderBy('created_at', 'desc'), limit(limitCount)
            ));
            const since = sinceDate ? sinceDate.getTime() : null;
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((o) => !dimensionId || o.dimension_id === dimensionId)
                .filter((o) => !statuses || statuses.includes(o.status))
                .filter((o) => {
                    if (!since) return true;
                    const t = o.opened_at && typeof o.opened_at.toDate === 'function' ? o.opened_at.toDate().getTime() : 0;
                    return t >= since;
                });
        } catch (_) { return []; }
    },

    // A live listener, and the ONLY one in the app outside the internal console.
    //
    // shared-dashboard.js records a deliberate decision AGAINST onSnapshot: live
    // listeners on transactions/bills/invoices multiply reads for a problem that
    // is really "refetch after a write I already know about". POS is the case
    // that reasoning does not cover — a QR order is a write this tab does NOT
    // know about, and a till that needs a manual refresh to see it is not a till.
    //
    // Kept narrow on purpose: one query, today's orders for one outlet, on the
    // POS page only. Logged under the DESIGN_SYSTEM Exception Protocol.
    watchPosOrders(userId, { dimensionId = null } = {}, onChange) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/pos_orders`),
            orderBy('created_at', 'desc'), limit(120)
        );
        return onSnapshot(q, (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((o) => !dimensionId || o.dimension_id === dimensionId);
            try { onChange(rows); } catch (err) { console.error('[pos] watcher handler threw:', err); }
        }, (err) => console.error('[pos] live orders unavailable:', err && err.message));
    },

    // The operational picture for one outlet, right now.
    //
    // ⚠️ `salesToday` here is OPERATIONAL — a sum over pos_orders, not the ledger.
    // It is deliberately labelled as such in the UI and linked to the accounting
    // figure, because a product with two revenue numbers is what
    // PRODUCT_STRATEGY §6 forbids. `unposted` is what reconciles them, and it is
    // surfaced rather than hidden.
    async getPosOverview(userId, { dimensionId = null } = {}) {
        // "Today" on the till bar and in `salesToday` must be the same day the
        // order numbers are keyed to, or the figure and the sequence disagree.
        const m = (typeof window !== 'undefined' && window.FluxyMoney) || null;
        const start = (m && typeof m.startOfBusinessDay === 'function')
            ? m.startOfBusinessDay()
            : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
        const [orders, tables, menu, movements] = await Promise.all([
            this.getPosOrders(userId, { dimensionId, limitCount: 300 }),
            this.getPosTables(userId, { dimensionId }),
            this.getPosMenu(userId),
            this.getStockMovements(userId, { limitCount: 1000 }).catch(() => [])
        ]);

        const openStatuses = ['open', 'submitted', 'sent', 'served', 'awaiting_payment'];
        const active = orders.filter((o) => openStatuses.includes(o.status));
        const todayPaid = orders.filter((o) => o.status === 'paid' && (() => {
            const t = o.paid_at && typeof o.paid_at.toDate === 'function' ? o.paid_at.toDate() : null;
            return t && t >= start;
        })());

        const occupied = new Set(active.map((o) => o.table_id).filter(Boolean));

        // Which menu items have a real cost basis. An item selling at zero cost
        // inflates gross margin exactly the way marketplace orders did before
        // per-sale relief existed — the whole reason this chain was built.
        const costed = new Set();
        movements.forEach((m) => { if (Number(m.amount)) costed.add(m.item_id); });
        const noCostBasis = menu.filter((m) => (m.type === 'composite' ? !m.has_recipe : !costed.has(m.id)));

        return {
            tables: tables.map((t) => ({ ...t, occupied: occupied.has(t.id) })),
            counts: {
                tablesTotal: tables.length,
                tablesOccupied: occupied.size,
                tablesFree: Math.max(0, tables.length - occupied.size),
                activeOrders: active.length,
                awaitingPayment: active.filter((o) => o.status === 'awaiting_payment').length,
                newQrOrders: active.filter((o) => o.channel === 'qr' && o.status === 'submitted').length,
                paidToday: todayPaid.length
            },
            // The paid orders themselves, not just the total — a refund or a
            // reprint has to be able to REACH the order, and a paid one has
            // already left the table grid.
            paidToday: todayPaid,
            salesToday: todayPaid.reduce((s, o) => s + (Number(o.total_amount) || 0), 0),
            discountToday: todayPaid.reduce((s, o) => s + (Number(o.discount_total) || 0), 0),
            activeOrders: active,
            // The two honesty signals. Both are counts of things that are wrong
            // and would otherwise be invisible.
            unpostedCount: orders.filter((o) => o.status === 'paid' && !o.transaction_id).length,
            noCostBasisCount: noCostBasis.length,
            noCostBasisNames: noCostBasis.slice(0, 5).map((m) => m.name),
            menuSize: menu.length
        };
    }
};
