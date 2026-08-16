const { test, expect } = require('@playwright/test');

// Live smoke test for the `items` collection against the real QA workspace.
//
// The emulator spec proves the RULES are correct; this proves they are DEPLOYED.
// Those are different claims, and the gap between them is what nearly broke
// every posting in production on 2026-08-16 — a batch write to a collection
// whose rules were not live fails atomically, and no local test can see it.
//
// This is the "verify it actually took" step that
// `tests/deploy-stamp.check.js` tells you to run before stamping.
//
// Writes one item and archives it (delete is denied by design), so it is
// idempotent by name_key and leaves no active row behind.

test('items writes are permitted by the DEPLOYED rules', async ({ page }) => {
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

        const NAME = 'QA Smoke Flour';
        const out = { created: null, converted: null, archived: null, error: null };
        try {
            // Reuse the row if a previous run left one — items cannot be deleted.
            const existing = (await ds.getItems(uid, { includeArchived: true }))
                .find((i) => i.name === NAME);

            const item = existing
                ? await ds.saveItem(uid, {
                    name: NAME, type: 'stock', base_unit: 'g',
                    units: [{ code: 'kg', factor: 1000, role: 'purchase' }]
                }, { itemId: existing.id })
                : await ds.saveItem(uid, {
                    name: NAME, type: 'stock', base_unit: 'g',
                    units: [{ code: 'kg', factor: 1000, role: 'purchase' }],
                    sku: `QA-SMOKE-${Date.now()}`
                }, { create: true });

            out.created = { id: item.id, base_unit: item.base_unit, type: item.type };

            // The engine reads back what Firestore stored, not the local draft.
            const { toBase } = await import('/assets/js/inventory-engine.js');
            const stored = (await ds.getItems(uid, { includeArchived: true })).find((i) => i.id === item.id);
            out.converted = toBase(stored, 2, 'kg');

            const arch = await ds.archiveItem(uid, item.id);
            out.archived = arch.status;
        } catch (e) {
            out.error = `${e.code || ''} ${e.message || e}`.trim();
        }
        return out;
    });

    // A rules-not-deployed failure surfaces here as permission-denied.
    expect(r.error, 'writing an item must be permitted by the live rules').toBeNull();
    expect(r.created).not.toBeNull();
    expect(r.created.type).toBe('stock');
    expect(r.created.base_unit).toBe('g');
    // Round-trips through Firestore: 2 kg stored against a gram base is 2000.
    expect(r.converted, 'unit conversion works on the doc as Firestore returned it').toBe(2000);
    expect(r.archived).toBe('archived');
});
