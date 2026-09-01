const { test, expect } = require('@playwright/test');

// =============================================================================
// Reservations, and the one thing they are FOR.
//
// The feature is not a calendar. It is a claim on a table in the future, and the
// only claim that matters is this one:
//
//   a table booked for 19:00 cannot be given to a walk-in at 19:00.
//
// That claim is asserted in four places — `pos-availability.js`, the floor plan,
// the Create Order dialog, and `createPosOrder` in the DAL — and the way it
// breaks is silent: one surface offers the table, another holds it, and the
// party with the booking is turned away at the door by a system that reported
// nothing. So the spec below does not check that a calendar renders. It checks
// that every route to a table agrees about whether it can be sold.
//
// Bookings are SEEDED rather than written. Rules never permit deleting a
// reservation — a cancelled booking is a fact about the evening — so a spec that
// wrote real ones would leave permanent residue in the QA workspace holding real
// tables against real walk-ins. The rule under test here is rendering and
// selection; the write path is proven in tests/pos-rules-emulator-test.mjs.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

const TABLES = [
    { id: 't-a04', label: 'A04', seats: 4, zone: null, dimension_id: 'qa', status: 'active', sort: 1 },
    { id: 't-a05', label: 'A05', seats: 2, zone: null, dimension_id: 'qa', status: 'active', sort: 2 },
    { id: 't-a06', label: 'A06', seats: 6, zone: null, dimension_id: 'qa', status: 'active', sort: 3 }
];

// A booking whose window contains RIGHT NOW, expressed the way the till stores
// one. `starts_at` carries a `toDate()` because every reader coerces through
// `toMs`, which is what makes a Firestore Timestamp and a plain Date the same
// thing to this code.
function booking(over = {}) {
    const startsAt = new Date(Date.now() - 10 * 60000);   // began ten minutes ago
    return {
        id: 'res-1',
        dimension_id: 'qa',
        table_id: 't-a04',
        table_label: 'A04',
        guest_name: 'Maya Kusuma',
        guest_phone: '0812-3456-7890',
        party_size: 4,
        starts_at: { toDate: () => startsAt },
        duration_minutes: 90,
        status: 'confirmed',
        source: 'phone',
        note: null,
        order_id: null,
        version: 1,
        ...over
    };
}

async function openTill(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    // Wait for the till to have FINISHED booting, not for a fixed number of
    // milliseconds. `#pos-new-order` is enabled at the end of the first
    // refresh(), so it is the page's own readiness signal — and seeding before
    // that first refresh lands freezes a half-painted page, which is how this
    // spec first failed on a workspace with 30 outlets and passed on a small one.
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 40000 });
}

async function seedFloor(page, reservations) {
    return page.evaluate(({ tables, rows }) => {
        // `starts_at` cannot cross the evaluate boundary as a function, so the
        // offsets travel as numbers and the Timestamp shape is rebuilt in-page.
        const rebuilt = rows.map((r) => ({
            ...r, starts_at: { toDate: () => new Date(r._startsAtMs) }
        }));
        return window.__posSeedFloor(tables, rebuilt);
    }, {
        tables: TABLES,
        rows: reservations.map((r) => {
            const { starts_at, ...rest } = r;
            return { ...rest, _startsAtMs: starts_at.toDate().getTime() };
        })
    });
}

async function openFloor(page) {
    await page.click('#nav-container [data-view="tables"]');
    await expect(page.locator('.pos-view[data-view="tables"]')).toBeVisible();
}

