/**
 * Overview financial charts — regression guard.
 *
 * Covers the six charts that replaced Performance Trend: Net profit, Total
 * income, Total expenses, Gross profit margin, Expense breakdown and Bank
 * accounts. See docs/DESIGN_SYSTEM.md §4a and QA_CHECKLIST.md item 17a.
 */
const { test, expect } = require('@playwright/test');
const { installTrialPaywallBypass } = require('./qa-helpers.js');

const TREND_CARDS = ['net-profit-card', 'total-income-card', 'total-expenses-card', 'gross-margin-card'];
const DONUT_CARDS = ['expense-breakdown-card', 'bank-distribution-card'];

const parseRp = (text) => {
    const negative = /-\s*Rp/.test(text || '') || /^-/.test((text || '').trim());
    const digits = (text || '').replace(/[^\d]/g, '');
    return (negative ? -1 : 1) * Number(digits || 0);
};

async function boot(page, mode = 'this_month', width = 1440) {
    await installTrialPaywallBypass(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/dashboard?period=${mode}`);
    await page.waitForSelector('[data-kpi-nav="profit"]', { timeout: 25_000 });
    await expect.poll(
        async () => (await page.locator('#kpi-net-profit-sub').textContent() || '').trim(),
        { timeout: 25_000 }
    ).not.toBe('Loading...');

    // Wait on a real render signal, not a fixed sleep. The KPI strip resolves
    // before the charts paint, and under parallel-suite contention a fixed 2s
    // sleep is sometimes short — which made the donut assertions flake.
    await expect.poll(async () => page.evaluate(() => {
        const heads = document.querySelectorAll('.chart-metric-value').length;
        const donuts = document.querySelectorAll(
            '.chart-donut-total, #expense-breakdown-card .chart-empty, #bank-distribution-card .chart-empty').length;
        const loading = document.querySelectorAll('.chart-plot .chart-loading, .chart-donut > .chart-loading').length;
        return heads >= 3 && donuts >= 2 && loading === 0;
    }), { timeout: 25_000 }).toBe(true);
    // Let fonts settle so width-based clipping checks measure final glyphs.
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(250);

    // The product-tour promoter overlay covers the page in a fresh QA session and
    // swallows pointer events. Pre-existing and unrelated to the charts.
    await page.evaluate(() => document
        .querySelectorAll('.fluxy-tour-overlay, #fluxy-learn-promoter-overlay')
        .forEach(el => el.remove()));
}

test('every chart renders and reconciles with the KPI strip', async ({ page }) => {
    await boot(page);

    const revenue = parseRp(await page.locator('#kpi-revenue').textContent());
    const opex = parseRp(await page.locator('#kpi-opex').textContent());
    const netProfit = parseRp(await page.locator('#kpi-net-profit').textContent());

    const headline = async (card) =>
        parseRp(await page.locator(`#${card} .chart-metric-value`).textContent());

    // A chart must never state a different figure than the KPI card above it.
    expect(await headline('total-income-card'), 'Total income = Revenue KPI').toBe(revenue);
    expect(await headline('total-expenses-card'), 'Total expenses = OpEx KPI').toBe(opex);
    expect(await headline('net-profit-card'), 'Net profit chart = Net profit KPI').toBe(netProfit);

    // The expense donut is the same money, sliced — its total must tie to OpEx.
    const donutTotal = parseRp(
        await page.locator('#expense-breakdown-card .chart-donut-total').getAttribute('title'));
    expect(donutTotal, 'Expense donut total = OpEx KPI').toBe(opex);
});

test('no formatter leaks and no per-chart AI entry point', async ({ page }) => {
    await boot(page);
    const band = await page.locator('.overview-wide-column').textContent();
    expect(band).not.toMatch(/\bNaN\b|\bInfinity\b|\bundefined\b/);

    // The Overview has exactly one AI entry point (the right-rail brain panel).
    // No chart card may carry an AI action or an "fx" affordance.
    for (const card of [...TREND_CARDS, ...DONUT_CARDS]) {
        const text = await page.locator(`#${card}`).textContent();
        expect(text, `${card} has no AI action`).not.toMatch(/AI insight|Ask AI|\bfx\b/i);
        expect(await page.locator(`#${card} [data-generate-ai-summary], #${card} [data-ask-fluxy]`).count())
            .toBe(0);
    }
});

