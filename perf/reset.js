#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/reset.js — void every live order in the load-test workspace.
//
// Run between scenarios so each starts from empty tables: a table left
// `awaiting_payment` refuses the next run's orders with `bill_requested`, and
// live orders from one run would sit inside the next run's 50-order window.
//
// Voids through DataService.voidPosOrder — the till's own path, the one
// tests/global-teardown.js uses — never a raw write. Nothing is deleted:
// orders are the record of what the run did. Paid orders are left alone (a
// paid order is a refund, not a void).
//
//   node perf/reset.js            # void every live order
//   node perf/reset.js --dry-run  # count only
// =============================================================================

const { chromium } = require('playwright');
const { readCreds, ensureServer, signIn, withDataService } = require('./lib/session');

const LIVE = ['open', 'submitted', 'sent', 'ready', 'served', 'awaiting_payment'];

async function reset({ account = 'id', dryRun = false, log = console.log } = {}) {
    const creds = readCreds(account);
    const stop = await ensureServer();
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await signIn(page, creds);
        return await withDataService(page, async ({ LIVE, dryRun }) => {
            const { ds, uid } = window.__perf;
            const orders = await ds.getPosOrders(uid, { limitCount: 2000 });
            const live = orders.filter((o) => LIVE.includes(o.status) && !ds._posSettled(o));
            let voided = 0; const failed = [];
            if (!dryRun) {
                for (const o of live) {
                    try { await ds.voidPosOrder(uid, o.id, 'Load test reset'); voided += 1; }
                    catch (e) { failed.push(`${o.order_number || o.id}: ${e.message}`); }
                }
            }
            return { scanned: orders.length, live: live.length, voided, failed };
        }, { LIVE, dryRun });
    } finally {
        await browser.close();
        stop();
    }
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    reset({ dryRun }).then((r) => {
        console.log(`[perf-reset] ${r.scanned} orders scanned, ${r.live} live, ${dryRun ? 'dry run — nothing voided' : `${r.voided} voided`}`);
        if (r.failed.length) { console.log('[perf-reset] could not void:', r.failed.join('; ')); process.exit(1); }
    }).catch((e) => { console.error('[perf-reset] FAILED:', e.message); process.exit(1); });
}

module.exports = { reset };
