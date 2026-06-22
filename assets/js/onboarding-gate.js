// FluxyOS Onboarding Gate
// New-user-only detection + dashboard gate rendering.
// Existing users (created before ONBOARDING_RELEASE_CUTOFF) are exempt and never gated.

import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    addDoc,
    collection,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { resolveDb } from "/assets/js/firestore-db.js";

// Set 24h before the actual deploy so brand-new signups whose UTC creation
// timestamp lands just before midnight UTC of the deploy day are still caught
// by the gate (Firebase records `creationTime` in UTC, so a Jakarta-time
// "today" can be the previous UTC day).
export const ONBOARDING_RELEASE_CUTOFF = new Date("2026-05-19T00:00:00.000Z");

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

function getDb() {
    // Route through the shared long-polling initializer (see firestore-db.js) so
    // the gate — often the first Firestore touch on a page — doesn't lock the app
    // into the blocker-prone WebChannel transport via a bare getFirestore().
    return resolveDb(getApp());
}

// ----- Detection -----

export function isNewUserAfterCutoff(authUser) {
    const created = authUser?.metadata?.creationTime;
    if (!created) return false; // fail open: missing metadata never gates
    const d = new Date(created);
    return !Number.isNaN(d.getTime()) && d >= ONBOARDING_RELEASE_CUTOFF;
}

export async function getOnboardingProgress(userId) {
    try {
        const snap = await getDoc(doc(getDb(), `users/${userId}/onboarding/progress`));
        return snap.exists() ? snap.data() : null;
    } catch (err) {
        console.warn("[OnboardingGate] progress read failed");
        return null;
    }
}

export async function markLegacyExempt(userId) {
    try {
        await setDoc(doc(getDb(), `users/${userId}/onboarding/progress`), {
            onboarding_exempt: true,
            onboarding_completed: false,
            eligible_for_onboarding_gate: false,
            source: "legacy_exemption",
            updated_at: serverTimestamp(),
            created_at: serverTimestamp()
        }, { merge: true });
    } catch (err) {
        // fail silent: legacy user behavior must not depend on this write succeeding
    }
}

async function clearStaleLegacyExempt(userId) {
    // The user is now post-cutoff but was previously stamped with a stale
    // legacy_exemption marker (e.g., cutoff was moved back after a too-tight
    // initial value was deployed). Clear it so they go through onboarding.
    try {
        await setDoc(doc(getDb(), `users/${userId}/onboarding/progress`), {
            onboarding_exempt: false,
            eligible_for_onboarding_gate: true,
            source: "onboarding_v2",
            updated_at: serverTimestamp()
        }, { merge: true });
    } catch (err) {
        // fail silent
    }
}

export async function shouldGateUser(authUser) {
    if (!authUser?.uid) return false;
    if (!isNewUserAfterCutoff(authUser)) {
        markLegacyExempt(authUser.uid); // fire and forget
        return false;
    }
    const progress = await getOnboardingProgress(authUser.uid);
    if (progress?.onboarding_completed === true) return false;
    if (progress?.onboarding_exempt === true && progress?.source === 'legacy_exemption') {
        // Self-heal: the cutoff now classifies this user as new, so any prior
        // legacy_exemption stamp is stale. Clear it and gate the user.
        clearStaleLegacyExempt(authUser.uid); // fire and forget
    } else if (progress?.onboarding_exempt === true) {
        return false;
    }
    return true;
}

// ----- Routing -----

export async function redirectIfRequired(authUser) {
    const gate = await shouldGateUser(authUser);
    if (gate) {
        window.location.replace("/onboarding");
        return true;
    }
    return false;
}

// ----- Per-page gate config -----

