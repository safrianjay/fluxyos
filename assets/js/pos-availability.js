// =============================================================================
// FluxyOS — POS table availability
//
// THE ONE ANSWER TO "CAN THIS TABLE TAKE SOMEONE RIGHT NOW".
//
// Two surfaces ask it and they must never disagree:
//
//   - the FLOOR PLAN and the Create Order dialog, where a cashier seats a
//     walk-in;
//   - the RESERVATIONS board, where a host books one in advance.
//
// A reservation that the floor plan cannot see is worse than no reservation
// system at all: the table gets sold twice and the second party is turned away
// at the door with a booking in their hand. So neither surface computes this
// for itself — both call in here, and so does `createPosOrder` in the DAL, which
// is what makes the rule an actual rule rather than two UIs that happen to agree
// today.
//
// WHY THIS IS A SEPARATE FILE. It is pure: no Firestore, no DOM, no `window`.
// That is what lets `tests/pos-availability.check.js` exercise every boundary of
// the hold window in milliseconds, and what stops the next surface that needs
// the answer (a QR menu, a connector, a host stand tablet) from writing a third
// copy of it.
//
// OCCUPANCY IS STILL NEVER STORED. Same principle as `pos_tables` (pos.md §2)
// and stock on hand (stock.md §5): a table's state is DERIVED from the orders
// and reservations that reference it, every time it is asked for. A cached
// `is_reserved` flag and a real reservation eventually disagree, and nothing
// would report it.
// =============================================================================

// ── The time model ───────────────────────────────────────────────────────────
//
// A reservation owns its table for longer than the instant it starts.

// How long before the booked time the table stops being sellable. A table that
// only locks at 19:00:00 is a table someone was seated at 18:55 — and the party
// with the booking arrives to find it holding somebody's main course. Thirty
// minutes is the industry-standard turn-down window and is what the floor plan
// shows as "Reserved 19:00".
export const HOLD_BEFORE_MIN = 30;

// How long a sitting is assumed to last when the host does not say. Stored
// per-reservation (`duration_minutes`) so a set menu or a large party can differ.
export const DEFAULT_DURATION_MIN = 90;

// Clearing time between two sittings on the same table. Only used when checking
// one reservation against another — a 19:00–20:30 and a 20:30–22:00 on table 4
// is a double-booking in practice, because nobody clears and resets a table in
// zero minutes.
export const TURNOVER_MIN = 10;

// After this much of the booked time has passed with nobody seated, the booking
// is LATE. It does not stop holding the table — see `isLate` below.
export const LATE_GRACE_MIN = 15;

export const MINUTE = 60000;

// Statuses that hold a table against everyone else.
//
// `arrived` is in the list even though a seated party normally has an open order
// holding the table anyway: the two happen a few seconds apart, and for those
// seconds the table must not be offered to the next walk-in.
export const HOLDING_STATUSES = ['pending', 'confirmed', 'arrived'];

// Statuses that release it. Each is a deliberate act by a person — which is the
// point: a table comes back into supply because somebody decided it should,
// never because a timer quietly expired while the guest was parking.
export const RELEASED_STATUSES = ['completed', 'cancelled', 'no_show'];

export const RESERVATION_STATUSES = HOLDING_STATUSES.concat(RELEASED_STATUSES);

// Where the booking came from. Display + reporting only; nothing branches on it.
export const RESERVATION_SOURCES = ['direct', 'phone', 'whatsapp', 'website', 'instagram', 'walk_in', 'other'];

// ── Coercion ─────────────────────────────────────────────────────────────────

// Firestore Timestamp | Date | number | ISO string → epoch ms, or null.
//
// Deliberately tolerant. This function is called from the DAL (where dates are
// Timestamps), from the till (where a freshly-written doc still carries a client
// Date), and from tests (plain numbers). A single coercion point means none of
// those three paths can develop its own idea of what a date is.
export function toMs(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const t = Date.parse(value);
        return Number.isNaN(t) ? null : t;
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    if (typeof value.toDate === 'function') {
        try { const d = value.toDate(); return d ? d.getTime() : null; } catch (_) { return null; }
    }
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return null;
}

const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

