'use strict';
// =============================================================================
// perf/lib/session.js — the signed-in browser every perf script drives.
//
// One place for: which QA account, the refusal to run against anything that is
// not `qa+<cc>@fluxyos.com`, starting the local app server when nothing is
// serving it, and signing in exactly as tests/setup-auth.spec.js does.
//
// The app pages run LOCALLY (127.0.0.1:8765) against PRODUCTION Firebase — the
// same arrangement the Playwright suite uses. Writes therefore land in the
// real `qa+id` workspace, through the real rules.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = process.env.QA_BASE_URL || 'http://127.0.0.1:8765';
const QA_EMAIL = /^qa\+[a-z]{2}@fluxyos\.com$/;
const FIXTURES = path.join(ROOT, 'perf', '.fixtures.json');

function readCreds(cc = 'id') {
    const file = path.join(ROOT, '.qa', `firebase-test-account-${cc}.md`);
    if (!fs.existsSync(file)) {
        throw new Error(`Missing .qa/firebase-test-account-${cc}.md — see docs/QA_TEST_ACCOUNT.md.`);
    }
    const raw = fs.readFileSync(file, 'utf8');
    const email = raw.match(/Email:\s*`([^`]+)`/)?.[1];
    const password = raw.match(/Password:\s*`([^`]+)`/)?.[1];
    if (!email || !password) throw new Error(`Could not parse Email + Password from ${path.basename(file)}.`);
    if (!QA_EMAIL.test(email)) {
        throw new Error(`Refusing ${email}: perf scripts only run against qa+<cc>@fluxyos.com accounts.`);
    }
    return { email, password };
}

function readFixtures() {
    if (!fs.existsSync(FIXTURES)) throw new Error('Missing perf/.fixtures.json — run `npm run perf:seed -- --commit` first.');
    return JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
}

async function serverUp() {
    try { return (await fetch(`${APP}/login.html`)).ok; } catch (_) { return false; }
}

/** Serve the app locally if nothing is. Returns a stop() that only stops what it started. */
async function ensureServer() {
    if (await serverUp()) return () => {};
    if (process.env.QA_BASE_URL) throw new Error(`Nothing is serving ${APP}.`);
    const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'qa-static-server.js')], { stdio: 'ignore' });
    for (let i = 0; i < 40; i += 1) {
        if (await serverUp()) return () => child.kill();
        await new Promise((r) => setTimeout(r, 250));
    }
    child.kill();
    throw new Error('Could not start tests/qa-static-server.js.');
}

/** Sign in on `page` and land on the dashboard with the workspace resolved. */
async function signIn(page, { email, password }) {
    await page.goto(`${APP}/login.html`);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('form button[type="submit"]').click();
    const dashboard = page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 90_000 });
    const verifyGate = page.locator('#verify-view')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .then(() => page.locator('#verify-skip-link').click())
        .catch(() => {});
    await Promise.race([dashboard, verifyGate]);
    await page.waitForURL(/\/dashboard(\.html)?($|\?)/, { timeout: 90_000 });
    await waitForWorkspace(page);
}

async function waitForWorkspace(page) {
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, null, { timeout: 60_000 });
    await page.evaluate(async () => {
        const ws = window.FluxyWorkspace;
        if (ws && typeof ws.whenReady === 'function') await ws.whenReady();
    });
}

/**
 * Put a DataService bound to the signed-in user on `window.__perf`, then run
 * `fn(arg)` in the page. `fn` is serialized by Playwright, so it reads its
 * context from `window.__perf` ({ ds, uid, ws, user }) rather than a closure.
 * No `new Function` in the page: that would be the page's CSP to argue with.
 */
async function withDataService(page, fn, arg) {
    await page.evaluate(async () => {
        if (window.__perf) return;
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { default: DataService } = await import('/assets/js/db-service.js');
        const app = getApps()[0];
        const user = getAuth(app).currentUser;
        if (!user) throw new Error('Not signed in.');
        const ws = window.FluxyWorkspace || {};
        const ds = new DataService(app);
        ds.setActor(user.uid, ws.role || null);
        window.__perf = { ds, uid: user.uid, ws, user };
    });
    return page.evaluate(fn, arg);
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

function outDir(name) {
    const dir = path.join(ROOT, 'perf', 'out', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

module.exports = { ROOT, APP, readCreds, readFixtures, ensureServer, signIn, waitForWorkspace, withDataService, stamp, outDir };
