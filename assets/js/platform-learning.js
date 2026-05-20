import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from './db-service.js';

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const PENDING_TOUR_KEY = 'fluxy_pending_tour';
const TOUR_IDS = ['overview', 'ledger', 'bills', 'fluxy_ai', 'revenue_sync', 'subscriptions'];

const TOUR_CONFIG = {
    overview: {
        route: '/dashboard',
        label: 'Understand your Overview',
        chip: 'Overview',
        description: 'Read revenue, OpEx, margin, action items, and finance health.',
        icon: 'OV',
        steps: [
            { selector: '[data-tour-target="dashboard-revenue-kpi"]', title: 'Live revenue', body: 'This shows income-side records from your ledger for the selected period.' },
            { selector: '[data-tour-target="dashboard-opex-kpi"]', title: 'Operating spend', body: 'OpEx tracks expenses, fees, taxes, and pending payables.' },
            { selector: '[data-tour-target="dashboard-margin-kpi"]', title: 'Gross margin', body: 'Margin shows what is left after operating expenses.' },
            { selector: '[data-tour-target="dashboard-needs-action"]', title: 'Needs Action', body: 'Use this to spot records that need cleanup, like missing receipts.' },
            { selector: '[data-tour-target="dashboard-ledger-preview"]', title: 'Ledger preview', body: 'Your latest records appear here so you can quickly check recent activity.' },
            { selector: '[data-tour-target="fluxy-ai-entry"]', title: 'Fluxy AI', body: 'Ask finance questions when FluxyOS has enough user-scoped data to answer.' }
        ]
    },
    ledger: {
        route: '/ledger',
        label: 'Import your first ledger data',
        chip: 'Ledger',
        description: 'Add income, expenses, CSV records, and review your ledger.',
        icon: 'LD',
        steps: [
            { selector: '[data-tour-target="ledger-add-transaction"]', title: 'Add Transaction', body: 'Use this to add one income, expense, fee, tax, transfer, or CSV upload.' },
            { selector: '[data-tour-target="ledger-date-filter"]', title: 'Period filter', body: 'Filter by date so charts, rows, and exports stay focused.' },
            { selector: '[data-tour-target="ledger-control-cards"]', title: 'Ledger quality', body: 'These cards summarize missing receipts and records that need review.' },
            { selector: '[data-tour-target="ledger-table"]', title: 'Ledger table', body: 'This is your transaction source of truth for reporting and cleanup.' },
            { selector: '[data-tour-target="ledger-export"]', title: 'CSV export', body: 'Download the currently loaded ledger period when records are available.' }
        ]
    },
    bills: {
        route: '/bill',
        label: 'Track bills and due dates',
        chip: 'Bills',
        description: 'Learn payables, due dates, schedules, and payment status.',
        icon: 'BL',
        steps: [
            { selector: '[data-tour-target="bill-add"]', title: 'Add Bill', body: 'Create a payable before money leaves the business.' },
            { selector: '[data-tour-target="bill-due-summary"]', title: 'Due dates', body: 'Due dates help you see upcoming cash pressure.' },
            { selector: '[data-tour-target="bill-timeline"]', title: 'Payment timeline', body: 'Bills are grouped by urgency so you know what to review first.' },
            { selector: '[data-tour-target="bill-table"]', title: 'Bills table', body: 'Review vendor, category, due date, amount, status, and available actions.' },
            { selector: '[data-tour-target="bill-action-column"]', title: 'Payment actions', body: 'Payment-like actions stay unavailable until a real handler exists.' }
        ]
    },
    fluxy_ai: {
        route: '/ai',
        label: 'Ask Fluxy AI',
        chip: 'AI',
        description: 'Ask grounded finance questions from your FluxyOS data.',
        icon: 'AI',
        steps: [
            { selector: '[data-tour-target="ai-greeting"]', title: 'Fluxy AI home', body: 'Fluxy AI answers questions about your FluxyOS finance data.' },
            { selector: '[data-tour-target="ai-prompts"]', title: 'Suggested questions', body: 'Start with guided prompts when you are not sure what to ask.' },
            { selector: '[data-tour-target="ai-composer"]', title: 'Ask a question', body: 'Ask about revenue, OpEx, bills, subscriptions, receipts, or ledger quality.' },
            { selector: '[data-tour-target="ai-send"]', title: 'Grounded answers', body: 'If there is no data, Fluxy AI should explain what is missing instead of inventing numbers.' }
        ]
    },
    revenue_sync: {
        route: '/revenue-sync',
        label: 'Connect revenue sources',
        chip: 'Revenue',
        description: 'Learn channels, revenue rows, reconciliation, and sync status.',
        icon: 'RS',
        steps: [
            { selector: '[data-tour-target="revenue-connect"]', title: 'Connect channels', body: 'Revenue Sync is for source visibility, not general expense tracking.' },
            { selector: '[data-tour-target="revenue-summary"]', title: 'Revenue health', body: 'These cards summarize revenue rows, detected channels, and review needs.' },
            { selector: '[data-tour-target="revenue-channels"]', title: 'Connected channels', body: 'Channels group synced or manually detected revenue sources.' },
            { selector: '[data-tour-target="revenue-table"]', title: 'Revenue rows', body: 'Use this table to review revenue transactions and flags.' }
        ]
    },
    subscriptions: {
        route: '/subscription',
        label: 'Manage subscriptions',
        chip: 'Subscriptions',
        description: 'Track recurring SaaS spend and renewal cycles.',
        icon: 'SB',
        steps: [
            { selector: '[data-tour-target="subscription-add"]', title: 'Add Subscription', body: 'Add recurring SaaS or vendor costs here.' },
            { selector: '[data-tour-target="subscription-table"]', title: 'Subscription table', body: 'Track service name, monthly cost, renewal date, status, and actions.' },
            { selector: '[data-tour-target="subscription-renewal"]', title: 'Renewal dates', body: 'Renewal dates help prevent surprise charges.' },
            { selector: '[data-tour-target="subscription-manage"]', title: 'Manage action', body: 'Management actions are visible, but real cancel flows are planned later.' }
        ]
    }
};

