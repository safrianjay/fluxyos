// @ts-check
const { test, expect } = require('@playwright/test');

// DEPLOY VERIFICATION for the `business_category` rules change.
//
// `isValidWorkspaceProfile` uses `hasOnly([...])`, so an unlisted key is REFUSED
// OUTRIGHT — permission-denied for the whole write, not a silently dropped
// field. That makes this the sharpest possible check that the deploy actually
// took: under the previous ruleset this write fails, under the new one it
// succeeds. "Released" in the CLI output is not the same claim (CLAUDE.md).
//
// Runs as the QA owner against PRODUCTION rules, which is the point — the
// emulator suite already passes locally and would pass whether or not anything
// reached the server.
//
// It writes `business_category: 'fnb'` to the QA workspace. That is the correct
// value for it (`scripts/seed-fnb-demo.js` seeds this account as a restaurant)
// and it is additive: the QA account already qualifies for POS through the email
// pattern, so nothing about the other specs changes.

test('a client can write business_category — proves the new rules are live', async ({ page }) => {
    await page.goto('/ledger.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const DataService = (await import('/assets/js/db-service.js')).default;

        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const ds = new DataService(app);
        ds.actorUid = user.uid;

        const out = { wsId: window.FluxyWorkspace.id, wrote: null, readBack: null, error: null, rejected: null };

        try {
            out.wrote = await ds.saveWorkspaceBusinessCategory(user.uid, 'fnb');
        } catch (e) {
            out.error = String((e && e.message) || e);
            return out;
        }

        // Read the doc back from the SERVER, not the SDK cache — a local write is
        // optimistically applied to the cache even when the server refuses it, so
        // a cached read would report success for a rejected write.
        const snap = await getDoc(doc(getFirestore(app), `workspaces/${out.wsId}`));
        out.readBack = (snap.data() || {}).business_category || null;

        // The other half of the boundary: a value outside the vocabulary must be
        // refused by RULES, not merely by the DAL's own allowlist. Bypass the DAL
        // and write directly, so this tests the deployed rule rather than the
        // client guard sitting in front of it.
        try {
            const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            await setDoc(doc(getFirestore(app), `workspaces/${out.wsId}`),
                { business_category: 'not-a-category' }, { merge: true });
            out.rejected = false;   // accepted — the rule is NOT enforcing the enum
        } catch (_) {
            out.rejected = true;    // refused, as the deployed rule should
        }
        return out;
    });

    expect(r.error, `write refused — the new rules are probably NOT deployed: ${r.error}`).toBeNull();
    expect(r.wrote).toBe('fnb');
    expect(r.readBack, 'server read-back must show the stamped category').toBe('fnb');
    expect(r.rejected, 'an out-of-vocabulary category must be refused by rules').toBe(true);
});