const PAGE_CONFIG = {
    overview: {
        title: "Complete basic setup to unlock your finance workspace.",
        body: "FluxyOS needs a business profile and account-owner details before enabling ledger actions, bills, subscriptions, exports, integrations, and AI finance analysis.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Upload proof only when needed. Extra verification appears later for higher-trust features."
        ],
        // selectors of buttons/inputs that should be disabled visually
        disable: ['header button', '#brain-chat-input', '#brain-chat-submit', '[data-action="add-record"]', '[data-action="export"]'],
        lockTargets: ['.overview-summary-shell', '.overview-lower-grid']
    },
    transactions: {
        title: "Complete setup to add and import transactions.",
        body: "Transaction actions are blocked so records are not created under an incomplete workspace profile.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then come back here to add or import transactions."
        ],
        disable: ['header button', '[data-action="add-record"]', '[data-action="add-transaction"]', '[data-action="csv-import"]', '[data-action="export"]'],
        lockTargets: ['#ledger-table-container', '#ledger-empty-state', '.ledger-shell', 'main .max-w-\\[1400px\\] > section']
    },
    bills: {
        title: "Complete setup to manage bills.",
        body: "A scanned bill should create a bill or payable only after user confirmation and a valid workspace context.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then come back here to upload or scan bills."
        ],
        disable: ['header button', '[data-action="add-bill"]', '[data-action="scan-bill"]', '[data-action="pay-bill"]'],
        lockTargets: ['#bills-table-container', '.bills-shell', 'main .max-w-\\[1400px\\] > section']
    },
    subscriptions: {
        title: "Complete setup to manage subscriptions.",
        body: "Subscriptions need workspace context so categories, renewal dates, and spend analysis stay clean.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then come back here to add and track subscriptions."
        ],
        disable: ['header button', '[data-action="add-subscription"]'],
        lockTargets: ['#subscriptions-table-container', '.subscriptions-shell', 'main .max-w-\\[1400px\\] > section']
    },
    revenue_sync: {
        title: "Complete setup before connecting revenue sources.",
        body: "Revenue Sync should stay locked until the business profile and verification status are known.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then return to connect your revenue sources."
        ],
        disable: ['header button', '[data-action="connect-source"]'],
        lockTargets: ['main .max-w-\\[1400px\\] > section', '.revenue-sync-shell']
    },
    integrations: {
        title: "Complete setup before connecting integrations.",
        body: "Connection flows should remain blocked until verification status and business ownership context are known.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then return to connect integrations."
        ],
        disable: ['header button', '[data-action="connect-integration"]'],
        lockTargets: ['main .max-w-\\[1400px\\] > section', '.integrations-shell']
    },
    reports: {
        title: "Complete setup before generating reports.",
        body: "Reports & Exports turns real FluxyOS records into a sendable finance package. The workspace profile must be in place before exports can be confirmed and logged.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then come back here to preview and export financial reports."
        ],
        disable: ['header button', '[data-preview-report]', '#topbar-generate-btn', '#recommended-generate-btn', '#drawer-confirm-btn'],
        lockTargets: ['main .max-w-\\[1400px\\] > section']
    },
    'balance-sheet': {
        title: "Complete setup before viewing the Balance Sheet.",
        body: "The Balance Sheet uses your user-scoped FluxyOS records to show assets, liabilities, and net position. Finish setup before exporting or sharing this report.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then come back here to review and export the Balance Sheet."
        ],
        disable: ['header button', '#bs-export-btn', '#bs-print-btn'],
        lockTargets: ['main .bs-report-shell > section', '#bs-report-panel']
    },
    fluxy_ai: {
        title: "Complete setup before using Fluxy AI.",
        body: "AI finance answers must be grounded in your user-scoped data. Finish setup and add records before asking business performance questions.",
        steps: [
            "Confirm your business name, role, and main finance goal.",
            "Add the account owner details so FluxyOS can protect the workspace.",
            "Then return to ask Fluxy AI about your finances."
        ],
        disable: ['header button', '[data-action="ai-submit"]', '#brain-chat-input', '#brain-chat-submit'],
        lockTargets: ['main .max-w-\\[1400px\\] > section', '.ai-shell']
    }
};

// ----- Rendering -----

