// =============================================================================
// FluxyOS — every control that calls once() is covered by the busy guard
//
// `once()` in pos.js refuses re-entry while a write is in flight, and it does
// so by returning null — no toast, no trace. A press refused that way is a
// press that did nothing and said nothing, which a cashier at a counter reads
// as "the till ignored me" and presses again.
//
// The product answer is `body[data-pos-busy] <selector> { pointer-events:none }`
// in pos.html: a press that cannot be made cannot be swallowed, and the control
// dims to say why. But that is a LIST, and a list drifts. On 2026-09-10 the
// order-search results (`.pos-order-result`) were found calling once() and
// missing from it. This check closes that class: every once() trigger must be
// matched by a selector in the guard, or it fails here.
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'assets/js/pos.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'pos.html'), 'utf8');

let failures = 0;
const ok = (cond, label, hint) => {
    if (!cond) failures += 1;
    console.log(`  ${cond ? '✓' : '✗'} ${label}`);
    if (!cond && hint) console.log(`      ${hint}`);
};

console.log('\npos busy guard\n');

// ── The guard's own selectors ───────────────────────────────────────────────
const guardBlock = /body\[data-pos-busy\] \.pos-primary,[\s\S]*?\{\s*pointer-events: none;/.exec(html);
ok(!!guardBlock, 'the busy guard exists in pos.html');
const guarded = new Set();
(guardBlock ? guardBlock[0] : '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((x) => x.replace(/body\[data-pos-busy\]/, '').replace(/\{[\s\S]*/, '').trim())
    .filter(Boolean)
    .forEach((sel) => guarded.add(sel));

// ── Every once() trigger, resolved to the element a person actually presses ─
//
// Controls inside an order line are covered by `.pos-line button` wholesale.
const LINE_CONTROLS = new Set(['data-remove', 'data-inc', 'data-dec']);
// Markup built with a VARIABLE attribute name, so a literal search for
// `data-advance=` finds nothing: the board card's action button is
// `<button class="pos-ocard-btn …" ${attr}=…>` with attr = 'data-advance' |
// 'data-pay'. Resolved by hand, and asserted to still be that shape below.
const DYNAMIC_ATTR_CLASS = { 'data-advance': 'pos-ocard-btn' };
ok(/class="pos-ocard-btn is-primary is-only" \$\{attr\}=/.test(js)
    && /'data-pay' : 'data-advance'/.test(js),
    'the board card action button still carries data-advance on .pos-ocard-btn');

// Controls that are not guarded by the pointer, and correctly so:
//   · a form whose handler checks its submit's `disabled` and sets it itself —
//     the pay dialog. The button visibly disables for its own write.
//   · a field committed with { queue: true }: typing cannot be blocked by
//     pointer-events, so the commit waits for the write instead of vanishing.
const SELF_GUARDED_FORMS = new Set(['pos-pay-form']);
ok(/if \(\$\$\('pos-pay-submit'\)\.disabled\) return;/.test(js)
    && /submit\.disabled = true;/.test(js),
    'the pay form still refuses a second submit by disabling its own button');
const QUEUED_FIELDS = new Set(['data-qty']);
ok(/\}, \{ queue: true \}\);\s*\n\s*input\.addEventListener\('input'/.test(js),
    'a typed quantity is queued behind an in-flight write, not dropped');

const classOfButtonWith = (attr) => {
    if (DYNAMIC_ATTR_CLASS[attr]) return DYNAMIC_ATTR_CLASS[attr];
    const m = new RegExp(`<button[^>]*\\b${attr}=[^>]*>`).exec(js);
    if (!m) return null;
    const c = /class="([^"]*)"/.exec(m[0]);
    return c ? c[1].split(/\s+/)[0] : null;
};

