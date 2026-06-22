// FluxyOS canonical trial and billing access guard.
// Reads users/{uid}/billing_subscription/current and migrates frozen legacy
// billing/access state through DataService.ensureBillingSubscription().
// Client-side locks are UX guardrails. Trial AI usage is also enforced by the
// API + Firestore `usage_limits/ai_chat_trial`; storage limits are preflighted
// before uploads and backed by per-file Firebase rules where rules can check.

import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.com",
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
            isBlocked: false, ctaRoute: '/pricing', subscription: null
        };
    }

    const status = subscription.status || null;
    const endMs = toMillis(subscription.trial_ends_at);
    const remainingMs = endMs === null ? null : Math.max(0, endMs - Date.now());
    const daysRemaining = remainingMs === null ? null : Math.ceil(remainingMs / DAY_MS);
    const hoursRemaining = remainingMs === null ? null : Math.ceil(remainingMs / (60 * 60 * 1000));
    // cancel_scheduled = renewal canceled but still paid through the period end,
    // so it has the SAME full access as active.
    const isCancelScheduled = status === 'cancel_scheduled';
    const isActive = status === 'active' || isCancelScheduled;
    const isSuspended = status === 'suspended';
    const isTrialExpired = status === 'expired';
    const isAwaitingPayment = status === 'awaiting_payment';
    const isPaymentSubmitted = status === 'pending_verification';
    const isPaymentRejected = status === 'payment_failed';
    const isTrialState = status === 'trialing';

    // Renewal reminder: in this manual-QRIS model a paid period must be renewed
    // by hand. Surface a banner starting 7 days before current_period_end.
    const periodEndMs = toMillis(subscription.current_period_end);
    const periodRemainingMs = periodEndMs === null ? null : Math.max(0, periodEndMs - Date.now());
    const daysUntilPeriodEnd = periodRemainingMs === null ? null : Math.ceil(periodRemainingMs / DAY_MS);
    const periodEndsSoon = periodRemainingMs !== null && periodRemainingMs > 0 && periodRemainingMs <= 7 * DAY_MS;
    const isPaymentDueSoon = status === 'active' && periodEndsSoon;
    const isRenewalEndingSoon = isCancelScheduled && periodEndsSoon;
    const isTrialExpiring = isTrialState && daysRemaining !== null && daysRemaining <= 1 && remainingMs > 0;
    const isTrialActive = isTrialState && !isTrialExpiring;
    const trialStillUsable = remainingMs !== null && remainingMs > 0;
    const canUseTrialPermissions = isTrialState || ((isAwaitingPayment || isPaymentSubmitted || isPaymentRejected) && trialStillUsable);
    const canRead = !isSuspended;
    const canWrite = isActive || canUseTrialPermissions;
    const canExport = isActive;
    const canUseAI = isActive || canUseTrialPermissions;
    const canUploadDocuments = isActive || canUseTrialPermissions;
    // Hard paywall: the user has no usable access left and must pay to continue —
    // trial ended without paying (`expired`), or a submitted payment was rejected
    // and the trial window is also over (`payment_failed`). Payments still in
    // review (`pending_verification`/`awaiting_payment`) are NOT blocked.
    const isBlocked = isTrialExpired || (isPaymentRejected && !trialStillUsable);

    return {
        subscriptionStatus: status,
        trialStartedAt: subscription.trial_started_at || null,
        trialEndsAt: subscription.trial_ends_at || null,
        daysRemaining, hoursRemaining,
        isTrialActive, isTrialExpiring, isTrialExpired,
        isAwaitingPayment, isPaymentSubmitted, isPaymentRejected, isActive, isSuspended,
        isPaymentDueSoon, isRenewalEndingSoon, daysUntilPeriodEnd,
        periodEndsAt: subscription.current_period_end || null,
        canRead, canWrite, canExport, canUseAI, canUploadDocuments,
        canUsePaymentPage: !isSuspended,
        showBanner: (!isActive && !isSuspended) || isPaymentDueSoon || isRenewalEndingSoon,
        isBlocked,
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
    if (state.isPaymentDueSoon) {
        return {
            variant: state.daysUntilPeriodEnd !== null && state.daysUntilPeriodEnd <= 2 ? 'warn' : 'clock',
            title: 'Payment due soon.',
            body: `Renew before ${fmtTrialEnd(state.periodEndsAt)} to keep your FluxyOS plan active.`,
            cta: 'Pay now',
            href: state.ctaRoute
        };
    }
    if (state.isRenewalEndingSoon) {
        return {
            variant: 'warn',
            title: 'Your plan access ends soon.',
            body: `Renewal is canceled — access ends ${fmtTrialEnd(state.periodEndsAt)}. Reactivate to keep FluxyOS.`,
            cta: 'Reactivate',
            href: '/settings-billing'
        };
    }
    if (state.isPaymentRejected) {
        return {
            variant: 'warn',
            title: 'Payment could not be verified.',
            body: 'Please retry payment to continue after your trial ends.',
            cta: 'Retry payment',
            href: state.ctaRoute
        };
    }
    if (state.isAwaitingPayment) {
        const requestId = state.subscription?.current_payment_request_id;
        return {
            variant: 'info',
            title: 'QRIS payment waiting.',
            body: 'Complete payment to activate your FluxyOS plan.',
            cta: 'View QRIS payment',
            href: requestId ? `/payment-pending?requestId=${encodeURIComponent(requestId)}` : '/payment-pending'
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
            href: state.ctaRoute
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
            flex-shrink:0;padding:10px 20px;background:linear-gradient(90deg,#FFF7ED 0%,#FFF1E0 55%,#FFE6CC 100%);
            border-bottom:1px solid #FCDDB9;flex-wrap:wrap
        }
        .fluxy-trial-banner__icon {
            width:28px;height:28px;flex-shrink:0;border-radius:8px;display:inline-flex;
            align-items:center;justify-content:center;background:linear-gradient(135deg,#FB923C 0%,#EA580C 100%);
            color:#fff;box-shadow:0 2px 6px rgba(234,88,12,.30)
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

let paywallStylesInjected = false;
function injectPaywallStyles() {
    if (paywallStylesInjected) return;
    paywallStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'fluxy-paywall-styles';
    style.textContent = `
        .fluxy-paywall {
            position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
            justify-content:center;padding:24px;background:rgba(11,15,25,.45);
            -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
            animation:fluxyPaywallIn 200ms ease-out
        }
        .fluxy-paywall__card {
            width:100%;max-width:420px;box-sizing:border-box;background:#fff;
            border:1px solid #E5E7EB;border-radius:18px;box-shadow:0 24px 48px rgba(11,15,25,.18);
            padding:32px 28px;text-align:center;display:flex;flex-direction:column;
            align-items:center;gap:14px
        }
        .fluxy-paywall__icon {
            width:52px;height:52px;border-radius:14px;display:inline-flex;align-items:center;
            justify-content:center;background:linear-gradient(135deg,#FFF7ED 0%,#FFEDD5 100%);
            box-shadow:inset 0 0 0 1px rgba(234,88,12,.18);color:#EA580C
        }
        .fluxy-paywall__icon svg {width:24px;height:24px}
        .fluxy-paywall__title {margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em;color:#0B0F19}
        .fluxy-paywall__body {margin:0;font-size:14px;line-height:1.55;color:#4B5563;max-width:34ch}
        .fluxy-paywall__primary {
            margin-top:6px;width:100%;box-sizing:border-box;display:inline-flex;align-items:center;
            justify-content:center;gap:6px;padding:12px 20px;border-radius:10px;background:#0B0F19;
            color:#fff;font-size:14px;font-weight:600;text-decoration:none;transition:background 150ms ease
        }
        .fluxy-paywall__primary:hover {background:#1F2937}
        .fluxy-paywall__secondary {color:#EA580C;font-size:14px;font-weight:600;text-decoration:none}
        .fluxy-paywall__secondary:hover {color:#C2410C;text-decoration:underline}
        .fluxy-paywall__signout {
            margin-top:2px;background:none;border:0;cursor:pointer;color:#94A3B8;font-size:13px;font-weight:500
        }
        .fluxy-paywall__signout:hover {color:#475569;text-decoration:underline}
        html.fluxy-paywall-lock,html.fluxy-paywall-lock body {overflow:hidden!important}
        @keyframes fluxyPaywallIn {from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion:reduce){.fluxy-paywall{animation:none}}
    `;
    document.head.appendChild(style);
}

function paywallConfigFor(state) {
    if (state.isMember) {
        // Members can't pay (billing is owner-only RBAC) — point them at the owner
        // instead of a checkout they can't complete.
        return {
            member: true,
            title: 'Your workspace trial has ended',
            body: 'Ask your workspace owner to choose a plan to restore access. Your finance data is safe and waiting.'
        };
    }
    if (state.isPaymentRejected) {
        return {
            title: 'Payment couldn’t be verified',
            body: 'We couldn’t confirm your last payment. Retry to regain access — your finance data is safe and waiting.',
            primaryLabel: 'Retry payment',
            primaryHref: state.ctaRoute
        };
    }
    return {
        title: 'Your trial has ended',
        body: 'Choose a plan to keep using FluxyOS. Your finance data is safe and waiting for you.',
        primaryLabel: 'Choose a plan',
        primaryHref: '/pricing'
    };
}

// Full-screen, non-dismissable paywall: blurs the page and blocks all
// interaction until the user pays. Used when the trial has ended without an
// active plan (`expired`) or a payment was rejected and the trial is over.
// UX-only enforcement, consistent with the rest of this guard.
function renderPaywall(state) {
    if (document.querySelector('[data-fluxy-paywall]')) return;
    const cfg = paywallConfigFor(state);
    injectPaywallStyles();
    document.documentElement.classList.add('fluxy-paywall-lock');
    const overlay = document.createElement('div');
    overlay.className = 'fluxy-paywall';
    overlay.setAttribute('data-fluxy-paywall', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    // Members get no payment CTAs (they can't pay) — just the message + Sign out.
    const actionsHtml = cfg.member ? '' : `
            <a class="fluxy-paywall__primary" href="${cfg.primaryHref}">${cfg.primaryLabel}</a>
            <a class="fluxy-paywall__secondary" href="/payment-pending">Already paid? Check status</a>`;
    overlay.innerHTML = `
        <div class="fluxy-paywall__card" role="document">
            <span class="fluxy-paywall__icon">${iconSvg('warn')}</span>
            <h2 class="fluxy-paywall__title">${cfg.title}</h2>
            <p class="fluxy-paywall__body">${cfg.body}</p>${actionsHtml}
            <button type="button" class="fluxy-paywall__signout" data-fluxy-paywall-signout>Sign out</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-fluxy-paywall-signout]')?.addEventListener('click', async () => {
        try { await signOut(getAuth(getApp())); } catch (_) { /* ignore */ }
        window.location.href = '/login';
    });
    overlay.querySelector('.fluxy-paywall__primary')?.focus();
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

async function showSubscriptionLimitModal(options = {}) {
    const state = currentState();
    const href = options.href || state?.ctaRoute || PAYMENT_ROUTE;
    const confirmFn = window.showConfirmDialog;
    if (typeof confirmFn !== 'function') {
        window.location.href = href;
        return;
    }
    const shouldOpenPayment = await confirmFn({
        title: options.title || 'Trial limit reached',
        body: options.body || 'You have reached the limit included with your trial. Choose a plan to keep using FluxyOS without this restriction.',
        confirmLabel: options.confirmLabel || 'Choose plan',
        cancelLabel: options.cancelLabel || 'Not now',
        tone: options.tone || 'warning',
        icon: options.icon || 'warn'
    });
    if (shouldOpenPayment) window.location.href = href;
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
    if (state.isBlocked) {
        // Hard paywall fully covers the page; the slim banner is redundant.
        try { renderPaywall(state); } catch (_) { /* paywall must not break page */ }
    } else if (state.showBanner) {
        try { renderBanner(state); } catch (_) { /* banner must not break page */ }
    }
    try { applyPageLocks(state); } catch (_) { /* locks must not break page */ }
    return state;
}

// Member trial banner: same look as the owner banner but shows the date + days
// remaining with NO checkout CTA (members can't pay).
function renderMemberTrialBanner(state) {
    document.querySelector('[data-fluxy-trial-banner]')?.remove();
    injectStyles();
    const variant = state.isTrialExpiring ? 'warn' : 'clock';
    const days = state.daysRemaining;
    const daysText = days !== null && days > 0 ? ` · ${days} day${days === 1 ? '' : 's'} left` : '';
    const banner = document.createElement('div');
    banner.className = 'fluxy-trial-banner';
    banner.setAttribute('data-fluxy-trial-banner', '');
    banner.innerHTML = `
        <span class="fluxy-trial-banner__icon">${iconSvg(variant)}</span>
        <span class="fluxy-trial-banner__text">
            <span class="fluxy-trial-banner__title">Workspace trial.</span>
            <span class="fluxy-trial-banner__body">Your trial ends ${fmtTrialEnd(state.trialEndsAt)}${daysText}.</span>
        </span>
    `;
    const main = document.querySelector('main');
    (main || document.body).insertBefore(banner, (main || document.body).firstChild);
}

// Member access derives from the denormalized workspace trial summary
// (window.FluxyWorkspace.plan) — there is ONE trial state per workspace and
// members have no billing_subscription doc of their own. Same deriveState
// pipeline as the owner; only the data source differs. Members NEVER call
// ensureBillingSubscription (that would create a separate per-member trial).
export async function applyToWorkspaceMember(wsAccess) {
    const plan = wsAccess && wsAccess.plan;
    // No denormalized plan yet (owner hasn't synced) → fail open, no banner.
    if (!plan || !plan.status) {
        const open = deriveState(null);
        open.isMember = true;
        window.__fluxyAccessState = open;
        return open;
    }
    let status = plan.status;
    // Members get no server-side expiry write, so flip a stale `trialing` to
    // `expired` client-side once trial_ends_at has passed.
    const endMs = toMillis(plan.trialEndsAt);
    if (status === 'trialing' && endMs !== null && endMs < Date.now()) status = 'expired';
    const subscription = {
        plan_id: plan.id || null,
        plan_name: plan.name || null,
        status,
        billing_frequency: plan.frequency || null,
        current_payment_request_id: null,
        trial_started_at: plan.trialStartedAt || null,
        trial_ends_at: plan.trialEndsAt || null,
        current_period_start: null,
        current_period_end: plan.periodEndsAt || null
    };
    const state = deriveState(subscription);
    state.isMember = true;
    window.__fluxyAccessState = state;
    if (state.isBlocked) {
        try { renderPaywall(state); } catch (_) { /* paywall must not break page */ }
    } else if (state.isTrialActive || state.isTrialExpiring) {
        // Only the trial banner is member-relevant; owner billing reminders
        // (payment due / in review) are suppressed since members can't act on them.
        try { renderMemberTrialBanner(state); } catch (_) { /* banner must not break page */ }
    }
    try { applyPageLocks(state); } catch (_) { /* locks must not break page */ }
    return state;
}

export function check() {
    return currentState();
}

window.FluxyAccessGuard = {
    init: applyToPage,
    initMember: applyToWorkspaceMember,
    check,
    renderBanner: (state) => renderBanner(state || currentState() || deriveState(null)),
    applyPageLocks: (state) => applyPageLocks(state || currentState() || deriveState(null)),
    requireWriteAccess: makeRequire('canWrite'),
    requireExportAccess: makeRequire('canExport'),
    requireAIUsage: makeRequire('canUseAI'),
    requireUploadAccess: makeRequire('canUploadDocuments'),
    showSubscriptionLimitModal,
    PAYMENT_ROUTE
};
