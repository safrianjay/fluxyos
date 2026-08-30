'use strict';

// =============================================================================
// FluxyOS — business category backfill (one-shot, run by hand)
//
// Stamps `business_category` onto workspaces created before the field existed.
// Onboarding captures it for every NEW workspace; this is for the ones already
// in production.
//
// WHY A BACKFILL IS REQUIRED, NOT OPTIONAL.
//
// `feature-access.js` reads the category to decide which operational modules a
// workspace is offered. An absent category matches NOTHING — there is no
// sensible default line of business, and guessing one would hand a till to an
// agency. So until a workspace is stamped, it qualifies only through the legacy
// email allowlist. The two signals are OR'd (see `matches()`), which is what
// keeps existing POS/Inventory users working while this runs. Removing the email
// allowlist BEFORE this completes would silently drop a live module from every
// unstamped workspace.
//
// WHY IT DOES NOT GUESS.
//
// There is no reliable signal to infer a category from. `settings/company
// .business_type` is free text and user-scoped; a workspace holding
// `pos_orders` is *probably* F&B but might be retail. This script therefore
// reports what it can see and stamps only what you tell it to — either one
// workspace at a time (`--workspace` + `--category`), or in bulk from a CSV you
// have reviewed. **It never infers.** A wrong category silently adds or removes
// a module, and nothing would report it.
//
// Commands:
//   report   (default) — list every workspace, its current category, and the
//                        evidence available (has POS data, has inventory, the
//                        free-text business_type). Writes nothing.
//   set                — stamp ONE workspace: --workspace <id> --category <id>
//   apply              — stamp in bulk from a reviewed CSV: --file <path>
//                        with rows `workspace_id,category`
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-business-category.js report
//
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-business-category.js set --workspace abc123 --category fnb
//
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-business-category.js apply --file ./categories.csv --dry-run
//
// Flags:
//   --dry-run     plan only, write nothing (recommended first, always)
//   --force       overwrite a category that is already set (default: skip)
//
// The Admin SDK bypasses firestore.rules, so the vocabulary is re-validated here
// rather than trusted. Mirrored from assets/js/business-category.js;
// tests/structure-drift.check.js fails the build if the copies disagree.
// =============================================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const CATEGORIES = ['fnb', 'startup', 'technology', 'manufacturing', 'retail', 'services', 'other'];

const args = process.argv.slice(2);
const COMMAND = (args.find((a) => !a.startsWith('--')) || 'report').toLowerCase();
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

function fail(msg) {
    console.error(`\n✗ ${msg}\n`);
    process.exit(1);
}

const normalize = (v) => String(v || '').trim().toLowerCase();

// Evidence, NOT inference. Printed so a human can decide; never used to choose.
async function gatherEvidence(wsId) {
    const peek = async (col) => {
        try {
            const snap = await db.collection(`workspaces/${wsId}/${col}`).limit(1).get();
            return !snap.empty;
        } catch (_) { return false; }
    };
    const [hasPosOrders, hasPosTables, hasItems, hasStock] = await Promise.all([
        peek('pos_orders'), peek('pos_tables'), peek('items'), peek('stock_movements')
    ]);
    return { hasPosOrders, hasPosTables, hasItems, hasStock };
}

async function report() {
    const snap = await db.collection('workspaces').get();
    console.log(`\n${snap.size} workspace(s)\n`);
    const header = ['workspace_id', 'name', 'category', 'country', 'pos_data', 'inventory_data'];
    console.log(header.join(','));

    let unstamped = 0;
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        const ev = await gatherEvidence(doc.id);
        if (!d.business_category) unstamped += 1;
        console.log([
            doc.id,
            JSON.stringify(d.name || ''),
            d.business_category || '',
            d.country || '',
            (ev.hasPosOrders || ev.hasPosTables) ? 'yes' : 'no',
            (ev.hasItems || ev.hasStock) ? 'yes' : 'no'
        ].join(','));
    }

    console.log(`\n${unstamped} workspace(s) with no category.`);
    console.log('Review the rows above, then stamp with `set` or `apply`.');
    console.log('The pos_data / inventory_data columns are EVIDENCE, not an answer —');
    console.log('a workspace with POS data might be retail rather than F&B.\n');
}

async function stamp(wsId, category, { quiet = false } = {}) {
    const cat = normalize(category);
    if (!CATEGORIES.includes(cat)) {
        fail(`"${category}" is not a category. One of: ${CATEGORIES.join(', ')}`);
    }
    const ref = db.doc(`workspaces/${wsId}`);
    const snap = await ref.get();
    if (!snap.exists) fail(`workspace ${wsId} does not exist`);

    const current = (snap.data() || {}).business_category || null;
    if (current && !FORCE) {
        if (!quiet) console.log(`  skip ${wsId} — already "${current}" (pass --force to overwrite)`);
        return 'skipped';
    }
    if (DRY_RUN) {
        console.log(`  would set ${wsId} → ${cat}${current ? ` (was "${current}")` : ''}`);
        return 'planned';
    }
    await ref.set({ business_category: cat, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`  set ${wsId} → ${cat}${current ? ` (was "${current}")` : ''}`);
    return 'written';
}

async function applyCsv() {
    const file = flag('file', null);
    if (!file) fail('apply needs --file <path> (rows: workspace_id,category)');
    const abs = path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) fail(`no such file: ${abs}`);

    const rows = fs.readFileSync(abs, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split(',').map((c) => c.trim()))
        // Tolerate the header line emitted by `report`.
        .filter((c) => c[0] && c[0] !== 'workspace_id');

    if (!rows.length) fail('no usable rows in the file');
    console.log(`\n${rows.length} row(s)${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}\n`);

    const tally = { written: 0, skipped: 0, planned: 0 };
    for (const [wsId, category] of rows) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await stamp(wsId, category, { quiet: false });
        tally[outcome] = (tally[outcome] || 0) + 1;
    }
    console.log(`\ndone — ${tally.written} written, ${tally.planned} planned, ${tally.skipped} skipped\n`);
}

async function main() {
    if (COMMAND === 'report') return report();
    if (COMMAND === 'set') {
        const wsId = flag('workspace', null);
        const category = flag('category', null);
        if (!wsId || !category) fail('set needs --workspace <id> --category <id>');
        console.log(DRY_RUN ? '\nDRY RUN — nothing will be written\n' : '');
        await stamp(wsId, category);
        console.log('');
        return undefined;
    }
    if (COMMAND === 'apply') return applyCsv();
    return fail(`unknown command "${COMMAND}" (expected report | set | apply)`);
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
