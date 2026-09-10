// @ts-check
const { test, expect } = require('@playwright/test');
const { archiveQaOutlets } = require('./helpers/qa-outlets');

// =============================================================================
// Outlets can be renamed and retired from a screen.
//
// Until this shipped they could not. `saveDimension` and `archiveDimension` had
// existed since the dimension seam landed and NOTHING called them — an outlet
// could only be created as a side effect of receiving stock, and
// `docs/data-model/dimensions.md` said so in words: "there is no dedicated
// outlet-management screen — renaming or archiving an outlet is DAL-only."
//
// ⚠️ NOTHING IS EVER DELETED. Journal lines posted against a dimension are
// immutable and have to keep resolving to it, so the only retirement is a soft
// archive — and the screen therefore has to be able to UN-archive, or it is a
// one-way door built by accident.
//
// This spec builds its own outlet and reverses it, per the standing rule that a
// spec seeds and cleans up rather than depending on what happens to be there.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

const NAME = `QA Outlet ${Date.now()}`;
const RENAMED = `${NAME} Renamed`;

// ⚠️ A DIALOG, NOT A CARD. Every section on that page describes ONE outlet, so
// a list of all of them sitting among those sections made the page say two
// different things about its own scope. It is entered from a gear button
// beside the outlet dropdown — the control it is about.
async function openSettings(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/settings-pos');
    await page.waitForSelector('#pos-outlets-btn', { timeout: 40000 });
    await expect(page.locator('#pos-outlet-count')).not.toBeEmpty({ timeout: 30000 });
    await page.locator('#pos-outlets-btn').click();
    await expect(page.locator('#pos-outlets-dialog')).toBeVisible();
}

/** The row for one outlet, found by name through the filter. */
async function rowFor(page, name) {
    // Actions inside the dialog leave it open; only creating the workspace's
    // FIRST outlet closes it, to land the user on the settings they came for.
    if (await page.locator('#pos-outlets-dialog.hidden').count()) {
        await page.locator('#pos-outlets-btn').click();
    }
    await page.locator('#pos-outlet-filter').fill(name);
    // The filter only appears once the list is long enough to need it; on a
    // small workspace the row is simply there.
    const row = page.locator('#pos-outlet-list [data-outlet]', { hasText: name });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    return row;
}

test('the outlets dialog is entered from beside the outlet dropdown', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/settings-pos');
    await page.waitForSelector('#pos-outlets-btn', { timeout: 40000 });
    // ⚠️ THE BUTTON IS STATIC MARKUP; the handler is bound after the outlets
    // load. Clicking on sight is clicking before it does anything.
    await expect(page.locator('#pos-outlet-count')).not.toBeEmpty({ timeout: 30000 });

    // Closed until asked for: the page is about the SELECTED outlet.
    await expect(page.locator('#pos-outlets-dialog')).toBeHidden();
    // Beside the control it is about, not somewhere else on the page.
    const near = await page.evaluate(() => {
        const b = document.getElementById('pos-outlets-btn').getBoundingClientRect();
        const s = document.getElementById('pos-outlet').getBoundingClientRect();
        return { toTheRight: b.left >= s.right - 1, sameRow: Math.abs(b.top - s.top) < 24 };
    });
    expect(near.toTheRight && near.sameRow, 'the button is not beside the dropdown').toBe(true);

    await page.locator('#pos-outlets-btn').click();
    await expect(page.locator('#pos-outlets-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pos-outlets-dialog')).toBeHidden();
});