test('gross profit margin never fabricates a margin from zero COGS', async ({ page }) => {
    await boot(page);
    const card = page.locator('#gross-margin-card');
    const hasPlot = await card.locator('.chart-line-current').count() > 0;
    if (hasPlot) {
        // Mapped cost of revenue: a real margin, and never a flat 100%.
        const value = await card.locator('.chart-metric-value').textContent();
        expect(value).toMatch(/%|N\/A/);
        expect(value.trim()).not.toBe('100%');
    } else {
        // No cost-of-revenue mapping: the setup state, not an invented figure.
        await expect(card.locator('.chart-empty')).toBeVisible();
        expect(await card.textContent()).toMatch(/Cost of revenue not mapped/i);
    }
});

test('prior-period series is bucketed against the prior window', async ({ page }) => {
    await boot(page);
    // Prior transactions are dated in the previous window; bucketing them against
    // the current frames drops them all and silently draws an empty ghost series.
    const current = await page.locator('#total-income-card .chart-line-current').getAttribute('points');
    const prior = await page.locator('#total-income-card .chart-line-prior').getAttribute('points');
    expect(prior, 'prior polyline is drawn').toBeTruthy();
    expect(prior, 'prior differs from current').not.toBe(current);
    expect(await page.locator('#net-profit-card .chart-column-prior').count()).toBeGreaterThan(0);
});

test('tooltip clamps above the bucket labels and carries both series', async ({ page }) => {
    await boot(page);
    await page.locator('#net-profit-card').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const bars = page.locator('#net-profit-card [data-chart-bar]');
    const count = await bars.count();

    for (let i = 0; i < count; i++) {
        const box = await bars.nth(i).boundingBox();
        const tip = page.locator('#net-profit-card .chart-tooltip');
        // Poll for the state being asserted rather than sleeping a fixed 200ms.
        // The hover handler runs on mousemove, and under suite contention the
        // fixed wait sometimes measured the tooltip a frame before it painted.
        await expect.poll(async () => {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
            return tip.evaluate(e => e.classList.contains('is-visible'));
        }, { timeout: 10_000 }).toBe(true);
        const text = (await tip.textContent() || '').replace(/\s+/g, ' ').trim();
        expect(text).toMatch(/Net profit/);
        expect(text).not.toMatch(/\bNaN\b|\bInfinity\b|\bundefined\b/);
        // Never flips below the bar — the bucket labels live there.
        const tipBox = await tip.boundingBox();
        const labels = await page.locator('#net-profit-card .chart-labels').boundingBox();
        expect(tipBox.y + tipBox.height, `bar ${i} tooltip clears labels`).toBeLessThanOrEqual(labels.y + 1);
    }
});

test('donut legends stay bounded and the centre total is not clipped', async ({ page }) => {
    await boot(page);
    for (const card of DONUT_CARDS) {
        // A workspace with seventeen accounts must not produce a seventeen-row
        // legend — the tail folds into one counted "Other" row.
        expect(await page.locator(`#${card} .chart-donut-legend-row`).count(),
            `${card} legend bounded`).toBeLessThanOrEqual(7);
        const clipped = await page.locator(`#${card} .chart-donut-total`)
            .evaluate(e => e.scrollWidth > e.clientWidth + 1);
        expect(clipped, `${card} centre total not clipped`).toBe(false);
    }
});

for (const mode of ['all_time', 'last_month']) {
    test(`${mode}: wide tracks scroll inside the card, never the page`, async ({ page }) => {
        await boot(page, mode);
        const result = await page.evaluate(() => ({
            pageFits: document.documentElement.scrollWidth === document.documentElement.clientWidth,
            tracksContained: [...document.querySelectorAll('.chart-line-track, .chart-diverging-track')]
                .map(t => {
                    const scroller = t.closest('.chart-scroll');
                    return !!scroller && getComputedStyle(scroller).overflowX === 'auto';
                })
        }));
        expect(result.pageFits, 'no page-level horizontal scroll').toBe(true);
        expect(result.tracksContained.length).toBeGreaterThan(0);
        expect(result.tracksContained.every(Boolean), 'every track has its own scroller').toBe(true);
    });
}