let activeTour = null;
let lastFocusedElement = null;

function getApp() {
    return getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
}

function getDataService() {
    return new DataService(getApp());
}

function getAuthUser() {
    return getAuth(getApp()).currentUser;
}

function normalizePath(pathname = window.location.pathname) {
    const clean = pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/dashboard';
    return clean === '/' ? '/dashboard' : clean;
}

function readPendingTour() {
    const raw = sessionStorage.getItem(PENDING_TOUR_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : parsed?.tour_id;
    } catch (_) {
        return raw;
    }
}

function savePendingTour(tourId) {
    sessionStorage.setItem(PENDING_TOUR_KEY, tourId);
}

function clearPendingTour() {
    sessionStorage.removeItem(PENDING_TOUR_KEY);
}

function getRenderableTours() {
    return TOUR_IDS.filter(tourId => TOUR_CONFIG[tourId]);
}

function isTourComplete(learningState, tourId) {
    return Array.isArray(learningState?.completed_tours) && learningState.completed_tours.includes(tourId);
}

async function canUsePlatformLearning(userId, ds = getDataService()) {
    if (!userId) return false;
    const onboardingProgress = await ds.getOnboardingProgress(userId);
    if (!onboardingProgress?.onboarding_completed) return false;
    if (onboardingProgress?.gate_required === true) return false;
    if (onboardingProgress?.onboarding_exempt === true) return false;
    if (onboardingProgress?.source === 'legacy_exemption') return false;
    return true;
}

export async function getPlatformLearningState(userId) {
    try {
        return await getDataService().getPlatformLearningState(userId);
    } catch (_) {
        return null;
    }
}

export async function shouldShowPlatformLearning(userId) {
    if (!userId) return false;
    const ds = getDataService();
    try {
        if (!await canUsePlatformLearning(userId, ds)) return false;

        const learningState = await ds.getPlatformLearningState(userId);
        if (learningState?.dismissed === true) return false;

        const completedTours = learningState?.completed_tours || [];
        if (getRenderableTours().every(tourId => completedTours.includes(tourId))) return false;

        return true;
    } catch (_) {
        return false;
    }
}

