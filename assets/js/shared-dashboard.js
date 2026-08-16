/**
 * Global Transaction Modal
 */
(function loadFluxyPageTransition() {
    if (window.__fluxyPageTransitionScriptRequested) return;
    window.__fluxyPageTransitionScriptRequested = true;

    const script = document.createElement('script');
    script.src = '/assets/js/page-transition.js';
    script.defer = true;
    document.head.appendChild(script);
})();

function loadFluxyDateRangePicker() {
    if (window.FluxyDateRangePicker) return Promise.resolve(window.FluxyDateRangePicker);
    if (window.__fluxyDateRangePickerPromise) return window.__fluxyDateRangePickerPromise;

    window.__fluxyDateRangePickerPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/js/date-range-picker.js';
        script.onload = () => resolve(window.FluxyDateRangePicker);
        script.onerror = () => reject(new Error('Unable to load date picker.'));
        document.head.appendChild(script);
    });

    return window.__fluxyDateRangePickerPromise;
}

function loadFluxyDocumentAttachment() {
    if (window.FluxyDocumentAttachment) return Promise.resolve(window.FluxyDocumentAttachment);
    if (window.__fluxyDocumentAttachmentPromise) return window.__fluxyDocumentAttachmentPromise;

    window.__fluxyDocumentAttachmentPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/assets/js/document-attachment.js';
        script.onload = () => resolve(window.FluxyDocumentAttachment);
        script.onerror = () => reject(new Error('Unable to load document attachment helper.'));
        document.head.appendChild(script);
    });

    return window.__fluxyDocumentAttachmentPromise;
}

async function compressReceiptImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1200;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
                else { width = Math.round(width * MAX / height); height = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => blob ? resolve(new File([blob], file.name, { type: 'image/jpeg' })) : reject(new Error('Compression failed')), 'image/jpeg', 0.8);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
        img.src = url;
    });
}
window.__compressReceiptImage = compressReceiptImage;

(function installFluxyLinkedTargetHighlight() {
    if (window.highlightFluxyLinkedTarget) return;

    if (!document.getElementById('fluxy-linked-target-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'fluxy-linked-target-highlight-style';
        style.textContent = `
            @keyframes fluxy-linked-target-glimpse {
                0% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 0 rgba(234, 88, 12, 0.28); }
                42% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 6px rgba(234, 88, 12, 0.14); }
                100% { box-shadow: inset 3px 0 0 #EA580C, 0 0 0 0 rgba(234, 88, 12, 0); }
            }

            .fluxy-linked-target-glimpse {
                animation: fluxy-linked-target-glimpse 1.15s ease-out 2;
                background-color: #F9FAFB !important;
                position: relative;
                z-index: 1;
            }
        `;
        document.head.appendChild(style);
    }

    window.highlightFluxyLinkedTarget = function(target, options = {}) {
        const elements = typeof target === 'string'
            ? Array.from(document.querySelectorAll(target))
            : target instanceof Element
                ? [target]
                : Array.from(target || []).filter(item => item instanceof Element);

        if (!elements.length) return false;
        const { scroll = true, focus = null } = options;
        if (scroll) {
            elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (focus instanceof HTMLElement) {
            try {
                focus.focus({ preventScroll: true });
            } catch {
                focus.focus();
            }
        }
        elements.slice(0, 12).forEach(element => {
            element.classList.remove('fluxy-linked-target-glimpse');
            void element.offsetWidth;
            element.classList.add('fluxy-linked-target-glimpse');
            window.setTimeout(() => {
                element.classList.remove('fluxy-linked-target-glimpse');
            }, 2800);
        });
        return true;
    };
})();

// ---------- Fluxy AI launcher button restyle (single source of truth) ----------
// Every Fluxy AI launcher pill across the app (topbar buttons that call
// toggleFluxyAI, plus the records-subpage "Ask Fluxy AI" buttons) is normalized
// to the shared `.fluxy-ai-btn` look (white pill, gradient border + sparkle +
// label). Idempotent and progressive — keeps the element, its onclick/listener,
// data-tour-target, and label intact, so positioning + access-guard logic still
// work. Styles live in shared-dashboard.css.
(function enhanceFluxyAIButtons() {
    const SELECTOR = 'button[onclick*="toggleFluxyAI"], button[id$="ask-ai"]';

    function enhance(btn) {
        if (!btn || btn.dataset.fluxyAiEnhanced === '1') return;
        const label = (btn.textContent || '').replace(/\s+/g, ' ').trim() || 'Fluxy AI';
        // Preserve the one page that hides the launcher on mobile.
        const hideMobile = /\bhidden\b/.test(btn.className) && /\bsm:(inline-)?flex\b/.test(btn.className);
        btn.className = 'fluxy-ai-btn' + (hideMobile ? ' fluxy-ai-btn--sm' : '');
        btn.innerHTML = '<span class="fluxy-ai-btn-icon" aria-hidden="true"></span><span class="fluxy-ai-btn-label"></span>';
        btn.querySelector('.fluxy-ai-btn-label').textContent = label;
        btn.dataset.fluxyAiEnhanced = '1';
    }

    function run() {
        document.querySelectorAll(SELECTOR).forEach(enhance);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
    // Catch any launcher added after load (defensive — all 26 ship in static HTML).
    try {
        new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* observer is best-effort */ }
})();

// ---------- Dialog (canonical popup component) ----------
// Single branded popup used everywhere in FluxyOS — replaces native
// window.confirm() and window.alert(). Two thin wrappers:
//   • window.showConfirmDialog(opts) → Promise<boolean>  (Cancel / Confirm)
//   • window.showAlertDialog(opts)   → Promise<void>      (single OK)
// Opts: { title, body, confirmLabel, cancelLabel, tone }
// tone: 'default' | 'danger'
// body accepts inline HTML (caller is responsible for escaping user input).
// Lucide-style 24x24 stroke icons. Keep them minimal and consistent.
const FLUXY_DIALOG_ICONS = {
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    info:   '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert:  '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    warn:   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    trash:  '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    check:  '<path d="M20 6 9 17l-5-5"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'
};

window.showFluxyDialog = function(options = {}) {
    const {
        title = '',
        body = '',
        confirmLabel = 'Continue',
        cancelLabel = 'Cancel',
        tone = 'default',
        icon,                   // 'pencil' | 'info' | 'alert' | 'warn' | 'trash' | 'check' | 'building' | 'none' | custom SVG string
        singleOk = false
    } = options;

    return new Promise((resolve) => {
        document.getElementById('fluxy-dialog')?.remove();
        const isDanger = tone === 'danger';

        // Pick the icon: explicit option wins, else sensible default per tone.
        const iconKey = icon ?? (isDanger ? 'warn' : 'info');
        const iconInner = iconKey === 'none'
            ? null
            : (FLUXY_DIALOG_ICONS[iconKey] || iconKey); // raw SVG path string also accepted

        const iconBlock = iconInner
            ? `<div class="fluxy-dialog-icon ${isDanger ? 'is-danger' : ''}" aria-hidden="true">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${iconInner}</svg>
               </div>`
            : '';

        const cancelBtn = singleOk
            ? ''
            : `<button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--ghost" data-dialog-action="cancel">${cancelLabel}</button>`;

        const wrap = document.createElement('div');
        wrap.id = 'fluxy-dialog';
        wrap.className = 'fluxy-dialog';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-dialog-action="cancel"></div>
            <div class="fluxy-dialog-card" role="dialog" aria-modal="true" aria-labelledby="fluxy-dialog-title"${body ? ' aria-describedby="fluxy-dialog-body"' : ''}>
                ${iconBlock}
                <h3 id="fluxy-dialog-title" class="fluxy-dialog-title">${title}</h3>
                ${body ? `<div id="fluxy-dialog-body" class="fluxy-dialog-body">${body}</div>` : ''}
                <div class="fluxy-dialog-actions">
                    ${cancelBtn}
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--primary ${isDanger ? 'is-danger' : ''}" data-dialog-action="confirm">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            window.setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = prevOverflow;
                resolve(singleOk ? undefined : result);
            }, 140);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(false);
            else if (e.key === 'Enter') close(true);
        };

        wrap.addEventListener('click', (e) => {
            const action = e.target?.closest('[data-dialog-action]')?.dataset?.dialogAction;
            if (action === 'confirm') close(true);
            else if (action === 'cancel') close(false);
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => {
            wrap.querySelector('[data-dialog-action="confirm"]')?.focus();
        }, 50);
    });
};

window.showConfirmDialog = (options = {}) => window.showFluxyDialog({ ...options, singleOk: false });
window.showAlertDialog   = (options = {}) => window.showFluxyDialog({ confirmLabel: 'OK', ...options, singleOk: true });

window.showReasonDialog = function(options = {}) {
    const {
        title = 'Confirm action',
        body = '',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        tone = 'danger',
        reasonLabel = 'Reason',
        otherLabel = 'Other',
        options: reasonOptions = []
    } = options;

    const choices = reasonOptions.length
        ? reasonOptions
        : ['Duplicate transaction', 'Wrong amount', 'Wrong import', 'Test data', otherLabel];

    return new Promise((resolve) => {
        document.getElementById('fluxy-dialog')?.remove();
        const isDanger = tone === 'danger';
        const wrap = document.createElement('div');
        wrap.id = 'fluxy-dialog';
        wrap.className = 'fluxy-dialog fluxy-dialog--reason';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-dialog-action="cancel"></div>
            <div class="fluxy-dialog-card fluxy-dialog-card--reason" role="dialog" aria-modal="true" aria-labelledby="fluxy-dialog-title" aria-describedby="fluxy-dialog-body">
                <div class="fluxy-dialog-icon ${isDanger ? 'is-danger' : ''}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${FLUXY_DIALOG_ICONS.warn}</svg>
                </div>
                <h3 id="fluxy-dialog-title" class="fluxy-dialog-title">${title}</h3>
                ${body ? `<div id="fluxy-dialog-body" class="fluxy-dialog-body">${body}</div>` : ''}
                <div class="fluxy-dialog-field">
                    <label for="fluxy-dialog-reason-select" class="fluxy-dialog-label">${reasonLabel}</label>
                    <select id="fluxy-dialog-reason-select" class="fluxy-dialog-select">
                        <option value="">Choose a reason</option>
                        ${choices.map(choice => `<option value="${String(choice).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">${String(choice).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`).join('')}
                    </select>
                    <textarea id="fluxy-dialog-reason-other" class="fluxy-dialog-textarea hidden" maxlength="500" placeholder="Write the reason"></textarea>
                    <p id="fluxy-dialog-reason-error" class="fluxy-dialog-error hidden">Choose or write a reason before continuing.</p>
                </div>
                <div class="fluxy-dialog-actions fluxy-dialog-actions--reason">
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--ghost" data-dialog-action="cancel">${cancelLabel}</button>
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--primary ${isDanger ? 'is-danger' : ''}" data-dialog-action="confirm">${confirmLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const select = wrap.querySelector('#fluxy-dialog-reason-select');
        const other = wrap.querySelector('#fluxy-dialog-reason-other');
        const error = wrap.querySelector('#fluxy-dialog-reason-error');

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            window.setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = prevOverflow;
                resolve(result);
            }, 140);
        };
        const getReason = () => {
            const selected = String(select?.value || '').trim();
            if (selected === otherLabel) return String(other?.value || '').trim();
            return selected;
        };
        const confirm = () => {
            const reason = getReason();
            if (!reason) {
                error?.classList.remove('hidden');
                (select?.value === otherLabel ? other : select)?.focus();
                return;
            }
            close(reason);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(null);
            else if (e.key === 'Enter' && !e.shiftKey && document.activeElement !== other) {
                e.preventDefault();
                confirm();
            }
        };

        select?.addEventListener('change', () => {
            const isOther = select.value === otherLabel;
            other?.classList.toggle('hidden', !isOther);
            error?.classList.add('hidden');
            if (isOther) window.setTimeout(() => other?.focus(), 20);
        });
        other?.addEventListener('input', () => error?.classList.add('hidden'));
        wrap.addEventListener('click', (e) => {
            const action = e.target?.closest('[data-dialog-action]')?.dataset?.dialogAction;
            if (action === 'confirm') confirm();
            else if (action === 'cancel') close(null);
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => select?.focus(), 50);
    });
};

/* ── FluxyDrawerSummary — the readiness strip inside a Summary card ────
   Every financial detail drawer (Bill, Transaction, Revenue, Invoice) used to
   give its status its OWN section: a titled card wrapping one line of text.
   Three separate cards, three different shapes, and a Summary card left
   lopsided above them.

   Readiness is an attribute of the summary, not a peer of it, so it now lives
   at the foot of the Summary section — one shared renderer so the four pages
   cannot drift apart again.

   FluxyDrawerSummary.readiness({ tone, label, detail, chips })
     tone   'good' | 'info' | 'warn'   → dot colour only
     label  short status sentence      → required
     detail optional second line; may contain caller-escaped HTML (links)
     chips  optional array of ready-made badge HTML (cash impact, budget)      */
window.FluxyDrawerSummary = (function () {
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function readiness(options) {
        options = options || {};
        if (!options.label) return '';
        var tone = ['good', 'info', 'warn'].indexOf(options.tone) >= 0 ? options.tone : 'info';
        var chips = Array.isArray(options.chips) ? options.chips.filter(Boolean) : [];
        return '<div class="fluxy-drawer-readiness fluxy-drawer-readiness--' + tone + '">'
            + '<span class="fluxy-drawer-readiness-dot" aria-hidden="true"></span>'
            + '<div class="fluxy-drawer-readiness-body">'
            + '<p class="fluxy-drawer-readiness-label">' + esc(options.label) + '</p>'
            // `detail` is trusted HTML so a caller can inline a link; every
            // caller escapes its own interpolations first.
            + (options.detail ? '<p class="fluxy-drawer-readiness-detail">' + options.detail + '</p>' : '')
            + (chips.length ? '<div class="fluxy-drawer-readiness-chips">' + chips.join('') + '</div>' : '')
            + '</div></div>';
    }

    return { readiness: readiness, escape: esc };
})();

/* ── FluxyAmountInput — live Rupiah thousands separators ───────────────
   One formatter for every editable amount field. Two things it does that a
   naive `value = format(value)` does not:

   1. It reformats on EVERY keystroke, including deletions. A field pre-filled
      with "89.500.000" that only reformats on overflow leaves the original
      dots stranded when digits are removed — the user reads "8000.000" while
      the code parses 8000000. The figure was right; what they saw was not.
   2. It puts the caret back where the user was, counted in DIGITS rather than
      characters, so inserting a separator does not shunt the cursor to the end
      mid-edit.

   Usage: FluxyAmountInput.format(el) from an input handler, or .attach(el). */
window.FluxyAmountInput = (function () {
    function digitsBefore(text, caret) {
        return String(text).slice(0, caret).replace(/\D/g, '').length;
    }

    function format(input) {
        if (!input) return;
        const caret = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        const wanted = digitsBefore(input.value, caret);
        const digits = input.value.replace(/\D/g, '');
        const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        if (formatted === input.value) return;
        input.value = formatted;
        // Walk forward until we have passed the same number of digits.
        let seen = 0;
        let pos = 0;
        while (pos < formatted.length && seen < wanted) {
            if (/\d/.test(formatted[pos])) seen += 1;
            pos += 1;
        }
        try { input.setSelectionRange(pos, pos); } catch (_) { /* not a text input */ }
    }

    function attach(input) {
        if (!input || input.dataset.fluxyAmountBound === '1') return;
        input.dataset.fluxyAmountBound = '1';
        input.addEventListener('input', () => format(input));
    }

    // Raw integer behind a formatted field.
    function value(input) {
        return Math.round(Math.abs(Number(String(input?.value || '').replace(/\D/g, '')) || 0));
    }

    return { format, attach, value };
})();

// ---------- Duplicate review dialog ----------
// The side-by-side "is this a duplicate?" popup shown before a record is saved
// (docs/DUPLICATE_PREVENTION.md). Built on the canonical dialog shell — same
// overlay, focus trap, scroll lock, Escape-to-cancel and exit animation — with
// two differences the canonical one cannot express: a wider card, and a set of
// context-dependent actions rather than a fixed Cancel/Confirm pair.
//
//   const action = await window.showDuplicateDialog({ match, actions, ... });
//   // → the chosen action's id, or null when cancelled.
//
// The caller supplies fully-escaped display values via `match`; nothing here
// reads Firestore. Fields that DIFFER are highlighted — users are scanning for
// the difference, not the sameness, so the sameness stays quiet.
window.showDuplicateDialog = function (options = {}) {
    const {
        title = 'This looks like a record you already have',
        lead = '',
        evidence = [],
        existing = {},
        incoming = {},
        existingLabel = 'Existing',
        incomingLabel = "You're adding",
        note = '',
        actions = [],
        tone = 'warn'
    } = options;

    const esc = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // One comparison row. `differs` drives the amber treatment; when a side has
    // no value we show an em dash rather than an empty cell, so the row still
    // reads as a comparison.
    const compareRow = (label, a, b) => {
        const left = a == null || a === '' ? '—' : a;
        const right = b == null || b === '' ? '—' : b;
        const differs = String(left) !== String(right) && left !== '—' && right !== '—';
        // data-side feeds the mobile layout, where the columns collapse and each
        // value has to carry its own "Existing" / "You're adding" label.
        return `
            <div class="fluxy-dup-row${differs ? ' is-different' : ''}">
                <span class="fluxy-dup-row-label">${esc(label)}</span>
                <span class="fluxy-dup-row-value" data-side="${esc(existingLabel)}">${esc(left)}</span>
                <span class="fluxy-dup-row-value" data-side="${esc(incomingLabel)}">${esc(right)}</span>
            </div>`;
    };

    const ROWS = [
        ['Number', existing.number, incoming.number],
        ['Counterparty', existing.party, incoming.party],
        ['Date', existing.date, incoming.date],
        ['Amount', existing.amount, incoming.amount],
        ['Status', existing.status, incoming.status],
        ['Source', existing.source, incoming.source]
    ];

    return new Promise((resolve) => {
        document.getElementById('fluxy-dialog')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'fluxy-dialog';
        wrap.className = 'fluxy-dialog fluxy-dialog--duplicate';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-dialog-action="__cancel"></div>
            <div class="fluxy-dialog-card fluxy-dialog-card--duplicate" role="dialog" aria-modal="true" aria-labelledby="fluxy-dialog-title" aria-describedby="fluxy-dup-lead">
                <div class="fluxy-dialog-icon ${tone === 'danger' ? 'is-danger' : ''}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${FLUXY_DIALOG_ICONS.warn}</svg>
                </div>
                <h3 id="fluxy-dialog-title" class="fluxy-dialog-title">${esc(title)}</h3>
                ${lead ? `<p id="fluxy-dup-lead" class="fluxy-dup-lead">${esc(lead)}</p>` : ''}

                <div class="fluxy-dup-compare">
                    <div class="fluxy-dup-row fluxy-dup-head">
                        <span class="fluxy-dup-row-label"></span>
                        <span class="fluxy-dup-row-value">${esc(existingLabel)}</span>
                        <span class="fluxy-dup-row-value">${esc(incomingLabel)}</span>
                    </div>
                    ${ROWS.map(([l, a, b]) => compareRow(l, a, b)).join('')}
                </div>

                ${evidence.length ? `
                <div class="fluxy-dup-evidence">
                    <p class="fluxy-dup-evidence-title">Why we flagged this</p>
                    <ul>${evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
                </div>` : ''}

                ${note ? `<p class="fluxy-dup-note">${esc(note)}</p>` : ''}

                <div class="fluxy-dialog-actions fluxy-dup-actions">
                    ${actions.map((a) => `
                        <button type="button"
                            class="fluxy-dialog-btn ${a.primary ? 'fluxy-dialog-btn--primary' : 'fluxy-dialog-btn--ghost'}${a.danger ? ' is-danger' : ''}"
                            data-dialog-action="${esc(a.id)}">${esc(a.label)}</button>`).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const close = (result) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            window.setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = prevOverflow;
                resolve(result);
            }, 140);
        };
        // Escape cancels, matching every other dialog. Enter is deliberately NOT
        // bound: with several actions of differing consequence there is no safe
        // default to fire on a stray keypress.
        const onKey = (e) => { if (e.key === 'Escape') close(null); };

        wrap.addEventListener('click', (e) => {
            const action = e.target?.closest('[data-dialog-action]')?.dataset?.dialogAction;
            if (!action) return;
            close(action === '__cancel' ? null : action);
        });
        document.addEventListener('keydown', onKey);
        window.setTimeout(() => {
            wrap.querySelector('.fluxy-dialog-btn--primary, .fluxy-dialog-btn')?.focus();
        }, 50);
    });
};

