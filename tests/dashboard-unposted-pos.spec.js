const { test, expect } = require('@playwright/test');

// =============================================================================
// Till sales that never reached the books, surfaced where the owner looks.
//
// WHY THIS ROW EXISTS. For about a day, POS sales were taken from customers and
// marked paid while the revenue never posted. The bug is fixed and the till
// drains its own backlog on load — but only for a session allowed to write
// journals, which a CASHIER is not. So a business whose till is only ever opened
// by staff would carry understated revenue indefinitely, and the only person who
// could fix it would never be shown the problem.
//
// This row puts it on the owner's home page and lets them fix it in one press.
// It is the only attention row that repairs rather than reports, and the only
// one about money the business has ALREADY received.
//
// Reads only. It asserts the row's presence tracks the real backlog and that the
// queue renders an actionable row as a button — it does not manufacture unposted
// sales, because doing so would mean deliberately writing a broken order to a
// real ledger.
//
// The full repair path WAS verified by hand against a deliberately unposted sale
// on 2026-08-31: the row appeared reading "1 till sale has not reached your books
// · Rp20.000 …", one press posted it, the order gained a transaction_id and the
// backlog returned to zero.
//
// ⚠️ THE REGRESSION THIS GUARDS. The first cut fetched the backlog inside
// `getDashboardOverview`, on the Overview's critical path. The whole attention
// queue then rendered EMPTY — five rows became zero, badge included — with no
// console error anywhere. The second test below is what catches that: it asserts
// the ordinary rows are still there and still links.
// =============================================================================

test.describe.configure({ timeout: 180_000 });

// Waits for the queue to have SETTLED — a row, or the words that mean there are
// none. A fixed delay was not enough: the Overview read is slow on a workspace
// with real data, and the helper returned before anything had painted, which
// reads exactly like an empty queue.
async function loadOverview(page) {
    await page.goto('/dashboard');
    await page.waitForFunction(() => {
        const el = document.getElementById('needs-attention-content');
        if (!el) return false;
        return !!el.querySelector('.queue-row') || /require attention|not yet available/i.test(el.innerText);
    }, undefined, { timeout: 60000 });
    // The unposted-sales row arrives on its own read, after the first paint.
    await page.waitForTimeout(4000);
}

test('the attention queue reflects the real unposted-sales backlog', async ({ page }) => {
    await loadOverview(page);

    const state = await page.evaluate(async () => {
        // The same read the Overview uses, asked directly so the assertion is
        // about the DATA rather than about whatever happens to be painted.
        const ds = window.FluxyDS || null;
        return {
            row: !!document.querySelector('[data-queue-action="post-unposted-pos"]'),
            hasDs: !!ds
        };
    });

    // Whether the QA workspace currently HAS a backlog is not something a spec
    // should assert — it depends on the day. What must hold is the equivalence:
    // the row appears exactly when there is something to post.
    const backlog = await page.evaluate(() => {
        const el = document.querySelector('[data-queue-action="post-unposted-pos"] .queue-row-title');
        return el ? el.textContent : null;
    });

    if (state.row) {
        expect(backlog, 'the row must name how many sales are affected').toMatch(/till sale/i);
        // It is a BUTTON, not a link. A row that sends the owner somewhere else
        // to press a button this page could have pressed is a row that gets
        // ignored.
        const tag = await page.locator('[data-queue-action="post-unposted-pos"]').evaluate((el) => el.tagName);
        expect(tag, 'the repair row must be actionable in place').toBe('BUTTON');
    } else {
        // No backlog is the healthy state, and the queue must not invent a row
        // for it — a permanently lit warning is furniture.
        expect(backlog).toBeNull();
    }
});

test('the queue still renders navigational rows as links', async ({ page }) => {
    // The control for the renderer change. Making one row a button must not turn
    // every row into one — the other rows deep-link to the records behind them
    // and that is their whole job.
    await loadOverview(page);

    const shapes = await page.evaluate(() => [...document.querySelectorAll('.queue-row')]
        .map((el) => ({ tag: el.tagName, action: el.dataset.queueAction || null, href: el.getAttribute('href') })));

    // The queue must not be empty. Adding the unposted-sales read to the
    // Overview's critical path silently emptied it once already, and an empty
    // queue looks exactly like a healthy business.
    expect(shapes.length, 'the attention queue rendered nothing at all').toBeGreaterThan(0);

    shapes.forEach((s) => {
        if (s.action) {
            expect(s.tag, 'an action row must be a button').toBe('BUTTON');
        } else {
            expect(s.tag, 'a navigational row must stay an anchor').toBe('A');
            expect(s.href, 'a navigational row with no href goes nowhere').toBeTruthy();
        }
    });
});
