const { test, expect } = require('@playwright/test');

// Live smoke for `fixed_assets` against the real QA workspace and the DEPLOYED
// ruleset. The emulator spec proves the rules are correct; this proves they are
// live — a collection whose rules are not deployed rejects every write, and no
// local test can see it.
//
// Registers an asset and disposes it (delete is denied by design, because the
// asset is referenced by every depreciation journal it generated). Idempotent by
// name: a re-run adds another disposed row and nothing active.

test('fixed_assets writes are permitted by the DEPLOYED rules', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        ds.setActor(uid);

        try {
            const saved = await ds.saveFixedAsset(uid, {
                name: `QA SMOKE ASSET ${Date.now()}`,
                asset_account_code: '1500',
                cost: 12_000_000,
                salvage_value: 0,
                useful_life_months: 24,
                in_service_date: '2026-01-01'
            }, { create: true });

            const listed = await ds.listFixedAssets(uid);
            const found = listed.find((a) => a.id === saved.id);

            // Dispose it so the register is not left with QA rows in it. Status,
            // never delete — the rules refuse a delete for a reason.
            await ds.saveFixedAsset(uid, {
                ...saved, name: saved.name, status: 'disposed'
            }, { create: false, assetId: saved.id });

            return {
                ok: true,
                id: saved.id,
                cost: found ? found.cost : null,
                accumulated: found ? found.accumulated_depreciation : null,
                posted: found ? found.last_depreciated_period : 'missing'
            };
        } catch (e) {
            return { ok: false, error: String((e && (e.code || e.message)) || e) };
        }
    });

    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(12_000_000);
    // A fresh asset has posted NOTHING. These two fields record what reached the
    // ledger, never what the schedule says is owed — the gap between them is the
    // whole reason they exist.
    expect(r.accumulated).toBe(0);
    expect(r.posted).toBeNull();
});