// Shared budget-allocation picker used by the record-transaction entry points
// (Add Transaction drawer, CSV bulk apply-to-all, AI receipt capture). Lets the
// user pin a transaction to a specific budget allocation at creation time so
// they don't have to reassign it from the Budget page afterward. Budgets are
// category-scoped spend buckets, so this only applies to expense-like types.
window.FluxyBudgetPicker = (function () {
    const EXPENSE_LIKE_TYPES = ['expense', 'fee', 'tax', 'pending_payable'];
    const EXCLUDE_VALUE = '__exclude__';

    function isExpenseLike(type) {
        return EXPENSE_LIKE_TYPES.includes(String(type || '').trim());
    }

    // Fetch the budget covering `dateValue` plus its allocations (with usage).
    // Returns { budget, allocations }; { budget: null, allocations: [] } when no
    // active budget covers the date or anything fails (the picker stays hidden).
    async function loadForDate(ds, uid, dateValue) {
        try {
            if (!ds || !uid) return { budget: null, allocations: [] };
            const budget = typeof ds.getBudgetForDate === 'function'
                ? await ds.getBudgetForDate(uid, dateValue)
                : await ds.getActiveBudget(uid);
            if (!budget) return { budget: null, allocations: [] };
            const usage = await ds.getBudgetUsage(uid, budget.id);
            return { budget: usage?.budget || budget, allocations: usage?.allocations || [] };
        } catch (err) {
            console.warn('Budget allocation load failed:', err);
            return { budget: null, allocations: [] };
        }
    }

    function escapeOption(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fmtRp(n) {
        return 'Rp' + Math.max(0, Math.round(Number(n) || 0)).toLocaleString('id-ID');
    }

    // Build the <option> markup. `selectedId` preserves the current choice across
    // re-populations (e.g. when the transaction date changes).
    function buildOptionsHtml(allocations, selectedId) {
        const sel = selectedId || '';
        const opts = [`<option value=""${sel === '' ? ' selected' : ''}>Auto-match by category</option>`];
        (allocations || []).forEach((a) => {
            if (!a || !a.id) return;
            const remaining = a.remaining_amount != null ? a.remaining_amount : a.allocated_amount;
            const label = `${a.name || 'Allocation'} — ${fmtRp(remaining)} left`;
            opts.push(`<option value="${a.id}"${sel === a.id ? ' selected' : ''}>${escapeOption(label)}</option>`);
        });
        opts.push(`<option value="${EXCLUDE_VALUE}"${sel === EXCLUDE_VALUE ? ' selected' : ''}>Don't track against budget</option>`);
        return opts.join('');
    }

    // Translate a picker selection into the budget-* fields to merge onto a
    // transaction payload before create. Empty object = write nothing (keeps the
    // legacy category auto-match behavior). Mirrors the manual-assignment field
    // set in DataService.updateTransactionBudgetAssignment.
    function buildAssignmentFields({ budget, allocationId }) {
        if (!budget || !budget.id) return {};
        const value = allocationId || '';
        if (value === '') return {};
        if (value === EXCLUDE_VALUE) {
            return {
                budget_id: budget.id,
                budget_allocation_id: null,
                budget_match_method: 'excluded',
                budget_match_status: 'excluded'
            };
        }
        return {
            budget_id: budget.id,
            budget_allocation_id: value,
            budget_match_method: 'manual',
            budget_match_status: 'matched',
            budget_match_confidence: 1
        };
    }

    return { EXPENSE_LIKE_TYPES, EXCLUDE_VALUE, isExpenseLike, loadForDate, buildOptionsHtml, buildAssignmentFields };
})();

// Shared cash-impact control used by both the Add Transaction drawer and the
// Ledger transaction editor, so the two never drift. Renders a segmented
// Actual / Pending / No impact control + direction (in/out) + optional bank
// account link, and derives the cash_* fields from the chosen state.
window.FluxyCashImpact = (function () {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Render the control markup into a container. `bankAccounts` is optional;
    // when empty, a "no accounts" note replaces the account select.
    // `lockDirection` hides the Cash in / Cash out toggle for flows where the
    // direction is not a user choice — paying a bill can only ever be cash OUT,
    // and offering "Cash in" there is a one-click way to write an expense that
    // *increases* the cash position. `wire` keeps direction in JS state, so the
    // caller's `direction` still flows through getState()/derive() unchanged.
    function buildHtml({ impact = 'actual', direction = 'in', accountId = '', bankAccounts = [], lockDirection = false } = {}) {
        const accounts = (bankAccounts || []).filter(a => a.status === 'active');
        const accountOptions = accounts
            .map(a => `<option value="${esc(a.id)}" ${a.id === accountId ? 'selected' : ''}>${esc(a.account_name || a.bank_name || a.id)}</option>`)
            .join('');
        const impactBtn = (v, label) =>
            `<button type="button" data-cash-impact="${v}" class="fci-impact-btn rounded-lg px-2 py-2 text-[12px] font-bold transition-all ${impact === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}">${label}</button>`;
        const dirBtn = (v, label, on) =>
            `<button type="button" data-cash-dir="${v}" class="fci-dir-btn rounded-lg px-3 py-2 text-[12px] font-bold transition-all ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}">${label}</button>`;
        return `
            <div>
                <p class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Cash impact</p>
                <div class="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1" data-fci="impact">
                    ${impactBtn('actual', 'Actual')}${impactBtn('pending', 'Pending')}${impactBtn('no_impact', 'No impact')}
                </div>
            </div>
            ${lockDirection ? '' : `
            <div data-fci="direction-field" class="${impact === 'actual' ? '' : 'hidden'}">
                <p class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Direction</p>
                <div class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" data-fci="direction">
                    ${dirBtn('in', 'Cash in', direction !== 'out')}${dirBtn('out', 'Cash out', direction === 'out')}
                </div>
            </div>`}
            <div>
                <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Link cash account</label>
                ${bankAccounts && bankAccounts.length
                    ? `<select data-fci="account" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]"><option value="">No account linked</option>${accountOptions}</select>`
                    : `<p class="text-[13px] text-gray-500 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">No bank accounts added yet. Add one in Settings → Cash &amp; Bank Accounts.</p>`}
            </div>`;
    }

    // Attach interactions within `root`. Returns a controller:
    //   getState() -> { impact, direction, accountId }
    //   setImpact(v) / setDirection(v) for programmatic defaults (e.g. on type change)
    // `impact: 'not_classified'` is allowed as an initial "nothing selected" state.
    function wire(root, { impact = 'actual', direction = 'in', onChange } = {}) {
        let selectedImpact = impact;
        let selectedDirection = direction === 'out' ? 'out' : 'in';
        const refresh = () => {
            root.querySelectorAll('.fci-impact-btn').forEach(b => {
                const on = b.dataset.cashImpact === selectedImpact;
                b.className = `fci-impact-btn rounded-lg px-2 py-2 text-[12px] font-bold transition-all ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`;
            });
            root.querySelector('[data-fci="direction-field"]')?.classList.toggle('hidden', selectedImpact !== 'actual');
            root.querySelectorAll('.fci-dir-btn').forEach(b => {
                const on = b.dataset.cashDir === selectedDirection;
                b.className = `fci-dir-btn rounded-lg px-3 py-2 text-[12px] font-bold transition-all ${on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`;
            });
        };
        root.querySelector('[data-fci="impact"]')?.addEventListener('click', (e) => {
            const b = e.target.closest('.fci-impact-btn'); if (!b) return;
            selectedImpact = b.dataset.cashImpact || selectedImpact; refresh(); onChange?.('impact');
        });
        root.querySelector('[data-fci="direction"]')?.addEventListener('click', (e) => {
            const b = e.target.closest('.fci-dir-btn'); if (!b) return;
            selectedDirection = b.dataset.cashDir || selectedDirection; refresh(); onChange?.('direction');
        });
        refresh();
        return {
            getState: () => ({ impact: selectedImpact, direction: selectedDirection, accountId: root.querySelector('[data-fci="account"]')?.value || '' }),
            setImpact: (v) => { selectedImpact = v; refresh(); },
            setDirection: (v) => { selectedDirection = v === 'out' ? 'out' : 'in'; refresh(); }
        };
    }

    // Read the editable starting state from an existing record. `impact` is
    // 'not_classified' when the record has no cash fields yet.
    function stateFromRecord(row) {
        const has = !!row && (row.cash_effective !== undefined || row.cash_status !== undefined);
        let impact = 'not_classified';
        if (has) impact = row.cash_effective === true ? 'actual' : (row.cash_status === 'pending' ? 'pending' : 'no_impact');
        return { impact, classified: has, direction: row?.cash_direction === 'out' ? 'out' : 'in', accountId: row?.cash_account_id || '' };
    }

    // Derive the cash_* fields from a control state. `timestamp` feeds
    // cash_effective_at when the money has actually moved.
    function derive(state, timestamp) {
        const s = state || {};
        if (s.impact === 'actual') {
            return { cash_effective: true, cash_status: 'actual', cash_direction: s.direction === 'out' ? 'out' : 'in', cash_account_id: s.accountId || null, cash_source: 'manual', cash_match_status: 'manual', cash_effective_at: timestamp || null };
        }
        if (s.impact === 'pending') {
            return { cash_effective: false, cash_status: 'pending', cash_direction: 'none', cash_account_id: s.accountId || null, cash_source: 'manual', cash_match_status: 'unmatched', cash_effective_at: null };
        }
        return { cash_effective: false, cash_status: 'none', cash_direction: 'none', cash_account_id: null, cash_source: 'manual', cash_match_status: 'unmatched', cash_effective_at: null };
    }

    // ── Cash impact is a function of the transaction type ────────────────────
    // The type already states whether money moved: `pending_payable` /
    // `pending_receivable` say it has not, `transfer` / `adjustment` are neutral,
    // the rest move cash. Asking the user again in a second vocabulary let the
    // two disagree — type `pending_payable` with impact "Actual" was reachable,
    // producing a record that claimed both "unpaid" and "cash moved" while
    // feeding the Cash Movement card and bank reconciliation. So it is derived,
    // never asked. The cash ACCOUNT stays a user choice: which bank account the
    // money moved through is not derivable and is what bank rec matches on.
    const INBOUND_TYPES = ['income', 'revenue', 'refund', 'pending_receivable'];
    const PENDING_TYPES = ['pending_payable', 'pending_receivable'];
    const NEUTRAL_TYPES = ['transfer', 'adjustment'];

    function impactForType(type) {
        const t = String(type || '').trim().toLowerCase();
        if (NEUTRAL_TYPES.includes(t)) return 'no_impact';
        if (PENDING_TYPES.includes(t)) return 'pending';
        return 'actual';
    }
    function directionForType(type) {
        return INBOUND_TYPES.includes(String(type || '').trim().toLowerCase()) ? 'in' : 'out';
    }

    // The cash_* fields a transaction of this type carries. `accountId` is the
    // user's linked bank account; `timestamp` feeds cash_effective_at.
    // cash_source 'auto' marks this as derived, so a human classification and a
    // bank/integration-sourced one stay distinguishable in the audit trail.
    function deriveFromType(type, { accountId = '', timestamp = null } = {}) {
        const impact = impactForType(type);
        if (impact === 'actual') {
            return {
                cash_effective: true, cash_status: 'actual', cash_direction: directionForType(type),
                cash_account_id: accountId || null, cash_source: 'auto', cash_match_status: 'unmatched',
                cash_effective_at: timestamp || null
            };
        }
        if (impact === 'pending') {
            return {
                cash_effective: false, cash_status: 'pending', cash_direction: 'none',
                cash_account_id: accountId || null, cash_source: 'auto', cash_match_status: 'unmatched',
                cash_effective_at: null
            };
        }
        return {
            cash_effective: false, cash_status: 'none', cash_direction: 'none',
            cash_account_id: null, cash_source: 'auto', cash_match_status: 'unmatched',
            cash_effective_at: null
        };
    }

    // Cash facts established by a bank statement or a commerce integration are
    // observed, not inferred — never overwrite them from the type.
    const DERIVED_SAFE_SOURCES = ['auto', 'manual', '', null, undefined];
    function isDerivable(row) {
        if (!row) return true;
        if (row.recon_status && row.recon_status !== 'unreconciled') return false;
        return DERIVED_SAFE_SOURCES.includes(row.cash_source ?? '');
    }

    // Read-only presentation of the derived state, using the same wording as the
    // ledger's cash badge so the two never describe the same record differently.
    function badgeForType(type) {
        const impact = impactForType(type);
        if (impact === 'actual') {
            return directionForType(type) === 'in'
                ? { label: 'Cash in', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
                : { label: 'Cash out', cls: 'border-blue-200 bg-blue-50 text-blue-700' };
        }
        if (impact === 'pending') return { label: 'Pending cash', cls: 'border-amber-200 bg-amber-50 text-amber-700' };
        return { label: 'No cash impact', cls: 'border-gray-200 bg-gray-50 text-gray-500' };
    }

    function explainForType(type) {
        const t = String(type || '').trim().toLowerCase();
        if (t === 'pending_payable') return 'Money has not left yet — it moves when you record the payment.';
        if (t === 'pending_receivable') return 'Money has not arrived yet — it moves when you record the receipt.';
        if (NEUTRAL_TYPES.includes(t)) return 'This does not change your cash balance.';
        return INBOUND_TYPES.includes(t) ? 'Money is coming in on this date.' : 'Money is going out on this date.';
    }

    // Badge + optional cash-account select. No impact/direction tabs: those are
    // derived from the type shown right above this in every drawer.
    // Which cash account to PRE-SELECT. The account is a real user choice, but
    // defaulting it to "No account linked" meant 91% of transactions were saved
    // unattributed — nobody opts in to a field that is already filled with a valid
    // answer. Unattributed cash is what makes the bank reconciliation approximate
    // instead of exact, so the default has to be the useful one.
    //
    // Order: an explicit value (editing an existing row) → the last account this
    // workspace used → the only active account, if there is exactly one. With
    // several accounts and no history there is a genuine choice, so ask.
    // "No account linked" stays available; it just stops being the default.
    const LAST_ACCOUNT_KEY = 'fluxy_last_cash_account';
    function rememberAccount(scopeId, accountId) {
        try {
            if (!accountId) return;
            localStorage.setItem(`${LAST_ACCOUNT_KEY}:${scopeId || 'default'}`, String(accountId));
        } catch (_) { /* private mode — the default just falls back a tier */ }
    }
    function defaultAccountId(bankAccounts, { explicit = '', scopeId = null } = {}) {
        const active = (bankAccounts || []).filter(a => a.status === 'active');
        const isActive = (id) => !!id && active.some(a => a.id === id);
        if (isActive(explicit)) return explicit;
        try {
            const remembered = localStorage.getItem(`${LAST_ACCOUNT_KEY}:${scopeId || 'default'}`);
            if (isActive(remembered)) return remembered;
        } catch (_) { /* ignore */ }
        return active.length === 1 ? active[0].id : '';
    }

    function buildDerivedHtml({ type, accountId = '', bankAccounts = [], showAccount = true } = {}) {
        const b = badgeForType(type);
        const accounts = (bankAccounts || []).filter(a => a.status === 'active');
        const options = accounts
            .map(a => `<option value="${esc(a.id)}" ${a.id === accountId ? 'selected' : ''}>${esc(a.account_name || a.bank_name || a.id)}</option>`)
            .join('');
        const needsAccount = impactForType(type) !== 'no_impact';
        return `
            <div>
                <p class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Cash impact</p>
                <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <span data-fci-badge class="inline-flex items-center rounded border px-2 py-1 text-[11px] font-bold uppercase ${b.cls}">${esc(b.label)}</span>
                    <p data-fci-explain class="mt-1.5 text-[11px] text-gray-500">${esc(explainForType(type))}</p>
                </div>
            </div>
            ${showAccount && needsAccount ? `
            <div data-fci-account-field>
                <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Link cash account</label>
                ${accounts.length
                    ? `<select data-fci="account" ${accounts.length > 5 ? 'data-fluxy-search' : ''} class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]"><option value="">No account linked</option>${options}</select>`
                    : `<p class="text-[13px] text-gray-500 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">No bank accounts added yet. Add one in Settings → Cash &amp; Bank Accounts.</p>`}
            </div>` : ''}`;
    }

    // Repaint the badge in place when the type changes, without losing the
    // account the user already picked.
    function refreshDerived(root, type) {
        if (!root) return;
        const b = badgeForType(type);
        const badge = root.querySelector('[data-fci-badge]');
        if (badge) {
            badge.className = `inline-flex items-center rounded border px-2 py-1 text-[11px] font-bold uppercase ${b.cls}`;
            badge.textContent = b.label;
        }
        const explain = root.querySelector('[data-fci-explain]');
        if (explain) explain.textContent = explainForType(type);
        root.querySelector('[data-fci-account-field]')?.classList.toggle('hidden', impactForType(type) === 'no_impact');
    }

    function accountIdFrom(root) {
        return root?.querySelector('[data-fci="account"]')?.value || '';
    }

    return {
        buildHtml, wire, derive, stateFromRecord,
        impactForType, directionForType, deriveFromType, isDerivable,
        badgeForType, explainForType, buildDerivedHtml, refreshDerived, accountIdFrom,
        defaultAccountId, rememberAccount
    };
})();

/* ── FluxyDrawer — universal right-side Entry Drawer shell ──────────────
   ONE shared shell + behavior for every create / upload / import / review
   / edit drawer. Paired with the .fluxy-drawer-* CSS in shared-dashboard.css.

   Design contract (keeps existing open/close JS untouched):
   - build() emits the standard shell markup using the caller's EXISTING
     ids + inline onClose handler, so current open/close code (which toggles
     the Tailwind `translate-x-full` utility) keeps working verbatim.
   - It never toggles translate-x-full, never locks scroll by default, and
     never renames ids. It only standardizes structure + shared behavior.
   - No transform/filter is introduced on the panel/body/sections, so the
     body-portaled fluxy-select + date-picker menus are never clipped.

   API:
     FluxyDrawer.build({ ids, title, description, size, formId, formClass,
                         stepper, bodyHTML, footerHTML, onClose, eyebrow }) -> HTML string
     FluxyDrawer.stepper(steps, currentKey) -> stepper HTML  (steps:[{key,label}])
     FluxyDrawer.updateStepper(rootEl, key) -> retoggle is-done/is-current/is-upcoming BY KEY
     FluxyDrawer.mountBehavior(panelEl, opts) -> wire focus-trap (+ optional
                         Escape / overlay), returns a disposer function.        */