test.describe('Reservations hold their table', () => {

    // ── The brief, verbatim ─────────────────────────────────────────────────
    test('a table booked for now cannot be taken by a walk-in, on any route to it', async ({ page }) => {
        await openTill(page);
        await openFloor(page);
        const painted = await seedFloor(page, [booking()]);

        const a04 = painted.find((t) => t.label === 'A04');
        const a05 = painted.find((t) => t.label === 'A05');
        expect(a04, 'the seeded floor rendered table A04').toBeTruthy();

        // 1. THE FLOOR PLAN. Reserved is its own state — not "free", and not
        //    "in use" either, because nobody is sitting there yet and a cashier
        //    told "in use" goes looking for an order that does not exist.
        expect(a04.state).toBe('reserved');
        expect(a05.state).toBe('free');
        // Who and when, never a bare "Reserved": one word reads as the system
        // being cautious, and a cashier who reads it that way seats the table.
        expect(a04.caption).toContain('Maya');
        expect(a04.caption).toMatch(/\d{2}:\d{2}/);

        // 2. TAPPING IT opens the booking, not a new order. This is the refusal
        //    made physical — there is no dialog to click past, because the
        //    dialog that would have taken a walk-in never opens.
        await page.click('.pos-table.is-reserved');
        const detail = page.locator('#pos-res-detail');
        await expect(detail).toBeVisible();
        await expect(detail).toContainText('Maya Kusuma');
        await expect(page.locator('#pos-create-modal')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(detail).toHaveCount(0);

        // 3. THE CREATE ORDER DIALOG. Reached from the topbar, where the cashier
        //    picks the table themselves — the route the floor plan cannot guard.
        await page.click('#pos-new-order');
        const dialog = page.locator('#pos-create-modal');
        await expect(dialog).toBeVisible();

        const reserved = dialog.locator('#pos-create-table option', { hasText: 'A04' });
        await expect(reserved).toBeDisabled();
        // The option says WHY, in the words a cashier can act on.
        await expect(reserved).toContainText(/reserved \d{2}:\d{2}/);
        // The rest of the room is unaffected: a booking takes one table out of
        // supply, not the floor.
        await expect(dialog.locator('#pos-create-table option', { hasText: 'A05' })).toBeEnabled();
        await expect(dialog.locator('#pos-create-table option', { hasText: 'A06' })).toBeEnabled();
    });

    // ── Released means released ─────────────────────────────────────────────
    // Three statuses put a table back into supply and each is a person's
    // decision. If any of them kept holding, a cancelled booking would take a
    // table out of service for the rest of the evening with nothing on screen
    // explaining why.
    for (const status of ['cancelled', 'no_show', 'completed']) {
        test(`a ${status} booking releases its table`, async ({ page }) => {
            await openTill(page);
            await openFloor(page);
            const painted = await seedFloor(page, [booking({ status })]);
            const a04 = painted.find((t) => t.label === 'A04');
            expect(a04.state).toBe('free');
            expect(a04.reservation).toBeNull();

            await page.click('#pos-new-order');
            await expect(page.locator('#pos-create-modal')).toBeVisible();
            await expect(page.locator('#pos-create-table option', { hasText: 'A04' })).toBeEnabled();
        });
    }

    // ── The hold window ─────────────────────────────────────────────────────
    test('the table locks 30 minutes ahead, and says what is coming before that', async ({ page }) => {
        await openTill(page);
        await openFloor(page);

        // Two hours out: takeable, but the floor plan warns — otherwise a
        // two-hour party is seated into a wall the cashier could have seen.
        const soon = await seedFloor(page, [booking({
            starts_at: { toDate: () => new Date(Date.now() + 120 * 60000) }
        })]);
        const later = soon.find((t) => t.label === 'A04');
        expect(later.state).toBe('free');
        expect(later.caption).toMatch(/booked \d{2}:\d{2}/);

        // Twenty minutes out: inside the hold, and no longer sellable. A table
        // that only locks at the booked minute is a table someone was seated at
        // five to.
        const imminent = await seedFloor(page, [booking({
            starts_at: { toDate: () => new Date(Date.now() + 20 * 60000) }
        })]);
        expect(imminent.find((t) => t.label === 'A04').state).toBe('reserved');
    });

    // ── A late guest keeps their table ──────────────────────────────────────
    // Auto-releasing is the tempting behaviour and the wrong one: the table
    // would free itself while the party is still parking, a walk-in would be
    // seated in it, and nothing would report what happened. The board says so
    // loudly instead, and a human decides.
    test('a late booking still holds the table, and the board asks what to do', async ({ page }) => {
        await openTill(page);
        await openFloor(page);
        const painted = await seedFloor(page, [booking({
            starts_at: { toDate: () => new Date(Date.now() - 40 * 60000) }
        })]);
        expect(painted.find((t) => t.label === 'A04').state).toBe('reserved');

        await page.click('.pos-table.is-reserved');
        const detail = page.locator('#pos-res-detail');
        await expect(detail).toBeVisible();
        await expect(detail.locator('.pos-res-warn')).toContainText(/will not free itself/i);
        // Both ways out are offered, and neither happens on its own.
        await expect(detail.locator('[data-act="seat"]')).toBeVisible();
        await expect(detail.locator('[data-act="no_show"]')).toBeVisible();
    });

    // ── An unassigned booking holds nothing ─────────────────────────────────
    // A booking taken before the host knows where it will sit is normal. Holding
    // a table nobody chose would lose the floor's capacity to a maybe — so it
    // holds none, and the board says the booking needs one.
    test('a booking with no table holds nothing and says so', async ({ page }) => {
        await openTill(page);
        await openFloor(page);
        const painted = await seedFloor(page, [booking({ table_id: null, table_label: null })]);
        expect(painted.every((t) => t.state === 'free')).toBe(true);

        await page.click('#nav-container [data-view="reservations"]');
        await expect(page.locator('.pos-view[data-view="reservations"]')).toBeVisible();
        await page.click('[data-rlayout="list"]');
        const row = page.locator('#pos-res-list tr[data-res]').first();
        await expect(row).toContainText('Not assigned');
        await row.click();
        await expect(page.locator('#pos-res-detail .pos-res-warn')).toContainText(/holding nothing/i);
    });
});

// ── The one spec that writes for real ───────────────────────────────────────
//
// Everything above is seeded, which proves the RULE and nothing about whether
// the rules are deployed. `firestore.rules` does not ship with `git push` — it
// is a separate deploy — and code that depends on an undeployed block does not
// degrade: the write is refused outright. This spec is what makes "published in
// the console" and "actually works" the same claim.
//
// It reverses itself: the booking is cancelled, which is the product's own way
// of releasing a table (rules never permit a delete, because a cancelled
// booking is a fact about the evening). The `finally` matters — a spec that
// fails mid-way would otherwise leave a real QA table held against every
// walk-in, which is the exact harm this feature exists to prevent.
test('a booking survives a real round-trip to Firestore, and releases its table again', async ({ page }) => {
    await openTill(page);
    await page.click('#nav-container [data-view="reservations"]');
    await expect(page.locator('.pos-view[data-view="reservations"]')).toBeVisible();

    const guest = `QA Reservation ${Date.now()}`;
    let created = false;
    try {
        await page.click('#pos-res-new');
        const dialog = page.locator('#pos-res-modal');
        await expect(dialog).toBeVisible();
        await dialog.locator('#pos-res-name').fill(guest);
        await dialog.locator('#pos-res-party').fill('2');
        // Tomorrow at 19:00, so it cannot hold a table during anything else
        // running now. The date goes through the SHARED picker — clicking the
        // day, as a person would, which is also what proves the picker is wired
        // to the value the write uses rather than merely rendered beside it.
        await dialog.locator('#pos-res-datefield [data-drp-trigger]').click();
        const tomorrow = await page.evaluate(() => {
            const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        });
        await page.click(`[data-drp-day="${tomorrow}"]`);
        await dialog.locator('#pos-res-time').fill('19:00');
        await dialog.locator('#pos-res-time').dispatchEvent('change');

        // A real table when the outlet has a free one — that is the path that
        // carries `table_label` and the one a permission failure would hide.
        const table = dialog.locator('#pos-res-table option:not([disabled])').nth(1);
        if (await table.count()) await dialog.locator('#pos-res-table').selectOption(await table.getAttribute('value'));

        await dialog.locator('#pos-res-submit').click();
        // A rules refusal surfaces IN the dialog, so a failure here names the
        // cause instead of timing out on a list that never changed.
        await expect(dialog.locator('#pos-res-error')).toBeHidden({ timeout: 20000 });
        await expect(dialog).toHaveCount(0, { timeout: 20000 });
        created = true;

        // Read it back off the board rather than trusting the toast.
        await page.click('[data-rlayout="list"]');
        await page.fill('#pos-res-search', guest);
        await expect(page.locator('#pos-res-list tr[data-res]', { hasText: guest })).toHaveCount(1);
    } finally {
        if (created) {
            await page.fill('#pos-res-search', guest).catch(() => {});
            await page.click('[data-rlayout="list"]').catch(() => {});
            const row = page.locator('#pos-res-list tr[data-res]', { hasText: guest }).first();
            if (await row.count()) {
                await row.click();
                // Cancelling is an UPDATE — a second rules transition, and the
                // one that would fail if only the create clause were deployed.
                await page.click('#pos-res-detail [data-act="cancelled"]');
                await expect(page.locator('#pos-res-detail')).toHaveCount(0, { timeout: 20000 });
            }
        }
    }
});

test.describe('The reservations board', () => {

    test('opens on the week, moves through the range, and switches layout', async ({ page }) => {
        await openTill(page);
        await page.click('#nav-container [data-view="reservations"]');
        const view = page.locator('.pos-view[data-view="reservations"]');
        await expect(view).toBeVisible();

        // The page header is the TOPBAR on this page — a header rendered in the
        // canvas costs the first 90px of a 10" tablet re-introducing the screen.
        await expect(page.locator('#pos-view-title')).toHaveText('Reservations');

        // Week is the default: a service is planned a week at a time.
        await expect(page.locator('[data-rperiod="week"]')).toHaveClass(/is-active/);
        await expect(page.locator('#pos-res-calendar .pos-cal-grid')).toBeVisible();

        const shown = await page.locator('#pos-res-date').textContent();
        await page.click('[data-rmove="1"]');
        await expect(page.locator('#pos-res-date')).not.toHaveText(shown);
        await page.click('[data-rmove="0"]');
        await expect(page.locator('#pos-res-date')).toHaveText(shown);

        // Day and Month are different questions, so they are different shapes:
        // a timeline for "when is this table free", a heat grid for "which
        // nights are filling up".
        await page.click('[data-rperiod="day"]');
        await expect(page.locator('#pos-res-calendar .pos-cal-grid')).toBeVisible();
        await page.click('[data-rperiod="month"]');
        await expect(page.locator('#pos-res-calendar .pos-cal-month')).toBeVisible();
        await expect(page.locator('#pos-res-calendar .pos-cal-mcell')).toHaveCount(42);

        await page.click('[data-rperiod="week"]');
        await page.click('[data-rlayout="list"]');
        await expect(page.locator('#pos-res-list')).toBeVisible();
        await expect(page.locator('#pos-res-calendar')).toBeHidden();
    });

    test('the booking dialog refuses a table that is already booked at that time', async ({ page }) => {
        await openTill(page);
        await openFloor(page);
        await seedFloor(page, [booking({
            starts_at: { toDate: () => new Date(Date.now() + 3 * 60 * 60000) }
        })]);

        await page.click('#nav-container [data-view="reservations"]');
        await page.click('#pos-res-new');
        const dialog = page.locator('#pos-res-modal');
        await expect(dialog).toBeVisible();

        // Set the new booking to the same moment as the seeded one. The table
        // list is REBUILT on every time change, because which tables are takeable
        // is a question about a moment — a list computed once would be answering
        // about whatever time the dialog happened to open with.
        //
        // Only the TIME needs setting: the dialog opens on today, and the seeded
        // booking is three hours from now.
        const time = await page.evaluate(() => {
            const d = new Date(Date.now() + 3 * 60 * 60000);
            const p = (n) => String(n).padStart(2, '0');
            return `${p(d.getHours())}:${p(d.getMinutes())}`;
        });
        await dialog.locator('#pos-res-time').fill(time);
        await dialog.locator('#pos-res-time').dispatchEvent('change');

        await expect(dialog.locator('#pos-res-table option', { hasText: 'A04' })).toBeDisabled();
        await expect(dialog.locator('#pos-res-table option', { hasText: 'A05' })).toBeEnabled();
        // Category first, then the table, then the seats — and a bare leading
        // number is what this replaced. "1 · Floor 2 · 1 seats" read as a row
        // index above an "Assign later" row, so the list looked numbered rather
        // than named.
        await expect(dialog.locator('#pos-res-table option', { hasText: 'A05' }))
            .toContainText(/Table A05 · 2 seats/);
        // Assign later is always available: taking the booking matters more than
        // deciding the seat, and a host on the phone should never be blocked on
        // a choice they can make afterwards.
        await expect(dialog.locator('#pos-res-table option', { hasText: 'Assign later' })).toBeEnabled();
    });

    // ── The date control is the shared one ──────────────────────────────────
    // PROJECT_BACKGROUND §5: "Reuse this shared picker for every dashboard
    // calendar/date picker, including single-date entry fields; never create
    // page-local calendar components or native date inputs." The first cut of
    // this dialog used `<input type="datetime-local">`, which popped the
    // BROWSER's calendar — the one control on the till that did not look like
    // FluxyOS, and a rule that a linter cannot catch.
    test('the date field is the shared picker, not a native date input', async ({ page }) => {
        await openTill(page);
        await page.click('#nav-container [data-view="reservations"]');
        await page.click('#pos-res-new');
        const dialog = page.locator('#pos-res-modal');
        await expect(dialog).toBeVisible();

        await expect(dialog.locator('input[type="date"], input[type="datetime-local"]')).toHaveCount(0);
        const trigger = dialog.locator('#pos-res-datefield [data-drp-trigger]');
        await expect(trigger).toBeVisible();

        await trigger.click();
        // The panel is re-parented to <body> by the picker itself — which is what
        // keeps it out of the modal's transform containing block, where a fixed
        // element would be clipped by the body's own overflow.
        const panel = page.locator('[data-drp-panel]:not(.hidden)');
        await expect(panel).toBeVisible();

        // A booking is in the future, so yesterday is not offerable. The shared
        // component defaults `maxDate` to TODAY — right for a finance range and
        // useless here — so both bounds are passed explicitly.
        const bounds = await page.evaluate(() => {
            const p = (n) => String(n).padStart(2, '0');
            const key = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
            return {
                yesterday: key(new Date(Date.now() - 86400000)),
                nextWeek: key(new Date(Date.now() + 7 * 86400000))
            };
        });
        await expect(page.locator(`[data-drp-day="${bounds.yesterday}"]`)).toBeDisabled();
        await expect(page.locator(`[data-drp-day="${bounds.nextWeek}"]`)).toBeEnabled();

        // Closing the dialog takes the panel with it. It lives on <body>, so
        // without an explicit teardown it would be left floating over the board
        // with nothing left on screen able to close it.
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-drp-panel]')).toHaveCount(0);
    });

    test('a booking cannot be saved without the two things it cannot work without', async ({ page }) => {
        await openTill(page);
        await page.click('#nav-container [data-view="reservations"]');
        await page.click('#pos-res-new');
        const dialog = page.locator('#pos-res-modal');
        await expect(dialog).toBeVisible();

        await dialog.locator('#pos-res-name').fill('');
        await dialog.locator('#pos-res-submit').click();
        await expect(dialog.locator('#pos-res-error')).toContainText(/guest name/i);

        await dialog.locator('#pos-res-name').fill('Pak Budi');
        await dialog.locator('#pos-res-party').fill('');
        await dialog.locator('#pos-res-submit').click();
        await expect(dialog.locator('#pos-res-error')).toContainText(/guests/i);
    });

    // ── The rule about not inventing a number ───────────────────────────────
    // The reference design this board was built to shows a "table utilization
    // %". It is not here, and that is deliberate: utilisation needs a service
    // window and a turn count this product does not model, so the figure would
    // be plausible and wrong — the failure mode this codebase guards hardest
    // against. "Tables held now" is the true version of the same question.
    test('the metric strip states what is measured, and does not invent utilisation', async ({ page }) => {
        await openTill(page);
        await page.click('#nav-container [data-view="reservations"]');
        const strip = page.locator('#pos-res-metrics');
        await expect(strip.locator('.pos-metric')).toHaveCount(4);
        await expect(strip).toContainText('Tables held now');
        await expect(strip).not.toContainText(/utilisation|utilization/i);
        // No fabricated money and no NaN, ever — on any surface.
        await expect(strip).not.toContainText(/NaN|Infinity/);
    });
});
