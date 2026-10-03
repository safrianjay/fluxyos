const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { installNetwork, staticAsset } = require('./helpers/qa-network');

test('network fixtures intercept static providers and analytics, never app APIs', async () => {
    const handlers = [];
    await installNetwork({ route: async (pattern, handler) => handlers.push({ pattern, handler }) }, new Map());
    for (const url of ['http://127.0.0.1:8765/assets/missing.js', 'https://firestore.googleapis.com/v1/projects/test', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', 'https://fluxyos.com/.netlify/functions/contact-sales']) {
        assert.equal(handlers.some(({ pattern }) => pattern.test(url)), false, url);
    }
    assert.equal(handlers[0].pattern.test('https://fonts.googleapis.com/css2?family=Inter'), true);
    assert.equal(handlers[0].pattern.test('https://cdn.tailwindcss.com'), true);
    let response;
    await handlers[1].handler({ fulfill: async value => { response = value; } });
    assert.equal(response.body, '');
});

test('only successful source bytes are reused, with decoded headers and user-agent isolation', async () => {
    const url = 'https://fonts.googleapis.com/css2?family=QA-unit-' + process.pid;
    const filename = ua => path.resolve(__dirname, '../.qa/static-assets', crypto.createHash('sha256').update(url + '\n' + ua).digest('hex') + '.json');
    const pending = new Map();
    let calls = 0;
    const route = {
        request: () => ({ headers: () => ({ 'user-agent': 'browser-a' }) }),
        fetch: async () => {
            calls++;
            return { ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'text/css', 'content-encoding': 'gzip', 'content-length': '900' }), body: async () => Buffer.from('real source') };
        },
    };
    try {
        const first = await staticAsset(route, url, pending);
        assert.equal(first.body.toString(), 'real source');
        assert.equal(first.headers['content-encoding'], undefined);
        assert.equal(first.headers['content-length'], undefined);
        await staticAsset(route, url, new Map());
        assert.equal(calls, 1, 'successful disk cache was not reused');
        await staticAsset({ ...route, request: () => ({ headers: () => ({ 'user-agent': 'browser-b' }) }) }, url, pending);
        assert.equal(calls, 2, 'different user agent reused another browser response');
    } finally {
        for (const ua of ['browser-a', 'browser-b']) fs.rmSync(filename(ua), { force: true });
    }
});

test('failed downloads reject and leave no reusable result', async () => {
    const url = 'https://fonts.googleapis.com/css2?family=QA-failure-' + process.pid;
    const pending = new Map();
    const route = { request: () => ({ headers: () => ({}) }), fetch: async () => { throw Error('provider unavailable'); } };
    await assert.rejects(staticAsset(route, url, pending), /provider unavailable/);
    assert.equal(pending.size, 0);
    const filename = path.resolve(__dirname, '../.qa/static-assets', crypto.createHash('sha256').update(url + '\n').digest('hex') + '.json');
    assert.equal(fs.existsSync(filename), false);
});
