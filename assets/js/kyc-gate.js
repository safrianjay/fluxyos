// FluxyOS KYC Review Gate
// After a new user submits onboarding (KYC), the whole platform stays locked
// until a reviewer approves them in the Internal Operations Console. Approval
// then hands off to the UNCHANGED trial logic in trial-access.js — this module
// never grants or shapes access, it only stops blocking.
//
// Enforcement is client-side UX, the same posture as the trial paywall
// (see trial-access.js). The one server-backed lever is in firestore.rules:
// isTrialSubscriptionCreate refuses to mint a trial for an unapproved user, so
// a bypassed overlay still buys no plan.
//
// Existing users are never enforced — the whole live roster sits at kyc_status
// 'submitted' and has never been reviewed, so enforcing retroactively would lock
// out every paying customer. Enforcement is keyed on the `kyc_enforced` flag that
// completeOnboarding stamps onto onboarding/progress; KYC_ENFORCEMENT_CUTOFF only
// decides who gets that flag AT SUBMIT TIME. Reading the flag rather than
// creationTime is what makes a submission made before this shipped safe.

import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";

// Set 24h before the actual deploy so brand-new signups whose UTC creation
// timestamp lands just before midnight UTC of the deploy day are still caught
// by the gate (Firebase records `creationTime` in UTC, so a Jakarta-time
// "today" can be the previous UTC day). Same rationale as
// ONBOARDING_RELEASE_CUTOFF in onboarding-gate.js.
export const KYC_ENFORCEMENT_CUTOFF = new Date("2026-08-07T00:00:00.000Z");

const SUPPORT_EMAIL = 'support@fluxyos.com';
const TOUR_SEED_FLAG = 'fluxy_kyc_tour_seeded';

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

function getApp() {
    return getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
}

let _data = null;
function getData() {
    if (!_data) _data = new DataService(getApp());
    return _data;
}

// ----- Detection -----

export function isKycEnforcedUser(authUser) {
    const created = authUser?.metadata?.creationTime;
    if (!created) return false; // fail open: missing metadata never enforces
    const d = new Date(created);
    return !Number.isNaN(d.getTime()) && d >= KYC_ENFORCEMENT_CUTOFF;
}

function variantForStatus(status) {
    if (status === 'needs_revision') return 'revision';
    if (status === 'rejected') return 'rejected';
    return 'review';
}

const OPEN = { blocked: false, variant: null, status: null, note: null };

/**
 * Resolve whether the platform should be locked for this user.
 *
 * @param {object} authUser  Firebase auth user
 * @returns {Promise<{blocked: boolean, variant: string|null, status: string|null, note: string|null}>}
 */
/**
 * Name the branch that decided a user's access.
 *
 * Added because a workspace whose internal_users row read 'approved' still saw
 * the review screen, while every input checked out against live Firestore and the
 * deployed bundle matched source byte for byte. When static reasoning and the data
 * disagree with the running app, the running app has to say what it did.
 */
function kycTrace(branch, result, extra) {
    try {
        console.info('[kyc-gate]', branch, { uid: (result && result.userId) || undefined, ...(extra || {}) });
    } catch (_) { /* never let a diagnostic break the gate */ }
    return result;
}

