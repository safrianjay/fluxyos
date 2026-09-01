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
            table_id: o.table ? 't1' : null,
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
    // 3h20m rather than the real-world 23h, so the cart is still inside the
    // board's default Today window — the staleness rule is what is under test,
    // not the date filter, and a yesterday fixture would simply be filtered out.
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
    await expect(page.locator('#pos-pay-submit')).toBeEnabled();

    // More than the bill → change, immediately, without leaving the field.
    await amount.fill('');
    await amount.type('150000');
    await expect(page.locator('#pos-change-value')).toHaveText(/30\.000/);
    await expect(change).not.toHaveClass(/is-zero/);
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

