// =============================================================================
// FluxyOS — Internal Operations Console (Phase 1 MVP)
//
// MVP_INTERNAL_ONLY_TEMPORARY_AUTH
// This console is protected by a client-side credential gate stored in
// sessionStorage. It is NOT production-grade security. The matching Firestore
// collections (internal_users, internal_audit_logs) are intentionally open.
// Replace this with Firebase Auth custom claims or a backend-verified admin
// session before any production use. See
// docs/internal_operations_console_plan.md §16 and §20.
// =============================================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import DataService from "/assets/js/db-service.js";

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
const ds = new DataService(app);

// --- MVP credential gate (temporary) ---
const SESSION_KEY = 'fluxy_internal_admin_session';
const INTERNAL_USERNAME = 'fluxyos admin';
const INTERNAL_PASSWORD = 'Jakarta1352!';
const ACTOR_USERNAME = 'fluxyos admin';

// Shared token for the token-gated send-lead-outreach Netlify function. The
// console has no Firebase Auth, so the send endpoint trusts this token.
// MVP_INTERNAL_ONLY_TEMPORARY — exposed in client JS like INTERNAL_PASSWORD;
// move to a server-verified admin session later. Mirrored in Netlify env
// INTERNAL_API_TOKEN.
const INTERNAL_API_TOKEN = 'fxod_c2d33ba1bf55ce784d740eb2f8fa036c0cfea7672283253d';
const OUTREACH_SEND_URL = '/.netlify/functions/send-lead-outreach';
const EXTEND_TRIAL_URL = '/.netlify/functions/extend-trial';
const OUTREACH_STATUSES = [['new', 'New'], ['sent', 'Outreach sent'], ['meeting_booked', 'Meeting booked'], ['closed', 'Closed']];

// --- Status models (plan §13) ---
const ACCOUNT_STATUSES = ['registered', 'kyc_incomplete', 'kyc_submitted', 'kyc_approved', 'kyc_rejected', 'payment_pending', 'payment_submitted', 'payment_verified', 'active', 'suspended'];
const KYC_STATUSES = ['not_started', 'in_progress', 'submitted', 'needs_revision', 'approved', 'rejected'];
const PAYMENT_STATUSES = ['not_required', 'pending', 'submitted', 'under_review', 'verified', 'rejected', 'expired'];

// Trial / billing access status (mirrored from users/{uid}/billing/access).
const ACCESS_STATUSES = ['trial_not_started', 'trial_active', 'trial_expiring', 'trial_expired', 'payment_pending', 'payment_submitted', 'payment_verified', 'active', 'suspended'];

const KYC_TONE = { approved: 'green', rejected: 'red', needs_revision: 'amber', submitted: 'blue', in_progress: 'neutral', not_started: 'neutral' };
const PAYMENT_TONE = { verified: 'green', rejected: 'red', expired: 'red', under_review: 'blue', submitted: 'blue', pending: 'amber', not_required: 'neutral' };
const ACCOUNT_TONE = { active: 'green', suspended: 'red', kyc_rejected: 'red', payment_verified: 'blue', kyc_approved: 'blue', payment_submitted: 'amber', payment_pending: 'amber', kyc_submitted: 'amber', kyc_incomplete: 'neutral', registered: 'neutral' };
const ACCESS_TONE = { active: 'green', payment_verified: 'green', trial_active: 'blue', trial_expiring: 'amber', payment_submitted: 'amber', payment_pending: 'amber', trial_expired: 'red', suspended: 'red', trial_not_started: 'neutral' };

// Voucher display maps
const VOUCHER_PLAN_NAMES = { starter: 'Starter', core: 'Core Ops', growth: 'Growth Engine', enterprise: 'Enterprise AI' };
const VOUCHER_STATUS_TONE = { active: 'green', disabled: 'red', expired: 'neutral' };
const REDEMPTION_STATUS_TONE = { reserved: 'amber', redeemed: 'green', cancelled: 'neutral', failed: 'red' };

const state = {
    users: [],
    audit: [],
    vouchers: [],
    voucherRedemptions: [],
    leads: [],
    outreachLeads: [],
    leadsView: 'enquiries',
    loaded: false,
    loadError: false,
    activeTab: 'overview',
    drawerUserId: null,
    // 'user' (review drawer) | 'voucher-create' | 'voucher-usage'
    drawerMode: null,
    filters: { search: '', account: '', kyc: '', payment: '', access: '' }
};

// =============================================================================
// Helpers
// =============================================================================
function $(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function labelize(value) {
    if (!value) return '—';
    return String(value).replace(/_/g, ' ');
}

function toDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'number') return new Date(ts);
    return null;
}

function fmtDate(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(ts) {
    const d = toDate(ts);
    if (!d) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(amount) {
    if (amount == null || amount === '' || Number.isNaN(Number(amount))) return '—';
    return 'Rp' + Math.abs(Number(amount)).toLocaleString('id-ID');
}

function badge(value, toneMap) {
    const tone = toneMap[value] || 'neutral';
    return `<span class="ibadge ibadge--${tone}">${escapeHtml(labelize(value))}</span>`;
}

// Trial / payment access badge (plan §26). Prioritises payment state over trial
// state so a paid/under-review/rejected user reads correctly regardless of the
// stored access_status.
function accessBadge(u) {
    const access = u.access_status;
    const pay = u.payment_status;
    const days = u.trial_days_remaining;
    if (!access && !pay) return '<span class="text-gray-400">—</span>';
    if (access === 'active' || access === 'payment_verified' || pay === 'verified') return '<span class="ibadge ibadge--green">Active</span>';
    if (pay === 'rejected') return '<span class="ibadge ibadge--red">Payment needs revision</span>';
    if (access === 'payment_submitted' || pay === 'submitted' || pay === 'under_review') return '<span class="ibadge ibadge--amber">Payment under review</span>';
    if (access === 'trial_expired') return '<span class="ibadge ibadge--red">Trial ended</span>';
    if (access === 'trial_active' || access === 'trial_expiring') {
        if (days != null && days <= 1) return '<span class="ibadge ibadge--amber">Trial ends today</span>';
        return `<span class="ibadge ibadge--blue">Trial · ${days != null ? days : '—'} days left</span>`;
    }
    if (access === 'suspended') return '<span class="ibadge ibadge--red">Suspended</span>';
    return badge(access, ACCESS_TONE);
}

// Plain-text trial remaining for the Users table "Trial left" column.
function trialRemainingText(u) {
    const access = u.access_status;
    const days = u.trial_days_remaining;
    if (access === 'trial_active' || access === 'trial_expiring') {
        if (days != null && days <= 0) return 'Ends today';
        if (days != null && days <= 1) return 'Ends today';
        return days != null ? `${days}d left` : '—';
    }
    if (access === 'trial_expired') return 'Ended';
    return '—';
}

// A user counts as "online" when their last activity heartbeat is within this
// window. Kept comfortably above the client's ~60s heartbeat throttle so an
// active user doesn't flicker offline between beats.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

// Relative "time ago" for an offline user's last-seen. English to match the
// console convention. Escalates minutes → hours; ≥24h falls back to the
// absolute stamp via fmtDateTime ("11 Jul 2026, 14:35").
function timeAgo(date) {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return fmtDateTime(date);
}

// Users table "Activity" cell: green "Online" when recently active, otherwise
// a muted "last seen …" line. Renders "—" when no heartbeat exists yet.
function userActivityCell(u) {
    const last = toDate(u.last_active_at);
    if (!last) return '<span class="text-gray-400">—</span>';
    if (Date.now() - last.getTime() <= ONLINE_WINDOW_MS) {
        return '<span class="activity-status activity-status--online"><span class="activity-dot"></span>Online</span>';
    }
    return `<span class="activity-status text-gray-500">last seen ${escapeHtml(timeAgo(last))}</span>`;
}

function userDisplayName(u) {
    return u.display_name || u.email || u.user_id || 'Unknown user';
}

// =============================================================================
// Credential gate
// =============================================================================
function hasSession() {
    return sessionStorage.getItem(SESSION_KEY) === 'active';
}

function showConsole() {
    $('internal-gate').classList.add('hidden');
    $('internal-console').classList.remove('hidden');
    if (!state.loaded) loadData();
}

function showGate() {
    $('internal-console').classList.add('hidden');
    $('internal-gate').classList.remove('hidden');
    $('internal-username').focus();
}

function initGate() {
    const userInput = $('internal-username');
    const passInput = $('internal-password');
    const submitBtn = $('internal-gate-submit');
    const errorEl = $('internal-gate-error');
    const form = $('internal-gate-form');

    const syncDisabled = () => {
        submitBtn.disabled = !(userInput.value.trim() && passInput.value);
        errorEl.classList.add('hidden');
    };
    userInput.addEventListener('input', syncDisabled);
    passInput.addEventListener('input', syncDisabled);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = userInput.value.trim();
        const password = passInput.value;
        if (username === INTERNAL_USERNAME && password === INTERNAL_PASSWORD) {
            sessionStorage.setItem(SESSION_KEY, 'active');
            passInput.value = '';
            showConsole();
        } else {
            errorEl.textContent = 'Invalid internal credential.';
            errorEl.classList.remove('hidden');
        }
    });
}

function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    showGate();
}

// =============================================================================
// Data loading
// =============================================================================
async function loadData() {
    state.loadError = false;
    renderLoading();
    try {
        const [users, audit, vouchers, voucherRedemptions, leads, outreachLeads] = await Promise.all([
            ds.getInternalUsers({ limitCount: 200 }),
            ds.getInternalAuditLogs(100).catch(() => []),
            ds.getVoucherCodes().catch(() => []),
            ds.getAllVoucherRedemptions({ limitCount: 1000 }).catch(() => []),
            ds.getSalesLeads({ limitCount: 200 }).catch(() => []),
            ds.getOutreachLeads({ limitCount: 200 }).catch(() => [])
        ]);
        state.users = users || [];
        state.audit = audit || [];
        state.vouchers = vouchers || [];
        state.voucherRedemptions = voucherRedemptions || [];
        state.leads = leads || [];
        state.outreachLeads = outreachLeads || [];
        state.loaded = true;
        renderAll();
    } catch (err) {
        // Handled, recoverable state — the UI shows a friendly error block and
        // never surfaces the raw Firebase error. Logged as a warning (not error)
        // because this also fires expectedly until the internal_* firestore.rules
        // are deployed.
        console.warn('[internal] could not load console data', err?.code || err);
        state.loadError = true;
        renderError();
    }
}

function findUser(userId) {
    return state.users.find(u => (u.user_id || u.id) === userId) || null;
}

