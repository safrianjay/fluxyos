const base = require('@playwright/test');

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
            let response = firebaseSdkCache.get(url);
            if (!response) {
                response = (async () => {
                    const fetched = await route.fetch({ timeout: 30000 });
                    if (!fetched.ok()) throw new Error(`Firebase SDK download failed: ${fetched.status()} ${url}`);
                    const headers = fetched.headers();
                    // APIResponse.body() is decoded; don't replay compressed sizes.
                    delete headers['content-encoding'];
                    delete headers['content-length'];
                    return { status: fetched.status(), headers, body: await fetched.body() };
                })();
                firebaseSdkCache.set(url, response);
                response.catch(() => firebaseSdkCache.delete(url));
            }
            await route.fulfill(await response);
        });
        await use(context);
    },
});

module.exports = { ...base, test };
