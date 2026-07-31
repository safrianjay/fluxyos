// @ts-check
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers');

/**
 * QA: future-dated record cleanup.
 *
 * A transaction dated after today is a defect — the Add Transaction drawer only
 * accepts today or earlier, so it always came from an import or an external
 * write. Such records fall outside EVERY period, so they are excluded from every
 * KPI and the user would never discover them. The Overview attention queue
 * surfaces them; `/ledger?flag=future_dated` is where they get fixed.
 *
 * Read-only — never writes.
 */

test.beforeEach(async ({ page }) => { await installTrialPaywallBypass(page); });

function trackErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/favicon|net::ERR|analytics|googletagmanager|ERR_BLOCKED/i.test(t)) return;
        errors.push('console: ' + t);
    });
    return errors;
}

// The post-KYC learning coachmark overlays the Overview and swallows clicks.
async function dismissLearningPromoter(page) {
    const overlay = page.locator('#fluxy-learn-promoter-overlay');
    if (await overlay.count()) {
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
    }
}

// Ground truth straight from Firestore, through the same workspace scope
// DataService resolves — so the test can't pass by agreeing with a bug.
async function countFutureDated(page) {
    return page.evaluate(async () => {
        const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const app = appMod.getApps()[0];
        const auth = authMod.getAuth(app);
        await auth.authStateReady();
        const user = auth.currentUser;
        if (!user) return null;
        const wsId = window.FLUXY_WORKSPACE_MODE && window.FluxyWorkspace && window.FluxyWorkspace.id;
        const scope = wsId ? `workspaces/${wsId}` : `users/${user.uid}`;
        const db = fsMod.getFirestore(app);
        const snap = await fsMod.getDocs(fsMod.collection(db, `${scope}/transactions`));
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        let count = 0;
        snap.forEach((d) => {
            const x = d.data();
            if (x.is_voided) return;
            const ts = x.date?.toDate?.() || x.timestamp?.toDate?.() || null;
            if (ts && ts > endOfToday) count++;
        });
        return count;
    });
}

test('Overview surfaces future-dated records in the attention queue', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await page.waitForSelector('#needs-attention-content .queue-row, #needs-attention-content .overview-empty-copy', { timeout: 30_000 });
    await page.waitForTimeout(1500);

    const expected = await countFutureDated(page);
    test.skip(expected === null, 'no authenticated user');
    console.log('[future-dated] records in workspace:', expected);

    const row = page.locator('#needs-attention-content .queue-row', { hasText: 'dated in the future' });
    if (expected === 0) {
        await expect(row, 'no queue row when the workspace is clean').toHaveCount(0);
    } else {
        await expect(row, 'a queue row appears when future-dated records exist').toHaveCount(1);
        // The count in the queue must equal the records the Ledger will show.
        await expect(row).toContainText(new RegExp(`^\\s*${expected} record`));
        await expect(row).toHaveAttribute('href', '/ledger?flag=future_dated');
    }
    expect(errors, 'console clean').toEqual([]);
});

test('the queue row deep-links into the Ledger cleanup view', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await page.waitForSelector('#needs-attention-content .queue-row, #needs-attention-content .overview-empty-copy', { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const expected = await countFutureDated(page);
    test.skip(!expected, 'no future-dated records on the QA account');

    await dismissLearningPromoter(page);
    await page.locator('#needs-attention-content .queue-row', { hasText: 'dated in the future' }).click();
    await page.waitForURL(/\/ledger\?flag=future_dated/, { timeout: 15_000 });
    await page.waitForSelector('#ledger-table-body tr[data-ledger-id]', { timeout: 25_000 });

    // The Ledger must load exactly the set the Overview counted — the queue badge
    // and the cleanup view cannot drift. "Showing 1-10 of 41 records".
    const summary = await page.locator('#ledger-page-summary').textContent();
    const total = Number((/of\s+([\d.,]+)/i.exec(summary || '')?.[1] || '').replace(/[^\d]/g, ''));
    console.log('[future-dated] ledger summary:', summary);
    expect(total, 'Ledger loads exactly the records the queue counted').toBe(expected);

    // Every rendered row is genuinely dated after today. The transaction date is
    // the "Date" column, NOT the first cell — column one is "Uploaded"
    // (created_at), which is legitimately in the past for an imported record.
    const badDates = await page.evaluate(() => {
        const headers = [...document.querySelectorAll('#ledger-table-container thead th')]
            .map((th) => (th.textContent || '').trim().toLowerCase());
        const dateCol = headers.indexOf('date');
        if (dateCol === -1) return ['could not locate the Date column'];
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        const out = [];
        document.querySelectorAll('#ledger-table-body tr[data-ledger-id]').forEach((tr) => {
            const cell = tr.querySelectorAll('td')[dateCol];
            const text = (cell?.textContent || '').trim();
            const parsed = new Date(text);
            if (!Number.isNaN(parsed.getTime()) && parsed <= endOfToday) out.push(text);
        });
        return out;
    });
    expect(badDates, 'no past-dated row leaked into the cleanup view').toEqual([]);

    // The Ledger must call these records what they are. Before this existed the
    // Trust Score read "100% · 41/41 clean" for records dated in the year 9702.
    const trust = await page.locator('#ledger-trust-score').textContent();
    const clean = await page.locator('#ledger-clean-count').textContent();
    console.log('[future-dated] trust score:', trust, '| clean records:', clean);
    expect(Number((trust || '').replace(/[^\d]/g, '')), 'trust score reflects the bad dates').toBeLessThan(100);
    expect(Number((clean || '').replace(/[^\d]/g, '')), 'these records are not counted clean').toBe(0);
    await expect(
        page.locator('#ledger-attention-section'),
        'the cleanup panel lists them'
    ).toBeVisible();
    await expect(page.locator('#ledger-attention-chip-row')).toContainText('Future-dated');

    // The mode is visible and reversible.
    const chip = page.locator('[data-filter-clear="future_dated"]');
    await expect(chip, 'cleanup chip explains why the date range is overridden').toBeVisible();
    await chip.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('flag'), { timeout: 10_000 }).toBeNull();
    await expect(chip).toHaveCount(0);

    expect(errors, 'console clean').toEqual([]);
});

test('future-dated records are excluded from every Overview KPI', async ({ page }) => {
    // The whole point of surfacing them: they are NOT silently inflating a total.
    const parseRp = (t) => {
        const neg = /^-/.test((t || '').trim());
        return (neg ? -1 : 1) * Number((t || '').replace(/[^\d]/g, '') || 0);
    };
    await page.goto('/dashboard?period=all_time');
    await page.waitForSelector('[data-kpi-nav="profit"]', { timeout: 25_000 });
    await expect.poll(
        async () => (await page.locator('#kpi-net-profit-sub').textContent() || '').trim(),
        { timeout: 25_000 }
    ).not.toBe('Loading...');

    const revenue = parseRp(await page.locator('#kpi-revenue').textContent());
    const opex = parseRp(await page.locator('#kpi-opex').textContent());
    const profit = parseRp(await page.locator('#kpi-net-profit').textContent());
    expect(profit, 'All Time still reconciles with future-dated records present').toBe(revenue - opex);

    // And the drill-down agrees with the card.
    await page.goto('/net-profit?period=all_time');
    await page.waitForSelector('#kpi-content:not(.hidden)', { timeout: 25_000 });
    await page.waitForTimeout(800);
    expect(parseRp(await page.locator('#profit-headline').textContent())).toBe(profit);
});
