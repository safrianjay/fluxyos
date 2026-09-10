// =============================================================================
// once({ queue: true }) — a typed quantity is not lost to an in-flight write
//
// The real `once()` lifted out of pos.js and driven with fake writes, because
// the bug is purely about ORDERING: a quantity committed on blur while another
// write held `state.busy` was refused, and the field went on showing a number
// the order did not hold.
// =============================================================================
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pos.js'), 'utf8');

const start = src.indexOf('let posInFlight = null;');
const end = src.indexOf('\n}\n', src.indexOf('async function once(')) + 3;
if (start < 0 || end < 3) { console.error('✗ could not lift once() from pos.js'); process.exit(1); }

let failures = 0;
const is = (a, e, label) => {
    const ok = a === e; if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`}`);
};

// A minimal world for the lifted code: `state` and `document.body.dataset`.
const make = () => {
    const state = { busy: false };
    const document = { body: { dataset: {} } };
    // eslint-disable-next-line no-new-func
    const once = new Function('state', 'document', `${src.slice(start, end)}; return once;`)(state, document);
    return { once, state, document };
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log('\nonce() queue\n');

    // ── The bug: refused while busy ─────────────────────────────────────────
    {
        const { once } = make();
        const log = [];
        const write = once(async () => { await tick(30); log.push('add-line'); });
        const refused = await once(async () => { log.push('qty'); });
        await write;
        is(refused, null, 'a default call made while busy is refused');
        is(log.join(','), 'add-line', 'and its work never runs — which is right for a button');
    }

    // ── The fix: queued behind it ───────────────────────────────────────────
    {
        const { once, state, document } = make();
        const log = [];
        const write = once(async () => { await tick(30); log.push('add-line'); });
        const queued = once(async () => { log.push('qty'); return 12; }, { queue: true });
        is(await queued, 12, 'a queued call runs and returns its value');
        await write;
        is(log.join(','), 'add-line,qty', 'it runs AFTER the write it waited for, never alongside it');
        is(state.busy, false, 'and the lock is released afterwards');
        is(document.body.dataset.posBusy, undefined, 'and the busy guard is lifted');
    }

    // ── Two queued behind one write do not run together ─────────────────────
    {
        const { once } = make();
        let concurrent = 0; let peak = 0;
        const work = (name) => async () => {
            concurrent += 1; peak = Math.max(peak, concurrent);
            await tick(10); concurrent -= 1; return name;
        };
        const a = once(work('a'));
        const b = once(work('b'), { queue: true });
        const c = once(work('c'), { queue: true });
        await Promise.all([a, b, c]);
        is(peak, 1, 'queued calls still hold the lock one at a time');
    }

    // ── A failing write does not strand the queue ───────────────────────────
    {
        const { once, state } = make();
        const failing = once(async () => { await tick(10); throw new Error('denied'); }).catch(() => 'caught');
        const queued = once(async () => 'ran', { queue: true });
        is(await failing, 'caught', 'the failing write still rejects to its own caller');
        is(await queued, 'ran', 'and the call queued behind it still runs');
        is(state.busy, false, 'with the lock released');
    }

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nonce() queue: clean\n');
    process.exit(failures ? 1 : 0);
})();