// =============================================================================
// Rendering
// =============================================================================
function renderLoading() {
    const shimmerRows = (cols) => Array.from({ length: 5 }).map(() =>
        `<tr>${Array.from({ length: cols }).map(() => '<td class="px-5 py-4"><div class="ishimmer h-4 w-full max-w-[120px]"></div></td>').join('')}</tr>`
    ).join('');
    $('users-tbody').innerHTML = shimmerRows(9);
    $('kyc-tbody').innerHTML = shimmerRows(5);
    $('payment-tbody').innerHTML = shimmerRows(6);
    $('audit-tbody').innerHTML = shimmerRows(6);
    $('vouchers-tbody').innerHTML = shimmerRows(9);
    ['users-state', 'kyc-state', 'payment-state', 'audit-state', 'vouchers-state'].forEach(id => $(id).classList.add('hidden'));
    const kpiShimmer = Array.from({ length: 4 }).map(() =>
        '<div class="bg-white border border-gray-200 rounded-xl shadow-sm p-4"><div class="ishimmer h-3 w-20 mb-3"></div><div class="ishimmer h-6 w-12"></div></div>'
    ).join('');
    $('overview-kpis').innerHTML = kpiShimmer;
    $('voucher-kpis').innerHTML = kpiShimmer;
    $('overview-action-list').innerHTML = '<div class="px-5 py-4"><div class="ishimmer h-4 w-2/3"></div></div>';
}

function stateBlock(message, sub) {
    return `<div class="flex flex-col items-center justify-center py-16 text-center px-6">
        <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        </div>
        <p class="text-[14px] font-semibold text-gray-900">${escapeHtml(message)}</p>
        ${sub ? `<p class="text-[13px] text-gray-500 mt-1 max-w-[360px]">${escapeHtml(sub)}</p>` : ''}
    </div>`;
}

function renderError() {
    const tbodies = { 'users-tbody': 'users-state', 'kyc-tbody': 'kyc-state', 'payment-tbody': 'payment-state', 'audit-tbody': 'audit-state', 'vouchers-tbody': 'vouchers-state' };
    Object.entries(tbodies).forEach(([tb, st]) => {
        $(tb).innerHTML = '';
        const el = $(st);
        el.classList.remove('hidden');
        el.innerHTML = stateBlock('Could not load internal data', 'Check your connection and try Refresh. If this persists, the internal index may need a backend sync.');
    });
    $('overview-kpis').innerHTML = '';
    $('voucher-kpis').innerHTML = '';
    $('overview-action-list').innerHTML = stateBlock('Could not load internal data', 'Use Refresh to try again.');
}

function renderAll() {
    renderOverview();
    renderUsersTab();
    renderKycTab();
    renderPaymentTab();
    renderVouchersTab();
    renderLeadsTab();
    renderOutreachLeads();
    applyLeadsView();
    renderAuditTab();
    renderTabCounts();
}

// ----- Overview -----
function renderOverview() {
    const u = state.users;
    const count = (fn) => u.filter(fn).length;
    const cards = [
        { label: 'Total users', value: u.length, tone: 'neutral' },
        { label: 'KYC submitted', value: count(x => x.kyc_status === 'submitted'), tone: 'blue' },
        { label: 'KYC pending review', value: count(x => x.kyc_status === 'submitted' || x.kyc_status === 'needs_revision'), tone: 'amber' },
        { label: 'Payment pending review', value: count(x => ['submitted', 'under_review', 'pending'].includes(x.payment_status)), tone: 'amber' },
        { label: 'Active users', value: count(x => x.account_status === 'active'), tone: 'green' },
        { label: 'Rejected / needs revision', value: count(x => x.kyc_status === 'rejected' || x.kyc_status === 'needs_revision' || x.payment_status === 'rejected'), tone: 'red' },
        { label: 'Stuck in onboarding', value: count(x => !x.onboarding_completed && x.account_status !== 'active'), tone: 'neutral' },
        { label: 'Suspended', value: count(x => x.account_status === 'suspended'), tone: 'red' }
    ];
    const dot = { neutral: '#94A3B8', blue: '#1D4ED8', amber: '#D97706', green: '#16A34A', red: '#DC2626' };
    $('overview-kpis').className = 'grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6';
    $('overview-kpis').innerHTML = cards.map(c => `
        <div class="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <div class="flex items-center gap-2 mb-2">
                <span class="w-1.5 h-1.5 rounded-full" style="background:${dot[c.tone]}"></span>
                <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500">${escapeHtml(c.label)}</span>
            </div>
            <div class="mono text-[24px] font-semibold leading-none">${c.value}</div>
        </div>`).join('');

    // Action list — KYC/payment needing attention
    const needing = u.filter(x =>
        x.kyc_status === 'submitted' || x.kyc_status === 'needs_revision' ||
        ['submitted', 'under_review', 'pending'].includes(x.payment_status)
    ).slice(0, 12);

    const list = $('overview-action-list');
    if (!u.length) {
        list.innerHTML = stateBlock('No registered users yet', 'New users appear here automatically after they sign in or complete onboarding.');
        return;
    }
    if (!needing.length) {
        list.innerHTML = stateBlock('Nothing needs action', 'No KYC or payment items are currently waiting for review.');
        return;
    }
    list.innerHTML = needing.map(x => {
        const uid = x.user_id || x.id;
        return `<div class="flex items-center justify-between gap-4 px-5 py-3">
            <div class="min-w-0">
                <div class="text-[14px] font-medium truncate">${escapeHtml(userDisplayName(x))}</div>
                <div class="text-[12px] text-gray-500 truncate">${escapeHtml(x.business_name || '—')}</div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                ${badge(x.kyc_status, KYC_TONE)}
                ${badge(x.payment_status, PAYMENT_TONE)}
                <button class="text-[13px] font-semibold text-[#EA580C] hover:underline" data-review="${escapeHtml(uid)}">Review</button>
            </div>
        </div>`;
    }).join('');
}

// Access filter mapping (plan §26). "ending_today" is derived from the
// remaining-days countdown since it isn't a persisted status.
function matchesAccessFilter(x, key) {
    switch (key) {
        case 'trial_active': return x.access_status === 'trial_active' && !(x.trial_days_remaining != null && x.trial_days_remaining <= 1);
        case 'ending_today': return (x.access_status === 'trial_active' || x.access_status === 'trial_expiring') && x.trial_days_remaining != null && x.trial_days_remaining <= 1;
        case 'trial_expired': return x.access_status === 'trial_expired';
        case 'payment_not_started': return x.access_status && x.access_status.startsWith('trial') && (x.payment_status === 'pending' || x.payment_status === 'not_required' || x.payment_status == null);
        case 'payment_submitted': return x.payment_status === 'submitted' || x.access_status === 'payment_submitted';
        case 'payment_under_review': return x.payment_status === 'under_review';
        case 'payment_rejected': return x.payment_status === 'rejected';
        case 'payment_verified': return x.payment_status === 'verified';
        case 'active': return x.access_status === 'active' || x.account_status === 'active';
        default: return true;
    }
}

const ACCESS_FILTER_OPTIONS = [
    ['trial_active', 'Trial active'],
    ['ending_today', 'Trial ending today'],
    ['trial_expired', 'Trial expired'],
    ['payment_not_started', 'Payment not started'],
    ['payment_submitted', 'Payment submitted'],
    ['payment_under_review', 'Payment under review'],
    ['payment_rejected', 'Payment rejected'],
    ['payment_verified', 'Payment verified'],
    ['active', 'Active']
];