test('AN OUTLET CAN BE ADDED, RENAMED AND RETIRED FROM THE SCREEN', async ({ page }) => {
    await openSettings(page);

    // ── Create ──────────────────────────────────────────────────────────
    await page.locator('#pos-outlet-new').fill(NAME);
    await page.locator('#pos-outlet-add').click();
    await expect(await rowFor(page, NAME)).toBeVisible();
    // …and it reaches the picker this page configures, not just the list.
    await expect(page.locator('#pos-outlet option', { hasText: NAME })).toHaveCount(1);

    // ── Rename ──────────────────────────────────────────────────────────
    // `name_key` stays immutable by design, so this changes what people READ
    // and nothing the books resolve through.
    let row = await rowFor(page, NAME);
    await row.locator('[data-rename]').click();
    await page.locator('[data-rename-input]').fill(RENAMED);
    await page.locator('[data-rename-save]').click();
    await expect(await rowFor(page, RENAMED)).toBeVisible();
    await expect(page.locator('#pos-outlet option', { hasText: RENAMED })).toHaveCount(1);

    // ── Archive takes two taps ──────────────────────────────────────────
    // It pulls an outlet out of the till, every picker and this page; a mis-tap
    // on a settings screen should not do that silently.
    row = await rowFor(page, RENAMED);
    await row.locator('[data-archive]').click();
    await expect(row.locator('[data-archive]')).toHaveText('Tap again to archive');
    await row.locator('[data-archive]').click();

    row = await rowFor(page, RENAMED);
    await expect(row, 'an archived outlet is not marked as one').toContainText('archived');
    await expect(page.locator('#pos-outlet option', { hasText: RENAMED }),
        'an archived outlet is still offered for configuration').toHaveCount(0);

    // ⚠️ AND IT COMES BACK. A screen that can archive but not restore is a
    // one-way door, and the only way out of it would be the console.
    await row.locator('[data-restore]').click();
    row = await rowFor(page, RENAMED);
    await expect(row).not.toContainText('archived');
    await expect(page.locator('#pos-outlet option', { hasText: RENAMED })).toHaveCount(1);

    // Leave the workspace as we found it.
    await row.locator('[data-archive]').click();
    await row.locator('[data-archive]').click();
    await expect(await rowFor(page, RENAMED)).toContainText('archived');
});

test('AN OUTLET WITH UNSETTLED ORDERS CANNOT BE ARCHIVED', async ({ page }) => {
    // ⚠️ THE ONE THAT PROTECTS MONEY. The till filters archived outlets out, so
    // archiving one that still has live tickets makes them unreachable AND
    // unpaid — stranded by a settings click, with nothing anywhere reporting it.
    const name = `QA Guard ${Date.now()}`;
    await openSettings(page);
    await page.locator('#pos-outlet-new').fill(name);
    await page.locator('#pos-outlet-add').click();
    const row = await rowFor(page, name);

    // A takeaway order needs no table, which keeps this fixture to one write.
    // Seeded through the app's own DAL, the way every other spec here does —
    // the page exposes no test hook and should not grow one for this.
    const orderId = await page.evaluate(async (outletName) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        const dim = (await ds.getDimensions(uid)).find((d) => d.name === outletName);
        const order = await ds.createPosOrder(uid, { dimensionId: dim.id, channel: 'staff' });
        return order.id;
    }, name);
    expect(orderId, 'could not seed an order — the guard would be untested').toBeTruthy();

    await row.locator('[data-archive]').click();
    await row.locator('[data-archive]').click();
    await expect(page.locator('#pos-outlet-error')).toBeVisible();
    await expect(page.locator('#pos-outlet-error')).toContainText('unsettled order');
    await expect(await rowFor(page, name), 'the outlet was archived anyway')
        .not.toContainText('archived');

    // Void the order, and it archives.
    await page.evaluate(async (id) => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;
        await ds.voidPosOrder(uid, id, 'Spec cleanup');
    }, orderId);
    // The page reads the guard fresh on each attempt, so the list has to be
    // repainted from the server before trying again.
    await page.reload();
    await openSettings(page);
    const again = await rowFor(page, name);
    await again.locator('[data-archive]').click();
    await again.locator('[data-archive]').click();
    await expect(await rowFor(page, name)).toContainText('archived');
});

// ⚠️ RETIRE WHAT THIS FILE CREATED — see tests/helpers/qa-outlets.js. `NAME` also
// covers `${NAME} Renamed`; the guard outlet is swept by its prefix because its
// timestamp is taken inside the test, and a failed run is exactly the case where
// it never reached the line that archives it.
//
// This hook was held back on 2026-09-10 because adding it seemed to make a test
// bounce to /login on every run. The hook was innocent: settings-pos (like 22
// other pages) sent users to /login if their session took over 2s to restore,
// and those runs were on a loaded machine. Fixed at the source; see
// tests/auth-guard-slow-restore.spec.js.
test.afterAll(async ({ browser }) => {
    await archiveQaOutlets(browser, NAME);
    await archiveQaOutlets(browser, 'QA Guard ');
});
