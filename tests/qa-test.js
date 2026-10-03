const base = require('./public-test');
const { staticAsset } = require('./helpers/qa-network');

// Cache only immutable, versioned SDK source bytes for this test worker. Fresh
// browser contexts otherwise repeat every gstatic download, occasionally hanging
// before the app can even start. This does not intercept Firebase API requests,
// authentication, records, or app assets. Non-success responses are never cached.
const test = base.test.extend({
    firebaseSdkCache: [async ({}, use) => {
        await use(new Map());
    }, { scope: 'worker' }],
    context: async ({ context, firebaseSdkCache }, use) => {
        await context.route(/^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/firebase-[a-z-]+\.js$/, async route => {
            const url = route.request().url();
            await route.fulfill(await staticAsset(route, url, firebaseSdkCache));
        });
        await use(context);
    },
    page: async ({ page }, use) => {
        try {
            await use(page);
        } finally {
            // Drain SDK handlers before the built-in page fixture closes it.
            // Context teardown alone runs too late for pending SDK downloads.
            // Leave page-level routes alone: loading-state tests intentionally
            // stall authentication requests until the page closes.
            await page.context().unrouteAll({ behavior: 'wait' });
        }
    },
});

module.exports = { ...base, test };
