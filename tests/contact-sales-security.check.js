'use strict';
// Deterministic API tests: fake Firestore and provider, never real leads/alerts.
const assert = require('node:assert/strict');
const Module = require('module');
const V = require('../assets/js/lead-form-validation');
const S = require('../netlify/functions/lib/contact-sales-security');
const savedEnv = { ...process.env }, originalFetch = global.fetch, originalLoad = Module._load;
let db, provider, providerCalls = 0, tests = 0;
function database(outage = false) {
    const docs = new Map(), leads = []; let queue = Promise.resolve();
    return {
        docs, leads,
        collection(name) { return { doc(id) { return { id }; }, async add(lead) { assert.equal(name, 'sales_leads'); leads.push(lead); return { id: 'fake-' + leads.length }; } }; },
        runTransaction(fn) {
            const run = queue.then(async () => {
                if (outage) throw Error('simulated limiter outage');
                return fn({ get: async ref => ({ exists: docs.has(ref.id), data: () => docs.get(ref.id) }), set: (ref, value) => docs.set(ref.id, value) });
            });
            queue = run.catch(() => {}); return run;
        }
    };
}
Module._load = function (name, parent, main) {
    if (name === 'firebase-admin') return { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } };
    if (name === './lib/notify-core' && parent.filename.endsWith('submit-contact-sales.js')) return { initAdmin: () => db };
    if (name === 'resend') return { Resend: class { constructor() { throw Error('alerts must remain disabled in tests'); } } };
    return originalLoad.call(this, name, parent, main);
};
const endpoint = require('../netlify/functions/submit-contact-sales').handler;
const configEndpoint = require('../netlify/functions/contact-form-config').handler;
Module._load = originalLoad;
process.env.TURNSTILE_SITE_KEY = 'public-fixture'; process.env.TURNSTILE_SECRET_KEY = 'private-fixture';
delete process.env.SALES_ALERT_EMAIL; delete process.env.SLACK_WEBHOOK_URL; delete process.env.CONTACT_FORM_IP_LIMIT; delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
delete process.env.CONTACT_FORM_BOT_MODE; delete process.env.CONTACT_FORM_SESSION_SECRET;
global.fetch = async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    providerCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.secret, 'private-fixture');
    const result = provider ? await provider(body) : { success: true, action: S.ACTION, hostname: 'fluxyos.com', cdata: currentNonce };
    return { ok: true, json: async () => result };
};
let currentNonce;
function payload(changes = {}, age = 5000) {
    const session = S.issueSession(process.env.TURNSTILE_SECRET_KEY, Date.now() - age); currentNonce = session.nonce;
    return { name: 'Rani O’Neill', email: 'rani@example.com', whatsapp: '+62 812 3456 7890', company: 'Retail & Co', business_type: 'E-commerce', team_size: '11-50', message: 'Need accounting for our online store.', source: 'contact-sales', 'bot-field': '', form_session: session.session, 'cf-turnstile-response': 'fixture-proof', completion_ms: age, ...changes };
}
function event(data, ip = '192.0.2.1') { return { httpMethod: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip, origin: 'https://fluxyos.com' }, body: JSON.stringify(data) }; }
async function check(label, fn) { db = database(); provider = null; providerCalls = 0; await fn(); tests++; console.log('✓ ' + label); }
async function rejected(changes, status = 400, code) { const result = await endpoint(event(payload(changes))); assert.equal(result.statusCode, status); if (code) assert.equal(JSON.parse(result.body).error, code); assert.equal(db.leads.length, 0); return result; }
(async () => {
    await check('public config contains no secret; origin and methods enforced', async () => {
        const response = await configEndpoint({ httpMethod: 'GET', headers: {} });
        assert.equal(response.statusCode, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
        assert(!response.body.includes('private-fixture')); const value = JSON.parse(response.body);
        assert(S.readSession(value.session, 'private-fixture')); assert.equal(value.siteKey, 'public-fixture');
        assert.equal((await configEndpoint({ httpMethod: 'POST' })).statusCode, 405);
        assert.equal((await configEndpoint({ httpMethod: 'GET', headers: { origin: 'https://evil.example' } })).statusCode, 403);
    });
    await check('valid lead normalized, plain-text fields only, no token/IP stored', async () => {
        const request = event(payload({ email: 'RANI@GMAIL.COM', company: '  Retail & Co  ', ignored: '<script>bad</script>' }));
        request.headers['user-agent'] = '<test>\nagent';
        assert.equal((await endpoint(request)).statusCode, 200);
        const lead = db.leads[0]; assert.equal(lead.email, 'rani@gmail.com'); assert.equal(lead.company, 'Retail & Co');
        assert.equal(lead.user_agent, 'testagent'); assert.equal(lead.bot_verification, 'turnstile');
        for (const field of ['ignored','form_session','cf-turnstile-response','ip']) assert(!Object.hasOwn(lead, field));
        assert([...db.docs.values()].every(v => v.expires_at instanceof Date));
        assert([...db.docs.keys()].every(k => !k.includes('rani') && !k.includes('192.0.2.1')));
    });
    await check('internal domains blocked, case insensitive including subdomains', async () => {
        for (const email of ['staff@fluxyos.com','STAFF@FLUXYOS.COM','staff@dept.fluxyos.com']) {
            const result = await rejected({ email }, 400, 'internal_email');
            assert.equal(JSON.parse(result.body).message, 'Please use your business email address to contact our sales team.');
        }
        assert.equal(V.emailError('staff@notfluxyos.com'), '');
    });
    await check('malformed and disposable addresses blocked; permanent mail allowed', async () => {
        for (const email of ['a@@test.com','a..b@test.com','a@-test.com','a@test','a@te_st.com','a@yopmail.com','a@sub.mailinator.com']) await rejected({ email });
        assert.equal(V.emailError('rani+sales@outlook.com'), '');
    });
    await check('100-character limit enforced without silent truncation', async () => {
        assert(V.validate(payload({ message: 'a'.repeat(100) })).ok);
        await rejected({ message: 'a'.repeat(101) }, 400, 'message_too_long');
        assert.equal(V.validate(payload({ message: '😀'.repeat(50) })).ok, true);
        assert.equal(V.validate(payload({ message: '😀'.repeat(51) })).ok, false);
    });
    await check('every field rejects markup, encoded scripts, controls and wrong types', async () => {
        for (const field of ['name','email','whatsapp','company','business_type','team_size','message','source']) {
            await rejected({ [field]: '<script>alert(1)</script>' }); await rejected({ [field]: ['not text'] });
        }
        for (const message of ['&lt;script&gt;','%3Csvg%3E','javascript:alert(1)','safe\u0000unsafe']) await rejected({ message });
        await rejected({ name: 'Rani\r\nBCC:spam' }); await rejected({ whatsapp: 'abcd123456' });
    });
    await check('honeypot discarded silently with no database or verification work', async () => {
        for (const value of ['bot', ' ', true]) {
            assert.equal((await endpoint(event(payload({ 'bot-field': value })))).statusCode, 200);
            assert.equal(db.leads.length, 0); assert.equal(db.docs.size, 0); assert.equal(providerCalls, 0);
        }
    });
    await check('signed sessions reject tampering, expiry and future timestamps', async () => {
        await rejected({ form_session: '' }, 403); await rejected({ form_session: S.issueSession('other').session }, 403);
        await rejected({ form_session: S.issueSession('private-fixture', Date.now() - S.SESSION_MAX_MS - 1).session }, 403);
        await rejected({ form_session: S.issueSession('private-fixture', Date.now() + 10000).session }, 403);
        await rejected({ 'cf-turnstile-response': '' }, 403);
    });
    await check('tokens bound to action, hostname, nonce; direct POST has no bypass', async () => {
        await rejected({ mode: 'pending', 'cf-turnstile-response': '' }, 403);
        for (const changes of [{ success: false }, { action: 'other' }, { hostname: 'evil.example' }, { cdata: 'wrong' }]) {
            db = database(); provider = () => ({ success: true, action: S.ACTION, hostname: 'fluxyos.com', cdata: currentNonce, ...changes });
            await rejected({}, 403);
        }
        provider = () => { throw Error('provider unavailable'); }; db = database(); await rejected({}, 503);
        provider = () => ({ success: false, 'error-codes': ['invalid-input-secret'] }); db = database(); await rejected({}, 503);
        provider = () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }); db = database(); await rejected({}, 403);
    });
    await check('missing configuration fails closed; production testing keys rejected', async () => {
        delete process.env.TURNSTILE_SECRET_KEY;
        const response = await endpoint(event({ ...payloadForMissingConfig(), form_session: 'anything' })); assert.equal(response.statusCode, 503); assert.equal(db.leads.length, 0);
        assert.equal((await configEndpoint({ httpMethod: 'GET' })).statusCode, 503);
        process.env.TURNSTILE_SECRET_KEY = 'private-fixture'; process.env.CONTEXT = 'production'; process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
        assert.equal(S.configuration(), null); process.env.TURNSTILE_SITE_KEY = 'public-fixture'; process.env.CONTEXT = savedEnv.CONTEXT || '';
    });
    await check('fast autofill and unusual sales terminology alone are not rejected', async () => {
        assert.equal((await endpoint(event(payload({}, 20)))).statusCode, 200); assert(db.leads[0].spam_flags.includes('fast_completion'));
        assert.equal(S.assessContent({ name: 'Rani', company: 'Casino bonus analytics', business_type: 'SaaS', message: 'Need ledger reporting.' }, 5000).reject, false);
        assert.equal(S.assessContent({ name: 'Rani', company: 'Retail', message: 'VAT EBITDA CAC LTV SKU accounting' }, 10).reject, false);
    });
    await check('high-confidence patterns and combined signals rejected', async () => {
        await rejected({ message: 'https://a.co https://b.co https://c.co' }); await rejected({ message: 'spam spam spam spam' });
        const risk = S.assessContent({ name: 'Bot', company: 'Buy backlinks', message: 'promotion' }, 10); assert(risk.reject);
        assert(S.assessContent({ message: 'AbCdEfGh12345678IjKlMnOpQrSt' }, 20).reject);
    });
    await check('IP quotas durable, trusted header wins over spoofed forwarding', async () => {
        for (let i = 0; i < 10; i++) {
            const request = event(payload({ email: `lead${i}@example.com` })); request.headers['x-forwarded-for'] = `192.0.2.${i + 20}`;
            assert.equal((await endpoint(request)).statusCode, 200);
        }
        const response = await endpoint(event(payload({ email: 'new@example.com' }))); assert.equal(response.statusCode, 429); assert(Number(response.headers['Retry-After']) > 0); assert.equal(db.leads.length, 10);
    });
    await check('email quota survives IP/session/source rotation and concurrency', async () => {
        // Provider derives nonce from token in this concurrency fixture.
        provider = body => ({ success: true, action: S.ACTION, hostname: 'fluxyos.com', cdata: body.response });
        const requests = Array.from({ length: 7 }, (_, i) => {
            const p = payload({ source: i % 2 ? 'event-signup' : 'contact-sales' });
            p['cf-turnstile-response'] = S.readSession(p.form_session, 'private-fixture').nonce;
            return endpoint(event(p, `192.0.2.${i + 30}`));
        });
        const responses = await Promise.all(requests); assert.equal(responses.filter(r => r.statusCode === 200).length, 3); assert.equal(responses.filter(r => r.statusCode === 429).length, 4); assert.equal(db.leads.length, 3);
    });
    await check('event source cannot bypass verification; limiter failure closed', async () => {
        await rejected({ source: 'event-signup', 'cf-turnstile-response': '' }, 403);
        db = database(true); await rejected({}, 503);
    });
    await check('parser rejects oversized, duplicate, malformed or foreign requests', async () => {
        let request = event(payload()); request.headers.origin = 'https://evil.example'; assert.equal((await endpoint(request)).statusCode, 403);
        request = event(payload()); request.body = '['; assert.equal((await endpoint(request)).statusCode, 400);
        request.body = JSON.stringify(['array']); assert.equal((await endpoint(request)).statusCode, 400);
        request.body = 'x'.repeat(17000); assert.equal((await endpoint(request)).statusCode, 413);
        request = event(payload()); request.headers['content-type'] = 'text/plain'; assert.equal((await endpoint(request)).statusCode, 415);
        request.headers['content-type'] = 'application/x-www-form-urlencoded'; request.body = 'email=a%40example.com&email=b%40example.com'; assert.equal((await endpoint(request)).statusCode, 400);
        assert.equal(db.leads.length, 0);
    });
    await check('pending mode requires explicit server approval and a strong signing secret', async () => {
        delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
        process.env.CONTACT_FORM_SESSION_SECRET = 's'.repeat(64);
        assert.equal(S.policy(), null);
        process.env.CONTACT_FORM_BOT_MODE = 'pending'; assert.equal(S.policy().mode, 'pending');
        process.env.CONTACT_FORM_SESSION_SECRET = 'short'; assert.equal(S.policy(), null);
        process.env.CONTACT_FORM_SESSION_SECRET = 's'.repeat(64);
        const response = await configEndpoint({ httpMethod: 'GET' }); const body = JSON.parse(response.body);
        assert.equal(response.statusCode, 200); assert.equal(body.mode, 'pending'); assert(!body.siteKey);
        assert(!response.body.includes('s'.repeat(64))); assert(S.readSession(body.session, 's'.repeat(64)));
    });
    await check('pending mode retains timing, honeypot, validation and signed-session checks', async () => {
        const config = JSON.parse((await configEndpoint({ httpMethod: 'GET' })).body);
        const plain = { ...payloadForMissingConfig(), form_session: config.session, completion_ms: 10 };
        assert.equal((await endpoint(event(plain))).statusCode, 200);
        assert.equal(db.leads[0].bot_verification, 'pending'); assert(db.leads[0].spam_flags.includes('fast_completion')); assert.equal(providerCalls, 0);
        for (const changes of [{ email: 'staff@fluxyos.com' }, { message: 'a'.repeat(101) }, { company: '<script>bad</script>' }]) {
            assert.equal((await endpoint(event({ ...plain, ...changes }))).statusCode, 400);
        }
        assert.equal((await endpoint(event({ ...plain, form_session: '' }))).statusCode, 403);
        assert.equal((await endpoint(event({ ...plain, form_session: S.issueSession('attacker').session }))).statusCode, 403);
        assert.equal((await endpoint(event({ ...plain, 'bot-field': 'bot' }))).statusCode, 200); assert.equal(db.leads.length, 1);
    });
    await check('pending mode still enforces email quotas across IPs and sources', async () => {
        const session = S.issueSession('s'.repeat(64), Date.now() - 5000);
        for (let i = 0; i < 4; i++) {
            const request = event({ ...payloadForMissingConfig(), form_session: session.session, source: i % 2 ? 'event-signup' : 'contact-sales' }, `192.0.2.${i + 60}`);
            assert.equal((await endpoint(request)).statusCode, i < 3 ? 200 : 429);
        }
        assert.equal(db.leads.length, 3); assert.equal(providerCalls, 0);
    });
    await check('configured Turnstile always enforces proof; partial setup never downgrades', async () => {
        process.env.TURNSTILE_SITE_KEY = 'public-fixture'; assert.equal(S.policy(), null);
        assert.equal((await configEndpoint({ httpMethod: 'GET' })).statusCode, 503);
        process.env.TURNSTILE_SECRET_KEY = 'private-fixture'; assert.equal(S.policy().mode, 'turnstile');
        const config = JSON.parse((await configEndpoint({ httpMethod: 'GET' })).body); assert.equal(config.mode, 'turnstile');
        assert.equal((await endpoint(event({ ...payloadForMissingConfig(), form_session: config.session, mode: 'pending' }))).statusCode, 403);
        delete process.env.CONTACT_FORM_BOT_MODE; delete process.env.CONTACT_FORM_SESSION_SECRET;
    });
    console.log(`\n${tests} Contact Sales security groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    global.fetch = originalFetch; Module._load = originalLoad;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
});
function payloadForMissingConfig() { return { name: 'Rani', email: 'rani@example.com', whatsapp: '+62812345678', company: 'Retail', business_type: 'E-commerce', message: 'Need accounting' }; }
