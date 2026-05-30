// FluxyOS Trial Access Guard
// Shared access-state + trial/payment banner for authenticated app pages.
// Reads users/{uid}/billing/access (creating a 3-day trial on first eligible
// load — see DataService.ensureTrialAccessAfterOnboarding), renders a slim
// banner above page content, and applies UX-only locks after expiry.
//
// IMPORTANT: client-side locks here are UX only. Real enforcement (usage
// counters, server-side expiry) needs backend/rules support — see
// docs/TRIAL_ACCESS_AND_PAYMENT_BANNER_PLAN.md §17/§29.

import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import DataService from "./db-service.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const PAYMENT_ROUTE = "/payment.html";
const DAY_MS = 24 * 60 * 60 * 1000;

function getApp() {
    return getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
}

let _data = null;
function getData() {
    if (!_data) _data = new DataService(getApp());
    return _data;
}

// ----- Derived state -----

function toMillis(ts) {
    return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

function deriveState(access) {
    // No access doc → treat as readable but unevaluated (fail open; no banner).
    if (!access) {
        return {
            accessStatus: null, paymentStatus: null, trialStartedAt: null, trialEndsAt: null,
            daysRemaining: null, hoursRemaining: null,
            isTrialActive: false, isTrialExpiring: false, isTrialExpired: false,
            isPaymentSubmitted: false, isPaymentRejected: false, isActive: true, isSuspended: false,
            canRead: true, canWrite: true, canExport: true, canUseAI: true,
            canUploadDocuments: true, canUsePaymentPage: true,
            showBanner: false
        };
    }

    const accessStatus = access.access_status || null;
    const paymentStatus = access.payment_status || null;
    const endMs = toMillis(access.trial_ends_at);
    const now = Date.now();
    const remainingMs = endMs !== null ? Math.max(0, endMs - now) : null;
    const daysRemaining = remainingMs !== null ? Math.ceil(remainingMs / DAY_MS) : null;
    const hoursRemaining = remainingMs !== null ? Math.ceil(remainingMs / (60 * 60 * 1000)) : null;

    const isActive = accessStatus === 'active' || paymentStatus === 'verified' || accessStatus === 'payment_verified';
    const isSuspended = accessStatus === 'suspended';
    const isTrialExpired = accessStatus === 'trial_expired';
    const isPaymentSubmitted = accessStatus === 'payment_submitted'
        || paymentStatus === 'submitted' || paymentStatus === 'under_review';
    const isPaymentRejected = paymentStatus === 'rejected';
    const isTrialState = accessStatus === 'trial_active' || accessStatus === 'trial_expiring';
    // "Ends today" once a day or less remains.
    const isTrialExpiring = isTrialState && daysRemaining !== null && daysRemaining <= 1 && remainingMs > 0;
    const isTrialActive = isTrialState && !isTrialExpiring;

    // Gating matrix (plan §16). Trial users can write + use AI but cannot export.
    // Expired / payment-pending users are read-only until verified.
    const trialUsable = isTrialActive || isTrialExpiring;
    const canRead = !isSuspended;
    const canWrite = isActive || trialUsable;
    const canExport = isActive; // export locked until paid
    const canUseAI = isActive || trialUsable;
    const canUploadDocuments = isActive || trialUsable;
    const canUsePaymentPage = !isSuspended;

    const showBanner = !isActive && !isSuspended;

    return {
        accessStatus, paymentStatus,
        trialStartedAt: access.trial_started_at || null,
        trialEndsAt: access.trial_ends_at || null,
        daysRemaining, hoursRemaining,
        isTrialActive, isTrialExpiring, isTrialExpired,
        isPaymentSubmitted, isPaymentRejected, isActive, isSuspended,
        canRead, canWrite, canExport, canUseAI, canUploadDocuments, canUsePaymentPage,
        showBanner
    };
}

// ----- Banner copy (plan §19) -----

function bannerConfigFor(state) {
    if (state.isPaymentRejected) {
        return {
            variant: 'warn',
            title: 'Payment needs revision',
            body: 'Your payment could not be verified. Please upload a valid proof or contact support.',
            cta: 'Update payment proof'
        };
    }
    if (state.isPaymentSubmitted) {
        return {
            variant: 'info',
            title: 'Payment submitted · Under review',
            body: 'Your payment proof is being reviewed. We’ll unlock your workspace after verification.',
            cta: 'View payment status'
        };
    }
    if (state.isTrialExpired) {
        return {
            variant: 'warn',
            title: 'Trial ended',
            body: 'Your data is safe, but FluxyOS is locked until payment is completed.',
            cta: 'Complete payment'
        };
    }
    if (state.isTrialExpiring) {
        return {
            variant: 'warn',
            title: 'Trial ends today',
            body: 'Complete payment today to avoid losing access to add records, exports, and Fluxy AI.',
            cta: 'Complete payment'
        };
    }
    if (state.isTrialActive) {
        const days = state.daysRemaining || 0;
        return {
            variant: 'clock',
            title: `Trial active · ${days} ${days === 1 ? 'day' : 'days'} left`,
            body: 'Complete payment anytime to keep access after your trial ends.',
            cta: 'Complete payment'
        };
    }
    return null;
}

// ----- Styles -----

let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'fluxy-trial-banner-styles';
    style.textContent = `
        /* Full-width slim top strip — mirrors the landing-page .promo-banner:
           cream→peach gradient, rounded orange icon square, bold copy, orange link. */
        .fluxy-trial-banner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            width: 100%;
            flex-shrink: 0;
            padding: 10px 20px;
            background: linear-gradient(90deg, #FFF7ED 0%, #FFF1E0 55%, #FFE6CC 100%);
            border-bottom: 1px solid #FCDDB9;
            flex-wrap: wrap;
        }
        .fluxy-trial-banner__icon {
            width: 28px; height: 28px; flex-shrink: 0;
            border-radius: 8px;
            display: inline-flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #FB923C 0%, #EA580C 100%);
            color: #fff;
            box-shadow: 0 2px 6px rgba(234, 88, 12, 0.30);
        }
        .fluxy-trial-banner__text {
            font-size: 14px; line-height: 1.4; color: #0B0F19; min-width: 0;
        }
        .fluxy-trial-banner__title { font-weight: 700; }
        .fluxy-trial-banner__body { font-weight: 500; color: #1f2937; }
        .fluxy-trial-banner__cta {
            flex-shrink: 0;
            display: inline-flex; align-items: center; gap: 4px;
            color: #EA580C; font-size: 14px; font-weight: 700;
            text-decoration: none; cursor: pointer; margin-left: 4px;
        }
        .fluxy-trial-banner__cta:hover { color: #C2410C; text-decoration: underline; }
        @media (max-width: 640px) {
            .fluxy-trial-banner { padding: 10px 14px; text-align: center; }
        }
        .fluxy-access-disabled {
            pointer-events: none !important;
            opacity: 0.45 !important;
            cursor: not-allowed !important;
        }
    `;
    document.head.appendChild(style);
}

