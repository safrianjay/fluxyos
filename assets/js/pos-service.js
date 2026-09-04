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
    serverTimestamp, orderBy, limit, startAfter, writeBatch, runTransaction, doc,
    Timestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { periodKey as acctPeriodKey } from "./accounting-engine.js";
// SIDE-EFFECT IMPORT. `pos-pricing.js` is UMD so the Netlify functions can
// require the SAME file — one module, three callers, because two copies of
// "what does this bill come to" is how a customer is charged one number and
// the books record another. In an ES module context it has no `module`, so
// it publishes itself on `self` exactly as money-format.js does.
import "./pos-pricing.js";

// The availability rule, shared with the floor plan and the Create Order dialog.
//
// Imported rather than reimplemented: a reservation the till cannot see is worse
// than no reservation system at all, and two copies of "is this table free" is
// exactly how that happens. See assets/js/pos-availability.js.
import {
    HOLDING_STATUSES as POS_HOLDING_STATUSES,
    RESERVATION_STATUSES as POS_RESERVATION_STATUSES,
    RESERVATION_SOURCES as POS_RESERVATION_SOURCES,
    DEFAULT_DURATION_MIN as POS_DEFAULT_DURATION_MIN,
    toMs as posToMs,
    reservationWindow as posReservationWindow,
    reservationConflicts as posReservationConflicts,
    reservationHoldsAt as posReservationHoldsAt,
    formatClock as posFormatClock
} from "./pos-availability.js";

