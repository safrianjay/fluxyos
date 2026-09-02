#!/usr/bin/env node
/**
 * Shape the deploy output for the two-site split (Stripe model):
 *
 *   fluxyos.com            SITE_ROLE=marketing  — landing pages only
 *   dashboard.fluxyos.com  SITE_ROLE=app        — the logged-in app (incl. /login)
 *
 * Both Netlify sites build from this one repo; the per-site SITE_ROLE env var
 * (set in the Netlify UI, Production context only) decides which half of the
 * repo ships. Runs as the last build step (netlify.toml build command), AFTER
 * build:css — tailwind.config.js content globs scan the marketing HTML, so
 * pruning must not happen before the CSS is compiled.
 *
 * Per role it:
 *   - deletes the other role's root HTML pages (and, for app, the marketing
 *     dirs use-cases/ + id/ plus sitemap.xml + llms.txt),
 *   - installs the role's _redirects from deploy/_redirects.<role>, expanding
 *     the {{...}} marker into explicit per-page cross-origin 301s generated
 *     from the SAME page lists (no drift possible),
 *   - marketing only: deletes the scheduled notification functions so their
 *     crons can never register on the apex site (structural double-send guard
 *     on top of the NOTIFY_ENABLED/DIGEST_ENABLED env gates),
 *   - app only: swaps robots.txt to disallow-all and writes an _headers file
 *     with X-Robots-Tag: noindex (the app host must never be indexed).
 *
 * With SITE_ROLE unset (local dev, Playwright's static server, deploy
 * previews, rollback) this script is a NO-OP: the repo root keeps serving the
 * full monolith and netlify.toml's untouched redirect rules apply. _redirects
 * files are processed by Netlify BEFORE netlify.toml rules, which is what lets
 * each role's file shadow the monolith rules it needs to override.
 *
 * GUARD: every root *.html must be classified in exactly one of the two lists
 * below. Adding a new root page without classifying it here fails BOTH site
 * builds on purpose — decide which origin the page belongs to, then ship.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKETING_ORIGIN = 'https://fluxyos.com';
const APP_ORIGIN = 'https://dashboard.fluxyos.com';
const TILL_ORIGIN = 'https://pos.fluxyos.com';
const ORDER_ORIGIN = 'https://order.fluxyos.com';
const ORIGIN = {
    marketing: MARKETING_ORIGIN, app: APP_ORIGIN, till: TILL_ORIGIN, order: ORDER_ORIGIN
};

// ---------------------------------------------------------------------------
// Page classification — single source of truth for the split.
// ---------------------------------------------------------------------------

// Page → the roles that SERVE it. The FIRST role listed is the page's
// canonical origin: every other site 301s the path there, generated from this
// same map so a redirect can never disagree with a page list.
//
// A page may be served by more than one role. That is what makes the POS
// migration reversible: `pos.html` is ['app', 'till'] while both work, and
// dropping 'app' later turns /pos on the dashboard into a 301 to the till
// origin automatically — one edit, no new redirect to write.
const PAGE_ROLES = {
    // ── marketing (fluxyos.com) ──────────────────────────────────────────
    'fluxyos.html': ['marketing'],   // homepage (served at /)
    'pricing.html': ['marketing'],
    'contact-sales.html': ['marketing'],
    'event.html': ['marketing'],   // QR-scanned event signup (noindex)
    'aiagents.html': ['marketing'],
    'budgetlanding.html': ['marketing'],
    'revenuesync.html': ['marketing'],
    'receiptcapture.html': ['marketing'],
    'vendorspend.html': ['marketing'],
    'privacy.html': ['marketing'],
    'terms.html': ['marketing'],
    'investor.html': ['marketing'],
    'beila.html': ['marketing'],   // private investor deck, password-gated + noindex
    'index.html': ['marketing'],   // redirect stub -> /fluxyos
    'payment.html': ['marketing'],   // redirect stub -> /pricing

    // ── app (dashboard.fluxyos.com) ─────────────────────────────────────
    'accounting.html': ['app'],
    'accounting-account.html': ['app'],
    'accounting-journal.html': ['app'],
    'accounting-journal-new.html': ['app'],
    'accounting-records.html': ['app'],
    'activity-log.html': ['app'],
    'ai.html': ['app'],
    'bill.html': ['app'],
    'budget.html': ['app'],
    'budget-allocation.html': ['app'],
    'budget-period.html': ['app'],
    'cash-position.html': ['app'],
    'cash-pressure.html': ['app'],
    'checkout.html': ['app'],
    'dashboard.html': ['app'],
    'integration.html': ['app'],
    'internal.html': ['app'],
    'inventory-activity.html': ['app'],
    'inventory-count.html': ['app'],
    'inventory.html': ['app'],
    'invoices.html': ['app'],
    'ledger.html': ['app'],
    // The till origin needs its own front door: Firebase auth is keyed by
    // origin, so a cashier signs in ON pos.fluxyos.com. Served by both.
    'login.html': ['app', 'till'],
    'net-profit.html': ['app'],
    'onboarding.html': ['app'],
    'opex-budget.html': ['app'],
    'outlet-pnl.html': ['app'],
    'payment-pending.html': ['app'],
    // Dual-served during the migration. Canonical stays 'app' until the
    // till origin has soaked a week of real service (plan §7 step 6).
    'pos.html': ['app', 'till'],
    'report-preview.html': ['app'],
    'reports.html': ['app'],
    'revenue-overview.html': ['app'],
    'revenue-sync.html': ['app'],
    'settings.html': ['app'],
    'settings-ai.html': ['app'],
    'settings-billing.html': ['app'],
    'settings-budget.html': ['app'],
    'settings-business.html': ['app'],
    'settings-cash.html': ['app'],
    'settings-finance.html': ['app'],
    'settings-import-rules.html': ['app'],
    'settings-language.html': ['app'],
    'settings-notifications.html': ['app'],
    'settings-personal.html': ['app'],
    'settings-security.html': ['app'],
    'settings-team.html': ['app'],
    'settings-whatsapp.html': ['app'],
    'subscription.html': ['app'],
    'tax-center.html': ['app'],

    // ── order (order.fluxyos.com) ──────────────────────────────────
    // The diner's surface, reached by scanning the QR on a table. Its own
    // origin and nothing else on it: this is the only page in the product
    // loaded by someone who is not a customer OF FluxyOS, and giving it a
    // separate host is what keeps a bug there from reaching a session on the
    // dashboard. It carries no Firebase SDK and signs nobody in.
    'order.html': ['order'],
};

// Derived views. Nothing below re-lists a page, so the map is the only place a
// page is classified.
const ROLES = ['marketing', 'app', 'till', 'order'];
const pagesFor = (role) => Object.keys(PAGE_ROLES).filter((f) => PAGE_ROLES[f].includes(role));
const canonicalRole = (file) => PAGE_ROLES[file][0];

const MARKETING_PAGES = pagesFor('marketing');
const APP_PAGES = pagesFor('app');
const TILL_PAGES = pagesFor('till');
const ORDER_PAGES = pagesFor('order');

// Marketing-only directories, pruned from app deploys. includes/ and assets/
// stay on both sites (footer partials are only fetched by marketing pages;
// assets are shared).
const MARKETING_DIRS = ['use-cases', 'id'];

// Cron-registering functions. Pruned from the marketing deploy so the apex
// site can never double-send even if an env flag is set there by mistake.
// Request-driven functions (api, invites, contact-sales, ...) stay on both.
const SCHEDULED_FUNCTIONS = [
    'announce-id-language.js',
    'announce-invoice-multicurrency.js',
    'billing-reminders.js',
    'commerce-reconcile.js',
    'commerce-sync-worker.js',
    'digest-broadcast-worker.js',
    'invoice-email-worker.js',
    'ledger-integrity-sweep.js',
    'notify-sweep.js',
    'storage-token-sweep.js',
    'payment-reminders.js',
    'trial-reminders.js',
    'weekly-digest.js',
];

// Source-tree paths that must never be publicly served. The publish dir is the
// repo root, so anything left behind is fetchable — docs/PROJECT_BACKGROUND.md,
// firestore.rules and friends were all returning 200 on production until this
// pruning was added (2026-08-12). They also served as text/markdown under an
// allow-all robots.txt, so they were indexable as thin content on the domain.
//
// Deliberately NOT pruned, because the deploy genuinely needs them:
//   functions/      required by netlify/functions/* via ../../functions/lib/*
//   assets/         served, and required by the invoice-email function
//   node_modules/   netlify.toml included_files pins @sparticuz/chromium
//   package*.json   read during the functions-bundling phase, which runs AFTER
//                   the build command — removing it risks breaking the bundle
//   netlify.toml    build/deploy configuration
const PRIVATE_DIRS = ['docs', 'tests', 'scripts', 'seo', '.githooks', 'cbm-extracted'];
const PRIVATE_FILES = [
    'firestore.rules',
    'storage.rules',
    'firestore.indexes.json',
    'firebase.json',
    'cors.json',
    'tailwind.config.js',
    'playwright.config.js',
];

// ---------------------------------------------------------------------------

function fail(msg) {
    console.error(`[prepare-deploy] ERROR: ${msg}`);
    process.exit(1);
}

function rm(rel) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        console.log(`[prepare-deploy]   pruned ${rel}`);
    }
}

// Every root *.html must be classified in exactly one list.
function assertClassification() {
    const rootHtml = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
    const classified = Object.keys(PAGE_ROLES);

    const unclassified = rootHtml.filter((f) => !classified.includes(f));
    if (unclassified.length) {
        fail(
            `unclassified root page(s): ${unclassified.join(', ')}\n` +
            'Add each one to PAGE_ROLES in scripts/prepare-deploy.js, mapped to the\n' +
            `role(s) that serve it: ${ROLES.join(' | ')}. The FIRST role listed is the\n` +
            'page\'s canonical origin — every other site 301s the path there.'
        );
    }

    const missing = classified.filter((f) => !rootHtml.includes(f));
    if (missing.length) fail(`classified page(s) missing from repo root: ${missing.join(', ')}`);

    // A page served by no role is unreachable everywhere, which is almost
    // certainly a typo rather than an intent — the old two-list model could not
    // express it, so it was impossible; now it is, and it fails loudly.
    const orphans = classified.filter((f) => !PAGE_ROLES[f].length);
    if (orphans.length) fail(`page(s) with an empty role list, served nowhere: ${orphans.join(', ')}`);

    const badRole = classified.filter((f) => PAGE_ROLES[f].some((r) => !ROLES.includes(r)));
    if (badRole.length) {
        fail(`page(s) mapped to an unknown role: ${badRole.map((f) => `${f} → ${PAGE_ROLES[f].join(',')}`).join('; ')}`);
    }

    assertScheduledFunctionsClassified();
}

// Every cron-registering function must be listed in SCHEDULED_FUNCTIONS, or the
// marketing build stops pruning it and the cron registers on BOTH sites. Unlike
// the page lists this used to be unguarded, so a new scheduled function was a
// silent double-registration — the failure mode being guarded against is a
// duplicate nightly run, which is invisible until it does damage.
function assertScheduledFunctionsClassified() {
    const dir = path.join(ROOT, 'netlify', 'functions');
    if (!fs.existsSync(dir)) return;
    const declared = new Set(SCHEDULED_FUNCTIONS);
    const scheduled = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.js'))
        .filter((f) => /\bschedule\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));

    const unlisted = scheduled.filter((f) => !declared.has(f));
    if (unlisted.length) {
        fail(
            `scheduled function(s) missing from SCHEDULED_FUNCTIONS: ${unlisted.join(', ')}\n` +
            'Add each one to SCHEDULED_FUNCTIONS in scripts/prepare-deploy.js, or its cron\n' +
            'will also register on the marketing site.'
        );
    }

    const stale = SCHEDULED_FUNCTIONS.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (stale.length) fail(`SCHEDULED_FUNCTIONS lists missing file(s): ${stale.join(', ')}`);
}

// Expand a page list into explicit /page + /page.html cross-origin 301 pairs.
// index.html / fluxyos.html special-case to the origin root.
function pageRedirects(pages, origin) {
    const lines = [];
    for (const file of pages) {
        const base = file.replace(/\.html$/, '');
        const target =
            base === 'index' || base === 'fluxyos' ? `${origin}/` : `${origin}/${base}`;
        lines.push(`/${base}       ${target}  301!`);
        lines.push(`/${base}.html  ${target}  301!`);
    }
    return lines.join('\n');
}

// Every page THIS role does not serve, 301'd to its canonical origin. Generated
// from PAGE_ROLES, so a page served by two roles is never redirected away from
// either of them — which is what lets pos.html live on both sites at once.
function foreignPageRedirects(role) {
    const byOrigin = {};
    for (const file of Object.keys(PAGE_ROLES)) {
        if (PAGE_ROLES[file].includes(role)) continue;      // served here
        const target = ORIGIN[canonicalRole(file)];
        (byOrigin[target] = byOrigin[target] || []).push(file);
    }
    return Object.keys(byOrigin)
        .map((origin) => pageRedirects(byOrigin[origin], origin))
        .join('\n');
}

function installRedirects(role, marker, generated) {
    const src = path.join(ROOT, 'deploy', `_redirects.${role}`);
    if (!fs.existsSync(src)) fail(`missing template deploy/_redirects.${role}`);
    const template = fs.readFileSync(src, 'utf8');
    if (!template.includes(marker)) fail(`marker ${marker} not found in _redirects.${role}`);
    fs.writeFileSync(path.join(ROOT, '_redirects'), template.replace(marker, generated));
    console.log(`[prepare-deploy]   installed _redirects (${role})`);
}

// Pages this role does not serve. Derived, so adding a role to a page in
// PAGE_ROLES is the only edit needed to start serving it.
function pruneForeignPages(role) {
    Object.keys(PAGE_ROLES)
        .filter((f) => !PAGE_ROLES[f].includes(role))
        .forEach(rm);
}

function prepareMarketing() {
    pruneForeignPages('marketing');
    SCHEDULED_FUNCTIONS.forEach((f) => rm(path.join('netlify', 'functions', f)));
    installRedirects('marketing', '# {{APP_PAGE_REDIRECTS}}', foreignPageRedirects('marketing'));
}

// The till: a cashier surface, never indexed, and never a cron host.
//
// The scheduled-function prune is the load-bearing line here. Each site deploys
// the same functions directory, so a third site that keeps them registers every
// cron a THIRD time — a triple nightly digest, invisible until it has already
// mailed customers. The marketing role has pruned them since the split shipped
// for exactly this reason; the till inherits the same guard rather than relying
// on an env flag being unset.
function prepareTill() {
    pruneForeignPages('till');
    MARKETING_DIRS.forEach(rm);
    rm('sitemap.xml');
    rm('llms.txt');
    SCHEDULED_FUNCTIONS.forEach((f) => rm(path.join('netlify', 'functions', f)));

    fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('[prepare-deploy]   wrote disallow-all robots.txt');
    // Only the noindex header is set here. The CSP in netlify.toml still applies
    // (Netlify merges _headers over the toml by header NAME), and the till needs
    // essentially all of it: Firebase SDK from gstatic, the auth popup framed
    // from the apex, Firestore over googleapis. Writing a "tighter" CSP without
    // measuring what the page actually loads is how a till stops taking payment
    // at 7pm. Tightening it is a real follow-up — serve the page with a
    // report-only policy and collect violations first.
    fs.writeFileSync(path.join(ROOT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
    console.log('[prepare-deploy]   wrote _headers (X-Robots-Tag: noindex)');

    installRedirects('till', '# {{FOREIGN_PAGE_REDIRECTS}}', foreignPageRedirects('till'));
}

// The diner's surface. The narrowest deploy in the product: one page, no
// Firebase SDK, no session, nobody signed in.
//
// The scheduled-function prune is the load-bearing line, for the same reason it
// is on the till and on marketing — every site deploys the same functions
// directory, so a FOURTH site that keeps them registers every cron a fourth
// time. A quadruple nightly digest is invisible until it has already mailed
// customers.
function prepareOrder() {
    pruneForeignPages('order');
    MARKETING_DIRS.forEach(rm);
    rm('sitemap.xml');
    rm('llms.txt');
    SCHEDULED_FUNCTIONS.forEach((f) => rm(path.join('netlify', 'functions', f)));

    fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('[prepare-deploy]   wrote disallow-all robots.txt');
    fs.writeFileSync(path.join(ROOT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
    console.log('[prepare-deploy]   wrote _headers (X-Robots-Tag: noindex)');

    installRedirects('order', '# {{FOREIGN_PAGE_REDIRECTS}}', foreignPageRedirects('order'));
}

function prepareApp() {
    pruneForeignPages('app');
    MARKETING_DIRS.forEach(rm);
    rm('sitemap.xml');
    rm('llms.txt');

    // The app host must never be indexed: disallow-all robots + noindex header.
    fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('[prepare-deploy]   wrote disallow-all robots.txt');
    fs.writeFileSync(path.join(ROOT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
    console.log('[prepare-deploy]   wrote _headers (X-Robots-Tag: noindex)');

    installRedirects('app', '# {{MARKETING_PAGE_REDIRECTS}}', foreignPageRedirects('app'));
}

// Strip the source tree from the published output. Runs for BOTH roles, and
// only after the role branch — with SITE_ROLE unset this is never reached, so
// local dev / Playwright / deploy previews / rollback keep the full monolith.
// This deletes scripts/ (including this file) last; Node has already loaded the
// module, so removing it mid-run is safe.
function pruneSourceTree() {
    PRIVATE_FILES.forEach(rm);
    fs.readdirSync(ROOT)
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .forEach(rm);
    PRIVATE_DIRS.forEach(rm);
}

function main() {
    const role = (process.env.SITE_ROLE || '').trim();

    if (!role) {
        console.log('[prepare-deploy] SITE_ROLE not set — monolith deploy, nothing to do.');
        return;
    }
    if (!ROLES.includes(role)) {
        fail(`unknown SITE_ROLE "${role}" (expected ${ROLES.map((r) => `"${r}"`).join(' | ')})`);
    }

    assertClassification();
    console.log(`[prepare-deploy] shaping deploy for SITE_ROLE=${role}`);

    if (role === 'marketing') prepareMarketing();
    else if (role === 'till') prepareTill();
    else if (role === 'order') prepareOrder();
    else prepareApp();

    // Templates must not ship as public files (publish dir is the repo root).
    rm('deploy');
    pruneSourceTree();
    console.log(`[prepare-deploy] done (${role}).`);
}

// Only shape the deploy when RUN. Requiring this module must never prune the
// repo — `lint-design.js` and `netlify-should-build.js` both import it for the
// page classification, and before this guard existed they regex-scraped the
// source instead. That scrape broke the moment the lists became derived rather
// than literal, which is how it was found: the linter crashed on
// "could not parse APP_PAGES" rather than silently linting nothing.
if (require.main === module) main();

// The classification, for the two consumers that need it. Exporting the map and
// the derived views means a role can be added here and nothing downstream has to
// learn a new shape.
module.exports = {
    PAGE_ROLES,
    ROLES,
    pagesFor,
    canonicalRole,
    MARKETING_PAGES,
    APP_PAGES,
    TILL_PAGES,
    ORDER_PAGES,
};
