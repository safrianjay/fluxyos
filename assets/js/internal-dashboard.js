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
    authDomain: "fluxyos.firebaseapp.com",
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

const state = {
    users: [],
    audit: [],
    loaded: false,
    loadError: false,
    activeTab: 'overview',
    drawerUserId: null,
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
        const [users, audit] = await Promise.all([
            ds.getInternalUsers({ limitCount: 200 }),
            ds.getInternalAuditLogs(100).catch(() => [])
        ]);
        state.users = users || [];
        state.audit = audit || [];
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
    $('users-tbody').innerHTML = shimmerRows(8);
    $('kyc-tbody').innerHTML = shimmerRows(5);
    $('payment-tbody').innerHTML = shimmerRows(6);
    $('audit-tbody').innerHTML = shimmerRows(6);
    ['users-state', 'kyc-state', 'payment-state', 'audit-state'].forEach(id => $(id).classList.add('hidden'));
    $('overview-kpis').innerHTML = Array.from({ length: 4 }).map(() =>
        '<div class="bg-white border border-gray-200 rounded-xl shadow-sm p-4"><div class="ishimmer h-3 w-20 mb-3"></div><div class="ishimmer h-6 w-12"></div></div>'
    ).join('');
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
    const tbodies = { 'users-tbody': 'users-state', 'kyc-tbody': 'kyc-state', 'payment-tbody': 'payment-state', 'audit-tbody': 'audit-state' };
    Object.entries(tbodies).forEach(([tb, st]) => {
        $(tb).innerHTML = '';
        const el = $(st);
        el.classList.remove('hidden');
        el.innerHTML = stateBlock('Could not load internal data', 'Check your connection and try Refresh. If this persists, the internal index may need a backend sync.');
    });
    $('overview-kpis').innerHTML = '';
    $('overview-action-list').innerHTML = stateBlock('Could not load internal data', 'Use Refresh to try again.');
}

function renderAll() {
    renderOverview();
    renderUsersTab();
    renderKycTab();
    renderPaymentTab();
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

function userRow(x) {
    const uid = x.user_id || x.id;
    return `<tr class="hover:bg-gray-50/60">
        <td class="px-5 py-3.5">
            <div class="font-medium text-gray-900 truncate max-w-[200px]">${escapeHtml(userDisplayName(x))}</div>
            <div class="text-[12px] text-gray-500 truncate max-w-[200px]">${escapeHtml(x.email || '—')}</div>
        </td>
        <td class="px-5 py-3.5 text-gray-700">${escapeHtml(x.business_name || '—')}</td>
        <td class="px-5 py-3.5 mono text-[13px] text-gray-600">${escapeHtml(x.phone_number || '—')}</td>
        <td class="px-5 py-3.5">${accessBadge(x)}</td>
        <td class="px-5 py-3.5 text-[13px] text-gray-600">${escapeHtml(trialRemainingText(x))}</td>
        <td class="px-5 py-3.5">${badge(x.kyc_status, KYC_TONE)}</td>
        <td class="px-5 py-3.5">${badge(x.payment_status, PAYMENT_TONE)}</td>
        <td class="px-5 py-3.5">${badge(x.account_status, ACCOUNT_TONE)}</td>
        <td class="px-5 py-3.5 text-[13px] text-gray-500">${fmtDate(x.created_at)}</td>
        <td class="px-5 py-3.5 text-right whitespace-nowrap">
            <button class="text-[13px] font-semibold text-[#EA580C] hover:underline" data-review="${escapeHtml(uid)}">Review</button>
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
    const keys = Object.keys(after).filter(k => ['account_status', 'kyc_status', 'payment_status'].includes(k));
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
    setTabCount('tab-count-kyc', kycCount);
    setTabCount('tab-count-payment', payCount);
}

function setTabCount(id, n) {
    const el = $(id);
    if (n > 0) { el.textContent = n; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
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
function openDrawer(userId) {
    const u = findUser(userId);
    if (!u) return;
    state.drawerUserId = userId;
    renderDrawer(u);
    const drawer = $('internal-drawer');
    drawer.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    requestAnimationFrame(() => $('internal-drawer-panel').classList.remove('translate-x-full'));
}

function closeDrawer() {
    $('internal-drawer-panel').classList.add('translate-x-full');
    document.body.classList.remove('overflow-hidden');
    state.drawerUserId = null;
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
    if (action === 'kyc.approve') payload.kyc_reviewed_at = serverTimestamp();
    if (action === 'payment.verify') payload.payment_verified_at = serverTimestamp();
    if (note) payload.last_internal_note = note;

    try {
        await ds.updateInternalUserStatus(userId, payload, {
            action,
            before: transition.before,
            after: transition.after,
            reason: note || null
        });
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
// Wiring
// =============================================================================
function initConsoleEvents() {
    $('internal-signout').addEventListener('click', signOut);
    $('internal-refresh').addEventListener('click', () => loadData());

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

    // Drawer
    $('internal-drawer-close').addEventListener('click', closeDrawer);
    $('internal-drawer-overlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.drawerUserId) closeDrawer(); });

    // Delegated clicks: Review, Copy UID, drawer actions
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