export async function resolveKycState(authUser) {
    if (!authUser?.uid) return OPEN;
    // Cheap synchronous short-circuit — a pre-cutoff user can never carry the
    // flag checked below, so skip the Firestore reads entirely.
    if (!isKycEnforcedUser(authUser)) return kycTrace('open:not-enforced', OPEN);

    const ds = getData();
    let progress = null;
    try {
        progress = await ds.getOnboardingProgress(authUser.uid);
    } catch (_) {
        return OPEN; // fail open, consistent with every other guard in the app
    }
    // The PERSISTED flag — not creationTime — is the authoritative marker. It is
    // written only by completeOnboarding, so a user who was created after the
    // cutoff but SUBMITTED before this shipped already holds a running trial and
    // is correctly left alone; only submissions made under the new code lock.
    // It also keeps this gate and ensureBillingSubscription (which only ever
    // sees a uid, never the auth metadata) deciding from the same field, so the
    // two halves can never disagree about who is enforced.
    if (progress?.kyc_enforced !== true) return kycTrace('open:flag-absent', OPEN, { kyc_enforced: progress?.kyc_enforced });
    // Invited members join an existing workspace and never do owner KYC; the
    // legacy exemption is likewise out of scope. Both are already implied by the
    // flag, but a later merge-write could set them alongside it.
    if (progress?.onboarding_exempt === true) return kycTrace('open:exempt', OPEN);
    // Not submitted yet — the onboarding gate owns that case, not this one.
    if (progress?.onboarding_completed !== true) return kycTrace('open:not-submitted', OPEN, { completed: progress?.onboarding_completed });

    let internal;
    try {
        // SERVER read, never the cache. The SDK serves getDoc() from IndexedDB
        // when the realtime channel is degraded, and that channel is precisely
        // what ad blockers break — so an approved account kept reading its
        // pre-approval 'submitted' copy and was locked out on every reload.
        internal = await ds.getInternalUserFromServer(authUser.uid);
        // One retry before inferring: an empty read is what sends us down the
        // speculative-block path below.
        if (!internal) {
            await new Promise((r) => setTimeout(r, 400));
            internal = await ds.getInternalUserFromServer(authUser.uid);
        }
    } catch (_) {
        return OPEN; // read failed → fail open rather than strand a real user
    }

    if (!internal) {
        // The row is written best-effort at submit time and may have lagged or
        // been blocked client-side. The user HAS submitted, so hold them at the
        // review screen and retry the sync so a reviewer can actually see them.
        ds.syncSelfToInternalIndex(authUser.uid, {
            email: authUser.email || null,
            display_name: authUser.displayName || null
        }).catch(() => { /* best effort */ });
        // `speculative` — we did NOT read a status, we inferred one from an absent
        // row. applyToPage confirms it against the live listener before locking,
        // because this is the branch that self-heals into 'approved' a moment
        // later and produced the lock-screen flash on an approved account.
        return kycTrace('BLOCKED:no-row(speculative)', { blocked: true, variant: 'review', status: 'submitted', note: null, userId: authUser.uid, speculative: true });
    }

    if (internal.kyc_status === 'approved') {
        // Unlocked. The trial itself is minted by the existing bootstrap in
        // trial-access.js → ensureBillingSubscription, which now passes its
        // approval check — deliberately not duplicated here, so there is only
        // ever one writer and no create race between the two guards.
        seedLearningToursOnce(authUser.uid, progress);
        return kycTrace('open:approved', OPEN);
    }

    return kycTrace('BLOCKED:status', {
        blocked: true,
        variant: variantForStatus(internal.kyc_status),
        status: internal.kyc_status || 'submitted',
        note: internal.last_internal_note || null,
        userId: authUser.uid
    });
}

// The post-onboarding coachmark used to be queued into sessionStorage at submit
// time, which cannot survive a multi-day review. The selections are persisted on
// onboarding/progress, so re-queue them at the moment access actually opens —
// but only for a user who has never started a tour, so an approved user who
// already toured (or dismissed it) is not re-prompted every session.
function seedLearningToursOnce(userId, progress) {
    try {
        if (sessionStorage.getItem(TOUR_SEED_FLAG)) return;
        sessionStorage.setItem(TOUR_SEED_FLAG, '1');
        if (sessionStorage.getItem('fluxy_pending_tour')) return;
    } catch (_) {
        return; // storage unavailable — the coachmark is a nicety, never a blocker
    }
    getData().getPlatformLearningState(userId).then((learning) => {
        const touched = !!learning && (
            learning.dismissed === true
            || (learning.started_tours || []).length > 0
            || (learning.completed_tours || []).length > 0
            || (learning.skipped_tours || []).length > 0
        );
        if (touched) return;
        const tours = Array.isArray(progress?.selected_learning_tours) && progress.selected_learning_tours.length
            ? progress.selected_learning_tours
            : ['overview'];
        sessionStorage.setItem('fluxy_learning_promote_force', '1');
        sessionStorage.setItem('fluxy_pending_tour', 'overview');
        sessionStorage.setItem('fluxy_pending_tours', JSON.stringify(tours));
    }).catch(() => { /* best effort */ });
}

