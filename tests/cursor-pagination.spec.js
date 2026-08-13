/**
 * Cursor pagination (DataService.getRecordsPage).
 *
 * Every other read in the codebase is `limit(1000)` + filter-client-side, and
 * `startAfter` appeared zero times before this shipped. That ceiling truncates
 * silently — there is no cursor and no "showing first 1000" affordance, so the
 * summary cards and CSV export downstream compute from the truncated set. A
 * stock-movement ledger passes 1,000 rows in one busy month, which is why the
 * pattern exists before inventory rather than after.
 *
 * Read-only: this spec pages through the QA workspace's existing transactions
 * and writes nothing.
 */
const { test, expect } = require('@playwright/test');

test('getRecordsPage walks pages without gaps or repeats', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const PAGE = 3;
        const PAGES = 3;

        // Baseline: the same ordering, read the old (unpaged) way.
        const baseline = (await ds.getTransactions(uid, PAGE * PAGES)).map((t) => t.id);

        // Walk it with the cursor. Voided rows are filtered after the page read,
        // so a page may return fewer than PAGE records while more data exists —
        // hasMore tracks raw document count, which is what makes the walk safe.
        const walked = [];
        let cursor = null;
        let hasMore = true;
        let pagesRead = 0;
        while (hasMore && pagesRead < PAGES) {
            const res = await ds.getRecordsPage(uid, 'transactions', { pageSize: PAGE, cursor });
            walked.push(...res.records.map((t) => t.id));
            cursor = res.cursor;
            hasMore = res.hasMore;
            pagesRead += 1;
            if (!cursor) break;
        }

        // Empty-collection / exhausted behaviour must terminate, not loop.
        const past = await ds.getRecordsPage(uid, 'transactions', { pageSize: PAGE, cursor });
        // A date range that cannot contain anything.
        const empty = await ds.getRecordsPage(uid, 'transactions', {
            startKey: '1990-01-01', endKey: '1990-01-02', pageSize: PAGE
        });

        return {
            walked,
            baselinePrefix: baseline.slice(0, walked.length),
            uniqueCount: new Set(walked).size,
            pagesRead,
            pastHasMoreIsBool: typeof past.hasMore === 'boolean',
            emptyRecords: empty.records.length,
            emptyHasMore: empty.hasMore,
            emptyCursor: empty.cursor
        };
    });

    // The walk must reproduce the unpaged ordering exactly — no gaps, no repeats.
    expect(r.walked.length, 'QA workspace needs records to page through').toBeGreaterThan(0);
    expect(r.uniqueCount, 'a page boundary must not repeat a record').toBe(r.walked.length);
    expect(r.walked).toEqual(r.baselinePrefix);

    // Exhaustion terminates cleanly rather than paging forever.
    expect(r.pastHasMoreIsBool).toBe(true);
    expect(r.emptyRecords).toBe(0);
    expect(r.emptyHasMore).toBe(false);
    expect(r.emptyCursor).toBeNull();
});
