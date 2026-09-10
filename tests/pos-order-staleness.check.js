// =============================================================================
// A stale copy of the open order must never replace a newer one
//
// The live watcher calls refresh() on every snapshot, and the read it triggers
// often does not yet include the write that caused the snapshot. The first press
// on a new order stepped the button forward, then refresh() repainted it BACK
// and released the busy guard — a live button offering a step already taken.
// Every order write bumps `version` inside its transaction; refresh() keeps the
// higher one. Lifted from pos.js so this tests the shipped function.
// =============================================================================
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pos.js'), 'utf8');

const at = src.indexOf('function newerOrder(');
const body = src.slice(at, src.indexOf('\n}\n', at) + 2);
// eslint-disable-next-line no-new-func
const newerOrder = new Function(`${body}; return newerOrder;`)();

let failures = 0;
const is = (a, e, label) => {
    const ok = a === e; if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};
console.log('\nopen-order staleness\n');

const held = { id: 'o1', status: 'sent', version: 3 };
is(newerOrder(held, { id: 'o1', status: 'open', version: 2 }), held,
    'a lower-version copy of the same order is refused — the button does not step back');
const newer = { id: 'o1', status: 'ready', version: 4 };
is(newerOrder(held, newer), newer, 'a higher-version copy replaces it');
const same = { id: 'o1', status: 'sent', version: 3, resolved: true };
is(newerOrder(held, same), same, 'an equal version takes the server copy, timestamps resolved');
const other = { id: 'o2', version: 1 };
is(newerOrder(held, other), other, 'a different order is not compared at all');
is(newerOrder(null, newer), newer, 'nothing held yet takes whatever arrives');

// And refresh() actually applies it on both paths that re-bind the order.
const refresh = src.slice(src.indexOf('async function refresh('));
is(/if \(live\) state\.order = newerOrder\(state\.order, live\);/.test(refresh), true,
    'refresh() re-binds from the overview through newerOrder');
is(/state\.order = newerOrder\(state\.order, fresh\);/.test(refresh), true,
    'and from the direct read on a miss');

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nopen-order staleness: clean\n');
process.exit(failures ? 1 : 0);
