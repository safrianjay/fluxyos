// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * FluxyOS QA harness — Phase 1 receipt & document attachment.
 *
 * Runs against a local static server (python http.server) so changes in
 * shared-dashboard.js / db-service.js / bill.html are validated against the
 * live Firebase project (`fluxyos`). The harness still talks to real
 * Firestore + Storage, so rules must already be deployed.
 *
 * Auth: a one-time global setup at tests/setup-auth.js signs into the
 * project's QA test account (see .qa/firebase-test-account.md) and saves
 * the session into tests/.auth/storageState.json, which every other spec
 * inherits via `use.storageState`.
 */
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:8765',
        actionTimeout: 10_000,
        // 20s was set when the QA workspace was small. It now holds 120+ items,
        // 30+ outlets and hundreds of movements, and every app page boots through
        // auth + workspace resolution + its first read against REAL Firebase — so
        // navigation alone can exceed 20s when the suite runs serially. Raising
        // the ceiling does not slow a fast run; it stops a slow one being
        // reported as a failure, which is how five green specs looked broken.
        navigationTimeout: 60_000,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'node tests/qa-static-server.js',
        url: 'http://127.0.0.1:8765/dashboard.html',
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
    },
    projects: [
        {
            name: 'auth-setup',
            testMatch: /setup-auth\.spec\.js$/,
        },
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/.auth/storageState.json',
            },
            dependencies: ['auth-setup'],
        },
    ],
});
