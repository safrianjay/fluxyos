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
//
// docs/ and tests/ ARE copied: the source-tree prune is asserted below, and
// skipping them here would make those assertions pass vacuously.
function makeFixture(tag) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), `fluxyos-deploy-${tag}-`));
    for (const entry of fs.readdirSync(ROOT)) {
        if (['node_modules', '.git', '.netlify'].includes(entry)) continue;
        fs.cpSync(path.join(ROOT, entry), path.join(dest, entry), { recursive: true });
    }
    return dest;
}

// The publish dir is the repo root, so anything prepare-deploy leaves behind is
// publicly fetchable. Asserted for BOTH roles.
function assertSourceTreePruned(dir, role) {
    for (const p of ['docs', 'tests', 'scripts', 'seo', 'firestore.rules', 'storage.rules', 'CLAUDE.md']) {
        assert(!exists(dir, p), `${role}: ${p} not published`);
    }
    // Pruning these would break the deploy — functions resolve ../../functions/lib/*
    // and ../../../assets/js/*, and package.json is read during functions bundling.
    for (const p of ['functions', 'assets', 'package.json', 'netlify.toml']) {
        assert(exists(dir, p), `${role}: ${p} kept (deploy needs it)`);
    }
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
    // The no-op path is load-bearing for local dev, Playwright, deploy previews
    // and rollback — the source tree must survive it untouched.
    assert(exists(dir, 'docs') && exists(dir, 'scripts') && exists(dir, 'firestore.rules'),
        'source tree untouched in no-op mode');
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
    assertSourceTreePruned(dir, 'marketing');
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
    assertSourceTreePruned(dir, 'app');

    const r = read(dir, '_redirects');
    assert(r.includes('/pricing       https://fluxyos.com/pricing  301!'), 'marketing-path 301 generated (/pricing)');
    assert(r.includes('/fluxyos       https://fluxyos.com/  301!'), 'fluxyos.html special-cases to apex root');
    assert(!r.includes('{{'), 'marker fully expanded');
    assert(r.indexOf('/api/v1/bank-statements/extract') < r.indexOf('/api/v1/*'), 'extractor rule precedes /api/v1 catch-all');
    assert(r.includes('/budget-period/:periodId          /budget-period.html'), 'deep-link rewrites present');
    assert(r.includes('/   /login   302!'), 'root 302s to /login');
    fs.rmSync(dir, { recursive: true, force: true });
}

// --- till role ----------------------------------------------------------------
console.log('SITE_ROLE=till (pos.fluxyos.com):');
{
    const dir = makeFixture('till');
    run(dir, 'till');

    // Serves the till and its own front door, and nothing else.
    assert(exists(dir, 'pos.html'), 'pos.html kept');
    assert(exists(dir, 'login.html'), 'login.html kept — Firebase auth is per-origin, so the till signs in on its own host');
    assert(!exists(dir, 'dashboard.html') && !exists(dir, 'ledger.html') && !exists(dir, 'accounting.html'),
        'dashboard pages pruned — a cashier device never downloads them');
    assert(!exists(dir, 'settings-billing.html') && !exists(dir, 'internal.html'), 'billing + internal console pruned');
    assert(!exists(dir, 'fluxyos.html') && !exists(dir, 'pricing.html') && !exists(dir, 'use-cases') && !exists(dir, 'id'),
        'marketing pages pruned');
    assert(exists(dir, 'assets'), 'shared assets kept');

    // The till must never be indexed, and must never register a cron. The cron
    // prune is the one that would fail silently: a third site keeping the
    // scheduled functions sends every digest a THIRD time.
    assert(read(dir, 'robots.txt').trim() === 'User-agent: *\nDisallow: /', 'disallow-all robots');
    assert(read(dir, '_headers').includes('X-Robots-Tag: noindex, nofollow'), 'noindex _headers written');
    assert(!exists(dir, 'netlify/functions/notify-sweep.js') && !exists(dir, 'netlify/functions/weekly-digest.js'),
        'scheduled functions pruned — a third cron host would triple every send');
    assert(exists(dir, 'netlify/functions/api.js'), 'request-driven functions kept');
    assert(!exists(dir, 'sitemap.xml') && !exists(dir, 'llms.txt'), 'sitemap/llms pruned');
    assert(!exists(dir, 'deploy'), 'deploy/ templates removed');
    assertSourceTreePruned(dir, 'till');

    const r = read(dir, '_redirects');
    assert(!r.includes('{{'), 'marker fully expanded');
    assert(r.includes('/dashboard       https://dashboard.fluxyos.com/dashboard  301!'), 'app-path 301 to the dashboard origin');
    assert(r.includes('/pricing       https://fluxyos.com/pricing  301!'), 'marketing-path 301 to the apex');
    assert(r.includes('/__/auth/*   https://fluxyos.firebaseapp.com'), 'auth proxy present — without it the popup 404s and nobody can sign in');
    assert(r.includes('/   /login   302!'), 'root 302s to /login');
    // The two dual-served pages must NOT be redirected away from this site.
    assert(!/^\/pos\s/m.test(r) || !r.includes('/pos       https://'), 'pos is served here, not 301d away');
    assert(!r.includes('/login       https://'), 'login is served here, not 301d away');
    fs.rmSync(dir, { recursive: true, force: true });
}

