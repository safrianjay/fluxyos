'use strict';

const { expect } = require('@playwright/test');

// =============================================================================
// The workspace's business_category, for specs that need a profile other than
// the one the QA workspace has.
//
// Three spec files carried byte-identical copies of this. When a real bug was
// found in the baseline logic on 2026-09-01 it had to be fixed in three places,
// which is the moment a duplicated helper stops being harmless.
//
// USE IT IN A try/finally. `setCategory` writes to a real workspace document, so
// a spec that throws between the set and the restore leaves the whole suite on
// the wrong profile — every F&B spec then fails looking for a Tables view that
// a retail till does not have.
// =============================================================================

async function workspaceReady(page) {
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.ready,
        null, { timeout: 30000 });
}

async function setCategory(page, category) {
    const err = await page.evaluate(async (cat) => {
        try {
            const [{ getFirestore, doc, updateDoc, deleteField, serverTimestamp }, { getApp }] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js')
            ]);
            const ws = window.FluxyWorkspace && window.FluxyWorkspace.id;
            if (!ws) return 'no workspace resolved';
            await updateDoc(doc(getFirestore(getApp()), `workspaces/${ws}`), {
                business_category: cat === null ? deleteField() : cat,
                updated_at: serverTimestamp()
            });
            return null;
        } catch (e) { return String(e && e.message); }
    }, category);
    expect(err, `could not set business_category=${category}`).toBeNull();
}

// The baseline, captured ONCE per worker rather than per test.
//
// Capturing per test meant the second one captured the `retail` left behind by
// the first and faithfully restored THAT — a leak that perpetuates itself and
// then fails the F&B control for a reason that looks nothing like the cause.
//
// Falls back to 'fnb', NOT to null/absent. `retail` can never be a real baseline
// (these specs are the only thing in the suite that sets it), but restoring
// "absent" is not a safe repair either: feature-access.js grants the POS by
// `allowCategories.includes(category)`, and an absent category matches nothing,
// so the workspace comes back with the till gated off by category. It only
// looked harmless because the QA user is also on `allowEmails`.
//
// Observed on 2026-09-01: a killed run left `retail`, the next run's control
// spec "restored" it to absent, and the F&B specs then ran against a workspace
// with no category at all.
let baseline;
async function captureBaseline(page) {
    const seen = await page.evaluate(() => (window.FluxyWorkspace && window.FluxyWorkspace.businessCategory) || null);
    if (baseline === undefined) baseline = (seen === 'retail' || !seen) ? 'fnb' : seen;
    return baseline;
}

module.exports = { workspaceReady, setCategory, captureBaseline };