const triggers = [];
js.split('\n').forEach((line, i, all) => {
    if (!/\bonce\(/.test(line) || /^async function once/.test(line)) return;
    // Walk BACK from the once() line and take the CLOSEST binding. Taking the
    // first match in a window pinned `$('pos-new-order')`'s once() on the
    // discount button three lines above it.
    for (let j = i; j >= Math.max(0, i - 8); j -= 1) {
        const l = all[j];
        const form = /\$\('([a-z-]+-form)'\)\.addEventListener\('submit'/.exec(l)
            || /querySelector\('#([a-z-]+-form)'\)\.addEventListener\('submit'/.exec(l);
        const byAttr = /querySelectorAll\('\[(data-[a-z-]+)\]/.exec(l);
        const byId = /\$\('([a-z-]+)'\)\.addEventListener\('click'/.exec(l)
            || /\b(post)\.addEventListener/.exec(l);
        if (form) { triggers.push({ kind: 'form', key: form[1], line: i + 1 }); return; }
        if (byAttr) { triggers.push({ kind: 'attr', key: byAttr[1], line: i + 1 }); return; }
        if (byId) { triggers.push({ kind: 'id', key: byId[1], line: i + 1 }); return; }
    }
    triggers.push({ kind: 'unknown', key: all[i].trim().slice(0, 60), line: i + 1 });
});

// Called from elsewhere, not from a click on a control of its own.
const INDIRECT = {
    // addMenuLine — pressed as a product card, which the guard lists.
    addMenuLine: '.pos-card'
};
ok(guarded.has(INDIRECT.addMenuLine), 'adding a dish is pressed on a guarded card');

ok(triggers.length >= 6, `found the once() triggers (${triggers.length})`,
    'the scan found fewer than it should — has the markup pattern changed?');

triggers.forEach((t) => {
    if (t.kind === 'unknown') {
        // Not a failure on its own — once() is also called from functions that
        // are themselves invoked by a guarded control (see INDIRECT). Listed so
        // a new one is at least visible.
        console.log(`  · pos.js:${t.line} once() not bound to a click here: ${t.key}`);
        return;
    }
    if (t.kind === 'form' && SELF_GUARDED_FORMS.has(t.key)) {
        ok(true, `#${t.key} (pos.js:${t.line}) disables its own submit for the write`);
        return;
    }
    if (t.kind === 'attr' && QUEUED_FIELDS.has(t.key)) {
        ok(true, `[${t.key}] (pos.js:${t.line}) queues behind an in-flight write`);
        return;
    }
    if (t.kind === 'form') {
        // A form is submitted by its submit button, which is what a person
        // presses and what the guard must list.
        const covered = [...guarded].some((sel) => sel.includes(`form="${t.key}"`)
            || sel === `#${t.key} button[type="submit"]` || sel === `#${t.key} [type="submit"]`);
        ok(covered, `#${t.key} submit (pos.js:${t.line}) is blocked while a write is in flight`,
            `add "body[data-pos-busy] button[form=\"${t.key}\"]" (or the form's submit button) to the busy guard`);
        return;
    }
    if (t.kind === 'id') {
        const id = t.key === 'post' ? 'pos-post-now' : t.key;
        // The primary button is listed by class; its id is `pos-primary`.
        const covered = guarded.has(`#${id}`) || (id === 'pos-primary' && guarded.has('.pos-primary'));
        ok(covered, `#${id} (pos.js:${t.line}) is blocked while a write is in flight`,
            `add "body[data-pos-busy] #${id}" to the busy guard in pos.html`);
        return;
    }
    if (LINE_CONTROLS.has(t.key)) {
        ok(guarded.has('.pos-line button'), `[${t.key}] sits in a guarded order line`);
        return;
    }
    const cls = classOfButtonWith(t.key);
    // Guarded by the attribute itself is as good as by the class — and better
    // when the class is shared with controls that must stay live.
    ok(guarded.has(`[${t.key}]`) || (!!cls && guarded.has(`.${cls}`)),
        `[${t.key}] → .${cls || '?'} (pos.js:${t.line}) is blocked while a write is in flight`,
        `add "body[data-pos-busy] .${cls}" to the busy guard in pos.html — otherwise a press on it during a write is dropped in silence`);
});

console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\npos busy guard: clean\n');
process.exit(failures ? 1 : 0);
