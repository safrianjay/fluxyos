// =============================================================================
// FluxyOS — Integration Center page controller (integration.html)
//
// Live-binds the Commerce cards to workspace commerce_accounts (Phase 1
// DataService accessors) and wires connect / sync-now / disconnect to the
// Phase 3 backend contract (/api/v1/commerce/*). Until that backend deploys,
// actions surface a "coming soon" toast on 404/503 — the UI ships wired to
// the final contract. See docs/COMMERCE_INTEGRATION_PHASE0_REVIEW.md (D3, §6).
//
// Role gating: connect/disconnect/sync/auto_post need 'integrations.manage'
// (owner/admin). Everyone else sees read-only cards + a notice banner.
// All user-facing strings are keyed in dashboard-i18n.js (pair-edit rule);
// injected DOM is translated by its MutationObserver, programmatic strings
// go through t().
// =============================================================================

import { can } from '/assets/js/perms-service.js';

const API_BASE = '/api/v1/commerce';

// Card metadata for the Phase-1 commerce platforms. `id` must equal the
// backend registry key and the commerce_accounts.platform value.
const COMMERCE_PLATFORMS = [
    {
        id: 'tiktok_shop',
        name: 'TikTok Shop',
        description: 'Sync orders, revenue, fees, and settlements from TikTok Shop.',
        initials: 'TT',
        logoClass: 'bg-gray-900 text-white',
    },
    {
        id: 'shopee',
        name: 'Shopee',
        description: 'Sync orders, escrow, fees, and payouts from Shopee.',
        initials: 'SP',
        logoClass: 'bg-orange-50 text-[#EA580C] border border-orange-100',
    },
    {
        id: 'tokopedia',
        name: 'Tokopedia',
        description: 'Sync orders, revenue, and settlements from Tokopedia.',
        initials: 'TP',
        logoClass: 'bg-green-50 text-green-700 border border-green-100',
    },
];