function iconSvg(variant) {
    if (variant === 'warn') {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }
    if (variant === 'info') {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    // clock (active trial)
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
}

// ----- Rendering -----

function findAnchor() {
    const scrollArea = document.querySelector('main .flex-1.overflow-y-auto') || document.querySelector('main');
    return scrollArea?.querySelector(':scope > [class*="mx-auto"]') || scrollArea || document.body;
}

function renderBanner(state) {
    document.querySelector('[data-fluxy-trial-banner]')?.remove();
    const cfg = bannerConfigFor(state);
    if (!cfg) return;
    injectStyles();

    const banner = document.createElement('div');
    banner.className = 'fluxy-trial-banner';
    banner.setAttribute('data-fluxy-trial-banner', '');
    banner.innerHTML = `
        <span class="fluxy-trial-banner__icon">${iconSvg(cfg.variant)}</span>
        <span class="fluxy-trial-banner__text">
            <span class="fluxy-trial-banner__title">${cfg.title}</span>
            <span class="fluxy-trial-banner__body">${cfg.body}</span>
        </span>
        <a class="fluxy-trial-banner__cta" href="${PAYMENT_ROUTE}">${cfg.cta} &rarr;</a>
    `;

    // Pin the strip at the very top of the page, above the app topbar — same
    // placement rhythm as the landing-page promo bar. Falls back to the content
    // anchor if a page has no <main>.
    const main = document.querySelector('main');
    if (main) {
        main.insertBefore(banner, main.firstChild);
    } else {
        const anchor = findAnchor();
        anchor.insertBefore(banner, anchor.firstChild);
    }
}

// Selectors for write/export/AI actions to visually disable when locked.
const WRITE_SELECTORS = [
    '[data-action="add-record"]', '[data-action="add-transaction"]', '[data-action="add-bill"]',
    '[data-action="add-subscription"]', '[data-action="csv-import"]', '[data-action="scan-bill"]',
    '[data-action="pay-bill"]', '#scan-tx-btn'
];
const EXPORT_SELECTORS = ['[data-action="export"]', '#download-csv-btn', '#topbar-generate-btn', '#recommended-generate-btn', '[data-preview-report]'];
const AI_SELECTORS = ['[data-action="ai-submit"]', '#brain-chat-submit', '#brain-chat-input'];

function disable(selectors) {
    selectors.forEach((sel) => {
        try {
            document.querySelectorAll(sel).forEach((el) => {
                el.classList.add('fluxy-access-disabled');
                if ('disabled' in el) el.disabled = true;
            });
        } catch (e) { /* bad selector — skip */ }
    });
}

function applyPageLocks(state) {
    if (!state.canWrite) disable(WRITE_SELECTORS);
    if (!state.canExport) disable(EXPORT_SELECTORS);
    if (!state.canUseAI) disable(AI_SELECTORS);
}

// ----- Expired / locked-action modal (plan §24) -----

async function showLockedModal() {
    const confirmFn = window.showConfirmDialog;
    if (typeof confirmFn !== 'function') {
        // Dialog helper not loaded — route to payment directly rather than block.
        window.location.href = PAYMENT_ROUTE;
        return;
    }
    const goToPayment = await confirmFn({
        title: 'Your FluxyOS trial has ended',
        body: 'Your finance data is safely stored, but adding new records, importing files, exporting reports, and using Fluxy AI are locked until payment is completed.',
        confirmLabel: 'Complete payment',
        cancelLabel: 'Contact support',
        tone: 'danger',
        icon: 'warn'
    });
    if (goToPayment) {
        window.location.href = PAYMENT_ROUTE;
    } else {
        window.location.href = 'mailto:support@fluxyos.com?subject=FluxyOS%20account%20support';
    }
}

function currentState() {
    return window.__fluxyAccessState || null;
}

// require* helpers: return true when allowed; otherwise show the locked modal and
// return false. Fail open if state hasn't loaded yet (never block on a slow read).
function makeRequire(flag) {
    return function () {
        const state = currentState();
        if (!state) return true;
        if (state[flag]) return true;
        showLockedModal();
        return false;
    };
}

// The internal ops console verifies/rejects payments by writing the open
// internal_users index — it can't write the owner-scoped billing/access doc. Fold a
// reviewer's decision back into billing on the user's next load so the workspace
// actually unlocks (or shows "needs revision"). Documented backend-sync alternative
// in the plan; this is the client-driven reconciliation.
async function reconcileWithInternalDecision(data, uid, access) {
    // Already fully unlocked — nothing to reconcile.
    if (access.access_status === 'active' || access.payment_status === 'verified') return access;
    try {
        const internal = await data.getInternalUser(uid);
        if (!internal) return access;
        const verified = internal.payment_status === 'verified'
            || internal.account_status === 'active'
            || internal.account_status === 'payment_verified';
        if (verified) {
            await data.updateBillingAccess(uid, { access_status: 'active', payment_status: 'verified', account_status: 'active' });
            try {
                await data.addAuditLog(uid, {
                    action: 'access.activated', target_collection: 'billing', target_id: 'access',
                    before: { access_status: access.access_status }, after: { access_status: 'active' }, source: 'system'
                });
            } catch (e) { /* non-fatal */ }
            return await data.getBillingAccess(uid) || access;
        }
        if (internal.account_status === 'suspended' && access.access_status !== 'suspended') {
            await data.updateBillingAccess(uid, { access_status: 'suspended', account_status: 'suspended' });
            return await data.getBillingAccess(uid) || access;
        }
        if (internal.payment_status === 'rejected' && access.payment_status !== 'rejected') {
            await data.updateBillingAccess(uid, { payment_status: 'rejected' });
            return await data.getBillingAccess(uid) || access;
        }
    } catch (e) { /* non-fatal */ }
    return access;
}

// ----- Public API -----

export async function applyToPage(authUser, options = {}) {
    if (!authUser?.uid) return null;
    const data = getData();
    let access = null;
    try {
        access = await data.getBillingAccess(authUser.uid);
        if (!access) {
            // Retroactive trial: any app-accessible user without an access doc gets
            // a fresh 3-day trial on this load.
            access = await data.ensureTrialAccessAfterOnboarding(authUser.uid);
        }
        if (access) {
            const expired = await data.expireTrialIfNeeded(authUser.uid);
            if (expired) access = expired;
            access = await reconcileWithInternalDecision(data, authUser.uid, access);
        }
    } catch (e) {
        console.warn('[trial-access] billing read failed; failing open');
        access = null;
    }

    const state = deriveState(access);
    window.__fluxyAccessState = state;

    // The payment page renders its own status UI — don't double up with the banner.
    const onPaymentPage = /\/payment(\.html)?$/.test(window.location.pathname);
    if (state.showBanner && !onPaymentPage) {
        try { renderBanner(state); } catch (e) { /* never break the page */ }
        try { applyPageLocks(state); } catch (e) { /* never break the page */ }
    }
    return state;
}

export function check() {
    return currentState();
}

window.FluxyAccessGuard = {
    init: applyToPage,
    check,
    renderBanner: (state) => renderBanner(state || currentState() || deriveState(null)),
    applyPageLocks: (state) => applyPageLocks(state || currentState() || deriveState(null)),
    requireWriteAccess: makeRequire('canWrite'),
    requireExportAccess: makeRequire('canExport'),
    requireAIUsage: makeRequire('canUseAI'),
    requireUploadAccess: makeRequire('canUploadDocuments'),
    PAYMENT_ROUTE
};
