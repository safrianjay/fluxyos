#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/till-watch.js — keep instrumented till tabs open through a load run and
// log what the traffic costs them (plan hypothesis H2, finding F5).
//
// Each tab is pos.html served locally against production Firebase, with
// perf/lib/till-hook.js prepended to pos.js (see s1-baseline.js for why that
// measures the till without changing it). Every minute, per tab, one NDJSON
// line: listener deliveries, refreshes, overlapping refreshes, refresh
// durations, and how long the newest QR order took to reach the board.
//
//   node perf/till-watch.js --run s3-1x --minutes 95 --tabs 2 --outlet "Kelapa Gading"
// =============================================================================

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { readCreds, readFixtures, ensureServer, signIn, APP, outDir } = require('./lib/session');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const RUN = flag('run', 'adhoc');
const MINUTES = Number(flag('minutes', 90));
const TABS = Number(flag('tabs', 2));

async function openTab(browser, creds, outletId, n) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`[till-watch] tab ${n} page error:`, e.message));
    await page.route('**/assets/js/pos.js*', async (route) => {
        const resp = await route.fetch();
        await route.fulfill({ response: resp, body: `import '/perf/lib/till-hook.js';\n${await resp.text()}` });
    });
    await signIn(page, creds);
    await page.evaluate((id) => localStorage.setItem('fluxyos-pos-outlet', id), outletId);
    await page.goto(`${APP}/pos`, { timeout: 60_000 });
    await page.waitForFunction(() => window.__tillProbe && window.__tillProbe.refreshes.length > 0, null, { timeout: 90_000 });
    return page;
}

async function main() {
    const fx = readFixtures();
    const outlet = fx.outlets.find((o) => o.name === flag('outlet', fx.outlets[0].name)) || fx.outlets[0];
    const creds = readCreds('id');
    const stop = await ensureServer();
    const browser = await chromium.launch();
    const file = path.join(outDir(RUN), 'till.ndjson');
    const out = fs.createWriteStream(file, { flags: 'a' });
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; });
    try {
        const tabs = [];
        for (let i = 0; i < TABS; i += 1) tabs.push(await openTab(browser, creds, outlet.id, i + 1));
        console.log(`[till-watch] ${TABS} till tab(s) on ${outlet.name} for ${MINUTES} min → ${path.relative(process.cwd(), file)}`);
        const seen = tabs.map(() => ({ snapshots: 0, refreshes: 0, calls: 0 }));
        const end = Date.now() + MINUTES * 60_000;
        while (!stopping && Date.now() < end) {
            await new Promise((r) => setTimeout(r, 60_000));
            for (let i = 0; i < tabs.length; i += 1) {
                const p = await tabs[i].evaluate(() => JSON.parse(JSON.stringify(window.__tillProbe))).catch(() => null);
                if (!p) continue;
                const s = seen[i];
                const snaps = p.snapshots.slice(s.snapshots);
                const refs = p.refreshes.slice(s.refreshes);
                const calls = p.calls.slice(s.calls);
                // When did each order first appear in a delivery, and first on the board?
                const lag = [];
                const firstSeen = new Map();
                p.snapshots.forEach((sn) => sn.rows.forEach(([id]) => { if (!firstSeen.has(id)) firstSeen.set(id, sn.at); }));
                refs.forEach((r) => r.active.forEach(([id]) => {
                    const h = firstSeen.get(id);
                    if (h && r.end >= h && !s[`shown_${id}`]) { s[`shown_${id}`] = 1; lag.push(Math.round(r.end - h)); }
                }));
                const durs = refs.map((r) => r.end - r.start).sort((a, b) => a - b);
                out.write(JSON.stringify({
                    at: new Date().toISOString(), tab: i + 1,
                    deliveries: snaps.length, refreshes: refs.length,
                    max_overlapping: Math.max(0, ...refs.map((r) => r.overlapping)),
                    refresh_ms_median: durs.length ? Math.round(durs[Math.floor(durs.length / 2)]) : null,
                    refresh_ms_max: durs.length ? Math.round(durs[durs.length - 1]) : null,
                    reads_calls: calls.length,
                    heard_to_board_ms: lag
                }) + '\n');
                s.snapshots = p.snapshots.length; s.refreshes = p.refreshes.length; s.calls = p.calls.length;
            }
        }
    } finally {
        out.end();
        await browser.close();
        stop();
        console.log('[till-watch] closed');
    }
}

main().catch((e) => { console.error('[till-watch] FAILED:', e.message); process.exit(1); });
