#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/waterfall.js — one table link, cold, on Lighthouse's mobile 4G, printed
// as a request waterfall: when each request started and finished relative to
// the document, and the moments that matter to a diner (menu data, first photo
// painted, LCP). S1 reports medians; this shows WHY a number is what it is.
//
//   node perf/waterfall.js [url] [--runs 3] [--map 127.0.0.1:8766]
//
// --map sends order.fluxyos.com to a local server instead (Chrome host-resolver
// rules, certificate errors ignored) so a page change can be measured against
// production's API, fonts and storage BEFORE it ships: see perf/serve-order.js.
// Everything else — Cloud Run, Google Fonts, Cloud Storage — is the real thing.
// =============================================================================

const { chromium, devices } = require('playwright');
const { readFixtures } = require('./lib/session');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const RUNS = Number(flag('runs', 3));
const MAP = flag('map', null);
const QUIET = args.includes('--quiet');
const url = args.find((a) => /^https?:/.test(a)) || readFixtures().outlets[0].tables[11].url;

const MOBILE_4G = { latency: 150, downloadThroughput: (1638.4 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

const VITALS = () => {
    window.__vitals = { lcp: null, firstPhoto: null, firstPhotoSrc: null };
    try {
        new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__vitals.lcp = e.startTime; }); })
            .observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) { /* old engine */ }
    document.addEventListener('load', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && /qr-menu-image|storage\.googleapis/.test(t.currentSrc || t.src) && window.__vitals.firstPhoto == null) {
            window.__vitals.firstPhoto = performance.now();
            window.__vitals.firstPhotoSrc = (t.currentSrc || t.src);
        }
    }, true);
};

function label(u) {
    if (/\/t\/[A-Za-z0-9_-]+/.test(u)) return 'document';
    const m = u.match(/\/(qr-[a-z-]+)\?/);
    if (m) return m[1] + (/[?&]size=thumb/.test(u) ? ' (thumb)' : '') + (/[?&]item=([^&]+)/.test(u) ? ' ' + u.match(/[?&]item=([^&]+)/)[1].slice(0, 6) : '');
    if (u.includes('storage.googleapis.com')) return 'storage ' + (u.match(/__w640/) ? 'thumb' : 'full');
    if (u.includes('fonts.googleapis.com')) return 'fonts css';
    if (u.includes('fonts.gstatic.com')) return 'font file';
    return u.replace(/^https?:\/\/[^/]+/, '').slice(0, 48);
}

async function one(browser) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.addInitScript(VITALS);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...MOBILE_4G });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    const reqs = new Map();
    cdp.on('Network.requestWillBeSent', (e) => {
        const r = reqs.get(e.requestId);
        if (r && e.redirectResponse) { r.redirectAt = e.timestamp; r.url = e.request.url; return; }
        if (!r) reqs.set(e.requestId, { first: e.request.url, url: e.request.url, start: e.timestamp, prio: e.request.initialPriority });
    });
    cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
    cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => window.__vitals && window.__vitals.firstPhoto != null, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const v = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return { ...window.__vitals, nav: n && { responseStart: n.responseStart, responseEnd: n.responseEnd, domInteractive: n.domInteractive, dcl: n.domContentLoadedEventEnd } };
    });
    const all = [...reqs.values()].sort((a, b) => a.start - b.start);
    const doc = all.find((r) => label(r.first) === 'document');
    const rel = (x) => (x == null ? '' : Math.round((x - doc.start) * 1000));
    const menu = all.find((r) => /\/qr-menu\?/.test(r.first));
    const res = {
        html_first_byte: Math.round(v.nav.responseStart), html_done: Math.round(v.nav.responseEnd),
        dom_interactive: Math.round(v.nav.domInteractive),
        menu_start: rel(menu && menu.start), menu_done: rel(menu && menu.end),
        first_photo: v.firstPhoto && Math.round(v.firstPhoto), lcp: v.lcp && Math.round(v.lcp),
        doc_kb: Math.round((doc.bytes || 0) / 1024),
        total_kb: Math.round(all.reduce((s, r) => s + (r.bytes || 0), 0) / 1024),
        photos_by_first_paint: all.filter((r) => /qr-menu-image/.test(r.first) && v.firstPhoto && (r.start - doc.start) * 1000 < v.firstPhoto).length,
        first_photo_src: v.firstPhotoSrc && label(v.firstPhotoSrc)
    };
    if (!QUIET) {
        all.filter((r) => v.firstPhoto == null || (r.start - doc.start) * 1000 < v.firstPhoto + 300).forEach((r) => {
            const hop = r.redirectAt ? ` (302 at ${rel(r.redirectAt)})` : '';
            console.log(`  ${String(rel(r.start)).padStart(5)} → ${String(rel(r.end)).padStart(5)}  ${String(Math.round((r.bytes || 0) / 1024)).padStart(4)} KB  ${(r.prio || '').padEnd(8)} ${label(r.first)}${hop}${r.failed ? ' FAILED ' + r.failed : ''}`);
        });
    }
    await ctx.close();
    return res;
}

(async () => {
    const browser = await chromium.launch({ args: MAP ? [`--host-resolver-rules=MAP order.fluxyos.com ${MAP}`, '--ignore-certificate-errors'] : [] });
    const out = [];
    for (let i = 0; i < RUNS; i++) {
        if (!QUIET || i === 0) console.log(`\nrun ${i + 1}${MAP ? ' (mapped to ' + MAP + ')' : ''}: ${url.replace(/\/t\/.*/, '/t/…')}`);
        const r = await one(browser);
        console.log('  ' + JSON.stringify(r));
        out.push(r);
    }
    const med = (k) => { const xs = out.map((r) => r[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b); return xs.length ? xs[Math.floor((xs.length - 1) / 2)] : null; };
    console.log('\nmedian:', JSON.stringify(Object.fromEntries(['html_done', 'dom_interactive', 'menu_start', 'menu_done', 'first_photo', 'lcp', 'doc_kb', 'total_kb'].map((k) => [k, med(k)]))));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
