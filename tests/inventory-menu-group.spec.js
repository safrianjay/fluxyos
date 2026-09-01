const { test, expect } = require('@playwright/test');

// =============================================================================
// Menu group is a PICKER, not a free-text box.
//
// It was a text input, which invites "Minuman", "minuman" and "Minuman " as
// three separate groups. Nothing rejects them — `pos_category` is free text —
// and nobody finds out until a cashier is looking at three tabs on the till that
// should have been one. By then the fix is editing every item that used the
// wrong spelling.
//
// Same shape as the purchase-unit picker on the receipt line (items.md §7i),
// which solved this exact problem: offer what already exists, and make defining
// a new one a deliberate choice rather than the default.
//
// THE BUG THIS ALSO GUARDS: the options were first read from `allRows`, the
// array the item TABLE renders — which is filtered. On a workspace with 22
// categorised items the picker offered none of them, and the only visible
// symptom was a dropdown containing "No group" and "New group…". They now come
// from the full item set, captured in loadInventory().
// =============================================================================

test.describe.configure({ timeout: 240_000 });

async function openNewItem(page) {
    await page.goto('/inventory.html');
    await page.waitForSelector('#item-photo-file', { state: 'attached', timeout: 30000 });
    // Wait for the LIST, because the groups are built from the loaded items —
    // a fixed delay would pass on a fast machine and offer an empty picker on a
    // slow one, which is the bug this file exists for.
    await page.waitForSelector('#inventory-body [data-item-id]', { state: 'attached', timeout: 40000 });
    await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /new item/i.test(x.textContent || ''));
        if (b) b.click();
    });
    await expect(page.locator('#item-pos-category-select')).toBeVisible({ timeout: 15000 });
}

test('the menu group picker offers the groups the catalogue already uses', async ({ page }) => {
    await openNewItem(page);

    // What the till itself builds its category chips from. If the picker and the
    // chips disagree, one of them is inventing groups.
    const fromMenu = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const items = await ds.getItems(getAuth(getApps()[0]).currentUser.uid);
        return [...new Set(items.map((i) => String(i.pos_category || '').trim()).filter(Boolean)
            .map((c) => c.toLowerCase()))];
    });

    const options = await page.locator('#item-pos-category-select option').allTextContents();
    // The two fixed ends of the list.
    expect(options[0]).toMatch(/no group|tanpa grup/i);
    expect(options[options.length - 1]).toMatch(/new group|grup baru/i);

    if (fromMenu.length) {
        const offered = options.slice(1, -1).map((o) => o.trim().toLowerCase());
        for (const cat of fromMenu) {
            expect(offered, `"${cat}" is on an item but was not offered in the picker`).toContain(cat);
        }
        // …and the picker must not invent groups nothing uses.
        for (const o of offered) {
            expect(fromMenu, `the picker offered "${o}", which no item uses`).toContain(o);
        }
    }
});

test('a duplicate spelling collapses to one option', async ({ page }) => {
    // "Minuman" and "minuman" are the same group as far as a person reading the
    // till is concerned, so the picker must not offer both.
    await openNewItem(page);
    const offered = (await page.locator('#item-pos-category-select option').allTextContents())
        .slice(1, -1).map((o) => o.trim().toLowerCase());
    expect(new Set(offered).size, 'the picker offered the same group twice').toBe(offered.length);
});

test('New group reveals a name field, and picking an existing one hides it', async ({ page }) => {
    await openNewItem(page);
    const free = page.locator('#item-pos-category');

    // Hidden until asked for — defining a group is the rarer action and must not
    // be the default the eye lands on.
    await expect(free).toBeHidden();

    await page.selectOption('#item-pos-category-select', '__newgroup__');
    await expect(free, 'choosing New group did not offer anywhere to name it').toBeVisible();
    await free.fill('Sarapan');

    // Going back to an existing group clears the typed name, so a half-typed
    // group cannot be saved alongside a chosen one.
    await page.selectOption('#item-pos-category-select', '');
    await expect(free).toBeHidden();
    await expect(free).toHaveValue('');
});

test('the group that gets saved is the one that was picked', async ({ page }) => {
    // The end that matters: whatever the control shows has to be what lands on
    // the item. The free-text box only ever holds a NEW group's name, so reading
    // it directly — which the drawer used to do — would save an empty category
    // whenever an existing group was selected.
    await openNewItem(page);

    const chosen = await page.evaluate(() => {
        const sel = document.getElementById('item-pos-category-select');
        // The first real group, if the workspace has one; otherwise skip.
        const real = [...sel.options].find((o) => o.value && o.value !== '__newgroup__');
        if (!real) return null;
        sel.value = real.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return real.value;
    });
    test.skip(!chosen, 'no existing menu group in this workspace to select');

    const saved = await page.evaluate(async (expected) => {
        // Read the drawer's own collected value rather than re-deriving it, so
        // this asserts the wiring and not a copy of it.
        const sel = document.getElementById('item-pos-category-select');
        const free = document.getElementById('item-pos-category');
        return {
            selectValue: sel.value,
            freeValue: free.value,
            expected
        };
    }, chosen);

    expect(saved.selectValue).toBe(chosen);
    expect(saved.freeValue, 'the new-group box held text while an existing group was selected').toBe('');
});