export async function renderQuickStartLearning(containerId, options = {}) {
    const container = document.getElementById(containerId);
    const userId = options.userId || getAuthUser()?.uid;
    if (!container || !userId) return;

    const showLearning = await shouldShowPlatformLearning(userId);
    if (!showLearning) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    const state = await getDataService().getPlatformLearningState(userId);
    await getDataService().savePlatformLearningState(userId, {});

    const cards = getRenderableTours().map((tourId) => {
        const tour = TOUR_CONFIG[tourId];
        const done = isTourComplete(state, tourId);
        return `
            <button type="button" class="platform-learning-card" data-platform-tour="${tourId}" aria-label="Start ${tour.label}">
                <span class="platform-learning-card-chip">${tour.chip}</span>
                <span class="platform-learning-card-visual" aria-hidden="true">
                    <span>${tour.icon}</span>
                </span>
                <span class="platform-learning-card-copy">
                    <span class="platform-learning-card-title">${tour.label}</span>
                    <span class="platform-learning-card-desc">${tour.description}</span>
                </span>
                <span class="platform-learning-card-footer">
                    <span>${done ? 'Done' : 'Start guide'}</span>
                    <span aria-hidden="true">-&gt;</span>
                </span>
            </button>
        `;
    }).join('');

    container.classList.remove('hidden');
    container.innerHTML = `
        <section class="platform-learning-section" aria-labelledby="platform-learning-title">
            <div class="platform-learning-header">
                <div>
                    <h2 id="platform-learning-title">Quick ways to get started</h2>
                    <p>Pick what you want to learn first. FluxyOS will guide you through the page step by step.</p>
                </div>
                <button type="button" class="platform-learning-dismiss" data-platform-learning-dismiss>Dismiss</button>
            </div>
            <div class="platform-learning-row">
                ${cards}
            </div>
        </section>
    `;

    container.querySelector('[data-platform-learning-dismiss]')?.addEventListener('click', async () => {
        await dismissPlatformLearning(userId);
        container.innerHTML = '';
        container.classList.add('hidden');
    });

    container.querySelectorAll('[data-platform-tour]').forEach(card => {
        card.addEventListener('click', () => startPlatformTour(card.dataset.platformTour, userId));
    });
}

export async function startPlatformTour(tourId, userId = getAuthUser()?.uid) {
    const tour = TOUR_CONFIG[tourId];
    if (!tour || !userId) return;

    try {
        if (!await canUsePlatformLearning(userId)) {
            clearPendingTour();
            return;
        }
    } catch (_) {
        clearPendingTour();
        return;
    }

    try {
        await getDataService().markPlatformTourStarted(userId, tourId);
    } catch (_) {
        window.showToast?.('Could not save guide progress. The guide can still run.', 'info');
    }

    savePendingTour(tourId);
    if (normalizePath() !== tour.route) {
        window.location.href = tour.route;
        return;
    }
    await continuePendingTourIfAny(userId);
}

export async function continuePendingTourIfAny(userId = getAuthUser()?.uid) {
    const tourId = readPendingTour();
    const tour = TOUR_CONFIG[tourId];
    if (!tour || !userId) {
        if (tourId && !tour) clearPendingTour();
        return;
    }

    const ds = getDataService();
    try {
        if (!await canUsePlatformLearning(userId, ds)) {
            clearPendingTour();
            return;
        }
    } catch (_) {
        clearPendingTour();
        return;
    }

    if (normalizePath() !== tour.route) return;

    const validSteps = tour.steps
        .map(step => ({ ...step, target: document.querySelector(step.selector) }))
        .filter(step => step.target);

    clearPendingTour();

    if (!validSteps.length) {
        window.showToast?.('This guide is not available on this page yet.', 'info');
        await ds.markPlatformTourSkipped(userId, tourId).catch(() => {});
        return;
    }

    runTour(userId, tourId, validSteps);
}

export async function markTourCompleted(userId, tourId) {
    await getDataService().markPlatformTourCompleted(userId, tourId);
}

export async function dismissPlatformLearning(userId) {
    await getDataService().dismissPlatformLearning(userId);
}

