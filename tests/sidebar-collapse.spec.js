// @ts-check
const { test, expect } = require('@playwright/test');

// =============================================================================
// The sidebar folds to a rail, on the dashboard AND on the till.
//
// ONE IMPLEMENTATION FOR BOTH, and that is not a coincidence: `pos.html` renders
// the same `<aside id="sidebar">` and loads the same `sidebar-loader.js`,
// deliberately — its own comment says a parallel sidebar "guarantees the two
// drift apart the first time either moves". So the arrow beside the logo is one
// control that has to work on two very different screens.
//
// The width lives in `shared-dashboard.css` rather than on the element: every
// app page hardcodes `w-[220px]` on the <aside>, and an id + class + attribute
// selector beats that without touching thirty files.
// =============================================================================

const RAIL_MAX = 100;     // collapsed: an icon rail
const OPEN_MIN = 200;     // expanded: room for "Accounting Center"

async function openApp(page, url) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.waitForSelector('#sidebar-collapse-btn', { timeout: 30000 });
    // The nav is injected by script; wait for a real item before measuring.
    await expect(page.locator('#sidebar .nav-item').first()).toBeVisible({ timeout: 20000 });
}

const railWidth = (page) =>
    page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);

for (const [url, surface] of [['/dashboard', 'dashboard'], ['/pos', 'the till']]) {
    test(`the sidebar collapses and expands on ${surface}`, async ({ page }) => {
        await openApp(page, url);

        // Opens expanded at this width, with its words.
        expect(await railWidth(page)).toBeGreaterThan(OPEN_MIN);
        await expect(page.locator('#sidebar .logo-text')).toBeVisible();

        await page.click('#sidebar-collapse-btn');
        await page.waitForTimeout(300);          // the width transition

        // A rail: the labels go, the icons stay, the brand mark stays.
        expect(await railWidth(page), 'the sidebar did not fold to a rail').toBeLessThan(RAIL_MAX);
        await expect(page.locator('#sidebar .logo-text')).toBeHidden();
        await expect(page.locator('#sidebar .nav-item').first()).toBeVisible();
        await expect(page.locator('#logo-icon')).toBeVisible();
        await expect(page.locator('#sidebar-collapse-btn')).toHaveAttribute('aria-expanded', 'false');

        // ⚠️ THE LABEL BECOMES THE TOOLTIP. Collapsed, a nav item is an icon and
        // nothing else, and several of these are only identifiable to someone
        // who already knows the menu.
        const first = page.locator('#sidebar .nav-item').first();
        expect((await first.getAttribute('title') || '').length,
            'a collapsed nav item has no tooltip').toBeGreaterThan(0);

        // And back.
        await page.click('#sidebar-collapse-btn');
        await page.waitForTimeout(300);
        expect(await railWidth(page)).toBeGreaterThan(OPEN_MIN);
        await expect(page.locator('#sidebar .logo-text')).toBeVisible();
    });
}

test('THE CHOICE SURVIVES NAVIGATION', async ({ page }) => {
    // This is a multi-page app: without persistence the menu would spring back
    // open on every navigation and the control would be useless — a collapse
    // that lasts until you go somewhere is not a collapse.
    await openApp(page, '/dashboard');
    await page.click('#sidebar-collapse-btn');
    await page.waitForTimeout(300);
    expect(await railWidth(page)).toBeLessThan(RAIL_MAX);

    await page.goto('/ledger');
    await page.waitForSelector('#sidebar-collapse-btn', { timeout: 30000 });
    await expect(page.locator('#sidebar .nav-item').first()).toBeVisible({ timeout: 20000 });
    expect(await railWidth(page), 'the sidebar sprang back open on the next page')
        .toBeLessThan(RAIL_MAX);

    // ⚠️ AND IT IS APPLIED BEFORE PAINT, not by a listener afterwards. The
    // sidebar is injected by script, so the attribute is set in the same task as
    // the markup — otherwise every navigation would flash the full menu.
    await expect(page.locator('#sidebar')).toHaveAttribute('data-collapsed', '1');

    // It reaches the till too — same element, same loader, same preference.
    await page.goto('/pos');
    await page.waitForSelector('#sidebar-collapse-btn', { timeout: 30000 });
    await expect(page.locator('#sidebar .nav-item').first()).toBeVisible({ timeout: 20000 });
    expect(await railWidth(page), 'the till did not honour the stored choice')
        .toBeLessThan(RAIL_MAX);

    await page.click('#sidebar-collapse-btn');   // leave it as we found it
    await page.waitForTimeout(200);
});

test('a phone gets the drawer, not a rail of unlabelled icons', async ({ page }) => {
    // Below 640px the sidebar is already a full-width drawer that slides over
    // the page. An 80px rail there would be unlabelled icons covering the screen
    // it just came from — neither of the two things this control is for.
    await openApp(page, '/dashboard');
    await page.click('#sidebar-collapse-btn');
    await page.waitForTimeout(300);
    expect(await railWidth(page)).toBeLessThan(RAIL_MAX);

    await page.setViewportSize({ width: 420, height: 800 });
    await page.waitForTimeout(300);
    // ⚠️ MEASURED FROM THE COMPUTED STYLE, not the box. Below 640px the sidebar
    // is `display: none` until the drawer is opened, so its rect is 0 and would
    // pass a "less than a rail" check for entirely the wrong reason.
    const w = await page.locator('#sidebar')
        .evaluate((el) => parseFloat(getComputedStyle(el).width));
    expect(w, 'the phone drawer opens as an icon rail').toBeGreaterThan(OPEN_MIN);
    await expect(page.locator('#sidebar-collapse-btn')).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await page.click('#sidebar-collapse-btn');   // leave it expanded
    await page.waitForTimeout(200);
});