// --- order role ---------------------------------------------------------------
console.log('SITE_ROLE=order (order.fluxyos.com):');
{
    const dir = makeFixture('order');
    run(dir, 'order');

    // ONE page. This origin is loaded by people who are not FluxyOS customers,
    // reached by scanning a laminated card, and the narrowness IS the security
    // posture: what is not deployed cannot be found.
    assert(exists(dir, 'order.html'), 'order.html kept');
    assert(!exists(dir, 'pos.html'), 'the till is pruned — a diner must not reach the cashier surface');
    assert(!exists(dir, 'login.html'),
        'login.html pruned — a customer has no account, and this origin must never sign anyone in');
    assert(!exists(dir, 'dashboard.html') && !exists(dir, 'ledger.html') && !exists(dir, 'settings-billing.html'),
        'dashboard pages pruned');
    assert(!exists(dir, 'fluxyos.html') && !exists(dir, 'pricing.html') && !exists(dir, 'use-cases') && !exists(dir, 'id'),
        'marketing pages pruned');
    assert(exists(dir, 'assets'), 'shared assets kept — the page loads money-format.js');

    assert(read(dir, 'robots.txt').trim() === 'User-agent: *\nDisallow: /', 'disallow-all robots');
    assert(read(dir, '_headers').includes('X-Robots-Tag: noindex, nofollow'), 'noindex _headers written');
    // The fourth site keeping the scheduled functions would register every cron
    // a FOURTH time. Silent until it has already mailed customers four digests.
    assert(!exists(dir, 'netlify/functions/notify-sweep.js') && !exists(dir, 'netlify/functions/weekly-digest.js'),
        'scheduled functions pruned — a fourth cron host would quadruple every send');
    assert(exists(dir, 'netlify/functions/qr-menu.js')
        && exists(dir, 'netlify/functions/qr-order.js')
        && exists(dir, 'netlify/functions/qr-menu-image.js'),
        'the three public QR endpoints are deployed here');
    assert(!exists(dir, 'sitemap.xml') && !exists(dir, 'llms.txt'), 'sitemap/llms pruned');
    assert(!exists(dir, 'deploy'), 'deploy/ templates removed');
    assertSourceTreePruned(dir, 'order');

    const r = read(dir, '_redirects');
    assert(!r.includes('{{'), 'marker fully expanded');
    // The token must survive in the address bar: a 200 rewrite, never a 301,
    // or a customer who reloads lands at a menu that has forgotten their table.
    assert(/^\/t\/\*\s+\/order\.html\s+200/m.test(r), '/t/<token> is a 200 rewrite, not a redirect');
    assert(!/\/t\/\*.*30[12]/.test(r), '/t/* never redirects — that would drop the token');
    assert(r.includes('/dashboard       https://dashboard.fluxyos.com/dashboard  301!'),
        'app-path 301 to the dashboard origin');
    assert(r.includes('/pricing       https://fluxyos.com/pricing  301!'), 'marketing-path 301 to the apex');
    assert(r.includes('/pos       https://dashboard.fluxyos.com/pos  301!'),
        'the till path 301s away to its canonical origin');
    // Deliberately ABSENT. Every other role proxies the Firebase auth handler
    // because a user signs in there. Nobody signs in here, and shipping the
    // proxy would hand an anonymous origin a working auth surface.
    assert(!r.includes('/__/auth/*'),
        'no auth proxy — this origin signs nobody in, so it must not host the handler');
    assert(!/^\/api\/v1\/\*/m.test(r),
        'no /api/v1 catch-all — only the three public QR endpoints are reachable');
    fs.rmSync(dir, { recursive: true, force: true });
}

// --- dual-serve invariant -----------------------------------------------------
// pos.html is served by BOTH app and till during the migration. The app site
// must therefore keep serving it rather than 301ing to a till that has not
// soaked yet — that is what makes the cutover a one-line, reversible edit.
console.log('dual-serve (pos.html on app AND till):');
{
    const dir = makeFixture('dual');
    run(dir, 'app');
    assert(exists(dir, 'pos.html'), 'app still serves pos.html during the migration');
    const r = read(dir, '_redirects');
    assert(!r.includes('/pos       https://pos.fluxyos.com/pos'), 'app does NOT yet 301 /pos to the till origin');
    fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
}
console.log('\nAll prepare-deploy checks passed.');