const STATUS_PILLS = {
    connected:    { label: 'Connected',     cls: 'bg-green-50 text-green-700 border-green-100' },
    connecting:   { label: 'Connecting…',   cls: 'bg-blue-50 text-blue-700 border-blue-100' },
    expired:      { label: 'Expired',       cls: 'bg-amber-50 text-amber-700 border-amber-100' },
    error:        { label: 'Sync error',    cls: 'bg-red-50 text-red-600 border-red-100' },
    disconnected: { label: 'Not connected', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

const HEALTH_DOTS = {
    healthy: 'bg-green-500',
    degraded: 'bg-amber-500',
    failing: 'bg-red-500',
};

const JOB_TYPE_LABELS = {
    initial: 'Initial import',
    incremental: 'Incremental',
    manual: 'Manual',
    webhook: 'Webhook',
    reconcile: 'Reconciliation',
};
const JOB_STATUS_LABELS = {
    pending: 'Pending',
    processing: 'Processing',
    done: 'Done',
    failed: 'Failed',
    dead: 'Stopped',
};

function t(key) {
    return (window.FluxyI18n && window.FluxyI18n.t) ? window.FluxyI18n.t(key) : key;
}

function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (v instanceof Date) return v;
    return null;
}

function formatDateTime(v) {
    const d = toDate(v);
    if (!d) return null;
    const locale = (window.FluxyI18n && window.FluxyI18n.locale) ? window.FluxyI18n.locale() : 'en-US';
    return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function initIntegrationPage({ ds, user }) {
    ds.setActor(user.uid);
    const role = (window.FluxyWorkspace && window.FluxyWorkspace.role) || 'owner';
    const canManage = can(role, 'integrations.manage');

    const state = {
        accounts: new Map(), // platform id -> account doc (first account per platform for Phase 1 single-store UI)
        drawerAccountId: null,
        drawerPlatform: null,
    };

    if (!canManage) {
        document.getElementById('integration-readonly-banner')?.classList.remove('hidden');
    }

    initTabs();
    initDrawerChrome();
    handleCallbackParams();

    // Live cards: first snapshot replaces the skeletons; later snapshots
    // re-render in place (server-side status changes appear without reload).
    ds.watchCommerceAccounts(user.uid, (accounts) => {
        state.accounts = new Map();
        (accounts || []).forEach((acc) => {
            if (acc.status === 'disconnected') return;
            if (!state.accounts.has(acc.platform)) state.accounts.set(acc.platform, acc);
        });
        renderCommerceGrid();
        if (state.drawerAccountId) refreshDrawerFromState();
    });
    // If the first snapshot never arrives (rules not deployed / offline), the
    // watcher only warns — render the default "Not connected" cards anyway.
    setTimeout(() => {
        if (document.querySelector('[data-commerce-skeleton]')) renderCommerceGrid();
    }, 4000);

    // ------------------------------------------------------------------ tabs
    function initTabs() {
        const tabs = document.getElementById('integration-tabs');
        tabs?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-category]');
            if (!btn) return;
            tabs.querySelectorAll('[data-category]').forEach((b) => {
                const active = b === btn;
                b.setAttribute('aria-selected', String(active));
                b.classList.toggle('bg-white', active);
                b.classList.toggle('text-gray-900', active);
                b.classList.toggle('shadow-sm', active);
                b.classList.toggle('border', active);
                b.classList.toggle('border-gray-200', active);
                b.classList.toggle('text-gray-500', !active);
            });
            document.querySelectorAll('[data-category-panel]').forEach((panel) => {
                panel.classList.toggle('hidden', panel.getAttribute('data-category-panel') !== btn.getAttribute('data-category'));
            });
        });
    }

    // ----------------------------------------------------------------- cards
    function renderCommerceGrid() {
        const grid = document.getElementById('commerce-grid');
        if (!grid) return;
        const connectedCount = state.accounts.size;
        document.getElementById('commerce-hint')?.classList.toggle('hidden', connectedCount > 0);

        grid.innerHTML = '';
        COMMERCE_PLATFORMS.forEach((platform) => {
            grid.appendChild(renderPlatformCard(platform, state.accounts.get(platform.id) || null));
        });
    }

    function renderPlatformCard(platform, account) {
        const card = document.createElement('div');
        card.className = 'bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col';
        card.setAttribute('data-platform-card', platform.id);

        const status = account ? (account.status || 'connected') : 'disconnected';
        const pill = STATUS_PILLS[status] || STATUS_PILLS.disconnected;
        const lastSync = account ? formatDateTime(account.last_sync_at) : null;
        const health = account && account.sync_health ? HEALTH_DOTS[account.sync_health] : null;

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-3';
        header.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center text-[12px] font-bold ${platform.logoClass}">${platform.initials}</div>
                <div class="min-w-0">
                    <h3 class="text-[14px] font-semibold text-gray-900 truncate">${platform.name}</h3>
                    ${account && account.shop_name ? `<p class="text-[12px] text-gray-400 truncate">${escapeHtml(account.shop_name)}</p>` : ''}
                </div>
            </div>
            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] border rounded-full px-2.5 py-1 ${pill.cls}">
                ${health ? `<span class="w-1.5 h-1.5 rounded-full ${health}"></span>` : ''}${pill.label}
            </span>`;
        card.appendChild(header);

        const desc = document.createElement('p');
        desc.className = 'mt-3 text-[12px] text-gray-500';
        desc.textContent = platform.description;
        card.appendChild(desc);

        const meta = document.createElement('p');
        meta.className = 'mt-2 text-[12px] text-gray-400 tabular-nums';
        meta.textContent = account
            ? (lastSync ? `${t('Last sync')}: ${lastSync}` : t('Never synced'))
            : '';
        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'mt-4 pt-1 flex items-center gap-2 mt-auto';
        if (!account) {
            if (canManage) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.setAttribute('data-action', 'connect-integration');
                btn.className = 'w-full py-2 bg-gray-900 text-white rounded-lg text-[14px] font-bold hover:bg-gray-800 transition-colors';
                btn.textContent = t('Connect');
                btn.addEventListener('click', () => connectPlatform(platform, btn));
                actions.appendChild(btn);
            } else {
                const note = document.createElement('p');
                note.className = 'w-full text-center py-2 text-[12px] text-gray-400 bg-gray-50 border border-gray-200 rounded-lg';
                note.textContent = t('Not connected');
                actions.appendChild(note);
            }
        } else {
            if (canManage) {
                const syncBtn = document.createElement('button');
                syncBtn.type = 'button';
                syncBtn.className = 'flex-1 py-2 bg-white border border-gray-200 rounded-lg text-[14px] font-bold text-gray-600 hover:bg-gray-50 transition-colors';
                syncBtn.textContent = t('Sync now');
                syncBtn.addEventListener('click', () => syncNow(platform, account, syncBtn));
                actions.appendChild(syncBtn);
            }
            const manageBtn = document.createElement('button');
            manageBtn.type = 'button';
            manageBtn.className = 'flex-1 py-2 bg-white border border-gray-200 rounded-lg text-[14px] font-bold text-gray-600 hover:bg-gray-50 transition-colors';
            manageBtn.textContent = t('Manage');
            manageBtn.addEventListener('click', () => openDrawer(platform, account));
            actions.appendChild(manageBtn);
        }
        card.appendChild(actions);
        return card;
    }

    // --------------------------------------------------------------- actions
    async function api(path, body) {
        const token = await user.getIdToken();
        const workspaceId = (window.FluxyWorkspace && window.FluxyWorkspace.id) || user.uid;
        return fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ workspace_id: workspaceId, ...body }),
        });
    }

    function backendNotLive(res) {
        // 404 (redirect/function not deployed) or 503 (COMMERCE_ENABLED off).
        return res.status === 404 || res.status === 503;
    }

    async function connectPlatform(platform, btn) {
        btn.disabled = true;
        try {
            const res = await api(`/connect/${platform.id}`, {});
            if (backendNotLive(res)) {
                window.showToast(t('Integration connections are coming soon.'), 'info');
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'connect failed');
            if (data.auth_url) {
                window.location.assign(data.auth_url);
                return;
            }
            window.showToast(t('Connection successful. Initial sync is running.'), 'success');
        } catch (e) {
            console.warn('[integration] connect', e);
            window.showToast(t('Could not start the connection. Try again.'), 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function syncNow(platform, account, btn) {
        btn.disabled = true;
        try {
            const res = await api('/sync-now', { account_id: account.id });
            if (backendNotLive(res)) {
                window.showToast(t('Integration connections are coming soon.'), 'info');
                return;
            }
            if (!res.ok) throw new Error(`sync-now ${res.status}`);
            window.showToast(t('Sync started.'), 'success');
        } catch (e) {
            console.warn('[integration] sync-now', e);
            window.showToast(t('Could not start sync. Try again.'), 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function disconnect(platform, account) {
        const confirmed = await window.showConfirmDialog({
            title: t('Disconnect this integration?'),
            body: t('Syncing stops immediately and FluxyOS deletes the stored access credentials. Synced data and ledger entries are kept.'),
            confirmLabel: t('Disconnect'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            const res = await api('/disconnect', { account_id: account.id });
            if (backendNotLive(res)) {
                window.showToast(t('Integration connections are coming soon.'), 'info');
                return;
            }
            if (!res.ok) throw new Error(`disconnect ${res.status}`);
            window.showToast(t('Integration disconnected.'), 'success');
            closeDrawer();
        } catch (e) {
            console.warn('[integration] disconnect', e);
            window.showToast(t('Could not disconnect. Try again.'), 'error');
        }
    }

    // ---------------------------------------------------------------- drawer
    function initDrawerChrome() {
        document.getElementById('drawer-close')?.addEventListener('click', closeDrawer);
        document.getElementById('integration-drawer-backdrop')?.addEventListener('click', closeDrawer);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    function openDrawer(platform, account) {
        state.drawerAccountId = account.id;
        state.drawerPlatform = platform;
        renderDrawer(platform, account);
        document.getElementById('integration-drawer-backdrop')?.classList.remove('hidden');
        document.getElementById('integration-drawer')?.classList.remove('translate-x-full');
        loadDrawerActivity(account);
    }

    function closeDrawer() {
        state.drawerAccountId = null;
        state.drawerPlatform = null;
        document.getElementById('integration-drawer-backdrop')?.classList.add('hidden');
        document.getElementById('integration-drawer')?.classList.add('translate-x-full');
    }

    function refreshDrawerFromState() {
        const platform = state.drawerPlatform;
        const account = platform ? state.accounts.get(platform.id) : null;
        if (!platform || !account || account.id !== state.drawerAccountId) { closeDrawer(); return; }
        renderDrawer(platform, account);
    }

    function renderDrawer(platform, account) {
        const logo = document.getElementById('drawer-logo');
        if (logo) { logo.className = `w-9 h-9 rounded-lg flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${platform.logoClass}`; logo.textContent = platform.initials; }
        const title = document.getElementById('drawer-title');
        if (title) title.textContent = platform.name;
        const subtitle = document.getElementById('drawer-subtitle');
        if (subtitle) subtitle.textContent = account.shop_name || account.shop_id || '';

        const pill = STATUS_PILLS[account.status] || STATUS_PILLS.disconnected;
        const rows = [
            [t('Status'), pill.label],
            [t('Shop ID'), account.shop_id || '—'],
            [t('Region'), account.region || '—'],
            [t('Currency'), account.currency || 'IDR'],
            [t('Connected at'), formatDateTime(account.connected_at) || '—'],
            [t('Last sync'), formatDateTime(account.last_sync_at) || t('Never synced')],
        ];
        const details = document.getElementById('drawer-details');
        if (details) {
            details.innerHTML = rows.map(([label, value]) => `
                <div class="flex items-center justify-between gap-3">
                    <dt class="text-[12px] text-gray-400">${label}</dt>
                    <dd class="text-[12px] font-medium text-gray-700 tabular-nums text-right">${escapeHtml(String(value))}</dd>
                </div>`).join('');
        }

        // Initial import progress (only while running)
        const initSync = account.initial_sync || null;
        const initSection = document.getElementById('drawer-initial-sync');
        if (initSection) {
            const running = initSync && initSync.status && initSync.status !== 'done';
            initSection.classList.toggle('hidden', !running);
            if (running) {
                const pct = Math.max(0, Math.min(100, Number(initSync.progress_pct) || 0));
                const bar = document.getElementById('drawer-initial-sync-bar');
                if (bar) bar.style.width = `${pct}%`;
                const label = document.getElementById('drawer-initial-sync-label');
                if (label) label.textContent = `${pct}%`;
            }
        }

        // Auto-post toggle (owner/admin only)
        const autopostSection = document.getElementById('drawer-autopost-section');
        if (autopostSection) {
            autopostSection.classList.toggle('hidden', !canManage);
            if (canManage) {
                const toggle = document.getElementById('drawer-autopost-toggle');
                setToggleVisual(toggle, account.auto_post !== false);
                toggle.onclick = async () => {
                    const next = !(toggle.getAttribute('aria-checked') === 'true');
                    setToggleVisual(toggle, next); // optimistic
                    try {
                        await ds.setCommerceAutoPost(user.uid, account.id, next);
                        window.showToast(next ? t('Auto-post enabled.') : t('Auto-post disabled.'), 'success');
                    } catch (e) {
                        console.warn('[integration] auto_post', e);
                        setToggleVisual(toggle, !next); // revert
                        window.showToast(t('Could not update the setting. Try again.'), 'error');
                    }
                };
            }
        }

        const footer = document.getElementById('drawer-footer');
        if (footer) {
            footer.classList.toggle('hidden', !canManage);
            const btn = document.getElementById('drawer-disconnect');
            if (btn) btn.onclick = () => disconnect(platform, account);
        }
    }

    function setToggleVisual(toggle, on) {
        if (!toggle) return;
        toggle.setAttribute('aria-checked', String(on));
        toggle.classList.toggle('bg-gray-900', on);
        toggle.classList.toggle('bg-gray-200', !on);
        const knob = toggle.querySelector('[data-autopost-knob]');
        knob?.classList.toggle('translate-x-6', on);
        knob?.classList.toggle('translate-x-1', !on);
    }

    async function loadDrawerActivity(account) {
        const jobsEl = document.getElementById('drawer-jobs');
        const errorsEl = document.getElementById('drawer-errors');
        if (jobsEl) jobsEl.innerHTML = `<p class="text-[12px] text-gray-400">${t('Loading…')}</p>`;
        if (errorsEl) errorsEl.innerHTML = '';
        try {
            const [jobs, errors] = await Promise.all([
                ds.getCommerceSyncJobs(user.uid, account.id, { max: 10 }),
                ds.getCommerceSyncErrors(user.uid, account.id, { max: 5 }),
            ]);
            if (state.drawerAccountId !== account.id) return; // drawer changed meanwhile
            if (jobsEl) {
                jobsEl.innerHTML = jobs.length ? jobs.map((job) => `
                    <div class="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                        <div class="min-w-0">
                            <p class="text-[12px] font-medium text-gray-700">${JOB_TYPE_LABELS[job.type] || job.type}</p>
                            <p class="text-[12px] text-gray-400 tabular-nums">${formatDateTime(job.created_at) || ''}</p>
                        </div>
                        <span class="text-[10px] font-bold uppercase tracking-[0.06em] ${job.status === 'done' ? 'text-green-600' : job.status === 'failed' || job.status === 'dead' ? 'text-red-500' : 'text-gray-400'}">${JOB_STATUS_LABELS[job.status] || job.status}</span>
                    </div>`).join('')
                    : `<p class="text-[12px] text-gray-400">${t('No sync activity yet.')}</p>`;
            }
            if (errorsEl) {
                errorsEl.innerHTML = errors.length ? errors.map((err) => `
                    <div class="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        <p class="text-[12px] font-medium text-red-600">${escapeHtml(err.code || 'error')}</p>
                        <p class="text-[12px] text-red-500/80 break-words">${escapeHtml(err.message || '')}</p>
                    </div>`).join('')
                    : `<p class="text-[12px] text-gray-400">${t('No errors.')}</p>`;
            }
        } catch (e) {
            console.warn('[integration] drawer activity', e);
            if (jobsEl) jobsEl.innerHTML = `<p class="text-[12px] text-gray-400">${t('No sync activity yet.')}</p>`;
            if (errorsEl) errorsEl.innerHTML = `<p class="text-[12px] text-gray-400">${t('No errors.')}</p>`;
        }
    }

    // ------------------------------------------------- OAuth callback params
    function handleCallbackParams() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('connected')) {
            window.showToast(t('Connection successful. Initial sync is running.'), 'success');
        } else if (params.get('error')) {
            // `detail` is a short diagnostic from the connector (e.g. TikTok's
            // "missing access scope" text) so a failure is actionable without
            // a production log pull. It rides an unauthenticated redirect URL,
            // so it's attacker-forgeable — escape before any innerHTML use
            // (showToast renders via innerHTML). Full text goes to console
            // for engineers; the toast keeps a short escaped excerpt.
            const detail = params.get('detail');
            if (detail) console.warn('[integration] connect failed:', detail);
            const suffix = detail ? ` (${escapeHtml(detail.slice(0, 80))})` : '';
            window.showToast(t('Connection failed. Try again.') + suffix, 'error');
        } else {
            return;
        }
        params.delete('connected');
        params.delete('error');
        params.delete('detail');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
}
