// FluxyOS canonical trial and billing access guard.
// Reads users/{uid}/billing_subscription/current and migrates frozen legacy
// billing/access state through DataService.ensureBillingSubscription().
// Client-side locks are UX-only; trusted backend enforcement remains future work.

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

const PAYMENT_ROUTE = '/pricing';
const DAY_MS = 24 * 60 * 60 * 1000;

function getApp() {
    return getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
}

let _data = null;
function getData() {
    if (!_data) _data = new DataService(getApp());
    return _data;
}

function toMillis(ts) {
    return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

function retryRoute(subscription) {
    const plan = ['core', 'growth', 'enterprise'].includes(subscription?.plan_id)
        ? subscription.plan_id
        : 'growth';
    const billing = ['monthly', 'annually'].includes(subscription?.billing_frequency)
        ? subscription.billing_frequency
        : 'annually';
    return `/checkout?plan=${plan}&billing=${billing}`;
}

function deriveState(subscription) {
    if (!subscription) {
        return {
            subscriptionStatus: null, trialStartedAt: null, trialEndsAt: null,
            daysRemaining: null, hoursRemaining: null,
            isTrialActive: false, isTrialExpiring: false, isTrialExpired: false,
            isPaymentSubmitted: false, isPaymentRejected: false, isActive: true, isSuspended: false,
            canRead: true, canWrite: true, canExport: true, canUseAI: true,
            canUploadDocuments: true, canUsePaymentPage: true, showBanner: false,
            ctaRoute: '/pricing', subscription: null
        };
    }

    const status = subscription.status || null;
    const endMs = toMillis(subscription.trial_ends_at);
    const remainingMs = endMs === null ? null : Math.max(0, endMs - Date.now());
    const daysRemaining = remainingMs === null ? null : Math.ceil(remainingMs / DAY_MS);
    const hoursRemaining = remainingMs === null ? null : Math.ceil(remainingMs / (60 * 60 * 1000));
    const isActive = status === 'active';
    const isSuspended = status === 'suspended';
    const isTrialExpired = status === 'expired';
    const isPaymentSubmitted = status === 'pending_verification';
    const isPaymentRejected = status === 'payment_failed';
    const isTrialState = status === 'trialing';
    const isTrialExpiring = isTrialState && daysRemaining !== null && daysRemaining <= 1 && remainingMs > 0;
    const isTrialActive = isTrialState && !isTrialExpiring;
    const trialStillUsable = remainingMs !== null && remainingMs > 0;
    const canUseTrialPermissions = isTrialState || ((isPaymentSubmitted || isPaymentRejected) && trialStillUsable);
    const canRead = !isSuspended;
    const canWrite = isActive || canUseTrialPermissions;
    const canExport = isActive;
    const canUseAI = isActive || canUseTrialPermissions;
    const canUploadDocuments = isActive || canUseTrialPermissions;

    return {
        subscriptionStatus: status,
        trialStartedAt: subscription.trial_started_at || null,
        trialEndsAt: subscription.trial_ends_at || null,
        daysRemaining, hoursRemaining,
        isTrialActive, isTrialExpiring, isTrialExpired,
        isPaymentSubmitted, isPaymentRejected, isActive, isSuspended,
        canRead, canWrite, canExport, canUseAI, canUploadDocuments,
        canUsePaymentPage: !isSuspended,
        showBanner: !isActive && !isSuspended,
        ctaRoute: retryRoute(subscription),
        subscription
    };
}

function fmtTrialEnd(ts) {
    const date = ts?.toDate?.();
    return date
        ? date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'your trial end date';
}

function bannerConfigFor(state) {
    if (state.isPaymentRejected) {
        return {
            variant: 'warn',
            title: 'Payment could not be verified.',
            body: 'Please retry payment to continue after your trial ends.',
            cta: 'Retry payment',
            href: state.ctaRoute
        };
    }
    if (state.isPaymentSubmitted) {
        return {
            variant: 'info',
            title: 'Payment verification in progress.',
            body: 'Your FluxyOS plan will activate after confirmation.',
            cta: 'View payment status',
            href: '/payment-pending'
        };
    }
    if (state.isTrialExpired) {
        return {
            variant: 'warn',
            title: 'Your trial has ended.',
            body: 'Choose a plan to continue using FluxyOS.',
            cta: 'Choose plan',
            href: '/pricing'
        };
    }
    if (state.isTrialActive || state.isTrialExpiring) {
        return {
            variant: state.isTrialExpiring ? 'warn' : 'clock',
            title: 'You are on a trial.',
            body: `Upgrade before ${fmtTrialEnd(state.trialEndsAt)} to keep using FluxyOS.`,
            cta: 'Upgrade now',
            href: '/pricing'
        };
    }
    return null;
}

let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'fluxy-trial-banner-styles';
    style.textContent = `
        .fluxy-trial-banner {
            display:flex;align-items:center;justify-content:center;gap:12px;width:100%;
            flex-shrink:0;padding:10px 20px;background:linear-gradient(90deg,#F8FAFC 0%,#FFFFFF 55%,#F3F4F6 100%);
            border-bottom:1px solid #FCDDB9;flex-wrap:wrap
        }
        .fluxy-trial-banner__icon {
            width:28px;height:28px;flex-shrink:0;border-radius:8px;display:inline-flex;
            align-items:center;justify-content:center;background:#fff;color:#EA580C;border:1px solid #FED7AA
        }
        .fluxy-trial-banner__text {font-size:14px;line-height:1.4;color:#0B0F19;min-width:0}
        .fluxy-trial-banner__title {font-weight:700}
        .fluxy-trial-banner__body {font-weight:500;color:#1f2937;margin-left:4px}
        .fluxy-trial-banner__cta {
            flex-shrink:0;display:inline-flex;align-items:center;gap:4px;color:#EA580C;
            font-size:14px;font-weight:700;text-decoration:none;cursor:pointer;margin-left:4px
        }
        .fluxy-trial-banner__cta:hover {color:#C2410C;text-decoration:underline}
        @media(max-width:640px){.fluxy-trial-banner{padding:10px 14px;text-align:center}}
        .fluxy-access-disabled{pointer-events:none!important;opacity:.45!important;cursor:not-allowed!important}
    `;
    document.head.appendChild(style);
}

