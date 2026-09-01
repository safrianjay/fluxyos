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
            total_amount: 20000,
            paid_amount: o.status === 'paid' ? 20000 : 0,
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
    expect(tabs.map((t) => t.key)).toEqual(['all', 'process', 'kitchen', 'served', 'bill', 'done']);
    // Ladder order, so the row reads the way service actually flows.
    expect(tabs.map((t) => t.label).join(' | '))
        .toMatch(/All \| In Process \| Process to Kitchen \| Served \| Request Bill \| Completed/i);
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
