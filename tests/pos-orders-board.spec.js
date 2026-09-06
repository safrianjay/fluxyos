const { test, expect } = require('@playwright/test');

// =============================================================================
// The Orders board as a KITCHEN screen, not just a cashier's list.
//
// THE CLOCK IS THE FEATURE. The board's rule is "prioritise what needs
// attention next, not what happened last", and every claim below exists because
// the obvious implementation gets that wrong in a way nobody would notice:
//
//  · `updated_at` looks like a waiting clock and is not. Every write bumps it,
//    so adding one drink to a table that had waited 40 minutes would reset its
//    timer to zero — the order most in need of attention drops to the BOTTOM of
//    a longest-waiting sort. Hence `status_changed_at`, stamped only on a real
//    transition (rules deploy 2026-09-01).
//  · Raw minutes cannot rank across statuses. Cooking legitimately takes longer
//    than sending, so sorting by minutes floats every dish above a bill the
//    customer asked for and is sitting with. Urgency is minutes ÷ that status's
//    OWN late threshold.
//  · A paid order is waiting on nobody and must never outrank a live one.
//
// Ages are INJECTED rather than waited for: proving the 18-minute threshold by
// waiting 18 minutes is not a test anyone will run twice.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

async function openBoard(page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await page.click('#nav-container [data-view="orders"]');
    await expect(page.locator('.pos-view[data-view="orders"]')).toBeVisible();
    await page.waitForTimeout(1200);
}

// Replaces the board's data with orders of KNOWN age, then repaints. Nothing is
// written to Firestore — this is about the rendering rule, and manufacturing
// real 20-minute-old orders would mean writing junk to a live workspace.
async function seedBoard(page, orders) {
    return await page.evaluate((rows) => {
        // Captured ONCE, with a few seconds of slack.
        //
        // A lazy `() => new Date(Date.now() - ms)` re-reads the clock on every
        // call, so by the time the renderer asked, the order was a few
        // milliseconds YOUNGER than seeded — and `Math.floor` turned a 9-minute
        // fixture into "8m" perhaps one run in three. The slack keeps the figure
        // clear of the minute boundary; it is far smaller than any threshold.
        const ts = (ms) => { const d = new Date(Date.now() - ms - 3000); return { toDate: () => d }; };
        const mk = (o, i) => ({
            id: `seed-${i}`,
            order_number: `20260901-9${i}`,
            status: o.status,
            // DERIVED FROM THE LABEL, not a constant. It was `'t1'` for every
            // seeded order, so the whole board sat at one table — which was
            // invisible until the till started grouping a table's tickets into
            // one bill, and then every fixture claimed to be one party.
            table_id: o.table ? `t${o.table}` : null,
            table_label: o.table || null,
            lines: [{ line_id: 'l1', item_name: 'Seeded dish', quantity: 1, unit_price: 20000, gross_amount: 20000 }],
            total_amount: o.total || 20000,
            paid_amount: o.status === 'paid' ? (o.total || 20000) : 0,
            opened_at: ts(o.ageMin * 60000),
            status_changed_at: ts(o.ageMin * 60000)
        });
        return window.__posSeedBoard(rows.map(mk));
    }, orders);
}

test('the board shows one tab per real order status', async ({ page }) => {
    await openBoard(page);
    const tabs = await page.locator('[data-otab]').evaluateAll((els) => els.map((e) => ({
        key: e.dataset.otab, label: e.textContent.replace(/\d+$/, '').trim()
    })));
    expect(tabs.map((t) => t.key)).toEqual(['all', 'process', 'kitchen', 'ready', 'served', 'bill', 'done']);
    // Ladder order, so the row reads the way service actually flows.
    expect(tabs.map((t) => t.label).join(' | '))
        .toMatch(/All \| In Process \| Process to Kitchen \| Ready \| Served \| Request Bill \| Completed/i);
});

test('waiting time escalates on each status own threshold', async ({ page }) => {
    await openBoard(page);
    // Same 9 minutes, three statuses, three verdicts. This is the whole argument
    // for per-status thresholds: 9 minutes of cooking is fine, 9 minutes holding
    // a requested bill is not.
    const rows = await seedBoard(page, [
        { status: 'sent',             ageMin: 9 },   // warn at 10 → still ok
        { status: 'awaiting_payment', ageMin: 9 },   // late at 8  → late
        { status: 'open',             ageMin: 9 }    // late at 6  → late
    ]);
    const by = (s) => rows.find((r) => r.status === s);

    expect(by('sent').level, '9 minutes of cooking is not late').toBe('ok');
    expect(by('awaiting_payment').level, 'a bill asked for 9 minutes ago is late').toBe('late');
    expect(by('open').level, 'an untaken order 9 minutes old is late').toBe('late');

    // Text carries the state, never colour alone — a service line is a bad place
    // to depend on hue, and DESIGN_SYSTEM bans colour-only status.
    expect(by('awaiting_payment').text).toMatch(/9m/);
    expect(by('awaiting_payment').text.toLowerCase()).toContain('late');
    expect(by('awaiting_payment').flagged, 'a late card must be findable without reading it').toBe(true);
});