test('line charts are not stretched: viewBox width equals rendered width', async ({ page }) => {
    await boot(page, 'last_month');
    const checks = await page.evaluate(() => [...document.querySelectorAll('.chart-line-svg')].map(svg => {
        const vbWidth = Number((svg.getAttribute('viewBox') || '').split(/\s+/)[2]);
        return Math.abs(vbWidth - svg.getBoundingClientRect().width) <= 1.5;
    }));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every(Boolean), 'viewBox width matches rendered width').toBe(true);
});

test('mobile 375: charts stack 1-up with no horizontal overflow', async ({ page }) => {
    await boot(page, 'this_month', 375);
    const income = await page.locator('#total-income-card').boundingBox();
    const expenses = await page.locator('#total-expenses-card').boundingBox();
    expect(expenses.y, 'cards stack rather than sit side by side').toBeGreaterThan(income.y + 50);

    const margin = await page.locator('#gross-margin-card').boundingBox();
    const donut = await page.locator('#expense-breakdown-card').boundingBox();
    expect(donut.y).toBeGreaterThan(margin.y + 50);

    expect(await page.evaluate(() =>
        document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});

// --- Layout: KPI/rail height pairing + full-width chart band ---------------

for (const w of [1440, 1280]) {
    test(`@${w}: rail matches the KPI board and charts span the full canvas`, async ({ page }) => {
        await boot(page, 'this_month', w);
        const m = await page.evaluate(() => {
            const box = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
            const sc = document.querySelector('.rail-scroll');
            return {
                kpi: box('.summary-board'),
                workbench: box('.right-workbench'),
                rail: box('.overview-right-column'),
                wide: box('.overview-wide-column'),
                railScrolls: sc ? sc.scrollHeight > sc.clientHeight + 1 : false
            };
        });
        // The rail consumes the row height; it must never define it. If the rail
        // is left in flow its ~837px of content drags the KPI board up to match.
        expect(Math.abs(m.kpi.height - m.workbench.height), 'rail height == KPI height')
            .toBeLessThanOrEqual(1);
        // Charts use the whole canvas, not just the KPI column.
        expect(m.wide.width, 'chart band wider than the KPI column')
            .toBeGreaterThan(m.kpi.width + 100);
        expect(Math.abs(m.wide.x - m.kpi.x), 'left edges align').toBeLessThanOrEqual(1);
        expect(Math.abs((m.wide.x + m.wide.width) - (m.rail.x + m.rail.width)), 'right edges align')
            .toBeLessThanOrEqual(1);
        // Overflowing rail content scrolls inside the card rather than growing it.
        expect(m.railScrolls, 'rail content area scrolls').toBe(true);
    });
}

for (const w of [1024, 768, 375]) {
    test(`@${w}: stacked layout keeps the rail at full height`, async ({ page }) => {
        await boot(page, 'this_month', w);
        const h = await page.evaluate(() =>
            document.querySelector('.right-workbench').getBoundingClientRect().height);
        // An absolutely-positioned card whose `position` isn't reset when the
        // layout stacks collapses to ~0 and the rail silently disappears.
        expect(h, 'rail card has real height when stacked').toBeGreaterThan(200);
        expect(await page.evaluate(() =>
            document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    });
}

test('point markers stay round at every card size', async ({ page }) => {
    await boot(page, 'last_month');
    const svgs = await page.evaluate(() => [...document.querySelectorAll('.chart-line-svg')].map(svg => {
        const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const r = svg.getBoundingClientRect();
        const c = svg.querySelector('circle');
        const cr = c ? c.getBoundingClientRect() : null;
        return { vbW: vb[2], vbH: vb[3], w: r.width, h: r.height,
                 marker: cr ? { w: cr.width, h: cr.height } : null };
    }));
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) {
        // Both axes must map 1:1 or preserveAspectRatio="none" scales x and y
        // independently and the round markers stretch into ovals.
        expect(Math.abs(s.vbW - s.w), 'viewBox width == rendered width').toBeLessThanOrEqual(2);
        expect(Math.abs(s.vbH - s.h), 'viewBox height == rendered height').toBeLessThanOrEqual(2);
        if (s.marker) expect(Math.abs(s.marker.w - s.marker.h), 'marker is round').toBeLessThanOrEqual(1.2);
    }
});
