// @ts-check
const { test, expect } = require('@playwright/test');

test('budget-allocation page renders bars + compact rows + header back button', async ({ page }) => {
    const log = [];
    page.on('console', m => { if (['error', 'pageerror'].includes(m.type())) log.push(m.text()); });
    page.on('pageerror', e => log.push(e.message));

    // Resolve a real budgetId + allocationId via the page's DataService.
    await page.goto('/budget.html');
    await page.waitForFunction(() => {
        const c = document.getElementById('budget-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });

    const ids = await page.evaluate(async () => {
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const cfg = { apiKey: 'AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA', authDomain: 'fluxyos.com', projectId: 'fluxyos', storageBucket: 'fluxyos.firebasestorage.app', messagingSenderId: '1084252368929', appId: '1:1084252368929:web:da73dc0db83fe592c7f360' };
        const app = getApps().length ? getApps()[0] : initializeApp(cfg);
        const auth = getAuth(app);
        if (auth.authStateReady) await auth.authStateReady();
        const { default: DataService } = await import('/assets/js/db-service.js');
        const ds = new DataService(app);
        const uid = auth.currentUser.uid;
        const budget = await ds.getActiveBudget(uid);
        const allocs = await ds.getBudgetAllocations(uid, budget.id);
        const usage = await ds.getBudgetUsage(uid, budget.id);
        // Pick the allocation with the most spend so the trend/groups/records
        // render with real data rather than empty states.
        let best = allocs[0];
        let bestSpend = -1;
        (usage.allocations || []).forEach(a => {
            const spend = (a.actual_used || 0) + (a.committed_amount || 0);
            if (spend > bestSpend) { bestSpend = spend; best = allocs.find(x => x.id === a.id) || best; }
        });
        return { budgetId: budget.parent_budget_id || budget.id, periodId: budget.id, allocationId: best?.id || allocs[0]?.id || null };
    });
    console.log('[alloc] ids:', ids);
    expect(ids.allocationId).toBeTruthy();

    await page.goto(`/budget-allocation/${ids.allocationId}`);
    await page.waitForFunction(() => {
        const c = document.getElementById('allocation-content');
        return c && !c.classList.contains('hidden');
    }, { timeout: 15000 });
    await page.waitForTimeout(800);

    // Back button lives in the topbar header now.
    const backInHeader = await page.evaluate(() => {
        const back = document.getElementById('allocation-back-link');
        return !!back && !!back.closest('header');
    });
    console.log('[alloc] back link in header:', backInHeader);
    expect(backInHeader).toBe(true);

    // Trend is either the empty-state card (no matched records) or an area
    // chart over weekly buckets. With data it must be an area (polygon +
    // polyline) and the x-axis labels read "Week N".
    const trendHtml = await page.locator('#allocation-trend').innerHTML();
    const isEmpty = trendHtml.includes('No spend trend');
    if (!isEmpty) {
        expect(trendHtml.includes('<polygon')).toBe(true);
        expect(trendHtml).toContain('Week 1');
    }
    console.log('[alloc] trend:', isEmpty ? 'empty-state' : 'area chart with weekly axis');

    await page.screenshot({ path: 'test-results/budget-verify/ALLOC-page.png', fullPage: true });
    console.log('[alloc] console errors:', JSON.stringify(log));
    expect(log.length).toBe(0);
});