function runTour(userId, tourId, steps) {
    closeActiveTour(false);
    lastFocusedElement = document.activeElement;
    activeTour = { userId, tourId, steps, index: 0 };

    const overlay = document.createElement('div');
    overlay.id = 'fluxy-tour-overlay';
    overlay.className = 'fluxy-tour-overlay';

    const popover = document.createElement('div');
    popover.id = 'fluxy-tour-popover';
    popover.className = 'fluxy-tour-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-live', 'polite');

    document.body.append(overlay, popover);
    document.body.classList.add('fluxy-tour-active');
    document.addEventListener('keydown', handleTourKeydown);
    renderCurrentStep();
}

function renderCurrentStep() {
    if (!activeTour) return;
    const { steps, index } = activeTour;
    const step = steps[index];
    const target = step.target;
    const popover = document.getElementById('fluxy-tour-popover');
    if (!target || !popover) return;

    document.querySelectorAll('.fluxy-tour-highlight').forEach(el => el.classList.remove('fluxy-tour-highlight'));
    target.classList.add('fluxy-tour-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    popover.innerHTML = `
        <button type="button" class="fluxy-tour-skip" data-tour-skip>Skip</button>
        <p class="fluxy-tour-count">${index + 1}/${steps.length}</p>
        <h3>${step.title}</h3>
        <p>${step.body}</p>
        <div class="fluxy-tour-actions">
            <button type="button" class="fluxy-tour-secondary" data-tour-back ${index === 0 ? 'disabled' : ''}>Back</button>
            <button type="button" class="fluxy-tour-primary" data-tour-next>${index === steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>
    `;

    popover.querySelector('[data-tour-skip]')?.addEventListener('click', () => finishTour('skipped'));
    popover.querySelector('[data-tour-back]')?.addEventListener('click', () => {
        if (activeTour.index > 0) {
            activeTour.index -= 1;
            renderCurrentStep();
        }
    });
    popover.querySelector('[data-tour-next]')?.addEventListener('click', () => {
        if (activeTour.index >= activeTour.steps.length - 1) finishTour('completed');
        else {
            activeTour.index += 1;
            renderCurrentStep();
        }
    });

    window.requestAnimationFrame(() => positionPopover(target, popover));
    popover.querySelector('[data-tour-next]')?.focus();
}

function positionPopover(target, popover) {
    const rect = target.getBoundingClientRect();
    const spacing = 14;
    const width = Math.min(360, window.innerWidth - 24);
    popover.style.width = `${width}px`;

    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;

    let top = rect.bottom + spacing;
    const popoverHeight = popover.offsetHeight || 220;
    if (top + popoverHeight > window.innerHeight - 12) {
        top = rect.top - popoverHeight - spacing;
    }
    if (top < 12) top = 12;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

async function finishTour(result) {
    if (!activeTour) return;
    const { userId, tourId } = activeTour;
    try {
        if (result === 'completed') {
            await getDataService().markPlatformTourCompleted(userId, tourId);
            window.showToast?.('Guide completed.', 'success');
        } else {
            await getDataService().markPlatformTourSkipped(userId, tourId);
        }
    } catch (_) {
        window.showToast?.('Could not save guide progress.', 'info');
    }
    closeActiveTour(true);
}

function closeActiveTour(restoreFocus = true) {
    document.removeEventListener('keydown', handleTourKeydown);
    document.body.classList.remove('fluxy-tour-active');
    document.querySelectorAll('.fluxy-tour-highlight').forEach(el => el.classList.remove('fluxy-tour-highlight'));
    document.getElementById('fluxy-tour-overlay')?.remove();
    document.getElementById('fluxy-tour-popover')?.remove();
    if (restoreFocus && lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
    activeTour = null;
    lastFocusedElement = null;
}

function handleTourKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        finishTour('skipped');
        return;
    }
    if (event.key !== 'Tab') return;
    const popover = document.getElementById('fluxy-tour-popover');
    const focusable = Array.from(popover?.querySelectorAll('button:not([disabled])') || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

window.FluxyPlatformLearning = {
    shouldShowPlatformLearning,
    renderQuickStartLearning,
    startPlatformTour,
    continuePendingTourIfAny,
    markTourCompleted,
    dismissPlatformLearning,
    getPlatformLearningState
};