window.FluxyDrawer = (function () {
    const CLOSE_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
    const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>';

    function stepper(steps, currentKey) {
        const list = Array.isArray(steps) ? steps : [];
        const idx = Math.max(0, list.findIndex(s => s.key === currentKey));
        return '<div class="fluxy-drawer-stepper" role="list" aria-label="Progress">' +
            list.map((s, i) => {
                const state = i < idx ? 'is-done' : (i === idx ? 'is-current' : 'is-upcoming');
                const step =
                    '<span class="fluxy-drawer-step ' + state + '" role="listitem" data-step-key="' + s.key + '" aria-current="' + (i === idx ? 'step' : 'false') + '">' +
                        '<span class="fluxy-drawer-step-node"><span class="fluxy-drawer-step-num">' + (i + 1) + '</span>' + CHECK_SVG + '</span>' +
                        '<span class="fluxy-drawer-step-label">' + s.label + '</span>' +
                    '</span>';
                const line = i < list.length - 1 ? '<span class="fluxy-drawer-step-line"></span>' : '';
                return step + line;
            }).join('') +
        '</div>';
    }

    function updateStepper(rootEl, key) {
        if (!rootEl) return;
        const steps = Array.from(rootEl.querySelectorAll('.fluxy-drawer-step'));
        const idx = steps.findIndex(s => s.getAttribute('data-step-key') === key);
        if (idx < 0) return;
        steps.forEach((s, i) => {
            s.classList.remove('is-done', 'is-current', 'is-upcoming');
            s.classList.add(i < idx ? 'is-done' : (i === idx ? 'is-current' : 'is-upcoming'));
            s.setAttribute('aria-current', i === idx ? 'step' : 'false');
        });
    }

    function build(opts) {
        const o = opts || {};
        const ids = o.ids || {};
        const rootId = ids.root || '';
        const overlayId = ids.overlay || '';
        const panelId = ids.panel || '';
        const titleId = ids.title || '';
        const bodyId = ids.body || '';
        const footerId = ids.footer || '';
        const size = o.size || 'md';
        const onClose = o.onClose || '';
        const onCloseAttr = onClose ? ' onclick="' + onClose + '"' : '';
        const eyebrow = o.eyebrow
            ? '<p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">' + o.eyebrow + '</p>'
            : '';
        const desc = o.description
            ? '<p class="fluxy-drawer-desc">' + o.description + '</p>'
            : '';
        const stepperHTML = o.stepper ? stepper(o.stepper.steps, o.stepper.current) : '';
        const body = '<div' + (bodyId ? ' id="' + bodyId + '"' : '') + ' class="fluxy-drawer-body">' + (o.bodyHTML || '') + '</div>';
        const footer = o.footerHTML
            ? '<div' + (footerId ? ' id="' + footerId + '"' : '') + ' class="fluxy-drawer-footer">' + o.footerHTML + '</div>'
            : '';
        // When a formId is given, the body + footer live inside the <form> so
        // the submit button keeps submitting the form (exact current structure).
        const inner = o.formId
            ? '<form id="' + o.formId + '" class="' + (o.formClass || 'flex flex-1 flex-col overflow-hidden') + '">' + body + footer + '</form>'
            : body + footer;

        return '' +
        '<div' + (rootId ? ' id="' + rootId + '"' : '') + ' class="fluxy-drawer-root">' +
            '<div' + (overlayId ? ' id="' + overlayId + '"' : '') + ' class="fluxy-drawer-overlay opacity-0 transition-opacity duration-300 ease-out"' + onCloseAttr + '></div>' +
            '<div' + (panelId ? ' id="' + panelId + '"' : '') + ' role="dialog" aria-modal="true"' + (titleId ? ' aria-labelledby="' + titleId + '"' : '') + ' class="fluxy-drawer-panel fluxy-drawer-panel--' + size + ' translate-x-full">' +
                '<div class="fluxy-drawer-header">' +
                    '<div>' + eyebrow +
                        '<h2' + (titleId ? ' id="' + titleId + '"' : '') + ' class="fluxy-drawer-title">' + (o.title || '') + '</h2>' +
                        desc +
                    '</div>' +
                    '<button type="button" class="fluxy-drawer-close" aria-label="Close"' + onCloseAttr + '>' + CLOSE_SVG + '</button>' +
                '</div>' +
                stepperHTML +
                inner +
            '</div>' +
        '</div>';
    }

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    function focusablesIn(container) {
        return Array.from(container.querySelectorAll(FOCUSABLE))
            .filter(el => el.offsetParent !== null || el.getClientRects().length);
    }

    // Standardized shared behavior. Focus trap by default; Escape/overlay are
    // OPT-IN so callers that already wire them don't double-fire. Never toggles
    // translate-x-full and never locks scroll unless asked (existing openers do).
    function mountBehavior(panelEl, opts) {
        if (!panelEl) return function () {};
        const o = opts || {};
        const closeOnEscape = !!o.closeOnEscape;
        const closeOnOverlay = !!o.closeOnOverlay;
        const focusTrap = o.focusTrap !== false;
        const onClose = typeof o.onClose === 'function' ? o.onClose : null;
        const prevFocus = document.activeElement;

        function onKeydown(e) {
            if (closeOnEscape && e.key === 'Escape') { if (onClose) onClose(); return; }
            if (!focusTrap || e.key !== 'Tab') return;
            // Let an open fluxy-select menu (portaled to <body>) own the Tab key.
            if (document.querySelector('.fluxy-select-menu')) return;
            const f = focusablesIn(panelEl);
            if (!f.length) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        document.addEventListener('keydown', onKeydown);

        let overlayHandler = null;
        if (closeOnOverlay && o.overlayEl && onClose) {
            overlayHandler = function () { onClose(); };
            o.overlayEl.addEventListener('click', overlayHandler);
        }

        if (o.autofocus !== false) {
            window.requestAnimationFrame(() => {
                const f = focusablesIn(panelEl).filter(el => !el.classList.contains('fluxy-drawer-close'));
                (f[0] || panelEl).focus({ preventScroll: true });
            });
        }

        return function dispose() {
            document.removeEventListener('keydown', onKeydown);
            if (overlayHandler && o.overlayEl) o.overlayEl.removeEventListener('click', overlayHandler);
            if (o.restoreFocus !== false && prevFocus && typeof prevFocus.focus === 'function') {
                prevFocus.focus({ preventScroll: true });
            }
        };
    }

    return { build, stepper, updateStepper, mountBehavior };
})();

window.showAddTransactionModal = function(options = {}) {
    // Trial/payment access guard: block record creation once the trial has expired
    // or while payment is pending verification. Fails open if state isn't loaded.
    if (window.FluxyAccessGuard && !window.FluxyAccessGuard.requireWriteAccess()) {
        return;
    }
    const {
        title = "Add Transaction",
        submitLabel = "Add Transaction",
        defaultType = 'expense',
        defaultCategory = 'Operations',
        context = 'transaction', // 'transaction', 'bill', 'subscription'
        openBulk = false,
        csvFile = null
    } = options;
    const supportsBulkCsv = context === 'transaction';
    const todayKey = getLocalDateKey();

    // --- CoA-driven classification (non-bill contexts) -----------------------
    // The founder-facing "Direction" maps to the granular `type` the kernel needs.
    // `type` stays the stored source of truth (no data migration); the cash-timing
    // toggle upgrades income/expense → pending_receivable/pending_payable at submit.
    // Pending is a DIRECTION, not a cash-impact toggle. It used to be reachable
    // only by setting the cash-impact control to "Pending", which meant the type
    // and the cash fields were two vocabularies for one fact and could disagree.
    // Type is now the single source of truth and cash impact is derived from it.
    const DIRECTION_TO_TYPE = { in: 'income', out: 'expense', pending_in: 'pending_receivable', pending_out: 'pending_payable', transfer: 'transfer', adjustment: 'adjustment', refund: 'refund', fee: 'fee', tax: 'tax' };
    const TYPE_TO_DIRECTION = { income: 'in', revenue: 'in', pending_receivable: 'pending_in', refund: 'refund', expense: 'out', pending_payable: 'pending_out', fee: 'fee', tax: 'tax', transfer: 'transfer', adjustment: 'adjustment' };
    // Which account-picker filter each direction uses ('in' = revenue accounts,
    // 'out' = expense accounts, null = account not required and field hidden).
    const DIRECTION_TO_ACCT_FILTER = { in: 'in', pending_in: 'in', refund: 'in', out: 'out', pending_out: 'out', fee: 'out', tax: 'out', transfer: null, adjustment: null };
    // Reverse of the built-in category defaults, so a picked account still writes a
    // budget-compatible `category` (Marketing/SaaS/Infrastructure/Operations/Revenue)
    // when it is one of the six built-ins; otherwise the account name is used.
    const ACCOUNT_TO_CATEGORY = { '4000': 'Revenue', '6100': 'Marketing', '6200': 'SaaS', '6300': 'Infrastructure', '6400': 'Operations' };
    const defaultDirection = TYPE_TO_DIRECTION[String(defaultType).toLowerCase()] || 'out';

    // Always destroy and recreate so context options (title, labels) are fresh
    const existing = document.getElementById('global-tx-modal');
    if (existing) {
        existing.parentElement.remove();
        document.body.classList.remove('overflow-hidden');
    }
    if (window.__closeAddTransactionModalOnEscape) {
        document.removeEventListener('keydown', window.__closeAddTransactionModalOnEscape);
    }

    const drawerDescription = context === 'bill'
        ? 'Track a bill you need to pay so it appears in payables and cash flow.'
        : context === 'subscription'
            ? 'Track a recurring subscription so renewals appear in your forecasts.'
            : 'Record revenue or expenses that will appear in your financial reports.';
    const detailsTitle = context === 'bill'
        ? 'Bill Details'
        : context === 'subscription' ? 'Subscription Details' : 'Transaction Details';
    const modalHTML = `
        <div id="global-tx-modal" class="fluxy-drawer-root">
            <div id="global-tx-overlay" class="fluxy-drawer-overlay opacity-0 transition-opacity duration-300 ease-out" onclick="window.closeAddTransactionModal()"></div>
            <div id="global-tx-drawer" role="dialog" aria-modal="true" aria-labelledby="global-tx-title" class="fluxy-drawer-panel fluxy-drawer-panel--md translate-x-full">
                <div class="fluxy-drawer-header">
                    <div>
                        <h2 id="global-tx-title" class="fluxy-drawer-title">${title}</h2>
                        <p class="fluxy-drawer-desc">${drawerDescription}</p>
                    </div>
                    <button type="button" onclick="window.closeAddTransactionModal()" class="fluxy-drawer-close" aria-label="Close">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="global-tx-form" class="flex flex-1 flex-col overflow-hidden">
                    <div class="fluxy-drawer-body">
                    ${supportsBulkCsv ? `
                    <div class="fluxy-drawer-segment" role="tablist" aria-label="Transaction entry method">
                        <button type="button" id="tx-tab-single" class="fluxy-drawer-segment-btn is-active" aria-selected="true" aria-controls="tx-single-panel">Single transaction</button>
                        <button type="button" id="tx-tab-bulk" class="fluxy-drawer-segment-btn" aria-selected="false" aria-controls="tx-bulk-panel">CSV bulk upload</button>
                    </div>
                    ` : ''}
                    <div id="tx-single-panel" class="fluxy-drawer-stack">
                        <section class="fluxy-drawer-section">
                            <h3 class="fluxy-drawer-section-title">${detailsTitle}</h3>
                            <div class="fluxy-drawer-field">
                                <label for="tx-amount" class="fluxy-drawer-label">Amount <span id="tx-amount-cur">(Rp)</span></label>
                                <div class="${context === 'bill' ? 'fluxy-amount-row' : ''}">
                                    <input type="text" id="tx-amount" name="amount" required placeholder="0" class="fluxy-drawer-input fluxy-drawer-input--mono">
                                    ${context === 'bill' ? `<select id="tx-currency" name="currency" class="fluxy-drawer-select fluxy-currency-select">
                                        <option value="IDR" selected>IDR</option>
                                        <option value="USD">USD</option>
                                        <option value="SGD">SGD</option>
                                    </select>` : ''}
                                </div>
                                ${context === 'bill' ? `<p id="tx-currency-hint" class="fluxy-drawer-hint hidden">Foreign-currency bill — it stays outside your Rupiah ledger until you pay it (you'll enter the exchange rate then).</p>` : ''}
                            </div>
                            <div class="fluxy-drawer-field">
                                ${context === 'bill' ? `
                                <label for="tx-type" class="fluxy-drawer-label">Type</label>
                                <select id="tx-type" name="type" class="fluxy-drawer-select">
                                    <option value="expense" selected>Expense</option>
                                    <option value="pending_payable">Pending payable</option>
                                </select>
                                ` : `
                                <label for="tx-direction" class="fluxy-drawer-label">Direction</label>
                                <select id="tx-direction" name="direction" class="fluxy-drawer-select">
                                    <option value="in" ${defaultDirection === 'in' ? 'selected' : ''}>Money in</option>
                                    <option value="pending_in" ${defaultDirection === 'pending_in' ? 'selected' : ''}>Money in · not received yet</option>
                                    <option value="out" ${defaultDirection === 'out' ? 'selected' : ''}>Money out</option>
                                    <option value="pending_out" ${defaultDirection === 'pending_out' ? 'selected' : ''}>Money out · not paid yet</option>
                                    <option value="transfer" ${defaultDirection === 'transfer' ? 'selected' : ''}>Transfer</option>
                                    <option value="adjustment" ${defaultDirection === 'adjustment' ? 'selected' : ''}>Adjustment</option>
                                    <option value="__sep" disabled>── Advanced ──</option>
                                    <option value="refund" ${defaultDirection === 'refund' ? 'selected' : ''}>Refund</option>
                                    <option value="fee" ${defaultDirection === 'fee' ? 'selected' : ''}>Fee</option>
                                    <option value="tax" ${defaultDirection === 'tax' ? 'selected' : ''}>Tax</option>
                                </select>
                                <p class="fluxy-drawer-hint">Money in records revenue; money out records a cost. Use "not received/paid yet" when the money has not actually moved. Advanced covers refunds, fees, and tax.</p>
                                <select id="tx-type" class="hidden" data-no-fluxy-select aria-hidden="true" tabindex="-1">
                                    <option value="income">Income</option>
                                    <option value="expense">Expense</option>
                                    <option value="transfer">Transfer</option>
                                    <option value="adjustment">Adjustment</option>
                                    <option value="refund">Refund</option>
                                    <option value="fee">Fee</option>
                                    <option value="tax">Tax</option>
                                    <option value="pending_receivable">Pending receivable</option>
                                    <option value="pending_payable">Pending payable</option>
                                </select>
                                `}
                            </div>
                            <div class="fluxy-drawer-field">
                                <label class="fluxy-drawer-label">${context === 'bill' ? 'Due Date' : 'Transaction Date'}</label>
                                <div id="tx-date-picker"></div>
                                <p class="fluxy-drawer-hint">${context === 'bill' ? 'Set when this bill is due for payment. Future dates are allowed.' : 'Defaults to today. Choose a previous day for backdated records.'}</p>
                            </div>
                        </section>

                        <section class="fluxy-drawer-section">
                            <h3 class="fluxy-drawer-section-title">Business Information</h3>
                            <div class="fluxy-drawer-field">
                                <label for="tx-vendor" class="fluxy-drawer-label">Vendor / Description</label>
                                <input type="text" id="tx-vendor" name="vendor" required placeholder="e.g. AWS, Client Payment" class="fluxy-drawer-input">
                            </div>
                            ${context === 'bill' ? `
                            <div class="fluxy-drawer-field">
                                <label for="tx-category" class="fluxy-drawer-label">Category</label>
                                <select id="tx-category" name="category" class="fluxy-drawer-select">
                                    <option value="Revenue" ${defaultCategory === 'Revenue' ? 'selected' : ''}>Revenue</option>
                                    <option value="Marketing" ${defaultCategory === 'Marketing' ? 'selected' : ''}>Marketing</option>
                                    <option value="Infrastructure" ${defaultCategory === 'Infrastructure' ? 'selected' : ''}>Infrastructure</option>
                                    <option value="Operations" ${defaultCategory === 'Operations' ? 'selected' : ''}>Operations</option>
                                    <option value="SaaS" ${defaultCategory === 'SaaS' ? 'selected' : ''}>SaaS</option>
                                    <option value="Others">Others</option>
                                </select>
                                <input id="tx-category-custom" type="text" maxlength="20" placeholder="Type category (max 20 chars)" class="fluxy-drawer-input hidden" />
                            </div>
                            ` : `<input type="hidden" id="tx-category" value="${defaultCategory}" />`}
                            <div class="fluxy-drawer-field" id="tx-account-field">
                                <label for="tx-account-mount" class="fluxy-drawer-label">Account</label>
                                <div id="tx-account-mount"></div>
                                <p class="fluxy-drawer-hint">Which account this affects — we pre-fill the best match; change it if needed.</p>
                            </div>
                        </section>

                        ${context === 'bill' ? `
                        <section class="fluxy-drawer-section">
                            <h3 class="fluxy-drawer-section-title">Tax</h3>
                            <div id="tx-budget-preview" class="hidden rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600"></div>
                            <div class="fluxy-drawer-field">
                                <label for="tx-bill-tax-rate" class="fluxy-drawer-label">PPN rate (%) — optional, tax-inclusive</label>
                                <input id="tx-bill-tax-rate" type="text" inputmode="decimal" placeholder="e.g. 11" class="fluxy-drawer-input tabular-nums" />
                                <p class="fluxy-drawer-hint">If set (PKP workspaces), PPN is extracted from the amount to input VAT (1130).</p>
                            </div>
                            <div class="fluxy-drawer-field-grid">
                                <div class="fluxy-drawer-field">
                                    <label for="tx-bill-wht-rate" class="fluxy-drawer-label">PPh withholding (%)</label>
                                    <input id="tx-bill-wht-rate" type="text" inputmode="decimal" placeholder="e.g. 2" class="fluxy-drawer-input tabular-nums" />
                                </div>
                                <div class="fluxy-drawer-field">
                                    <label for="tx-bill-wht-type" class="fluxy-drawer-label">Withholding type</label>
                                    <select id="tx-bill-wht-type" class="fluxy-drawer-select">
                                        <option value="">None</option>
                                        <option value="PPh 23">PPh 23</option>
                                        <option value="PPh 4(2)">PPh 4(2)</option>
                                        <option value="PPh 26">PPh 26</option>
                                    </select>
                                </div>
                            </div>
                            <p class="fluxy-drawer-hint">We withhold PPh from the vendor on the base; it posts to PPh Payable (2110) and reduces what you pay them.</p>
                        </section>
                        ` : ''}

                        ${context !== 'bill' ? `
                        <section class="fluxy-drawer-section">
                            <h3 class="fluxy-drawer-section-title">Additional Information</h3>
                            ${context === 'transaction' ? `
                            <!-- Outlet. Hidden unless the workspace actually has
                                 dimensions, so businesses that don't run outlets
                                 never see an empty picker. Revenue tagged here is
                                 what makes /outlet-pnl add up: buildJournal stamps
                                 document.dimension_id onto every line it produces,
                                 so nothing else in the posting path changes. -->
                            <div id="tx-outlet-section" class="fluxy-drawer-field hidden">
                                <label for="tx-outlet" class="fluxy-drawer-label">Outlet</label>
                                <select id="tx-outlet" name="outlet" class="fluxy-drawer-select">
                                    <option value="">Not assigned to an outlet</option>
                                </select>
                                <p class="fluxy-drawer-hint">Which outlet this belongs to. Without it the amount still posts, but it lands outside every outlet's P&L.</p>
                            </div>
                            <div id="tx-allocation-section" class="fluxy-drawer-field hidden">
                                <label for="tx-allocation" class="fluxy-drawer-label">Budget allocation</label>
                                <select id="tx-allocation" name="allocation" class="fluxy-drawer-select">
                                    <option value="">Auto-match by category</option>
                                </select>
                                <p class="fluxy-drawer-hint">Pin this expense to a budget allocation now, or leave it to match by category.</p>
                            </div>
                            <div id="tx-cash-impact-section" class="hidden space-y-3">
                                <div id="tx-cash-impact-control" class="space-y-3"></div>
                            </div>
                            <div id="tx-cash-impact-helper" class="hidden rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-800"></div>
                            ` : ''}
                            <div class="fluxy-drawer-field">
                                <label for="tx-status" class="fluxy-drawer-label">Status</label>
                                <select id="tx-status" name="status" class="fluxy-drawer-select">
                                    <option value="Completed">Completed</option>
                                    <option value="Reconciled">Reconciled</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Missing Receipt">Missing Receipt</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                            </div>
                            <div id="tx-receipt-section" data-fluxy-doc-mount></div>
                        </section>
                        ` : ''}
                    </div>
                    ${supportsBulkCsv ? `
                    <div id="tx-bulk-panel" class="hidden space-y-4">
                        <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 transition-all duration-200" id="tx-csv-dropzone">
                            <label for="tx-csv-file" class="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-7 text-center transition-all duration-200 hover:border-[#EA580C] hover:bg-gray-50">
                                <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#EA580C]">
                                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                                </span>
                                <span id="tx-csv-file-label" class="max-w-full truncate text-[13px] font-bold text-gray-900">Choose or drop a CSV file</span>
                                <span class="mt-1 text-[12px] text-gray-500">The file is validated before anything is saved.</span>
                            </label>
                            <input type="file" id="tx-csv-file" accept=".csv,text/csv" class="sr-only">
                            <div id="tx-csv-feedback" class="hidden mt-3 text-[12px] font-medium"></div>
                        </div>
                        <div id="tx-csv-preview-card" class="hidden rounded-xl border border-gray-200 bg-white p-4">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">CSV import preview</p>
                                    <p id="tx-csv-preview-title" class="mt-1 truncate text-[13px] font-bold text-gray-900"></p>
                                    <p id="tx-csv-preview-summary" class="mt-1 text-[12px] text-gray-500"></p>
                                </div>
                                <span id="tx-csv-preview-badge" class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Ready</span>
                            </div>
                            <div id="tx-csv-mapping-summary" class="mt-3 flex flex-wrap gap-2"></div>
                            <div id="tx-csv-duplicate-note" class="hidden mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"></div>
                            <div class="mt-3 overflow-x-auto rounded-lg border border-gray-200">
                                <table class="w-full min-w-[680px] text-left">
                                    <thead class="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                        <tr>
                                            <th class="px-3 py-2">Description</th>
                                            <th class="px-3 py-2">Category</th>
                                            <th class="px-3 py-2">Type</th>
                                            <th class="px-3 py-2">Amount</th>
                                            <th class="px-3 py-2">Status</th>
                                            <th class="px-3 py-2">Date</th>
                                            <th class="px-3 py-2">Cash account</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tx-csv-preview-body" class="divide-y divide-gray-100 text-[12px]"></tbody>
                                </table>
                            </div>
                        </div>
                        <div class="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-[13px] font-bold text-gray-900">Override row status</p>
                                    <p class="text-[11px] text-gray-500">Apply one status to every uploaded row</p>
                                </div>
                                <button type="button" id="tx-bulk-status-toggle"
                                    class="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent bg-gray-200 transition-colors focus:outline-none"
                                    role="switch" aria-checked="false">
                                    <span class="inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform"></span>
                                </button>
                            </div>
                            <div id="tx-bulk-status-panel" class="hidden space-y-2">
                                <select id="tx-bulk-status-select"
                                    class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]">
                                    <option value="Completed">Completed</option>
                                    <option value="Reconciled">Reconciled</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Missing Receipt">Missing Receipt</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                                <p id="tx-bulk-status-note" class="hidden rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-800"></p>
                            </div>
                        </div>
                        <div id="tx-bulk-allocation-card" class="hidden rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                            <div>
                                <p class="text-[13px] font-bold text-gray-900">Budget allocation</p>
                                <p class="text-[11px] text-gray-500">Apply one allocation to every expense row — income rows stay unallocated</p>
                            </div>
                            <select id="tx-bulk-allocation-select"
                                class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]">
                                <option value="">Match by category (default)</option>
                            </select>
                        </div>
                        <div id="tx-bulk-cash-card" class="hidden rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <p class="text-[13px] font-bold text-gray-900">Cash account</p>
                                    <p id="tx-bulk-cash-sub" class="text-[11px] text-gray-500">Which account this money moved through</p>
                                </div>
                                <button type="button" id="tx-bulk-cash-mode"
                                    class="hidden shrink-0 text-[11px] font-bold text-[#EA580C] hover:underline">Use one account</button>
                            </div>
                            <select id="tx-bulk-cash-select"
                                class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]">
                                <option value="">Don't link a cash account</option>
                            </select>
                            <div id="tx-bulk-cash-map" class="hidden space-y-2"></div>
                            <p id="tx-bulk-cash-note" class="hidden rounded-xl px-4 py-3 text-[12px]"></p>
                        </div>
                        <div class="rounded-xl border border-gray-200 bg-white p-4">
                            <div class="flex items-center justify-between mb-3">
                                <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">CSV Column Reference</p>
                                <div class="flex items-center gap-3 text-[10px] font-bold text-gray-500">
                                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>Required</span>
                                    <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-gray-300"></span>Optional</span>
                                </div>
                            </div>
                            <div class="mb-3 rounded-lg border border-gray-200 overflow-hidden">
                                <p class="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-white border-b border-gray-100">Example CSV</p>
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left">
                                        <thead>
                                            <tr class="bg-gray-50 border-b border-gray-200">
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Description</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Category</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Type</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Amount</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Status</th>
                                                <th class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr class="bg-white">
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Client Payment</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Revenue</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">Income</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-900 whitespace-nowrap">1250000</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-500 whitespace-nowrap">Completed</td>
                                                <td class="px-3 py-2 font-mono text-[12px] text-gray-500 whitespace-nowrap">${todayKey.split('-').reverse().join('-')}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="grid gap-1.5 text-[12px]">
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Description</span>
                                    <span class="text-gray-500">Vendor name or transaction memo</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Category</span>
                                    <span class="text-gray-500">Revenue · Marketing · Infrastructure · Operations · SaaS</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Type</span>
                                    <span class="text-gray-500">Income · Expense · Transfer · Refund · Adjustment · Fee · Tax · Pending receivable · Pending payable</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Amount</span>
                                    <span class="text-gray-500">Raw Rp integer — e.g. <span class="font-mono font-bold text-gray-700">1250000</span></span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Status</span>
                                    <span class="text-gray-500">Completed <span class="text-gray-400">(default)</span> · Reconciled · Pending · Missing Receipt · Cancelled</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Date</span>
                                    <span class="text-gray-500">DD-MM-YYYY — omit to use the range end date</span>
                                </div>
                                <div class="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                    <span class="mt-1 inline-block w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                    <span class="font-mono font-bold text-gray-900 w-24 flex-shrink-0">Cash account</span>
                                    <span class="text-gray-500">Bank account name — map values before importing. Header must say <span class="font-mono font-bold text-gray-700">Cash account</span> or <span class="font-mono font-bold text-gray-700">Bank account</span>, not <span class="font-mono">Account</span></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    </div>
                    <div class="fluxy-drawer-footer fluxy-drawer-footer--stack">
                        <div id="tx-date-warning" class="hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-medium text-amber-800"></div>
                        <div class="flex items-center justify-end gap-3">
                            <button type="button" onclick="window.closeAddTransactionModal()" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Cancel</button>
                            <button type="submit" id="tx-submit-btn" class="fluxy-drawer-btn fluxy-drawer-btn--primary" disabled>
                                <span>${submitLabel}</span>
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHTML;
    document.body.appendChild(wrapper);
    document.body.classList.add('overflow-hidden');
    window.requestAnimationFrame(() => {
        document.getElementById('global-tx-overlay')?.classList.remove('opacity-0');
        document.getElementById('global-tx-overlay')?.classList.add('opacity-100');
        document.getElementById('global-tx-drawer')?.classList.remove('translate-x-full');
    });
    window.__closeAddTransactionModalOnEscape = (event) => {
        if (event.key === 'Escape') window.closeAddTransactionModal();
    };
    document.addEventListener('keydown', window.__closeAddTransactionModalOnEscape);
    // Focus trap + focus restore via the shared drawer shell. Escape/overlay
    // stay owned by the existing handlers above (closeOnEscape/Overlay left off)
    // so nothing double-fires; the trap whitelists the body-portaled select menu.
    try {
        window.__fluxyTxDrawerDispose = window.FluxyDrawer?.mountBehavior?.(
            document.getElementById('global-tx-drawer'),
            { focusTrap: true, autofocus: false, restoreFocus: true }
        );
    } catch (_) { window.__fluxyTxDrawerDispose = null; }
    let activeEntryMode = 'single';
    let selectedEntryDate = todayKey;
    let entryDatePicker = null;  // FluxyDateRangePicker instance (for programmatic setRange)
    let updateSelectedCsvDateState = updateDateWarning;
    let bulkStatusOverride = null;
    let txAllocationContext = null; // { budget, allocations } | null — transaction allocation picker
    let txAllocationReload = null;  // () => Promise, re-fetches allocations on date change
    let bulkAllocationContext = null; // { budget, allocations } | null — CSV apply-to-all
    let cashBankAccounts = [];        // loaded once per drawer open
    let cashScopeId = null;           // workspace id — scopes the remembered cash account
    let accountPicker = null;         // FluxyAccountPicker controller (CoA account)
    let accountUserTouched = false;   // true once the user manually picks an account
    let accountSuggestSeq = 0;        // drops stale/overtaken suggestion responses
    let csvImportState = {
        file: null,
        csvText: '',
        parsed: null,
        status: 'idle'
    };
    const getSelectedCsvFile = () => document.getElementById('tx-csv-file')?.files?.[0] || csvImportState.file || null;

    // CSV cash-account attribution. `mode` is 'single' (one account for the whole
    // file) or 'column' (the file names an account per row). `chosen` is keyed by
    // the RAW CSV value so a user override survives a re-render.
    let bulkCashState = { mode: 'single', singleId: '', values: [], chosen: new Map() };

    // Live Formatting for Amount
    const amountInput = document.getElementById('tx-amount');
    const vendorInput = document.getElementById('tx-vendor');
    mountEntryDatePickers();
    mountOutletPicker();
    // Bill currency (Stage B): IDR uses dot-thousands digit formatting; USD/SGD
    // allow a decimal amount (major units, converted to cents on save).
    const currencySelect = document.getElementById('tx-currency');
    const billCurrency = () => (currencySelect ? currencySelect.value : 'IDR');
    amountInput.oninput = (e) => {
        if (billCurrency() === 'IDR') {
            // Shared formatter: reformats on deletion too, and keeps the caret.
            window.FluxyAmountInput.format(e.target);
        } else {
            // digits + a single decimal point, max 2 decimals
            let v = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
            const dot = v.indexOf('.');
            if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1, dot + 3);
            e.target.value = v;
        }
        updateSingleSubmitState();
    };
    let currencyUserTouched = false;
    // Reflect a currency into the label + hint (no amount reset) — used both by the
    // user's manual change and by applying a vendor's default currency.
    function applyBillCurrency(cur) {
        if (!currencySelect) return;
        const c = ['IDR', 'USD', 'SGD'].includes(cur) ? cur : 'IDR';
        currencySelect.value = c;
        const label = document.getElementById('tx-amount-cur');
        if (label) label.textContent = c === 'IDR' ? '(Rp)' : `(${c})`;
        document.getElementById('tx-currency-hint')?.classList.toggle('hidden', c === 'IDR');
    }
    if (currencySelect) {
        currencySelect.addEventListener('change', () => {
            currencyUserTouched = true;
            applyBillCurrency(billCurrency());
            amountInput.value = ''; // amount convention changed — start fresh
            updateSingleSubmitState();
        });
    }

    // Vendor master → Add Bill: when a known vendor is entered, prefill the bill's
    // currency from the vendor's default and derive the due date from its payment
    // terms. Bill context only; currency is skipped once the user picks one.
    const TERMS_DAYS = { due_on_receipt: 0, due_in_7_days: 7, due_in_14_days: 14, due_in_30_days: 30 };
    async function applyVendorDefaults() {
        if (context !== 'bill' || !vendorInput) return;
        const name = vendorInput.value.trim();
        if (!name) return;
        try {
            const { ds, scopeId } = await resolveTxServiceWhenReady();
            const vendor = await ds.getVendorByKey(scopeId, name);
            if (!vendor) return;
            if (!currencyUserTouched && vendor.default_currency && vendor.default_currency !== billCurrency()) {
                applyBillCurrency(vendor.default_currency);
                amountInput.value = '';
                updateSingleSubmitState();
            }
            const days = vendor.payment_terms ? TERMS_DAYS[vendor.payment_terms] : undefined;
            if (days != null && entryDatePicker) {
                const d = new Date();
                d.setDate(d.getDate() + days);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                selectedEntryDate = key;
                entryDatePicker.setRange?.(key, key);
                updateSingleSubmitState();
            }
        } catch (_) { /* non-fatal — vendor defaults are a convenience */ }
    }

    // Reveal the outlet picker only for workspaces that actually have outlets.
    // A business with one location should never be shown an empty dropdown, and
    // a failure here must not block recording a transaction.
    async function mountOutletPicker() {
        if (context !== 'transaction') return;
        const section = document.getElementById('tx-outlet-section');
        const select = document.getElementById('tx-outlet');
        if (!section || !select) return;
        try {
            const { ds, scopeId } = await getTransactionDataService();
            const dims = await ds.getDimensions(scopeId);
            if (!dims.length) return;
            select.insertAdjacentHTML('beforeend', dims.map((d) =>
                `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join(''));
            section.classList.remove('hidden');
            window.FluxySelect?.enhance(select);
        } catch (_) { /* the field simply stays hidden */ }
    }

    async function mountEntryDatePickers() {
        try {
            const picker = await loadFluxyDateRangePicker();

            entryDatePicker = picker?.mount('#tx-date-picker', {
                mode: 'single',
                start: selectedEntryDate,
                end: selectedEntryDate,
                defaultStart: todayKey,
                defaultEnd: todayKey,
                maxDate: context === 'bill' ? '2099-12-31' : todayKey,
                onChange: ({ start }) => {
                    selectedEntryDate = start;
                    updateSingleSubmitState();
                    if (context === 'bill' && typeof renderBillBudgetPreview === 'function') renderBillBudgetPreview();
                    if (context === 'transaction' && typeof txAllocationReload === 'function') txAllocationReload();
                }
            });

        } catch (error) {
            console.error(error);
            window.showToast?.('Date picker failed to load. Please refresh and try again.', 'error');
        }
    }

    async function getTransactionDataService() {
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const firebaseConfig = {
            apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
            authDomain: "fluxyos.com",
            projectId: "fluxyos",
            storageBucket: "fluxyos.firebasestorage.app",
            messagingSenderId: "1084252368929",
            appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
            measurementId: "G-ZN7J6DRD2L"
        };

        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const { Timestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const auth = getAuth(app);
        // Auth is restored from IndexedDB asynchronously (~0.5s). Reading
        // currentUser before that resolves reports a signed-in user as "session
        // expired" — submit fast enough after page load and the entry is lost.
        // Same guard the rest of this file already uses (see FluxyLive).
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        const user = auth.currentUser;
        if (!user) throw new Error("Session expired. Please log in again.");

        const { default: DataService } = await import('/assets/js/db-service.js');
        const ds = new DataService(app);
        // Workspace scope + actor for STAGE 2. scopeId is the workspace id (== uid
        // for owners); setActor pins audit/attribution to the real signed-in user.
        const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || {};
        ds.setActor(user.uid, ws.role || null);
        const scopeId = ws.id || user.uid;
        return { ds, user, scopeId, Timestamp };
    }

    // ── Real-time workspace sync ──────────────────────────────────────────────
    // Live updates when OTHER members change shared workspace data. Pages call
    // FluxyLive.attach({ collections, reload, mode }). mode 'auto' re-runs the
    // page loader (debounced) — good for read-only surfaces like the dashboard;
    // mode 'prompt' shows a non-disruptive "New activity · Refresh" pill — good
    // for filter/pagination-heavy pages (ledger, bills) so a teammate's write
    // never yanks away the current user's view mid-task.
    window.FluxyLive = (function () {
        let started = false;
        function showPill(onClick) {
            if (document.getElementById('fluxy-live-pill')) return;
            const pill = document.createElement('button');
            pill.id = 'fluxy-live-pill';
            pill.type = 'button';
            pill.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;display:inline-flex;align-items:center;gap:8px;background:#0B0F19;color:#fff;font-size:13px;font-weight:600;padding:10px 16px;border:none;border-radius:9999px;box-shadow:0 8px 24px rgba(11,15,25,0.25);cursor:pointer;';
            pill.innerHTML = '<span style="width:8px;height:8px;border-radius:9999px;background:#22c55e;display:inline-block;"></span> New activity · Refresh';
            pill.addEventListener('click', () => { pill.remove(); try { onClick(); } catch (_) {} });
            document.body.appendChild(pill);
        }
        async function attach({ collections = [], reload, mode = 'prompt' } = {}) {
            if (started || !collections.length || typeof reload !== 'function') return;
            started = true;
            try {
                const { ds, scopeId } = await getTransactionDataService();
                let timer = null;
                const onRemote = () => {
                    if (mode === 'auto') {
                        clearTimeout(timer);
                        timer = setTimeout(() => { try { reload(); } catch (_) {} }, 600);
                    } else {
                        showPill(reload);
                    }
                };
                collections.forEach((c) => { try { ds.watchCollection(scopeId, c, onRemote); } catch (_) {} });
            } catch (_) { started = false; }
        }
        return { attach, showPill };
    })();

    function getLocalDateKey(date = new Date()) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }


    function parseCsvDateInput(raw) {
        const s = String(raw || '').trim();
        // ISO 8601 timestamp: 2026-05-13T20:33:43.196Z (what the ledger CSV download produces)
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
        // DD-MM-YYYY
        if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
            const [day, month, year] = s.split('-').map(Number);
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        // YYYY-MM-DD falls through to parseLocalDateKey
        return s;
    }

    function parseLocalDateKey(dateKey) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
        const [year, month, day] = String(dateKey || '').split('-').map(Number);
        if (!year || !month || !day) return null;
        const date = new Date(year, month - 1, day, 12, 0, 0, 0);
        if (Number.isNaN(date.getTime())) return null;
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date;
    }

    function isPastDateKey(dateKey) {
        return Boolean(dateKey && dateKey !== todayKey);
    }

    function buildTransactionTimestamp(dateKey, Timestamp) {
        const date = parseLocalDateKey(dateKey);
        if (!date) throw new Error("Choose a valid transaction date.");
        if (dateKey > todayKey) throw new Error("Transaction date cannot be in the future.");
        // For today's entries, preserve the actual moment so the ledger shows
        // a real time of day instead of a noon placeholder. Backdated entries
        // stay at noon (parseLocalDateKey) to dodge timezone day-flips.
        if (dateKey === todayKey) return Timestamp.fromDate(new Date());
        return Timestamp.fromDate(date);
    }

    function buildBillDueDateTimestamp(dateKey, Timestamp) {
        const date = parseLocalDateKey(dateKey);
        if (!date) throw new Error("Choose a valid due date.");
        return Timestamp.fromDate(date);
    }

    function setDateWarning(message = '') {
        const warning = document.getElementById('tx-date-warning');
        if (!warning) return;
        warning.textContent = message;
        warning.classList.toggle('hidden', !message);
    }

    function updateDateWarning() {
        if (activeEntryMode === 'bulk') {
            const hasPastCsvRows = document.getElementById('tx-csv-file')?.dataset.hasPastDates === 'true';
            if (hasPastCsvRows) {
                setDateWarning('Some CSV rows use previous dates. They will be saved on the dates provided in the file.');
                return;
            }
            setDateWarning('');
            return;
        }

        if (context === 'bill') { setDateWarning(''); return; }
        setDateWarning(isPastDateKey(selectedEntryDate) ? 'This record will be saved to a previous day, not today.' : '');
    }

    function parseCsv(text) {
        const rows = [];
        let current = '';
        let row = [];
        let inQuotes = false;

        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            const next = text[index + 1];

            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                index++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') index++;
                row.push(current.trim());
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
                current = '';
            } else {
                current += char;
            }
        }

        row.push(current.trim());
        if (row.some(value => value !== '')) rows.push(row);
        return rows;
    }

    function normalizeHeader(header) {
        return header.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    function parseCsvAmount(value) {
        const cleaned = String(value || '').replace(/rp/gi, '').replace(/\s/g, '');
        const withoutGrouping = cleaned.includes(',') && cleaned.includes('.')
            ? cleaned.replace(/\./g, '').replace(',', '.')
            : cleaned.replace(/[.,](?=\d{3}(?:\D|$))/g, '');
        return parseFloat(withoutGrouping.replace(/[^\d.-]/g, ''));
    }

    function analyzeBulkCsv(csvText, defaultDateKey, overrideStatus = null) {
        const rows = parseCsv(csvText);
        if (rows.length < 2) throw new Error("CSV needs one header row and at least one transaction row.");
        if (rows.length > 501) throw new Error("CSV imports are limited to 500 transactions at a time.");

        const originalHeaders = rows[0];
        const headers = originalHeaders.map(normalizeHeader);
        const findIndex = (names) => names.map(normalizeHeader).map(name => headers.indexOf(name)).find(index => index >= 0);
        const indexes = {
            vendor: findIndex(['vendor_name', 'vendor', 'description', 'deskripsi']),
            category: findIndex(['category', 'kategori']),
            type: findIndex(['type', 'jenis']),
            amount: findIndex(['amount', 'jumlah']),
            status: findIndex(['status']),
            date: findIndex(['date', 'transaction_date', 'transactiondate', 'tanggal', 'tanggal_transaksi', 'waktu']),
            // Optional, like status/date. Deliberately NOT validated during parse:
            // a value naming no FluxyOS account must leave that row unlinked, not
            // fail the file, and every check below is a throw that aborts the whole
            // import.
            // Every synonym carries an explicit cash/bank/rekening token. A bare
            // "Account" column is deliberately NOT matched: in a FluxyOS-flavoured
            // CSV that is far more likely to be the Chart-of-Accounts account
            // (account_code/account_name), and reading it as a bank account would
            // stamp cash_effective on 500 rows from the wrong column.
            cashAccount: findIndex(['cash_account', 'bank_account', 'payment_account',
                'paid_from', 'rekening', 'akun_kas', 'akun_bank', 'sumber_dana', 'bank'])
        };

        if ([indexes.vendor, indexes.category, indexes.type, indexes.amount].some(index => index === undefined)) {
            throw new Error("CSV must include Description, Category, Type, and Amount columns.");
        }

        const allowedCategories = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];
        const allowedTypes = ['income', 'revenue', 'expense', 'transfer', 'refund', 'adjustment', 'fee', 'tax', 'pending_receivable', 'pending receivable', 'pending_payable', 'pending payable'];
        const allowedStatuses = ['Completed', 'Missing Receipt', 'Pending', 'Reconciled', 'Cancelled'];

        const categoryMap = {
            'pendapatan': 'Revenue',
            'pemasaran': 'Marketing',
            'infrastruktur': 'Infrastructure',
            'operasional': 'Operations',
            'saas': 'SaaS'
        };

        const typeMap = {
            'pemasukan': 'income',
            'pendapatan': 'revenue',
            'pengeluaran': 'expense',
            'transfer': 'transfer',
            'pengembalian': 'refund',
            'penyesuaian': 'adjustment',
            'biaya': 'fee',
            'pajak': 'tax',
            'piutang': 'pending_receivable',
            'utang': 'pending_payable',
            'belum diterima': 'pending_receivable',
            'belum dibayar': 'pending_payable'
        };

        const statusMap = {
            'selesai': 'Completed',
            'struk hilang': 'Missing Receipt',
            'tertunda': 'Pending',
            'direkonsiliasi': 'Reconciled',
            'dibatalkan': 'Cancelled'
        };

        const transactions = rows.slice(1).map((row, index) => {
            const line = index + 2;
            const amount = parseCsvAmount(row[indexes.amount]);
            
            let category = String(row[indexes.category] || '').trim();
            const lowerCat = category.toLowerCase();
            if (categoryMap[lowerCat]) category = categoryMap[lowerCat];

            let typeRaw = String(row[indexes.type] || '').toLowerCase().trim();
            if (typeMap[typeRaw]) typeRaw = typeMap[typeRaw];
            const type = typeRaw.replace(/\s+/g, '_');

            let statusRaw = String(overrideStatus || row[indexes.status] || 'Completed').trim();
            const lowerStatus = statusRaw.toLowerCase();
            if (statusMap[lowerStatus]) statusRaw = statusMap[lowerStatus];
            const status = statusRaw;
            
            const vendor = row[indexes.vendor];
            const dateKey = indexes.date === undefined || !row[indexes.date] ? defaultDateKey : parseCsvDateInput(row[indexes.date]);

            if (!vendor) throw new Error(`Row ${line}: Description is required.`);
            if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Row ${line}: Amount must be a positive number.`);
            if (!allowedCategories.includes(category)) throw new Error(`Row ${line}: Category must be Revenue, Marketing, Infrastructure, Operations, or SaaS.`);
            if (!allowedTypes.includes(type)) throw new Error(`Row ${line}: Type must be Income, Expense, Transfer, Refund, Adjustment, Fee, Tax, Pending receivable, or Pending payable.`);
            if (!allowedStatuses.includes(status)) throw new Error(`Row ${line}: Status must be one of: Completed, Reconciled, Pending, Missing Receipt, Cancelled.`);
            if (!parseLocalDateKey(dateKey)) throw new Error(`Row ${line}: Date must use DD-MM-YYYY.`);
            if (dateKey > todayKey) throw new Error(`Row ${line}: Date cannot be in the future.`);

            return {
                amount,
                vendor_name: vendor,
                category,
                type,
                status,
                icon: ['income', 'revenue', 'refund', 'pending_receivable'].includes(type) ? '💰' : '💸',
                dateKey,
                line,
                // Raw cell text, resolved to an account id at submit. Preview-only:
                // toTransactionRows strips it, because it is not in the Firestore
                // create allowlist and one stray key fails the whole batch.
                cashAccountRaw: indexes.cashAccount === undefined
                    ? '' : String(row[indexes.cashAccount] || '').trim()
            };
        });

        return { headers: originalHeaders, indexes, transactions };
    }

    // Analyzed preview rows → the exact shape addTransactions writes.
    // Everything stripped here is preview-only bookkeeping: `line`/`dateKey` are
    // parser artefacts, and the duplicate_* fields are UI state from the
    // pre-flight. None are in the Firestore transaction allowlist, so leaving
    // one attached would fail the create rule for the whole batch.
    // A CSV cash-account value → a bank account id.
    //
    // EXACT match on the normalised string only, never fuzzy. The bank-rec engine
    // hard-excludes a transaction whose cash_account_id differs from the
    // statement's account (recon-engine.js), and there is no bulk re-attribution
    // tool — so a near-miss that confidently picks the wrong account produces a
    // row that can never be matched and can only be fixed one at a time. An
    // unmatched value is recoverable; a wrongly matched one is not.
    //
    // Matched against the ways a person actually labels the column: the nickname,
    // the bank, the two together, and the last four digits on their own.
    function matchCashAccounts(values, accounts) {
        // A key that resolves to MORE THAN ONE account is removed, never settled by
        // precedence. Two accounts at the same bank means the string "BCA" must
        // produce no match at all — a 50/50 guess repeated across hundreds of rows
        // is the unrecoverable case, and "no match" is the recoverable one.
        const index = new Map();
        const AMBIGUOUS = Symbol('ambiguous');
        const add = (key, id) => {
            const k = normalizeHeader(String(key || ''));
            if (!k) return;
            const seen = index.get(k);
            if (seen === undefined) index.set(k, id);
            else if (seen !== id) index.set(k, AMBIGUOUS);
        };
        (accounts || []).forEach((account) => {
            if (!account || account.status === 'archived') return;
            add(account.id, account.id);           // lets a FluxyOS export round-trip
            add(account.account_name, account.id);
            add(account.bank_name, account.id);
            add(`${account.bank_name || ''} ${account.last_four || ''}`, account.id);
            if (account.last_four) add(account.last_four, account.id);
        });

        const matched = new Map();
        const unmatched = [];
        (values || []).forEach((raw) => {
            const key = normalizeHeader(String(raw || ''));
            if (!key) return; // a blank cell is not an unmatched value, just no instruction
            if (matched.has(raw) || unmatched.includes(raw)) return;
            const id = index.get(key);
            // An ambiguous key is treated exactly like no match: the user picks.
            if (id && id !== AMBIGUOUS) matched.set(raw, id);
            else unmatched.push(raw);
        });
        return { matched, unmatched };
    }

    function toTransactionRows(rows, Timestamp) {
        return rows.map(row => {
            const { dateKey, line, duplicate_match, duplicate_override, selected_for_import, cashAccountRaw, ...transaction } = row;
            void line; void duplicate_match; void duplicate_override; void selected_for_import; void cashAccountRaw;
            return {
                ...transaction,
                timestamp: buildTransactionTimestamp(dateKey, Timestamp)
            };
        });
    }

    function parseBulkTransactions(csvText, defaultDateKey, Timestamp, overrideStatus = null) {
        return toTransactionRows(analyzeBulkCsv(csvText, defaultDateKey, overrideStatus).transactions, Timestamp);
    }

    function hasCsvPastDates(csvText, defaultDateKey) {
        const rows = parseCsv(csvText);
        if (rows.length < 2) return isPastDateKey(defaultDateKey);
        const headers = rows[0].map(normalizeHeader);
        const dateIndex = ['date', 'transaction_date', 'transactiondate']
            .map(normalizeHeader)
            .map(name => headers.indexOf(name))
            .find(index => index >= 0);

        return rows.slice(1).some(row => {
            const dateKey = dateIndex === undefined || !row[dateIndex] ? defaultDateKey : parseCsvDateInput(row[dateIndex]);
            return isPastDateKey(dateKey);
        });
    }

    function setCsvFeedback(message, type = 'info') {
        const feedback = document.getElementById('tx-csv-feedback');
        if (!feedback) return;
        if (!message) {
            feedback.classList.add('hidden');
            feedback.textContent = '';
            return;
        }
        feedback.className = `mt-3 text-[12px] font-medium ${type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-700' : 'text-gray-500'}`;
        feedback.textContent = message;
        feedback.classList.remove('hidden');
    }


    function setSubmitButton(label, disabled = false) {
        const btn = document.getElementById('tx-submit-btn');
        if (!btn) return;
        btn.disabled = disabled;
        btn.innerHTML = `<span>${label}</span><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
    }

    function isSingleEntryComplete() {
        const rawAmount = amountInput.value.replace(/\./g, "");
        const hasDate = Boolean(parseLocalDateKey(selectedEntryDate));
        const dateOk = context === 'bill' ? hasDate : (hasDate && selectedEntryDate <= todayKey);
        return Number(rawAmount) > 0 && vendorInput.value.trim().length > 0 && dateOk;
    }

    function updateSingleSubmitState() {
        if (activeEntryMode !== 'bulk') {
            setSubmitButton(submitLabel, !isSingleEntryComplete());
            updateDateWarning();
        }
    }

    vendorInput.oninput = updateSingleSubmitState;
    updateSingleSubmitState();

    // "Others" category custom input — bill context keeps the Category <select>;
    // non-bill contexts use a hidden <input> carrier driven by the Account picker.
    const categorySelect = document.getElementById('tx-category');
    const categoryCustomInput = document.getElementById('tx-category-custom');
    if (categorySelect && categoryCustomInput && categorySelect.tagName === 'SELECT') {
        categorySelect.addEventListener('change', () => {
            const isOthers = categorySelect.value === 'Others';
            categoryCustomInput.classList.toggle('hidden', !isOthers);
            if (isOthers) categoryCustomInput.focus();
            else categoryCustomInput.value = '';
        });
    }

    // "Others" type custom input (legacy; only present when a #tx-type-custom
    // input exists, which the new Direction UI no longer renders).
    const typeSelectEl = document.getElementById('tx-type');
    const typeCustomInput = document.getElementById('tx-type-custom');
    if (typeSelectEl && typeCustomInput) {
        typeSelectEl.addEventListener('change', () => {
            const isOthers = typeSelectEl.value === 'Others';
            typeCustomInput.classList.toggle('hidden', !isOthers);
            if (isOthers) typeCustomInput.focus();
            else typeCustomInput.value = '';
        });
    }

    // --- Direction control + CoA Account picker -----------------------------
    // Non-bill contexts: the visible Direction select drives the hidden #tx-type
    // carrier (so all existing type-driven wiring — cash impact, budget picker —
    // keeps working) and the Account picker's type filter. The picker is the CoA
    // account the journal posts against; it auto-fills to what the kernel would
    // resolve and stays editable. Bill context keeps its Type select and adds the
    // Account picker as an override.
    const directionSelect = document.getElementById('tx-direction');
    const accountMount = document.getElementById('tx-account-mount');
    const accountField = document.getElementById('tx-account-field');

    // Write a budget-compatible category from the chosen account (non-bill only).
    function setDerivedCategory(account) {
        if (context === 'bill') return; // bill keeps the user-chosen Category select
        const el = document.getElementById('tx-category');
        if (!el) return;
        const derived = account ? (ACCOUNT_TO_CATEGORY[account.code] || account.name) : defaultCategory;
        el.value = derived || '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Resolve the DataService, tolerating the brief window right after page load
    // where Firebase auth hasn't restored the session yet (getTransactionDataService
    // throws "Session expired" until currentUser is populated). Cached once resolved.
    let _txSvc = null;
    async function resolveTxServiceWhenReady(tries = 20, delay = 250) {
        if (_txSvc) return _txSvc;
        for (let i = 0; i < tries; i++) {
            try { _txSvc = await getTransactionDataService(); return _txSvc; }
            catch (e) {
                if (!/session expired/i.test(String(e && e.message)) || i === tries - 1) throw e;
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        return _txSvc;
    }

    // Pull the account the kernel would resolve for the current direction/category
    // and pre-fill the picker (unless the user has taken over the field).
    async function refreshSuggestedAccount(force) {
        if (!accountPicker) return;
        const dir = directionSelect ? directionSelect.value : defaultDirection;
        const filter = context === 'bill' ? 'out' : (DIRECTION_TO_ACCT_FILTER[dir] ?? null);
        if (filter === null) return; // transfer/adjustment need no account
        if (!force && accountUserTouched) {
            const cur = accountPicker.getAccount();
            const okType = filter === 'in' ? cur && cur.type === 'revenue' : cur && cur.type === 'expense';
            if (okType) return; // keep the user's still-valid pick
        }
        // Same in-flight race as the Edit drawer (see ledger.html): the suggestion
        // is an async round-trip, so a reply can land after the user has already
        // picked. Applying it then would overwrite their choice AND reset
        // accountUserTouched, which silently re-enables re-suggestion for every
        // later edit. Drop superseded and overtaken responses.
        const seq = ++accountSuggestSeq;
        const touchedAtStart = accountUserTouched;
        try {
            const { ds, scopeId } = await resolveTxServiceWhenReady();
            const baseType = context === 'bill' ? (typeSelectEl?.value || 'expense') : (DIRECTION_TO_TYPE[dir] || 'expense');
            const catEl = document.getElementById('tx-category');
            const vendorEl = document.getElementById('tx-vendor');
            const sug = await ds.suggestAccountForEntry(scopeId, {
                type: baseType,
                category: catEl ? catEl.value : defaultCategory,
                vendor_name: vendorEl ? vendorEl.value : ''  // vendor memory (Phase 3): pre-fill the account last used for this vendor
            });
            if (seq !== accountSuggestSeq) return;               // superseded
            if (accountUserTouched !== touchedAtStart) return;   // picked mid-flight
            if (sug && sug.code) { accountPicker.setValue(sug.code); accountUserTouched = false; setDerivedCategory(accountPicker.getAccount()); }
        } catch (_) { /* non-fatal — the field simply stays empty */ }
    }

    // Reflect the current direction into the account field visibility + filter and
    // the hidden #tx-type carrier (dispatching change so cash-impact/budget react).
    function applyDirection(initial) {
        if (context === 'bill' || !directionSelect) return;
        const dir = directionSelect.value;
        const baseType = DIRECTION_TO_TYPE[dir] || 'expense';
        if (typeSelectEl && typeSelectEl.value !== baseType) {
            typeSelectEl.value = baseType;
            typeSelectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const filter = DIRECTION_TO_ACCT_FILTER[dir] ?? null;
        if (accountField) accountField.classList.toggle('hidden', filter === null);
        if (accountPicker) accountPicker.setDirection(filter);
        if (filter === null) { setDerivedCategory(null); }
        else if (!initial) { refreshSuggestedAccount(false); }
    }

    if (accountMount && window.FluxyAccountPicker) {
        (async () => {
            try {
                const { ds, scopeId } = await resolveTxServiceWhenReady();
                const chart = await ds.getChartForPicker(scopeId);
                const initialDir = context === 'bill' ? 'out' : (directionSelect ? directionSelect.value : defaultDirection);
                accountPicker = window.FluxyAccountPicker.mount(accountMount, {
                    name: 'account_code',
                    accounts: chart,
                    direction: context === 'bill' ? 'out' : (DIRECTION_TO_ACCT_FILTER[initialDir] ?? null),
                    placeholder: 'Select an account',
                    onChange: (code, account) => { accountUserTouched = true; setDerivedCategory(account); },
                    onCreateAccount: () => { window.open('/accounting', '_blank'); }
                });
                accountPicker.setDirection(context === 'bill' ? 'out' : (DIRECTION_TO_ACCT_FILTER[initialDir] ?? null));
                await refreshSuggestedAccount(true);
            } catch (e) { console.warn('Account picker init failed', e); }
        })();
    }
    if (directionSelect) directionSelect.addEventListener('change', () => applyDirection(false));
    // Set the hidden #tx-type carrier + Account-field visibility from the default
    // direction SYNCHRONOUSLY (before the cash-impact section reads #tx-type, and
    // independent of the async picker mount or whether the picker script loaded).
    applyDirection(true);

    // Vendor memory (Phase 3): when the user finishes typing a vendor, re-fetch the
    // suggested account (pre-fills the account last used for that vendor). Skipped
    // once the user has manually picked an account (refreshSuggestedAccount guards).
    if (vendorInput) {
        vendorInput.addEventListener('change', () => { refreshSuggestedAccount(false); applyVendorDefaults(); });
        vendorInput.addEventListener('blur', () => { refreshSuggestedAccount(false); applyVendorDefaults(); });
    }

    // Cash impact section — transaction context only.
    // Read-only: the impact and direction are a function of the transaction Type
    // selected right above (see FluxyCashImpact.deriveFromType). Only the cash
    // ACCOUNT is a user choice — it is not derivable and is what bank rec matches.
    if (context === 'transaction') {
        const cashSection = document.getElementById('tx-cash-impact-section');
        const cashHelper = document.getElementById('tx-cash-impact-helper');
        const cashControl = document.getElementById('tx-cash-impact-control');
        const FCI = window.FluxyCashImpact;

        const renderCashControl = () => {
            if (!FCI || !cashControl) return;
            const typeVal = typeSelectEl?.value || defaultType;
            // Keep whatever is on screen if the user already chose; otherwise fall
            // back to the resolved default (last used, or the only active account).
            const keepAccount = FCI.accountIdFrom(cashControl)
                || FCI.defaultAccountId(cashBankAccounts, { scopeId: cashScopeId });
            cashControl.innerHTML = FCI.buildDerivedHtml({
                type: typeVal, accountId: keepAccount, bankAccounts: cashBankAccounts
            });
        };

        const updateCashImpactSection = () => {
            if (!cashSection || !cashHelper || !FCI) return;
            const typeVal = typeSelectEl?.value || defaultType;
            cashSection.classList.remove('hidden');
            // The badge now states the pending/neutral cases itself, so the old
            // duplicate helper banner only stays for the transfer caveat.
            cashHelper.classList.toggle('hidden', typeVal !== 'transfer');
            if (typeVal === 'transfer') {
                cashHelper.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
                cashHelper.textContent = 'Transfer tracking is saved as a neutral ledger record in this phase. Account-to-account transfer matching will be handled later.';
            }
            FCI.refreshDerived(cashControl, typeVal);
        };

        renderCashControl();
        typeSelectEl?.addEventListener('change', updateCashImpactSection);
        updateCashImpactSection();

        // Load bank accounts, then re-render the control (state preserved) so the
        // optional account link becomes available.
        (async () => {
            try {
                const { ds, user } = await getTransactionDataService();
                if (user && typeof ds.getBankAccounts === 'function') {
                    cashScopeId = (typeof ds._resolvedScopeId === 'function' ? ds._resolvedScopeId(user.uid) : null) || user.uid;
                    cashBankAccounts = (await ds.getBankAccounts(user.uid)) || [];
                    // Re-render even when the list is empty so a workspace that has
                    // since added an account picks the default up on the next open.
                    renderCashControl();
                    updateCashImpactSection();
                }
            } catch (_) {}
        })();
    }

    // Budget impact preview (Phase 1.5) — bill drawer only. Prefetches the
    // active budget + allocations, then re-evaluates the match whenever the
    // user changes amount, category, or due date.
    let billBudgetContext = null; // { budget, allocations, match } | null
    if (context === 'bill') {
        const previewEl = document.getElementById('tx-budget-preview');
        if (previewEl) {
            previewEl.classList.remove('hidden');
            previewEl.innerHTML = '<span class="text-gray-400">Loading budget impact…</span>';

            (async () => {
                try {
                    // Firebase Auth may not have rehydrated currentUser yet when
                    // the drawer opens immediately after page load. Wait for
                    // authStateReady() so the prefetch doesn't false-fire
                    // "Session expired" on the first open.
                    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
                    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
                    const firebaseConfig = {
                        apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
                        authDomain: "fluxyos.com",
                        projectId: "fluxyos",
                        storageBucket: "fluxyos.firebasestorage.app",
                        messagingSenderId: "1084252368929",
                        appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
                        measurementId: "G-ZN7J6DRD2L"
                    };
                    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
                    const auth = getAuth(app);
                    if (typeof auth.authStateReady === 'function') {
                        await auth.authStateReady();
                    }
                    if (!auth.currentUser) {
                        previewEl.innerHTML = '<span class="text-gray-400">Sign in to see budget impact.</span>';
                        return;
                    }
                    const { ds, user } = await getTransactionDataService();
                    const loadBudgetForDate = async (dateValue) => {
                        const activeBudget = typeof ds.getBudgetForDate === 'function'
                            ? await ds.getBudgetForDate(user.uid, dateValue)
                            : await ds.getActiveBudget(user.uid);
                        if (!activeBudget) return null;
                        return await ds.getBudgetUsage(user.uid, activeBudget.id);
                    };
                    const initialDueDate = parseLocalDateKey(selectedEntryDate) || new Date();
                    const usage = await loadBudgetForDate(initialDueDate);
                    if (!usage?.budget) {
                        billBudgetContext = {
                            budget: null,
                            allocations: [],
                            budgetDateKey: selectedEntryDate || '',
                            loadForDate: loadBudgetForDate,
                            matchWithUsage: (billData, nextUsage) => ds.matchBillToAllocation({
                                billData,
                                activeBudget: nextUsage?.budget,
                                allocations: nextUsage?.allocations || []
                            }),
                            match: () => ({ allocation: null, status: 'no_active_budget', exceedsBy: 0 })
                        };
                        renderBillBudgetPreview();
                        return;
                    }
                    // Single source of truth: every match goes through
                    // DataService.matchBillToAllocation. No inline duplicate.
                    billBudgetContext = {
                        budget: usage.budget,
                        allocations: usage.allocations || [],
                        budgetDateKey: selectedEntryDate || '',
                        loadForDate: loadBudgetForDate,
                        matchWithUsage: (billData, nextUsage) => ds.matchBillToAllocation({
                            billData,
                            activeBudget: nextUsage?.budget,
                            allocations: nextUsage?.allocations || []
                        }),
                        match: (billData) => ds.matchBillToAllocation({
                            billData,
                            activeBudget: usage.budget,
                            allocations: usage.allocations || []
                        })
                    };
                    renderBillBudgetPreview();
                } catch (err) {
                    console.warn('Budget preview load failed:', err);
                    previewEl.innerHTML = '<span class="text-gray-400">Budget impact unavailable.</span>';
                }
            })();

            amountInput.addEventListener('input', renderBillBudgetPreview);
            categorySelect.addEventListener('change', renderBillBudgetPreview);
            if (categoryCustomInput) categoryCustomInput.addEventListener('input', renderBillBudgetPreview);
            // The date picker doesn't expose a DOM event, but selectedEntryDate
            // changes via its onChange callback (line ~518). updateSingleSubmitState
            // is already called from there; piggyback on the same hook below.
        }
    }

    // Budget allocation picker (transaction context). Lets the user pin the
    // expense to a specific allocation at creation, so they don't reassign it
    // from the Budget page later. Only shown for expense-like types when an
    // active budget covers the selected transaction date.
    if (context === 'transaction') {
        const allocSection = document.getElementById('tx-allocation-section');
        const allocSelect = document.getElementById('tx-allocation');
        const allocTypeSel = document.getElementById('tx-type');

        const allocApplies = () => !!window.FluxyBudgetPicker
            && window.FluxyBudgetPicker.isExpenseLike(allocTypeSel?.value);

        const refreshAllocVisibility = () => {
            if (!allocSection) return;
            const show = !!(txAllocationContext && txAllocationContext.budget) && allocApplies();
            allocSection.classList.toggle('hidden', !show);
        };

        txAllocationReload = async () => {
            if (!window.FluxyBudgetPicker || !allocSelect) return;
            try {
                const { ds, user } = await getTransactionDataService();
                const when = parseLocalDateKey(selectedEntryDate) || new Date();
                txAllocationContext = await window.FluxyBudgetPicker.loadForDate(ds, user.uid, when);
                allocSelect.innerHTML = window.FluxyBudgetPicker.buildOptionsHtml(
                    txAllocationContext.allocations, allocSelect.value || ''
                );
            } catch (_) {
                txAllocationContext = { budget: null, allocations: [] };
            }
            refreshAllocVisibility();
        };

        allocTypeSel?.addEventListener('change', refreshAllocVisibility);
        // Initial load. Also seeds the CSV bulk apply-to-all picker, which always
        // targets the current-period budget (independent of the single-entry date,
        // which can change later). One fetch serves both.
        txAllocationReload().then(() => {
            if (!supportsBulkCsv || !window.FluxyBudgetPicker) return;
            bulkAllocationContext = txAllocationContext;
            const bulkSel = document.getElementById('tx-bulk-allocation-select');
            const bulkCard = document.getElementById('tx-bulk-allocation-card');
            const hasBudget = !!(bulkAllocationContext && bulkAllocationContext.budget);
            if (bulkSel) {
                bulkSel.innerHTML = window.FluxyBudgetPicker.buildOptionsHtml(
                    (bulkAllocationContext && bulkAllocationContext.allocations) || [], ''
                );
            }
            if (bulkCard) bulkCard.classList.toggle('hidden', !hasBudget);
        });
    }

    // --- CSV bulk: cash account attribution -------------------------------
    // Only the ACCOUNT is asked for. Everything else about cash impact is
    // derived from each row's type by FluxyCashImpact.deriveFromType, which is
    // also what the single-entry drawer uses — so a row imported here and the
    // same row typed by hand produce the same document.

    function cashAccountLabel(account) {
        const bank = account.bank_name || '';
        const name = account.account_name || '';
        const four = account.last_four ? ` ····${account.last_four}` : '';
        const head = bank && name && bank !== name ? `${bank} · ${name}` : (name || bank || account.id);
        return `${head}${four}`;
    }

    function cashOptionsHtml(selectedId, emptyLabel) {
        const opts = cashBankAccounts
            .filter(a => a && a.status !== 'archived')
            .map(a => `<option value="${escapeHtml(a.id)}"${a.id === selectedId ? ' selected' : ''}>${escapeHtml(cashAccountLabel(a))}</option>`)
            .join('');
        return `<option value=""${selectedId ? '' : ' selected'}>${escapeHtml(emptyLabel)}</option>${opts}`;
    }

    // Per-row preview cell. Says what will actually be saved, including the case
    // the user is most likely to be surprised by: a mapped transfer saves with no
    // account, because deriveFromType forces it to null.
    function cashPreviewCell(row) {
        const id = resolveRowCashAccount(row);
        if (!id) {
            return row.cashAccountRaw
                ? `<span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Unlinked</span>`
                : '<span class="text-gray-400">—</span>';
        }
        const derived = window.FluxyCashImpact.deriveFromType(row.type, { accountId: id });
        if (!derived.cash_account_id) {
            return `<span class="text-gray-400">— <span class="text-[11px]">no cash effect</span></span>`;
        }
        const account = cashBankAccounts.find(a => a.id === id);
        return escapeHtml(account ? (account.account_name || account.bank_name || id) : id);
    }

    // The account this row will actually be saved against, '' meaning unlinked.
    function resolveRowCashAccount(previewRow) {
        if (bulkCashState.mode === 'column') {
            const raw = String(previewRow?.cashAccountRaw || '');
            return raw ? (bulkCashState.chosen.get(raw) || '') : '';
        }
        return bulkCashState.singleId || '';
    }

    // Coverage, stated in rows AND rupiah. "142 rows linked" does not tell anyone
    // their Cash Position is about to move by 84 million; the amount does, and it
    // is the only place that consequence is visible before the import happens.
    function renderBulkCashNote() {
        const note = document.getElementById('tx-bulk-cash-note');
        if (!note) return;
        const rows = (csvImportState.parsed?.transactions || []).filter(r => r.selected_for_import !== false);
        if (!rows.length) { note.classList.add('hidden'); return; }

        let linked = 0, neutral = 0, cashIn = 0, cashOut = 0;
        const unmatched = new Set();
        rows.forEach((r) => {
            const id = resolveRowCashAccount(r);
            if (!id) {
                if (bulkCashState.mode === 'column' && r.cashAccountRaw) unmatched.add(r.cashAccountRaw);
                return;
            }
            const derived = window.FluxyCashImpact.deriveFromType(r.type, { accountId: id });
            if (!derived.cash_effective) { neutral += 1; return; }
            linked += 1;
            if (derived.cash_direction === 'in') cashIn += r.amount; else cashOut += r.amount;
        });

        const rp = (n) => 'Rp' + Math.abs(Number(n) || 0).toLocaleString('id-ID');
        const parts = [];
        if (linked) {
            const money = [cashOut ? `${rp(cashOut)} out` : '', cashIn ? `${rp(cashIn)} in` : '']
                .filter(Boolean).join(', ');
            parts.push(`${linked} of ${rows.length} rows will be recorded as cash that moved${money ? `: ${money}` : ''}.`);
        }
        // Named explicitly: a mapped transfer saves with no account, because
        // deriveFromType forces it. Surprising unless it is said out loud.
        if (neutral) parts.push(`${neutral} transfer/adjustment row(s) don't affect cash and stay unlinked.`);
        if (unmatched.size) {
            parts.push(`${unmatched.size} value(s) match no cash account (${[...unmatched].slice(0, 3).map(escapeHtml).join(', ')}${unmatched.size > 3 ? '…' : ''}) — those rows import without one.`);
        }
        if (!parts.length) { note.classList.add('hidden'); return; }
        note.className = unmatched.size
            ? 'rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] text-amber-800'
            : 'rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-800';
        note.textContent = parts.join(' ');
    }

    function renderBulkCashCard() {
        const card = document.getElementById('tx-bulk-cash-card');
        if (!card) return;
        const active = cashBankAccounts.filter(a => a && a.status !== 'archived');
        const ready = csvImportState.status === 'ready' && !!csvImportState.parsed;
        // No accounts, or nothing parsed yet — no card. Same discipline as the
        // allocation card, which hides when no budget covers the period.
        if (!active.length || !ready) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');

        const sel = document.getElementById('tx-bulk-cash-select');
        const map = document.getElementById('tx-bulk-cash-map');
        const sub = document.getElementById('tx-bulk-cash-sub');
        const modeBtn = document.getElementById('tx-bulk-cash-mode');
        const header = csvImportState.parsed.indexes.cashAccount;
        const hasColumn = header !== undefined && bulkCashState.values.length > 0;

        if (bulkCashState.mode === 'column' && hasColumn) {
            sel?.classList.add('hidden');
            map?.classList.remove('hidden');
            modeBtn?.classList.remove('hidden');
            if (sub) sub.textContent = `Mapping ${bulkCashState.values.length} value(s) from column "${csvImportState.parsed.headers[header]}"`;
            if (map) {
                map.innerHTML = bulkCashState.values.map(({ raw, count }) => `
                    <div class="flex items-center gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-[13px] font-semibold text-gray-900">${escapeHtml(raw)}</p>
                            <p class="text-[11px] text-gray-500">${count} row(s)</p>
                        </div>
                        <select data-csv-cash-value="${escapeHtml(raw)}"
                            class="w-[190px] shrink-0 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[12px]">
                            ${cashOptionsHtml(bulkCashState.chosen.get(raw) || '', "Don't link")}
                        </select>
                    </div>`).join('');
            }
        } else {
            sel?.classList.remove('hidden');
            map?.classList.add('hidden');
            modeBtn?.classList.toggle('hidden', !hasColumn);
            if (modeBtn) modeBtn.textContent = 'Map by column';
            if (sub) sub.textContent = 'Which account this money moved through';
            if (sel) sel.innerHTML = cashOptionsHtml(bulkCashState.singleId, "Don't link a cash account");
        }
        renderBulkCashNote();
    }

    // Called after every successful parse. Rebuilds the distinct-value list and
    // seeds the auto-match, preserving any override the user already made.
    function syncBulkCashFromParse() {
        const parsed = csvImportState.parsed;
        const active = cashBankAccounts.filter(a => a && a.status !== 'archived');
        if (!parsed) { bulkCashState.values = []; renderBulkCashCard(); return; }

        const counts = new Map();
        (parsed.transactions || []).forEach((r) => {
            const raw = String(r.cashAccountRaw || '');
            if (!raw) return;
            counts.set(raw, (counts.get(raw) || 0) + 1);
        });
        bulkCashState.values = [...counts.entries()]
            .map(([raw, count]) => ({ raw, count }))
            .sort((a, b) => b.count - a.count);

        if (bulkCashState.values.length) {
            const { matched } = matchCashAccounts(bulkCashState.values.map(v => v.raw), active);
            matched.forEach((id, raw) => { if (!bulkCashState.chosen.has(raw)) bulkCashState.chosen.set(raw, id); });
            bulkCashState.mode = 'column';
        } else {
            bulkCashState.mode = 'single';
            // Pre-select ONLY when there is exactly one account, so there is no
            // wrong answer to get. A remembered last-used account is a one-off
            // personal choice and must not be applied to a whole file: a wrong
            // account is hard-excluded by bank rec and there is no bulk undo.
            if (!bulkCashState.singleId && active.length === 1) bulkCashState.singleId = active[0].id;
        }
        renderBulkCashCard();
    }

    if (supportsBulkCsv) {
        // Delegated so the handlers survive every re-render of the mapping list.
        // CRITICAL: these must NOT re-parse the file the way the status override
        // does. A re-parse rebuilds parsed.transactions and silently discards the
        // duplicate_match flags and the user's "Include them anyway" choice, which
        // the submit path reads — re-including rows they excluded.
        document.getElementById('tx-bulk-cash-select')?.addEventListener('change', (e) => {
            bulkCashState.singleId = e.target.value || '';
            renderBulkCashNote();
        });
        document.getElementById('tx-bulk-cash-map')?.addEventListener('change', (e) => {
            const raw = e.target?.getAttribute?.('data-csv-cash-value');
            if (raw === null || raw === undefined) return;
            if (e.target.value) bulkCashState.chosen.set(raw, e.target.value);
            else bulkCashState.chosen.delete(raw);
            renderBulkCashNote();
        });
        document.getElementById('tx-bulk-cash-mode')?.addEventListener('click', () => {
            bulkCashState.mode = bulkCashState.mode === 'column' ? 'single' : 'column';
            renderBulkCashCard();
        });
    }

    function getCurrentBillCategory() {
        const sel = categorySelect?.value || '';
        if (sel === 'Others') {
            const custom = categoryCustomInput?.value?.trim();
            return custom?.length ? custom : 'Others';
        }
        return sel;
    }

    function renderBillBudgetPreview() {
        if (context !== 'bill') return;
        const previewEl = document.getElementById('tx-budget-preview');
        if (!previewEl) return;
        if (!billBudgetContext) return;

        const dueDate = parseLocalDateKey(selectedEntryDate) || new Date();
        const dateKey = selectedEntryDate || '';
        if (billBudgetContext.loadForDate && billBudgetContext.budgetDateKey !== dateKey && !billBudgetContext.loadingForDate) {
            billBudgetContext.loadingForDate = true;
            billBudgetContext.loadForDate(dueDate)
                .then((usage) => {
                    if (usage?.budget) {
                        billBudgetContext.budget = usage.budget;
                        billBudgetContext.allocations = usage.allocations || [];
                        billBudgetContext.match = (billData) => billBudgetContext.matchWithUsage(billData, usage);
                    } else {
                        billBudgetContext.budget = null;
                        billBudgetContext.allocations = [];
                        billBudgetContext.match = () => ({ allocation: null, status: 'no_active_budget', exceedsBy: 0 });
                    }
                    billBudgetContext.budgetDateKey = dateKey;
                    billBudgetContext.loadingForDate = false;
                    renderBillBudgetPreview();
                })
                .catch(() => {
                    billBudgetContext.loadingForDate = false;
                });
        }

        // No active budget at all
        if (!billBudgetContext.budget) {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">No active budget for this bill period. This bill will be saved without budget impact.</p>
            `;
            return;
        }

        const rawAmount = (amountInput.value || '').replace(/\./g, '');
        const numericAmount = Number(rawAmount) || 0;
        const billCategory = getCurrentBillCategory();
        // Use the in-progress drawer state (date + category + amount). The
        // matchBillToAllocation helper expects Firestore-style Timestamps or
        // Date objects — we pass plain Dates so the helper's `?.toDate?.()`
        // call falls through to the `instanceof Date` branch.
        const billData = {
            amount: numericAmount,
            category: billCategory,
            due_date: dueDate
        };

        const result = billBudgetContext.match(billData);
        billBudgetContext.lastResult = result;

        const fmt = (n) => 'Rp' + Math.abs(Number(n) || 0).toLocaleString('id-ID');
        const label = result.allocation?.name || 'Budget';
        if (result.status === 'out_of_period') {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">Due date is outside the active budget period. This bill will be saved without budget impact.</p>
            `;
            return;
        }
        if (result.status === 'unmatched') {
            previewEl.className = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] text-gray-600';
            previewEl.innerHTML = `
                <p class="font-bold text-gray-700">Budget impact</p>
                <p class="mt-1">No matching budget allocation found. This bill will be saved as unallocated.</p>
            `;
            return;
        }
        if (result.status === 'exceeded') {
            previewEl.className = 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700';
            previewEl.innerHTML = `
                <p class="font-bold">Budget warning</p>
                <p class="mt-1">This bill will exceed <strong>${escapeHtml(label)}</strong> by <span class="font-mono font-bold">${fmt(result.exceedsBy)}</span>. You can still save it, but this allocation will be marked Exceeded.</p>
            `;
            return;
        }
        if (result.status === 'needs_review') {
            previewEl.className = 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700';
            previewEl.innerHTML = `
                <p class="font-bold">Budget impact</p>
                <p class="mt-1">Multiple budget allocations may match this bill. Saving as needs review under <strong>${escapeHtml(label)}</strong>.</p>
            `;
            return;
        }
        // matched
        previewEl.className = 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-700';
        previewEl.innerHTML = `
            <p class="font-bold">Budget impact</p>
            <p class="mt-1">Auto matched to <strong>${escapeHtml(label)}</strong>. This bill will reserve <span class="font-mono font-bold">${fmt(numericAmount)}</span> from ${escapeHtml(label)}.</p>
        `;
    }

    // Shared document attachment — receipt for expense, revenue_proof for income.
    let attachmentController = null;
    const receiptMountEl = document.querySelector('#tx-receipt-section[data-fluxy-doc-mount]');
    if (receiptMountEl) {
        const isRevenueContext = defaultType === 'income' || defaultType === 'revenue' || defaultCategory === 'Revenue';
        const attachmentRole = isRevenueContext ? 'revenue_proof' : 'receipt';
        const attachmentSourceContext = isRevenueContext ? 'revenue' : 'transaction';
        loadFluxyDocumentAttachment()
            .then((api) => {
                if (!document.body.contains(receiptMountEl)) return;
                attachmentController = api.mount({
                    hostEl: receiptMountEl,
                    role: attachmentRole,
                    sourceContext: attachmentSourceContext
                });
            })
            .catch((err) => {
                console.error('FluxyDocumentAttachment load failed:', err);
                receiptMountEl.innerHTML = '<p class="text-[12px] text-red-500">Attachment uploader could not load. The form still saves without an attachment.</p>';
            });
    }

    if (supportsBulkCsv) {
        const singleTab = document.getElementById('tx-tab-single');
        const bulkTab = document.getElementById('tx-tab-bulk');
        const singlePanel = document.getElementById('tx-single-panel');
        const bulkPanel = document.getElementById('tx-bulk-panel');
        const singleFields = [amountInput, vendorInput, document.getElementById('tx-category'), document.getElementById('tx-type')];
        const fileInput = document.getElementById('tx-csv-file');
        const fileLabel = document.getElementById('tx-csv-file-label');
        const dropzone = document.getElementById('tx-csv-dropzone');

        const renderCsvPreview = (file, parsed) => {
            const card = document.getElementById('tx-csv-preview-card');
            const title = document.getElementById('tx-csv-preview-title');
            const summary = document.getElementById('tx-csv-preview-summary');
            const badge = document.getElementById('tx-csv-preview-badge');
            const mapping = document.getElementById('tx-csv-mapping-summary');
            const body = document.getElementById('tx-csv-preview-body');
            if (!card || !title || !summary || !badge || !mapping || !body) return;

            const indexLabel = (key) => {
                const index = parsed.indexes[key];
                if (index !== undefined) return parsed.headers[index];
                return key === 'cashAccount' ? 'Not in file' : 'Not mapped';
            };
            const requiredMap = [
                ['Description', 'vendor'],
                ['Category', 'category'],
                ['Type', 'type'],
                ['Amount', 'amount'],
                ['Status', 'status'],
                ['Date', 'date'],
                // Optional, and absent from most files — so it reads "Not in file"
                // rather than "Not mapped", which looks like an error for a column
                // nobody was required to supply.
                ['Cash account', 'cashAccount'],
            ];

            // Duplicate pre-flight result (docs/DUPLICATE_PREVENTION.md). Rows
            // the engine flagged arrive deselected — unwinding 200 mistaken
            // imports means 200 voids, so the default has to be "leave it out".
            const dupRows = parsed.transactions.filter(row => row.duplicate_match);
            const included = parsed.transactions.length - dupRows.length;

            title.textContent = file.name;
            summary.textContent = dupRows.length
                ? `${included} of ${parsed.transactions.length} rows will be imported. Showing first ${Math.min(parsed.transactions.length, 5)}.`
                : `${parsed.transactions.length} row${parsed.transactions.length === 1 ? '' : 's'} ready for review. Showing first ${Math.min(parsed.transactions.length, 5)}.`;
            badge.textContent = dupRows.length ? `${dupRows.length} skipped` : 'Ready';
            badge.className = dupRows.length
                ? 'shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700'
                : 'shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700';
            mapping.innerHTML = requiredMap.map(([label, key]) => `
                <span class="rounded-full border ${parsed.indexes[key] === undefined ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-emerald-200 bg-emerald-50 text-emerald-700'} px-2.5 py-1 text-[11px] font-bold">
                    ${escapeHtml(label)}: ${escapeHtml(indexLabel(key))}
                </span>
            `).join('');
            // Show the flagged rows first — they are the ones that need a decision.
            const previewRows = [...dupRows, ...parsed.transactions.filter(r => !r.duplicate_match)].slice(0, 5);
            body.innerHTML = previewRows.map(row => `
                <tr${row.duplicate_match ? ' class="bg-amber-50/40"' : ''}>
                    <td class="px-3 py-2 font-semibold text-gray-900">
                        ${escapeHtml(row.vendor_name)}
                        ${row.duplicate_match ? '<span class="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Possible duplicate</span>' : ''}
                    </td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.category)}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.type.replace(/_/g, ' '))}</td>
                    <td class="px-3 py-2 font-bold text-gray-900 tabular-nums">Rp${Math.abs(row.amount).toLocaleString('id-ID')}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.status)}</td>
                    <td class="px-3 py-2 text-gray-600">${escapeHtml(row.dateKey)}</td>
                    <td class="px-3 py-2 text-gray-600">${cashPreviewCell(row)}</td>
                </tr>
            `).join('');

            // The same affordance the bank statement import already offers, in
            // reverse: duplicates start excluded, and including them is opt-in.
            const dupNote = document.getElementById('tx-csv-duplicate-note');
            if (dupNote) {
                if (dupRows.length) {
                    dupNote.innerHTML = `
                        <span class="text-[12px] font-semibold text-amber-800">
                            ${dupRows.length === 1 ? '1 row looks' : `${dupRows.length} rows look`} like records you already have, so ${dupRows.length === 1 ? 'it is' : 'they are'} excluded from this import.
                        </span>
                        <button type="button" data-csv-include-dupes class="ml-2 text-[12px] font-bold text-[#EA580C] hover:underline">Include ${dupRows.length === 1 ? 'it' : 'them'} anyway</button>`;
                    dupNote.classList.remove('hidden');
                } else {
                    dupNote.innerHTML = '';
                    dupNote.classList.add('hidden');
                }
            }
            card.classList.remove('hidden');
        };

        const renderCsvPreviewError = (file, message) => {
            const card = document.getElementById('tx-csv-preview-card');
            const title = document.getElementById('tx-csv-preview-title');
            const summary = document.getElementById('tx-csv-preview-summary');
            const badge = document.getElementById('tx-csv-preview-badge');
            const mapping = document.getElementById('tx-csv-mapping-summary');
            const body = document.getElementById('tx-csv-preview-body');
            if (!card || !title || !summary || !badge || !mapping || !body) return;
            title.textContent = file?.name || 'CSV file';
            summary.textContent = message;
            badge.textContent = 'Needs fix';
            badge.className = 'shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700';
            mapping.innerHTML = '';
            body.innerHTML = `<tr><td colspan="7" class="px-3 py-4 text-[12px] font-medium text-red-700">${escapeHtml(message)}</td></tr>`;
            card.classList.remove('hidden');
        };

        const clearCsvPreview = () => {
            document.getElementById('tx-csv-preview-card')?.classList.add('hidden');
            // The cash card only makes sense against a parsed file.
            document.getElementById('tx-bulk-cash-card')?.classList.add('hidden');
        };

        const setEntryMode = (mode) => {
            activeEntryMode = mode;
            const isBulk = mode === 'bulk';
            singlePanel.classList.toggle('hidden', isBulk);
            bulkPanel.classList.toggle('hidden', !isBulk);
            singleTab.classList.toggle('is-active', !isBulk);
            bulkTab.classList.toggle('is-active', isBulk);
            singleTab.setAttribute('aria-selected', String(!isBulk));
            bulkTab.setAttribute('aria-selected', String(isBulk));
            singleFields.forEach(field => {
                field.disabled = isBulk;
            });
            setSubmitButton(isBulk ? 'Upload CSV' : submitLabel, isBulk ? csvImportState.status !== 'ready' : !isSingleEntryComplete());
            if (isBulk) {
                if (csvImportState.status === 'ready') setCsvFeedback('CSV preview is ready. Review it, then upload when ready.', 'success');
                else if (csvImportState.status === 'parsing') setCsvFeedback('Reading CSV and building preview...', 'info');
                else if (csvImportState.status !== 'error') setCsvFeedback('', 'info');
            }
            updateDateWarning();
        };

        singleTab.onclick = () => setEntryMode('single');
        bulkTab.onclick = () => setEntryMode('bulk');

        const updateSelectedCsvFile = async (incomingFile = null) => {
            const file = incomingFile || getSelectedCsvFile();
            csvImportState = {
                file,
                csvText: '',
                parsed: null,
                status: file ? 'parsing' : 'idle'
            };
            setSubmitButton('Parsing CSV', true);
            fileLabel.textContent = file ? file.name : 'Choose or drop a CSV file';
            dropzone.classList.toggle('border-[#EA580C]', Boolean(file));
            dropzone.classList.toggle('ring-2', Boolean(file));
            dropzone.classList.toggle('ring-orange-100', Boolean(file));
            setCsvFeedback(file ? 'Reading CSV and building preview...' : '', 'info');
            clearCsvPreview();
            fileInput.dataset.hasPastDates = 'false';
            if (!file) {
                csvImportState.status = 'idle';
                setSubmitButton('Upload CSV', true);
                updateDateWarning();
                return;
            }
            if (!file.name.toLowerCase().endsWith('.csv')) {
                csvImportState.status = 'error';
                setCsvFeedback('Upload a .csv file.', 'error');
                renderCsvPreviewError(file, 'Upload a .csv file.');
                setSubmitButton('Upload CSV', true);
                updateDateWarning();
                return;
            }
            if (file) {
                let csvText = '';
                try {
                    csvText = await file.text();
                    const parsed = analyzeBulkCsv(csvText, todayKey, bulkStatusOverride);
                    csvImportState = { file, csvText, parsed, status: 'ready' };
                    fileInput.dataset.hasPastDates = parsed.transactions.some(row => isPastDateKey(row.dateKey)) ? 'true' : 'false';
                    // Seed the cash card BEFORE the preview: the preview's per-row
                    // cash cell reads the resolved mapping.
                    syncBulkCashFromParse();
                    renderCsvPreview(file, parsed);
                    setCsvFeedback(`${parsed.transactions.length} rows parsed. Review the preview, then upload when ready.`, 'success');
                    setSubmitButton('Upload CSV', false);

                    // Duplicate pre-flight runs AFTER the preview is on screen so
                    // the user is never staring at a spinner; it re-renders once
                    // it knows. A failure here leaves the import exactly as it
                    // behaved before this feature.
                    if (window.FluxyDuplicateGuard) {
                        try {
                            const { ds: dupDs, scopeId: dupScope } = await getTransactionDataService();
                            const result = await window.FluxyDuplicateGuard.inspectBatch({
                                ds: dupDs, userId: dupScope, kind: 'transactions', rows: parsed.transactions
                            });
                            if (result.flagged && csvImportState.file === file) {
                                renderCsvPreview(file, parsed);
                                // Excluded rows drop out of the coverage counts.
                                renderBulkCashNote();
                                setCsvFeedback(`${parsed.transactions.length} rows parsed. ${result.flagged} look like duplicates and are excluded.`, 'info');
                            }
                        } catch (_) { /* preview already usable without it */ }
                    }
                } catch (err) {
                    csvImportState = { file, csvText: '', parsed: null, status: 'error' };
                    fileInput.dataset.hasPastDates = 'false';
                    const message = err?.message || 'Could not read this CSV file.';
                    setCsvFeedback(message, 'error');
                    renderBulkCashCard();
                    renderCsvPreviewError(file, message);
                    setSubmitButton('Upload CSV', true);
                }
            }
            updateDateWarning();
        };
        updateSelectedCsvDateState = updateSelectedCsvFile;

        fileInput.onchange = () => {
            updateSelectedCsvFile();
        };

        // Opt the flagged rows back in. Clearing `duplicate_match` is what makes
        // them import; the decision itself is logged at upload time, against
        // each row that was knowingly included.
        document.getElementById('tx-csv-duplicate-note')?.addEventListener('click', (e) => {
            if (!e.target?.closest('[data-csv-include-dupes]')) return;
            const rows = csvImportState.parsed?.transactions || [];
            rows.forEach((row) => {
                if (row.duplicate_match) {
                    row.duplicate_override = row.duplicate_match;
                    delete row.duplicate_match;
                    row.selected_for_import = true;
                }
            });
            if (csvImportState.file) renderCsvPreview(csvImportState.file, csvImportState.parsed);
            setCsvFeedback('Possible duplicates are included in this import.', 'info');
        });

        // Status override toggle
        const bulkToggleBtn = document.getElementById('tx-bulk-status-toggle');
        const bulkStatusPanel = document.getElementById('tx-bulk-status-panel');
        const bulkStatusSelect = document.getElementById('tx-bulk-status-select');
        const bulkStatusNote = document.getElementById('tx-bulk-status-note');

        const updateBulkStatusNote = () => {
            if (!bulkStatusOverride) return;
            bulkStatusNote.textContent = `Every uploaded row will be saved with status "${bulkStatusOverride}", overriding any Status column in the CSV.`;
            bulkStatusNote.classList.remove('hidden');
        };

        bulkToggleBtn.onclick = () => {
            const nowOn = bulkToggleBtn.getAttribute('aria-checked') !== 'true';
            bulkToggleBtn.setAttribute('aria-checked', String(nowOn));
            bulkToggleBtn.classList.toggle('bg-gray-200', !nowOn);
            bulkToggleBtn.classList.toggle('bg-[#EA580C]', nowOn);
            bulkToggleBtn.querySelector('span').classList.toggle('translate-x-0.5', !nowOn);
            bulkToggleBtn.querySelector('span').classList.toggle('translate-x-5', nowOn);
            bulkStatusPanel.classList.toggle('hidden', !nowOn);
            bulkStatusOverride = nowOn ? bulkStatusSelect.value : null;
            if (nowOn) updateBulkStatusNote();
            else bulkStatusNote.classList.add('hidden');
            if (getSelectedCsvFile()) updateSelectedCsvFile();
        };

        bulkStatusSelect.onchange = () => {
            bulkStatusOverride = bulkStatusSelect.value;
            updateBulkStatusNote();
            if (getSelectedCsvFile()) updateSelectedCsvFile();
        };

        dropzone.ondragover = (event) => {
            event.preventDefault();
            dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#EA580C]');
        };

        dropzone.ondragleave = () => {
            if (!fileInput.files?.[0]) {
                dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#EA580C]');
            }
        };

        dropzone.ondrop = (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.csv')) {
                setCsvFeedback('Upload a .csv file.', 'error');
                return;
            }
            const files = new DataTransfer();
            files.items.add(file);
            fileInput.files = files.files;
            updateSelectedCsvFile();
        };

        if (openBulk) {
            setEntryMode('bulk');
        }
        if (csvFile) {
            setEntryMode('bulk');
            try {
                const files = new DataTransfer();
                files.items.add(csvFile);
                fileInput.files = files.files;
            } catch (_) {
                csvImportState.file = csvFile;
            }
            updateSelectedCsvFile(csvFile);
        }
    }

    // The 7 optional cash-impact fields for a transaction, derived from its type.
    // The user never picks impact/direction — the type already states them, and
    // letting both be set independently allowed a `pending_payable` record to
    // claim cash had moved. `accountId` is the one user-supplied part.
    function buildCashImpactFields(txType, accountId, txTimestamp) {
        return window.FluxyCashImpact.deriveFromType(txType, { accountId, timestamp: txTimestamp });
    }

    // Form Submission
    document.getElementById('global-tx-form').onsubmit = async (e) => {
        e.preventDefault();
        // Role gate (UX): block viewers from creating records. Fail-open while the
        // workspace role is still resolving (role == null); Firestore rules remain
        // the hard boundary regardless. owner/admin/finance pass.
        const writeCap = context === 'bill' ? 'bills.create' : context === 'subscription' ? 'subscriptions.create' : 'transactions.create';
        const fxws = (typeof window !== 'undefined' && window.FluxyWorkspace) || null;
        if (fxws && fxws.role && typeof fxws.can === 'function' && !fxws.can(writeCap)) {
            window.showToast("Your role doesn't allow adding records in this workspace.", 'error');
            return;
        }
        const btn = document.getElementById('tx-submit-btn');
        btn.disabled = true;
        btn.innerText = activeEntryMode === 'bulk' ? "Reading..." : "Deploying...";
        let keepSubmitState = false;

        try {
            if (activeEntryMode === 'bulk') {
                const fileInput = document.getElementById('tx-csv-file');
                const dropzone = document.getElementById('tx-csv-dropzone');
                const fileLabel = document.getElementById('tx-csv-file-label');
                const file = getSelectedCsvFile();
                if (!file) {
                    setCsvFeedback('Choose a CSV file before uploading.', 'error');
                    return;
                }
                if (csvImportState.status !== 'ready') {
                    setCsvFeedback('Fix the CSV issues shown in the preview before uploading.', 'error');
                    return;
                }

                dropzone.classList.add('ring-2', 'ring-orange-100', 'border-[#EA580C]');
                const csvText = csvImportState.csvText || await file.text();
                const { ds, user, scopeId, Timestamp } = await getTransactionDataService();
                // Import from the rows the user actually reviewed — they carry
                // the duplicate pre-flight result. A fresh parse would silently
                // re-include everything the preview excluded.
                const reviewedRows = (csvImportState.file === file && csvImportState.parsed?.transactions)
                    ? csvImportState.parsed.transactions
                    : analyzeBulkCsv(csvText, todayKey, bulkStatusOverride).transactions;
                const skippedDuplicates = reviewedRows.filter(row => row.duplicate_match);
                const includedRows = reviewedRows.filter(row => !row.duplicate_match);
                if (!includedRows.length) {
                    setCsvFeedback(skippedDuplicates.length
                        ? 'Every row in this file looks like a record you already have. Nothing was imported.'
                        : 'This CSV has no rows to import.', 'error');
                    return;
                }
                const transactions = toTransactionRows(includedRows, Timestamp);
                // Apply the chosen budget allocation to expense-like rows only.
                // Income/refund rows are left to category match (or unallocated).
                const bulkAllocId = document.getElementById('tx-bulk-allocation-select')?.value || '';
                if (bulkAllocId && bulkAllocationContext?.budget && window.FluxyBudgetPicker) {
                    const allocFields = window.FluxyBudgetPicker.buildAssignmentFields({
                        budget: bulkAllocationContext.budget,
                        allocationId: bulkAllocId
                    });
                    transactions.forEach((row) => {
                        if (window.FluxyBudgetPicker.isExpenseLike(row.type)) Object.assign(row, allocFields);
                    });
                }
                // Cash attribution. A mapped account MEANS the money moved, so the
                // fields come from deriveFromType — the row's TYPE decides
                // actual/pending/neutral, never the presence of an account. That
                // keeps a bulk row identical to the same row typed into the drawer.
                //
                // The early return is the whole "unlinked" decision: calling
                // deriveFromType with an empty accountId would still stamp
                // cash_effective: true on an expense, i.e. "cash moved, account
                // unknown", dragging unmapped rows into the Cash Position KPI.
                // A row with no account must save exactly as it did before this
                // feature — no cash_* keys at all.
                const activeCashIds = new Set(cashBankAccounts.filter(a => a && a.status !== 'archived').map(a => a.id));
                let linkedCount = 0;
                transactions.forEach((row, i) => {
                    const accountId = resolveRowCashAccount(includedRows[i]);
                    if (!accountId) return;
                    // Rules allowlist cash_account_id but never validate it, so an
                    // account archived in another tab since the drawer opened would
                    // write a dangling id that renders as nothing. This is the only
                    // guard.
                    if (!activeCashIds.has(accountId)) return;
                    Object.assign(row, window.FluxyCashImpact.deriveFromType(row.type, {
                        accountId, timestamp: row.timestamp
                    }));
                    if (row.cash_account_id) linkedCount += 1;
                });

                btn.innerText = `Uploading ${transactions.length}...`;
                await ds.addTransactions(scopeId, transactions);

                // Only in single-account mode: remembering one of several mapped
                // accounts would poison the drawer's default with an arbitrary pick.
                if (bulkCashState.mode === 'single' && bulkCashState.singleId && cashScopeId) {
                    window.FluxyCashImpact.rememberAccount?.(cashScopeId, bulkCashState.singleId);
                }

                // Log the rows the user knowingly imported past a duplicate
                // warning. Best-effort: the import already succeeded, and a
                // failed provenance note must not read as a failed import.
                const overridden = includedRows.filter(row => row.duplicate_override);
                if (overridden.length && ds.recordDuplicateDecision) {
                    Promise.all(overridden.slice(0, 25).map(row => ds.recordDuplicateDecision(scopeId, {
                        kind: 'transactions',
                        primaryId: row.duplicate_override.existing_id || '',
                        score: row.duplicate_override.score,
                        rules: row.duplicate_override.rules,
                        decision: 'kept_both',
                        reason: 'Included from a CSV import after review.',
                        source: 'csv'
                    }))).catch(() => {});
                }

                const skipNote = skippedDuplicates.length
                    ? ` ${skippedDuplicates.length} possible duplicate${skippedDuplicates.length === 1 ? ' was' : 's were'} skipped.`
                    : '';
                // A receipt, not the warning. The drawer auto-closes 1.2s from here,
                // so nobody could act on a list of unmatched account names — that
                // belongs in the preview, before the rows are written.
                const cashNote = linkedCount
                    ? ` ${linkedCount} linked to a cash account.`
                    : '';
                setCsvFeedback(`${transactions.length} transactions imported successfully.${skipNote}${cashNote}`, 'success');
                window.FluxyDataSync?.emit({ kind: 'transaction', action: 'create', count: transactions.length });
                window.showToast(`${transactions.length} transactions imported from CSV.`, "success");
                btn.innerText = 'Uploaded';
                keepSubmitState = true;
                fileInput.value = '';
                fileLabel.textContent = 'Choose or drop a CSV file';
                csvImportState = { file: null, csvText: '', parsed: null, status: 'idle' };
                window.setTimeout(() => {
                    window.closeAddTransactionModal();
                    setSubmitButton('Upload CSV', true);
                    dropzone.classList.remove('ring-2', 'ring-orange-100', 'border-[#EA580C]');
                }, 1200);
                return;
            }

            if (!isSingleEntryComplete()) {
                window.showToast("Add an amount and vendor/description first.", "error");
                return;
            }

            // Amount parse is currency-aware for bills: IDR strips dot-thousands to a
            // rupiah integer; USD/SGD read a decimal major amount → integer cents.
            const billCurrency = context === 'bill' ? (document.getElementById('tx-currency')?.value || 'IDR') : 'IDR';
            const amountFieldRaw = document.getElementById('tx-amount').value;
            const parsedAmount = billCurrency === 'IDR'
                ? parseFloat(amountFieldRaw.replace(/\./g, "") || '0')
                : Math.round((parseFloat(amountFieldRaw.replace(/[^\d.]/g, '')) || 0) * 100);
            const txTypeSel = document.getElementById('tx-type').value;
            let txType = txTypeSel === 'Others'
                ? (document.getElementById('tx-type-custom')?.value.trim() || 'Others')
                : txTypeSel;
            const data = {
                amount: parsedAmount,
                vendor_name: document.getElementById('tx-vendor').value,
                category: (() => {
                    const el = document.getElementById('tx-category');
                    const sel = el ? el.value : '';
                    if (sel === 'Others') {
                        const custom = document.getElementById('tx-category-custom')?.value.trim();
                        return custom && custom.length > 0 ? custom : 'Others';
                    }
                    return sel;
                })(),
                type: txType,
                status: context === 'bill' ? 'Upcoming' : (document.getElementById('tx-status')?.value || 'Completed'),
                icon: ['income', 'refund', 'pending_receivable'].includes(txType) ? '💰' : '💸'
            };
            // Attach the chosen Chart-of-Accounts account so the posting engine uses
            // it as the categorizing line. Skipped for transfer/adjustment (no post).
            if (accountPicker) {
                const acctCode = accountPicker.getValue();
                const acct = accountPicker.getAccount();
                if (acctCode && txType !== 'transfer' && txType !== 'adjustment') {
                    data.account_code = acctCode;
                    if (acct && acct.name) data.account_name = acct.name;
                }
            }

            // Initialize Firebase if not already done
            const { ds, user, scopeId, Timestamp } = await getTransactionDataService();
            if (context === 'bill') {
                data.due_date = buildBillDueDateTimestamp(selectedEntryDate, Timestamp);
                data.currency = billCurrency;
                // Optional per-bill PPN (tax-inclusive): store the rate + extracted
                // amounts for display; the posting engine recomputes the same split.
                const rawRate = document.getElementById('tx-bill-tax-rate')?.value;
                const rate = parseFloat(String(rawRate || '').replace(',', '.'));
                const total = Number(data.amount) || 0;
                let base = total;
                if (Number.isFinite(rate) && rate > 0) {
                    const r = Math.min(Math.max(rate, 0), 100);
                    base = Math.round(total / (1 + r / 100));
                    data.tax_rate_percent = r;
                    data.taxable_base = base;
                    data.tax_amount = total - base;
                }
                // Optional PPh withholding (we withhold from the vendor on the base).
                const rawWht = document.getElementById('tx-bill-wht-rate')?.value;
                const wht = parseFloat(String(rawWht || '').replace(',', '.'));
                const whtType = document.getElementById('tx-bill-wht-type')?.value || '';
                if (Number.isFinite(wht) && wht > 0) {
                    const wr = Math.min(Math.max(wht, 0), 100);
                    data.withholding_rate = wr;
                    data.withholding_type = whtType || 'PPh 23';
                    data.withholding_code = ({ 'PPh 23': 'PPH23', 'PPh 4(2)': 'PPH4_2', 'PPh 26': 'PPH26' })[whtType] || 'PPH_WHT';
                }
            } else {
                data.timestamp = buildTransactionTimestamp(selectedEntryDate, Timestamp);
            }

            // Append optional cash-impact fields for transaction context.
            // Does not write to bank_accounts or bank_balance_snapshots.
            if (context === 'transaction') {
                const chosenCashAccount = window.FluxyCashImpact.accountIdFrom(document.getElementById('tx-cash-impact-control'));
                // Remember it so the next entry defaults to the same account — the
                // single biggest lever on cash attribution, which bank rec depends on.
                window.FluxyCashImpact.rememberAccount(cashScopeId, chosenCashAccount);
                Object.assign(data, buildCashImpactFields(txType, chosenCashAccount, data.timestamp));
            }

            // Duplicate check (docs/DUPLICATE_PREVENTION.md). Deliberately runs
            // BEFORE the attachment upload below: cancelling here must not leave
            // an orphaned file in Storage or burn the user's storage quota.
            // A detection failure resolves to "proceed", so this can never cost
            // someone their entry.
            if (user && window.FluxyDuplicateGuard) {
                btn.innerText = 'Checking for duplicates...';
                const dupKind = context === 'bill' ? 'bills'
                    : context === 'subscription' ? 'subscriptions' : 'transactions';
                const verdict = await window.FluxyDuplicateGuard.check({
                    ds, userId: scopeId, kind: dupKind, payload: data, source: 'manual'
                });
                // `finally` restores the button label and enabled state.
                if (!verdict.proceed) return;
                btn.innerText = 'Deploying...';
            }

            // Shared document attachment (Phase 1):
            //   - receipt for expense transactions
            //   - revenue_proof for income transactions
            //   - subscriptions reuse the receipt flow
            //   - bills attach invoices from the Bill Details drawer instead
            if (context !== 'bill') {
                const attachmentFile = attachmentController?.getPendingFile?.() || null;
                if (attachmentFile) {
                    const isRevenueContext = defaultType === 'income' || defaultType === 'revenue' || defaultCategory === 'Revenue';
                    const role = isRevenueContext ? 'revenue_proof' : 'receipt';
                    const sourceContextValue = isRevenueContext ? 'revenue' : (context === 'subscription' ? 'subscription' : 'transaction');

                    btn.innerText = 'Uploading attachment...';
                    let fileForUpload = attachmentFile;
                    if (attachmentFile.type && attachmentFile.type.startsWith('image/')) {
                        try { fileForUpload = await compressReceiptImage(attachmentFile); } catch (_) { fileForUpload = attachmentFile; }
                    }

                    const api = await loadFluxyDocumentAttachment();
                    const prepared = await api.prepareAttachmentForNewRecord({
                        ds,
                        userId: user.uid,
                        file: fileForUpload,
                        role,
                        sourceContext: sourceContextValue,
                        Timestamp
                    });

                    data.attached_documents = [prepared.attachmentForArray];
                    // receipt_url is NOT written. It stored a permanent public
                    // download URL in Firestore, so the leak outlived the page and
                    // travelled with the record. attached_documents already carries
                    // the storage_path, which is fetched through authorised bytes.
                    if (role === 'receipt') data.status = 'Completed';
                }
            }

            if (user) {
                const attachedDocId = Array.isArray(data.attached_documents) && data.attached_documents[0]
                    ? data.attached_documents[0].document_id
                    : null;

                if (context === 'bill') {
                    // Phase 1.5 — attach optional budget fields when an active
                    // budget exists. Omit all five when there is no active
                    // budget so legacy/no-budget bill writes keep working.
                    if (billBudgetContext?.budget) {
                        const match = billBudgetContext.match({
                            amount: data.amount,
                            category: data.category,
                            due_date: data.due_date
                        });
                        const budgetId = billBudgetContext.budget.id;
                        if (match.allocation && (match.status === 'matched' || match.status === 'exceeded')) {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = match.allocation.id;
                            data.budget_match_method = 'auto';
                            data.budget_match_status = 'matched';
                            data.budget_impact_status = 'committed';
                        } else if (match.allocation && match.status === 'needs_review') {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = match.allocation.id;
                            data.budget_match_method = 'auto';
                            data.budget_match_status = 'needs_review';
                            data.budget_impact_status = 'committed';
                        } else if (match.status === 'unmatched' || match.status === 'out_of_period') {
                            data.budget_id = budgetId;
                            data.budget_allocation_id = null;
                            data.budget_match_method = 'none';
                            data.budget_match_status = 'unmatched';
                            data.budget_impact_status = 'committed';
                        }
                    }
                    const billRef = await ds.addBill(scopeId, data);
                    if (attachedDocId && billRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'bills', billRef.id); } catch (_) {}
                    }
                    window.closeAddTransactionModal();
                    if (window.loadBills) await window.loadBills();
                    window.showToast("Bill successfully added to your schedule!", "success");
                } else if (context === 'subscription') {
                    const subRef = await ds.addSubscription(scopeId, data);
                    if (attachedDocId && subRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'subscriptions', subRef.id); } catch (_) {}
                    }
                    window.closeAddTransactionModal();
                    if (window.loadSubscriptions) await window.loadSubscriptions();
                    window.showToast("Subscription successfully activated!", "success");
                } else {
                    // Attach the user-selected budget allocation (Auto / specific
                    // allocation / Exclude). No-op when no active budget or "Auto".
                    if (txAllocationContext?.budget && window.FluxyBudgetPicker
                        && window.FluxyBudgetPicker.isExpenseLike(txType)) {
                        Object.assign(data, window.FluxyBudgetPicker.buildAssignmentFields({
                            budget: txAllocationContext.budget,
                            allocationId: document.getElementById('tx-allocation')?.value || ''
                        }));
                    }
                    // Outlet. addTransaction spreads its input straight onto the
                    // document, and buildJournal stamps document.dimension_id onto
                    // every line — so this one field is the whole of revenue
                    // attribution. Omitted entirely when blank rather than written
                    // as null, so records from before outlets existed and records
                    // deliberately left unassigned look the same.
                    const txOutlet = document.getElementById('tx-outlet')?.value || '';
                    if (txOutlet) data.dimension_id = txOutlet;
                    const txRef = await ds.addTransaction(scopeId, data);
                    if (attachedDocId && txRef?.id) {
                        try { await ds.linkDocumentTarget(user.uid, attachedDocId, 'transactions', txRef.id); } catch (_) {}
                    }
                    window.closeAddTransactionModal();
                    // Announce it once; every page decides how it reloads. This
                    // replaces the two hardcoded globals that only existed on
                    // Dashboard and Ledger — the reason a save looked like a no-op
                    // everywhere else. FluxyDataSync.emit still calls those two for
                    // back-compat, so nothing regresses.
                    window.FluxyDataSync?.emit({
                        kind: 'transaction', action: 'create', id: txRef?.id || null, record: data
                    });
                    // Find and flag the new row once the table has re-rendered.
                    window.FluxyDataSync?.highlightRow(txRef?.id);
                    window.showToast("Transaction successfully deployed to your live ledger!", "success");
                }
                // Vendor memory (Phase 3): remember the account chosen for this vendor
                // so the next entry for it pre-fills that account. Best-effort +
                // fire-and-forget — learning must never block or fail the save.
                if (data.account_code && data.vendor_name) {
                    ds.learnVendorAccount(scopeId, {
                        vendor_name: data.vendor_name, account_code: data.account_code, account_name: data.account_name
                    }).catch(() => {});
                }
            } else {
                window.showToast("Session expired. Please log in again.", "error");
            }
        } catch (err) {
            console.error(activeEntryMode === 'bulk' ? "CSV import failed:" : "FluxyOS Engine Error:", err);
            if (err.message.includes('permission-denied') || err.code === 'permission-denied') {
                window.showToast("CRITICAL: Permission Denied. Check Firestore Rules.", "error");
            } else if (err.message.includes('Session expired')) {
                window.showToast("Session expired. Please log in again.", "error");
            } else if (activeEntryMode === 'bulk') {
                setCsvFeedback(err.message, 'error');
            } else {
                window.showToast("FluxyOS Engine Error: " + err.message, "error");
            }
        } finally {
            if (keepSubmitState) return;
            if (activeEntryMode === 'bulk') {
                setSubmitButton('Upload CSV', csvImportState.status !== 'ready');
            } else {
                setSubmitButton(submitLabel, !isSingleEntryComplete());
            }
        }
    };
};