// ----- Copy -----

function configFor(state) {
    if (state.variant === 'revision') {
        return {
            icon: 'warn',
            title: 'We need a bit more information',
            body: 'Your details could not be verified as submitted. Update them and send them back — it only takes a minute.',
            primaryLabel: 'Update my details',
            primaryHref: '/onboarding'
        };
    }
    if (state.variant === 'rejected') {
        return {
            icon: 'warn',
            title: 'We could not verify your account',
            body: 'We were not able to approve this account for FluxyOS.'
        };
    }
    return {
        icon: 'clock',
        title: 'Your details are under review',
        body: 'We are verifying your account details. This usually takes about one business day. You will get an email the moment FluxyOS is ready — nothing else is needed from you right now.'
    };
}

// The review state gets a small dimensional illustration rather than a glyph:
// an identity document under a magnifier says "your ID is being checked", which
// is what KYC actually is — a clock or hourglass only says "wait". The stacked
// offset card carries the depth. Same pattern as the onboarding gate's
// .onboarding-gate-illustration, so it is not a new idea in this codebase.
//
// Deliberately NOT the ⏳ emoji: emoji render as OS-specific colored bitmaps and
// would be the only one of their kind in the product. Orange stays on the
// magnifier stroke — an accent, never a surface.
const REVIEW_ILLUSTRATION = `
<svg width="92" height="74" viewBox="0 0 92 74" fill="none" aria-hidden="true">
    <rect x="20" y="5" width="64" height="41" rx="7" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="2"/>
    <rect x="7" y="15" width="64" height="43" rx="8" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>
    <circle cx="27" cy="31" r="6.5" fill="#E2E8F0"/>
    <path d="M17.5 46c0-5.2 4.3-8.5 9.5-8.5s9.5 3.3 9.5 8.5" fill="#E2E8F0"/>
    <rect x="43" y="26" width="20" height="4" rx="2" fill="#E2E8F0"/>
    <rect x="43" y="35" width="14" height="4" rx="2" fill="#E2E8F0"/>
    <circle cx="64" cy="50" r="12.5" fill="#FFFFFF" stroke="#EA580C" stroke-width="3"/>
    <path d="M73 59l8 8" stroke="#EA580C" stroke-width="3" stroke-linecap="round"/>
</svg>`;