function iconSvg(variant) {
    if (variant === 'warn') {
        return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    }
    if (variant === 'info') {
        return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
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
        <a class="fluxy-trial-banner__cta" href="${cfg.href}">${cfg.cta} &rarr;</a>
    `;
    const main = document.querySelector('main');
    (main || document.body).insertBefore(banner, (main || document.body).firstChild);
}

const WRITE_SELECTORS = [
    '[data-action="add-record"]', '[data-action="add-transaction"]', '[data-action="add-bill"]',
    '[data-action="add-subscription"]', '[data-action="csv-import"]', '[data-action="scan-bill"]',
    '[data-action="pay-bill"]', '#scan-tx-btn'
];
const EXPORT_SELECTORS = ['[data-action="export"]', '#download-csv-btn', '#topbar-generate-btn', '#recommended-generate-btn', '[data-preview-report]'];
const AI_SELECTORS = ['[data-action="ai-submit"]', '#brain-chat-submit', '#brain-chat-input'];

function disable(selectors) {
    selectors.forEach((selector) => {
        try {
            document.querySelectorAll(selector).forEach((el) => {
                el.classList.add('fluxy-access-disabled');
                if ('disabled' in el) el.disabled = true;
            });
        } catch (_) { /* ignore invalid optional selectors */ }
    });
}

function applyPageLocks(state) {
    if (!state.canWrite) disable(WRITE_SELECTORS);
    if (!state.canExport) disable(EXPORT_SELECTORS);
    if (!state.canUseAI) disable(AI_SELECTORS);
}

async function showLockedModal() {
    const confirmFn = window.showConfirmDialog;
    if (typeof confirmFn !== 'function') {
        window.location.href = PAYMENT_ROUTE;
        return;
    }
    const goToPricing = await confirmFn({
        title: 'Your FluxyOS trial has ended',
        body: 'Your finance data is safely stored, but adding new records, importing files, exporting reports, and using Fluxy AI are locked until you choose a plan.',
        confirmLabel: 'Choose plan',
        cancelLabel: 'Contact support',
        tone: 'danger',
        icon: 'warn'
    });
    window.location.href = goToPricing
        ? PAYMENT_ROUTE
        : 'mailto:support@fluxyos.com?subject=FluxyOS%20account%20support';
}

function currentState() {
    return window.__fluxyAccessState || null;
}

function makeRequire(flag) {
    return function () {
        const state = currentState();
        if (!state || state[flag]) return true;
        showLockedModal();
        return false;
    };
}

export async function applyToPage(authUser) {
    if (!authUser?.uid) return null;
    let subscription = null;
    try {
        subscription = await getData().ensureBillingSubscription(authUser.uid);
    } catch (_) {
        console.warn('[trial-access] billing read failed; failing open');
    }
    const state = deriveState(subscription);
    window.__fluxyAccessState = state;
    if (state.showBanner) {
        try { renderBanner(state); } catch (_) { /* banner must not break page */ }
    }
    try { applyPageLocks(state); } catch (_) { /* locks must not break page */ }
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