/**
 * Global Toast System
 */
// Render an accounting-kernel error for display: one place that resolves the
// GL_* code to a translated message and escapes the result.
//
// Three problems this collapses. (1) Three surfaces rendered `err.message` three
// different ways — showToast and showAlertDialog took it raw into innerHTML while
// accounting.js escaped it, so the same string was safe on one path and injected
// on another. (2) Error text never reached the Indonesian dictionary: interpolated
// messages ("… period (2026-06) …") can't be matched by the MutationObserver's
// exact-string swap, and the audit script can't even see `new Error('…')`.
// (3) Nothing carried a code, so callers matched English prose to make decisions.
//
// `gl.<CODE>` keys live in dashboard-i18n.js and interpolate from err.details.
// FluxyI18n.t() returns the KEY when it has no translation *and* when the UI is
// English, so the `translated === key` check is what falls back to the original
// message — without it, English users would see the literal string "gl.GL_020".
window.formatFluxyError = function (err, fallbackTitle) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const code = err && err.code ? String(err.code) : '';
    const raw = (err && err.message) ? String(err.message) : 'Please try again.';
    let text = raw;
    if (code) {
        const key = `gl.${code}`;
        try {
            const translated = window.FluxyI18n?.t(key, (err && err.details) || {});
            if (translated && translated !== key) text = translated;
        } catch (_) { /* fall back to the English message */ }
    }
    return { title: fallbackTitle || 'Something went wrong', body: esc(text), code };
};