test('longest waiting ranks by urgency, not by raw minutes', async ({ page }) => {
    await openBoard(page);
    // A pairing where raw minutes and real urgency disagree. The dish has waited
    // nearly twice as long in minutes and must still rank BELOW the bill,
    // because 12 minutes of cooking is well inside normal and 7 minutes holding
    // a bill the customer has already asked for is nearly out of time.
    const painted = await seedBoard(page, [
        { status: 'sent',             ageMin: 12 },  // 12/18 = 0.67
        { status: 'awaiting_payment', ageMin: 7 }    //  7/8  = 0.88  ← more urgent
    ]);
    expect(painted.map((p) => p.status)[0],
        'a bill the customer asked for 7 minutes ago outranks a 12-minute dish').toBe('awaiting_payment');
});

// ── Service type is scannable, not readable ────────────────────────────────
// The kitchen sorts by service type before it reads anything else: a bag that
// leaves the pass is a different job from a plate that goes to a table. When
// every badge was the same navy, telling them apart meant READING two letters
// down a column of cards, which is the thing a badge exists to avoid.
test('a takeaway badge is a different colour from a table badge', async ({ page }) => {
    await openBoard(page);
    await seedBoard(page, [
        { status: 'sent', ageMin: 2, table: 'A04' },
        { status: 'sent', ageMin: 3 }                   // no table → takeaway
    ]);

    const badges = await page.evaluate(() => [...document.querySelectorAll('.pos-otag')].map((el) => ({
        text: el.textContent.trim(),
        takeaway: el.classList.contains('is-takeaway'),
        bg: getComputedStyle(el).backgroundColor
    })));

    const ta = badges.find((b) => b.text === 'TA');
    const table = badges.find((b) => b.text === 'A04');
    expect(ta, 'the takeaway card rendered').toBeTruthy();
    expect(table, 'the table card rendered').toBeTruthy();
    expect(ta.takeaway).toBe(true);
    expect(table.takeaway).toBe(false);
    expect(ta.bg, 'takeaway and dine-in must not share a colour').not.toBe(table.bg);

    // Colour is never the ONLY signal. The badge still carries the text, so the
    // distinction survives a monochrome kitchen printer, sunlight on a pass, and
    // dichromacy — the same rule the floor plan's reserved state follows.
    expect(ta.text).toBe('TA');
    expect(table.text).toBe('A04');
});

test('a paid order never outranks a live one', async ({ page }) => {
    await openBoard(page);
    const rows = await seedBoard(page, [
        { status: 'paid', ageMin: 0 },   // newest by far
        { status: 'sent', ageMin: 2 }
    ]);
    expect(rows.map((r) => r.status)[0], 'a settled bill is not competing for anyone attention').toBe('sent');
    expect(rows.find((r) => r.status === 'paid').level,
        'a paid order is waiting on nobody and must carry no clock').toBeNull();
});

