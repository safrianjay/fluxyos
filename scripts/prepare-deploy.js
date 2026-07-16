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

// ---------------------------------------------------------------------------
// Page classification — single source of truth for the split.
// ---------------------------------------------------------------------------

const MARKETING_PAGES = [
    'fluxyos.html',       // homepage (served at /)
    'pricing.html',
    'contact-sales.html',
    'aiagents.html',
    'budgetlanding.html',
    'revenuesync.html',
    'receiptcapture.html',
    'vendorspend.html',
    'privacy.html',
    'terms.html',
    'investor.html',
    'index.html',         // redirect stub -> /fluxyos
    'payment.html',       // redirect stub -> /pricing
];

const APP_PAGES = [
    'accounting.html',
    'accounting-journal.html',
    'accounting-journal-new.html',
    'accounting-records.html',
    'activity-log.html',
    'ai.html',
    'balance-sheet.html',
    'balance-sheet-records.html',
    'bill.html',
    'budget.html',
    'budget-allocation.html',
    'budget-period.html',
    'cash-position.html',
    'cash-pressure.html',
    'checkout.html',
    'dashboard.html',
    'integration.html',
    'internal.html',
    'invoices.html',
    'ledger.html',
    'login.html',
    'onboarding.html',
    'opex-budget.html',
    'payment-pending.html',
    'report-preview.html',
    'reports.html',
    'revenue-overview.html',
    'revenue-sync.html',
    'settings.html',
    'settings-ai.html',
    'settings-billing.html',
    'settings-budget.html',
    'settings-business.html',
    'settings-cash.html',
    'settings-finance.html',
    'settings-import-rules.html',
    'settings-language.html',
    'settings-notifications.html',
    'settings-personal.html',
    'settings-security.html',
    'settings-team.html',
    'settings-whatsapp.html',
    'subscription.html',
    'tax-center.html',
];

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
    'notify-sweep.js',
    'payment-reminders.js',
    'trial-reminders.js',
    'weekly-digest.js',
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
    const marketing = new Set(MARKETING_PAGES);
    const app = new Set(APP_PAGES);

    const both = MARKETING_PAGES.filter((f) => app.has(f));
    if (both.length) fail(`pages classified as BOTH marketing and app: ${both.join(', ')}`);

    const unclassified = rootHtml.filter((f) => !marketing.has(f) && !app.has(f));
    if (unclassified.length) {
        fail(
            `unclassified root page(s): ${unclassified.join(', ')}\n` +
            'Add each one to MARKETING_PAGES or APP_PAGES in scripts/prepare-deploy.js.'
        );
    }

    const missing = [...MARKETING_PAGES, ...APP_PAGES].filter(
        (f) => !rootHtml.includes(f)
    );
    if (missing.length) fail(`classified page(s) missing from repo root: ${missing.join(', ')}`);
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

function installRedirects(role, marker, generated) {
    const src = path.join(ROOT, 'deploy', `_redirects.${role}`);
    if (!fs.existsSync(src)) fail(`missing template deploy/_redirects.${role}`);
    const template = fs.readFileSync(src, 'utf8');
    if (!template.includes(marker)) fail(`marker ${marker} not found in _redirects.${role}`);
    fs.writeFileSync(path.join(ROOT, '_redirects'), template.replace(marker, generated));
    console.log(`[prepare-deploy]   installed _redirects (${role})`);
}

function prepareMarketing() {
    APP_PAGES.forEach(rm);
    SCHEDULED_FUNCTIONS.forEach((f) => rm(path.join('netlify', 'functions', f)));
    installRedirects('marketing', '# {{APP_PAGE_REDIRECTS}}', pageRedirects(APP_PAGES, APP_ORIGIN));
}

function prepareApp() {
    MARKETING_PAGES.forEach(rm);
    MARKETING_DIRS.forEach(rm);
    rm('sitemap.xml');
    rm('llms.txt');

    // The app host must never be indexed: disallow-all robots + noindex header.
    fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    console.log('[prepare-deploy]   wrote disallow-all robots.txt');
    fs.writeFileSync(path.join(ROOT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
    console.log('[prepare-deploy]   wrote _headers (X-Robots-Tag: noindex)');

    installRedirects('app', '# {{MARKETING_PAGE_REDIRECTS}}', pageRedirects(MARKETING_PAGES, MARKETING_ORIGIN));
}

function main() {
    const role = (process.env.SITE_ROLE || '').trim();

    if (!role) {
        console.log('[prepare-deploy] SITE_ROLE not set — monolith deploy, nothing to do.');
        return;
    }
    if (role !== 'marketing' && role !== 'app') {
        fail(`unknown SITE_ROLE "${role}" (expected "marketing" or "app")`);
    }

    assertClassification();
    console.log(`[prepare-deploy] shaping deploy for SITE_ROLE=${role}`);

    if (role === 'marketing') prepareMarketing();
    else prepareApp();

    // Templates must not ship as public files (publish dir is the repo root).
    rm('deploy');
    console.log(`[prepare-deploy] done (${role}).`);
}

main();