// ── Data sync bus ───────────────────────────────────────────────────
// Saving a transaction used to refresh the page by calling two hardcoded
// globals, window.loadDashboard and window.loadLedger. Those exist on exactly
// two pages — but the Add Transaction drawer is hosted on ~40 (every page that
// loads this file). So on Net Profit, Revenue Overview, Cash Position, the
// Accounting Center, Bills, Invoices, Reports and the rest, a save wrote to
// Firestore and nothing on screen moved. The record was there; the page just
// never asked again. That is the "did it save?" feeling.
//
// The fix is an event, not more globals: a mutation announces itself once, and
// any page says how IT reloads. New pages and new entry points (CSV import, AI
// scan, bill payment) join by subscribing, without editing this file.
//
// Deliberately NOT Firestore onSnapshot listeners on every collection: this app
// is ~40 static pages, and live listeners on transactions/bills/invoices would
// multiply reads on every open tab for a problem that is really "refetch after a
// write I already know about". Emit-on-write is cheaper and precise.
window.FluxyDataSync = (function () {
    const EVENT = 'fluxy:data-changed';

    // Announce a mutation. `detail` describes what changed so a subscriber can
    // decide whether it cares: { kind: 'transaction'|'bill'|'invoice'|…,
    // action: 'create'|'update'|'delete', id, record }.
    function emit(detail = {}) {
        const payload = { kind: 'unknown', action: 'update', ...detail, at: Date.now() };
        try { window.dispatchEvent(new CustomEvent(EVENT, { detail: payload })); } catch (_) { /* older browsers */ }
        // Back-compat: the two pages that already exposed a global reloader keep
        // working without subscribing.
        try { if (typeof window.loadDashboard === 'function') window.loadDashboard(); } catch (_) {}
        try { if (typeof window.loadLedger === 'function') window.loadLedger(); } catch (_) {}
    }

    // Subscribe. Returns an unsubscribe fn. Handlers are wrapped so one throwing
    // page never blocks the others — a broken widget must not stop the dashboard
    // from refreshing.
    function onChange(handler, { kinds = null } = {}) {
        if (typeof handler !== 'function') return () => {};
        const wrapped = (e) => {
            const d = (e && e.detail) || {};
            if (kinds && !kinds.includes(d.kind)) return;
            try { handler(d); } catch (err) { console.warn('[data-sync] subscriber failed:', err); }
        };
        window.addEventListener(EVENT, wrapped);
        return () => window.removeEventListener(EVENT, wrapped);
    }

    // Mark a freshly-created row so the user can find it without re-reading the
    // table. Called by pages after they re-render; the id survives the reload
    // because the emit carries it.
    function highlightRow(id, { selector = '[data-ledger-id]', attr = 'data-ledger-id' } = {}) {
        if (!id) return;
        // The reload triggered by the same emit REPLACES the table's rows, so
        // applying the class once loses it the moment the fresh markup lands —
        // which is exactly what happened the first time this shipped. Keep
        // re-applying across the settling window, then let the animation finish.
        const sel = `${selector}[${attr}="${CSS.escape(String(id))}"]`;
        const SETTLE_MS = 1800;   // covers the refetch + re-render
        const started = Date.now();
        let scrolled = false;
        let found = false;

        const tick = () => {
            const row = document.querySelector(sel);
            if (row) {
                found = true;
                // Re-add after a re-render wiped it; no-op when already present.
                row.classList.add('fluxy-row-new');
                if (!scrolled) {
                    scrolled = true;
                    try {
                        const r = row.getBoundingClientRect();
                        if (r.top < 0 || r.bottom > window.innerHeight) {
                            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    } catch (_) {}
                }
            }
            if (Date.now() - started < SETTLE_MS) return setTimeout(tick, 120);
            if (!found) return; // filtered out, or on another page of the table
            // Settled: run the fade-out from here so the full animation is seen.
            setTimeout(() => document.querySelector(sel)?.classList.add('fluxy-row-new-done'), 2100);
            setTimeout(() => {
                const r = document.querySelector(sel);
                r?.classList.remove('fluxy-row-new', 'fluxy-row-new-done');
            }, 3200);
        };
        tick();
    }

    return { EVENT, emit, onChange, highlightRow };
})();

// Count a number up to its new value. Used for KPI figures so a change reads as
// something that HAPPENED rather than a value that was always there.
// Respects prefers-reduced-motion, and skips the animation for tiny deltas where
// it would just look like a glitch.
window.animateValue = function (el, from, to, { duration = 650, format = (n) => Math.round(n).toLocaleString('id-ID') } = {}) {
    if (!el) return;
    const start = Number(from) || 0;
    const end = Number(to) || 0;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || start === end || Math.abs(end - start) < 1) { el.textContent = format(end); return; }
    const t0 = performance.now();
    // easeOutCubic — fast start, gentle settle. Matches the drawer/toast motion.
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        el.textContent = format(start + (end - start) * ease(t));
        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

window.showToast = function(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600 border-green-500',
        error: 'bg-red-600 border-red-500',
        info: 'bg-blue-600 border-blue-500'
    };
    
    toast.className = `
        flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl border text-white font-bold text-[13px] 
        animate-in slide-in-from-right-full duration-500 pointer-events-auto min-w-[300px]
        ${colors[type] || colors.info}
    `;

    const icon = type === 'success' 
        ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>'
        : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

    toast.innerHTML = `
        <div class="flex-shrink-0">${icon}</div>
        <div class="flex-1">${message}</div>
    `;

    container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
        toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-full', 'duration-500');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
};