// ── The window a reservation occupies ────────────────────────────────────────

/**
 * The three moments that matter for one booking.
 *
 * `holdFrom` is when the table stops being sellable, `startMs` is when the guest
 * is expected, `endMs` is when the sitting is assumed to be over. Returns null
 * for a reservation with no usable time, which is treated as blocking NOTHING —
 * a malformed booking must not silently take a table out of service.
 */
export function reservationWindow(res) {
    if (!res) return null;
    const startMs = toMs(res.starts_at);
    if (startMs == null) return null;
    const minutes = num(res.duration_minutes, DEFAULT_DURATION_MIN);
    return {
        startMs,
        endMs: startMs + minutes * MINUTE,
        holdFrom: startMs - HOLD_BEFORE_MIN * MINUTE,
        durationMin: minutes
    };
}

/** Does this booking hold its table at `atMs`? */
export function reservationHoldsAt(res, atMs = Date.now()) {
    if (!res || !res.table_id) return false;                 // unassigned = holds no table
    if (!HOLDING_STATUSES.includes(res.status)) return false;
    const w = reservationWindow(res);
    if (!w) return false;
    return atMs >= w.holdFrom && atMs < w.endMs;
}

/**
 * Booked, expected by now, and nobody seated.
 *
 * A late booking KEEPS its table. Releasing it automatically is the tempting
 * behaviour and the wrong one: the table would come free while the party is
 * still walking from the car park, a walk-in would be seated in it, and the
 * system that caused that would report nothing at all. So lateness is surfaced
 * on the board with the two actions a host actually takes — seat them anyway, or
 * mark it a no-show — and a human releases the table.
 */
export function isLate(res, atMs = Date.now()) {
    if (!res || !['pending', 'confirmed'].includes(res.status)) return false;
    const w = reservationWindow(res);
    if (!w) return false;
    return atMs > w.startMs + LATE_GRACE_MIN * MINUTE && atMs < w.endMs;
}

/** Minutes until the booking starts (negative once it has). */
export function minutesUntil(res, atMs = Date.now()) {
    const w = reservationWindow(res);
    return w ? Math.round((w.startMs - atMs) / MINUTE) : null;
}

// ── The state of one table ───────────────────────────────────────────────────

// Orders that are still on the floor. Kept here rather than imported from
// pos-service so this module stays dependency-free — and asserted against the
// DAL's own list by tests/pos-availability.check.js, so the two cannot drift
// the way `openStatuses` and the rules allowlist did when `ready` was added.
export const ACTIVE_ORDER_STATUSES = ['open', 'submitted', 'sent', 'ready', 'served', 'awaiting_payment'];

/**
 * What is happening at one table, right now.
 *
 * @returns {{
 *   state: 'free'|'occupied'|'bill'|'reserved',
 *   order: object|null,        the order sitting there, if any
 *   reservation: object|null,  the booking HOLDING it, if any
 *   upcoming: object|null,     the next booking that is not holding it yet
 *   available: boolean         may a walk-in be seated here right now
 * }}
 *
 * An order outranks a reservation in the DISPLAY — a table with people eating at
 * it reads "in use", not "reserved", because that is what the room looks like —
 * but either one makes it unavailable, which is the only fact the Create Order
 * dialog needs.
 */
export function tableStateAt(tableId, { orders = [], reservations = [] } = {}, atMs = Date.now()) {
    const order = orders.find((o) => o && o.table_id === tableId
        && ACTIVE_ORDER_STATUSES.includes(o.status)) || null;

    const holding = reservations
        .filter((r) => r && r.table_id === tableId && reservationHoldsAt(r, atMs))
        // Earliest first: two overlapping holds should surface the one whose
        // guest is due first, since that is who turns up at the door.
        .sort((a, b) => (toMs(a.starts_at) || 0) - (toMs(b.starts_at) || 0));

    // The next booking that has not started holding yet — what the floor plan
    // shows as "Reserved 19:00" on a table that is free for the next hour, so a
    // cashier can see the wall coming before they seat a two-hour party.
    const upcoming = reservations
        .filter((r) => r && r.table_id === tableId
            && HOLDING_STATUSES.includes(r.status)
            && !reservationHoldsAt(r, atMs)
            && (toMs(r.starts_at) || 0) > atMs)
        .sort((a, b) => (toMs(a.starts_at) || 0) - (toMs(b.starts_at) || 0))[0] || null;

    const reservation = holding[0] || null;
    let state = 'free';
    if (order) state = order.status === 'awaiting_payment' ? 'bill' : 'occupied';
    else if (reservation) state = 'reserved';

    return { state, order, reservation, upcoming, available: state === 'free' };
}

