const { test, expect } = require('./public-test');
async function mock(page, options = {}) {
    const submissions = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/.netlify/functions/contact-form-config', route => route.fulfill({ status: options.unavailable ? 503 : 200, json: { mode: options.pending ? 'pending' : 'turnstile', siteKey: options.pending ? undefined : 'public-fixture', session: 'signed-fixture', nonce: 'nonce-fixture', issuedAt: Date.now(), action: 'sales_lead' } }));
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', route => route.fulfill({ contentType: 'application/javascript', body: `window.turnstile={render:function(el,o){window.widgetOptions=o; window.proofCallbacks=o; ${options.noToken ? '' : 'o.callback("fixture-proof");'} return 0;},reset:function(){${options.noToken ? '' : 'window.proofCallbacks.callback("fresh-proof");'}},remove:function(){}};` }));
    await page.route('**/.netlify/functions/submit-contact-sales', async route => {
        submissions.push(route.request().postDataJSON());
        await route.fulfill({ status: options.status || 200, json: options.status ? { error: options.code || 'rate_limited' } : { ok: true, id: 'fixture' } });
    });
    return { submissions, errors };
}
async function fill(page) {
    await page.locator('#name').fill('Rani'); await page.locator('#email').fill('rani@example.com');
    await page.locator('#whatsapp').fill('+62 812 3456 7890'); await page.locator('#company').fill('Retail & Co');
    await page.locator('#business_type').selectOption('E-commerce'); await page.locator('#team_size').selectOption('11-50');
    await page.locator('#message').fill('Need accounting for our online store.');
}
test('counter and internal-domain validation work before submission', async ({ page }) => {
    const state = await mock(page); await page.goto('/contact-sales');
    await expect(page.locator('#message-counter')).toHaveText('0 / 100');
    await page.locator('#message').fill('a'.repeat(100)); await expect(page.locator('#message-counter')).toHaveText('100 / 100');
    await expect(page.locator('#message')).toHaveAttribute('maxlength', '100');
    await page.locator('#email').fill('STAFF@FLUXYOS.COM');
    await expect(page.locator('#email-validation')).toHaveText('Please use your business email address to contact our sales team.');
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#email').fill('rani@example.com'); await expect(page.locator('#email-validation')).toBeHidden();
    expect(state.submissions).toHaveLength(0); expect(state.errors).toEqual([]);
});
test('valid submission includes proof and timing, shows success, no double-submit', async ({ page }) => {
    const state = await mock(page); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#contact-submit').click(); await expect(page.locator('#contact-success')).toBeVisible();
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]).toMatchObject({ 'cf-turnstile-response': 'fixture-proof', form_session: 'signed-fixture', 'bot-field': '' });
    expect(state.submissions[0].completion_ms).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.widgetOptions.appearance)).toBe('interaction-only');
    expect(state.errors).toEqual([]);
});
test('approved pending mode submits with signed timing and does not load Cloudflare', async ({ page }) => {
    const state = await mock(page, { pending: true }); let cloudflareLoads = 0;
    page.on('request', request => { if (request.url().includes('challenges.cloudflare.com')) cloudflareLoads++; });
    await page.goto('/contact-sales'); await fill(page); await page.locator('#contact-submit').click();
    await expect(page.locator('#contact-success')).toBeVisible(); expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0].form_session).toBe('signed-fixture'); expect(state.submissions[0]['cf-turnstile-response']).toBeUndefined();
    expect(state.submissions[0].completion_ms).toBeGreaterThanOrEqual(0); expect(cloudflareLoads).toBe(0); expect(state.errors).toEqual([]);
});
test('pending mode retains visible internal-domain blocking and the counter', async ({ page }) => {
    const state = await mock(page, { pending: true }); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#email').fill('staff@fluxyos.com'); await page.locator('#contact-submit').click();
    await expect(page.locator('#email-validation')).toContainText('Please use your business email address'); expect(state.submissions).toHaveLength(0);
    await expect(page.locator('#message-counter')).toHaveText('37 / 100'); await expect(page.locator('#contact-error')).toBeHidden();
});
test('server rate-limit errors preserve form values and restore button', async ({ page }) => {
    const state = await mock(page, { status: 429 }); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#contact-submit').click(); await expect(page.locator('#contact-error')).toContainText('Too many attempts');
    await expect(page.locator('#email')).toHaveValue('rani@example.com'); await expect(page.locator('#contact-submit')).toBeEnabled();
    expect(state.submissions).toHaveLength(1); expect(state.errors).toEqual([]);
});
test('pending background challenge can complete without being restarted', async ({ page }) => {
    const state = await mock(page, { noToken: true }); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#contact-submit').click(); await expect(page.locator('#contact-submit')).toBeDisabled();
    expect(state.submissions).toHaveLength(0);
    await page.evaluate(() => window.proofCallbacks.callback('challenge-proof'));
    await expect(page.locator('#contact-success')).toBeVisible(); expect(state.submissions[0]['cf-turnstile-response']).toBe('challenge-proof');
});
test('verification failure uses a fresh proof on explicit retry', async ({ page }) => {
    const state = await mock(page, { status: 403, code: 'verification_failed' }); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#contact-submit').click(); await expect(page.locator('#contact-error')).toContainText('Please retry the security check');
    await page.locator('#contact-submit').click(); await expect.poll(() => state.submissions.length).toBe(2);
    expect(state.submissions[0]['cf-turnstile-response']).toBe('fixture-proof'); expect(state.submissions[1]['cf-turnstile-response']).toBe('fresh-proof');
});
test('missing configuration fails closed, retains counter and email fallback', async ({ page }) => {
    const state = await mock(page, { unavailable: true }); await page.goto('/contact-sales'); await fill(page);
    await expect(page.locator('#contact-error')).toContainText('Secure verification is unavailable');
    await page.locator('#contact-submit').click(); await expect(page.locator('#contact-submit')).toBeEnabled();
    expect(state.submissions).toHaveLength(0); await expect(page.locator('#contact-error')).toContainText('sales@fluxyos.com');
    await expect(page.locator('form').getByText('Prefer email?', { exact: false })).toHaveCount(0);
    await expect(page.locator('#message-counter')).toHaveText('37 / 100'); expect(state.errors).toEqual([]);
});
test('programmatic over-length message cannot be sent', async ({ page }) => {
    const state = await mock(page); await page.goto('/contact-sales'); await fill(page);
    await page.locator('#message').evaluate(el => { el.value = 'a'.repeat(101); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#contact-submit').click(); expect(state.submissions).toHaveLength(0);
    expect(await page.locator('#message').evaluate(el => el.validationMessage)).toContain('100 characters');
});
test('Indonesian validation uses natural paired copy', async ({ page }) => {
    await mock(page); await page.addInitScript(() => localStorage.setItem('fluxyos-lang', 'id')); await page.goto('/contact-sales');
    await page.locator('#email').fill('staff@fluxyos.com');
    await expect(page.locator('#email-validation')).toHaveText('Gunakan email bisnis Anda untuk menghubungi tim sales kami.');
    await expect(page.locator('#message-hint')).toHaveText('Ceritakan kebutuhan Anda secara singkat.');
});
for (const width of [320, 768]) test(`responsive form and background verification at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await mock(page); await page.goto('/contact-sales');
    await expect(page.locator('#message')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.widgetOptions?.size)).toBe(width === 320 ? 'compact' : 'flexible');
    expect(await page.locator('#message-counter').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    await page.locator('#message').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('form.png') });
});
test('no-JavaScript visitors have a usable email fallback', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false }); const page = await context.newPage();
    await page.goto('http://127.0.0.1:8765/contact-sales'); await expect(page.locator('noscript a')).toBeVisible();
    await expect(page.locator('#contact-submit')).toBeHidden(); await expect(page.locator('#message-counter')).toHaveText('0 / 100'); await context.close();
});
test('event signup uses same proof rather than bypassing the protected API', async ({ page }) => {
    const state = await mock(page); await page.goto('/event');
    await page.locator('#ev-name').fill('Rani'); await page.locator('#ev-email').fill('rani@example.com');
    await page.locator('#ev-whatsapp').fill('+62812345678'); await page.locator('#ev-company').fill('Retail');
    await page.locator('#ev-category').selectOption({ index: 1 }); await page.locator('#ev-submit').click();
    await expect(page.locator('#done-view')).toBeVisible(); expect(state.submissions[0]).toMatchObject({ source: 'event-signup', 'cf-turnstile-response': 'fixture-proof' });
    expect(state.errors).toEqual([]);
});
