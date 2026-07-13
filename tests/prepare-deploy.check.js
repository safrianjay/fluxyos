#!/usr/bin/env node
/**
 * Dry-run assertions for scripts/prepare-deploy.js (the two-site split).
 * NOT part of the Playwright suite — run manually before pushing changes that
 * touch the split (prepare-deploy.js, deploy/_redirects.*, page lists):
 *
 *     node tests/prepare-deploy.check.js
 *
 * Copies the deploy-relevant subset of the repo into a temp dir per role,
 * runs prepare-deploy with SITE_ROLE=marketing / app, and asserts the pruned
 * output + generated _redirects/robots/_headers are what production expects.
 * Exits non-zero on the first failed assertion.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function assert(cond, label) {
    if (cond) {
        console.log(`  ok   ${label}`);
    } else {
        console.error(`  FAIL ${label}`);
        failures += 1;
    }
}

// Copy only what prepare-deploy touches/needs (root html + config files,
// deploy/, scripts/, netlify/functions/, and the marketing dirs) — fast and
// avoids dragging node_modules/.git along.
function makeFixture(tag) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), `fluxyos-deploy-${tag}-`));
    for (const entry of fs.readdirSync(ROOT)) {
        if (['node_modules', '.git', '.netlify', 'tests', 'docs'].includes(entry)) continue;
        fs.cpSync(path.join(ROOT, entry), path.join(dest, entry), { recursive: true });
    }
    return dest;
}

function run(dir, role) {
    execFileSync('node', [path.join(dir, 'scripts', 'prepare-deploy.js')], {
        env: { ...process.env, SITE_ROLE: role },
        stdio: 'pipe',
    });
}

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

// --- no-op mode -------------------------------------------------------------
console.log('SITE_ROLE unset (monolith no-op):');
{
    const dir = makeFixture('noop');
    execFileSync('node', [path.join(dir, 'scripts', 'prepare-deploy.js')], {
        env: { ...process.env, SITE_ROLE: '' },
        stdio: 'pipe',
    });
    assert(exists(dir, 'dashboard.html') && exists(dir, 'fluxyos.html'), 'nothing pruned');
    assert(!exists(dir, '_redirects'), 'no _redirects generated');
    fs.rmSync(dir, { recursive: true, force: true });
}

// --- marketing role ----------------------------------------------------------
console.log('SITE_ROLE=marketing (fluxyos.com apex):');
{
    const dir = makeFixture('marketing');
    run(dir, 'marketing');

    assert(!exists(dir, 'login.html') && !exists(dir, 'dashboard.html') && !exists(dir, 'settings-team.html'), 'app pages pruned');
    assert(exists(dir, 'fluxyos.html') && exists(dir, 'pricing.html') && exists(dir, 'use-cases') && exists(dir, 'id'), 'marketing pages kept');
    assert(exists(dir, 'assets') && exists(dir, 'includes'), 'shared assets kept');
    assert(!exists(dir, 'netlify/functions/notify-sweep.js') && !exists(dir, 'netlify/functions/weekly-digest.js'), 'scheduled functions pruned');
    assert(exists(dir, 'netlify/functions/api.js') && exists(dir, 'netlify/functions/submit-contact-sales.js'), 'request-driven functions kept');
    assert(exists(dir, 'sitemap.xml') && read(dir, 'robots.txt').includes('Allow'), 'sitemap + robots untouched');
    assert(!exists(dir, 'deploy'), 'deploy/ templates removed');
    assert(!exists(dir, '_headers'), 'no _headers on marketing');

    const r = read(dir, '_redirects');
    assert(r.includes('/login       https://dashboard.fluxyos.com/login  301!'), 'app-path 301 generated (/login)');
    assert(r.includes('/dashboard.html  https://dashboard.fluxyos.com/dashboard  301!'), 'app-path .html 301 generated');
    assert(!r.includes('{{'), 'marker fully expanded');
    assert(r.includes('/api/v1/*') && r.includes('/.netlify/functions/api/:splat'), 'local /api/v1 rewrite kept');
    assert(r.includes('/__/auth/*   https://fluxyos.firebaseapp.com'), 'auth proxy present');
    assert(r.includes('/   /fluxyos.html   200!'), 'root serves landing page');
    fs.rmSync(dir, { recursive: true, force: true });
}

// --- app role -----------------------------------------------------------------
console.log('SITE_ROLE=app (dashboard.fluxyos.com):');
{
    const dir = makeFixture('app');
    run(dir, 'app');

    assert(!exists(dir, 'fluxyos.html') && !exists(dir, 'pricing.html') && !exists(dir, 'use-cases') && !exists(dir, 'id'), 'marketing pages pruned');
    assert(exists(dir, 'login.html') && exists(dir, 'dashboard.html') && exists(dir, 'onboarding.html'), 'app pages kept');
    assert(!exists(dir, 'sitemap.xml') && !exists(dir, 'llms.txt'), 'sitemap/llms pruned');
    assert(read(dir, 'robots.txt').trim() === 'User-agent: *\nDisallow: /', 'disallow-all robots');
    assert(read(dir, '_headers').includes('X-Robots-Tag: noindex, nofollow'), 'noindex _headers written');
    assert(exists(dir, 'netlify/functions/notify-sweep.js'), 'scheduled functions kept on app site');
    assert(!exists(dir, 'deploy'), 'deploy/ templates removed');

    const r = read(dir, '_redirects');
    assert(r.includes('/pricing       https://fluxyos.com/pricing  301!'), 'marketing-path 301 generated (/pricing)');
    assert(r.includes('/fluxyos       https://fluxyos.com/  301!'), 'fluxyos.html special-cases to apex root');
    assert(!r.includes('{{'), 'marker fully expanded');
    assert(r.indexOf('/api/v1/bank-statements/extract') < r.indexOf('/api/v1/*'), 'extractor rule precedes /api/v1 catch-all');
    assert(r.includes('/budget-period/:periodId          /budget-period.html'), 'deep-link rewrites present');
    assert(r.includes('/   /login   302!'), 'root 302s to /login');
    fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll prepare-deploy checks passed.');