/**
 * Every table's state in one pass — what the floor plan paints from.
 * @returns {Map<string, ReturnType<typeof tableStateAt>>}
 */
export function floorAvailability({ tables = [], orders = [], reservations = [] } = {}, atMs = Date.now()) {
    const map = new Map();
    tables.forEach((t) => { map.set(t.id, tableStateAt(t.id, { orders, reservations }, atMs)); });
    return map;
}

/**
 * May a walk-in be seated at this table right now, and if not, why not.
 *
 * The message is the one the cashier reads, so it names the guest and the time —
 * "reserved" alone invites the assumption that the system is being cautious, and
 * a cashier who thinks that seats the table anyway.
 */
export function walkInBlockedReason(tableId, ctx, atMs = Date.now()) {
    const s = tableStateAt(tableId, ctx, atMs);
    if (s.available) return null;
    if (s.order) return 'This table already has an open order.';
    const r = s.reservation;
    const who = (r && r.guest_name) ? String(r.guest_name) : 'a reservation';
    const when = formatClock(toMs(r && r.starts_at));
    return `Reserved for ${who}${when ? ` at ${when}` : ''}.`;
}

// ── Reservation vs reservation ───────────────────────────────────────────────

/**
 * Bookings on the same table whose sittings overlap the proposed one.
 *
 * The comparison uses start→end plus `TURNOVER_MIN` on each side rather than the
 * 30-minute hold window: back-to-back bookings are a normal, deliberate thing a
 * host does, and refusing a 20:45 because a 19:00 exists would make the board
 * unusable. What is refused is two parties in one seat.
 */
export function reservationConflicts(reservations, { tableId, startsAt, durationMinutes, excludeId = null } = {}) {
    if (!tableId) return [];                                  // unassigned conflicts with nothing
    const startMs = toMs(startsAt);
    if (startMs == null) return [];
    const endMs = startMs + num(durationMinutes, DEFAULT_DURATION_MIN) * MINUTE;
    const pad = TURNOVER_MIN * MINUTE;

    return (reservations || []).filter((r) => {
        if (!r || r.id === excludeId) return false;
        if (r.table_id !== tableId) return false;
        if (!HOLDING_STATUSES.includes(r.status)) return false;
        const w = reservationWindow(r);
        if (!w) return false;
        return startMs < w.endMs + pad && endMs + pad > w.startMs;
    });
}

// ── Small shared formatters ──────────────────────────────────────────────────
//
// Here rather than in pos.js because the DAL builds refusal messages too, and a
// refusal that formats its time differently from the board that caused it reads
// as a different system talking.

/** 24-hour clock, zero-padded. `null` in, empty string out. */
export function formatClock(ms) {
    if (ms == null) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "19:00 – 20:30" for one booking. */
export function formatWindow(res) {
    const w = reservationWindow(res);
    if (!w) return '';
    return `${formatClock(w.startMs)} – ${formatClock(w.endMs)}`;
}

/** Local calendar day key, `YYYY-MM-DD`. Never UTC: a 23:00 booking in Jakarta
 *  is tonight's, and `toISOString()` would file it under tomorrow. */
export function dayKey(value) {
    const ms = toMs(value);
    if (ms == null) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Start of the local day containing `value`. */
export function startOfDay(value) {
    const d = new Date(toMs(value) ?? Date.now());
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Monday-anchored start of the week containing `value`. Indonesian and most
 *  European calendars start on Monday; the reservation board is a working week
 *  and a Sunday-first grid splits every weekend service across two columns. */
export function startOfWeek(value) {
    const d = startOfDay(value);
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return d;
}

export function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
}