// The payment methods a till can take. `settlement` is what the posting rules
// read: cash lands in 1000 immediately, QRIS/card sit with the acquirer and
// clear through 1030 on payout. Provider-agnostic on purpose — Midtrans and
// Xendit later add a row here rather than a branch anywhere else
// (docs/POS_IMPLEMENTATION_PLAN.md §11).
// `settlement` and `tender` answer two DIFFERENT questions, and conflating them
// was a silent money bug.
//
//   settlement — which ACCOUNT the money lands in. Cash and a bank transfer both
//                land in 1000; QRIS and card sit with the acquirer in 1030 until
//                payout. This drives the journal and must not change.
//   tender     — whether physical notes crossed the counter INTO THIS DRAWER.
//                Only cash does.
//
// Until 2026-09-01 the shift tally read `settlement` for "cash in the drawer",
// so every bank transfer was counted as notes that ought to be in the till. The
// blind count then came up short by exactly the transfers taken, and the
// variance posted to 6700 Cash Over & Short as though the cashier had lost the
// money. Nothing went red; the shift simply never reconciled.
export const POS_PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash', settlement: 'cash', tender: 'cash' },
    { id: 'qris', label: 'QRIS', settlement: 'clearing', tender: 'external' },
    { id: 'transfer', label: 'Bank transfer', settlement: 'cash', tender: 'external' },
    { id: 'card', label: 'Card', settlement: 'clearing', tender: 'external' },
    // Deliberately `external`. "Other" is whatever is not one of the four above,
    // and a drawer count is the wrong place to discover that assumption was
    // generous — counting it as notes would make an unexplained shortfall, while
    // not counting it makes an unexplained SURPLUS, which is the direction that
    // gets investigated rather than absorbed.
    { id: 'other', label: 'Other', settlement: 'cash', tender: 'external' }
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

    // Where each table SITS in the room.
    //
    // `layout_x` / `layout_y` are the table's centre as a percentage of the floor
    // canvas (0–100), not pixels: the canvas is responsive and a pixel grid saved
    // on a 1440px laptop would be wrong on the 10" tablet at the host stand.
    //
    // Written as ONE batch. Dragging one table usually nudges none of the others,
    // but "reset to grid" moves every table at once, and twenty sequential
    // updateDoc calls is twenty chances to half-apply a layout.
    //
    // pos_tables has no `hasOnly` in firestore.rules — it validates label,
    // dimension_id and status and permits everything else — so these two fields
    // need no rules change. The bounds are therefore enforced HERE and nowhere
    // else, which is why the clamp is not optional.
    async savePosTableLayout(userId, positions = []) {
        if (!userId) throw new Error('userId required');
        const clamp = (n) => Math.min(100, Math.max(0, Math.round((Number(n) || 0) * 10) / 10));
        const rows = (positions || [])
            .filter((p) => p && p.id)
            .slice(0, 300);
        if (!rows.length) return 0;

        const scope = this._scope(userId);
        const batch = writeBatch(this.db);
        rows.forEach((p) => {
            batch.update(doc(this.db, `${scope}/pos_tables/${p.id}`), {
                layout_x: clamp(p.x), layout_y: clamp(p.y), updated_at: serverTimestamp()
            });
        });
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'pos_table.layout_saved', 'pos_tables', null,
            { count: rows.length });
        return rows.length;
    },

    async archivePosTable(userId, tableId, { restore = false } = {}) {
        if (!userId || !tableId) throw new Error('userId and tableId required');
        await updateDoc(doc(this.db, `${this._scope(userId)}/pos_tables/${tableId}`), {
            status: restore ? 'active' : 'archived', updated_at: serverTimestamp()
        });
        await this._auditCreateBestEffort(userId,
            restore ? 'pos_table.reactivated' : 'pos_table.archived', 'pos_tables', tableId, {});
    },

    // ── Reservations ────────────────────────────────────────────────────────
    //
    // A booking is a CLAIM ON A TABLE IN THE FUTURE. That is the whole reason it
    // lives next to the tables rather than in a calendar of its own: the moment
    // it exists, the floor plan and the Create Order dialog must both stop
    // offering that table, or the room gets sold twice.
    //
    // Every question about whether a table is takeable — here, on the floor
    // plan, and in the Create Order dialog — is answered by
    // `assets/js/pos-availability.js`. Three surfaces, one rule.
    //
    // Occupancy still is not stored (pos.md §2). A reservation does not stamp
    // anything onto `pos_tables`; the table's state is derived from the orders
    // and reservations that reference it, every time it is asked for.

    // The window this board reads, either side of the day being looked at. Wide
    // enough that a week view never needs a second query, bounded so a two-year
    // old booking history is not dragged onto a tablet on every refresh.
    async getPosReservations(userId, {
        dimensionId = null, fromMs = null, toMs: untilMs = null, statuses = null, limitCount = 400
    } = {}) {
        try {
            // Range + orderBy on the SAME field needs no composite index, which
            // is why the outlet is filtered in JS below rather than in the query
            // — exactly what getPosOrders does, and for the same reason: an
            // index that has to be deployed by hand is a thing that ships broken
            // (docs/data-model/pos.md, deploy/deployed-stamps.json).
            const parts = [collection(this.db, `${this._scope(userId)}/pos_reservations`)];
            if (fromMs != null) parts.push(where('starts_at', '>=', Timestamp.fromMillis(fromMs)));
            if (untilMs != null) parts.push(where('starts_at', '<=', Timestamp.fromMillis(untilMs)));
            parts.push(orderBy('starts_at', 'asc'), limit(limitCount));
            const snap = await getDocs(query(...parts));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((r) => !dimensionId || r.dimension_id === dimensionId)
                .filter((r) => !statuses || statuses.includes(r.status));
        } catch (_) { return []; }
    },

    async getPosReservation(userId, reservationId) {
        if (!reservationId) return null;
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/pos_reservations/${reservationId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

    // Everything holding a table from now until the end of the day after next.
    //
    // The bound is what keeps this cheap enough to run inside `createPosOrder`
    // on every single walk-in: a booking three weeks out cannot block a table
    // tonight, so reading it would be work done to reach the same answer.
    async _holdingReservations(userId, { dimensionId = null, atMs = Date.now() } = {}) {
        return this.getPosReservations(userId, {
            dimensionId,
            // Back far enough to catch a sitting that started before now and is
            // still running — a 90-minute booking made at 18:00 still holds its
            // table at 19:15, and a window anchored at `now` would miss it.
            fromMs: atMs - 12 * 60 * 60 * 1000,
            toMs: atMs + 36 * 60 * 60 * 1000,
            statuses: POS_HOLDING_STATUSES,
            limitCount: 300
        });
    },

    _reservationPayload(data) {
        const startMs = posToMs(data.starts_at);
        if (startMs == null) throw new Error('Pick the date and time this reservation is for.');
        const name = String(data.guest_name || '').trim();
        if (!name) throw new Error('A reservation needs a guest name.');
        if (name.length > 80) throw new Error('That guest name is too long (80 characters max).');
        const party = Number(data.party_size);
        if (!Number.isInteger(party) || party < 1 || party > 999) {
            throw new Error('How many guests? Enter a whole number of people.');
        }
        // Bounded on both ends. A zero-minute sitting would hold nothing and a
        // twelve-hour one would take a table out of service for a whole service
        // by typo — the two failure modes are opposite and both silent.
        const durationRaw = Number(data.duration_minutes);
        const duration = Number.isFinite(durationRaw) && durationRaw > 0
            ? Math.min(600, Math.max(15, Math.round(durationRaw)))
            : POS_DEFAULT_DURATION_MIN;
        const dimensionId = String(data.dimension_id || '').trim();
        if (!dimensionId) throw new Error('Pick which outlet this reservation is for.');

        return {
            dimension_id: dimensionId,
            // Null is a real, supported answer: a booking taken before the host
            // knows which table it will sit at holds NOTHING, and holding a
            // table nobody chose is how a floor loses capacity to a maybe.
            table_id: data.table_id ? String(data.table_id) : null,
            table_label: data.table_label ? String(data.table_label).slice(0, 40) : null,
            guest_name: name,
            guest_phone: this._nullableString(data.guest_phone, 32),
            guest_email: this._nullableString(data.guest_email, 120),
            party_size: party,
            starts_at: Timestamp.fromMillis(startMs),
            duration_minutes: duration,
            source: POS_RESERVATION_SOURCES.includes(data.source) ? data.source : 'direct',
            note: this._nullableString(data.note, 200)
        };
    },

    // Create or edit. The conflict check runs against a FRESH read rather than
    // whatever the board is holding — the board can be minutes stale, and a
    // stale double-booking check is no check at all.
    //
    // ⚠️ Honest limitation: this is read-then-write, not a transaction, because
    // Firestore has no cross-document uniqueness constraint and a table is not a
    // document that could be locked. Two hosts booking the same table in the
    // same second can both succeed. The board therefore also DETECTS overlaps
    // and flags them, rather than trusting that this check made them impossible.
    async savePosReservation(userId, data = {}, { create = false, reservationId = null } = {}) {
        if (!userId) throw new Error('userId required');
        const payload = this._reservationPayload(data);
        const scope = this._scope(userId);

        if (payload.table_id) {
            const window = posReservationWindow({
                starts_at: payload.starts_at, duration_minutes: payload.duration_minutes
            });
            const existing = await this.getPosReservations(userId, {
                dimensionId: payload.dimension_id,
                fromMs: window.startMs - 12 * 60 * 60 * 1000,
                toMs: window.endMs + 12 * 60 * 60 * 1000,
                statuses: POS_HOLDING_STATUSES,
                limitCount: 300
            });
            const clash = posReservationConflicts(existing, {
                tableId: payload.table_id,
                startsAt: payload.starts_at,
                durationMinutes: payload.duration_minutes,
                excludeId: reservationId
            })[0];
            if (clash) {
                throw new Error(`${payload.table_label || 'That table'} is already booked for `
                    + `${clash.guest_name} at ${posFormatClock(posToMs(clash.starts_at))}.`);
            }
        }

        if (create) {
            const ref = doc(collection(this.db, `${scope}/pos_reservations`));
            const full = {
                ...payload,
                status: 'confirmed',
                order_id: null,
                seated_at: null,
                released_at: null,
                release_reason: null,
                version: 1,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
                created_by: this.actorUid || userId,
                updated_by: this.actorUid || userId
            };
            await setDoc(ref, full);
            await this._auditCreateBestEffort(userId, 'pos_reservation.created', 'pos_reservations', ref.id,
                { guest_name: payload.guest_name, table_id: payload.table_id, party_size: payload.party_size });
            return { id: ref.id, ...full };
        }

        if (!reservationId) throw new Error('reservationId required');
        return this._mutatePosReservation(userId, reservationId, (current) => {
            if (current.status === 'completed' || current.status === 'cancelled') {
                throw new Error('This reservation is closed. Create a new one instead of editing it.');
            }
            return payload;
        }, 'pos_reservation.updated');
    },

    // Every reservation mutation goes through here, for the same reason
    // `updatePosOrder` exists: `version` advancing by exactly one is what makes
    // a second host's stale device lose the race loudly instead of silently
    // overwriting the change the first one just made.
    async _mutatePosReservation(userId, reservationId, mutate, auditAction = 'pos_reservation.updated') {
        if (!userId || !reservationId) throw new Error('userId and reservationId required');
        const ref = doc(this.db, `${this._scope(userId)}/pos_reservations/${reservationId}`);
        const result = await runTransaction(this.db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('That reservation no longer exists.');
            const current = { id: snap.id, ...snap.data() };
            const changes = (await mutate(current)) || {};
            const patch = {
                ...changes,
                version: (Number(current.version) || 1) + 1,
                updated_at: serverTimestamp(),
                updated_by: this.actorUid || userId
            };
            delete patch.id;
            tx.update(ref, patch);
            return { ...current, ...patch, version: patch.version };
        });
        await this._auditCreateBestEffort(userId, auditAction, 'pos_reservations', reservationId,
            { status: result.status });
        return result;
    },

    // Move a booking through its life: confirm it, seat it, close it, lose it.
    //
    // `completed`, `cancelled` and `no_show` are the three ways a table comes
    // BACK into supply, and all three are a person's decision. Nothing here
    // expires a booking on a timer — see the note on `isLate` in
    // pos-availability.js: a table that frees itself while the guest is parking
    // is a table that gets sold from under them, silently.
    async setPosReservationStatus(userId, reservationId, status, { orderId = null, reason = null } = {}) {
        if (!POS_RESERVATION_STATUSES.includes(status)) throw new Error(`Unknown reservation status: ${status}`);
        return this._mutatePosReservation(userId, reservationId, (current) => {
            if (current.status === status) return {};
            const changes = { status };
            if (status === 'arrived') {
                changes.seated_at = serverTimestamp();
                if (orderId) changes.order_id = orderId;
            }
            if (['completed', 'cancelled', 'no_show'].includes(status)) {
                changes.released_at = serverTimestamp();
                changes.release_reason = this._nullableString(reason, 200);
            }
            return changes;
        }, `pos_reservation.${status}`);
    },

    // Seat the party: open their order and hand the table over to it.
    //
    // ONE call rather than two on the page, because the two writes are one
    // decision and a half-done seating is the worst state of the three — a
    // reservation marked arrived with no order is a table the board thinks is
    // working and the till has never heard of.
    //
    // The order is created FIRST: if the status write then fails, the party is
    // sitting at a table with an order open, which is recoverable by a person
    // looking at the screen. The other order of operations loses the sale.
    async seatPosReservation(userId, reservationId, { shiftId = null } = {}) {
        const res = await this.getPosReservation(userId, reservationId);
        if (!res) throw new Error('That reservation no longer exists.');
        if (res.order_id) throw new Error('This reservation already has an order open.');
        if (!res.table_id) throw new Error('Assign a table to this reservation before seating it.');

        const order = await this.createPosOrder(userId, {
            dimensionId: res.dimension_id,
            tableId: res.table_id,
            tableLabel: res.table_label,
            channel: 'staff',
            customerName: res.guest_name,
            customerPhone: res.guest_phone,
            guestCount: res.party_size,
            note: res.note,
            shiftId,
            // The table is held BY this booking, so the guard below must not
            // refuse the very party it is holding it for.
            forReservationId: reservationId
        });
        await this.setPosReservationStatus(userId, reservationId, 'arrived', { orderId: order.id });
        return order;
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
                has_recipe: i.type === 'composite' && Array.isArray(i.components) && i.components.length > 0,
                // The options the till asks about. Projected explicitly, like
                // every other field here — this map is a whitelist, so a field
                // added to `items` and not added here reaches the page as
                // undefined and the feature silently does nothing.
                pos_modifier_groups: Array.isArray(i.pos_modifier_groups) ? i.pos_modifier_groups : [],
                // What a scanner types. Projected explicitly like everything
                // else here — this map is a WHITELIST, and a field left out of
                // it reaches the till as undefined with the feature silently
                // doing nothing. That is exactly how pos_modifier_groups failed
                // on its first cut.
                barcode: i.barcode || null,
                // Whether "how many are left" is even a question for this item.
                // A service is never held as stock, and a recipe's availability
                // is its ingredients' — neither has an on-hand number of its own.
                track_stock: i.track_stock !== false,
                // The product photo's STORAGE PATH — never a URL. The till
                // resolves it to a short-lived, origin-bound blob URL through an
                // authenticated read, so a menu photo can never become a public
                // link. Optional: most items have none, and the card is designed
                // for that being the common case rather than the exception.
                image_path: i.image_path || null
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
    /**
     * The one pricing module, reached the way money-format.js is reached.
     *
     * ⚠️ THROWS rather than defaulting. A missing module with rates configured
     * would quietly bill every customer the pre-tax figure — a silent
     * under-charge and a tax liability that never gets recorded. A till that
     * refuses to price a bill is a problem someone fixes in a minute; a till
     * that prices it wrong is found by an accountant months later.
     */
    _pricing() {
        const P = (typeof window !== 'undefined' && window.FluxyPosPricing)
            || (typeof self !== 'undefined' && self.FluxyPosPricing);
        if (!P) throw new Error('Pricing module missing — the till cannot total a bill.');
        return P;
    },

    // ── Per-outlet till configuration ──────────────────────────────────────
    //
    // Keyed BY the dimension id, so an outlet cannot own two and no join is
    // needed. Returns the module's own defaults when no doc exists, which is
    // every outlet until an owner opens Settings — and those defaults reproduce
    // the pre-settings bill exactly.
    async getPosOutletSettings(userId, dimensionId) {
        if (!userId || !dimensionId) return null;
        const scope = this._scope(userId);
        const snap = await getDoc(doc(this.db, `${scope}/pos_outlet_settings/${dimensionId}`));
        const base = { dimension_id: dimensionId, address: null, phone: null, hours: [], cover_image_path: null };
        if (!snap.exists()) return { ...base, ...this._pricing().DEFAULTS, exists: false };
        return { ...base, ...this._pricing().DEFAULTS, ...snap.data(), exists: true };
    },

    /**
     * ⚠️ `hours` IS VALIDATED HERE AND NOWHERE ELSE. Rules bound its size but
     * cannot iterate it cheaply — the same standing trade-off `lines[]` and
     * `payments[]` make — so this normalizer is the only thing between a typo
     * and a restaurant advertising that it opens at 99:00.
     */
    async savePosOutletSettings(userId, dimensionId, payload = {}) {
        if (!userId) throw new Error('userId required');
        if (!dimensionId) throw new Error('Pick an outlet first.');
        const scope = this._scope(userId);
        const ref = doc(this.db, `${scope}/pos_outlet_settings/${dimensionId}`);
        const existing = await getDoc(ref);

        const pct = (v) => {
            const n = Number(v);
            if (!isFinite(n) || n < 0) return 0;
            // Bounded here as well as in rules. Rules are the boundary; this is
            // the message a human gets instead of `permission-denied`.
            if (n > 100) throw new Error('A rate cannot be more than 100%.');
            return Math.round(n * 100) / 100;
        };
        const body = {
            dimension_id: dimensionId,
            address: this._nullableString(payload.address, 200),
            phone: this._nullableString(payload.phone, 32),
            hours: this._normalizeOpeningHours(payload.hours),
            cover_image_path: this._nullableString(payload.cover_image_path, 300),
            tax_enabled: payload.tax_enabled === true,
            tax_label: this._nullableString(payload.tax_label, 24) || 'PPN',
            tax_rate_percent: pct(payload.tax_rate_percent),
            tax_inclusive: payload.tax_inclusive === true,
            service_enabled: payload.service_enabled === true,
            service_rate_percent: pct(payload.service_rate_percent),
            service_taxable: payload.service_taxable !== false,
            updated_at: serverTimestamp(),
            updated_by: userId
        };
        if (!existing.exists()) body.created_at = serverTimestamp();
        await setDoc(ref, body, { merge: true });
        this._auditCreateBestEffort(userId, {
            action: 'pos_outlet_settings.saved',
            target_collection: 'pos_outlet_settings',
            target_id: dimensionId
        });
        return { ...body };
    },

    // Seven rows, one per weekday, and a day is either open with a window or
    // shut. Stored as a LIST rather than a map keyed by day name so the order is
    // the week's order and nothing has to sort it.
    _normalizeOpeningHours(raw) {
        const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const byDay = {};
        (Array.isArray(raw) ? raw : []).forEach((r) => {
            if (r && DAYS.includes(r.day)) byDay[r.day] = r;
        });
        const hhmm = (v, fallback) => {
            const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '').trim());
            return m ? `${m[1]}:${m[2]}` : fallback;
        };
        return DAYS.map((day) => {
            const r = byDay[day] || {};
            // Closed is a real answer, and the default for a day nobody set.
            if (r.closed === true) return { day, closed: true, open: null, close: null };
            const open = hhmm(r.open, null);
            const close = hhmm(r.close, null);
            if (!open || !close) return { day, closed: true, open: null, close: null };
            // An overnight window is legitimate — a bar closing at 02:00 is not a
            // typo — so close < open is allowed and read as crossing midnight.
            return { day, closed: false, open, close };
        });
    },

    /**
     * The outlet's customer-facing header photo.
     *
     * ⚠️ A PATH IS STORED, NEVER A URL. A download URL is a permanent public
     * link to the workspace's own imagery, and `items.image_path` made the same
     * call for the same reason. The dashboard resolves it through an
     * authenticated read; the DINER gets it from a Netlify function, because
     * `order.html` holds no Firebase handle by design.
     *
     * Each upload is a NEW object rather than an overwrite, so a mis-click stays
     * recoverable and an already-loaded page cannot be showing stale bytes from
     * its blob cache with no way to know.
     */
    async uploadPosOutletCover(userId, dimensionId, file) {
        if (!userId || !dimensionId) throw new Error('userId and dimensionId required');
        if (!file) throw new Error('Pick an image first.');
        // Refused here with a sentence, before the person has waited for a 5 MB
        // upload to fail with an opaque rules error.
        const MAX = 2 * 1024 * 1024;
        if (file.size > MAX) throw new Error('That image is larger than 2 MB. Use a smaller one.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(file.type))) {
            throw new Error('Use a JPEG, PNG or WebP image.');
        }
        await this.assertCanUseStorage(userId, file.size || 0, { source: 'pos_outlet_cover' });

        const { getStorage, ref, uploadBytes } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);

        const safeName = String(file.name || 'cover').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'cover';
        const storagePath = `${this._scope(userId)}/pos_outlets/${dimensionId}/${Date.now()}_${safeName}`;
        await uploadBytes(ref(this._storage, storagePath), file, this._uploadMetadata(file.type));
        this._auditCreateBestEffort(userId, {
            action: 'pos_outlet_settings.cover_uploaded',
            target_collection: 'pos_outlet_settings',
            target_id: dimensionId
        });
        return { storagePath, fileName: safeName, fileSize: file.size || 0 };
    },

    // A blob: URL for the dashboard preview. Origin-bound and dead when the tab
    // closes, exactly like the item-photo one.
    async getPosOutletCoverObjectURL(userId, storagePath) {
        if (!storagePath) throw new Error('storagePath required');
        const { getStorage, ref, getBlob } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);
        const blob = await getBlob(ref(this._storage, storagePath));
        return URL.createObjectURL(blob);
    },

    // ── Discount presets ───────────────────────────────────────────────────
    //
    // Named, reusable discounts so a cashier taps instead of typing an amount
    // and a reason free-hand at the counter. They change NOTHING about posting:
    // a preset produces the same discount_amount + discount_reason an ad-hoc one
    // does, and still lands as contra-revenue in 4900.
    async getPosDiscountPresets(userId, { dimensionId = null, includeArchived = false } = {}) {
        if (!userId) return [];
        const scope = this._scope(userId);
        const snap = await getDocs(collection(this.db, `${scope}/pos_discount_presets`));
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((p) => (includeArchived || p.status === 'active'))
            // A preset with no outlet belongs to every outlet.
            .filter((p) => !dimensionId || !p.dimension_id || p.dimension_id === dimensionId)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name)));
    },

    async savePosDiscountPreset(userId, presetId, payload = {}) {
        if (!userId) throw new Error('userId required');
        const scope = this._scope(userId);
        const name = this._nullableString(payload.name, 40);
        if (!name) throw new Error('A discount needs a name.');
        const kind = payload.kind === 'amount' ? 'amount' : 'percent';
        const value = Math.round(Number(payload.value) || 0);
        if (value < 1) throw new Error('A discount of nothing is not a discount.');
        if (kind === 'percent' && value > 100) throw new Error('A discount cannot be more than 100%.');

        const ref = presetId
            ? doc(this.db, `${scope}/pos_discount_presets/${presetId}`)
            : doc(collection(this.db, `${scope}/pos_discount_presets`));
        const body = {
            name,
            kind,
            value,
            scope: payload.scope === 'line' ? 'line' : 'order',
            // The till REQUIRES a reason on every discount — it is the only
            // record of why money was given away. A preset supplies its own so
            // the cashier is never the one deciding under pressure.
            reason: this._nullableString(payload.reason, 80) || name,
            dimension_id: this._nullableString(payload.dimension_id, 200),
            status: payload.status === 'archived' ? 'archived' : 'active',
            sort: Math.round(Number(payload.sort) || 0),
            // The seam for automatic rules — happy hour, minimum spend. Null
            // today on every preset, and shaped so adding conditions later needs
            // no migration and no rules change.
            auto: (payload.auto && typeof payload.auto === 'object') ? payload.auto : null,
            updated_at: serverTimestamp(),
            updated_by: userId
        };
        if (!presetId) body.created_at = serverTimestamp();
        await setDoc(ref, body, { merge: true });
        this._auditCreateBestEffort(userId, {
            action: presetId ? 'pos_discount_preset.updated' : 'pos_discount_preset.created',
            target_collection: 'pos_discount_presets',
            target_id: ref.id
        });
        return { id: ref.id, ...body };
    },

    // Archived, never deleted: a preset that was applied to real sales is a fact
    // about those sales, and the reason string on them points back to it.
    async archivePosDiscountPreset(userId, presetId) {
        const current = await getDoc(doc(this.db, `${this._scope(userId)}/pos_discount_presets/${presetId}`));
        if (!current.exists()) throw new Error('That discount no longer exists.');
        return this.savePosDiscountPreset(userId, presetId, { ...current.data(), status: 'archived' });
    },

    _posTotals(order) {
        const lines = Array.isArray(order.lines) ? order.lines : [];
        const subtotal = lines.reduce((s, l) => s + (Number(l.gross_amount) || 0), 0);
        const lineDiscount = lines.reduce((s, l) => s + (Number(l.discount_amount) || 0), 0);
        const orderDiscount = Math.max(0, Number(order.discount_amount) || 0);
        // Clamped: an order discount larger than what is left after line discounts
        // would make the sale negative and post a backwards journal.
        const capped = Math.min(orderDiscount, Math.max(0, subtotal - lineDiscount));
        const discountTotal = lineDiscount + capped;

        // ⚠️ COMPUTED FROM THE ORDER'S OWN SNAPSHOT, never from live settings.
        // `pos_pricing` is what the outlet's rates were when this order opened,
        // so an owner changing the rate at 8pm cannot silently re-price the
        // bills already sitting on the floor, and an hour-old receipt stays
        // reproducible. Same discipline as `unit_price` and a modifier's
        // `consumes`. No snapshot — every order before this shipped — prices at
        // zero, which is exactly what it billed before.
        const priced = this._pricing().computeBillTotals({
            subtotal,
            discountTotal,
            settings: order.pos_pricing || null
        });
        const paid = (Array.isArray(order.payments) ? order.payments : [])
            .filter((p) => p && p.status === 'settled')
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        return {
            subtotal,
            discount_amount: capped,
            discount_total: discountTotal,
            service_charge_amount: priced.service,
            tax_amount: priced.tax,
            total_amount: priced.total,
            paid_amount: paid
        };
    },

    async createPosOrder(userId, {
        dimensionId, tableId = null, tableLabel = null, channel = 'staff', note = null, shiftId = null,
        customerName = null, customerPhone = null, guestCount = null,
        // Set only by `seatPosReservation`. The reservation holding this table is
        // the one party allowed to sit at it, so the guard below must not refuse
        // the guest it is holding the table FOR.
        forReservationId = null
    } = {}) {
        if (!userId) throw new Error('userId required');
        if (!dimensionId) throw new Error('Pick an outlet before opening an order.');

        // ── The reservation guard ───────────────────────────────────────────
        //
        // Enforced HERE, in the data layer, and not only in the dialog that
        // usually calls it. The brief is that a reserved table cannot be given
        // to a walk-in, and a rule that lives in one dialog is a rule that the
        // floor plan, a scan into an empty cart, or the next surface anyone
        // builds will quietly not have. The dialog still greys the option out —
        // this is what makes it true rather than merely displayed.
        //
        // It cannot live in firestore.rules: answering it needs a QUERY across
        // pos_reservations, which rules cannot do at any price (they can `get()`
        // a known document, not search for an overlapping one). So this is a
        // client-side business rule, honestly — the same standing the per-outlet
        // scoping has (pos.md §8), and it is stated as such in the docs rather
        // than dressed up as a security boundary.
        if (tableId && channel === 'staff') {
            const held = (await this._holdingReservations(userId, { dimensionId }))
                .filter((r) => r.id !== forReservationId)
                .filter((r) => r.table_id === tableId && posReservationHoldsAt(r));
            if (held.length) {
                const r = held[0];
                throw new Error(`${tableLabel ? `Table ${tableLabel}` : 'That table'} is reserved for `
                    + `${r.guest_name} at ${posFormatClock(posToMs(r.starts_at))}. `
                    + 'Release the reservation first, or seat them at another table.');
            }
        }

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

        // ⚠️ THE RATES ARE SNAPSHOTTED HERE, ONCE. Read at order time and frozen
        // onto the document, so an owner editing the rate mid-service cannot
        // re-price bills already open on the floor, and a receipt printed an
        // hour ago stays reproducible. Same reason `unit_price` is copied onto a
        // line rather than looked up when the bill is totalled.
        //
        // Best-effort: an outlet with no settings doc, or a read that fails,
        // prices at the module's defaults — every flag off — which is exactly
        // what this till billed before settings existed. Failing the ORDER
        // because a rate could not be read would close the till over a
        // configuration document.
        let pricingSnapshot = null;
        try {
            const outlet = await this.getPosOutletSettings(userId, dimensionId);
            if (outlet) pricingSnapshot = this._pricing().normalizeSettings(outlet);
        } catch (e) {
            console.warn('[pos] could not read outlet pricing; billing at zero rates', e);
        }

        const payload = {
            order_number: `${dayKey}-${String(seq).padStart(3, '0')}`,
            pos_pricing: pricingSnapshot,
            dimension_id: dimensionId,
            table_id: tableId || null,
            table_label: tableLabel || null,
            channel: ['staff', 'qr', 'connector'].includes(channel) ? channel : 'staff',
            status: channel === 'qr' ? 'submitted' : 'open',
            lines: [], subtotal: 0, discount_amount: 0, discount_reason: null, discount_total: 0,
            service_charge_amount: 0, tax_amount: 0, total_amount: 0,
            payments: [], paid_amount: 0,
            note: this._nullableString(note, 200),
            // Who the order is for. All three optional: a queue does not wait
            // while a cashier types a phone number, so an order with none of
            // them is as valid as one with all three.
            customer_name: this._nullableString(customerName, 80),
            customer_phone: this._nullableString(customerPhone, 32),
            // Covers, for a dine-in. Whole people only — rules refuse a
            // fractional count, and the seam that produces it should not be the
            // place that discovers this.
            guest_count: Number.isInteger(Number(guestCount)) && Number(guestCount) > 0
                ? Math.min(999, Number(guestCount)) : null,
            // Which drawer rang this up. Null when no shift was open — those
            // sales are real but sit outside every cash count, which is exactly
            // what the POS overview nudges about.
            shift_id: shiftId || null,
            version: 1,
            opened_at: Timestamp.fromDate(now),
            // Equal to opened_at at birth: an order is "waiting" from the moment
            // it exists, not from its first transition.
            status_changed_at: Timestamp.fromDate(now),
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
            // The clock the Orders board runs on. Stamped ONLY when the status
            // actually moves, which is what separates it from `updated_at`:
            // every edit bumps that one, so a waiter adding a drink to a table
            // that had been waiting 40 minutes would reset the kitchen's timer
            // to zero. Silent, plausible, and backwards — the order most in need
            // of attention would drop to the bottom of the queue.
            const moved = changes.status && changes.status !== current.status;
            if (moved) patch.status_changed_at = serverTimestamp();
            delete patch.id;
            tx.update(ref, patch);
            // The returned copy carries a CLIENT time for the same field: the
            // server sentinel is unreadable until the next read, and the board
            // repaints immediately after a transition. It is replaced by the
            // authoritative value on the next refresh.
            return {
                ...merged, ...totals, version: patch.version,
                ...(moved ? { status_changed_at: Timestamp.fromDate(new Date()) } : {})
            };
        });
    },

    // Chosen modifiers, normalized onto a line.
    //
    // `price_delta` is per UNIT and may be negative (a smaller size). It is kept
    // OFF `unit_price` deliberately, for the same reason a discount is not folded
    // into the price: `unit_price` is the menu price, and a line that has
    // forgotten it can never be audited against the menu or analysed. The line
    // carries `modifier_amount` beside it and `gross_amount` is the sum, so
    // totals — and therefore POS-SALE and the ledger — need no knowledge of
    // modifiers at all.
    _normalizePosModifiers(chosen) {
        const rows = Array.isArray(chosen) ? chosen : [];
        return rows.slice(0, 20).map((m) => ({
            group_id: String(m.group_id || ''),
            group_name: this._nullableString(m.group_name, 40),
            option_id: String(m.option_id || ''),
            option_name: this._nullableString(m.option_name, 40),
            price_delta: Math.round(Number(m.price_delta) || 0),
            // SNAPSHOT, not a reference. What this option consumed is copied
            // onto the line the way `unit_price` and `item_name` are, because
            // the sale consumed what it consumed at the time: editing the recipe
            // next week must not retroactively change what left the shelf on
            // Tuesday. Looking it up at relief time would do exactly that.
            //
            // `pos_orders.lines[]` has no `hasOnly` in firestore.rules
            // (pos.md §7), so this needed no rules change and no deploy — and
            // therefore nothing downstream would refuse a malformed one, which
            // is why it is normalised here.
            consumes: (Array.isArray(m.consumes) ? m.consumes : [])
                .slice(0, 5)
                .map((c) => ({
                    item_id: String((c && c.item_id) || ''),
                    quantity: Math.round(Number(c && c.quantity) || 0)
                }))
                .filter((c) => c.item_id && c.quantity > 0)
        })).filter((m) => m.option_id && m.option_name);
    },

    // The identity of a line for merging: same item, same price, same note, same
    // modifiers. Two iced coffees where one is decaf are not the same line, and
    // merging them loses the instruction the kitchen needs.
    _posLineKey(itemId, price, note, modifiers) {
        const mods = (modifiers || []).map((m) => `${m.group_id}:${m.option_id}`).sort().join(',');
        return `${itemId}|${price}|${note || ''}|${mods}`;
    },

    async addPosOrderLine(userId, orderId, { itemId, itemName, quantity = 1, unitPrice, note = null, modifiers = null }) {
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number of one or more.');
        const price = Number(unitPrice);
        if (!Number.isInteger(price) || price < 0) throw new Error('That item has no valid price.');

        const mods = this._normalizePosModifiers(modifiers);
        const modAmount = mods.reduce((s, m) => s + m.price_delta, 0);
        // A modifier may not take a line below zero — a "free" upgrade priced at
        // −20.000 on a 15.000 drink would emit negative revenue.
        if (price + modAmount < 0) throw new Error('Those options price this item below zero.');
        const each = price + modAmount;
        const cleanNote = this._nullableString(note, 120);

        return this.updatePosOrder(userId, orderId, (order) => {
            const lines = [...(order.lines || [])];
            // Same item, same price, same note, same options → bump the existing
            // line rather than stacking duplicates. A kitchen ticket reading
            // "1 × Nasi Goreng" four times is how a portion goes missing.
            const key = this._posLineKey(itemId, price, cleanNote, mods);
            const at = lines.findIndex((l) => this._posLineKey(
                l.item_id, Number(l.unit_price), l.note, l.modifiers) === key);
            if (at >= 0) {
                const q = (Number(lines[at].quantity) || 0) + qty;
                const per = (Number(lines[at].unit_price) || 0) + (Number(lines[at].modifier_amount) || 0);
                lines[at] = { ...lines[at], quantity: q, gross_amount: q * per };
            } else {
                lines.push({
                    line_id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
                    item_id: itemId, item_name: itemName, quantity: qty,
                    unit_price: price, gross_amount: qty * each,
                    modifiers: mods, modifier_amount: modAmount,
                    discount_amount: 0, discount_reason: null,
                    note: cleanNote
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
                    // not retroactively change an open order. `modifier_amount`
                    // rides with it — omitting it here would silently drop every
                    // upcharge the moment a cashier pressed "+".
                    ? {
                        ...l,
                        quantity: qty,
                        gross_amount: qty * ((Number(l.unit_price) || 0) + (Number(l.modifier_amount) || 0))
                    }
                    : l))
                .filter((l) => Number(l.quantity) > 0);
            return { lines };
        });
    },

    // A discount is stored SEPARATELY from the price, never as a lower price.
    // Fold it in and the menu price is gone from the ledger forever: no price
    // integrity, no discount analytics, no anomaly detection (§18.4).
    // Park a sale. The label is the only thing that changes.
    //
    // "Held" is not a status and deliberately not a new field: an unpaid order
    // is ALREADY parked — it is an `open` document that survives a reload, a
    // crash and a shift change. All that was ever missing was a way to find it
    // again, which is a label and a list. `pos_orders` has a `hasOnly`, so a
    // dedicated field would have cost a rules deploy for something the data
    // model already supported.
    //
    // ⚠️ `note` is the order-level note field. It exists, it is inside
    // wsPosOrderKeys, and the till has never written or read it (only LINE notes
    // are used), so it is free. If an order-level note is ever wanted for its own
    // sake — a kitchen instruction for the whole ticket — it collides with this
    // and one of the two needs a new field. See docs/POS_BUSINESS_TYPE_STRATEGY.md §C5.
    async setPosOrderLabel(userId, orderId, label) {
        return this.updatePosOrder(userId, orderId, (order) => {
            if (['paid', 'void'].includes(order.status)) {
                throw new Error('That sale is already closed.');
            }
            return { note: this._nullableString(label, 60) };
        });
    },

    async setPosOrderDiscount(userId, orderId, { lineId = null, amount = 0, reason = null } = {}) {
        const amt = Math.max(0, Math.round(Number(amount) || 0));
        // A discount may not take the bill to zero.
        //
        // `recordPosPayment` refuses an amount of zero, so a fully discounted
        // order can never reach `paid` — it strands, and the only way out is to
        // void it. Refusing here says so at the moment the cashier can still do
        // something about it. A genuinely free item is a giveaway with a COGS
        // consequence, not a sale, and belongs in waste rather than on a till.
        const willZero = (order) => {
            const lines = order.lines || [];
            const gross = lines.reduce((sum, l) => sum + (Number(l.gross_amount) || 0), 0);
            const otherLineDisc = lines.reduce((sum, l) => sum
                + (l.line_id === lineId ? 0 : (Number(l.discount_amount) || 0)), 0);
            const orderDisc = lineId === null ? amt : (Number(order.discount_amount) || 0);
            const lineDisc = lineId === null ? otherLineDisc : otherLineDisc + amt;
            return gross > 0 && (gross - lineDisc - orderDisc) <= 0;
        };
        const why = this._nullableString(reason, 80);
        if (amt > 0 && !why) throw new Error('Say why the discount was given — it is the only record of it.');
        return this.updatePosOrder(userId, orderId, (order) => {
            if (amt > 0 && willZero(order)) {
                throw new Error('That discount would bring the bill to zero, and a zero bill cannot be paid. Void the order instead.');
            }
            if (!lineId) return { discount_amount: amt, discount_reason: amt > 0 ? why : null };
            const lines = (order.lines || []).map((l) => (l.line_id === lineId
                ? { ...l, discount_amount: Math.min(amt, Number(l.gross_amount) || 0), discount_reason: amt > 0 ? why : null }
                : l));
            return { lines };
        });
    },

    async setPosOrderStatus(userId, orderId, status) {
        // `paid` and `void` are absent on purpose: those are earned by
        // recordPosPayment and voidPosOrder, which do the posting and the
        // reason-keeping. This method only walks the service ladder.
        const allowed = ['open', 'submitted', 'sent', 'ready', 'served', 'awaiting_payment'];
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

    // Did notes cross the counter into this drawer? Only cash does.
    // Unknown methods are treated as cash, matching _posSettlementFor: a method
    // this build does not recognise is more likely an older cash row than a
    // provider that did not exist yet.
    _posTenderFor(method) {
        const m = POS_PAYMENT_METHODS.find((x) => x.id === method);
        return m ? (m.tender || 'cash') : 'cash';
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
        // The keys are the TRANSACTION FIELD NAMES, because both call sites
        // spread this straight into a transaction document.
        //
        // It returned `{ cash, clearing }` from 2026-08-30 until 2026-08-31, and
        // the cost was invisible: `cash` and `clearing` are not in
        // wsValidTxCreate's hasOnly list, so EVERY POS write carrying them was
        // refused by rules. Sales were marked paid and never reached the ledger
        // (the emission retry could not help — the payload was permanently
        // invalid), and every refund failed outright. The journal builder reads
        // pos_cash_amount / pos_clearing_amount too, so these were the only
        // names that were ever going to work.
        return { pos_cash_amount: total - clearing, pos_clearing_amount: clearing };
    },

    // Record money received. An order becomes `paid` only when what has been
    // recorded covers the bill — paid is DERIVED, never asserted. Partial
    // payments accumulate; the order stays awaiting_payment until the balance
    // reaches zero.
    // `amount` is what is APPLIED to the bill. `amountReceived` is what the
    // customer physically handed over, which for cash can be more.
    //
    // ⚠️ They were the same field until 2026-09-01, and the difference is money.
    // The till sent the whole tender as `amount`, so a 150.000 note against a
    // 120.000 bill recorded `paid_amount: 150.000` — and `getPosShiftTally` sums
    // exactly that, so the drawer was expected to hold the 30.000 that had
    // already been handed back as change. Every over-tender made the close read
    // SHORT by the change given, and the variance posted to 6700 as a loss.
    //
    // The ledger was never wrong: revenue posts from `total_amount`, not from
    // the payments. Only the cash reconciliation was — which is the one thing
    // the shift feature exists to do.
    //
    // `payments[]` has no `hasOnly` in firestore.rules (pos.md §7), so the three
    // new fields needed no rules change and no deploy.
    async recordPosPayment(userId, orderId, {
        method = 'cash', amount, amountReceived = null, reference = null,
        // Wait for the ledger emission before returning?
        //
        // The money is recorded by the order write ABOVE the emission, and the
        // emission is already best-effort with `emitUnpostedPosSales` as its
        // retry — so waiting for it buys immediacy, not correctness. It is not
        // cheap immediacy: emission reads every item and up to 1000 stock
        // movements to rebuild the cost basis (measured 1.6s of reads on a
        // 467-item workspace from a SERVER; a browser on restaurant wifi is
        // several times that), and the cashier stares at a spinner for all of
        // it with a customer waiting.
        //
        // Callers that can show the receipt first pass false and await
        // `order.emitting` when they are ready.
        awaitEmit = true
    } = {}) {
        const amt = Math.round(Number(amount) || 0);
        if (amt <= 0) throw new Error('Enter how much was received.');
        const methods = POS_PAYMENT_METHODS.map((m) => m.id);
        if (!methods.includes(method)) throw new Error('Pick how the customer paid.');
        const tender = this._posTenderFor(method);
        // Absent means "the tender was the applied amount" — every caller
        // written before this existed, and every non-cash payment, where the
        // provider moves the exact figure and no change is possible.
        const received = amountReceived == null ? amt : Math.round(Number(amountReceived) || 0);
        if (received < amt) throw new Error('The amount received is less than the amount being applied.');
        if (tender !== 'cash' && received !== amt) {
            // Nobody overpays a card terminal, and change is only ever given in
            // cash. Silently accepting it would put a phantom change figure on
            // the receipt and in the drawer count.
            throw new Error('Change can only be given on a cash payment.');
        }

        const order = await this.updatePosOrder(userId, orderId, (o) => {
            if (o.status === 'paid') throw new Error('This order is already fully paid.');
            if (!(o.lines || []).length) throw new Error('There is nothing on this order to pay for.');
            const payments = [...(o.payments || []), {
                payment_id: `p${Date.now().toString(36)}`,
                method, provider: 'manual', amount: amt,
                // What crossed the counter, and what went back. Recorded rather
                // than derived: the bill can be discounted or refunded later, so
                // "what did this customer actually hand over" stops being
                // recoverable from the totals the moment anything else moves.
                tender,
                amount_received: received,
                change_given: Math.max(0, received - amt),
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
            const emitting = this._emitPosSale(userId, order).catch((err) => {
                // The money is recorded either way. Emission is retried by
                // `emitUnpostedPosSales`, and the POS overview surfaces the
                // backlog rather than letting it sit silently.
                console.error('[pos] sale recorded but not yet emitted to the ledger:', err && err.message);
            });
            if (awaitEmit) await emitting;
            // A PROMISE, not data. Non-enumerable so it can never reach
            // Firestore, JSON, or a spread that rebuilds the document — this
            // object is the in-memory return value, and the payload written to
            // the collection was built separately above.
            else Object.defineProperty(order, 'emitting', { value: emitting, enumerable: false });
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
        // TENDER, not settlement. A bank transfer settles to the same account as
        // cash and puts nothing in the drawer — counting it here made the blind
        // count short by every transfer taken. See POS_PAYMENT_METHODS.
        let cash = 0; let nonCash = 0;
        const byMethod = {};
        mine.forEach((o) => {
            (o.payments || []).filter((p) => p.status === 'settled').forEach((p) => {
                const amt = Number(p.amount) || 0;
                byMethod[p.method] = (byMethod[p.method] || 0) + amt;
                if (this._posTenderFor(p.method) === 'cash') cash += amt; else nonCash += amt;
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
        const service = Math.max(0, Math.round(Number(order.service_charge_amount) || 0));
        const tax = Math.max(0, Math.round(Number(order.tax_amount) || 0));
        const net = Math.round(Number(order.total_amount) || 0) - service - tax;
        if (net <= 0) return null;
        // What crossed the counter. The settlement split must cover THIS, not the
        // revenue share of it, or the drawer is short by the tax on every sale.
        const collected = net + service + tax;

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
            // Beside `amount`, never inside it. POS-SALE credits 2100 PPN
            // Keluaran and 4100 Service Charge from these; folding either into
            // `amount` would book the government's money as this workspace's
            // revenue, and every revenue surface sums `amount`.
            pos_tax_amount: tax,
            pos_service_amount: service,
            // How the money ACTUALLY split. A half-cash/half-QRIS bill used to
            // post entirely to whichever side was larger.
            ...this._posSettlementAmounts(order, collected),
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
                // ⚠️ `modifiers` HAS to be passed through. This map is the
                // fourth explicit field list on the POS path, and the fourth
                // place a dropped field fails in silence: without it the
                // resolver never sees what an option consumed, so a priced
                // modifier bills the customer and relieves nothing, and gross
                // margin is overstated by exactly the cost of the extras.
                // Adding a field to a line means checking every one of these.
                soldLines: (order.lines || []).map((l) => ({
                    item_id: l.item_id,
                    quantity: Number(l.quantity) || 0,
                    modifiers: Array.isArray(l.modifiers) ? l.modifiers : []
                })),
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
    // Every paid order that never reached the ledger — PAGED, not capped.
    //
    // The sweep used to read `getPosOrders(… limitCount: 50)`, which takes the
    // fifty most recent orders of ANY status and then keeps the paid ones. On a
    // busy day the unposted orders sit well outside that window and no amount of
    // pressing "Post now" could ever reach them, while the badge — computed over
    // a different window again, 300 orders of ONE outlet — went on reporting
    // them. Two windows disagreeing is how a button comes to look broken.
    //
    // This walks pages until the collection is exhausted or `maxScan` docs have
    // been read. The cap is a cost ceiling, not a correctness one: it is only
    // ever reached by a workspace with thousands of orders, and the report says
    // when it truncated rather than quietly returning less.
    async findUnpostedPosSales(userId, { maxScan = 3000, pageSize = 300 } = {}) {
        const base = collection(this.db, `${this._scope(userId)}/pos_orders`);
        const found = [];
        let cursor = null;
        let scanned = 0;
        let truncated = false;

        while (scanned < maxScan) {
            const q = cursor
                ? query(base, orderBy('created_at', 'desc'), startAfter(cursor), limit(pageSize))
                : query(base, orderBy('created_at', 'desc'), limit(pageSize));
            const snap = await getDocs(q);
            if (snap.empty) break;

            snap.docs.forEach((d) => {
                const o = { id: d.id, ...d.data() };
                if (o.status === 'paid' && !o.transaction_id) found.push(o);
            });
            scanned += snap.docs.length;
            cursor = snap.docs[snap.docs.length - 1];
            if (snap.docs.length < pageSize) break;
            if (scanned >= maxScan) truncated = true;
        }
        return { orders: found, scanned, truncated };
    },

    async emitUnpostedPosSales(userId, options = {}) {
        const { orders, scanned, truncated } = await this.findUnpostedPosSales(userId, options);
        let emitted = 0;
        const failed = [];
        for (const o of orders) {
            // `transaction_id` is the idempotency key and _emitPosSale stamps it
            // in the same batch as the row, so re-running this is safe.
            try { await this._emitPosSale(userId, o); emitted += 1; }
            catch (err) { failed.push({ id: o.id, reason: (err && err.message) || 'unknown' }); }
        }
        // The failures are RETURNED rather than swallowed. The whole reason this
        // sweep existed and could not help was that its payload was permanently
        // invalid and every attempt failed in silence — see the note on
        // _posSettlementAmounts.
        return { emitted, found: orders.length, failed, scanned, truncated };
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
        // Split the same way the SALE was, and for the same reason: `amount` is
        // the revenue being reversed, while the customer gets the whole bill
        // back. A refund that returns the tax to the customer without reversing
        // 2100 leaves the workspace owing PPN on a sale that no longer exists.
        const refundService = Math.max(0, Math.round(Number(order.service_charge_amount) || 0));
        const refundTax = Math.max(0, Math.round(Number(order.tax_amount) || 0));
        const collected = Math.round(Number(order.total_amount) || 0);
        const net = collected - refundService - refundTax;
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
            pos_tax_amount: refundTax,
            pos_service_amount: refundService,
            ...this._posSettlementAmounts(order, collected),
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

    // One order, read directly. `getPosOrders` is a bounded, outlet-filtered
    // list, so "absent from it" is not the same as "gone" — and the till used to
    // treat the two as identical, which is how an order could vanish from under
    // a cashier seconds after they opened it.
    async getPosOrder(userId, orderId) {
        if (!orderId) return null;
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/pos_orders/${orderId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },

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
        const [orders, tables, menu, movements, reservations] = await Promise.all([
            this.getPosOrders(userId, { dimensionId, limitCount: 300 }),
            this.getPosTables(userId, { dimensionId }),
            this.getPosMenu(userId),
            this.getStockMovements(userId, { limitCount: 1000 }).catch(() => []),
            // Bookings that could hold a table anywhere near now. Read in the
            // SAME call as the tables and the orders on purpose: the floor plan
            // paints all three together, and a floor plan that renders before
            // its reservations have landed shows a reserved table as free — for
            // one frame, which is one frame longer than it takes to tap it.
            this._holdingReservations(userId, { dimensionId }).catch(() => [])
        ]);

        // Every non-terminal status. Missing one here does not fail loudly — the
        // order simply stops being "active", disappears from the board and the
        // floor plan, and the table it is sitting at reads as free.
        const openStatuses = ['open', 'submitted', 'sent', 'ready', 'served', 'awaiting_payment'];
        const active = orders.filter((o) => openStatuses.includes(o.status));
        const todayPaid = orders.filter((o) => o.status === 'paid' && (() => {
            const t = o.paid_at && typeof o.paid_at.toDate === 'function' ? o.paid_at.toDate() : null;
            return t && t >= start;
        })());

        const occupied = new Set(active.map((o) => o.table_id).filter(Boolean));
        // Held by a booking right now — the second reason a table cannot be sold.
        const reservedNow = new Set(reservations
            .filter((r) => posReservationHoldsAt(r))
            .map((r) => r.table_id).filter(Boolean));

        // Which menu items have a real cost basis. An item selling at zero cost
        // inflates gross margin exactly the way marketplace orders did before
        // per-sale relief existed — the whole reason this chain was built.
        const costed = new Set();
        movements.forEach((m) => { if (Number(m.amount)) costed.add(m.item_id); });

        // On hand, summed from the movements this function ALREADY reads — so
        // the till can say "3 left" and "out of stock" at no extra read cost.
        //
        // Stock is summed, never cached (stock.md §5): a stored count and the
        // movements eventually disagree and nothing reports it.
        const onHand = {};
        movements.forEach((m) => {
            onHand[m.item_id] = (onHand[m.item_id] || 0) + (Number(m.quantity) || 0);
        });
        const noCostBasis = menu.filter((m) => (m.type === 'composite' ? !m.has_recipe : !costed.has(m.id)));

        return {
            // `occupied` is "somebody is sitting here"; `reserved` is "somebody
            // is about to be". They are kept apart because they read differently
            // on the floor and are released differently — an order is paid, a
            // booking is completed, cancelled or marked a no-show.
            tables: tables.map((t) => ({
                ...t, occupied: occupied.has(t.id), reserved: reservedNow.has(t.id)
            })),
            // The board and the floor plan share ONE list, so they can never
            // disagree about which tables are spoken for.
            reservations,
            counts: {
                tablesTotal: tables.length,
                tablesOccupied: occupied.size,
                tablesReserved: reservedNow.size,
                // A free table is one that is neither sat at NOR held. The count
                // on the Table Order button is what a cashier decides by, so
                // counting a reserved table as free would send them to it.
                tablesFree: Math.max(0, tables.length
                    - new Set([...occupied, ...reservedNow]).size),
                activeOrders: active.length,
                awaitingPayment: active.filter((o) => o.status === 'awaiting_payment').length,
                newQrOrders: active.filter((o) => o.channel === 'qr' && o.status === 'submitted').length,
                paidToday: todayPaid.length,
                // Bookings still to arrive today, and the covers they bring —
                // the two numbers that decide whether a walk-in can be taken.
                reservationsUpcoming: reservations.filter((r) => {
                    const t = posToMs(r.starts_at);
                    return ['pending', 'confirmed'].includes(r.status) && t != null && t >= start.getTime();
                }).length,
                reservationCovers: reservations
                    .filter((r) => {
                        const t = posToMs(r.starts_at);
                        return ['pending', 'confirmed', 'arrived'].includes(r.status)
                            && t != null && t >= start.getTime();
                    })
                    .reduce((sum, r) => sum + (Number(r.party_size) || 0), 0)
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
            // itemId -> base units on hand. Advisory ONLY: the till shows it and
            // never enforces it. A shop that has physically got the thing sells
            // it, whatever the system believes — refusing the sale would make
            // FluxyOS wrong about the money as well as about the stock.
            onHand,
            noCostBasisCount: noCostBasis.length,
            noCostBasisNames: noCostBasis.slice(0, 5).map((m) => m.name),
            menuSize: menu.length
        };
    }
};
