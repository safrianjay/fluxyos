const { test, expect } = require('@playwright/test');

// =============================================================================
// The till's audit trail actually reaches the ledger of record.
//
// EVERY POS AUDIT WRITE WAS DENIED FROM 2026-08-21 TO 2026-09-02.
// `isValidWorkspaceAuditLog` validates `target_collection` against an allowlist
// and none of the four POS collections were on it, so all ten actions the DAL
// emits were refused — including the two that matter most in a finance product:
//
//     pos_order.refunded    money handed back out
//     pos_shift.closed      the cash count
//
// Nothing went red. `_auditCreateBestEffort` catches and warns, which is the
// right behaviour for an audit write — losing the log must never lose the sale —
// and is exactly why it went unnoticed for eleven days. The Activity Log simply
// had no POS entries, which looks identical to nobody using the till.
//
// WHY THIS SPEC EXISTS ALONGSIDE THE EMULATOR CASES. The emulator proves the
// RULE accepts the shape. It cannot prove the deployed rules do — `firestore.rules`
// does not ship with `git push`, it is a separate deploy, and this whole class of
// bug is "the code is right and the rules in production are not". This writes a
// real audit entry against live rules and reads it back.
// =============================================================================

test.describe.configure({ timeout: 240_000 });

test('a POS action writes an audit entry that survives the deployed rules', async ({ page }) => {
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });
    await page.waitForSelector('#pos-new-order:not([disabled])', { timeout: 40000 });

    const result = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;

        // The real helper the DAL uses, with the real action names. Spelled the
        // way the DAL spells them, so a renamed collection breaks this rather
        // than the trail.
        const actions = [
            ['pos_order.refunded', 'pos_orders'],
            ['pos_shift.closed', 'pos_shifts'],
            ['pos_table.created', 'pos_tables'],
            ['pos_reservation.created', 'pos_reservations']
        ];

        // `_auditCreateBestEffort` swallows failures by design, so calling it
        // would tell us nothing. `addAuditLog` is what it wraps, and it throws.
        const outcomes = {};
        for (const [action, target] of actions) {
            try {
                await ds.addAuditLog(uid, {
                    action,
                    target_collection: target,
                    target_id: `qa-${Date.now()}`,
                    before: null,
                    after: { qa: true },
                    source: 'dashboard'
                });
                outcomes[action] = 'written';
            } catch (err) {
                outcomes[action] = `DENIED: ${err.message}`;
            }
        }
        return { uid, outcomes };
    });

    for (const [action, outcome] of Object.entries(result.outcomes)) {
        expect(outcome,
            `${action} could not be logged — the deployed rules still refuse it`).toBe('written');
    }
});

test('the allowlist is still an allowlist', async ({ page }) => {
    // Widening `target_collection` to anything would make it free text and the
    // trail unfilterable — an audit log you cannot query by subject is a table
    // of strings. The fix added five names; it must not have removed the guard.
    await page.goto('/pos');
    await page.waitForSelector('#nav-container[data-till-nav]', { timeout: 25000 });

    const denied = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const ds = new mod.default(getApps()[0]);
        const uid = getAuth(getApps()[0]).currentUser.uid;
        try {
            await ds.addAuditLog(uid, {
                action: 'qa.bogus',
                target_collection: 'not_a_real_collection',
                target_id: 'x', before: null, after: {}, source: 'dashboard'
            });
            return 'ALLOWED';
        } catch (_) { return 'DENIED'; }
    });

    expect(denied, 'an unknown target_collection was accepted').toBe('DENIED');
});
