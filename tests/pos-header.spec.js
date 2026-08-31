const { test, expect } = require('@playwright/test');

// =============================================================================
// The page header, and the order-type choice that now starts every F&B order.
//
// THE HEADER. Each view used to carry a breadcrumb reading "FluxyOS • Orders"
// directly beneath a 24px heading that already said "Orders" — no information,
// and no trail to retrace either, since all four views live behind one URL and
// nothing ever navigates. Every view now says what it is FOR in the one place a
// person looks first.
//
// THE CHOICE. "Takeaway" named one of two options and hid the other, and dine-in
// was decided after the fact by a select inside the order panel — which is
// disabled once an order exists, so getting it wrong meant voiding and starting
// again. "Create Order" asks first, while the answer is still free.
//
// A counter has one kind of order, so a pay-first profile is NOT asked. That
// control is the last test here.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

let baseline;
async function captureBaseline(page) {
    const seen = await page.evaluate(() => (window.FluxyWorkspace && window.FluxyWorkspace.businessCategory) || null);
    if (baseline === undefined) baseline = (seen === 'retail' ? null : seen);
    return baseline;
}

async function workspaceReady(page) {
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.ready,
        null, { timeout: 30000 });
}

async function setCategory(page, category) {
    const err = await page.evaluate(async (cat) => {
        try {
            const [{ getFirestore, doc, updateDoc, deleteField, serverTimestamp }, { getApp }] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js')
            ]);
            const ws = window.FluxyWorkspace && window.FluxyWorkspace.id;
            if (!ws) return 'no workspace resolved';
            await updateDoc(doc(getFirestore(getApp()), `workspaces/${ws}`), {
                business_category: cat === null ? deleteField() : cat,
                updated_at: serverTimestamp()
            });
            return null;
        } catch (e) { return String(e && e.message); }
    }, category);
    expect(err, `could not set business_category=${category}`).toBeNull();
}

async function openTill(page) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await expect(page.locator('#pos-new-order')).toBeEnabled({ timeout: 25000 });
}

async function voidOpen(page) {
    const btn = page.locator('#pos-void-btn');
    if (!(await btn.isVisible().catch(() => false))) return;
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await btn.click();
    await page.fill('#pos-void-why', 'Spec cleanup');
    await page.locator('button[type="submit"][form="pos-drawer-form"]').first().click();
    await expect(page.locator('#pos-order-title'))
        .toHaveText(/no order open|belum ada pesanan|no sale open|belum ada transaksi/i, { timeout: 20000 });
}

test('every view names itself and says what it is for', async ({ page }) => {
    await openTill(page);

    for (const view of ['till', 'tables', 'orders', 'shift']) {
        await page.click(`#nav-container [data-view="${view}"]`);
        await expect(page.locator(`.pos-view[data-view="${view}"]`)).toBeVisible();
        await page.waitForTimeout(300);

        const head = await page.evaluate(() => ({
            title: (document.getElementById('pos-view-title') || {}).textContent || '',
            sub: (document.getElementById('pos-view-sub') || {}).textContent || ''
        }));
        expect(head.title.trim(), `"${view}" has no title`).not.toBe('');
        expect(head.sub.trim(), `"${view}" has no subtext`).not.toBe('');
        // The subtext must EXPLAIN, not restate. A breadcrumb that echoed the
        // heading is exactly what this replaced.
        expect(head.sub.trim().toLowerCase(),
            `"${view}" subtext just repeats its title`).not.toBe(head.title.trim().toLowerCase());
        expect(head.sub, 'the breadcrumb is gone; this should be a sentence').not.toMatch(/FluxyOS\s*•/);
    }

    // The header introduces what is under it, so it sits closer than the 20px
    // rhythm every other pair on the page gets.
    const gap = await page.evaluate(() => {
        const head = document.querySelector('.pos-pagehead').getBoundingClientRect();
        let el = document.querySelector('.pos-pagehead').nextElementSibling;
        while (el && el.getBoundingClientRect().height === 0) el = el.nextElementSibling;
        return el ? Math.round(el.getBoundingClientRect().top - head.bottom) : null;
    });
    expect(gap, 'the header floats away from the view it introduces').toBeLessThanOrEqual(28);
    expect(gap, 'the header is touching the view below it').toBeGreaterThanOrEqual(8);
});

test('Create Order asks dine in or take away before it creates anything', async ({ page }) => {
    await openTill(page);
    await expect(page.locator('#pos-new-order')).toContainText(/create order/i);

    // Take away: nothing left to ask.
    await page.click('#pos-new-order');
    await expect(page.locator('.pos-ordertype')).toBeVisible({ timeout: 10000 });
    const options = await page.locator('.pos-ordertype-opt').allInnerTexts();
    expect(options.length, 'both ways an order can go').toBe(2);
    expect(options.join(' ')).toMatch(/dine in/i);
    expect(options.join(' ')).toMatch(/take away/i);

    // Nothing is created by opening the chooser — the decision comes first.
    await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i);

    await page.click('[data-type="takeaway"]');
    await expect(page.locator('#pos-order-title')).toHaveText(/takeaway|bawa pulang/i, { timeout: 20000 });
    await voidOpen(page);

    // Dine in: it needs a table, so it hands over to the floor rather than
    // creating an order with nowhere to sit.
    await page.click('#pos-new-order');
    await expect(page.locator('.pos-ordertype')).toBeVisible({ timeout: 10000 });
    await page.click('[data-type="dine_in"]');
    await expect(page.locator('.pos-view[data-view="tables"]'),
        'dine in must land on the floor plan, not create a tableless order').toBeVisible({ timeout: 10000 });
    await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i);
});

test('a counter is not asked a question with one answer', async ({ page }) => {
    // The control. A pay-first profile has no dine-in, so the chooser must not
    // appear — an extra tap on every sale, to answer something that cannot vary.
    await page.goto('/pos');
    await workspaceReady(page);
    const original = await captureBaseline(page);

    try {
        await setCategory(page, 'retail');
        await openTill(page);

        await page.click('#pos-new-order');
        await page.waitForTimeout(1200);
        expect(await page.locator('.pos-ordertype').count(),
            'a retail till was asked to choose a dining option').toBe(0);
    } finally {
        await page.goto('/pos').catch(() => {});
        await workspaceReady(page).catch(() => {});
        await setCategory(page, original).catch(() => {});
    }
});