// ----- Users tab -----
function applyFilters(rows) {
    const f = state.filters;
    const q = f.search.trim().toLowerCase();
    return rows.filter(x => {
        if (f.account && x.account_status !== f.account) return false;
        if (f.kyc && x.kyc_status !== f.kyc) return false;
        if (f.payment && x.payment_status !== f.payment) return false;
        if (f.access && !matchesAccessFilter(x, f.access)) return false;
        if (q) {
            const hay = [x.email, x.business_name, x.phone_number, x.display_name].map(v => String(v || '').toLowerCase()).join(' ');
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

// Live trial = Extend Trial is available (never for active/paid/expired/suspended).
function isLiveTrial(x) {
    return x.access_status === 'trial_active' || x.access_status === 'trial_expiring';
}

function userRow(x) {
    const uid = x.user_id || x.id;
    const extendBtn = isLiveTrial(x)
        ? `<button class="text-[13px] font-medium text-gray-500 hover:text-gray-900 ml-3" data-extend-trial="${escapeHtml(uid)}" aria-haspopup="menu">Extend Trial</button>`
        : '';
    return `<tr class="hover:bg-gray-50/60">
        <td class="px-5 py-3.5">
            <div class="font-medium text-gray-900 truncate max-w-[200px]">${escapeHtml(userDisplayName(x))}</div>
            <div class="text-[12px] text-gray-500 truncate max-w-[200px]">${escapeHtml(x.email || '—')}</div>
        </td>
        <td class="px-5 py-3.5 text-gray-700">${escapeHtml(x.business_name || '—')}</td>
        <td class="px-5 py-3.5 mono text-[13px] text-gray-600">${escapeHtml(x.phone_number || '—')}</td>
        <td class="px-5 py-3.5">${accessBadge(x)}</td>
        <td class="px-5 py-3.5 text-[13px] text-gray-600">${escapeHtml(trialRemainingText(x))}</td>
        <td class="px-5 py-3.5 text-[13px]">${userActivityCell(x)}</td>
        <td class="px-5 py-3.5">${badge(x.kyc_status, KYC_TONE)}</td>
        <td class="px-5 py-3.5">${badge(x.payment_status, PAYMENT_TONE)}</td>
        <td class="px-5 py-3.5">${badge(x.account_status, ACCOUNT_TONE)}</td>
        <td class="px-5 py-3.5 text-[13px] text-gray-500">${fmtDate(x.created_at)}</td>
        <td class="px-5 py-3.5 text-right whitespace-nowrap">
            <button class="text-[13px] font-semibold text-[#EA580C] hover:underline" data-review="${escapeHtml(uid)}">Review</button>${extendBtn}
            <button class="text-[13px] font-medium text-gray-500 hover:text-gray-900 ml-3" data-copy="${escapeHtml(uid)}">Copy UID</button>
        </td>
    </tr>`;
}

function renderUsersTab() {
    const tbody = $('users-tbody');
    const stateEl = $('users-state');
    const rows = applyFilters(state.users);
    $('users-count').textContent = `${rows.length} of ${state.users.length} user${state.users.length === 1 ? '' : 's'}`;

    if (!state.users.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No registered users yet', 'Users are added to the internal index automatically when they sign in or complete onboarding.');
        return;
    }
    if (!rows.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No users match these filters', 'Try clearing search or status filters.');
        return;
    }
    stateEl.classList.add('hidden');
    tbody.innerHTML = rows.map(userRow).join('');
}

// ----- KYC tab -----
function renderKycTab() {
    const tbody = $('kyc-tbody');
    const stateEl = $('kyc-state');
    const rows = state.users.filter(x => x.kyc_status === 'submitted' || x.kyc_status === 'needs_revision');
    if (!rows.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No KYC reviews waiting', 'Users with submitted or needs-revision KYC will appear here.');
        return;
    }
    stateEl.classList.add('hidden');
    tbody.innerHTML = rows.map(x => {
        const uid = x.user_id || x.id;
        return `<tr class="hover:bg-gray-50/60">
            <td class="px-5 py-3.5">
                <div class="font-medium text-gray-900 truncate max-w-[220px]">${escapeHtml(userDisplayName(x))}</div>
                <div class="text-[12px] text-gray-500 truncate max-w-[220px]">${escapeHtml(x.email || '—')}</div>
            </td>
            <td class="px-5 py-3.5 text-gray-700">${escapeHtml(x.business_name || '—')}</td>
            <td class="px-5 py-3.5">${badge(x.kyc_status, KYC_TONE)}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-500">${fmtDate(x.kyc_submitted_at)}</td>
            <td class="px-5 py-3.5 text-right"><button class="text-[13px] font-semibold text-[#EA580C] hover:underline" data-review="${escapeHtml(uid)}">Review KYC</button></td>
        </tr>`;
    }).join('');
}

// ----- Payment tab -----
function renderPaymentTab() {
    const tbody = $('payment-tbody');
    const stateEl = $('payment-state');
    const rows = state.users.filter(x => ['submitted', 'under_review', 'pending'].includes(x.payment_status));
    if (!rows.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No payment verification record yet', 'Users with pending, submitted, or under-review payments will appear here.');
        return;
    }
    stateEl.classList.add('hidden');
    tbody.innerHTML = rows.map(x => {
        const uid = x.user_id || x.id;
        return `<tr class="hover:bg-gray-50/60">
            <td class="px-5 py-3.5">
                <div class="font-medium text-gray-900 truncate max-w-[200px]">${escapeHtml(userDisplayName(x))}</div>
                <div class="text-[12px] text-gray-500 truncate max-w-[200px]">${escapeHtml(x.email || '—')}</div>
            </td>
            <td class="px-5 py-3.5 text-gray-700">${escapeHtml(x.business_name || '—')}</td>
            <td class="px-5 py-3.5 text-gray-700">${escapeHtml(x.plan_id || '—')}</td>
            <td class="px-5 py-3.5 mono text-[13px] text-gray-700">${fmtMoney(x.payment_amount)}</td>
            <td class="px-5 py-3.5">${badge(x.payment_status, PAYMENT_TONE)}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-500">${fmtDate(x.payment_submitted_at || x.updated_at)}</td>
            <td class="px-5 py-3.5 text-right"><button class="text-[13px] font-semibold text-[#EA580C] hover:underline" data-review="${escapeHtml(uid)}">Review payment</button></td>
        </tr>`;
    }).join('');
}

// ----- Audit tab -----
function renderAuditTab() {
    const tbody = $('audit-tbody');
    const stateEl = $('audit-state');
    if (!state.audit.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No internal actions logged yet', 'Every KYC, payment, and account status change is recorded here.');
        return;
    }
    stateEl.classList.add('hidden');
    tbody.innerHTML = state.audit.map(log => {
        const beforeAfter = summarizeChange(log.before, log.after);
        const targetUser = findUser(log.target_user_id);
        const targetLabel = targetUser ? userDisplayName(targetUser) : (log.target_user_id || '—');
        return `<tr class="hover:bg-gray-50/60 align-top">
            <td class="px-5 py-3.5 text-[13px] text-gray-500 whitespace-nowrap">${fmtDateTime(log.created_at)}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700">${escapeHtml(log.actor_username || 'internal_admin')}</td>
            <td class="px-5 py-3.5 mono text-[12px] text-gray-700">${escapeHtml(log.action || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700 truncate max-w-[180px]">${escapeHtml(targetLabel)}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-600">${beforeAfter}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-500 max-w-[200px]">${escapeHtml(log.reason || '—')}</td>
        </tr>`;
    }).join('');
}

function summarizeChange(before, after) {
    if (!after || typeof after !== 'object') return '—';
    const keys = Object.keys(after).filter(k => ['account_status', 'kyc_status', 'payment_status', 'status', 'discount_value'].includes(k));
    if (!keys.length) return '—';
    return keys.map(k => {
        const from = before && before[k] ? labelize(before[k]) : '—';
        const to = labelize(after[k]);
        return `<span class="whitespace-nowrap">${escapeHtml(from)} → <strong>${escapeHtml(to)}</strong></span>`;
    }).join('<br>');
}

function renderTabCounts() {
    const kycCount = state.users.filter(x => x.kyc_status === 'submitted' || x.kyc_status === 'needs_revision').length;
    const payCount = state.users.filter(x => ['submitted', 'under_review', 'pending'].includes(x.payment_status)).length;
    const newLeads = state.leads.filter(l => (l.status || 'new') === 'new').length;
    setTabCount('tab-count-kyc', kycCount);
    setTabCount('tab-count-payment', payCount);
    setTabCount('tab-count-leads', newLeads);
}

function setTabCount(id, n) {
    const el = $(id);
    if (n > 0) { el.textContent = n; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
}

// =============================================================================
// Sales leads tab (read-only — public Contact Sales enquiries)
// =============================================================================
function renderLeadsTab() {
    const tbody = $('leads-tbody');
    const stateEl = $('leads-state');
    if (!tbody) return;
    if (!state.leads.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = '<div class="px-5 py-12 text-center text-[13px] text-gray-500">No sales leads yet. Enquiries from <span class="font-medium">/contact-sales</span> appear here.</div>';
        return;
    }
    stateEl.classList.add('hidden');
    const LEAD_STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['closed', 'Closed'], ['spam', 'Spam']];
    // Lead fields are public, anonymous input — always escapeHtml before render.
    tbody.innerHTML = state.leads.map(l => {
        const email = escapeHtml(l.email || '');
        const wa = escapeHtml(l.whatsapp || '');
        const waDigits = (l.whatsapp || '').replace(/[^0-9]/g, '');
        const status = l.status || 'new';
        const isNew = status === 'new';
        const options = LEAD_STATUSES.map(([v, label]) => `<option value="${v}"${v === status ? ' selected' : ''}>${label}</option>`).join('');
        return `<tr class="hover:bg-gray-50/60 align-top">
            <td class="px-5 py-3.5 whitespace-nowrap text-[13px] text-gray-600">${isNew ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-[#EA580C] mr-1.5 align-middle"></span>' : ''}${escapeHtml(fmtDateTime(l.created_at))}</td>
            <td class="px-5 py-3.5 text-[14px] font-medium text-gray-900">${escapeHtml(l.name || '—')}</td>
            <td class="px-5 py-3.5 text-[13px]">${email ? `<a href="mailto:${email}" class="text-[#EA580C] hover:underline">${email}</a>` : '—'}</td>
            <td class="px-5 py-3.5 text-[13px] whitespace-nowrap">${wa ? `<a href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer" class="text-[#EA580C] hover:underline">${wa}</a>` : '—'}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700">${escapeHtml(l.company || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700 whitespace-nowrap">${escapeHtml(l.business_type || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700 whitespace-nowrap">${escapeHtml(l.team_size || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-600 max-w-md"><div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(l.message || '—')}</div></td>
            <td class="px-5 py-3.5"><select data-lead-status="${escapeHtml(l.id)}" class="text-[13px] border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#EA580C]/40">${options}</select></td>
        </tr>`;
    }).join('');
}

// Delegated status change for a lead (rules allow status-only updates).
async function onLeadStatusChange(sel) {
    const id = sel.dataset.leadStatus;
    const status = sel.value;
    sel.disabled = true;
    try {
        await ds.updateSalesLeadStatus(id, status);
        const lead = state.leads.find(l => l.id === id);
        if (lead) lead.status = status;
        renderLeadsTab();
        renderTabCounts();
        window.showToast?.('Lead status updated', 'success');
    } catch (_) {
        sel.disabled = false;
        window.showToast?.('Could not update lead status', 'error');
    }
}

// =============================================================================
// Outreach sub-view (Sales Leads → Outreach) — manually added prospects we send
// the bilingual meeting-reminder email to (send-lead-outreach function).
// =============================================================================
const OUTREACH_STATUS_LABELS = Object.fromEntries(OUTREACH_STATUSES);

function applyLeadsView() {
    const view = state.leadsView === 'outreach' ? 'outreach' : 'enquiries';
    $('leads-view-enquiries')?.classList.toggle('hidden', view !== 'enquiries');
    $('leads-view-outreach')?.classList.toggle('hidden', view !== 'outreach');
    $('outreach-new-btn')?.classList.toggle('hidden', view !== 'outreach');
    [['leads-subtab-enquiries', 'enquiries'], ['leads-subtab-outreach', 'outreach']].forEach(([id, v]) => {
        const btn = $(id);
        if (!btn) return;
        const active = v === view;
        btn.classList.toggle('bg-white', active);
        btn.classList.toggle('shadow-sm', active);
        btn.classList.toggle('text-gray-900', active);
        btn.classList.toggle('text-gray-500', !active);
    });
}

function switchLeadsView(view) {
    state.leadsView = view === 'outreach' ? 'outreach' : 'enquiries';
    applyLeadsView();
}

function fmtMeeting(ts) {
    const dt = toDate(ts);
    if (!dt) return '—';
    return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }) + ' WIB';
}

function renderOutreachLeads() {
    const tbody = $('outreach-tbody');
    const stateEl = $('outreach-state');
    if (!tbody) return;
    if (!state.outreachLeads.length) {
        tbody.innerHTML = '';
        stateEl?.classList.remove('hidden');
        if (stateEl) stateEl.innerHTML = '<div class="px-5 py-12 text-center text-[13px] text-gray-500">No outreach yet. Click <span class="font-medium">New outreach</span> to add a prospect and send the bilingual meeting reminder.</div>';
        return;
    }
    stateEl?.classList.add('hidden');
    tbody.innerHTML = state.outreachLeads.map(l => {
        const id = escapeHtml(l.id);
        const status = l.status || 'new';
        const options = OUTREACH_STATUSES.map(([v, label]) => `<option value="${v}"${v === status ? ' selected' : ''}>${label}</option>`).join('');
        const email = escapeHtml(l.email || '');
        return `<tr class="hover:bg-gray-50/60 align-top">
            <td class="px-5 py-3.5 text-[14px] font-medium text-gray-900">${escapeHtml(l.name || '—')}</td>
            <td class="px-5 py-3.5 text-[13px]">${email ? `<a href="mailto:${email}" class="text-[#EA580C] hover:underline">${email}</a>` : '—'}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700">${escapeHtml(l.role || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700">${escapeHtml(l.company || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-700 whitespace-nowrap">${escapeHtml(fmtMeeting(l.meeting_at))}</td>
            <td class="px-5 py-3.5"><select data-outreach-status="${id}" class="text-[13px] border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#EA580C]/40">${options}</select></td>
            <td class="px-5 py-3.5 text-right whitespace-nowrap">
                <button data-outreach-resend="${id}" class="text-[13px] font-semibold text-[#EA580C] hover:text-[#D94E0B] mr-3">Resend</button>
                <button data-outreach-delete="${id}" class="text-[13px] text-gray-400 hover:text-red-500">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function outreachMeetingISO(lead) {
    const dt = toDate(lead.meeting_at);
    return dt ? dt.toISOString() : null;
}

async function sendOutreachEmail({ name, gender, email, meetingISO, role, company }) {
    const res = await fetch(OUTREACH_SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_API_TOKEN },
        body: JSON.stringify({ name, gender, email, meetingISO, role, company, senderName: ACTOR_USERNAME }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || (out && out.error)) throw new Error((out && out.error) || `Send failed (${res.status})`);
    return out;
}

let outreachDatePicker = null;
let outreachDateKey = null;

function openOutreachModal() {
    if ($('outreach-modal')) return;
    const todayKey = window.FluxyDateRangePicker?.getDayKey?.() || new Date().toISOString().slice(0, 10);
    outreachDateKey = todayKey;
    const inputCls = 'w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[14px] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/40 focus:border-[#EA580C] transition-all';
    const labelCls = 'block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2';
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div id="outreach-modal" class="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div id="outreach-overlay" class="absolute inset-0 bg-[#0B0F19]/50 opacity-0 transition-opacity duration-200" style="backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);"></div>
            <div id="outreach-card" class="relative z-10 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-[0_24px_48px_rgba(11,15,25,0.18)] opacity-0 translate-y-3 transition-all duration-200">
                <div class="px-6 pt-6 pb-4 flex items-start justify-between">
                    <div>
                        <h3 class="text-[17px] font-bold text-gray-900 tracking-tight">Send outreach</h3>
                        <p class="text-[13px] text-gray-500 mt-1">Add the prospect and email the bilingual meeting reminder.</p>
                    </div>
                    <button type="button" data-outreach-close class="text-gray-400 hover:text-gray-600 -mt-1 -mr-1 p-1">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="outreach-form" class="px-6 pb-6 space-y-4" novalidate>
                    <div><label for="of-name" class="${labelCls}">Name</label><input id="of-name" type="text" required placeholder="e.g. Anissa Swastika" class="${inputCls}"></div>
                    <div class="grid grid-cols-2 gap-3">
                        <div><label for="of-gender" class="${labelCls}">Gender</label>
                            <select id="of-gender" class="${inputCls}"><option value="female">Female (Ibu / Mrs)</option><option value="male">Male (Bapak / Mr)</option></select></div>
                        <div><label for="of-time" class="${labelCls}">Meeting time (WIB)</label><input id="of-time" type="time" value="15:00" class="${inputCls}"></div>
                    </div>
                    <div><label for="of-email" class="${labelCls}">Email</label><input id="of-email" type="email" required placeholder="name@company.com" class="${inputCls}"></div>
                    <div><label class="${labelCls}">Meeting date</label><div id="of-date-host"></div></div>
                    <div class="grid grid-cols-2 gap-3">
                        <div><label for="of-role" class="${labelCls}">Role</label><input id="of-role" type="text" placeholder="e.g. Founder" class="${inputCls}"></div>
                        <div><label for="of-company" class="${labelCls}">Company</label><input id="of-company" type="text" placeholder="e.g. Acme" class="${inputCls}"></div>
                    </div>
                    <button type="submit" id="of-submit" class="w-full py-3 bg-[#EA580C] hover:bg-[#D94E0B] text-white font-bold rounded-xl text-[14px] shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed">Save &amp; send outreach</button>
                </form>
            </div>
        </div>`;
    document.body.appendChild(wrap.firstElementChild);
    document.body.classList.add('overflow-hidden');
    requestAnimationFrame(() => {
        $('outreach-overlay')?.classList.replace('opacity-0', 'opacity-100');
        const card = $('outreach-card');
        card?.classList.remove('opacity-0', 'translate-y-3');
    });
    outreachDatePicker = window.FluxyDateRangePicker?.mount?.('#of-date-host', {
        mode: 'single', start: todayKey, end: todayKey, defaultStart: todayKey, defaultEnd: todayKey,
        maxDate: '2099-12-31', onChange: ({ start }) => { outreachDateKey = start; },
    });
    $('outreach-modal').querySelector('[data-outreach-close]')?.addEventListener('click', closeOutreachModal);
    $('outreach-overlay')?.addEventListener('click', closeOutreachModal);
    $('outreach-form')?.addEventListener('submit', submitOutreach);
    document.addEventListener('keydown', outreachEsc);
}

function outreachEsc(e) { if (e.key === 'Escape') closeOutreachModal(); }

function closeOutreachModal() {
    const modal = $('outreach-modal');
    if (!modal) return;
    document.removeEventListener('keydown', outreachEsc);
    try { outreachDatePicker?.destroy?.(); } catch (_) {}
    outreachDatePicker = null;
    $('outreach-overlay')?.classList.replace('opacity-100', 'opacity-0');
    $('outreach-card')?.classList.add('opacity-0', 'translate-y-3');
    document.body.classList.remove('overflow-hidden');
    setTimeout(() => modal.remove(), 200);
}

async function submitOutreach(e) {
    e.preventDefault();
    const name = $('of-name').value.trim();
    const gender = $('of-gender').value;
    const email = $('of-email').value.trim();
    const time = $('of-time').value || '15:00';
    const role = $('of-role').value.trim();
    const company = $('of-company').value.trim();
    if (!name) return window.showToast('Please enter the lead\'s name.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return window.showToast('Please enter a valid email.', 'error');
    if (!outreachDateKey) return window.showToast('Please pick a meeting date.', 'error');
    const meetingDate = new Date(`${outreachDateKey}T${time}:00+07:00`); // WIB wall-clock
    if (isNaN(meetingDate.getTime())) return window.showToast('Invalid meeting date/time.', 'error');
    const meetingISO = meetingDate.toISOString();

    const btn = $('of-submit');
    btn.disabled = true; btn.textContent = 'Sending…';
    let leadId;
    try {
        leadId = await ds.addOutreachLead({ name, gender, email, role: role || undefined, company: company || undefined, meeting_at: meetingDate, status: 'new' });
    } catch (err) {
        btn.disabled = false; btn.textContent = 'Save & send outreach';
        return window.showToast(err.message || 'Could not save the lead.', 'error');
    }
    try {
        await sendOutreachEmail({ name, gender, email, meetingISO, role, company });
        await ds.updateOutreachLead(leadId, { status: 'sent', last_sent_at: new Date() });
        window.showToast('Outreach sent to ' + email, 'success');
    } catch (err) {
        window.showToast('Lead saved, but the email failed: ' + (err.message || 'send error') + '. Use Resend.', 'error');
    }
    closeOutreachModal();
    await loadData();
    state.leadsView = 'outreach';
    applyLeadsView();
}

async function onOutreachResend(id) {
    const lead = state.outreachLeads.find(l => l.id === id);
    if (!lead) return;
    const meetingISO = outreachMeetingISO(lead);
    if (!meetingISO) return window.showToast('This lead has no meeting date.', 'error');
    const ok = await window.showConfirmDialog?.({ title: 'Resend outreach?', body: `Send the meeting reminder to <strong>${escapeHtml(lead.email)}</strong> again?`, confirmLabel: 'Resend', cancelLabel: 'Cancel' });
    if (ok === false) return;
    try {
        await sendOutreachEmail({ name: lead.name, gender: lead.gender, email: lead.email, meetingISO, role: lead.role, company: lead.company });
        await ds.updateOutreachLead(id, { status: 'sent', last_sent_at: new Date() });
        window.showToast('Outreach resent to ' + lead.email, 'success');
        await loadData(); state.leadsView = 'outreach'; applyLeadsView();
    } catch (err) { window.showToast(err.message || 'Resend failed.', 'error'); }
}

async function onOutreachDelete(id) {
    const lead = state.outreachLeads.find(l => l.id === id);
    if (!lead) return;
    const ok = await window.showConfirmDialog?.({ title: 'Delete this lead?', body: `<strong>${escapeHtml(lead.name || 'This lead')}</strong> will be removed from the outreach list.`, confirmLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger' });
    if (ok === false) return;
    try {
        await ds.deleteOutreachLead(id);
        window.showToast('Lead deleted.', 'info');
        await loadData(); state.leadsView = 'outreach'; applyLeadsView();
    } catch (err) { window.showToast(err.message || 'Could not delete.', 'error'); }
}

async function onOutreachStatusChange(sel) {
    const id = sel.dataset.outreachStatus;
    const status = sel.value;
    sel.disabled = true;
    try {
        await ds.updateOutreachLead(id, { status });
        const lead = state.outreachLeads.find(l => l.id === id);
        if (lead) lead.status = status;
        window.showToast('Status updated', 'success');
    } catch (_) {
        window.showToast('Could not update status', 'error');
    } finally { sel.disabled = false; }
}

// =============================================================================
// Vouchers tab
// =============================================================================
function voucherDisplayStatus(v) {
    if (v.status === 'active' && v.valid_until && toDate(v.valid_until) < new Date()) return 'expired';
    return v.status || 'active';
}

function voucherValidityText(v) {
    const from = v.valid_from ? fmtDate(v.valid_from) : null;
    const until = v.valid_until ? fmtDate(v.valid_until) : null;
    if (!from && !until) return 'Always';
    if (from && until) return `${from} – ${until}`;
    if (from) return `From ${from}`;
    return `Until ${until}`;
}

function voucherPlansText(v) {
    if (!Array.isArray(v.allowed_plan_ids) || !v.allowed_plan_ids.length) return 'All plans';
    return v.allowed_plan_ids.map(id => VOUCHER_PLAN_NAMES[id] || id).join(', ');
}

function voucherFrequencyText(v) {
    if (!Array.isArray(v.allowed_billing_frequencies) || !v.allowed_billing_frequencies.length
        || v.allowed_billing_frequencies.length === 2) return 'Monthly & annual';
    return v.allowed_billing_frequencies[0] === 'monthly' ? 'Monthly only' : 'Annual only';
}

function renderVouchersTab() {
    // KPI cards — counted redemptions exclude cancelled ones.
    const counted = state.voucherRedemptions.filter(r => r.status !== 'cancelled');
    const now = Date.now();
    const soonMs = 7 * 24 * 60 * 60 * 1000;
    const activeCount = state.vouchers.filter(v => voucherDisplayStatus(v) === 'active').length;
    const expiringSoon = state.vouchers.filter(v => {
        if (voucherDisplayStatus(v) !== 'active' || !v.valid_until) return false;
        const until = toDate(v.valid_until)?.getTime();
        return until != null && until - now <= soonMs && until >= now;
    }).length;
    const discountGiven = counted.reduce((sum, r) => sum + (Number(r.discount_amount) || 0), 0);
    const dot = { neutral: '#94A3B8', blue: '#1D4ED8', amber: '#D97706', green: '#16A34A', red: '#DC2626' };
    const cards = [
        { label: 'Active vouchers', value: String(activeCount), tone: 'green' },
        { label: 'Total redemptions', value: String(counted.length), tone: 'blue' },
        { label: 'Discount given', value: fmtMoney(discountGiven), tone: 'neutral' },
        { label: 'Expiring soon', value: String(expiringSoon), tone: 'amber' }
    ];
    $('voucher-kpis').innerHTML = cards.map(c => `
        <div class="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
            <div class="flex items-center gap-2 mb-2">
                <span class="w-1.5 h-1.5 rounded-full" style="background:${dot[c.tone]}"></span>
                <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500">${escapeHtml(c.label)}</span>
            </div>
            <div class="mono text-[24px] font-semibold leading-none">${escapeHtml(c.value)}</div>
        </div>`).join('');

    const tbody = $('vouchers-tbody');
    const stateEl = $('vouchers-state');
    if (!state.vouchers.length) {
        tbody.innerHTML = '';
        stateEl.classList.remove('hidden');
        stateEl.innerHTML = stateBlock('No voucher codes yet', 'Create a voucher to offer a percentage discount at checkout.');
        return;
    }
    stateEl.classList.add('hidden');
    tbody.innerHTML = state.vouchers.map(v => {
        const display = voucherDisplayStatus(v);
        const usage = `${v.redemption_count || 0} / ${v.max_redemptions == null ? '∞' : v.max_redemptions}`;
        return `<tr class="hover:bg-gray-50/60">
            <td class="px-5 py-3.5"><span class="vcode text-gray-900">${escapeHtml(v.code)}</span></td>
            <td class="px-5 py-3.5 mono text-[13px] text-gray-700">${escapeHtml(String(v.discount_value))}%</td>
            <td class="px-5 py-3.5">${badge(display, VOUCHER_STATUS_TONE)}</td>
            <td class="px-5 py-3.5 mono text-[13px] text-gray-700">${escapeHtml(usage)}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-600 whitespace-nowrap">${escapeHtml(voucherValidityText(v))}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-600 max-w-[180px] truncate">${escapeHtml(voucherPlansText(v))}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-600">${escapeHtml(v.created_by || '—')}</td>
            <td class="px-5 py-3.5 text-[13px] text-gray-500">${fmtDate(v.created_at)}</td>
            <td class="px-5 py-3.5 text-right whitespace-nowrap">
                <button type="button" class="voucher-action-trigger" data-voucher-menu="${escapeHtml(v.code)}"
                    aria-haspopup="menu" aria-label="Voucher actions for ${escapeHtml(v.code)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ----- Create voucher drawer -----
function generateVoucherCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function openVoucherCreateDrawer() {
    openDrawerShell('Create voucher', 'voucher-create');
    const todayKey = window.FluxyDateRangePicker?.getDayKey?.() || '';
    const dates = { from: null, until: null };

    $('internal-drawer-body').innerHTML = `
        <div class="flex flex-col gap-4">
            <div>
                <label class="vform-label" for="voucher-code-input">Voucher code</label>
                <div class="flex gap-2">
                    <input id="voucher-code-input" class="vform-input vcode" style="text-transform:uppercase" maxlength="32"
                        placeholder="LAUNCH20" autocomplete="off" spellcheck="false">
                    <button type="button" id="voucher-generate"
                        class="flex-shrink-0 text-[13px] font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 hover:bg-gray-50 transition-colors">Generate</button>
                </div>
                <p class="text-[11px] text-gray-400 mt-1.5">4–32 characters: A–Z, 0–9, hyphen, underscore.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="vform-label" for="voucher-discount-input">Discount %</label>
                    <input id="voucher-discount-input" class="vform-input mono" type="number" min="1" max="100" step="1" placeholder="20">
                </div>
                <div>
                    <label class="vform-label" for="voucher-max-input">Max redemptions</label>
                    <input id="voucher-max-input" class="vform-input mono" type="number" min="1" step="1" placeholder="Unlimited">
                </div>
            </div>
            <div>
                <label class="vform-check"><input type="checkbox" id="voucher-from-toggle"> Set start date</label>
                <div id="voucher-from-picker" class="hidden mt-1"></div>
            </div>
            <div>
                <label class="vform-check"><input type="checkbox" id="voucher-until-toggle"> Set expiry date</label>
                <div id="voucher-until-picker" class="hidden mt-1"></div>
                <p class="text-[11px] text-amber-600 mt-1.5" id="voucher-unlimited-warning">No expiry and unlimited redemptions can create uncontrolled discounts.</p>
            </div>
            <div>
                <span class="vform-label">Applies to plans</span>
                <label class="vform-check"><input type="checkbox" id="voucher-plan-all" checked> All plans</label>
                <div id="voucher-plan-options" class="hidden pl-1">
                    <label class="vform-check"><input type="checkbox" value="starter" data-voucher-plan> Starter</label>
                    <label class="vform-check"><input type="checkbox" value="core" data-voucher-plan> Core Ops</label>
                    <label class="vform-check"><input type="checkbox" value="growth" data-voucher-plan> Growth Engine</label>
                    <label class="vform-check"><input type="checkbox" value="enterprise" data-voucher-plan> Enterprise AI</label>
                </div>
            </div>
            <div>
                <span class="vform-label">Applies to billing frequency</span>
                <label class="vform-check"><input type="radio" name="voucher-frequency" value="" checked> Monthly &amp; annual</label>
                <label class="vform-check"><input type="radio" name="voucher-frequency" value="monthly"> Monthly only</label>
                <label class="vform-check"><input type="radio" name="voucher-frequency" value="annually"> Annual only</label>
            </div>
            <div>
                <label class="vform-label" for="voucher-notes-input">Internal note (optional)</label>
                <textarea id="voucher-notes-input" class="internal-note-input" rows="2" style="margin-top:0" placeholder="Campaign or reason — never shown to users"></textarea>
            </div>
            <p id="voucher-form-error" class="hidden text-[12px] text-red-600 font-medium"></p>
            <button type="button" id="voucher-create-submit"
                class="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors active:scale-[.99]">Create voucher</button>
        </div>`;

    // Validity dates use the shared FluxyDateRangePicker (single-date mode, far
    // maxDate so future expiry is selectable — same approach as bill due dates).
    const mountVoucherDatePicker = (hostId, key) => {
        dates[key] = todayKey;
        window.FluxyDateRangePicker?.mount?.(`#${hostId}`, {
            mode: 'single',
            start: todayKey,
            end: todayKey,
            defaultStart: todayKey,
            defaultEnd: todayKey,
            maxDate: '2099-12-31',
            onChange: ({ start }) => { dates[key] = start; }
        });
    };
    const wireDateToggle = (toggleId, hostId, key) => {
        let mounted = false;
        $(toggleId).addEventListener('change', (e) => {
            const on = e.target.checked;
            $(hostId).classList.toggle('hidden', !on);
            if (on && !mounted) { mountVoucherDatePicker(hostId, key); mounted = true; }
            if (!on) dates[key] = null;
            if (on && mounted && dates[key] == null) dates[key] = todayKey;
        });
    };
    wireDateToggle('voucher-from-toggle', 'voucher-from-picker', 'from');
    wireDateToggle('voucher-until-toggle', 'voucher-until-picker', 'until');

    $('voucher-generate').addEventListener('click', () => {
        $('voucher-code-input').value = generateVoucherCode();
    });
    $('voucher-code-input').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    });
    $('voucher-plan-all').addEventListener('change', (e) => {
        $('voucher-plan-options').classList.toggle('hidden', e.target.checked);
    });
    $('voucher-create-submit').addEventListener('click', () => submitVoucherCreate(dates));
}

// Day key ('YYYY-MM-DD') → local Date. Start dates use local midnight, expiry
// dates the local end of day, so "valid until June 30" covers the whole day in
// the admin's timezone (never UTC-midnight drift).
function dayKeyToLocalDate(dayKey, endOfDay) {
    if (!dayKey) return null;
    const [y, m, d] = dayKey.split('-').map(Number);
    return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

async function submitVoucherCreate(dates) {
    const errorEl = $('voucher-form-error');
    const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
    errorEl.classList.add('hidden');

    const code = ds.normalizeVoucherCode($('voucher-code-input').value);
    if (!code) { showError('Enter a valid code: 4–32 characters, A–Z, 0–9, hyphen, underscore.'); return; }
    const discountRaw = $('voucher-discount-input').value.trim();
    const discountValue = Number(discountRaw);
    if (!discountRaw || !Number.isInteger(discountValue) || discountValue < 1 || discountValue > 100) {
        showError('Discount must be a whole number from 1 to 100.');
        return;
    }
    const maxRaw = $('voucher-max-input').value.trim();
    const maxRedemptions = maxRaw === '' ? null : Number(maxRaw);
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
        showError('Max redemptions must be empty (unlimited) or a positive whole number.');
        return;
    }
    const validFrom = $('voucher-from-toggle').checked ? dayKeyToLocalDate(dates.from, false) : null;
    const validUntil = $('voucher-until-toggle').checked ? dayKeyToLocalDate(dates.until, true) : null;
    if (validFrom && validUntil && validUntil <= validFrom) {
        showError('Expiry date must be after the start date.');
        return;
    }
    let allowedPlanIds = null;
    if (!$('voucher-plan-all').checked) {
        allowedPlanIds = Array.from(document.querySelectorAll('[data-voucher-plan]:checked')).map(el => el.value);
        if (!allowedPlanIds.length) { showError('Select at least one plan, or choose All plans.'); return; }
    }
    const frequencyValue = document.querySelector('input[name="voucher-frequency"]:checked')?.value || '';
    const allowedFrequencies = frequencyValue ? [frequencyValue] : null;

    if (discountValue === 100) {
        const ok = await window.showConfirmDialog({
            title: 'Create a 100% discount voucher?',
            body: `<strong>${escapeHtml(code)}</strong> will make checkout completely free for every redemption.`,
            confirmLabel: 'Create 100% voucher',
            tone: 'danger'
        });
        if (!ok) return;
    } else if (discountValue > 50) {
        const ok = await window.showConfirmDialog({
            title: `Create a ${discountValue}% discount voucher?`,
            body: `<strong>${escapeHtml(code)}</strong> discounts more than half the plan price. Double-check the percentage before creating it.`,
            confirmLabel: 'Create voucher'
        });
        if (!ok) return;
    }

    const submitBtn = $('voucher-create-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    try {
        await ds.createVoucherCode({
            code,
            discount_value: discountValue,
            max_redemptions: maxRedemptions,
            valid_from: validFrom,
            valid_until: validUntil,
            allowed_plan_ids: allowedPlanIds,
            allowed_billing_frequencies: allowedFrequencies,
            notes: $('voucher-notes-input').value,
            created_by: ACTOR_USERNAME
        }, { actor_username: ACTOR_USERNAME });
        window.showToast(`Voucher ${code} created`, 'success');
        closeDrawer();
        await loadData();
        switchTab('vouchers');
    } catch (err) {
        const copy = {
            'voucher-exists': 'This voucher code already exists. Pick a different code.',
            'invalid-voucher-code': 'Enter a valid code: 4–32 characters, A–Z, 0–9, hyphen, underscore.',
            'invalid-discount-value': 'Discount must be a whole number from 1 to 100.',
            'invalid-max-redemptions': 'Max redemptions must be empty (unlimited) or a positive whole number.',
            'invalid-date-range': 'Expiry date must be after the start date.'
        }[err?.message];
        showError(copy || 'Could not create the voucher. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create voucher';
    }
}

// ----- Row action menu (pencil dropdown) -----
let voucherMenuEl = null;
let voucherMenuTrigger = null;

function closeVoucherMenu() {
    if (voucherMenuEl) { voucherMenuEl.remove(); voucherMenuEl = null; }
    if (voucherMenuTrigger) { voucherMenuTrigger.classList.remove('is-open'); voucherMenuTrigger = null; }
    document.removeEventListener('scroll', closeVoucherMenu, true);
    window.removeEventListener('resize', closeVoucherMenu);
}

const VOUCHER_MENU_ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    usage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
    extend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>',
    disable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
};

function openVoucherActionMenu(trigger, code) {
    const reopen = voucherMenuTrigger === trigger;
    closeVoucherMenu();
    if (reopen) return; // clicking the open trigger again just closes it
    const v = state.vouchers.find(x => x.code === code);
    if (!v) return;

    const items = [
        { act: 'copy', label: 'Copy code' },
        { act: 'usage', label: 'View usage' },
        { act: 'extend', label: v.valid_until ? 'Extend expiry' : 'Set expiry' }
    ];
    if (v.status === 'active') items.push({ act: 'disable', label: 'Disable' });
    items.push({ divider: true });
    items.push({ act: 'delete', label: 'Delete', danger: true });

    const menu = document.createElement('div');
    menu.className = 'voucher-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(it => it.divider
        ? '<div class="voucher-menu-divider"></div>'
        : `<button type="button" role="menuitem" class="voucher-menu-item${it.danger ? ' is-danger' : ''}"
                data-voucher-act="${it.act}" data-voucher-code="${escapeHtml(code)}">
                ${VOUCHER_MENU_ICONS[it.act] || ''}<span>${it.label}</span>
            </button>`).join('');
    document.body.appendChild(menu);
    voucherMenuEl = menu;
    voucherMenuTrigger = trigger;
    trigger.classList.add('is-open');
    positionVoucherMenu(menu, trigger);
    document.addEventListener('scroll', closeVoucherMenu, true);
    window.addEventListener('resize', closeVoucherMenu);
}

// Right-align the menu under the trigger; flip above when there isn't room below.
function positionVoucherMenu(menu, trigger) {
    const r = trigger.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const gap = 6;
    let left = r.right - mw;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + gap;
    if (top + mh > window.innerHeight - 8 && r.top - gap - mh > 8) top = r.top - gap - mh;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
}

function runVoucherMenuAction(act, code) {
    closeVoucherMenu();
    if (act === 'copy') {
        navigator.clipboard?.writeText(code)
            .then(() => window.showToast('Voucher code copied', 'success'))
            .catch(() => window.showToast('Could not copy the code', 'error'));
    } else if (act === 'usage') {
        openVoucherUsageDrawer(code);
    } else if (act === 'extend') {
        openVoucherExtendDrawer(code);
    } else if (act === 'disable') {
        disableVoucher(code);
    } else if (act === 'delete') {
        deleteVoucher(code);
    }
}

// ----- Extend Trial (Users tab) -----
// Reuses the portaled voucher-menu shell (open/close/position + the delegated
// outside-click/scroll/resize/Escape handlers) so trial actions look and behave
// like the voucher row menu.
const TRIAL_EXTEND_OPTIONS = [
    { duration: '1w', label: 'Extend by 1 week' },
    { duration: '2w', label: 'Extend by 2 weeks' },
    { duration: '1m', label: 'Extend by 1 month' }
];

function openTrialExtendMenu(trigger, uid) {
    const reopen = voucherMenuTrigger === trigger;
    closeVoucherMenu();
    if (reopen) return; // clicking the open trigger again just closes it

    const menu = document.createElement('div');
    menu.className = 'voucher-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = TRIAL_EXTEND_OPTIONS.map(it =>
        `<button type="button" role="menuitem" class="voucher-menu-item"
            data-trial-act="${it.duration}" data-trial-uid="${escapeHtml(uid)}">
            ${VOUCHER_MENU_ICONS.extend}<span>${it.label}</span>
        </button>`).join('');
    document.body.appendChild(menu);
    voucherMenuEl = menu;
    voucherMenuTrigger = trigger;
    trigger.classList.add('is-open');
    positionVoucherMenu(menu, trigger);
    document.addEventListener('scroll', closeVoucherMenu, true);
    window.addEventListener('resize', closeVoucherMenu);
}

async function runTrialExtend(uid, duration) {
    closeVoucherMenu();
    const opt = TRIAL_EXTEND_OPTIONS.find(o => o.duration === duration);
    if (!uid || !opt) return;
    try {
        const res = await fetch(EXTEND_TRIAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_API_TOKEN },
            body: JSON.stringify({ uid, duration, actor_username: ACTOR_USERNAME })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data && data.error === 'not_trialing'
                ? 'This account is no longer on a trial.'
                : `Could not extend trial (${(data && data.error) || res.status}).`;
            window.showToast(msg, 'error');
            if (data && data.error === 'not_trialing') { await loadData(); renderAll(); }
            return;
        }
        // Patch the in-memory row so Access badge + Trial left + the Extend
        // gating all refresh without a full reload.
        const row = state.users.find(u => (u.user_id || u.id) === uid);
        if (row) {
            row.access_status = data.access_status;
            row.trial_days_remaining = data.trial_days_remaining;
            row.trial_ends_at = data.trial_ends_at;
        }
        renderUsersTab();
        window.showToast(`Trial extended by ${opt.label.replace('Extend by ', '')}`, 'success');
    } catch (e) {
        window.showToast('Could not reach the trial service.', 'error');
    }
}

// ----- Extend / set expiry -----
function openVoucherExtendDrawer(code) {
    const v = state.vouchers.find(x => x.code === code);
    if (!v) return;
    openDrawerShell(`Extend ${code}`, 'voucher-extend');

    const todayKey = window.FluxyDateRangePicker?.getDayKey?.() || '';
    const currentUntil = v.valid_until ? toDate(v.valid_until) : null;
    const currentKey = currentUntil ? window.FluxyDateRangePicker?.getDayKey?.(currentUntil) : null;
    const startKey = currentKey || todayKey;
    const picked = { until: startKey };

    $('internal-drawer-body').innerHTML = `
        <div class="flex flex-col gap-4">
            <div class="idrawer-section" style="margin-top:0">
                <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Current</h3>
                ${row('Code', `<span class="vcode">${escapeHtml(v.code)}</span>`)}
                ${row('Status', badge(voucherDisplayStatus(v), VOUCHER_STATUS_TONE))}
                ${row('Expiry', escapeHtml(currentUntil ? fmtDate(v.valid_until) : 'No expiry (Always)'))}
            </div>
            <div>
                <span class="vform-label">New expiry date</span>
                <div id="voucher-extend-picker" class="mt-1"></div>
                <p class="text-[11px] text-gray-400 mt-1.5">The voucher stays valid through the end of the selected day. Pushing it past today re-activates an expired code.</p>
            </div>
            <p id="voucher-extend-error" class="hidden text-[12px] text-red-600 font-medium"></p>
            <button type="button" id="voucher-extend-submit"
                class="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors active:scale-[.99]">Save new expiry</button>
        </div>`;

    window.FluxyDateRangePicker?.mount?.('#voucher-extend-picker', {
        mode: 'single',
        start: startKey,
        end: startKey,
        defaultStart: startKey,
        defaultEnd: startKey,
        maxDate: '2099-12-31',
        onChange: ({ start }) => { picked.until = start; }
    });

    $('voucher-extend-submit').addEventListener('click', () => submitVoucherExtend(code, picked));
}

async function submitVoucherExtend(code, picked) {
    const errorEl = $('voucher-extend-error');
    errorEl.classList.add('hidden');
    const validUntil = dayKeyToLocalDate(picked.until, true);
    if (!validUntil) { errorEl.textContent = 'Pick a new expiry date.'; errorEl.classList.remove('hidden'); return; }
    const v = state.vouchers.find(x => x.code === code);
    const validFrom = v?.valid_from ? toDate(v.valid_from) : null;
    if (validFrom && validUntil <= validFrom) {
        errorEl.textContent = 'Expiry date must be after the voucher start date.';
        errorEl.classList.remove('hidden');
        return;
    }
    const btn = $('voucher-extend-submit');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await ds.updateVoucherCode(code, { valid_until: validUntil }, {
            actor_username: ACTOR_USERNAME,
            before: { valid_until: v?.valid_until ? fmtDate(v.valid_until) : null },
            after: { valid_until: fmtDate(validUntil) }
        });
        window.showToast(`Voucher ${code} expiry updated`, 'success');
        closeDrawer();
        await loadData();
        switchTab('vouchers');
    } catch (err) {
        console.error('[internal] voucher extend failed', err);
        errorEl.textContent = 'Could not update the expiry. Please try again.';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Save new expiry';
    }
}

// ----- Delete -----
async function deleteVoucher(code) {
    const v = state.vouchers.find(x => x.code === code);
    if (!v) return;
    const used = Number(v.redemption_count) || 0;
    const usedNote = used > 0
        ? ` It has <strong>${used}</strong> redemption${used === 1 ? '' : 's'}; those records are kept for history.`
        : '';
    const ok = await window.showConfirmDialog({
        title: 'Delete voucher?',
        body: `<strong>${escapeHtml(code)}</strong> will be permanently removed and can no longer be used at checkout.${usedNote} This cannot be undone.`,
        confirmLabel: 'Delete voucher',
        tone: 'danger',
        icon: 'trash'
    });
    if (!ok) return;
    try {
        await ds.deleteVoucherCode(code, { actor_username: ACTOR_USERNAME });
        window.showToast(`Voucher ${code} deleted`, 'success');
        await loadData();
        switchTab('vouchers');
    } catch (err) {
        console.error('[internal] voucher delete failed', err);
        window.showToast('Could not delete the voucher. Please try again.', 'error');
    }
}

// ----- Disable + usage -----
async function disableVoucher(code) {
    const v = state.vouchers.find(x => x.code === code);
    if (!v) return;
    const ok = await window.showConfirmDialog({
        title: 'Disable voucher?',
        body: `<strong>${escapeHtml(code)}</strong> will stop working at checkout immediately. Past redemptions are kept.`,
        confirmLabel: 'Disable voucher',
        tone: 'danger'
    });
    if (!ok) return;
    try {
        await ds.disableVoucherCode(code, null, { actor_username: ACTOR_USERNAME });
        window.showToast(`Voucher ${code} disabled`, 'success');
        await loadData();
        switchTab('vouchers');
    } catch (err) {
        console.error('[internal] voucher disable failed', err);
        window.showToast('Could not disable the voucher. Please try again.', 'error');
    }
}

function openVoucherUsageDrawer(code) {
    const v = state.vouchers.find(x => x.code === code);
    if (!v) return;
    openDrawerShell(`Voucher ${code}`, 'voucher-usage');
    const redemptions = state.voucherRedemptions.filter(r => r.voucher_id === code);
    const usage = `${v.redemption_count || 0} / ${v.max_redemptions == null ? '∞' : v.max_redemptions}`;

    const summary = `<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Voucher</h3>
        ${row('Code', `<span class="vcode">${escapeHtml(v.code)}</span>`)}
        ${row('Discount', `${escapeHtml(String(v.discount_value))}%`, true)}
        ${row('Status', badge(voucherDisplayStatus(v), VOUCHER_STATUS_TONE))}
        ${row('Usage', escapeHtml(usage), true)}
        ${row('Validity', escapeHtml(voucherValidityText(v)))}
        ${row('Plans', escapeHtml(voucherPlansText(v)))}
        ${row('Billing frequency', escapeHtml(voucherFrequencyText(v)))}
        ${row('Created by', escapeHtml(v.created_by || '—'))}
        ${row('Created', fmtDate(v.created_at))}
        ${v.notes ? row('Internal note', escapeHtml(v.notes)) : ''}
    </div>`;

    const list = redemptions.length
        ? `<div class="flex flex-col">${redemptions.map(r => {
            const user = findUser(r.user_id);
            const name = user ? userDisplayName(user) : (r.user_id || '—');
            return `<div class="flex items-center justify-between gap-3 py-2.5 border-b border-gray-100">
                <div class="min-w-0">
                    <div class="text-[13px] font-medium text-gray-900 truncate max-w-[200px]">${escapeHtml(name)}</div>
                    <div class="text-[12px] text-gray-500">${escapeHtml(VOUCHER_PLAN_NAMES[r.plan_id] || r.plan_id || '—')} · ${escapeHtml(r.billing_frequency === 'annually' ? 'Annual' : 'Monthly')} · ${fmtDateTime(r.created_at)}</div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="mono text-[13px] text-gray-700">−${fmtMoney(r.discount_amount)}</span>
                    ${badge(r.status, REDEMPTION_STATUS_TONE)}
                </div>
            </div>`;
        }).join('')}</div>`
        : stateBlock('No redemptions yet', 'Checkout redemptions for this voucher will appear here.');

    $('internal-drawer-body').innerHTML = `${summary}
        <div class="idrawer-section">
            <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Redemptions</h3>
            ${list}
        </div>`;
}

// =============================================================================
// Tabs
// =============================================================================
function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.itab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    document.querySelectorAll('.itab-panel').forEach(p => p.classList.add('hidden'));
    $(`panel-${tab}`).classList.remove('hidden');
}

// =============================================================================
// Review drawer
// =============================================================================
// Shared slide-in shell — the user review drawer and the voucher drawers all
// reuse #internal-drawer; the mode + title distinguish them.
function openDrawerShell(title, mode) {
    state.drawerMode = mode;
    $('internal-drawer-title').textContent = title;
    const drawer = $('internal-drawer');
    drawer.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    requestAnimationFrame(() => $('internal-drawer-panel').classList.remove('translate-x-full'));
}

function openDrawer(userId) {
    const u = findUser(userId);
    if (!u) return;
    state.drawerUserId = userId;
    renderDrawer(u);
    openDrawerShell('Review user', 'user');
}

function closeDrawer() {
    $('internal-drawer-panel').classList.add('translate-x-full');
    document.body.classList.remove('overflow-hidden');
    state.drawerUserId = null;
    state.drawerMode = null;
    setTimeout(() => $('internal-drawer').classList.add('hidden'), 300);
}

function row(k, v, mono) {
    return `<div class="idrawer-row"><span class="k">${escapeHtml(k)}</span><span class="v ${mono ? 'mono' : ''}">${v}</span></div>`;
}

function renderDrawer(u) {
    const uid = u.user_id || u.id;
    const hasProfile = !!(u.business_name || u.role || u.phone_number);
    const kycSubmitted = !!toDate(u.kyc_submitted_at) || ['submitted', 'needs_revision', 'approved', 'rejected'].includes(u.kyc_status);

    const sections = [];

    // Account summary
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Account summary</h3>
        ${row('Firebase UID', escapeHtml(uid), true)}
        ${row('Email', escapeHtml(u.email || '—'))}
        ${row('Display name', escapeHtml(u.display_name || '—'))}
        ${row('Account status', badge(u.account_status, ACCOUNT_TONE))}
        ${row('Created', fmtDate(u.created_at))}
        ${row('Last updated', fmtDateTime(u.updated_at))}
    </div>`);

    // Trial & payment access (mirrored from users/{uid}/billing/access)
    const hasTrial = !!(u.access_status || toDate(u.trial_started_at) || toDate(u.trial_ends_at));
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Trial &amp; payment</h3>
        ${hasTrial ? `
            ${row('Access', accessBadge(u))}
            ${row('Trial started', fmtDate(u.trial_started_at))}
            ${row('Trial ends', fmtDate(u.trial_ends_at))}
            ${row('Days remaining', u.trial_days_remaining != null ? String(u.trial_days_remaining) : '—')}
            ${row('Payment status', badge(u.payment_status, PAYMENT_TONE))}
            ${row('Account status', badge(u.account_status, ACCOUNT_TONE))}
        ` : `<p class="text-[13px] text-gray-500 py-2">No trial/billing record yet. The trial starts after the user completes onboarding.</p>`}
    </div>`);

    // Onboarding profile
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Business &amp; onboarding</h3>
        ${hasProfile || u.onboarding_completed ? `
            ${row('Business name', escapeHtml(u.business_name || '—'))}
            ${row('Role', escapeHtml(u.role || '—'))}
            ${row('Onboarding', u.onboarding_completed ? badge('completed', { completed: 'green' }) : badge('in_progress', { in_progress: 'amber' }))}
        ` : `<p class="text-[13px] text-gray-500 py-2">Onboarding profile has not been submitted yet.</p>`}
    </div>`);

    // KYC
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">KYC</h3>
        ${kycSubmitted ? `
            ${row('Phone / WhatsApp', escapeHtml(u.phone_number || '—'), true)}
            ${row('KYC status', badge(u.kyc_status, KYC_TONE))}
            ${row('Submitted', fmtDate(u.kyc_submitted_at))}
            ${row('Reviewed', fmtDate(u.kyc_reviewed_at))}
        ` : `<p class="text-[13px] text-gray-500 py-2">KYC data has not been submitted yet.</p>`}
    </div>`);

    // Payment
    const hasPayment = u.payment_status && u.payment_status !== 'not_required' && u.payment_status !== 'pending';
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Payment verification</h3>
        ${row('Payment status', badge(u.payment_status, PAYMENT_TONE))}
        ${hasPayment ? `
            ${row('Plan', escapeHtml(u.plan_id || '—'))}
            ${row('Amount', fmtMoney(u.payment_amount), true)}
            ${row('Submitted', fmtDate(u.payment_submitted_at))}
            ${row('Verified', fmtDate(u.payment_verified_at))}
        ` : `<p class="text-[13px] text-gray-500 py-2">No payment verification record yet.</p>`}
    </div>`);

    // Internal note
    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-1">Last internal note</h3>
        <p class="text-[13px] ${u.last_internal_note ? 'text-gray-700' : 'text-gray-400'} py-1">${escapeHtml(u.last_internal_note || 'No internal note recorded.')}</p>
    </div>`);

    // Actions
    const canActivate = u.kyc_status === 'approved' && u.payment_status === 'verified';
    const kycApprovable = u.kyc_status === 'submitted' || u.kyc_status === 'needs_revision';
    const kycRevisable = u.kyc_status === 'submitted' || u.kyc_status === 'approved';
    const kycRejectable = u.kyc_status !== 'rejected';
    const payUnderReviewable = u.payment_status === 'submitted' || u.payment_status === 'pending';
    const payVerifiable = ['submitted', 'under_review', 'pending'].includes(u.payment_status);
    const payRejectable = u.payment_status !== 'rejected';
    const suspendable = u.account_status !== 'suspended';

    sections.push(`<div class="idrawer-section">
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-2">KYC actions</h3>
        <div class="flex flex-col gap-2">
            <button class="iaction-btn" data-act="kyc.approve" ${kycApprovable ? '' : 'disabled'}>Approve KYC</button>
            <button class="iaction-btn" data-act="kyc.request_revision" ${kycRevisable ? '' : 'disabled'}>Request KYC revision</button>
            <button class="iaction-btn is-danger" data-act="kyc.reject" ${kycRejectable ? '' : 'disabled'}>Reject KYC</button>
        </div>
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-2 mt-5">Payment actions</h3>
        <div class="flex flex-col gap-2">
            <button class="iaction-btn" data-act="payment.under_review" ${payUnderReviewable ? '' : 'disabled'}>Mark payment under review</button>
            <button class="iaction-btn" data-act="payment.verify" ${payVerifiable ? '' : 'disabled'}>Verify payment</button>
            <button class="iaction-btn is-danger" data-act="payment.reject" ${payRejectable ? '' : 'disabled'}>Reject payment</button>
        </div>
        <h3 class="text-[12px] font-bold uppercase tracking-wider text-gray-500 mb-2 mt-5">Account</h3>
        <div class="flex flex-col gap-2">
            <button class="iaction-btn" data-act="user.activate" ${canActivate ? '' : 'disabled'}>Activate user</button>
            <button class="iaction-btn is-danger" data-act="user.suspend" ${suspendable ? '' : 'disabled'}>Suspend user</button>
        </div>
        ${canActivate ? '' : '<p class="text-[12px] text-gray-400 mt-2">Activation requires KYC approved and payment verified.</p>'}
    </div>`);

    $('internal-drawer-body').innerHTML = sections.join('');
}

// =============================================================================
// Note-capture dialog (reuses the canonical .fluxy-dialog look)
// Returns Promise<{ confirmed:boolean, note:string }>
// =============================================================================
function showNoteDialog({ title, body = '', confirmLabel = 'Confirm', tone = 'default', required = false }) {
    return new Promise((resolve) => {
        document.getElementById('internal-note-dialog')?.remove();
        const isDanger = tone === 'danger';
        const wrap = document.createElement('div');
        wrap.id = 'internal-note-dialog';
        wrap.className = 'fluxy-dialog';
        wrap.innerHTML = `
            <div class="fluxy-dialog-overlay" data-act="cancel"></div>
            <div class="fluxy-dialog-card" role="dialog" aria-modal="true">
                <h3 class="fluxy-dialog-title">${escapeHtml(title)}</h3>
                <div class="fluxy-dialog-body">
                    ${body ? `<p style="margin-bottom:10px">${body}</p>` : ''}
                    <textarea id="internal-note-textarea" class="internal-note-input" rows="3" placeholder="${required ? 'Reviewer note (required)' : 'Reviewer note (optional)'}"></textarea>
                    <p id="internal-note-err" class="hidden" style="color:#B91C1C;font-size:12px;margin-top:6px">A reviewer note is required.</p>
                </div>
                <div class="fluxy-dialog-actions">
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--ghost" data-act="cancel">Cancel</button>
                    <button type="button" class="fluxy-dialog-btn fluxy-dialog-btn--primary ${isDanger ? 'is-danger' : ''}" data-act="confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>`;
        document.body.appendChild(wrap);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const textarea = wrap.querySelector('#internal-note-textarea');
        const errEl = wrap.querySelector('#internal-note-err');
        setTimeout(() => textarea.focus(), 50);

        const close = (confirmed, note) => {
            document.removeEventListener('keydown', onKey);
            wrap.classList.add('is-closing');
            setTimeout(() => { wrap.remove(); document.body.style.overflow = prevOverflow; resolve({ confirmed, note }); }, 140);
        };
        const tryConfirm = () => {
            const note = textarea.value.trim();
            if (required && !note) { errEl.classList.remove('hidden'); textarea.focus(); return; }
            close(true, note);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(false, '');
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) tryConfirm();
        };
        wrap.addEventListener('click', (e) => {
            const act = e.target?.closest('[data-act]')?.dataset?.act;
            if (act === 'confirm') tryConfirm();
            else if (act === 'cancel') close(false, '');
        });
        document.addEventListener('keydown', onKey);
    });
}

// =============================================================================
// Status actions
// =============================================================================
const ACTION_CONFIG = {
    'kyc.approve': { label: 'Approve KYC', confirmLabel: 'Approve KYC', tone: 'default', note: 'none' },
    'kyc.request_revision': { label: 'Request KYC revision', confirmLabel: 'Request revision', tone: 'default', note: 'required' },
    'kyc.reject': { label: 'Reject KYC', confirmLabel: 'Reject KYC', tone: 'danger', note: 'required' },
    'payment.under_review': { label: 'Mark payment under review', confirmLabel: 'Mark under review', tone: 'default', note: 'none' },
    'payment.verify': { label: 'Verify payment', confirmLabel: 'Verify payment', tone: 'default', note: 'none' },
    'payment.reject': { label: 'Reject payment', confirmLabel: 'Reject payment', tone: 'danger', note: 'required' },
    'user.activate': { label: 'Activate user', confirmLabel: 'Activate user', tone: 'default', note: 'none' },
    'user.suspend': { label: 'Suspend user', confirmLabel: 'Suspend user', tone: 'danger', note: 'required' }
};

// Build the status payload + before/after snapshot for an action. Returns null
// if the action is not allowed for the user's current state.
function buildTransition(action, u) {
    const before = { account_status: u.account_status, kyc_status: u.kyc_status, payment_status: u.payment_status };
    let payload = null;

    switch (action) {
        case 'kyc.approve':
            if (!(u.kyc_status === 'submitted' || u.kyc_status === 'needs_revision')) return null;
            payload = { kyc_status: 'approved', account_status: u.payment_status === 'verified' ? 'active' : 'payment_pending' };
            break;
        case 'kyc.request_revision':
            if (!(u.kyc_status === 'submitted' || u.kyc_status === 'approved')) return null;
            payload = { kyc_status: 'needs_revision', account_status: 'kyc_submitted' };
            break;
        case 'kyc.reject':
            if (u.kyc_status === 'rejected') return null;
            payload = { kyc_status: 'rejected', account_status: 'kyc_rejected' };
            break;
        case 'payment.under_review':
            if (!(u.payment_status === 'submitted' || u.payment_status === 'pending')) return null;
            payload = { payment_status: 'under_review', account_status: 'payment_submitted' };
            break;
        case 'payment.verify':
            if (!['submitted', 'under_review', 'pending'].includes(u.payment_status)) return null;
            payload = { payment_status: 'verified', account_status: u.kyc_status === 'approved' ? 'active' : 'payment_verified' };
            break;
        case 'payment.reject':
            if (u.payment_status === 'rejected') return null;
            payload = { payment_status: 'rejected', account_status: 'payment_pending' };
            break;
        case 'user.activate':
            if (!(u.kyc_status === 'approved' && u.payment_status === 'verified')) return null;
            payload = { account_status: 'active' };
            break;
        case 'user.suspend':
            if (u.account_status === 'suspended') return null;
            payload = { account_status: 'suspended' };
            break;
        default:
            return null;
    }
    const after = { ...before, ...payload };
    return { payload, before, after };
}

async function runAction(action, userId) {
    const cfg = ACTION_CONFIG[action];
    const u = findUser(userId);
    if (!cfg || !u) return;

    const transition = buildTransition(action, u);
    if (!transition) {
        await window.showAlertDialog({ title: 'Action not allowed', body: 'This action is not valid for the user\'s current status. Refresh and try again.', tone: 'danger' });
        return;
    }

    const bodyText = `${escapeHtml(cfg.label)} for <strong>${escapeHtml(userDisplayName(u))}</strong>?`;
    let note = '';
    if (cfg.note === 'required') {
        const res = await showNoteDialog({ title: cfg.label, body: bodyText, confirmLabel: cfg.confirmLabel, tone: cfg.tone, required: true });
        if (!res.confirmed) return;
        note = res.note;
    } else {
        const ok = await window.showConfirmDialog({ title: cfg.label, body: bodyText, confirmLabel: cfg.confirmLabel, tone: cfg.tone });
        if (!ok) return;
    }

    // Build the Firestore payload. Server timestamps + note are added here so the
    // before/after audit snapshot stays free of serverTimestamp sentinels.
    const payload = { ...transition.payload };
    // Stamp a review timestamp on EVERY KYC/payment decision (not just
    // approve/verify) so notification sweeps can gate on recency and never
    // back-email an old decision. See netlify/functions/NOTIFICATIONS.md (NOTIFY_AFTER).
    if (action.startsWith('kyc.')) payload.kyc_reviewed_at = serverTimestamp();
    if (action.startsWith('payment.')) payload.payment_reviewed_at = serverTimestamp();
    if (action === 'payment.verify') payload.payment_verified_at = serverTimestamp();
    if (note) payload.last_internal_note = note;

    try {
        await ds.updateInternalUserStatus(userId, payload, {
            action,
            before: transition.before,
            after: transition.after,
            reason: note || null
        });
        // A verified payment settles the user's reserved voucher redemptions.
        // Best-effort: a redemption-marking failure never blocks the verify.
        if (action === 'payment.verify') {
            try { await ds.markVoucherRedemptionsRedeemed(userId); } catch (_) { /* non-critical */ }
        }
        window.showToast(`${cfg.label} done`, 'success');
        await loadData();
        if (state.drawerUserId === userId) {
            const updated = findUser(userId);
            if (updated) renderDrawer(updated); else closeDrawer();
        }
    } catch (err) {
        console.error('[internal] action failed', action, err);
        window.showToast('Could not complete the action. Please try again.', 'error');
    }
}

// =============================================================================
// Queue a weekly-digest broadcast; a Netlify worker executes it within ~2 min.
async function sendDigestBroadcast() {
    const btn = $('internal-digest-send');
    const ok = await window.showConfirmDialog?.({
        title: 'Send weekly digest now?',
        body: 'This broadcasts <strong>this week’s digest</strong> to all enabled users. Accounts with no finance data are skipped, and each user is only sent once per ISO week. It runs in the background within ~2 minutes.',
        confirmLabel: 'Send to all',
        cancelLabel: 'Cancel',
        tone: 'default'
    });
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
        const jobId = await ds.requestDigestBroadcast('send', 'fluxyos admin');
        window.showToast?.('Digest broadcast queued — sending within ~2 minutes…', 'success');
        const started = Date.now();
        let done = null;
        while (Date.now() - started < 4 * 60 * 1000) {
            await new Promise(r => setTimeout(r, 10000));
            const job = await ds.getDigestBroadcastJob(jobId);
            if (job && (job.status === 'done' || job.status === 'failed')) { done = job; break; }
        }
        if (!done) {
            window.showToast?.('Digest queued. It will send shortly — see the Audit tab for results.', 'success');
        } else if (done.status === 'failed') {
            window.showToast?.('Digest broadcast failed: ' + (done.error || 'unknown error'), 'error');
        } else {
            const r = done.result || {};
            window.showToast?.(`Digest sent to ${r.sent || 0} user(s) · ${r.skippedNoRecords || 0} skipped (no data).`, 'success');
        }
    } catch (e) {
        window.showToast?.('Could not queue the digest broadcast. Try again.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Wiring
// =============================================================================
function initConsoleEvents() {
    $('internal-signout').addEventListener('click', signOut);
    $('internal-refresh').addEventListener('click', () => loadData());
    $('internal-digest-send')?.addEventListener('click', sendDigestBroadcast);

    document.querySelectorAll('.itab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Filters
    const fAccess = $('filter-access'), fAccount = $('filter-account'), fKyc = $('filter-kyc'), fPayment = $('filter-payment');
    fAccess.innerHTML = '<option value="">All access</option>' + ACCESS_FILTER_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    fAccount.innerHTML = '<option value="">All accounts</option>' + ACCOUNT_STATUSES.map(s => `<option value="${s}">${labelize(s)}</option>`).join('');
    fKyc.innerHTML = '<option value="">All KYC</option>' + KYC_STATUSES.map(s => `<option value="${s}">${labelize(s)}</option>`).join('');
    fPayment.innerHTML = '<option value="">All payments</option>' + PAYMENT_STATUSES.map(s => `<option value="${s}">${labelize(s)}</option>`).join('');
    fAccess.addEventListener('change', () => { state.filters.access = fAccess.value; renderUsersTab(); });
    fAccount.addEventListener('change', () => { state.filters.account = fAccount.value; renderUsersTab(); });
    fKyc.addEventListener('change', () => { state.filters.kyc = fKyc.value; renderUsersTab(); });
    fPayment.addEventListener('change', () => { state.filters.payment = fPayment.value; renderUsersTab(); });
    $('users-search').addEventListener('input', (e) => { state.filters.search = e.target.value; renderUsersTab(); });

    // Vouchers
    $('voucher-create-btn').addEventListener('click', openVoucherCreateDrawer);

    // Sales Leads: delegated status change (enquiries + outreach).
    document.addEventListener('change', (e) => {
        const enquiry = e.target.closest('[data-lead-status]');
        if (enquiry) { onLeadStatusChange(enquiry); return; }
        const outreach = e.target.closest('[data-outreach-status]');
        if (outreach) onOutreachStatusChange(outreach);
    });

    // Sales Leads sub-tabs + outreach actions.
    $('leads-subtab-enquiries')?.addEventListener('click', () => switchLeadsView('enquiries'));
    $('leads-subtab-outreach')?.addEventListener('click', () => switchLeadsView('outreach'));
    $('outreach-new-btn')?.addEventListener('click', openOutreachModal);
    document.addEventListener('click', (e) => {
        const resend = e.target.closest('[data-outreach-resend]');
        if (resend) { onOutreachResend(resend.dataset.outreachResend); return; }
        const del = e.target.closest('[data-outreach-delete]');
        if (del) onOutreachDelete(del.dataset.outreachDelete);
    });

    // Drawer
    $('internal-drawer-close').addEventListener('click', closeDrawer);
    $('internal-drawer-overlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (voucherMenuEl) { closeVoucherMenu(); return; }
        if (state.drawerUserId || state.drawerMode) closeDrawer();
    });

    // Delegated clicks: Review, Copy UID, voucher actions, drawer actions
    document.addEventListener('click', (e) => {
        const reviewBtn = e.target.closest('[data-review]');
        if (reviewBtn) { openDrawer(reviewBtn.dataset.review); return; }
        const copyBtn = e.target.closest('[data-copy]');
        if (copyBtn) {
            navigator.clipboard?.writeText(copyBtn.dataset.copy)
                .then(() => window.showToast('UID copied', 'success'))
                .catch(() => window.showToast('Could not copy UID', 'error'));
            return;
        }
        const voucherMenuBtn = e.target.closest('[data-voucher-menu]');
        if (voucherMenuBtn) { openVoucherActionMenu(voucherMenuBtn, voucherMenuBtn.dataset.voucherMenu); return; }
        const voucherActItem = e.target.closest('[data-voucher-act]');
        if (voucherActItem) { runVoucherMenuAction(voucherActItem.dataset.voucherAct, voucherActItem.dataset.voucherCode); return; }
        const extendTrialBtn = e.target.closest('[data-extend-trial]');
        if (extendTrialBtn) { openTrialExtendMenu(extendTrialBtn, extendTrialBtn.dataset.extendTrial); return; }
        const trialActItem = e.target.closest('[data-trial-act]');
        if (trialActItem) { runTrialExtend(trialActItem.dataset.trialUid, trialActItem.dataset.trialAct); return; }
        // Click anywhere else with an open menu closes it.
        if (voucherMenuEl && !e.target.closest('.voucher-menu')) closeVoucherMenu();
        const actBtn = e.target.closest('[data-act]');
        if (actBtn && !actBtn.disabled && state.drawerUserId) {
            runAction(actBtn.dataset.act, state.drawerUserId);
        }
    });
}

function init() {
    initGate();
    initConsoleEvents();
    if (hasSession()) showConsole();
    else showGate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
