'use strict';

// =============================================================================
// The till reads ONE OUTLET's orders, never "the workspace's newest N".
//
// docs/data-model/pos.md §5b. The till's board read the workspace's newest 300
// orders and its live listener the newest 120, keeping one outlet's on the
// device; in a busy multi-outlet workspace the other outlets spent that
// window, and a table seated an hour ago fell off the board and read as FREE.
// `perf/till-contract.js` reproduced it (310 newer orders elsewhere: the order
// gone from the board, its changes never heard) and proves the fix.
//
// Two neighbours had the same shape and are pinned here too:
//   - the shift tally counted the drawer from the workspace's newest 300 —
//     a long shift's early sales dropped out and posted as a loss
//   - the archive guard looked at the workspace's newest FIVE orders, and
//     treated "could not check" as "nothing open"
//
// Static: these are facts about the source. Run: node tests/pos-outlet-orders.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SVC = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(ROOT, 'settings-pos.html'), 'utf8');
const INDEXES = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8')).indexes;

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => (actual === expected ? ok(label) : fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const body = (name) => {
    const at = SVC.search(new RegExp(`\\n    (async )?${name}\\(`));
    if (at < 0) return '';
    const next = SVC.slice(at + 10).search(/\n    (async )?[a-zA-Z_]+\([^)]*\) \{/);
    return SVC.slice(at, next < 0 ? undefined : at + 10 + next);
};

console.log('\npos outlet orders\n');

const getOrders = body('getPosOrders');
is(/where\('dimension_id', '==', dimensionId\),\s*orderBy\('created_at', 'desc'\), limit\(limitCount\)/.test(getOrders), true,
    'getPosOrders asks for the OUTLET\'s newest orders when given an outlet');
is(/posIndexMissing\(err\)/.test(getOrders) && /workspaceWindow\(\)/.test(getOrders), true,
    '…and falls back to the old window (never an empty board) if the index is missing');

const watch = body('watchPosOrders');
is(/where\('dimension_id', '==', dimensionId\), orderBy\('created_at', 'desc'\), limit\(120\)/.test(watch), true,
    'the live listener listens to the OUTLET\'s 120, not the workspace\'s');
is(/posIndexMissing\(err\)/.test(watch) && /listen\(workspaceWindow, false\)/.test(watch), true,
    '…and re-listens on the old window if the index is missing, rather than going deaf');

const tally = body('getPosShiftTally');
is(/where\('shift_id', '==', shiftId\)/.test(tally), true, 'the shift tally reads the shift\'s orders BY SHIFT');
is(/getPosOrders\(/.test(tally), false, '…never through a windowed read of the newest orders');

const live = body('getLivePosOrders');
is(/where\('dimension_id', '==', dimensionId\)/.test(live) && /where\('status', 'in', \[/.test(live), true,
    'getLivePosOrders finds live orders by outlet and status, exactly');
is(/getLivePosOrders\(uid, id/.test(SETTINGS), true, 'the archive guard uses it');
is(/getPosOrders\(uid, \{\s*dimensionId: id,/.test(SETTINGS), false, '…not a windowed read of the newest five');
is(/\.catch\(\(\) => \[\]\);\s*if \(open\.length\)/.test(SETTINGS), false, '…and a failed check refuses instead of counting as "nothing open"');

const hasIndex = (a, b) => INDEXES.some((i) => i.collectionGroup === 'pos_orders' && i.queryScope === 'COLLECTION'
    && i.fields.length === 2 && i.fields[0].fieldPath === a && i.fields[0].order === 'ASCENDING'
    && i.fields[1].fieldPath === b && i.fields[1].order === 'DESCENDING');
is(hasIndex('dimension_id', 'created_at'), true, 'firestore.indexes.json declares pos_orders (dimension_id ASC, created_at DESC)');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos outlet orders: clean\n');
process.exit(failures ? 1 : 0);
