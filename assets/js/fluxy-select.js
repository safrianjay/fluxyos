/* ────────────────────────────────────────────────────────────────────
   FluxySelect — shared custom dropdown for authenticated app pages.

   Progressively enhances native <select> elements into the FluxyOS custom
   dropdown (clean chevron, consistent styling, viewport-aware positioning)
   while keeping the native <select> as the source of truth: its value and
   `change` event keep working, so existing page/form logic is untouched.

   - Auto-enhances every <select> on load and any added later (modals,
     drawers) via a MutationObserver.
   - Opt out with `data-no-fluxy-select`, `multiple`, or `size > 1`.
   - Stays in sync when options or `.value` are changed programmatically.

   Styling lives in `assets/css/shared-dashboard.css` (.fluxy-select*).
   ──────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';
    if (window.FluxySelect) return;

    const ENHANCED = 'data-fluxy-enhanced';
    let openInstance = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function labelTextFor(select) {
        if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
        if (select.id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
            if (lbl) return lbl.textContent.trim();
        }
        const wrapLbl = select.closest('label');
        if (wrapLbl) return wrapLbl.textContent.trim();
        return 'Select option';
    }

    function shouldSkip(select) {
        return select.multiple
            || (select.size && select.size > 1)
            || select.hasAttribute('data-no-fluxy-select')
            || select.hasAttribute(ENHANCED);
    }

    function FluxySelectInstance(select) {
        const ariaLabel = labelTextFor(select);

        const wrap = document.createElement('div');
        wrap.className = 'fluxy-select fluxy-select--enhanced';
        if (select.disabled) wrap.dataset.disabled = 'true';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'fluxy-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', ariaLabel);
        if (select.disabled) trigger.disabled = true;
        trigger.innerHTML =
            '<span class="fluxy-select-label"></span>' +
            '<svg class="fluxy-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>';

        const menu = document.createElement('div');
        menu.className = 'fluxy-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.tabIndex = -1;

        const labelEl = trigger.querySelector('.fluxy-select-label');

        // Insert wrapper right after the native select, then move the
        // (visually hidden) native select inside it so they travel together.
        select.classList.add('fluxy-select-native');
        select.setAttribute(ENHANCED, 'true');
        select.parentNode.insertBefore(wrap, select.nextSibling);
        wrap.appendChild(select);
        wrap.appendChild(trigger);
        wrap.appendChild(menu);

        const instance = { wrap, trigger, menu, select, close, syncFromSelect, positionMenu };

        function buildMenu() {
            const opts = Array.from(select.options);
            menu.innerHTML = opts.map((o, i) =>
                `<button type="button" role="option" class="fluxy-select-option" data-index="${i}"${o.disabled ? ' disabled' : ''}>` +
                `<span>${esc(o.textContent)}</span>` +
                '<svg class="fluxy-select-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m5 13 4 4 10-12"/></svg>' +
                '</button>'
            ).join('');
        }

        function syncFromSelect() {
            const sel = select.options[select.selectedIndex];
            labelEl.textContent = sel ? sel.textContent : '';
            wrap.dataset.disabled = select.disabled ? 'true' : 'false';
            trigger.disabled = !!select.disabled;
            menu.querySelectorAll('.fluxy-select-option').forEach((el) => {
                el.setAttribute('aria-selected', Number(el.dataset.index) === select.selectedIndex ? 'true' : 'false');
            });
        }

        function choose(index) {
            const opt = select.options[index];
            if (!opt || opt.disabled) return;
            if (select.selectedIndex !== index) {
                select.selectedIndex = index;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncFromSelect();
        }

        function positionMenu() {
            const rect = trigger.getBoundingClientRect();
            const gap = 6;
            const margin = 12;
            // measure natural menu size
            menu.style.maxHeight = '';
            const menuH = Math.min(menu.scrollHeight, 320);
            const spaceBelow = window.innerHeight - rect.bottom - margin;
            const spaceAbove = rect.top - margin;
            const flipUp = spaceBelow < menuH && spaceAbove > spaceBelow;
            const availH = Math.max(120, flipUp ? spaceAbove : spaceBelow);
            menu.style.maxHeight = Math.min(menuH, availH) + 'px';

            const menuW = Math.max(rect.width, menu.offsetWidth || rect.width);
            const maxLeft = Math.max(margin, window.innerWidth - menuW - margin);
            const left = Math.min(Math.max(margin, rect.left), maxLeft);
            const top = flipUp
                ? Math.max(margin, rect.top - gap - Math.min(menuH, availH))
                : rect.bottom + gap;
            wrap.dataset.flip = flipUp ? 'true' : 'false';
            menu.style.setProperty('--fluxy-select-menu-top', Math.round(top) + 'px');
            menu.style.setProperty('--fluxy-select-menu-left', Math.round(left) + 'px');
            menu.style.setProperty('--fluxy-select-menu-width', Math.round(rect.width) + 'px');
        }

        function open() {
            if (select.disabled) return;
            if (openInstance && openInstance !== instance) openInstance.close();
            buildMenu();
            syncFromSelect();
            // Portal the menu to <body> so a transformed ancestor (slide-in
            // drawers/modals) can't break its position:fixed coordinates.
            document.body.appendChild(menu);
            menu.classList.add('is-open');
            wrap.dataset.open = 'true';
            trigger.setAttribute('aria-expanded', 'true');
            openInstance = instance;
            positionMenu();
            requestAnimationFrame(positionMenu);
            const sel = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.fluxy-select-option:not([disabled])');
            sel && sel.focus();
        }

        function close() {
            wrap.dataset.open = 'false';
            wrap.dataset.flip = 'false';
            menu.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            if (menu.parentNode !== wrap) wrap.appendChild(menu); // un-portal
            if (openInstance === instance) openInstance = null;
        }

        function toggle() {
            if (wrap.dataset.open === 'true') close(); else open();
        }

        trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        menu.addEventListener('click', (e) => {
            const optEl = e.target.closest('.fluxy-select-option');
            if (!optEl || optEl.disabled) return;
            e.stopPropagation();
            choose(Number(optEl.dataset.index));
            close();
            trigger.focus();
        });

        menu.addEventListener('keydown', (e) => {
            const items = Array.from(menu.querySelectorAll('.fluxy-select-option:not([disabled])'));
            const idx = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); (items[Math.min(idx + 1, items.length - 1)] || items[0])?.focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (items[Math.max(idx - 1, 0)])?.focus(); }
            else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
            else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
            else if (e.key === 'Tab') { close(); }
        });

        // Rebuild when options change; resync when fired programmatically.
        const mo = new MutationObserver(() => { buildMenu(); syncFromSelect(); });
        mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        select.addEventListener('change', syncFromSelect);

        // Catch programmatic `select.value = ...` (no change event) by
        // wrapping the element's value setter on top of the prototype.
        try {
            const proto = Object.getPrototypeOf(select);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.configurable && desc.set && desc.get) {
                Object.defineProperty(select, 'value', {
                    configurable: true,
                    get() { return desc.get.call(this); },
                    set(v) { desc.set.call(this, v); syncFromSelect(); }
                });
            }
        } catch (_) { /* non-fatal: label resyncs on change/open */ }

        buildMenu();
        syncFromSelect();
        return instance;
    }

    function enhance(select) {
        if (!select || select.tagName !== 'SELECT' || shouldSkip(select)) return null;
        try { return FluxySelectInstance(select); }
        catch (e) { console.warn('FluxySelect: enhance failed', e); return null; }
    }

    function enhanceAll(root) {
        (root || document).querySelectorAll('select').forEach(enhance);
    }

    // Global dismiss + reposition behavior.
    document.addEventListener('click', (e) => {
        if (openInstance
            && !openInstance.wrap.contains(e.target)
            && !openInstance.menu.contains(e.target)) openInstance.close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openInstance) openInstance.close();
    });
    // Follow the trigger on scroll (don't close), close only on resize.
    window.addEventListener('scroll', () => {
        if (openInstance) openInstance.positionMenu();
    }, true);
    window.addEventListener('resize', () => { if (openInstance) openInstance.close(); });

    // Auto-enhance dynamically added selects (modals, drawers).
    function watch() {
        const mo = new MutationObserver((muts) => {
            for (const m of muts) {
                m.addedNodes.forEach((n) => {
                    if (n.nodeType !== 1) return;
                    if (n.tagName === 'SELECT') enhance(n);
                    else if (n.querySelectorAll) n.querySelectorAll('select').forEach(enhance);
                });
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        enhanceAll(document);
        watch();
    }

    window.FluxySelect = { enhance, enhanceAll, init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
