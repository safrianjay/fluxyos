// =============================================================================
// FluxyOS — Account Picker (searchable, grouped Chart-of-Accounts combobox)
//
// FluxySelect (fluxy-select.js) enhances a native <select> but has NO search and
// ignores <optgroup>. The entry-drawer Account field needs both: a substring
// search over dozens of accounts and grouping (by SAK category) with a per-row
// account-type badge. This is that component.
//
// Contract mirrors the design system: white pill trigger + body-portaled menu
// (so a transformed drawer ancestor can't clip it), viewport-aware positioning,
// close on outside-click / Escape / resize, follow on scroll. The open menu also
// carries the `fluxy-select-menu` class so FluxyDrawer.mountBehavior's focus-trap
// whitelist lets it own the Tab key (see shared-dashboard.js).
//
// Backed by a hidden <input> as the value source, so reading `.value` and the
// `change` event work like any other field. Programmatic, NOT auto-enhancing —
// the drawer mounts it explicitly and updates it as Direction changes.
// =============================================================================
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    // SAK category → human group label (mirrors accounting.js SAK_LABELS). Used
    // for the group headers; falls back to the account type when absent.
    const SAK_LABELS = {
        cash_bank: 'Cash & Bank', accounts_receivable: 'Accounts Receivable',
        other_current_asset: 'Other Current Assets', inventory: 'Inventory',
        fixed_asset: 'Fixed Assets', accumulated_depreciation: 'Accumulated Depreciation',
        other_asset: 'Other Assets', accounts_payable: 'Accounts Payable',
        other_current_liability: 'Other Current Liabilities', long_term_liability: 'Long-term Liabilities',
        equity: 'Equity', revenue: 'Revenue', other_income: 'Other Income',
        cogs: 'Cost of Goods Sold', operating_expense: 'Operating Expenses', other_expense: 'Other Expenses'
    };
    const TYPE_LABEL = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };
    // Account types offered per money direction. Money out shows debit-side
    // categorizing accounts (expense + asset/liability/equity — e.g. buying an
    // asset, paying down a liability, an owner drawing); money in shows credit-side
    // ones (revenue + liability/equity). Broad enough that any user-created account
    // is findable, so a custom account is never hidden. `null` direction = all.
    const DIRECTION_TYPES = { in: ['revenue', 'liability', 'equity'], out: ['expense', 'asset', 'liability', 'equity'] };

    // `types` — an EXPLICIT allow-list, which takes precedence over `direction`.
    //
    // Direction is the right filter for a field that just asks "which account
    // does this affect", because money in really can credit a liability or
    // equity. It is the wrong filter for a field that NAMES a type: the item
    // drawer's "Revenue account" was offering 3200 Owner Drawings and 2800
    // Suspense, which is a control that permits a nonsense answer
    // (DESIGN_SYSTEM 3c).
    //
    // The allow-list is by TYPE, never by sak_category, on purpose: narrowing
    // "Revenue account" to sak_category 'revenue' would hide 7100 Interest
    // Income, which is a perfectly good revenue account. Type keeps every
    // user-created account in the right family findable while removing the ones
    // that could never be the answer.

    let openInstance = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Whether an account can be picked as a categorizing account: active, and not a
    // structural account the posting engine owns (Cash, A/R, A/P, Retained
    // Earnings, opening equity, tax control). The Direction type filter narrows
    // further.
    //
    // `allow_direct_transaction === false` is the real control — coding a
    // transaction straight to A/R or A/P bypasses the invoice/bill subledger and
    // breaks the tie between the aging report and the balance sheet. The flag
    // arrives via DataService._withAccountPolicy, which overlays it onto Firestore
    // rows; absent = permitted, so user-created accounts are never hidden.
    //
    // The old test was `is_system && mappable === false`, which conflated two
    // different questions. `mappable` means "auto-mapping TARGET", and an account
    // can legitimately be a bad auto-mapping target while still being hand-
    // codeable — 2800 Suspense is exactly that: nothing should ever be auto-mapped
    // to it, but parking an unidentified bank receipt there is the whole point.
    // Deciding pickability from `mappable` would have hidden it.
    function isSelectable(a) {
        if (!a) return false;
        if (a.is_active === false) return false;
        if (a.allow_direct_transaction === false) return false;
        return true;
    }

    function AccountPickerInstance(container, opts) {
        const o = opts || {};
        let accounts = Array.isArray(o.accounts) ? o.accounts.slice() : [];
        let direction = o.direction || null;              // 'in' | 'out' | null
        // Explicit type allow-list; beats `direction` when given.
        let types = Array.isArray(o.types) && o.types.length ? o.types.slice() : null;
        let value = o.value || '';
        const onChange = typeof o.onChange === 'function' ? o.onChange : null;
        const onCreate = typeof o.onCreateAccount === 'function' ? o.onCreateAccount : null;
        const placeholder = o.placeholder || 'Select an account';

        container.classList.add('fluxy-acct');
        container.innerHTML = '';

        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        if (o.name) hidden.name = o.name;
        hidden.value = value;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'fluxy-select-trigger fluxy-acct-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML =
            '<span class="fluxy-acct-triglabel"></span>' +
            '<svg class="fluxy-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>';
        const trigLabel = trigger.querySelector('.fluxy-acct-triglabel');

        const menu = document.createElement('div');
        // `fluxy-select-menu` so the drawer focus-trap whitelist lets it own Tab.
        menu.className = 'fluxy-select-menu fluxy-acct-menu';
        menu.setAttribute('role', 'listbox');
        menu.tabIndex = -1;

        container.appendChild(hidden);
        container.appendChild(trigger);

        const instance = { container, trigger, menu, close, positionMenu, refresh: renderTrigger, setDirection, setTypes, setAccounts, setValue, getValue, getAccount, destroy };

        function accountByCode(code) { return accounts.find((a) => String(a.code) === String(code)) || null; }

        function renderTrigger() {
            const a = accountByCode(value);
            if (a) {
                trigLabel.innerHTML = '<span class="fluxy-acct-code">' + esc(a.code) + '</span> · ' + esc(a.name) +
                    ' ' + badgeHtml(a.type);
                trigger.classList.remove('is-placeholder');
            } else {
                trigLabel.textContent = placeholder;
                trigger.classList.add('is-placeholder');
            }
        }

        function badgeHtml(type) {
            const label = TYPE_LABEL[type] || type || '';
            return '<span class="fluxy-acct-badge" data-type="' + esc(type) + '">' + esc(label) + '</span>';
        }

        // The visible, direction-filtered, sorted account set.
        function visibleAccounts() {
            const allowed = (types && types.length)
                ? types
                : (direction && DIRECTION_TYPES[direction] ? DIRECTION_TYPES[direction] : null);
            return accounts
                .filter(isSelectable)
                .filter((a) => !allowed || allowed.indexOf(a.type) !== -1)
                .sort((a, b) => String(a.code).localeCompare(String(b.code)));
        }

        function buildGroups(term) {
            const q = String(term || '').trim().toLowerCase();
            const match = (a) => !q
                || String(a.code).toLowerCase().indexOf(q) !== -1
                || String(a.name).toLowerCase().indexOf(q) !== -1
                || String(a.name_id || '').toLowerCase().indexOf(q) !== -1;
            const vis = visibleAccounts().filter(match);
            const groups = [];
            // Grouped by SAK category (or type when absent), stable code order.
            const byCat = {};
            vis.forEach((a) => {
                const key = a.sak_category || a.type || 'other';
                (byCat[key] = byCat[key] || []).push(a);
            });
            Object.keys(byCat).sort().forEach((key) => {
                groups.push({ label: SAK_LABELS[key] || TYPE_LABEL[byCat[key][0].type] || key, accounts: byCat[key] });
            });
            return { groups, total: vis.length };
        }

        function renderMenu(term) {
            const { groups, total } = buildGroups(term);
            let html = '<div class="fluxy-acct-searchwrap">' +
                '<input type="text" class="fluxy-acct-search" role="combobox" aria-autocomplete="list" ' +
                'placeholder="Search code or name…" value="' + esc(term || '') + '" />' +
                '</div><div class="fluxy-acct-list" role="presentation">';
            if (!total) {
                html += '<div class="fluxy-acct-empty">No account matches' +
                    (onCreate ? ' — <button type="button" class="fluxy-acct-create">Create account</button>' : '') +
                    '</div>';
            } else {
                groups.forEach((g) => {
                    html += '<div class="fluxy-acct-group-label">' + esc(g.label) + '</div>';
                    g.accounts.forEach((a) => {
                        const selected = String(a.code) === String(value);
                        html += '<button type="button" role="option" class="fluxy-acct-option" ' +
                            'data-code="' + esc(a.code) + '" aria-selected="' + (selected ? 'true' : 'false') + '">' +
                            '<span class="fluxy-acct-optmain"><span class="fluxy-acct-code">' + esc(a.code) + '</span>' +
                            '<span class="fluxy-acct-name">' + esc(a.name) + '</span></span>' +
                            badgeHtml(a.type) +
                            '<svg class="fluxy-select-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m5 13 4 4 10-12"/></svg>' +
                            '</button>';
                    });
                });
            }
            html += '</div>';
            menu.innerHTML = html;
        }

        function positionMenu() {
            const rect = trigger.getBoundingClientRect();
            const gap = 6;
            const margin = 12;
            menu.style.maxHeight = '';
            const menuH = Math.min(menu.scrollHeight, 360);
            const spaceBelow = window.innerHeight - rect.bottom - margin;
            const spaceAbove = rect.top - margin;
            const flipUp = spaceBelow < menuH && spaceAbove > spaceBelow;
            const availH = Math.max(160, flipUp ? spaceAbove : spaceBelow);
            menu.style.maxHeight = Math.min(menuH, availH) + 'px';
            const menuW = Math.max(rect.width, menu.offsetWidth || rect.width);
            const maxLeft = Math.max(margin, window.innerWidth - menuW - margin);
            const left = Math.min(Math.max(margin, rect.left), maxLeft);
            const top = flipUp
                ? Math.max(margin, rect.top - gap - Math.min(menuH, availH))
                : rect.bottom + gap;
            menu.dataset.flip = flipUp ? 'true' : 'false';
            menu.style.setProperty('--fluxy-select-menu-top', Math.round(top) + 'px');
            menu.style.setProperty('--fluxy-select-menu-left', Math.round(left) + 'px');
            menu.style.setProperty('--fluxy-select-menu-width', Math.round(rect.width) + 'px');
        }

        function open() {
            if (openInstance && openInstance !== instance) openInstance.close();
            renderMenu('');
            document.body.appendChild(menu);
            menu.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            openInstance = instance;
            positionMenu();
            window.requestAnimationFrame(() => {
                positionMenu();
                const s = menu.querySelector('.fluxy-acct-search');
                s && s.focus();
            });
        }

        function close() {
            menu.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            if (menu.parentNode) menu.parentNode.removeChild(menu);
            if (openInstance === instance) openInstance = null;
        }

        function choose(code) {
            const a = accountByCode(code);
            if (!a) return;
            value = String(a.code);
            hidden.value = value;
            renderTrigger();
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
            if (onChange) onChange(value, a);
        }

        function currentOptions() { return Array.from(menu.querySelectorAll('.fluxy-acct-option')); }

        trigger.addEventListener('click', (e) => { e.stopPropagation(); if (menu.classList.contains('is-open')) close(); else open(); });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        menu.addEventListener('input', (e) => {
            if (!e.target.classList.contains('fluxy-acct-search')) return;
            const term = e.target.value;
            renderMenu(term);
            positionMenu();
            const s = menu.querySelector('.fluxy-acct-search');
            if (s) { s.focus(); s.value = term; s.setSelectionRange(term.length, term.length); }
        });

        menu.addEventListener('click', (e) => {
            const opt = e.target.closest('.fluxy-acct-option');
            if (opt) { e.stopPropagation(); choose(opt.dataset.code); close(); trigger.focus(); return; }
            if (e.target.closest('.fluxy-acct-create') && onCreate) { e.stopPropagation(); close(); onCreate(); }
        });

        menu.addEventListener('keydown', (e) => {
            const items = currentOptions();
            const active = document.activeElement;
            const inSearch = active && active.classList.contains('fluxy-acct-search');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (inSearch) { items[0] && items[0].focus(); }
                else { const i = items.indexOf(active); (items[Math.min(i + 1, items.length - 1)] || items[0])?.focus(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const i = items.indexOf(active);
                if (i <= 0) { menu.querySelector('.fluxy-acct-search')?.focus(); }
                else items[i - 1].focus();
            } else if (e.key === 'Enter') {
                if (!inSearch && active && active.classList.contains('fluxy-acct-option')) { e.preventDefault(); active.click(); }
                else if (inSearch && items.length === 1) { e.preventDefault(); items[0].click(); }
            } else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
            else if (e.key === 'Tab') { close(); }
        });

        // --- public controller methods ---
        function setDirection(dir) { direction = dir || null; if (menu.classList.contains('is-open')) { renderMenu(''); positionMenu(); } }
        function setTypes(next) { types = Array.isArray(next) && next.length ? next.slice() : null; if (menu.classList.contains('is-open')) { renderMenu(''); positionMenu(); } }
        function setAccounts(list) { accounts = Array.isArray(list) ? list.slice() : []; renderTrigger(); if (menu.classList.contains('is-open')) renderMenu(''); }
        function setValue(code) { value = code == null ? '' : String(code); hidden.value = value; renderTrigger(); }
        function getValue() { return value; }
        function getAccount() { return accountByCode(value); }
        function destroy() { close(); trigger.remove(); hidden.remove(); }

        renderTrigger();
        return instance;
    }

    // Global dismiss + reposition (mirrors FluxySelect).
    document.addEventListener('click', (e) => {
        if (openInstance && !openInstance.container.contains(e.target) && !openInstance.menu.contains(e.target)) openInstance.close();
    });
    window.addEventListener('scroll', () => { if (openInstance) openInstance.positionMenu(); }, true);
    window.addEventListener('resize', () => { if (openInstance) openInstance.close(); });

    window.FluxyAccountPicker = {
        // Mount a picker inside `container`. Returns a controller (getValue,
        // getAccount, setValue, setDirection, setAccounts, refresh, destroy).
        mount(container, opts) {
            if (!container) return null;
            try { return AccountPickerInstance(container, opts || {}); }
            catch (e) { console.warn('FluxyAccountPicker: mount failed', e); return null; }
        }
    };
})();