let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'onboarding-gate-styles';
    style.textContent = `
        .onboarding-gate-card {
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 16px;
            padding: 28px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
            display: grid;
            grid-template-columns: minmax(0, 1fr) 240px;
            gap: 28px;
            align-items: start;
            margin-bottom: 24px;
        }
        @media (max-width: 768px) {
            .onboarding-gate-card { grid-template-columns: 1fr; }
            .onboarding-gate-illustration { display: none; }
        }
        .onboarding-gate-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #FFF7ED;
            border: 1px solid #FFEDD5;
            color: #C2410C;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 999px;
            margin-bottom: 12px;
            text-transform: none;
            letter-spacing: 0;
        }
        .onboarding-gate-pill::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #EA580C;
        }
        .onboarding-gate-title {
            font-size: 22px;
            font-weight: 700;
            color: #0B0F19;
            line-height: 1.25;
            margin: 0 0 12px;
            max-width: 28ch;
        }
        .onboarding-gate-body {
            font-size: 13px;
            color: #6b7280;
            line-height: 1.55;
            margin: 0 0 18px;
            max-width: 56ch;
        }
        .onboarding-gate-steps {
            list-style: none;
            padding: 0;
            margin: 0 0 22px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .onboarding-gate-steps li {
            display: grid;
            grid-template-columns: 24px 1fr;
            gap: 12px;
            align-items: start;
            font-size: 13px;
            color: #374151;
            line-height: 1.5;
        }
        .onboarding-gate-step-num {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: #f3f4f6;
            color: #6b7280;
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .onboarding-gate-cta {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #0B0F19;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            padding: 10px 18px;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            transition: background 0.15s;
        }
        .onboarding-gate-cta:hover { background: #1f2937; }
        .onboarding-gate-illustration {
            background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%);
            border: 1px solid #E5E7EB;
            border-radius: 14px;
            padding: 22px;
            position: relative;
            min-height: 180px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .onboarding-gate-illustration .preview-card {
            background: #fff;
            border: 1px solid #E5E7EB;
            border-radius: 10px;
            padding: 16px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.04);
            position: relative;
            width: 100%;
        }
        .onboarding-gate-illustration .preview-bar {
            height: 6px;
            background: #E5E7EB;
            border-radius: 3px;
            margin-bottom: 8px;
        }
        .onboarding-gate-illustration .preview-bar.short { width: 60%; }
        .onboarding-gate-illustration .preview-amount {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            font-family: ui-monospace, monospace;
            margin-top: 8px;
        }
        .onboarding-gate-illustration .check {
            position: absolute;
            bottom: -10px;
            right: -10px;
            width: 36px;
            height: 36px;
            background: #10b981;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            box-shadow: 0 4px 8px rgba(16,185,129,0.25);
        }
        .onboarding-gate-locked-wrap {
            position: relative;
        }
        .onboarding-gate-locked-wrap > .onboarding-gate-locked-content {
            filter: blur(4px);
            pointer-events: none;
            user-select: none;
        }
        .onboarding-gate-locked-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255,255,255,0.55);
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
            z-index: 5;
            border-radius: 12px;
        }
        .onboarding-gate-locked-card {
            background: #fff;
            border: 1px solid #E5E7EB;
            border-radius: 14px;
            padding: 24px 28px;
            text-align: center;
            box-shadow: 0 6px 20px rgba(0,0,0,0.06);
            max-width: 420px;
        }
        .onboarding-gate-locked-icon {
            width: 40px;
            height: 40px;
            background: #FFF7ED;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #EA580C;
            font-weight: 700;
            font-size: 18px;
            margin-bottom: 12px;
        }
        .onboarding-gate-locked-title {
            font-size: 15px;
            font-weight: 700;
            color: #0B0F19;
            margin: 0 0 6px;
        }
        .onboarding-gate-locked-body {
            font-size: 13px;
            color: #6b7280;
            line-height: 1.5;
            margin: 0 0 16px;
        }
        .onboarding-gate-disabled {
            pointer-events: none !important;
            opacity: 0.45 !important;
            cursor: not-allowed !important;
        }
    `;
    document.head.appendChild(style);
}

function renderGateCard(pageKey) {
    const cfg = PAGE_CONFIG[pageKey] || PAGE_CONFIG.overview;
    const stepsHtml = cfg.steps.map((s, i) =>
        `<li><span class="onboarding-gate-step-num">${i + 1}</span><span>${s}</span></li>`
    ).join('');
    const wrap = document.createElement('div');
    wrap.className = 'onboarding-gate-card';
    wrap.setAttribute('data-onboarding-gate', 'card');
    wrap.innerHTML = `
        <div>
            <span class="onboarding-gate-pill">Secure setup required</span>
            <h2 class="onboarding-gate-title">${cfg.title}</h2>
            <p class="onboarding-gate-body">${cfg.body}</p>
            <ul class="onboarding-gate-steps">${stepsHtml}</ul>
            <button type="button" class="onboarding-gate-cta" data-onboarding-gate-action="continue">
                Continue setup
            </button>
        </div>
        <div class="onboarding-gate-illustration" aria-hidden="true">
            <div class="preview-card">
                <div class="preview-bar"></div>
                <div class="preview-bar short"></div>
                <div class="preview-amount">Rp0</div>
                <div class="check">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
            </div>
        </div>
    `;
    wrap.querySelector('[data-onboarding-gate-action="continue"]').addEventListener('click', () => {
        window.location.href = '/onboarding';
    });
    return wrap;
}