function iconSvg(variant) {
    if (variant === 'warn') {
        return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    }
    return REVIEW_ILLUSTRATION;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ----- Rendering -----

let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'fluxy-kyc-styles';
    style.textContent = `
        .fluxy-kyc {
            position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
            justify-content:center;padding:24px;background:rgba(11,15,25,.45);
            -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
            animation:fluxyKycIn 200ms ease-out
        }
        .fluxy-kyc--inline {
            position:static;inset:auto;z-index:auto;background:none;width:100%;
            -webkit-backdrop-filter:none;backdrop-filter:none;padding:40px 24px;
            align-items:flex-start;animation:none
        }
        .fluxy-kyc__card {
            width:100%;max-width:440px;box-sizing:border-box;background:#fff;
            border:1px solid #E5E7EB;border-radius:18px;box-shadow:0 24px 48px rgba(11,15,25,.18);
            padding:32px 28px;text-align:center;display:flex;flex-direction:column;
            align-items:center;gap:14px
        }
        /* No tinted tile: orange is an accent on the glyph itself, never a
           surface (orange backgrounds are banned project-wide). */
        .fluxy-kyc__icon {
            display:inline-flex;align-items:center;justify-content:center;color:#EA580C
        }
        /* Each glyph/illustration carries its own intrinsic width+height. */
        .fluxy-kyc__icon svg {display:block;max-width:100%;height:auto}
        .fluxy-kyc__title {margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em;color:#0B0F19}
        .fluxy-kyc__body {margin:0;font-size:14px;line-height:1.55;color:#4B5563;max-width:40ch}
        .fluxy-kyc__note {
            margin:0;width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;
            background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;line-height:1.5;
            color:#374151;text-align:left;white-space:pre-wrap;word-break:break-word
        }
        .fluxy-kyc__note-label {
            display:block;font-size:12px;font-weight:600;letter-spacing:.06em;
            text-transform:uppercase;color:#6B7280;margin-bottom:4px
        }
        .fluxy-kyc__primary {
            margin-top:6px;width:100%;box-sizing:border-box;display:inline-flex;align-items:center;
            justify-content:center;gap:6px;padding:12px 20px;border-radius:10px;background:#0B0F19;
            color:#fff;font-size:14px;font-weight:600;text-decoration:none;transition:background 150ms ease
        }
        .fluxy-kyc__primary:hover {background:#1F2937}
        .fluxy-kyc__support {
            margin:0;padding-top:14px;border-top:1px solid #F3F4F6;width:100%;
            font-size:13px;line-height:1.5;color:#6B7280
        }
        .fluxy-kyc__support strong {color:#374151;font-weight:600}
        .fluxy-kyc__support a {color:#EA580C;font-weight:600;text-decoration:none}
        .fluxy-kyc__support a:hover {color:#C2410C;text-decoration:underline}
        .fluxy-kyc__signout {
            margin-top:2px;background:none;border:0;cursor:pointer;color:#94A3B8;font-size:13px;font-weight:500
        }
        .fluxy-kyc__signout:hover {color:#475569;text-decoration:underline}
        html.fluxy-kyc-lock,html.fluxy-kyc-lock body {overflow:hidden!important}
        @keyframes fluxyKycIn {from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion:reduce){.fluxy-kyc{animation:none}}
    `;
    document.head.appendChild(style);
}

/**
 * Build the review screen. One component, two mounts: a full-screen overlay on
 * app pages, and an inline panel on /onboarding right after submit.
 *
 * @param {object} state   from resolveKycState
 * @param {object} options
 * @param {'overlay'|'inline'} options.mode
 * @returns {HTMLElement}
 */
export function renderKycScreen(state, options = {}) {
    const { mode = 'overlay' } = options;
    const cfg = configFor(state);
    injectStyles();

    const root = document.createElement('div');
    root.className = mode === 'inline' ? 'fluxy-kyc fluxy-kyc--inline' : 'fluxy-kyc';
    root.setAttribute('data-fluxy-kyc', mode);
    if (mode === 'overlay') {
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
    }

    // The reviewer note is operator free text — escape it, never translate it.
    const noteHtml = state.note
        ? `<p class="fluxy-kyc__note"><span class="fluxy-kyc__note-label">Note from our team</span>${escapeHtml(state.note)}</p>`
        : '';
    const primaryHtml = cfg.primaryHref
        ? `<a class="fluxy-kyc__primary" href="${cfg.primaryHref}">${cfg.primaryLabel}</a>`
        : '';

    root.innerHTML = `
        <div class="fluxy-kyc__card" role="document">
            <span class="fluxy-kyc__icon">${iconSvg(cfg.icon)}</span>
            <h2 class="fluxy-kyc__title">${cfg.title}</h2>
            <p class="fluxy-kyc__body">${cfg.body}</p>${noteHtml}${primaryHtml}
            <p class="fluxy-kyc__support"><strong>Need help?</strong> Contact our support team at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
            <button type="button" class="fluxy-kyc__signout" data-fluxy-kyc-signout>Sign out</button>
        </div>
    `;
    root.querySelector('[data-fluxy-kyc-signout]')?.addEventListener('click', async () => {
        try { await signOut(getAuth(getApp())); } catch (_) { /* ignore */ }
        window.location.href = '/login';
    });
    return root;
}

