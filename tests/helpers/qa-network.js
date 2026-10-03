const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE = path.resolve(__dirname, '../../.qa/static-assets');
const STATIC = /^https:\/\/(?:fonts\.googleapis\.com\/css[^\s]*|fonts\.gstatic\.com\/[\s\S]+|cdn\.tailwindcss\.com\/?(?:\?[^\s]*)?)$/;
const ANALYTICS = /^https:\/\/(?:www\.googletagmanager\.com|(?:www\.)?google-analytics\.com|[^/]+\.google-analytics\.com)\//;

// Only public static bytes are persisted. Never cache auth, APIs, Firestore,
// application files or failed responses. Keep the real font/CDN rendering.
async function staticAsset(route, url, pending) {
    const userAgent = route.request().headers()['user-agent'] || '';
    const key = url + '\n' + userAgent;
    let promise = pending.get(key);
    if (!promise) {
        promise = (async () => {
            const file = path.join(CACHE, crypto.createHash('sha256').update(key).digest('hex') + '.json');
            try {
                const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (cached.url === url && cached.userAgent === userAgent && Date.now() - cached.savedAt < 4 * 60 * 60 * 1000) {
                    return { status: 200, headers: cached.headers, body: Buffer.from(cached.body, 'base64') };
                }
            } catch {}
            let lastError;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const fetched = await route.fetch({ timeout: 10000 });
                    if (!fetched.ok()) throw new Error(`Static asset download failed: ${fetched.status()} ${url}`);
                    const headers = fetched.headers();
                    delete headers['content-encoding'];
                    delete headers['content-length'];
                    const body = await fetched.body();
                    fs.mkdirSync(CACHE, { recursive: true });
                    const temporary = file + '.' + process.pid + '.tmp';
                    fs.writeFileSync(temporary, JSON.stringify({ url, userAgent, savedAt: Date.now(), headers, body: body.toString('base64') }));
                    fs.renameSync(temporary, file);
                    return { status: fetched.status(), headers, body };
                } catch (error) { lastError = error; }
            }
            throw lastError;
        })();
        pending.set(key, promise);
        promise.catch(() => pending.delete(key));
    }
    return promise;
}

async function installNetwork(context, pending) {
    await context.route(STATIC, async route => route.fulfill(await staticAsset(route, route.request().url(), pending)));
    // UI tests must not send page views or wait for an analytics provider.
    await context.route(ANALYTICS, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
}

module.exports = { installNetwork, staticAsset };