window.closeAddTransactionModal = function() {
    const modal = document.getElementById('global-tx-modal');
    if (modal) {
        if (modal.dataset.closing === 'true') return;
        modal.dataset.closing = 'true';
        try { window.FluxyDocumentAttachment?.reset(); } catch (_) {}
        const overlay = document.getElementById('global-tx-overlay');
        const drawer = document.getElementById('global-tx-drawer');
        overlay?.classList.remove('opacity-100');
        overlay?.classList.add('opacity-0');
        drawer?.classList.add('translate-x-full');
        document.body.classList.remove('overflow-hidden');
        if (window.__closeAddTransactionModalOnEscape) {
            document.removeEventListener('keydown', window.__closeAddTransactionModalOnEscape);
            window.__closeAddTransactionModalOnEscape = null;
        }
        if (window.__fluxyTxDrawerDispose) {
            try { window.__fluxyTxDrawerDispose(); } catch (_) {}
            window.__fluxyTxDrawerDispose = null;
        }
        // Fully remove so next open creates fresh context
        window.setTimeout(() => {
            modal.parentElement?.remove();
        }, 300);
    }
};

window.renderEmptyState = function(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defaultConfig = {
        title: "No Data Found",
        description: "Start by adding your first record to see the engine in motion.",
        buttonText: "Add Record",
        onAction: () => window.showAddTransactionModal(),
        icon: `<svg class="w-8 h-8 text-[#EA580C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>`
    };

    const c = { ...defaultConfig, ...config };

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-center px-6 animate-in fade-in duration-700">
            <div class="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-orange-100">
                ${c.icon}
            </div>
            <h3 class="text-xl font-bold text-gray-900 mb-2 tracking-tight">${c.title}</h3>
            <p class="text-[14px] text-gray-500 max-w-[320px] leading-relaxed mb-8">${c.description}</p>
            <button id="empty-state-action" class="inline-flex items-center gap-2 bg-[#EA580C] hover:bg-[#D94E0B] text-white font-bold text-[13px] px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                ${c.buttonText}
            </button>
        </div>
    `;

    document.getElementById('empty-state-action').onclick = c.onAction;
};

// Global toggle for Fluxy AI (Drawer)
window.toggleFluxyAI = (state) => {
    // Role gate (UX): Fluxy AI is a Finance+ capability; viewers are read-only.
    // Fail-open while role resolves (role == null). Closing (state === false) is
    // always allowed.
    if (state !== false) {
        const fxws = window.FluxyWorkspace || null;
        if (fxws && fxws.role && typeof fxws.can === 'function' && !fxws.can('ai.use')) {
            window.showToast?.("Your role doesn't include Fluxy AI in this workspace.", 'error');
            return;
        }
    }
    // Trial/payment access guard: Fluxy AI is locked for expired/payment-pending
    // users (opening to send a message). Fails open if state isn't loaded.
    if (state !== false && window.FluxyAccessGuard && !window.FluxyAccessGuard.requireAIUsage()) {
        return;
    }
    if (window.toggleAI) window.toggleAI(state);
    else console.warn("AI Chat not loaded yet");
};

/**
 * Shimmer Loading System
 */
/**
 * Centralized Table Paginator
 *
 * Usage:
 *   const paginator = window.createTablePaginator({
 *     pageSize: 10,
 *     label: 'bills',
 *     paginationId: 'bill-pagination',
 *     summaryId:    'bill-page-summary',
 *     indicatorId:  'bill-page-indicator',
 *     prevBtnId:    'bill-prev-page',
 *     nextBtnId:    'bill-next-page',
 *   });
 *
 *   paginator.setRows(rows, (visibleRows) => { /* render tbody *\/ });
 */
window.createTablePaginator = function({ pageSize = 20, label = 'records', paginationId, summaryId, indicatorId, prevBtnId, nextBtnId }) {
    let currentPage = 1;
    let rows = [];
    let renderFn = null;

    function _refresh() {
        const total = rows.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        currentPage = Math.min(Math.max(currentPage, 1), totalPages);
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const visible = rows.slice(start, end);

        const paginationEl = document.getElementById(paginationId);
        const summaryEl    = document.getElementById(summaryId);
        const indicatorEl  = document.getElementById(indicatorId);
        const prevBtn      = document.getElementById(prevBtnId);
        const nextBtn      = document.getElementById(nextBtnId);

        if (paginationEl) paginationEl.classList.toggle('hidden', total === 0);
        if (summaryEl) {
            summaryEl.textContent = total === 0
                ? `Showing 0 ${label}`
                : `Showing ${start + 1}–${end} of ${total} ${label}`;
        }
        if (indicatorEl) indicatorEl.textContent = `${currentPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages;

        if (renderFn) renderFn(visible);
    }

    document.getElementById(prevBtnId)?.addEventListener('click', () => { currentPage--; _refresh(); });
    document.getElementById(nextBtnId)?.addEventListener('click', () => { currentPage++; _refresh(); });

    return {
        setRows(newRows, fn) {
            rows = newRows || [];
            currentPage = 1;
            if (fn) renderFn = fn;
            _refresh();
        },
        refresh() { _refresh(); },
        // Jump to the page that contains the first row matching `predicate`,
        // then re-render so the row is actually in the DOM (e.g. so a caller
        // can scroll to / highlight it). Returns true when a match was paged to.
        goToRow(predicate) {
            if (typeof predicate !== 'function') return false;
            const idx = rows.findIndex(predicate);
            if (idx < 0) return false;
            currentPage = Math.floor(idx / pageSize) + 1;
            _refresh();
            return true;
        }
    };
};