// Live unlock: a reviewer approving in the Internal Operations Console should
// open the product in the tab the user is already staring at.
let watching = false;
function watchForApproval(userId) {
    if (watching || !userId) return;
    watching = true;
    try {
        getData().subscribeInternalUser(userId, (internal) => {
            if (internal?.kyc_status === 'approved') window.location.reload();
        }, () => { /* listener failure is non-fatal — the next load re-checks */ });
    } catch (_) { /* ignore */ }
}

/**
 * Lock the current app page when the user is awaiting KYC verification.
 * Returns true if the page was locked (caller must skip its data load).
 *
 * @param {object} authUser  Firebase auth user
 * @returns {Promise<boolean>}
 */
/**
 * Wait briefly for the realtime status when the gate only INFERRED a block.
 *
 * The missing-row branch races its own subscription: it renders the lock, the
 * listener then reports 'approved', and watchForApproval reloads the page — so
 * an approved user sees a verification screen appear and vanish. Confirming
 * against the listener first removes the flash without ever unlocking someone
 * who is genuinely blocked: a timeout keeps the lock.
 */
function confirmBlockedStatus(userId, timeoutMs = 2500) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (blocked) => { if (!settled) { settled = true; resolve(blocked); } };
        // FAIL OPEN when we cannot confirm.
        //
        // This path is reached only when we INFERRED a block from an absent row —
        // we never read a status. If the listener also cannot answer, we have no
        // evidence at all, and locking someone out on no evidence is the wrong
        // default. It is also self-defeating: the listener rides the same realtime
        // channel that ad blockers and strict privacy modes break, so the timeout
        // fired for exactly the users whose reads were already failing, and showed
        // an approved account "Your details are under review" on every reload.
        //
        // Safe because the lock is not the only control: ensureBillingSubscription
        // independently refuses to mint a trial until kyc_status is 'approved', so
        // an genuinely unreviewed user still cannot get a working workspace.
        const timer = setTimeout(() => done(false), timeoutMs);
        try {
            getData().subscribeInternalUser(userId, (internal) => {
                if (!internal) return;             // still absent — keep waiting
                clearTimeout(timer);
                done(internal.kyc_status !== 'approved');
            }, () => { clearTimeout(timer); done(false); });
        } catch (_) { clearTimeout(timer); done(false); }
    });
}

export async function applyToPage(authUser) {
    const state = await resolveKycState(authUser);
    if (!state.blocked) return false;
    if (document.querySelector('[data-fluxy-kyc]')) return true;
    // Only the inferred block waits; a real 'submitted'/'rejected' row locks now.
    if (state.speculative && authUser?.uid) {
        const stillBlocked = await confirmBlockedStatus(authUser.uid);
        if (!stillBlocked) return false;
    }
    try {
        document.documentElement.classList.add('fluxy-kyc-lock');
        document.body.appendChild(renderKycScreen(state, { mode: 'overlay' }));
    } catch (_) {
        return true; // still block the data load even if rendering failed
    }
    watchForApproval(authUser?.uid);
    return true;
}

/**
 * Mount the review screen inside a host element (the onboarding page).
 *
 * @param {object} state  from resolveKycState, or a literal {variant, note}
 * @param {HTMLElement} host
 */
export function renderKycScreenInto(state, host) {
    if (!host) return null;
    host.innerHTML = '';
    const screen = renderKycScreen(state, { mode: 'inline' });
    host.appendChild(screen);
    watchForApproval(state.userId);
    return screen;
}

// Convenience global so non-module scripts can observe gate state if needed.
window.FluxyKycGate = {
    KYC_ENFORCEMENT_CUTOFF,
    isKycEnforcedUser,
    resolveKycState,
    applyToPage,
    renderKycScreen,
    renderKycScreenInto
};