test('the Completed tab reads newest first, not longest settled', async ({ page }) => {
    // A regression the refund spec caught before this one existed. Under
    // "longest waiting" two settled orders fell through to the urgency
    // comparator's raw-elapsed tiebreak, which sorted the Completed tab OLDEST
    // first — so reopening "the sale I just rang up" reached for an order from
    // hours ago. Nobody is waiting on a paid bill; the only useful order for
    // settled sales is most-recent.
    await openBoard(page);
    const rows = await seedBoard(page, [
        { status: 'paid', ageMin: 90 },
        { status: 'paid', ageMin: 3 }
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.level === null), 'a settled order carries no clock').toBe(true);
    const ages = await page.locator('.pos-ocard-when').allInnerTexts();
    const times = ages.map((t) => t.trim()).filter(Boolean);
    // The newest is first: its timestamp is later in the day than the other's.
    expect(times.length).toBe(2);
    const mins = times.map((t) => {
        const m = t.match(/(\d{1,2})[.:](\d{2})/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    });
    expect(mins[0], 'the Completed tab is sorted oldest-first').toBeGreaterThan(mins[1]);
});

test('the filter panel is the dashboard component, and sorts what it says', async ({ page }) => {
    await openBoard(page);
    const SEED = [
        { status: 'sent', ageMin: 30 },
        { status: 'sent', ageMin: 2 }
    ];

    // Default is longest-waiting: the 30-minute order leads.
    let painted = await seedBoard(page, SEED);
    expect(painted[0].text, 'the default sort is not longest-waiting').toMatch(/30m/);

    await page.click('#pos-orders-filter');
    const panel = page.locator('#pos-filter-panel');
    await expect(panel, 'the trigger must open the shared filter panel').toBeVisible();
    // The same component the Ledger uses — not a POS lookalike.
    await expect(panel).toHaveClass(/fluxy-filter-panel/);
    await expect(page.locator('#pos-filter-rail .fluxy-filter-rail-item')).toHaveCount(3);

    // It must not reach back under the navigation. The till has a fixed sidebar
    // the Ledger does not, so right-aligning a 520px panel to a trigger
    // two-thirds across the board put it on top of the nav — it read as a panel
    // floating over the menu rather than belonging to the button.
    const geom = await page.evaluate(() => {
        const p = document.getElementById('pos-filter-panel').getBoundingClientRect();
        const sb = document.getElementById('sidebar').getBoundingClientRect();
        return { overlapsSidebar: p.left < sb.right, inViewport: p.right <= innerWidth && p.bottom <= innerHeight };
    });
    expect(geom.overlapsSidebar, 'the filter panel is covering the sidebar').toBe(false);
    expect(geom.inViewport, 'the filter panel is off-screen').toBe(true);

    // Switch to newest-first, then re-seed and read in one step so the live
    // watcher cannot repaint between the two.
    await page.locator('#pos-filter-options [data-value="newest"]').click();
    await page.click('#pos-filter-apply');
    await expect(panel).toBeHidden();
    painted = await seedBoard(page, SEED);
    expect(painted[0].text, 'newest-first did not re-sort the board').toMatch(/2m|just now/);

    // And the trigger says a non-default filter is in force, so nobody wonders
    // why the board is not in its usual order.
    await expect(page.locator('#pos-filter-count')).not.toHaveClass(/hidden/);
});

test('every card names the next step, and never a later one', async ({ page }) => {
    // The board's one instruction. It used to read "Pay Bills" on anything with
    // a total — including an order still being typed at the till — which names a
    // step three moves away and invites the cashier to skip the ones between.
    // On a till that means a dish leaves the pass unrecorded.
    await openBoard(page);
    const rows = await seedBoard(page, [
        { status: 'open',             ageMin: 2 },
        { status: 'sent',             ageMin: 2 },
        { status: 'ready',            ageMin: 1 },
        { status: 'served',           ageMin: 2 },
        { status: 'awaiting_payment', ageMin: 2 },
        { status: 'paid',             ageMin: 2 }
    ]);
    expect(rows).toHaveLength(6);

    // Read from the seed's own return — a second round-trip would race the live
    // watcher and assert against the real board.
    const ctas = rows.map((r) => ({ status: r.status, buttons: r.actions }));
    const by = (s) => ctas.find((c) => c.status === s);

    expect(by('open').buttons).toEqual(['Process to Kitchen']);
    // Two beats through the kitchen: the cook finishes, the runner carries.
    expect(by('sent').buttons).toEqual(['Mark as Ready']);
    expect(by('ready').buttons).toEqual(['Serve']);
    expect(by('served').buttons).toEqual(['Request Bill']);
    expect(by('awaiting_payment').buttons).toEqual(['Pay Bill']);
    // Settled: the only thing left to do with it is print. Never a step.
    expect(by('paid').buttons).toEqual(['Print receipt']);

    // Exactly ONE action per card — the card is the detail view now, so a second
    // button would be a choice where the brief asks for an instruction.
    ctas.forEach((c) => expect(c.buttons.length, `${c.status} has ${c.buttons.length} actions`).toBe(1));

    // And "Pay Bill" appears on nothing that is still being worked.
    ['open', 'sent', 'ready', 'served'].forEach((st) => {
        expect(by(st).buttons.join(' '), `${st} offers payment out of turn`).not.toMatch(/pay bill/i);
    });
});

test('the board takes the whole width once the panel is gone', async ({ page }) => {
    // The order panel was a second copy of what the card already shows, costing
    // the board ~380px to duplicate it.
    await openBoard(page);
    const geom = await page.evaluate(() => {
        const panel = document.getElementById('pos-order-panel');
        const grid = document.getElementById('pos-orders-grid');
        return {
            panelHidden: getComputedStyle(panel).display === 'none',
            columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length
        };
    });
    expect(geom.panelHidden, 'the Orders board is still paying for the order panel').toBe(true);
    expect(geom.columns, 'the board did not use the space the panel gave back').toBeGreaterThanOrEqual(3);
});

test('an abandoned cart is stale, not late', async ({ page }) => {
    // Measured on the real till: open carts from the previous day rendered
    // "23h 1m LATE" beside a dish genuinely six minutes over, and the two were
    // indistinguishable. A board where everything shouts says nothing — and the
    // day-old order also OWNED the top of a longest-waiting sort, burying the
    // one that mattered.
    await openBoard(page);
    // ⚠️ THE DATE FILTER IS SWITCHED OFF FIRST, and that is not tidiness.
    //
    // The fixture is 3h20m old, chosen to clear STALE_MINS while staying inside
    // the board's default Today window. "Today" starts at local midnight, so
    // between 00:00 and 03:20 the cart lands YESTERDAY and is filtered out
    // before the staleness rule is ever reached — this test failed every night
    // for a three-hour window and passed every morning, which reads as flake
    // rather than as a clock. Found at 03:08 WIB on 2026-09-06.
    //
    // Nothing here is about the date window, so it is removed rather than
    // worked around with an age that no wall-clock can make safe: at 00:05 even
    // a ten-minute-old order is yesterday.
    await page.click('#pos-orders-filter');
    await page.locator('#pos-filter-rail [data-group="orderDate"]').click();
    await page.locator('#pos-filter-options [data-value="all"]').click();
    await page.click('#pos-filter-apply');
    await expect(page.locator('#pos-filter-panel')).toBeHidden();

    const rows = await seedBoard(page, [
        { status: 'open', ageMin: 200 },       // long abandoned
        { status: 'sent', ageMin: 20 }         // genuinely late in the kitchen
    ]);
    const stale = rows.find((r) => /stale/.test(r.text || ''));
    expect(stale, 'a day-old cart is still being called late').toBeTruthy();
    expect(stale.flagged, 'a stale cart must not carry the late flag').toBe(false);

    // The live one ranks first, despite being 75x younger.
    expect(rows[0].status, 'an abandoned cart outranked a dish that is actually late').toBe('sent');
    expect(rows[0].level).toBe('late');
});

test('cash payment: change, a floor on the tender, and locale-correct quick amounts', async ({ page }) => {
    // The arithmetic a cashier is judged on. Change is what leaves the drawer, so
    // it is the one figure on this screen that costs real money when wrong.
    await openBoard(page);
    await seedBoard(page, [{ status: 'awaiting_payment', ageMin: 5, total: 22500 }]);
    await page.locator('.pos-ocard[data-status="awaiting_payment"] [data-pay]').first().click();
    const modal = page.locator('#pos-pay-modal .pos-modal');
    await expect(modal, 'payment must be a popup, not a page or a side drawer').toBeVisible({ timeout: 10000 });
    // The dashboard's overlay, not a POS one — blurred scrim included.
    await expect(page.locator('#pos-pay-modal .pos-modal-backdrop')).toBeVisible();

    await expect(page.locator('#pos-pay-due')).toHaveText(/22\.500/);

    // Quick amounts come from the CURRENCY's own banknotes, via the money seam.
    // A fixed [25000, 50000, 100000] is right in Jakarta and absurd in Singapore.
    const quick = await page.locator('#pos-quick .pos-quick-btn').allInnerTexts();
    expect(quick[0]).toMatch(/exact|uang pas/i);
    expect(quick.join(' ')).toMatch(/25\.000/);
    expect(quick.join(' ')).toMatch(/50\.000/);

    // Tender more than the bill → change, highlighted.
    await page.locator('#pos-quick [data-cash="50000"]').click();
    await expect(page.locator('#pos-change')).toBeVisible();
    await expect(page.locator('#pos-change-value'), 'change is wrong').toHaveText(/27\.500/);

    // Tender LESS → refused outright. This floor does not take split tender, so
    // a short amount is a miscount, and the useful thing is to refuse it while
    // the customer is still standing there rather than leave a half-paid order
    // behind. The DAL still accepts partial amounts; this is a till rule.
    await page.fill('#pos-pay-amount', '');
    await page.locator('#pos-pay-amount').type('10000');
    await expect(page.locator('#pos-pay-submit'),
        'a tender below the bill was accepted').toBeDisabled();
    // …and it says WHY. A dead button with no explanation is the worst of both.
    await expect(page.locator('#pos-short')).toBeVisible();
    await expect(page.locator('#pos-short')).toContainText(/short/i);

    // Nothing entered at all is not a payment.
    await page.fill('#pos-pay-amount', '');
    await expect(page.locator('#pos-pay-submit')).toBeDisabled();

    // The close BUTTON, not `[data-close]` — that also matches the backdrop,
    // which sits behind the dialog and cannot receive the click.
    await page.locator('#pos-pay-modal .pos-modal-close').click();
    await expect(page.locator('#pos-pay-modal')).toHaveCount(0);
});

// ── Amount received belongs to CASH, and only to cash ──────────────────────
//
// The cashier counts notes out of a drawer. Nobody counts a card, nobody
// overpays a QRIS, and nobody hands change back for a bank transfer — so on
// every method but cash the field states the bill and is not theirs to type.
//
// The interesting one is Bank transfer. It SETTLES to the same account as cash
// (both land in 1000), and reading `settlement` for "is this cash" is what made
// it behave as cash here — and, more expensively, made the shift tally count
// transfers as notes that ought to be in the drawer.
test('amount received is editable for cash only, and change is always stated', async ({ page }) => {
    await openBoard(page);
    await seedBoard(page, [{ status: 'awaiting_payment', ageMin: 5, total: 120000 }]);
    await page.locator('.pos-ocard[data-status="awaiting_payment"] [data-pay]').first().click();
    await expect(page.locator('#pos-pay-modal .pos-modal')).toBeVisible({ timeout: 10000 });

    const amount = page.locator('#pos-pay-amount');
    const change = page.locator('#pos-change');

    // ── CASH ────────────────────────────────────────────────────────────────
    await expect(amount).toBeEnabled();
    await expect(page.locator('#pos-quick')).toBeVisible();

    // Equal to the bill → change is STATED as zero, not hidden. A missing row
    // and "the screen has not caught up with what I typed" look identical, and
    // this is the moment a customer is standing there waiting to be told.
    await page.locator('#pos-quick [data-cash="120000"]').click();
    await expect(change).toBeVisible();
    await expect(page.locator('#pos-change-value')).toHaveText(/^Rp0$/);
    await expect(change).toHaveClass(/is-zero/);
    // …and it says so in WORDS. A bare 0 in a result panel is indistinguishable
    // from a panel nothing has been written into — which is how a correctly
    // calculated exact payment came to be reported as "the change is not
    // calculated".
    await expect(page.locator('#pos-change-note')).toBeVisible();
    await expect(page.locator('#pos-change-note')).toContainText(/exact amount|uang pas/i);

    // The currency mark and the digits are ONE amount: same size, same weight,
    // no gap. They rendered at 20px and 14px, because `.pos-field input` (0,1,1)
    // outranks `.pos-amount-input` (0,1,0) — so the number a cashier is judged
    // on was the smallest money on the screen and the field looked broken.
    const type = await page.evaluate(() => {
        const g = (s) => { const c = getComputedStyle(document.querySelector(s));
            return `${c.fontSize}/${c.fontWeight}`; };
        return { cur: g('.pos-amount-cur'), digits: g('#pos-pay-amount'),
                 align: getComputedStyle(document.querySelector('#pos-pay-amount')).textAlign };
    });
    expect(type.digits, 'the amount and its currency mark must match').toBe(type.cur);
    expect(type.align, 'the amount reads from the left, like every other input').toBe('left');
    await expect(page.locator('#pos-pay-submit')).toBeEnabled();

    // More than the bill → change, immediately, without leaving the field.
    await amount.fill('');
    await amount.type('150000');
    await expect(page.locator('#pos-change-value')).toHaveText(/30\.000/);
    await expect(change).not.toHaveClass(/is-zero/);
    await expect(page.locator('#pos-change-note')).toBeHidden();
    await expect(page.locator('#pos-pay-submit')).toBeEnabled();

    // Less than the bill → insufficient, and the payment cannot be completed.
    await amount.fill('');
    await amount.type('100000');
    await expect(page.locator('#pos-short')).toBeVisible();
    await expect(page.locator('#pos-short')).toContainText(/20\.000 short/);
    await expect(page.locator('#pos-pay-submit')).toBeDisabled();
    // No change row beside a shortfall: "Rp0 to give back" is true and useless.
    await expect(change).toBeHidden();

    // ── EVERY OTHER METHOD ──────────────────────────────────────────────────
    for (const m of ['card', 'qris', 'transfer', 'other']) {
        await page.locator(`#pos-method-row [data-method="${m}"]`).click();
        await expect(amount, `${m}: the cashier must not enter a received amount`).toBeDisabled();
        await expect(change, `${m}: a card has no change to give`).toBeHidden();
        await expect(page.locator('#pos-quick'), `${m}: quick notes are meaningless`).toBeHidden();
        await expect(page.locator('#pos-amount-note')).toBeVisible();
        // The field still STATES the bill — it is what is about to be charged.
        await expect(amount).toHaveValue(/120\.000/);
        await expect(page.locator('#pos-pay-submit'), `${m} must be payable`).toBeEnabled();
    }

    // …and back to cash restores the field. A method toggle is not a one-way door.
    await page.locator('#pos-method-row [data-method="cash"]').click();
    await expect(amount).toBeEnabled();
    await expect(page.locator('#pos-quick')).toBeVisible();

    await page.locator('#pos-pay-modal .pos-modal-close').click();
});

// ── The fraud path, closed even when the field IS editable ─────────────────
//
// Disabling the input is a UI affordance, and a UI affordance is one bug away
// from not being there. An editable "amount received" on a card payment is a
// fraud surface — type a bigger figure, pocket the difference as change, and
// the drawer still reconciles — so the guarantee must not rest on one
// assignment having run at the right moment.
//
// This test FORCES the field back on, exactly as a missed `sync()` would, and
// proves the value cannot be moved anyway.
test('a non-cash amount cannot be typed even if the field is re-enabled', async ({ page }) => {
    await openBoard(page);
    await seedBoard(page, [{ status: 'awaiting_payment', ageMin: 3, total: 120000 }]);
    await page.locator('.pos-ocard[data-status="awaiting_payment"] [data-pay]').first().click();
    await expect(page.locator('#pos-pay-amount')).toBeVisible({ timeout: 10000 });

    await page.locator('#pos-method-row [data-method="card"]').click();
    await expect(page.locator('#pos-pay-amount')).toBeDisabled();

    // Simulate the bug being reported: the field is editable on a card payment.
    await page.evaluate(() => {
        const el = document.getElementById('pos-pay-amount');
        el.disabled = false;
        el.readOnly = false;
    });
    await expect(page.locator('#pos-pay-amount')).toBeEnabled();

    // Type a fraudulent figure. Every keystroke is discarded and the bill is
    // restored, so the tender can never differ from what is being charged.
    await page.locator('#pos-pay-amount').type('999000');
    await expect(page.locator('#pos-pay-amount'),
        'a typed amount survived on a card payment — this is the fraud surface')
        .toHaveValue(/^120\.000$/);
    // And no change was invented out of it.
    await expect(page.locator('#pos-change')).toBeHidden();

    await page.locator('#pos-pay-modal .pos-modal-close').click();
});

// ── The mixed-version case, which broke the drawer in silence ──────────────
//
// This page is three separate module requests — pos.js → db-service.js →
// pos-service.js — and a browser can revalidate one and not the others. `tender`
// lives in the last of them, so a version skew made `m.tender` undefined and
// EVERY method read as non-cash: the amount field came up disabled on CASH,
// pinned to the exact bill, and the change could only ever be zero. Reported as
// "why is the change still 0", and correctly, because it always was.
//
// The id is the stable fact and is now what the till keys on. This serves a
// pre-`tender` pos-service.js to prove the skew is harmless.
test('a pos-service.js without `tender` still takes cash correctly', async ({ page }) => {
    await page.route('**/assets/js/pos-service.js', async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replace(/, tender: '(cash|external)'/g, '');
        await route.fulfill({ response: res, body,
            headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });

    await openBoard(page);
    await seedBoard(page, [{ status: 'awaiting_payment', ageMin: 3, total: 120000 }]);
    await page.locator('.pos-ocard[data-status="awaiting_payment"] [data-pay]').first().click();
    await expect(page.locator('#pos-pay-amount')).toBeVisible({ timeout: 10000 });

    // Cash is still cash, still typeable, and the change is still arithmetic.
    await expect(page.locator('#pos-pay-amount')).toBeEnabled();
    await page.fill('#pos-pay-amount', '');
    await page.locator('#pos-pay-amount').type('150000');
    await expect(page.locator('#pos-change-value')).toHaveText(/30\.000/);

    // And a card is still not cash — the id says so without `tender`.
    await page.locator('#pos-method-row [data-method="card"]').click();
    await expect(page.locator('#pos-pay-amount')).toBeDisabled();

    await page.locator('#pos-pay-modal .pos-modal-close').click();
});

test('opening a card still reaches the actions the board does not carry', async ({ page }) => {
    // Hiding the order panel on this view nearly orphaned Refund and Reprint:
    // they live in that panel and nowhere else, so selecting a card without
    // switching view left a paid order with no way back to them — the exact
    // dead end tests/pos-ui.spec.js was written to prevent, re-created by
    // removing the panel. The card's own CTA is the next STEP; opening the card
    // is how you reach everything else.
    await openBoard(page);
    await seedBoard(page, [{ status: 'served', ageMin: 3 }]);

    // Pressing the CTA must NOT navigate — it acts in place, on the board.
    await page.locator('.pos-ocard [data-advance]').first().click({ trial: true });

    // Clicking the card body does navigate, to the till with the order loaded.
    await page.locator('.pos-ocard .pos-ocard-items').first().click();
    await expect(page.locator('.pos-view[data-view="till"]'),
        'opening a card left the cashier with no route to the order panel').toBeVisible({ timeout: 10000 });
    await expect(page.locator('#pos-order-panel')).toBeVisible();
});


// =============================================================================
// ONE TABLE, ONE BILL — at the till.
//
// The diner's phone has consolidated a table's tickets since 2026-09-06. The
// BOARD did not: two rounds at one table were two cards, two totals and two Pay
// buttons, and the cashier added them up in their head. That is an
// under-collection shape — settle the 30.000 ticket, miss the 50.000 one, and
// both documents stay individually correct while the money is short.
//
// Merge and split are ONE control here, deliberately: the dialog lists every
// live ticket with a checkbox. All ticked is a merged bill; unticking one splits
// it and says, in words, what stays open.
// =============================================================================

/** Two live tickets at table 6, one served and one still in the kitchen. */
async function seedSplitTable(page) {
    await seedBoard(page, [
        { status: 'served', table: '6', total: 50000, ageMin: 30 },
        { status: 'sent',   table: '6', total: 30000, ageMin: 5 },
        // A different table, so the strip is proven to be per-table rather than
        // "the board has more than one order".
        { status: 'served', table: '9', total: 25000, ageMin: 12 }
    ]);
}

test('a table with two tickets offers ONE bill across them', async ({ page }) => {
    await openBoard(page);
    await seedSplitTable(page);

    // Both table-6 cards carry the strip; the lone table-9 card does not — on a
    // single ticket it would restate the total directly above it.
    const strips = page.locator('.pos-ocard-bill');
    await expect(strips).toHaveCount(2);
    await expect(strips.first()).toContainText('2 tickets');
    await expect(strips.first()).toContainText('80.000');

    // ⚠️ THE FIGURE IS THE TABLE'S, NOT THE CARD'S. A strip quoting the card it
    // sits on would be the exact under-collection the feature exists to stop.
    const cardTotals = await page.locator('.pos-ocard-total').allInnerTexts();
    expect(cardTotals.some((t) => /50\.000/.test(t)), 'the 50.000 ticket is still its own card').toBe(true);
    expect(cardTotals.some((t) => /30\.000/.test(t)), 'so is the 30.000 one').toBe(true);
});

test('THE BILL DIALOG MERGES BY DEFAULT AND SPLITS ON DEMAND', async ({ page }) => {
    await openBoard(page);
    await seedSplitTable(page);

    await page.locator('[data-table-bill]').first().click();
    const modal = page.locator('#pos-bill-modal');
    await expect(modal).toBeVisible();

    // Everything ticked: settling the table is the common case, and a dialog
    // that opens with nothing chosen makes the cashier do the work twice.
    const boxes = modal.locator('[data-ticket]');
    await expect(boxes).toHaveCount(2);
    expect(await boxes.nth(0).isChecked()).toBe(true);
    expect(await boxes.nth(1).isChecked()).toBe(true);
    await expect(modal.locator('#pos-bill-total')).toContainText('80.000');
    // Nothing is being left behind, so nothing claims to be.
    await expect(modal.locator('#pos-bill-rest')).toBeHidden();

    // Unticking one IS the split. The total drops and — the part that matters —
    // the dialog says what stays open, because a split bill that silently
    // leaves a ticket behind is how a table walks out owing money.
    await boxes.nth(1).uncheck();
    await expect(modal.locator('#pos-bill-total')).toContainText('50.000');
    await expect(modal.locator('#pos-bill-rest')).toBeVisible();
    await expect(modal.locator('#pos-bill-rest')).toContainText('30.000');
    await expect(modal.locator('#pos-bill-rest')).toContainText('stay open');

    // Nothing selected is not a bill.
    await boxes.nth(0).uncheck();
    await expect(modal.locator('#pos-bill-pay')).toBeDisabled();
    await boxes.nth(0).check();
    await expect(modal.locator('#pos-bill-pay')).toBeEnabled();
});

test('the payment dialog charges the BILL, not the ticket it was opened from', async ({ page }) => {
    await openBoard(page);
    await seedSplitTable(page);

    await page.locator('[data-table-bill]').first().click();
    await page.locator('#pos-bill-pay').click();

    const pay = page.locator('#pos-pay-modal');
    await expect(pay).toBeVisible();
    // The whole point, stated as an assertion: Rp80.000, never Rp50.000.
    await expect(pay.locator('#pos-pay-due')).toContainText('80.000');
    await expect(pay.locator('#pos-pay-due')).not.toContainText('50.000');
    // And it says what it is settling, so the cashier is not guessing which
    // number is on screen.
    await expect(pay.locator('.pos-modal-sub')).toContainText('2 tickets');
    await expect(pay.locator('.pos-modal-sub')).toContainText('Table 6');

    // Change is computed against the BILL. Against one ticket it would offer
    // 50.000 back on a 100.000 note and the drawer would be 30.000 short.
    await pay.locator('#pos-pay-amount').fill('100.000');
    await expect(pay.locator('#pos-change-value')).toContainText('20.000');
});

// ── Reprinting what was actually paid ───────────────────────────────────────
//
// ⚠️ A MERGED BILL REPRINTED AS ONE TICKET UNDERSTATES WHAT WAS SETTLED, and it
// is handed to the person least able to check it and most likely to be
// disputing it. `payPosTableBill` writes the sibling ids onto the payment for
// exactly this: Firestore cannot query inside an array of maps, so a bare
// `bill_id` would be a grouping key nothing could ever group by.

/** Two PAID tickets at table 6, settled together as one Rp80.000 bill. */
async function seedPaidBill(page) {
    return page.evaluate(() => {
        const ts = (ms) => { const d = new Date(Date.now() - ms); return { toDate: () => d }; };
        const mk = (id, no, amount, ageMin) => ({
            id, order_number: no, status: 'paid',
            table_id: 't6', table_label: '6', dimension_id: 'd1',
            lines: [
                { line_id: `l-${id}`, item_id: `i-${no}`, item_name: `Dish ${no}`,
                    quantity: 1, unit_price: amount - 10000, gross_amount: amount - 10000 },
                // The SAME item on both tickets — two rounds that each had a
                // Nasi. On the bill that is one line of two, not two lines of
                // one.
                { line_id: `n-${id}`, item_id: 'i-nasi', item_name: 'Nasi',
                    quantity: 1, unit_price: 10000, gross_amount: 10000 }
            ],
            subtotal: amount, discount_total: 0, service_charge_amount: 0, tax_amount: 0,
            total_amount: amount, paid_amount: amount,
            pos_pricing: { tax_enabled: false, tax_inclusive: false, tax_label: 'PPN' },
            payments: [{
                payment_id: `p-${id}`, method: 'cash', tender: 'cash', status: 'settled',
                amount, amount_received: id === 'seed-b2' ? amount + 20000 : amount,
                change_given: id === 'seed-b2' ? 20000 : 0,
                bill_id: 'bill-1', bill_orders: ['seed-b1', 'seed-b2']
            }],
            opened_at: ts(ageMin * 60000), status_changed_at: ts(ageMin * 60000),
            paid_at: ts(60000)
        });
        return window.__posSeedBoard([mk('seed-b1', '001', 50000, 40), mk('seed-b2', '002', 30000, 10)]);
    });
}

test('a merged bill REPRINTS AS THE BILL, not as one ticket', async ({ page }) => {
    await openBoard(page);
    const rows = await seedPaidBill(page);

    // The button says what will come out of the printer. A cashier expecting one
    // slip and holding a two-ticket bill has been told something wrong by it.
    expect(rows.every((r) => r.actions.includes('Print bill')),
        'a ticket settled with others still offered "Print receipt"').toBe(true);

    const popup = page.waitForEvent('popup', { timeout: 30000 });
    await page.locator('[data-print]').first().click();
    const sheet = await popup;
    await sheet.waitForLoadState('domcontentloaded').catch(() => {});
    const text = (await sheet.locator('body').innerText()).replace(/\s+/g, ' ');
    await sheet.close();

    // BOTH tickets, and the grand total — printed from the older card, so this
    // also proves the reprint works from whichever ticket is tapped.
    // Both numbers in the HEADER — the lines are one bill, so this is the only
    // place the customer can see which kitchen tickets it covers.
    expect(text, 'the first ticket number is missing from the header').toContain('001 + 002');
    expect(text).toContain('Dish 001');
    expect(text).toContain('Dish 002');
    expect(text, 'the bill does not state what was actually paid').toContain('80.000');

    // ⚠️ ONE BILL, NOT TWO RECEIPTS STAPLED TOGETHER. The tickets are the
    // KITCHEN's unit of work and the customer never had them: a section per
    // ticket asks the person paying to do arithmetic about a split they did not
    // make. The order numbers in the header are the only place it belongs.
    expect((text.match(/Subtotal/g) || []).length, 'the bill has a subtotal per ticket').toBe(1);
    expect((text.match(/Total/g) || []).length, 'the bill has a total per ticket').toBe(1);
    // …and the same item from two rounds is one line of two.
    expect((text.match(/Nasi/g) || []).length, 'the same dish is listed twice').toBe(1);
    expect(text, 'the repeated dish did not add up').toContain('2 ×');
    // One tender, so ONE change figure. Folding payments that share a bill_id is
    // what stops an Rp80.000 cash bill printing two payment lines.
    expect((text.match(/Kembalian/g) || []).length, 'change is stated more than once').toBe(1);
});

// ── The floor plan tile promises the table, so the tap delivers it ──────────
test('TAPPING A TWO-TICKET TABLE OPENS THE TABLE, NOT ONE TICKET', async ({ page }) => {
    await openBoard(page);
    await seedSplitTable(page);
    // The floor keeps whatever orders the board was seeded with, so the two
    // seeds compose: tickets from one, tables from the other.
    await page.evaluate(() => window.__posSeedFloor([
        { id: 't6', label: '6', seats: 4, status: 'active', dimension_id: 'd1' },
        { id: 't9', label: '9', seats: 2, status: 'active', dimension_id: 'd1' }
    ], []));
    await page.click('#nav-container [data-view="tables"]');
    await expect(page.locator('.pos-view[data-view="tables"]')).toBeVisible();

    // The tile states the TABLE's outstanding and that it covers two tickets.
    const t6 = page.locator('.pos-table[data-table="t6"]');
    await expect(t6).toContainText('80.000');
    await expect(t6).toContainText('2 tickets');

    // ⚠️ AND THE TAP AGREES WITH IT. Before this, tapping a table reading
    // Rp80.000 opened one ticket's panel showing Rp50.000 — nothing errored, the
    // cashier was simply handed a smaller number than the tile they pressed.
    await t6.click();
    const modal = page.locator('#pos-bill-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#pos-bill-total')).toContainText('80.000');

    // Opening a ticket to add to it is the other errand a cashier has at a
    // table, so the dialog is not a dead end for it — and doing so must not
    // silently change what the bill covers on the way out.
    await modal.locator('[data-open-ticket]').first().click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.pos-view[data-view="till"]')).toBeVisible();

    // A table with ONE ticket still goes straight to the till, where the work is.
    await page.click('#nav-container [data-view="tables"]');
    await page.locator('.pos-table[data-table="t9"]').click();
    await expect(page.locator('#pos-bill-modal')).toHaveCount(0);
    await expect(page.locator('.pos-view[data-view="till"]')).toBeVisible();
});

// ── Payment status and order status are two different states ────────────────
//
// ⚠️ THEY WERE ONE FIELD. Paying wrote `paid` whatever the kitchen was doing,
// so settling a merged bill sent the ticket still in the pan to a terminal
// state: off the kitchen tab, and reading as done to the cook who still had to
// make it. Reported by Jay hours after the merged bill shipped.
//
//   Order status    New → Preparing → Ready → Served → Completed
//   Payment status  Unpaid → Paid
//
// Paying moves the second one only.

test('A PAID TICKET STILL IN THE KITCHEN KEEPS ITS OWN STATUS', async ({ page }) => {
    await openBoard(page);
    const rows = await page.evaluate(() => {
        const ts = (ms) => { const d = new Date(Date.now() - ms); return { toDate: () => d }; };
        const mk = (id, no, status, total, paid) => ({
            id, order_number: no, status, table_id: 't6', table_label: '6',
            lines: [{ line_id: `l${id}`, item_name: `Dish ${no}`, quantity: 1, unit_price: total, gross_amount: total }],
            subtotal: total, total_amount: total, paid_amount: paid,
            payments: paid ? [{ payment_id: `p${id}`, method: 'cash', status: 'settled', amount: paid }] : [],
            opened_at: ts(600000), status_changed_at: ts(600000),
            paid_at: paid >= total ? ts(60000) : null
        });
        return window.__posSeedBoard([
            // #001 eaten and paid; #002 paid on the same merged bill and still
            // being cooked.
            mk('s1', '001', 'served', 50000, 50000),
            mk('s2', '002', 'sent', 30000, 30000)
        ]);
    });

    // The cooking ticket is STILL IN THE KITCHEN, not completed.
    expect(rows.map((r) => r.status).sort()).toEqual(['sent', 'served']);
    // …and it is still on the Kitchen tab, which is the screen a cook works from.
    await page.click('[data-otab="kitchen"]');
    await expect(page.locator('.pos-ocard')).toHaveCount(1);
    await expect(page.locator('.pos-ocard')).toContainText('002');
    // Its status pill still says the kitchen has it, with Paid BESIDE it —
    // never instead of it, which is the substitution that loses the cook.
    await expect(page.locator('.pos-ocard-status')).toContainText('In the kitchen');
    await expect(page.locator('.pos-ocard .pos-paid-badge')).toHaveText('Paid');

    // ⚠️ AND ITS ACTION IS THE KITCHEN'S NEXT STEP, never "Pay Bill". The money
    // is already in the drawer; a payment dialog here is how a customer is
    // charged twice.
    const btn = page.locator('.pos-ocard-btn.is-primary');
    await expect(btn).toHaveText('Mark as Ready');
    await expect(page.locator('.pos-ocard [data-pay]')).toHaveCount(0);

    // Nothing paid-and-cooking is in Completed — it is not completed.
    await page.click('[data-otab="done"]');
    await expect(page.locator('.pos-ocard')).toHaveCount(0);
});

test('a served ticket that is already paid offers CLOSE OUT, not a second bill', async ({ page }) => {
    await openBoard(page);
    await page.evaluate(() => {
        const ts = (ms) => { const d = new Date(Date.now() - ms); return { toDate: () => d }; };
        return window.__posSeedBoard([{
            id: 's1', order_number: '001', status: 'served', table_id: 't6', table_label: '6',
            lines: [{ line_id: 'l1', item_name: 'Dish', quantity: 1, unit_price: 50000, gross_amount: 50000 }],
            subtotal: 50000, total_amount: 50000, paid_amount: 50000,
            payments: [{ payment_id: 'p1', method: 'cash', status: 'settled', amount: 50000 }],
            opened_at: ts(600000), status_changed_at: ts(600000), paid_at: ts(60000)
        }]);
    });
    // "Request Bill" on an order already settled would send the cashier to
    // collect money that is in the drawer.
    await expect(page.locator('.pos-ocard-btn.is-primary')).toHaveText('Close out');
    await expect(page.locator('.pos-ocard [data-pay]')).toHaveCount(0);
});