window.renderShimmer = function(containerId, rowCount = 5) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const rows = Array(rowCount).fill(0).map(() => `
        <tr class="animate-pulse">
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-24"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-48"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-20"></div></td>
            <td class="px-6 py-4"><div class="h-4 bg-gray-200 rounded w-16"></div></td>
            <td class="px-6 py-4 text-right"><div class="h-4 bg-gray-200 rounded w-12 ml-auto"></div></td>
        </tr>
    `).join('');

    container.innerHTML = rows;
};

// ─── Chart Hover (Amplitude-style) ────────────────────────────────
// Wires crosshair + active-bar emphasis + a dark-navy tooltip card to any bar
// chart container. Required for every bar/column chart in the app — see
// docs/DESIGN_SYSTEM.md §4 Charts and docs/COMPONENT_GUIDE.md Recipe 7.
//
// Usage:
//   window.attachChartHover(chartEl, {
//       bars: '[data-chart-bar]',
//       orientation: 'vertical',         // 'vertical' | 'horizontal'
//       buildTooltip: (barEl, index) => '<html>'
//   });
//
// Idempotent — safe to call after every innerHTML re-render. Returns
// { destroy() } so callers can tear it down.
window.attachChartHover = function attachChartHover(container, options) {
    if (!container || !options) return { destroy() {} };
    const { bars: barSelector, buildTooltip, orientation = 'vertical' } = options;

    const bars = typeof barSelector === 'string'
        ? Array.from(container.querySelectorAll(barSelector))
        : Array.from(barSelector || []);
    if (bars.length === 0 || typeof buildTooltip !== 'function') {
        return { destroy() {} };
    }

    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    let tooltip = container.querySelector(':scope > .chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        container.appendChild(tooltip);
    }

    let crosshair = container.querySelector(':scope > .chart-crosshair');
    if (orientation === 'vertical') {
        if (!crosshair) {
            crosshair = document.createElement('div');
            crosshair.className = 'chart-crosshair';
            container.appendChild(crosshair);
        }
    } else if (crosshair) {
        crosshair.remove();
        crosshair = null;
    }

    let activeIndex = -1;

    function positionTooltip() {
        if (activeIndex < 0) return;
        const containerRect = container.getBoundingClientRect();
        const barRect = bars[activeIndex].getBoundingClientRect();
        const barCenterX = barRect.left + barRect.width / 2 - containerRect.left;

        if (crosshair) crosshair.style.left = `${barCenterX}px`;

        const tipRect = tooltip.getBoundingClientRect();
        let left = barCenterX - tipRect.width / 2;
        let top = barRect.top - containerRect.top - tipRect.height - 8;

        const padding = 4;
        if (left < padding) left = padding;
        if (left + tipRect.width > containerRect.width - padding) {
            left = Math.max(padding, containerRect.width - tipRect.width - padding);
        }
        // Never flip below the bar: chart axes / date captions / count labels
        // live there, so flipping would overlap them. If there is no room above,
        // clamp the tooltip to the container top — it may overlap the bar's top
        // portion for very tall bars, which is acceptable.
        if (top < padding) top = padding;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function setActive(index) {
        if (index === activeIndex) { positionTooltip(); return; }
        if (activeIndex >= 0) bars[activeIndex]?.classList.remove('chart-bar-active');
        activeIndex = index;

        if (index < 0) {
            tooltip.classList.remove('is-visible');
            if (crosshair) crosshair.classList.remove('is-visible');
            return;
        }

        bars[index].classList.add('chart-bar-active');
        tooltip.innerHTML = buildTooltip(bars[index], index);
        tooltip.classList.add('is-visible');
        if (crosshair) crosshair.classList.add('is-visible');
        positionTooltip();
    }

    function findBarIndex(clientX, clientY) {
        let best = -1;
        let bestDist = Infinity;
        for (let i = 0; i < bars.length; i++) {
            const rect = bars[i].getBoundingClientRect();
            const axis = orientation === 'horizontal'
                ? Math.abs((rect.top + rect.height / 2) - clientY)
                : Math.abs((rect.left + rect.width / 2) - clientX);
            if (axis < bestDist) { bestDist = axis; best = i; }
        }
        return best;
    }

    function onMove(event) {
        const rect = container.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) {
            setActive(-1);
            return;
        }
        setActive(findBarIndex(event.clientX, event.clientY));
    }

    function onLeave() { setActive(-1); }

    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);

    return {
        destroy() {
            container.removeEventListener('mousemove', onMove);
            container.removeEventListener('mouseleave', onLeave);
            tooltip?.remove();
            crosshair?.remove();
        }
    };
};

/**
 * Shared metric-info tooltip — single delegation handler for any
 * `<button class="metric-info" data-tooltip="...">?</button>` on the page.
 *
 * Reusable across the dashboard, budget page, and any future KPI surface.
 * Uses event delegation so dynamically-rendered cards work without any
 * wiring step from the caller. Markup contract:
 *
 *   <p class="metric-label">
 *       Main Budget
 *       <button type="button" class="metric-info"
 *           data-tooltip="The total amount you can spend during this period.">
 *           ?
 *       </button>
 *   </p>
 *
 * window.mountMetricInfoTooltips() is exposed as a no-op shim so existing
 * callers (e.g. dashboard.js) keep compiling after we centralise the logic.
 */
(function () {
    let tooltipNode = null;

    function ensureTooltip() {
        if (tooltipNode) return tooltipNode;
        tooltipNode = document.createElement('div');
        tooltipNode.className = 'metric-tooltip';
        tooltipNode.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipNode);
        return tooltipNode;
    }

    function hide() {
        if (!tooltipNode) return;
        tooltipNode.classList.remove('is-visible');
    }

    function show(button) {
        const copy = button.dataset.tooltip || '';
        if (!copy) return;
        const tip = ensureTooltip();
        tip.textContent = copy;
        tip.classList.add('is-visible');

        const buttonBox = button.getBoundingClientRect();
        const tipBox = tip.getBoundingClientRect();
        const margin = 12;
        const preferredLeft = buttonBox.left + buttonBox.width / 2 - tipBox.width / 2;
        const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - tipBox.width - margin));
        let top = buttonBox.bottom + 8;
        if (top + tipBox.height > window.innerHeight - margin) {
            top = Math.max(margin, buttonBox.top - tipBox.height - 8);
        }
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    function matchedButton(target) {
        return target?.closest?.('.metric-info[data-tooltip]') || null;
    }

    document.addEventListener('mouseover', (e) => {
        const btn = matchedButton(e.target);
        if (btn) show(btn);
    }, true);
    document.addEventListener('mouseout', (e) => {
        if (matchedButton(e.target)) hide();
    }, true);
    document.addEventListener('focusin', (e) => {
        const btn = matchedButton(e.target);
        if (btn) show(btn);
    });
    document.addEventListener('focusout', (e) => {
        if (matchedButton(e.target)) hide();
    });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    // No-op shim. The handler is global delegation, so no per-call mount
    // is required, but existing callers still resolve cleanly.
    window.mountMetricInfoTooltips = function () {};
})();

/**
 * Shared budget assignment drawer (Phase 2).
 *
 * Lazy-injected on first call so any app page can trigger it without
 * carrying the markup. Drives all three actions through one drawer:
 *
 *   window.FluxyBudgetAssignment.open({
 *       action: 'assign' | 'exclude' | 'restore',
 *       recordType: 'transactions' | 'bills',
 *       recordId: 'docId',
 *       vendor: 'AWS',
 *       amountText: 'Rp5.000.000',
 *       currentAllocationId: 'abc' | null,
 *       budgetId: 'budgetDocId',
 *       allocations: [{ id, name, scope_values }],
 *       onDone: () => {}
 *   })
 *
 * Loads DataService lazily and writes the record + audit log atomically.
 */
