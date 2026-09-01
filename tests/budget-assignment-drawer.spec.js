const { test, expect } = require('@playwright/test');

// =============================================================================
// The budget assignment drawer must be a DIALOG in Safari.
//
// REPORTED FROM SAFARI, and it is a real WebKit-only bug — not a cache, not an
// ad blocker. This component is INJECTED into the DOM the first time it opens,
// so every utility class on it has to be generated at RUNTIME by the Tailwind
// Play CDN's MutationObserver. Chromium does that; WebKit does not do it in
// time, and the drawer renders as a raw block — `position: static`, full page
// width, no padding, default type. It lands in the page flow under the topbar,
// so it does not look like a broken dialog, it looks like a broken PAGE.
//
// Measured on /bill.html against the pre-fix markup, CDN fully AVAILABLE:
//
//     Chromium   420px    ← green, every time
//     WebKit    1440px    ← what the user was looking at
//
// That gap is the whole bug. Every Chromium check passed while a Safari user
// was staring at a wrecked screen, which is the second time this blind spot has
// cost something (the first: an animated `::before` that painted over content
// in Safari alone).
//
// THE RULE THIS PINS: a component whose markup is injected must not depend on
// runtime class generation for its STRUCTURE. Tailwind still applies the fine
// detail where it works; `shared-dashboard.css` decides whether this is a
// dialog at all — in every engine.
//
// The CDN-blocked case below is the same failure with a second cause (an ad
// blocker, Brave shields, an offline blip), and it is cheap to assert once the
// structure no longer depends on the CDN.
//
// The drawer is shared by /bill, /ledger and /budget-period, so this runs
// against all three.
// =============================================================================

const PAGES = ['/bill.html', '/ledger.html', '/budget-period.html'];

async function openAssignmentDrawer(page) {
    // Opened directly. The click path (a budget chip on a record row) only calls
    // this, and needs a budget, an allocation and an in-range record to all
    // exist first — none of which is what is under test here. The allocation
    // shape matches `budget_allocations` (docs/data-model/budgets.md §4e.4):
    // an id and a `name`, with archived rows filtered out by the drawer itself.
    await page.evaluate(() => window.FluxyBudgetAssignment.open({
        action: 'assign',
        recordType: 'bills',
        recordId: 'spec-record',
        vendor: 'AWS',
        amountText: 'Rp1.000.000',
        currentAllocationId: null,
        budgetId: 'spec-budget',
        allocations: [{ id: 'a1', name: 'Infrastructure', status: 'active' }],
        onDone: () => {}
    }));
}

for (const path of PAGES) {
    test(`${path} — the assignment drawer is a dialog with the Tailwind CDN blocked`, async ({ page }) => {
        await page.route('**cdn.tailwindcss.com**', (route) => route.abort());
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(path);
        await page.waitForFunction(() => !!window.FluxyBudgetAssignment, null, { timeout: 30000 });
        await openAssignmentDrawer(page);
        await page.waitForTimeout(500);

        const box = await page.evaluate(() => {
            const d = document.getElementById('fbx-assignment-drawer');
            const b = document.getElementById('fbx-assignment-backdrop');
            const c = getComputedStyle(d);
            return {
                tailwind: !!window.tailwind,
                position: c.position,
                width: parseFloat(c.width),
                maxWidth: c.maxWidth,
                display: c.display,
                right: c.right,
                backdrop: getComputedStyle(b).display,
                transform: c.transform
            };
        });

        expect(box.tailwind, 'the CDN must really be blocked or this proves nothing').toBe(false);
        expect(box.position, 'the drawer fell into the page flow').toBe('fixed');
        expect(box.width, 'the drawer took the whole page width').toBeLessThanOrEqual(420);
        expect(box.maxWidth).toBe('420px');
        expect(box.display).toBe('flex');
        expect(box.right).toBe('0px');
        expect(box.backdrop, 'the scrim never appeared').toBe('block');
        // Open means slid IN. `translate-x-full` is a Tailwind utility and does
        // nothing here, so the open state rides on a real class — without it the
        // drawer could neither hide itself nor arrive.
        expect(box.transform === 'none' || box.transform === 'matrix(1, 0, 0, 1, 0, 0)',
            `drawer is still translated off-screen: ${box.transform}`).toBe(true);

        // And it closes. Same reason: `hidden` is a utility that is not there.
        await page.locator('#fbx-assignment-cancel').click();
        await page.waitForTimeout(400);
        const closed = await page.evaluate(() => ({
            backdrop: getComputedStyle(document.getElementById('fbx-assignment-backdrop')).display,
            transform: getComputedStyle(document.getElementById('fbx-assignment-drawer')).transform
        }));
        expect(closed.backdrop, 'the scrim stayed up after Cancel').toBe('none');
        expect(closed.transform, 'the drawer stayed on screen after Cancel').not.toBe('none');
    });
}

// THE ONE THAT CAUGHT IT. Nothing is blocked here — this is an ordinary page
// load. Under `--project=webkit` it fails against the pre-fix markup at 1440px
// and passes at 420px, which is what proves the fix addresses the reported bug
// rather than a hypothetical one.
test('/bill.html — the drawer is 420px on an ordinary load, in every engine', async ({ page }) => {
    // The fix adds real CSS BESIDE the utilities rather than replacing them, so
    // the styled appearance has to be identical to what shipped in Chromium.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/bill.html');
    await page.waitForFunction(() => !!window.FluxyBudgetAssignment, null, { timeout: 30000 });
    await openAssignmentDrawer(page);
    await page.waitForTimeout(500);

    const box = await page.evaluate(() => {
        const c = getComputedStyle(document.getElementById('fbx-assignment-drawer'));
        return { tailwind: !!window.tailwind, position: c.position, width: parseFloat(c.width) };
    });
    expect(box.tailwind).toBe(true);
    expect(box.position).toBe('fixed');
    expect(box.width).toBe(420);

    await expect(page.locator('#fbx-assignment-title')).toHaveText(/allocation|alokasi/i);
    await expect(page.locator('#fbx-assignment-vendor')).toHaveText('AWS');
    // Save stays disabled until a reason is given. The reason IS the point of
    // this drawer — it is what lands in the audit log — so an empty one is not
    // a saveable state.
    await expect(page.locator('#fbx-assignment-submit')).toBeDisabled();
});
