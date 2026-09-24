'use strict';

// The drawer can be trusted only when its UI actions and its expected-cash
// arithmetic describe the same physical cash. These source-level guards pin
// the regressions that previously made an open-shift button inert, counted a
// QRIS refund as notes leaving the drawer, and swallowed a paid-out expense
// failure. Run: node tests/pos-shifts.check.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const service = fs.readFileSync(path.join(ROOT, 'assets/js/pos-service.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8');

let failures = 0;
const check = (condition, message) => {
    if (condition) console.log(`  ✓ ${message}`);
    else { failures += 1; console.error(`  ✗ ${message}`); }
};
const body = (src, name) => {
    const at = src.search(new RegExp(`\\n    (async )?${name}\\(`));
    if (at < 0) return '';
    const next = src.slice(at + 10).search(/\n    (async )?[a-zA-Z_]+\([^)]*\) \{/);
    return src.slice(at, next < 0 ? undefined : at + 10 + next);
};

console.log('\nPOS shifts\n');

const tally = body(service, 'getPosShiftTally');
check(/refundCount \+= 1/.test(tally)
    && /\(o\.payments \|\| \[\]\)\.filter\(\(p\) => p\.status === 'settled'\)\.forEach/.test(tally)
    && !/cash -= Number\(o\.total_amount\)/.test(tally),
'refunds reverse their original settled tenders instead of removing every refund from cash');
check(/Object\.fromEntries\(Object\.entries\(byMethod\)\.filter/.test(tally),
'the close-out payment-method list omits fully reversed tenders');

const movement = body(service, 'recordPosShiftMovement');
check(/const batch = writeBatch\(this\.db\)/.test(movement)
    && /_postSourceJournal\(userId, batch, 'transactions'/.test(movement)
    && /batch\.update\(ref, \{\s*movements/s.test(movement),
'a paid-out expense and its drawer movement are committed together');
check(!/paid-out recorded in the drawer but not posted/.test(movement),
'a paid-out no longer reports success after swallowing an accounting failure');

check(/function bindShiftActions\(host\)/.test(ui)
    && /bindShiftActions\(bar\);\s*mirrorShiftBar\(bars\);/s.test(ui)
    && /once\(openCloseShiftDrawer\)/.test(ui),
'the till shift strip wires open, movement, and close controls with a duplicate-submit guard');
check(/Cash out<\/span><small>Business expense/.test(ui)
    && /Cash in<\/span><small>Change from safe/.test(ui),
'the cash-movement choice explains each accounting meaning before it is saved');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nPOS shifts: clean\n');
process.exit(failures ? 1 : 0);