(function () {
    let ds = null;
    let mounted = false;
    let activeCtx = null;

    function ensureMounted() {
        if (mounted) return;
        const html = `
            <div id="fbx-assignment-backdrop" class="fixed inset-0 bg-black/50 z-[60] hidden"></div>
            <div id="fbx-assignment-drawer" class="fixed top-0 right-0 h-full w-full max-w-[420px] bg-white shadow-2xl z-[70] transform translate-x-full transition-transform duration-300 ease-in-out flex flex-col">
                <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Budget</p>
                        <h2 id="fbx-assignment-title" class="mt-1 text-[15px] font-bold text-gray-900">Change allocation</h2>
                    </div>
                    <button id="fbx-assignment-close" type="button" class="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="fbx-assignment-form" class="flex-1 flex flex-col overflow-hidden">
                    <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                        <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                            <p id="fbx-assignment-vendor" class="text-[13px] font-bold text-gray-900 truncate">—</p>
                            <p id="fbx-assignment-meta" class="mt-0.5 text-[12px] text-gray-500">—</p>
                        </div>
                        <div id="fbx-assignment-allocation-row">
                            <label for="fbx-assignment-allocation" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Allocation</label>
                            <select id="fbx-assignment-allocation" class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px]"></select>
                        </div>
                        <div>
                            <label for="fbx-assignment-reason" class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Reason <span class="text-[#EA580C]">*</span></label>
                            <textarea id="fbx-assignment-reason" rows="3" maxlength="500" required placeholder="Why is this record being updated?" class="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#EA580C] text-[13px] resize-none"></textarea>
                            <p class="mt-1 text-[11px] text-gray-400">Recorded in the audit log for traceability.</p>
                        </div>
                    </div>
                    <div class="px-6 py-4 border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
                        <button id="fbx-assignment-cancel" type="button" class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-[13px] font-medium hover:bg-gray-200 transition-colors">Cancel</button>
                        <button id="fbx-assignment-submit" type="submit" class="flex-1 px-4 py-2.5 bg-[#EA580C] text-white rounded-lg text-[13px] font-bold hover:bg-[#D94E0B] transition-colors disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed" disabled>Save</button>
                    </div>
                </form>
            </div>
        `;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

        const back = document.getElementById('fbx-assignment-backdrop');
        const closeBtn = document.getElementById('fbx-assignment-close');
        const cancelBtn = document.getElementById('fbx-assignment-cancel');
        const reasonEl = document.getElementById('fbx-assignment-reason');
        const allocEl = document.getElementById('fbx-assignment-allocation');
        const submitBtn = document.getElementById('fbx-assignment-submit');
        const form = document.getElementById('fbx-assignment-form');

        const close = () => closeDrawer();
        back.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        cancelBtn.addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !document.getElementById('fbx-assignment-drawer').classList.contains('translate-x-full')) {
                close();
            }
        });

        const validate = () => {
            const reason = reasonEl.value.trim();
            const needsAllocation = activeCtx && activeCtx.action === 'assign';
            const allocOk = !needsAllocation || (allocEl.value && allocEl.value.length > 0);
            submitBtn.disabled = !(reason.length > 0 && allocOk);
        };
        reasonEl.addEventListener('input', validate);
        allocEl.addEventListener('change', validate);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (submitBtn.disabled || !activeCtx) return;
            submitBtn.disabled = true;
            const originalLabel = submitBtn.textContent;
            submitBtn.textContent = 'Saving…';
            try {
                await commitAssignment(activeCtx, reasonEl.value.trim(), allocEl.value);
                window.showToast?.(actionToastMessage(activeCtx.action), 'success');
                const onDone = activeCtx.onDone;
                close();
                if (typeof onDone === 'function') onDone();
            } catch (err) {
                console.error('Budget assignment failed:', err);
                const friendly = String(err?.message || '').includes('permission-denied')
                    ? 'Permission denied. Try again or contact support.'
                    : (err?.message || 'Could not update the budget assignment.');
                window.showToast?.(friendly, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalLabel;
            }
        });

        mounted = true;
    }

    function actionToastMessage(action) {
        if (action === 'exclude') return 'Record excluded from budget.';
        if (action === 'restore') return 'Record restored to budget.';
        return 'Budget assignment updated.';
    }

    function closeDrawer() {
        const drawer = document.getElementById('fbx-assignment-drawer');
        const back = document.getElementById('fbx-assignment-backdrop');
        drawer?.classList.add('translate-x-full');
        back?.classList.add('hidden');
        activeCtx = null;
        // Release scroll lock only if no other drawer or modal still needs it.
        // The Budget detail drawer is the typical co-resident; checking its
        // open state by looking for its visible backdrop avoids a coupling
        // import. Other drawers (`#budget-drawer-backdrop`, `#bill-drawer-backdrop`)
        // get the same defensive check.
        const lockHolders = ['budget-drawer-backdrop', 'budget-detail-backdrop', 'bill-drawer-backdrop'];
        const anyOpen = lockHolders.some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
        if (!anyOpen) document.body.classList.remove('overflow-hidden');
    }

    async function loadDataService() {
        if (ds) return ds;
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const firebaseConfig = {
            apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
            authDomain: "fluxyos.com",
            projectId: "fluxyos",
            storageBucket: "fluxyos.firebasestorage.app",
            messagingSenderId: "1084252368929",
            appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
            measurementId: "G-ZN7J6DRD2L"
        };
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const auth = getAuth(app);
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        if (!auth.currentUser) throw new Error('Sign in required.');
        // Resolve the workspace before this shared component reads/writes finance
        // data, so an invited member targets the shared workspace instead of their
        // own empty workspaces/{uid} (which would 'permission-denied').
        try {
            const { resolveWorkspace } = await import('/assets/js/workspace-service.js');
            await resolveWorkspace(app, auth.currentUser);
        } catch (_) { /* best-effort; _scope falls back safely */ }
        const { default: DataService } = await import('/assets/js/db-service.js');
        ds = new DataService(app);
        ds._authUserId = auth.currentUser.uid;
        return ds;
    }

    async function commitAssignment(ctx, reason, allocationIdFromSelect) {
        const dataService = await loadDataService();
        const userId = dataService._authUserId;
        const payload = { reason, budgetId: ctx.budgetId };
        if (ctx.action === 'assign') {
            payload.allocationId = allocationIdFromSelect;
            if (ctx.recordType === 'transactions') {
                await dataService.updateTransactionBudgetAssignment(userId, ctx.recordId, payload);
            } else {
                await dataService.updateBillBudgetAssignment(userId, ctx.recordId, payload);
            }
        } else if (ctx.action === 'exclude') {
            if (ctx.recordType === 'transactions') {
                await dataService.excludeTransactionFromBudget(userId, ctx.recordId, payload);
            } else {
                await dataService.excludeBillFromBudget(userId, ctx.recordId, payload);
            }
        } else if (ctx.action === 'restore') {
            await dataService.restoreBudgetAssignment(userId, ctx.recordType, ctx.recordId, payload);
        } else {
            throw new Error('Unknown action: ' + ctx.action);
        }
    }

    window.FluxyBudgetAssignment = {
        open(ctx) {
            if (!ctx || !ctx.recordType || !ctx.recordId) {
                console.warn('FluxyBudgetAssignment.open requires recordType + recordId');
                return;
            }
            ensureMounted();
            activeCtx = ctx;

            const titleEl = document.getElementById('fbx-assignment-title');
            const vendorEl = document.getElementById('fbx-assignment-vendor');
            const metaEl = document.getElementById('fbx-assignment-meta');
            const allocRow = document.getElementById('fbx-assignment-allocation-row');
            const allocEl = document.getElementById('fbx-assignment-allocation');
            const reasonEl = document.getElementById('fbx-assignment-reason');
            const submitBtn = document.getElementById('fbx-assignment-submit');

            const titleMap = {
                assign: 'Change allocation',
                exclude: 'Exclude from budget',
                restore: 'Restore to budget'
            };
            titleEl.textContent = titleMap[ctx.action] || 'Update budget assignment';
            vendorEl.textContent = ctx.vendor || 'Record';
            metaEl.textContent = [ctx.recordType === 'bills' ? 'Bill' : 'Transaction', ctx.amountText || '']
                .filter(Boolean).join(' · ');

            // Allocation select is only meaningful for assign.
            allocRow.style.display = ctx.action === 'assign' ? '' : 'none';
            if (ctx.action === 'assign') {
                const opts = (ctx.allocations || [])
                    .filter(a => a.status !== 'archived')
                    .map(a => `<option value="${a.id}" ${a.id === ctx.currentAllocationId ? 'selected' : ''}>${a.name}</option>`);
                allocEl.innerHTML = `<option value="">Select an allocation…</option>` + opts.join('');
                if (ctx.currentAllocationId) allocEl.value = ctx.currentAllocationId;
            } else {
                allocEl.innerHTML = '';
            }

            reasonEl.value = '';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Save';

            document.getElementById('fbx-assignment-backdrop').classList.remove('hidden');
            requestAnimationFrame(() => {
                document.getElementById('fbx-assignment-drawer').classList.remove('translate-x-full');
                reasonEl.focus();
            });
            // Lock background scroll so the page underneath doesn't drift
            // while the user is filling out the assignment form.
            document.body.classList.add('overflow-hidden');
        },
        close: closeDrawer
    };
})();

/**
 * Shared notifications bell — opens a small dropdown anchored below the
 * button with two tabs: "Variance attention" and "Recent activity".
 *
 *   Variance: allocations on the active budget where status is at_risk
 *             or exceeded.
 *   Activity: the user's most recent budget audit logs (assignment,
 *             exclude, restore, create, allocations_updated).
 *
 * Auto-mounts on every app page by inserting a bell button immediately
 * to the LEFT of the Fluxy AI button. Lazy-loads DataService on first
 * open. Silently no-ops on pages without a Fluxy AI entry (e.g. login).
 *
 *   window.FluxyBudgetNotifications.refresh() — re-fetch + re-render
 *   window.FluxyBudgetNotifications.close()
 */
(function () {
    let injected = false;
    let activeTab = 'variance';
    let ds = null;
    let lastData = null;
    let loading = false;
    // A page (e.g. Tax Center) can contribute its own notification group — a
    // first tab with clickable, drill-downable items — via setPageGroup(). Shape:
    //   { id, tabLabel, title, emptyText, items: [{ key, severity, title, detail, onSelect }] }
    let pageGroup = null;
    let pageGroupInitialized = false;
    const SEV_CLASS = { critical: 'fluxy-status-danger', warning: 'fluxy-status-warning', info: 'fluxy-status-neutral' };

    function whenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    function findFluxyAIButton() {
        return document.querySelector('button[onclick*="toggleFluxyAI"], [data-tour-target="fluxy-ai-entry"]');
    }

    function injectBell() {
        if (injected) return;
        const fluxyBtn = findFluxyAIButton();
        if (!fluxyBtn || !fluxyBtn.parentElement) return;
        // Don't double-mount across re-renders.
        if (document.getElementById('fbx-notif-btn')) { injected = true; return; }

        const bellHtml = `
            <button id="fbx-notif-btn" type="button" aria-label="Open budget notifications" class="relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors shadow-sm active:scale-95">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <span id="fbx-notif-dot" class="hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#EA580C] ring-2 ring-white"></span>
            </button>
            <div id="fbx-notif-panel" class="hidden absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-32px)] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p id="fbx-notif-title" class="text-[13px] font-bold text-gray-900">Budget notifications</p>
                    <button id="fbx-notif-close" type="button" class="p-1 text-gray-400 hover:text-gray-700">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div id="fbx-notif-tabs" class="flex border-b border-gray-100">
                    <button id="fbx-notif-tab-variance" type="button" data-fbx-tab="variance" class="flex-1 px-3 py-2.5 text-[12px] font-bold text-[#EA580C] border-b-2 border-[#EA580C] transition-colors">
                        Variance attention <span id="fbx-notif-variance-count" class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-orange-50 text-[10px] font-bold text-[#EA580C] px-1 hidden">0</span>
                    </button>
                    <button id="fbx-notif-tab-activity" type="button" data-fbx-tab="activity" class="flex-1 px-3 py-2.5 text-[12px] font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-900 transition-colors">
                        Recent activity <span id="fbx-notif-activity-count" class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 px-1 hidden">0</span>
                    </button>
                </div>
                <div id="fbx-notif-body" class="max-h-[420px] overflow-y-auto">
                    <p class="px-4 py-8 text-[12px] text-gray-400 text-center">Loading notifications…</p>
                </div>
                <div id="fbx-notif-footer" class="px-4 py-2 border-t border-gray-100 bg-gray-50">
                    <a href="/budget" class="text-[12px] font-bold text-[#EA580C] hover:underline">Open Budgets →</a>
                </div>
            </div>
        `;
        // Wrap so the panel is positioned relative to the bell + the right
        // edge of the header. Insert as the immediate left sibling of the
        // Fluxy AI button.
        const wrapper = document.createElement('div');
        wrapper.id = 'fbx-notif-wrap';
        wrapper.className = 'relative inline-flex';
        wrapper.innerHTML = bellHtml;
        fluxyBtn.parentElement.insertBefore(wrapper, fluxyBtn);

        document.getElementById('fbx-notif-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
        });
        document.getElementById('fbx-notif-close').addEventListener('click', closePanel);
        document.getElementById('fbx-notif-tab-variance').addEventListener('click', () => switchTab('variance'));
        document.getElementById('fbx-notif-tab-activity').addEventListener('click', () => switchTab('activity'));

        // Close on outside click.
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('fbx-notif-panel');
            const wrap = document.getElementById('fbx-notif-wrap');
            if (!panel || panel.classList.contains('hidden')) return;
            if (!wrap?.contains(e.target)) closePanel();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePanel();
        });

        injected = true;
        applyPageGroup(); // render a page-contributed tab if one was registered pre-mount
        // Best-effort dot refresh on mount (so users see the indicator even
        // before opening the panel for the first time).
        refresh().catch(() => {});
    }

    // Insert/remove/refresh the page-contributed tab button (kept first, before
    // the budget Variance/Activity tabs) and update chrome (title, footer).
    function applyPageGroup() {
        const tabs = document.getElementById('fbx-notif-tabs');
        const titleEl = document.getElementById('fbx-notif-title');
        const footerEl = document.getElementById('fbx-notif-footer');
        if (!tabs) return;
        let tabBtn = document.getElementById('fbx-notif-tab-page');
        const count = pageGroup?.items?.length || 0;

        if (pageGroup) {
            if (!tabBtn) {
                tabBtn = document.createElement('button');
                tabBtn.id = 'fbx-notif-tab-page';
                tabBtn.type = 'button';
                tabBtn.setAttribute('data-fbx-tab', 'page');
                tabBtn.addEventListener('click', () => switchTab('page'));
                tabs.insertBefore(tabBtn, tabs.firstChild);
            }
            tabBtn.innerHTML = `${escapeHtmlSafe(pageGroup.tabLabel || 'Notifications')} <span id="fbx-notif-page-count" class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-orange-50 text-[10px] font-bold text-[#EA580C] px-1 ${count ? '' : 'hidden'}">${count}</span>`;
            if (titleEl && pageGroup.title) titleEl.textContent = pageGroup.title;
            // The budget footer link is out of context for a page group — hide it
            // while the page tab is active.
            if (footerEl) footerEl.classList.toggle('hidden', activeTab === 'page');
        } else {
            if (tabBtn) tabBtn.remove();
            if (titleEl) titleEl.textContent = 'Budget notifications';
            if (footerEl) footerEl.classList.remove('hidden');
        }
    }

    async function loadDS() {
        if (ds) return ds;
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const firebaseConfig = {
            apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
            authDomain: "fluxyos.com",
            projectId: "fluxyos",
            storageBucket: "fluxyos.firebasestorage.app",
            messagingSenderId: "1084252368929",
            appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
            measurementId: "G-ZN7J6DRD2L"
        };
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
        const auth = getAuth(app);
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        if (!auth.currentUser) throw new Error('Sign in required.');
        // Resolve the workspace before this shared component reads/writes finance
        // data, so an invited member targets the shared workspace instead of their
        // own empty workspaces/{uid} (which would 'permission-denied').
        try {
            const { resolveWorkspace } = await import('/assets/js/workspace-service.js');
            await resolveWorkspace(app, auth.currentUser);
        } catch (_) { /* best-effort; _scope falls back safely */ }
        const { default: DataService } = await import('/assets/js/db-service.js');
        ds = new DataService(app);
        ds._authUserId = auth.currentUser.uid;
        return ds;
    }

    async function refresh() {
        if (loading) return;
        loading = true;
        try {
            const svc = await loadDS();
            const userId = svc._authUserId;
            const activeBudget = await svc.getActiveBudget(userId);
            if (!activeBudget) {
                lastData = { variance: [], activity: [], hasBudget: false };
            } else {
                const usage = await svc.getBudgetUsage(userId, activeBudget.id);
                const variance = (usage.allocations || []).filter(a => a.status === 'at_risk' || a.status === 'exceeded');
                let activity = [];
                try {
                    activity = await svc.getBudgetActivityLogs(userId, activeBudget.id, 20);
                } catch (_) { activity = []; }
                lastData = { variance, activity, hasBudget: true, usage };
            }
            updateBadgeAndCounts();
            renderBody();
        } catch (err) {
            console.warn('Notifications refresh failed:', err);
            lastData = { variance: [], activity: [], hasBudget: false, error: err?.message };
            updateBadgeAndCounts();
            renderBody();
        } finally {
            loading = false;
        }
    }

    function updateBadgeAndCounts() {
        const dot = document.getElementById('fbx-notif-dot');
        const vCount = document.getElementById('fbx-notif-variance-count');
        const aCount = document.getElementById('fbx-notif-activity-count');
        const pCount = document.getElementById('fbx-notif-page-count');
        const variance = lastData?.variance?.length || 0;
        const activity = lastData?.activity?.length || 0;
        const pageCount = pageGroup?.items?.length || 0;
        // The dot means "something needs attention": budget variance OR a
        // page-contributed issue (e.g. Tax Center compliance).
        if (dot) dot.classList.toggle('hidden', variance === 0 && pageCount === 0);
        if (pCount) {
            pCount.textContent = String(pageCount);
            pCount.classList.toggle('hidden', pageCount === 0);
        }
        if (vCount) {
            vCount.textContent = String(variance);
            vCount.classList.toggle('hidden', variance === 0);
        }
        if (aCount) {
            aCount.textContent = String(activity);
            aCount.classList.toggle('hidden', activity === 0);
        }
    }

    function renderBody() {
        const body = document.getElementById('fbx-notif-body');
        if (!body) return;
        // Page-contributed tab (e.g. Tax Center compliance) is independent of the
        // budget data fetch, so render it first regardless of lastData.
        if (activeTab === 'page') {
            body.innerHTML = renderPageList(pageGroup);
            wirePageListClicks(body);
            return;
        }
        if (!lastData) {
            body.innerHTML = `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">Loading…</p>`;
            return;
        }
        if (!lastData.hasBudget) {
            body.innerHTML = `
                <div class="px-4 py-8 text-center">
                    <p class="text-[12px] text-gray-500">No active budget. <a href="/budget" class="text-[#EA580C] font-bold hover:underline">Create one →</a></p>
                </div>`;
            return;
        }
        body.innerHTML = activeTab === 'variance' ? renderVarianceList(lastData.variance) : renderActivityList(lastData.activity);
    }

    function renderPageList(group) {
        const items = group?.items || [];
        if (items.length === 0) {
            return `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">${escapeHtmlSafe(group?.emptyText || 'Nothing needs attention.')}</p>`;
        }
        return `<ul class="divide-y divide-gray-100">${items.map((it, i) => {
            const drillable = typeof it.onSelect === 'function';
            const chevron = drillable
                ? `<svg class="w-4 h-4 text-gray-300 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>`
                : '';
            return `
                <li>
                    <button type="button" data-fbx-page-idx="${i}" data-fbx-page-key="${escapeHtmlSafe(it.key || '')}"
                        class="w-full text-left px-4 py-3 flex items-start gap-2 transition-colors ${drillable ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'} focus:outline-none focus-visible:bg-gray-50"${drillable ? '' : ' tabindex="-1"'}>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-start justify-between gap-2">
                                <p class="text-[13px] font-semibold text-gray-900 truncate">${escapeHtmlSafe(it.title)}</p>
                                <span class="fluxy-table-status ${SEV_CLASS[it.severity] || 'fluxy-status-neutral'} shrink-0">${escapeHtmlSafe(it.severity || '')}</span>
                            </div>
                            <p class="mt-1 text-[11px] text-gray-500">${escapeHtmlSafe(it.detail || '')}</p>
                        </div>
                        ${chevron}
                    </button>
                </li>`;
        }).join('')}</ul>`;
    }

    function wirePageListClicks(body) {
        body.querySelectorAll('[data-fbx-page-idx]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-fbx-page-idx'));
                const item = pageGroup?.items?.[idx];
                if (item && typeof item.onSelect === 'function') {
                    closePanel();
                    try { item.onSelect(item); } catch (err) { console.warn('Notification drill-down failed:', err); }
                }
            });
        });
    }

    function renderVarianceList(allocations) {
        if (allocations.length === 0) {
            return `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">All allocations look healthy.</p>`;
        }
        const fmtRp = (n) => 'Rp' + Math.abs(Number(n) || 0).toLocaleString('id-ID');
        const fmtPct = (v) => Number.isFinite(v) ? (v >= 1000 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 1)) + '%' : '0%';
        return `<ul class="divide-y divide-gray-100">${allocations.map(a => {
            const isExceeded = a.status === 'exceeded';
            const cls = isExceeded ? 'text-red-700 bg-red-50 border-red-100' : 'text-orange-700 bg-orange-50 border-orange-100';
            const label = isExceeded ? 'Exceeded' : 'At risk';
            const detail = isExceeded
                ? `Over by ${fmtRp((a.actual_used + a.committed_amount) - a.allocated_amount)}`
                : `${fmtPct(a.usage_percent)} used · ${fmtRp(a.remaining_amount)} left`;
            return `
                <li class="px-4 py-3">
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-[13px] font-semibold text-gray-900 truncate">${escapeHtmlSafe(a.name)}</p>
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}">${label}</span>
                    </div>
                    <p class="mt-1 text-[11px] text-gray-500">${escapeHtmlSafe(detail)}</p>
                </li>`;
        }).join('')}</ul>`;
    }

    function renderActivityList(logs) {
        if (logs.length === 0) {
            return `<p class="px-4 py-8 text-[12px] text-gray-400 text-center">No budget activity yet.</p>`;
        }
        const map = {
            'budget_assignment.update': 'Allocation updated',
            'budget_assignment.exclude': 'Record excluded',
            'budget_assignment.restore': 'Record restored',
            'budget.created': 'Budget created',
            'budget.updated': 'Budget updated',
            'budget.allocations_updated': 'Allocations updated'
        };
        return `<ul class="divide-y divide-gray-100">${logs.map(log => {
            const when = log.created_at?.toDate?.();
            const whenText = when ? when.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
            const label = map[log.action] || String(log.action || '').replace(/_/g, ' ');
            return `
                <li class="px-4 py-3">
                    <p class="text-[12px] font-semibold text-gray-900">${escapeHtmlSafe(label)}</p>
                    <p class="mt-0.5 text-[11px] text-gray-500">${escapeHtmlSafe(whenText)}${log.reason ? ` · ${escapeHtmlSafe(log.reason)}` : ''}</p>
                </li>`;
        }).join('')}</ul>`;
    }

    function escapeHtmlSafe(s) {
        return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
    }

    function switchTab(tab) {
        activeTab = tab;
        const v = document.getElementById('fbx-notif-tab-variance');
        const a = document.getElementById('fbx-notif-tab-activity');
        const p = document.getElementById('fbx-notif-tab-page');
        const activeCls = 'text-[#EA580C] border-[#EA580C]';
        const inactiveCls = 'text-gray-500 border-transparent hover:text-gray-900';
        const base = 'flex-1 px-3 py-2.5 text-[12px] font-bold border-b-2 transition-colors';
        if (v) v.className = `${base} ${tab === 'variance' ? activeCls : inactiveCls}`;
        if (a) a.className = `${base} ${tab === 'activity' ? activeCls : inactiveCls}`;
        if (p) p.className = `${base} ${tab === 'page' ? activeCls : inactiveCls}`;
        // The budget footer link only makes sense on the budget tabs.
        const footerEl = document.getElementById('fbx-notif-footer');
        if (footerEl) footerEl.classList.toggle('hidden', tab === 'page');
        // Counts get re-appended on every render — preserve them.
        renderBody();
        // Re-add the badge spans so counts stay visible after className swap.
        updateBadgeAndCounts();
    }

    // Public: a page contributes/updates its own notification group. Passing null
    // or an empty item list clears it. Safe to call before the bell is injected.
    function setPageGroup(group) {
        const items = Array.isArray(group?.items) ? group.items : [];
        pageGroup = (group && items.length) ? { ...group, items } : null;
        // Default the panel to the page tab the first time a page registers a
        // non-empty group (so opening the bell on that page shows it first).
        if (pageGroup && !pageGroupInitialized) {
            activeTab = 'page';
            pageGroupInitialized = true;
        }
        if (pageGroup && activeTab === 'page') {
            // keep page tab active
        } else if (!pageGroup && activeTab === 'page') {
            activeTab = 'variance'; // fall back when the page group clears
        }
        if (!injected) return; // will be applied on injectBell()
        applyPageGroup();
        // Re-assert active-tab styling now that the page tab exists/was removed.
        switchTab(activeTab);
    }

    function openPanel() {
        const panel = document.getElementById('fbx-notif-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        if (!lastData) renderBody();
        refresh().catch(() => {});
    }
    function closePanel() {
        document.getElementById('fbx-notif-panel')?.classList.add('hidden');
    }
    function togglePanel() {
        const panel = document.getElementById('fbx-notif-panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) openPanel(); else closePanel();
    }

    // Auto-mount once the DOM has the Fluxy AI button. Retry briefly for
    // pages that build their header lazily.
    whenReady(() => {
        let tries = 0;
        const tick = () => {
            if (findFluxyAIButton()) { injectBell(); return; }
            if (++tries < 20) setTimeout(tick, 200);
        };
        tick();
    });

    window.FluxyBudgetNotifications = {
        refresh,
        close: closePanel,
        open: openPanel,
        setPageGroup
    };
})();