function renderLockedOverlay(target) {
    if (!target || target.querySelector('[data-onboarding-gate="overlay"]')) return;
    target.classList.add('onboarding-gate-locked-wrap');
    // wrap existing children
    const inner = document.createElement('div');
    inner.className = 'onboarding-gate-locked-content';
    while (target.firstChild) inner.appendChild(target.firstChild);
    target.appendChild(inner);

    const overlay = document.createElement('div');
    overlay.className = 'onboarding-gate-locked-overlay';
    overlay.setAttribute('data-onboarding-gate', 'overlay');
    overlay.innerHTML = `
        <div class="onboarding-gate-locked-card">
            <div class="onboarding-gate-locked-icon">!</div>
            <h3 class="onboarding-gate-locked-title">This area is locked until setup is complete.</h3>
            <p class="onboarding-gate-locked-body">Finish the basic setup first. After that, this page will use your real FluxyOS data instead of a locked preview.</p>
            <button type="button" class="onboarding-gate-cta" data-onboarding-gate-action="continue">Continue setup</button>
        </div>
    `;
    overlay.querySelector('[data-onboarding-gate-action="continue"]').addEventListener('click', () => {
        window.location.href = '/onboarding';
    });
    target.appendChild(overlay);
}

function disableActions(selectors) {
    selectors.forEach((sel) => {
        try {
            document.querySelectorAll(sel).forEach((el) => {
                el.classList.add('onboarding-gate-disabled');
                if ('disabled' in el) el.disabled = true;
            });
        } catch (e) {
            // bad selector — skip silently
        }
    });
}

/**
 * Apply the gate to the current page if the user is a new, incomplete user.
 * Returns true if the gate was rendered (caller should skip data load).
 *
 * @param {object} authUser  Firebase auth user
 * @param {object} options
 * @param {string} options.pageKey  one of PAGE_CONFIG keys
 */
export async function applyToPage(authUser, options = {}) {
    const { pageKey = 'overview' } = options;

    // Resolve the active workspace BEFORE the page reads any finance data. Every
    // app page calls applyToPage right after auth and before its data load, so
    // resolving here guarantees db-service._scope() targets the SHARED workspace
    // on EVERY page — not the member's own empty workspaces/{uid} — without each
    // page having to remember to resolve first. This is what made invited members
    // hit permission-denied / 0 data on pages that lacked an explicit
    // resolveWorkspace (invoices, budgets, accounting, reports, balance sheet,
    // revenue sync, integrations). Best-effort; never blocks gating.
    if (authUser && authUser.uid) {
        try {
            const { resolveWorkspace } = await import('/assets/js/workspace-service.js');
            await resolveWorkspace(getApp(), authUser);
        } catch (_) { /* _scope falls back safely if resolution is unavailable */ }
    }

    const gate = await shouldGateUser(authUser);
    if (!gate) return false;

    injectStyles();

    const cfg = PAGE_CONFIG[pageKey] || PAGE_CONFIG.overview;

    // Find an anchor: prefer the inner mx-auto content wrapper that FluxyOS
    // app pages render inside <main> > div.flex-1.overflow-y-auto. The max-w
    // class varies per page (1400px / 7xl / etc), so match by mx-auto.
    const scrollArea = document.querySelector('main .flex-1.overflow-y-auto') || document.querySelector('main');
    const anchor =
        scrollArea?.querySelector(':scope > [class*="mx-auto"]') ||
        scrollArea ||
        document.body;

    const card = renderGateCard(pageKey);
    anchor.insertBefore(card, anchor.firstChild);

    // Lock the main content sections — try each selector; if none match, fall
    // back to overlaying everything after the gate card inside the anchor.
    let lockedAny = false;
    (cfg.lockTargets || []).forEach((sel) => {
        try {
            document.querySelectorAll(sel).forEach((el) => {
                if (el === card || card.contains(el)) return;
                renderLockedOverlay(el);
                lockedAny = true;
            });
        } catch (e) { /* skip bad selector */ }
    });
    if (!lockedAny) {
        // Wrap remaining anchor children (everything after the inserted card) in a lock.
        const rest = Array.from(anchor.children).filter((c) => c !== card);
        if (rest.length) {
            const lockWrap = document.createElement('div');
            rest.forEach((c) => lockWrap.appendChild(c));
            anchor.appendChild(lockWrap);
            renderLockedOverlay(lockWrap);
        }
    }

    // Disable header actions, AI inputs, etc.
    disableActions(cfg.disable || []);

    return true;
}

export function continueSetup() {
    window.location.href = '/onboarding';
}

// Convenience global so non-module scripts can detect/observe gate state if needed.
window.OnboardingGate = {
    ONBOARDING_RELEASE_CUTOFF,
    isNewUserAfterCutoff,
    shouldGateUser,
    redirectIfRequired,
    applyToPage,
    continueSetup
};
