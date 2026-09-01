'use strict';

// =============================================================================
// POS table availability — the rule three surfaces share.
//
// A reservation that the till cannot see is worse than no reservation system at
// all: the table gets sold twice and the party holding the booking is the one
// turned away at the door. `assets/js/pos-availability.js` exists so that the
// floor plan, the Create Order dialog and `createPosOrder` in the DAL cannot
// develop three opinions about the word "free".
//
// This runs in milliseconds with no emulator and no browser, which is the point:
// every boundary of the hold window is an off-by-one that would otherwise only
// show up as a table double-booked during service.
//
// Run: node tests/pos-availability.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
};

const MIN = 60000;
const at = (h, m = 0) => new Date(2026, 8, 15, h, m, 0, 0).getTime();   // 15 Sep 2026, local

(async () => {
    const A = await import(pathToFileURL(path.join(ROOT, 'assets/js/pos-availability.js')).href);

    console.log('\npos availability\n');

    // ── The hold window ─────────────────────────────────────────────────────
    // A booking owns its table for longer than the instant it starts. A table
    // that only locks at 19:00:00 is a table somebody was seated at 18:55, and
    // the party with the booking arrives to find it holding a main course.
    const booking = {
        id: 'r1', table_id: 't4', status: 'confirmed', guest_name: 'Maya',
        starts_at: at(19), duration_minutes: 90
    };

    is(A.reservationHoldsAt(booking, at(17, 0)), false, 'free two hours before — a walk-in can still be seated');
    is(A.reservationHoldsAt(booking, at(18, 29)), false, 'free 31 minutes before');
    is(A.reservationHoldsAt(booking, at(18, 30)), true, 'held from exactly 30 minutes before (HOLD_BEFORE_MIN)');
    is(A.reservationHoldsAt(booking, at(19, 0)), true, 'held at the booked time — the brief\'s walk-in case');
    is(A.reservationHoldsAt(booking, at(20, 29)), true, 'held until the sitting ends');
    is(A.reservationHoldsAt(booking, at(20, 30)), false, 'released the moment the sitting is over');

    // ── Which statuses hold, and which release ──────────────────────────────
    // The three released statuses are the only ways a table comes back into
    // supply, and each is a person's decision. Nothing expires on a timer.
    ['pending', 'confirmed', 'arrived'].forEach((status) => {
        is(A.reservationHoldsAt({ ...booking, status }, at(19)), true, `${status} holds the table`);
    });
    ['completed', 'cancelled', 'no_show'].forEach((status) => {
        is(A.reservationHoldsAt({ ...booking, status }, at(19)), false, `${status} releases it`);
    });

    // A booking with no table holds NOTHING. Taking one before the host knows
    // where it will sit is normal; holding a table nobody chose would lose the
    // floor capacity to a maybe.
    is(A.reservationHoldsAt({ ...booking, table_id: null }, at(19)), false,
        'an unassigned booking holds no table');
    // A malformed booking must not silently take a table out of service.
    is(A.reservationHoldsAt({ ...booking, starts_at: null }, at(19)), false,
        'a booking with no time holds nothing');

    // ── Lateness never releases the table ───────────────────────────────────
    // Auto-releasing is the tempting behaviour and the wrong one: the table
    // would come free while the party is still walking from the car park, a
    // walk-in would be seated in it, and nothing would report what happened.
    is(A.isLate(booking, at(19, 10)), false, 'not late inside the grace period');
    is(A.isLate(booking, at(19, 20)), true, 'late once the grace period passes');
    is(A.reservationHoldsAt(booking, at(19, 20)), true, 'and a LATE booking still holds its table');
    is(A.isLate({ ...booking, status: 'arrived' }, at(19, 20)), false, 'a seated party is never late');

    // ── The table state one dialog and one floor plan both read ─────────────
    const ctx = {
        orders: [{ id: 'o1', table_id: 't1', status: 'served' },
                 { id: 'o2', table_id: 't2', status: 'awaiting_payment' },
                 { id: 'o3', table_id: 't9', status: 'paid' }],
        reservations: [booking]
    };
    is(A.tableStateAt('t1', ctx, at(19)).state, 'occupied', 'an open order occupies its table');
    is(A.tableStateAt('t2', ctx, at(19)).state, 'bill', 'awaiting payment reads as the bill state');
    is(A.tableStateAt('t9', ctx, at(19)).state, 'free', 'a PAID order no longer holds its table');
    is(A.tableStateAt('t4', ctx, at(19)).state, 'reserved', 'the booked table reads reserved');
    is(A.tableStateAt('t4', ctx, at(19)).available, false, 'and is not available to a walk-in');
    is(A.tableStateAt('t4', ctx, at(17)).available, true, 'the same table is available earlier in the day');
    is(A.tableStateAt('t7', ctx, at(19)).state, 'free', 'an untouched table is free');

    // An order OUTRANKS a booking in the display — a table with people eating at
    // it reads "in use", not "reserved", because that is what the room looks
    // like. Either one makes it unavailable, which is all the dialog needs.
    const both = { orders: ctx.orders, reservations: [{ ...booking, table_id: 't1' }] };
    is(A.tableStateAt('t1', both, at(19)).state, 'occupied', 'an order outranks a booking in the display');
    is(A.tableStateAt('t1', both, at(19)).available, false, '…and the table is still unavailable');

    // The next booking on a table that is free right now — what lets the floor
    // plan warn before a two-hour party is seated into a wall.
    const upcoming = A.tableStateAt('t4', ctx, at(16)).upcoming;
    is(upcoming && upcoming.id, 'r1', 'a free table surfaces its next booking');

    // ── The refusal a cashier actually reads ────────────────────────────────
    // "Reserved" alone invites the reading that the system is being cautious,
    // and a cashier who reads it that way seats the table anyway.
    const reason = A.walkInBlockedReason('t4', ctx, at(19));
    is(typeof reason === 'string' && reason.includes('Maya') && reason.includes('19:00'), true,
        'the refusal names the guest and the time');
    is(A.walkInBlockedReason('t7', ctx, at(19)), null, 'a free table gives no reason');

    // ── Booking against booking ─────────────────────────────────────────────
    // Back-to-back is a normal thing a host does; two parties in one seat is not.
    const book = (id, hour, minute, table = 't4') => ({
        id, table_id: table, status: 'confirmed', guest_name: id,
        starts_at: at(hour, minute), duration_minutes: 90
    });
    const existing = [book('r1', 19, 0)];
    const clashes = (h, m, table = 't4') => A.reservationConflicts(existing,
        { tableId: table, startsAt: at(h, m), durationMinutes: 90 }).length;

    is(clashes(19, 30), 1, 'a sitting starting inside another one clashes');
    is(clashes(18, 0), 1, 'a sitting ending inside another one clashes');
    is(clashes(20, 35), 1, 'back-to-back inside the turnover buffer clashes');
    is(clashes(20, 45), 0, 'a genuine second sitting after turnover is allowed');
    is(clashes(19, 0, 't5'), 0, 'a different table never clashes');
    is(A.reservationConflicts(existing, { tableId: 't4', startsAt: at(19), durationMinutes: 90, excludeId: 'r1' }).length,
        0, 'editing a booking does not clash with itself');
    is(A.reservationConflicts([{ ...existing[0], status: 'cancelled' }],
        { tableId: 't4', startsAt: at(19), durationMinutes: 90 }).length,
        0, 'a cancelled booking frees its slot for a new one');
    is(A.reservationConflicts(existing, { tableId: null, startsAt: at(19), durationMinutes: 90 }).length,
        0, 'an unassigned booking conflicts with nothing');

    // ── Date coercion ───────────────────────────────────────────────────────
    // Called from the DAL (Firestore Timestamps), the till (a client Date on a
    // just-written doc) and here (plain numbers). One coercion point means none
    // of the three can develop its own idea of what a date is.
    const ms = at(19);
    is(A.toMs(ms), ms, 'a number passes through');
    is(A.toMs(new Date(ms)), ms, 'a Date coerces');
    is(A.toMs({ toDate: () => new Date(ms) }), ms, 'a Firestore Timestamp coerces');
    is(A.toMs({ seconds: Math.floor(ms / 1000) }), Math.floor(ms / 1000) * 1000, 'a raw {seconds} coerces');
    is(A.toMs(null), null, 'null stays null');
    is(A.toMs('not a date'), null, 'garbage stays null rather than becoming 1970');

    // `dayKey` must be LOCAL. A 23:00 booking in Jakarta is tonight's, and
    // toISOString() would file it under tomorrow — a booking that vanishes from
    // the day it belongs to and appears on a day the host is not looking at.
    is(A.dayKey(new Date(2026, 8, 15, 23, 30)), '2026-09-15', 'a late booking keeps its own local day');

    // Monday-anchored. A Sunday-first grid splits every weekend service across
    // two columns of the week view.
    is(A.startOfWeek(new Date(2026, 8, 15)).getDay(), 1, 'the week starts on Monday');

    // ── The list that must not drift ────────────────────────────────────────
    // `ACTIVE_ORDER_STATUSES` here and `openStatuses` in getPosOverview are the
    // same claim in two files. When `ready` was added it touched three separate
    // allowlists and the dangerous one failed SILENTLY — an order missing from
    // it does not error, it just vanishes from the board and its table reads as
    // free. That is exactly the bug this feature must not reintroduce.
    const dal = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
    const m = dal.match(/const openStatuses = \[([^\]]*)\]/);
    if (!m) {
        fail('could not find `openStatuses` in pos-service.js — did getPosOverview change shape?');
    } else {
        const dalStatuses = m[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
        is(dalStatuses.join(','), A.ACTIVE_ORDER_STATUSES.join(','),
            'ACTIVE_ORDER_STATUSES matches getPosOverview\'s openStatuses');
    }

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos availability: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ pos-availability check threw:', err);
    process.exit(1);
});
