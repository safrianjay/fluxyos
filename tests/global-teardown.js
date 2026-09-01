'use strict';

const { chromium } = require('@playwright/test');
const fs = require('fs');

// =============================================================================
// Void the till orders the suite left behind.
//
// THE PROBLEM THIS SOLVES. Specs create real orders in a real workspace and only
// some of them clean up — a spec that fails mid-way never reaches its own void.
// Those leftovers are not inert: the parked-sales list, the floor plan's free
// tables and the Orders board all read from "every non-terminal order", so one
// spec's residue becomes the next spec's input. It cost a run on 2026-09-01,
// where two pos-hold specs failed on ordering and passed 4/4 alone.
//
// It also accumulates: by that morning the workspace held 68 stray orders, and
// specs had started writing code to work AROUND them (pos-header frees a table
// by voiding somebody else's order, because the floor never has a free one).
// That is a fixture problem quietly becoming product-test logic.
//
// SAFE BY CONSTRUCTION:
//   · Only `open` / `submitted` / `sent` / `ready` / `served` — never anything
//     with money on it. `awaiting_payment` has had a payment partially applied
//     and `paid` has posted revenue; both are a refund's job, not a sweep's.
//   · Voids through the app's own DAL, so rules, the audit log and the version
//     guard all apply exactly as they would to a cashier.
//   · Never fails the run. A teardown that turns a green suite red because it
//     could not tidy up is worse than the mess.
// =============================================================================

const VOIDABLE = ['open', 'submitted', 'sent', 'ready', 'served'];

module.exports = async () => {
    const state = 'tests/.auth/storageState.json';
    if (!fs.existsSync(state)) return;                 // auth never ran; nothing to do

    let browser;
    try {
        browser = await chromium.launch();
        const page = await browser.newContext({
            storageState: state,
            baseURL: 'http://127.0.0.1:8765'
        }).then((c) => c.newPage());

        await page.goto('/pos', { timeout: 30000 });
        await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.ready,
            null, { timeout: 30000 });

        const result = await page.evaluate(async (voidable) => {
            const [{ getApp }, { getAuth }, dsMod, fs2] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
                import('/assets/js/db-service.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
            ]);
            const app = getApp();
            const ds = new dsMod.default(app);
            const uid = getAuth(app).currentUser.uid;
            const scope = `workspaces/${window.FluxyWorkspace.id}`;

            const snap = await fs2.getDocs(fs2.collection(fs2.getFirestore(app), `${scope}/pos_orders`));
            const stray = [];
            snap.forEach((d) => { if (voidable.includes((d.data() || {}).status)) stray.push(d.id); });

            let voided = 0, failed = 0;
            for (const id of stray) {
                try { await ds.voidPosOrder(uid, id, 'Spec teardown'); voided += 1; }
                catch (_) { failed += 1; }
            }
            return { found: stray.length, voided, failed };
        }, VOIDABLE);

        if (result.found) {
            console.log(`\n[teardown] till orders left by the run: ${result.found} found, `
                + `${result.voided} voided${result.failed ? `, ${result.failed} failed` : ''}`);
        }
    } catch (err) {
        // Reported, never thrown. See the header.
        console.log(`\n[teardown] skipped: ${String(err && err.message).slice(0, 120)}`);
    } finally {
        await browser?.close().catch(() => {});
    }
};
