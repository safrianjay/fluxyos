const { test, expect } = require('@playwright/test');

// Account-mapping recommendations by business category (Flow tab, row 5).
//
// The platform default files every business's "Operations" spend under 6400
// Operations Expense. For a restaurant that spend is mostly ingredients, which
// are COST OF REVENUE — and because gross margin is computed from accounts whose
// sak_category is `cogs`, a workspace with nothing mapped there cannot show
// gross margin at all. Not missing data: the default filed it as overhead.
//
// These RECOMMEND. Nothing here changes a posting default — the two default maps
// (ACCOUNTING_CATEGORY_DEFAULTS / CATEGORY_DEFAULTS) are untouched, because
// changing them by business category would silently move costs between overhead
// and cost of revenue on books that already exist and restate every gross margin
// ever shown. A recommendation becomes real only when saved as a mapping, which
// resolveExpenseAccount consults ahead of the defaults.

test.describe.configure({ timeout: 180_000 });

/*
 * Archive any saved Operations mapping.
 *
 * Called BEFORE the assertions as well as after. A recommendation only exists
 * while the row does not already point at the recommended account, so a run that
 * inherits the mapping its own previous run saved would find nothing to click —
 * which is exactly how this spec failed the second time it ran. Establishing the
 * precondition is the spec's job, not the workspace's.
 */
async function clearOperationsMapping(page) {
    return page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const { resolveDb } = await import('/assets/js/firestore-db.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        const wsId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || uid;
        // Deterministic id, the same shape saveAccountingMapping builds.
        const ref = doc(resolveDb(app), `workspaces/${wsId}/accounting_mappings/transaction_category__operations`);
        await setDoc(ref, { status: 'archived', updated_at: serverTimestamp() }, { merge: true });
        const maps = await ds.getAccountingMappings(uid);
        return !maps.some((m) => m.source_type === 'transaction_category' && m.source_value === 'Operations');
    });
}

test('a recommendation is offered only where it differs and the business has one', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/mapping-suggestions.js');
        const rec = (businessCategory, sourceValue, currentCode, sourceType = 'transaction_category') =>
            m.recommendationFor({ businessCategory, sourceType, sourceValue, currentCode });
        return {
            fnbOps: rec('fnb', 'Operations', '6400'),
            retailOps: rec('retail', 'Operations', '6400'),
            manufacturingOps: rec('manufacturing', 'Operations', '6400'),
            startupInfra: rec('startup', 'Infrastructure', '6300'),
            technologyInfra: rec('technology', 'Infrastructure', '6300'),
            // Already there → not a recommendation.
            alreadyApplied: rec('fnb', 'Operations', '5100'),
            // No recommendation for this business.
            servicesOps: rec('services', 'Operations', '6400'),
            otherOps: rec('other', 'Operations', '6400'),
            // Unstamped workspace.
            unstamped: rec(null, 'Operations', '6400'),
            // A category this business has no opinion about.
            fnbMarketing: rec('fnb', 'Marketing', '6100'),
            // Type-driven rows are never recommended against.
            typeRow: rec('fnb', 'income', '4000', 'transaction_type')
        };
    });

    expect(r.fnbOps.code).toBe('5100');
    expect(r.fnbOps.why).toContain('Ingredients');
    expect(r.retailOps.code).toBe('5100');
    expect(r.manufacturingOps.code).toBe('5100');
    // The contribution-margin case the review actually asked for.
    expect(r.startupInfra.code).toBe('5100');
    expect(r.startupInfra.why).toContain('contribution-margin');
    expect(r.technologyInfra.code).toBe('5100');

    // "Use this" must never appear next to something already applied.
    expect(r.alreadyApplied).toBeNull();
    // No guess is better than a coin flip wearing a reason: an agency's
    // "Operations" is far too broad to assume is cost of revenue.
    expect(r.servicesOps).toBeNull();
    expect(r.otherOps).toBeNull();
    expect(r.unstamped).toBeNull();
    expect(r.fnbMarketing).toBeNull();
    expect(r.typeRow).toBeNull();
});

test('the recommendation reaches the mapping tab and applying it saves a mapping', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) errors.push(m.text());
    });

    // The workspace's own category decides this, so it is stubbed rather than
    // written — the QA workspace's real category is not this spec's to change.
    await page.addInitScript(() => {
        const apply = () => { if (window.FluxyWorkspace) window.FluxyWorkspace.businessCategory = 'fnb'; };
        apply();
        setInterval(apply, 50);
    });

    await page.goto('/accounting?tab=mapping');
    await page.waitForSelector('#mapping-preview-content', { timeout: 60000 });

    // Precondition: Operations must NOT already be mapped, or there is no
    // recommendation to offer. Cleared rather than assumed.
    expect(await clearOperationsMapping(page), 'precondition: Operations unmapped').toBe(true);

    // The preview only lists sources SEEN in the period, so the row has to exist
    // before it can be recommended against. Created here rather than assumed:
    // a spec that skips when the data is absent proves nothing.
    const made = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const uid = getAuth(app).currentUser.uid;
        const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        await ds.addTransactions(uid, [{
            vendor_name: `QA MAP ${Date.now()}`,
            amount: 25000,
            category: 'Operations',
            type: 'expense',
            status: 'Completed',
            icon: '💸',
            timestamp: Timestamp.fromDate(new Date())
        }]);
        return true;
    });
    expect(made).toBe(true);

    await page.reload();
    await page.waitForSelector('#mapping-preview-content', { timeout: 60000 });
    await page.waitForFunction(
        () => document.querySelectorAll('#mapping-preview-content .acct-row').length > 0,
        undefined, { timeout: 60000 }
    );
    await page.waitForTimeout(1500);

    const rec = page.locator('[data-mapping-rec]').first();
    await expect(rec).toBeVisible();
    // It says WHAT CHANGES, not just where to file it — a recommendation nobody
    // understands is one nobody applies.
    await expect(rec).toContainText('5100');
    await expect(rec).toContainText('gross margin');

    // Applying goes through the same save path as a hand-picked mapping, so a
    // recommendation can never be applied in a way a manual choice could not.
    await rec.locator('[data-mapping-apply]').click();

    // Saving a mapping is a deliberate action and asks first — applying a
    // recommendation goes through the SAME confirm as a hand-picked one, which
    // is the point of routing both through handleMappingSave.
    await page.waitForSelector('#fluxy-dialog [data-dialog-action="confirm"]', { timeout: 15000 });
    await expect(page.locator('#fluxy-dialog')).toContainText('5100');
    await page.locator('#fluxy-dialog [data-dialog-action="confirm"]').click();
    await page.waitForTimeout(4000);

    const saved = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const ds = new DataService(app);
        const maps = await ds.getAccountingMappings(getAuth(app).currentUser.uid);
        const ops = maps.find((m) => m.source_type === 'transaction_category' && m.source_value === 'Operations');
        return ops ? ops.target_account_code : null;
    });
    expect(saved).toBe('5100');

    // ── Restore ────────────────────────────────────────────────────────────
    //
    // MANDATORY, not tidiness. `suggestAccountForEntry` reads live mappings, so
    // leaving Operations → 5100 saved in the QA workspace changes what the
    // ENTRY DRAWER pre-fills — and breaks
    // `tests/keyword-account-rule.spec.js`, which asserts Operations falls back
    // to the 6400 category default when no keyword rule matches. A spec that
    // writes shared state and does not put it back is a spec that fails a
    // different file.
    expect(await clearOperationsMapping(page), 'the Operations mapping was put back').toBe(true);

    expect(errors).toEqual([]);
});
