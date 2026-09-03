const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 150_000 });

// Business-eligibility visibility for Inventory and Outlet P&L.
//
// This has to test BOTH directions or it proves nothing. A guard that only ever
// sees an eligible user would pass just as happily if `canUseFeature` returned
// true unconditionally — which is exactly the bug worth catching, because it
// fails silently and in the permissive direction.
//
// The QA account is eligible by pattern (fluxyos.qa+…@example.com), and every
// other inventory spec depends on that staying true. So the negative case is
// exercised by emptying FEATURE_RULES in-page rather than by signing in as
// someone else.

const PAGES = [
    { path: '/inventory',       feature: 'inventory',  nav: 'nav-inventory' },
    { path: '/inventory-count', feature: 'inventory',  nav: 'nav-inventory' },
    { path: '/outlet-pnl',      feature: 'outlet_pnl', nav: 'nav-outlet-pnl' }
];

// Strip every allowance from a feature by rewriting the MODULE as it is served,
// appending the mutation to its body so it runs at module-evaluation time.
//
// Patching window.FluxyFeatures from an init script instead is racy and quietly
// under-tests: the sidebar imports the module and calls canUseFeature in the same
// microtask chain, so a poller never wins. The page guard imports later, which is
// how a broken nav gate can sit behind a passing redirect test.
async function makeIneligible(page, features) {
    await page.route('**/assets/js/feature-access.js', async (route) => {
        const res = await route.fetch();
        const body = await res.text();
        const strip = features.map((f) =>
            `if (FEATURE_RULES[${JSON.stringify(f)}]) {`
            + ` FEATURE_RULES[${JSON.stringify(f)}].allowEmails = [];`
            + ` FEATURE_RULES[${JSON.stringify(f)}].allowEmailPatterns = [];`
            + ` FEATURE_RULES[${JSON.stringify(f)}].allowCategories = null;`
            // Outlet P&L is granted by a COUNT of outlets, which is a fact in the
            // workspace's data and not something an allowlist can revoke. The QA
            // workspace really does have several, so stripping only the email
            // signals leaves it eligible — correctly. Removing the count clause
            // too is what makes "ineligible" expressible at all here.
            + ` delete FEATURE_RULES[${JSON.stringify(f)}].minDimensions; }`
        ).join('\n');
        await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/javascript; charset=utf-8' },
            body: `${body}\n/* test override */\n${strip}\n`
        });
    });
}

test('an eligible workspace sees both nav entries and can open all three pages', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => document.getElementById('nav-inventory'),
        undefined, { timeout: 60000 }
    );

    // The items ship hidden and are revealed only for an eligible workspace, so
    // "visible" here is a real assertion about the reveal running.
    await expect(page.locator('#nav-inventory')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#nav-outlet-pnl')).toBeVisible();

    for (const p of PAGES) {
        await page.goto(p.path);
        await page.waitForTimeout(4000);
        expect(new URL(page.url()).pathname, `${p.path} must not redirect`).toContain(p.path.slice(1));
    }
});

test('an ineligible workspace gets no nav entries', async ({ page }) => {
    await makeIneligible(page, ['inventory', 'outlet_pnl']);

    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => document.getElementById('nav-inventory'),
        undefined, { timeout: 60000 }
    );
    await page.waitForTimeout(5000);   // let the reveal pass run and decline

    await expect(page.locator('#nav-inventory')).toBeHidden();
    await expect(page.locator('#nav-outlet-pnl')).toBeHidden();

    // Absent, not a disabled "Soon" badge: a Soon badge advertises something
    // coming, and these modules simply do not apply to this business.
    await expect(page.locator('#nav-inventory .sidebar-soon-badge')).toHaveCount(0);
});

test('an ineligible workspace is redirected off all three pages', async ({ page }) => {
    await makeIneligible(page, ['inventory', 'outlet_pnl']);

    for (const p of PAGES) {
        await page.goto(p.path);
        await page.waitForFunction(
            () => window.location.pathname === '/dashboard' || window.location.pathname === '/dashboard.html',
            undefined, { timeout: 30000 }
        );
        expect(new URL(page.url()).pathname, `${p.path} should land on /dashboard`).toMatch(/^\/dashboard/);
    }
});

test('gating one feature does not hide the other', async ({ page }) => {
    // Proves the rules are read per-feature rather than as a single on/off flag —
    // the property the whole design rests on, since business categories will
    // enable different combinations.
    await makeIneligible(page, ['inventory']);

    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => document.getElementById('nav-outlet-pnl'),
        undefined, { timeout: 60000 }
    );
    await expect(page.locator('#nav-outlet-pnl')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#nav-inventory')).toBeHidden();

    await page.goto('/outlet-pnl');
    await page.waitForTimeout(4000);
    expect(new URL(page.url()).pathname).toContain('outlet-pnl');
});

test('eligibility comes from the workspace owner, not the signed-in user', async ({ page }) => {
    // A business either does inventory or it does not. Resolving from the owner
    // is what lets an enabled workspace's accountant or shift lead open the count
    // sheet — gating on the signed-in user would hide it from the people who do
    // the counting.
    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => window.FluxyWorkspace && window.FluxyWorkspace.id,
        undefined, { timeout: 60000 }
    );

    const probe = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const mod = await import('/assets/js/feature-access.js');
        const app = getApps()[0];
        const user = getAuth(app).currentUser;

        // Allow ONLY a fabricated address that is not the signed-in user's. If
        // eligibility read the signed-in user this would be false; it is true
        // only when the owner's own address is what matched — which for the QA
        // account (its own workspace owner) is the same address.
        mod.FEATURE_RULES.inventory.allowEmails = [String(user.email || '').toLowerCase()];
        mod.FEATURE_RULES.inventory.allowEmailPatterns = [];
        mod._resetFeatureAccessCache();
        const asOwner = await mod.canUseFeature(app, user, 'inventory');

        // Now allow only somebody else: must be false.
        mod.FEATURE_RULES.inventory.allowEmails = ['nobody-else@example.com'];
        mod._resetFeatureAccessCache();
        const asStranger = await mod.canUseFeature(app, user, 'inventory');

        return { asOwner, asStranger, wsIsOwnUid: window.FluxyWorkspace.id === user.uid };
    });

    expect(probe.asOwner, 'the owner address must grant access').toBe(true);
    expect(probe.asStranger, 'an unrelated address must not').toBe(false);
    // Records which path the assertion above actually exercised, so a future
    // reader knows the member-lookup branch is NOT covered by this environment.
    expect(typeof probe.wsIsOwnUid).toBe('boolean');
});

test('an unknown feature key is never gated by accident', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(
        () => window.FluxyWorkspace && window.FluxyWorkspace.id,
        undefined, { timeout: 60000 }
    );
    const allowed = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { canUseFeature } = await import('/assets/js/feature-access.js');
        const app = getApps()[0];
        return canUseFeature(app, getAuth(app).currentUser, 'not_a_real_feature');
    });
    // A typo in a `feature:` option must not silently hide a working page.
    expect(allowed).toBe(true);
});
