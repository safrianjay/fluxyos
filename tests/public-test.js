const base = require('@playwright/test');
const { installNetwork } = require('./helpers/qa-network');

const test = base.test.extend({
    browser: [async ({ browser }, use) => {
        const pending = new Map();
        // Also cover explicit newContext() calls used by no-JS, touch and
        // reduced-motion checks. No page, viewport or navigation is replaced.
        const wrapped = new Proxy(browser, {
            get(target, property) {
                if (property === 'newContext') return async options => {
                    const context = await target.newContext(options);
                    await installNetwork(context, pending);
                    return context;
                };
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        await use(wrapped);
    }, { scope: 'worker' }],
});

module.exports = { ...base, test };
