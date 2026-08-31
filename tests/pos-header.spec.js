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

        const head = await page.evaluate(() => {
            const t = document.getElementById('pos-view-title');
            return {
                title: (t || {}).textContent || '',
                sub: (document.getElementById('pos-view-sub') || {}).textContent || '',
                // It must be in the TOPBAR. In the canvas it cost every view its
                // first ~90px re-introducing itself, which on a 10" tablet put
                // the work below the fold.
                inTopbar: !!(t && t.closest('.pos-topbar'))
            };
        });
        expect(head.inTopbar, 'the page header must live in the topbar, not the canvas').toBe(true);
        expect(head.title.trim(), `"${view}" has no title`).not.toBe('');
        expect(head.sub.trim(), `"${view}" has no subtext`).not.toBe('');
        // The subtext must EXPLAIN, not restate. A breadcrumb that echoed the
        // heading is exactly what this replaced.
        expect(head.sub.trim().toLowerCase(),
            `"${view}" subtext just repeats its title`).not.toBe(head.title.trim().toLowerCase());
        expect(head.sub, 'the breadcrumb is gone; this should be a sentence').not.toMatch(/FluxyOS\s*•/);
    }

    // And the canvas begins with the WORK. Nothing in it may repeat the page
    // title, which is what the old in-canvas header did.
    const canvasStart = await page.evaluate(() => {
        const canvas = document.querySelector('.fluxy-page-canvas');
        const first = [...canvas.children].find((el) => el.getBoundingClientRect().height > 0);
        return first ? { cls: String(first.className), top: Math.round(first.getBoundingClientRect().top) } : null;
    });
    expect(canvasStart, 'the canvas is empty').not.toBeNull();
    expect(canvasStart.cls, 'the page title is back in the canvas').not.toMatch(/pagehead|pagetitle/);
});

test('Create Order asks dine in or take away before it creates anything', async ({ page }) => {
    await openTill(page);
    await expect(page.locator('#pos-new-order')).toContainText(/create order/i);

    await page.click('#pos-new-order');
    // The wrapper has no size of its own — everything inside it is fixed —  so
    // visibility is asserted on the dialog, and removal on the wrapper.
    const modal = page.locator('#pos-create-modal .pos-modal');
    const wrapper = page.locator('#pos-create-modal');
    await expect(modal, 'Create Order must open a popup, not the side drawer').toBeVisible({ timeout: 10000 });

    const types = await modal.locator('[data-type]').allInnerTexts();
    expect(types.join(' ')).toMatch(/dine in/i);
    expect(types.join(' ')).toMatch(/take away/i);

    // Opening the dialog creates nothing — the details come first.
    await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i);

    // Dine in asks for a table and covers; take away asks for neither, because
    // it will never have one and the other means nothing without it.
    await expect(modal.locator('#pos-create-table')).toBeVisible();
    await expect(modal.locator('#pos-create-covers')).toBeVisible();
    await modal.locator('[data-type="takeaway"]').click();
    await expect(modal.locator('#pos-create-table'),
        'a takeaway was asked to pick a table').toBeHidden();
    await expect(modal.locator('#pos-create-covers'),
        'a takeaway was asked for a cover count').toBeHidden();
    // The details it CAN have are still offered.
    await expect(modal.locator('#pos-create-name')).toBeVisible();
    await expect(modal.locator('#pos-create-phone')).toBeVisible();
    await expect(modal.locator('#pos-create-note')).toBeVisible();

    // Take away, with a customer.
    await modal.locator('#pos-create-name').fill('Pak Budi');
    await modal.locator('#pos-create-phone').fill('0812-3456-7890');
    await page.click('#pos-create-submit');
    await expect(wrapper).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('#pos-order-title')).toHaveText(/takeaway|bawa pulang/i, { timeout: 20000 });
    // Captured details that are never shown back would make the dialog a form
    // that goes nowhere.
    await expect(page.locator('#pos-order-sub')).toContainText('Pak Budi');
    await voidOpen(page);

    // A dine-in with no table has nowhere to sit, and nothing downstream could
    // repair that — so it is the one thing the dialog refuses.
    await page.click('#pos-new-order');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await page.click('#pos-create-submit');
    await expect(modal, 'a tableless dine-in was created anyway').toBeVisible();
    await expect(modal.locator('#pos-create-error')).toBeVisible();
    await expect(page.locator('#pos-order-title')).toHaveText(/no order open|belum ada pesanan/i);
    await modal.locator('.pos-modal-close').click();
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
        expect(await page.locator('#pos-create-modal').count(),
            'a retail till was asked to choose a dining option').toBe(0);
    } finally {
        await page.goto('/pos').catch(() => {});
        await workspaceReady(page).catch(() => {});
        await setCategory(page, original).catch(() => {});
    }
});
