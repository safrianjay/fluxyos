// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// =============================================================================
// PHASE 2 GATE — a real sign-in on the live till origin.
//
// Everything else about pos.fluxyos.com was verifiable with curl: DNS, TLS,
// which pages serve, which 301 away, that the source tree is absent, that the
// auth proxy answers. None of that proves the thing the origin exists for —
// that a person can sign in and reach the till.
//
// It is also the only test of the login fix. `goToApp` hardcoded
// `/dashboard`, which on this origin 301s to dashboard.fluxyos.com, so a
// successful sign-in threw you straight off the till. That shipped, and nothing
// caught it because no test signs in anywhere but localhost.
//
// OPT-IN. Not part of `npm run qa`: it depends on live DNS, a live certificate
// and production Firebase, so a failure here is often the internet rather than
// the code — exactly the kind of test that trains people to ignore red.
//
//   npx playwright test tests/till-origin-live.spec.js --project=chromium
//
// DNS is pinned at the browser rather than trusted from the OS. The record was
// queried before it existed, so resolvers around here cached NXDOMAIN for the
// zone's 1800s negative TTL. Pinning skips that; it does NOT weaken the test,
// because TLS still validates the real certificate against the real hostname —
// a wrong or missing cert still fails.
// =============================================================================

const TILL = 'https://pos.fluxyos.com';
const DASHBOARD_HOST = 'dashboard.fluxyos.com';

// Netlify's edge for this site. Only used to skip a stale local resolver.
const EDGE_IP = process.env.TILL_EDGE_IP || '13.215.239.219';

test.use({
    storageState: { cookies: [], origins: [] },   // Firebase auth is per-origin: sign in fresh
    baseURL: TILL,
    ignoreHTTPSErrors: false,                      // the certificate is part of what is being proven
    launchOptions: {
        args: [`--host-resolver-rules=MAP pos.fluxyos.com ${EDGE_IP}`],
    },
});

test.describe.configure({ timeout: 180_000 });

function qaCredentials() {
    const p = path.join(__dirname, '..', '.qa', 'firebase-test-account.md');
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    return email && password ? { email, password } : null;
}

test('signing in on the till origin lands on the till, not the dashboard', async ({ page }) => {
    const creds = qaCredentials();
    test.skip(!creds, 'Missing .qa/firebase-test-account.md — see docs/QA_TEST_ACCOUNT.md.');

    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));

    // The front door. `/` 302s here, and login.html is served BY the till origin
    // rather than 301d to the dashboard — that classification is what makes a
    // per-origin Firebase session possible at all.
    const res = await page.goto(`${TILL}/login`, { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'the till must serve its own login page').toBe(200);
    expect(new URL(page.url()).host, 'still on the till origin before signing in').toBe('pos.fluxyos.com');

    await page.locator('#email').fill(creds.email);
    await page.locator('#password').fill(creds.password);
    await page.locator('form button[type="submit"]').click();

    // The QA account is a password user at @example.com, which can never receive
    // a verification mail — so login.html's `routeUser` shows the verification
    // view instead of routing. Real users on unverified accounts take this exact
    // path, and "Continue without verifying" calls the SAME goToApp this test is
    // here to check. Raced rather than assumed, so a verified account still works.
    // Mirrors tests/setup-auth.spec.js.
    const routed = page.waitForURL(/\/(pos|dashboard)(\.html)?($|\?|#)/, { timeout: 90_000 });
    const verifyGate = page.locator('#verify-view')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .then(() => page.locator('#verify-skip-link').click())
        .catch(() => {});
    await Promise.race([routed, verifyGate]);

    // THE ASSERTION THIS FILE EXISTS FOR. Before the fix this landed on
    // dashboard.fluxyos.com/dashboard.
    await page.waitForURL(/\/pos(\?|#|$)/, { timeout: 90_000 });
    const url = new URL(page.url());
    expect(url.host, 'sign-in must not throw the user off the till origin').toBe('pos.fluxyos.com');
    expect(url.host).not.toBe(DASHBOARD_HOST);
    expect(url.pathname).toMatch(/^\/pos/);

    // Reached it AND it rendered. A 200 that paints nothing is not a working
    // till: the outlet picker is the first thing the page needs, because a sale
    // with no outlet cannot be attributed.
    await expect(page.locator('#pos-outlet')).toBeAttached({ timeout: 60_000 });
    await expect(page.locator('#pos-tables')).toBeAttached();

    // The session is real and origin-scoped, not inherited from anywhere.
    const workspace = await page.evaluate(() => ({
        id: window.FluxyWorkspace?.id || null,
        role: window.FluxyWorkspace?.role || null,
        category: window.FluxyWorkspace?.businessCategory || null,
    }));
    expect(workspace.id, 'the workspace must resolve, or every finance read is unscoped').toBeTruthy();

    // Firebase auth is keyed by origin. If pos.fluxyos.com were missing from the
    // authorized-domain list this fails with auth/unauthorized-domain, and the
    // symptom is opaque enough to be worth naming in the assertion.
    const authErrors = errors.filter((e) => /unauthorized-domain|auth\/|Content Security Policy|CORS/i.test(e));
    expect(authErrors, 'auth / CSP / CORS errors on the till origin').toEqual([]);
});

// The control. Without it, `goToApp` returning '/pos' unconditionally would
// pass the test above and silently send every finance user to the till — a
// worse bug than the one being fixed, and invisible from the till's side.
//
// Same file, same code path, different origin: the QA account is an OWNER, not
// a POS-only role, so on the dashboard it must still land on /dashboard.
test('the SAME login on the dashboard origin still lands on the dashboard', async ({ browser }) => {
    const creds = qaCredentials();
    test.skip(!creds, 'Missing .qa/firebase-test-account.md.');

    // A fresh context with no host pinning and no stored session — the dashboard
    // origin resolves normally.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
        await page.goto('https://dashboard.fluxyos.com/login', { waitUntil: 'domcontentloaded' });
        await page.locator('#email').fill(creds.email);
        await page.locator('#password').fill(creds.password);
        await page.locator('form button[type="submit"]').click();

        const routed = page.waitForURL(/\/(pos|dashboard)(\.html)?($|\?|#)/, { timeout: 90_000 });
        const verifyGate = page.locator('#verify-view')
            .waitFor({ state: 'visible', timeout: 90_000 })
            .then(() => page.locator('#verify-skip-link').click())
            .catch(() => {});
        await Promise.race([routed, verifyGate]);
        await page.waitForURL(/\/dashboard(\.html)?($|\?|#)/, { timeout: 90_000 });

        const url = new URL(page.url());
        expect(url.host, 'a finance user must stay on the dashboard origin').toBe(DASHBOARD_HOST);
        expect(url.pathname, 'an owner signing in at the dashboard must NOT be sent to the till')
            .toMatch(/^\/dashboard/);
    } finally {
        await ctx.close();
    }
});

test('the till origin still refuses to serve the dashboard', async ({ page }) => {
    // The other half of the split, checked from inside a browser rather than
    // with curl: a cashier device must not be able to load the finance app even
    // by typing the path.
    const res = await page.goto(`${TILL}/ledger`, { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).host, '/ledger must leave the till origin').toBe(DASHBOARD_HOST);
    expect(res?.status()).toBeLessThan(400);
});
