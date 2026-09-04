const { test, expect } = require('@playwright/test');

// Live smoke for `holds_stock` on the workspace doc, against the real QA
// workspace and the DEPLOYED ruleset.
//
// The emulator spec proves the rules are CORRECT; this proves they are LIVE.
// Those are different claims, and for this field the gap is total rather than
// partial: `isValidWorkspaceProfile` uses keys().hasOnly([...]), so an
// undeployed ruleset rejects a write carrying holds_stock IN ITS ENTIRETY — the
// whole workspace document, not the field. Onboarding would fail outright, and
// no local test can see it.
//
// Sets `true`, which is also the correct answer for the QA workspace: it holds
// inventory items. So the verification leaves right data behind rather than
// test residue.

test('holds_stock is accepted by the DEPLOYED rules', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { doc, getDoc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const { resolveDb } = await import('/assets/js/firestore-db.js');
        const app = getApps()[0];
        const db = resolveDb(app);
        const wsId = window.FluxyWorkspace.id;

        try {
            await setDoc(doc(db, `workspaces/${wsId}`), {
                holds_stock: true,
                // Its twin, verified in the same write: hasOnly means ONE
                // unlisted key rejects the whole document, so a partial deploy
                // looks exactly like a total one.
                sells_at_counter: true,
                updated_at: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            return { ok: false, error: String((e && e.code) || e) };
        }
        const after = await getDoc(doc(db, `workspaces/${wsId}`));
        return { ok: true, stored: after.data().holds_stock, counter: after.data().sells_at_counter };
    });

    // A permission-denied here means the ruleset in production does not yet
    // carry the key — which is exactly the state that would break onboarding.
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.stored).toBe(true);
    expect(r.counter).toBe(true);
});

test('the workspace snapshot surfaces it to feature-access', async ({ page }) => {
    // The write is only half of it: eligibility reads `holdsStock` off the
    // snapshot, and a field the resolver does not copy across is invisible
    // however correctly it was stored.
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.ready, { timeout: 30000 });
    const snap = await page.evaluate(() => ({
        holds: window.FluxyWorkspace.holdsStock,
        counter: window.FluxyWorkspace.sellsAtCounter
    }));
    expect(snap.holds).toBe(true);
    expect(snap.counter).toBe(true);
});
