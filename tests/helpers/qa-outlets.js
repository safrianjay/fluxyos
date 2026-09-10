'use strict';

// Retire the outlets a spec created, through the app's own archive path.
//
// ⚠️ WHY THIS EXISTS. Outlets are `dimensions`, and a dimension can NEVER be
// deleted — journal lines posted against it are immutable, so `delete: if false`
// and archive is the only retirement there is. Six specs each created a fresh,
// timestamped outlet on every run and never archived it. By 2026-09-10 the QA
// workspace held 115 live outlets, every inventory picker listed all of them,
// and the one table the till specs depend on sat on one outlet in 115 — so the
// till landed somewhere else, the floor rendered empty, and two specs failed on
// every run. They had been written off as "pre-existing, data-dependent" twice.
// They were pollution, and it compounded with every run.
//
// Called from `test.afterAll`, which runs even when a test in a serial block
// has failed — a cleanup placed as the LAST TEST would be skipped in exactly the
// case it matters most, because serial mode stops at the first failure.
//
// Through the real DAL rather than a direct write, so the archive is audited
// exactly as a person archiving it from POS Settings would be.

const STORAGE_STATE = 'tests/.auth/storageState.json';

/**
 * Archive every ACTIVE outlet whose name starts with `prefix`.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} prefix  the spec's own TAG — never something broad, or one
 *                         spec would retire another's fixture mid-run
 * @returns {Promise<number>} how many were archived
 */
async function archiveQaOutlets(browser, prefix) {
    if (!prefix || prefix.length < 6) {
        // A short prefix is how a cleanup starts archiving real outlets.
        throw new Error(`archiveQaOutlets: refusing a prefix this broad: "${prefix}"`);
    }
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();
    try {
        // Any authenticated app page will do; this one is light and resolves
        // the workspace the DAL needs.
        await page.goto('/settings-pos');
        await page.waitForFunction(() => {
            try {
                // eslint-disable-next-line no-undef
                return !!(window.firebase || document.querySelector('#pos-outlet'));
            } catch (_) { return false; }
        }, null, { timeout: 30000 }).catch(() => {});

        return await page.evaluate(async (tag) => {
            const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const DataService = (await import('/assets/js/db-service.js')).default;
            const app = getApps()[0];
            const auth = getAuth(app);
            // The session restores asynchronously; wait for it rather than race it.
            if (!auth.currentUser) {
                await new Promise((resolve) => {
                    const off = auth.onAuthStateChanged((u) => { if (u) { off(); resolve(); } });
                    setTimeout(resolve, 15000);
                });
            }
            if (!auth.currentUser) return 0;
            const uid = auth.currentUser.uid;
            const ds = new DataService(app);
            ds.actorUid = uid;
            const dims = await ds.getDimensions(uid);
            const mine = dims.filter((d) => d.type === 'outlet'
                && d.status !== 'archived'
                && String(d.name || '').startsWith(tag));
            for (const d of mine) {
                await ds.archiveDimension(uid, d.id);
            }
            return mine.length;
        }, prefix);
    } catch (err) {
        // A cleanup that throws would fail the spec it is cleaning up after,
        // turning a leak into a red run. Say so and move on.
        // eslint-disable-next-line no-console
        console.warn(`archiveQaOutlets(${prefix}) did not complete:`, err && err.message);
        return 0;
    } finally {
        await context.close();
    }
}

module.exports = { archiveQaOutlets };
