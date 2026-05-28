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
const LEARNING_FOCUS_KEY = 'fluxy_learning_focus';
const PROMOTER_SKIP_KEY = 'fluxy_learning_promoter_skipped';
const PROMOTER_SHOWN_KEY = 'fluxy_learning_promoter_shown';
const TOUR_IDS = ['overview', 'fluxy_ai', 'ledger', 'bills', 'budgets', 'revenue_sync', 'subscriptions'];

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
            { selector: '#ledger-empty-state:not(.hidden), [data-tour-target="ledger-table"]', title: 'Ledger table', body: 'This is your transaction source of truth for reporting and cleanup.' },
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
            { selector: '#bill-empty-state:not(.hidden), [data-tour-target="bill-table"]', title: 'Bills table', body: 'Review vendor, category, due date, amount, status, and available actions.' },
            { selector: '[data-tour-target="bill-action-column"]', title: 'Payment actions', body: 'Payment-like actions stay unavailable until a real handler exists.' }
        ]
    },
    budgets: {
        route: '/budget',
        label: 'Plan and track your budget',
        chip: 'Budgets',
        description: 'Set a spending envelope, split allocations, and see what remains.',
        icon: 'BG',
        steps: [
            { selector: '#budget-period-select', title: 'Pick a period', body: 'Each month or quarter has its own plan — choose which one you are viewing.' },
            { selector: '#budget-total', title: 'Spending envelope', body: 'The total budget you set for the selected period.' },
            { selector: '#budget-allocation-map', title: 'Allocations', body: 'See how the envelope is split across Marketing, Infrastructure, Operations, and SaaS.' },
            { selector: '#budget-spent', title: 'Spent and reserved', body: 'Actual spend plus committed bills, so you know how close you are to the limit.' },
            { selector: '#budget-create-btn', title: 'Edit your budget', body: 'Open the wizard any time to change the envelope or rebalance allocations.' }
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
            { selector: '#revenue-empty-state:not(.hidden), [data-tour-target="revenue-table"]', title: 'Revenue rows', body: 'Use this table to review revenue transactions and flags.' }
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
            { selector: '#sub-empty-state:not(.hidden), [data-tour-target="subscription-table"]', title: 'Subscription table', body: 'Track service name, monthly cost, renewal date, status, and actions.' },
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

function renderArrowIcon() {
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12h13"></path>
            <path d="m13 6 6 6-6 6"></path>
        </svg>
    `;
}

function renderChevronIcon(direction) {
    const path = direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6';
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="${path}"></path>
        </svg>
    `;
}

function renderCardVisual(tourId) {
    const visualClass = `platform-learning-visual-${tourId.replace('_', '-')}`;
    const scenes = {
        overview: `
            <span class="pl-mini-panel pl-mini-panel-main">
                <span class="pl-mini-kpi-row">
                    <span></span><span></span><span></span>
                </span>
                <span class="pl-mini-chart">
                    <span style="height: 42%;"></span>
                    <span style="height: 70%;"></span>
                    <span style="height: 52%;"></span>
                    <span style="height: 82%;"></span>
                </span>
            </span>
            <span class="pl-mini-badge pl-mini-badge-top">Margin</span>
            <span class="pl-mini-badge pl-mini-badge-bottom">Needs action</span>
        `,
        ledger: `
            <span class="pl-mini-table">
                <span></span><span></span><span></span><span></span>
            </span>
            <span class="pl-mini-upload">
                <span class="pl-mini-upload-icon"></span>
                CSV
            </span>
            <span class="pl-mini-route-line"></span>
        `,
        bills: `
            <span class="pl-mini-calendar">
                <span class="pl-mini-calendar-top"></span>
                <span class="pl-mini-calendar-grid"><span></span><span></span><span></span><span></span><span></span><span></span></span>
            </span>
            <span class="pl-mini-due-card">Due soon</span>
            <span class="pl-mini-status-pill">Open</span>
        `,
        fluxy_ai: `
            <span class="pl-ai-orbit pl-ai-orbit-a"></span>
            <span class="pl-ai-orbit pl-ai-orbit-b"></span>
            <span class="pl-ai-core">
                <span class="pl-ai-core-mark">AI</span>
            </span>
            <span class="pl-mini-chat pl-mini-chat-user">Can I pay bills?</span>
            <span class="pl-mini-chat pl-mini-chat-ai">Check cash runway</span>
            <span class="pl-mini-ai-input"><span></span><span></span></span>
        `,
        budgets: `
            <span class="pl-mini-budget-bar">
                <span style="width: 40%;"></span>
                <span style="width: 26%;"></span>
                <span style="width: 18%;"></span>
            </span>
            <span class="pl-mini-budget-card">
                <span></span><span></span>
            </span>
            <span class="pl-mini-budget-pill">Remaining</span>
        `,
        revenue_sync: `
            <span class="pl-mini-channel pl-mini-channel-a">Storefront</span>
            <span class="pl-mini-channel pl-mini-channel-b">Payments</span>
            <span class="pl-mini-channel-line"></span>
            <span class="pl-mini-sync-card">
                <span></span><span></span><span></span>
            </span>
        `,
        subscriptions: `
            <span class="pl-mini-stack-card pl-mini-stack-back"></span>
            <span class="pl-mini-stack-card pl-mini-stack-mid"></span>
            <span class="pl-mini-stack-card pl-mini-stack-front">
                <span></span><span></span>
            </span>
            <span class="pl-mini-renewal-pill">Renews</span>
        `
    };

    return `<span class="platform-learning-card-visual ${visualClass}" aria-hidden="true">${scenes[tourId] || ''}</span>`;
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

function isVisibleTourTarget(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 8
        && rect.height > 8
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0';
}

function findTourTarget(selector) {
    try {
        return Array.from(document.querySelectorAll(selector)).find(isVisibleTourTarget) || null;
    } catch (_) {
        return null;
    }
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
    const completedTours = state?.completed_tours || [];
    const allToursComplete = getRenderableTours().every(tourId => completedTours.includes(tourId));

    const cards = getRenderableTours().map((tourId) => {
        const tour = TOUR_CONFIG[tourId];
        const done = isTourComplete(state, tourId);
        return `
            <button type="button" class="platform-learning-card ${done ? 'is-complete' : ''}" data-platform-tour="${tourId}" aria-label="${done ? 'Restart' : 'Start'} ${tour.label}">
                <span class="platform-learning-card-chip">${tour.chip}</span>
                ${done ? '<span class="platform-learning-complete-mark"><span aria-hidden="true">&#10003;</span> Completed</span>' : ''}
                ${renderCardVisual(tourId)}
                <span class="platform-learning-card-copy">
                    <span class="platform-learning-card-title">${tour.label}</span>
                    <span class="platform-learning-card-desc">${tour.description}</span>
                </span>
                <span class="platform-learning-card-footer">
                    <span>${done ? 'Review guide' : 'Start guide'}</span>
                    <span class="platform-learning-card-arrow">${renderArrowIcon()}</span>
                </span>
            </button>
        `;
    }).join('');

    container.classList.remove('hidden');
    container.innerHTML = `
        <section class="platform-learning-section" aria-labelledby="platform-learning-title">
            <div class="platform-learning-header">
                <div>
                    <div class="platform-learning-title-row">
                        <h2 id="platform-learning-title">Quick ways to get started</h2>
                        <div class="platform-learning-scroll-controls" aria-label="Scroll learning cards">
                            <button type="button" data-platform-learning-scroll="prev" aria-label="Previous learning card">${renderChevronIcon('prev')}</button>
                            <button type="button" data-platform-learning-scroll="next" aria-label="Next learning card">${renderChevronIcon('next')}</button>
                        </div>
                    </div>
                    <p>Pick what you want to learn first. FluxyOS will guide you through the page step by step.</p>
                </div>
                <button type="button" class="platform-learning-dismiss ${allToursComplete ? 'is-complete' : ''}" data-platform-learning-dismiss>
                    ${allToursComplete ? '<span aria-hidden="true">&#10003;</span> Completed' : 'Dismiss'}
                </button>
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

    const row = container.querySelector('.platform-learning-row');
    container.querySelectorAll('[data-platform-learning-scroll]').forEach(button => {
        button.addEventListener('click', () => {
            const direction = button.dataset.platformLearningScroll === 'prev' ? -1 : 1;
            const cardWidth = row?.querySelector('.platform-learning-card')?.getBoundingClientRect().width || 360;
            row?.scrollBy({ left: direction * (cardWidth + 22), behavior: 'smooth' });
        });
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
        .map(step => ({ ...step, target: findTourTarget(step.selector) }))
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
    activeTour = { userId, tourId, steps, index: 0, direction: 'forward' };

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
    window.addEventListener('resize', syncTourPosition);
    window.addEventListener('scroll', syncTourPosition, true);
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
    const direction = activeTour.direction || 'forward';

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
            activeTour.direction = 'back';
            renderCurrentStep();
        }
    });
    popover.querySelector('[data-tour-next]')?.addEventListener('click', () => {
        if (activeTour.index >= activeTour.steps.length - 1) finishTour('completed');
        else {
            activeTour.index += 1;
            activeTour.direction = 'forward';
            renderCurrentStep();
        }
    });

    popover.classList.remove('is-step-forward', 'is-step-back');
    void popover.offsetWidth;
    popover.classList.add(direction === 'back' ? 'is-step-back' : 'is-step-forward');

    window.requestAnimationFrame(syncTourPosition);
    window.setTimeout(syncTourPosition, 180);
    popover.querySelector('[data-tour-next]')?.focus();
}

function syncTourPosition() {
    if (!activeTour) return;
    const target = activeTour.steps[activeTour.index]?.target;
    const popover = document.getElementById('fluxy-tour-popover');
    if (target && popover) positionPopover(target, popover);
}

function positionPopover(target, popover) {
    const rect = target.getBoundingClientRect();
    const spacing = 14;
    const edge = 14;
    const width = Math.min(380, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    const popoverHeight = popover.offsetHeight || 220;

    const centeredLeft = rect.left + (rect.width / 2) - (width / 2);
    const belowTop = rect.bottom + spacing;
    const aboveTop = rect.top - popoverHeight - spacing;
    const rightLeft = rect.right + spacing;
    const leftLeft = rect.left - width - spacing;
    const canFitBelow = belowTop + popoverHeight <= window.innerHeight - edge;
    const canFitAbove = aboveTop >= edge;
    const canFitRight = rightLeft + width <= window.innerWidth - edge;
    const canFitLeft = leftLeft >= edge;

    let top;
    let left;
    let placement = 'bottom';

    if (canFitBelow || (!canFitAbove && rect.bottom < window.innerHeight * 0.68)) {
        top = belowTop;
        left = centeredLeft;
        placement = 'bottom';
    } else if (canFitAbove) {
        top = aboveTop;
        left = centeredLeft;
        placement = 'top';
    } else if (canFitRight) {
        top = rect.top + (rect.height / 2) - (popoverHeight / 2);
        left = rightLeft;
        placement = 'right';
    } else if (canFitLeft) {
        top = rect.top + (rect.height / 2) - (popoverHeight / 2);
        left = leftLeft;
        placement = 'left';
    } else {
        top = Math.min(
            Math.max(rect.top + Math.min(28, Math.max(0, rect.height - popoverHeight) / 2), edge),
            window.innerHeight - popoverHeight - edge
        );
        left = Math.min(Math.max(centeredLeft, edge), window.innerWidth - width - edge);
        placement = 'center';
    }

    const maxLeft = Math.max(edge, window.innerWidth - width - edge);
    const maxTop = Math.max(edge, window.innerHeight - popoverHeight - edge);
    left = Math.min(Math.max(left, edge), maxLeft);
    top = Math.min(Math.max(top, edge), maxTop);
    popover.dataset.placement = placement;
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

    if (normalizePath() !== '/dashboard') {
        sessionStorage.setItem(LEARNING_FOCUS_KEY, '1');
        window.location.href = '/dashboard';
        return;
    }
    await refreshLearningSection(userId);
    if (!promoteLearningSection(userId, { auto: false })) focusLearningSection();
}

function closeActiveTour(restoreFocus = true) {
    document.removeEventListener('keydown', handleTourKeydown);
    window.removeEventListener('resize', syncTourPosition);
    window.removeEventListener('scroll', syncTourPosition, true);
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

async function refreshLearningSection(userId) {
    const quickStart = document.getElementById('quick-start-container');
    if (quickStart) await renderQuickStartLearning('quick-start-container', { userId });
}

export function focusLearningSection() {
    const container = document.getElementById('quick-start-container');
    if (!container || container.classList.contains('hidden')) return;
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const next = container.querySelector('.platform-learning-card:not(.is-complete)');
    if (!next) return;
    next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    next.classList.add('is-next-focus');
    window.setTimeout(() => next.classList.remove('is-next-focus'), 2600);
}

let activePromoter = null;

// Linear coachmark over the "Quick ways to get started" cards: a blurred
// backdrop spotlights one card at a time (Next/Back/Skip), starting at the
// first incomplete card. Clicking the spotlighted card launches its guide.
// `auto` is the passive first-load trigger (once per session); the
// tour-completion flow calls it with auto:false so it re-appears at the next
// guide after each finished coachmark. Skip suppresses it for the session.
// Returns true when shown.
export function promoteLearningSection(userId, { auto = false } = {}) {
    if (sessionStorage.getItem(PROMOTER_SKIP_KEY)) return false;
    if (auto && sessionStorage.getItem(PROMOTER_SHOWN_KEY)) return false;
    if (activeTour) return false;
    const container = document.getElementById('quick-start-container');
    if (!container || container.classList.contains('hidden')) return false;
    const cards = Array.from(container.querySelectorAll('.platform-learning-card'));
    if (!cards.length) return false;
    const firstIncomplete = cards.findIndex(card => !card.classList.contains('is-complete'));
    if (firstIncomplete === -1) return false;

    sessionStorage.setItem(PROMOTER_SHOWN_KEY, '1');
    closeLearningPromoter();

    const overlay = document.createElement('div');
    overlay.id = 'fluxy-learn-promoter-overlay';
    overlay.className = 'fluxy-tour-overlay fluxy-learn-promoter-overlay';

    const popover = document.createElement('div');
    popover.id = 'fluxy-learn-promoter-popover';
    popover.className = 'fluxy-tour-popover fluxy-learn-promoter-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.setAttribute('aria-live', 'polite');

    document.body.append(overlay, popover);
    overlay.addEventListener('click', () => closeLearningPromoter(false));
    document.addEventListener('keydown', handlePromoterKeydown);
    window.addEventListener('resize', positionPromoter);
    window.addEventListener('scroll', positionPromoter, true);

    activePromoter = { userId, cards, index: firstIncomplete, onCardClick: null };
    renderPromoterStep();
    return true;
}

function renderPromoterStep() {
    if (!activePromoter) return;
    const { cards, index } = activePromoter;
    const card = cards[index];
    const popover = document.getElementById('fluxy-learn-promoter-popover');
    if (!card || !popover) return;

    cards.forEach(c => c.classList.remove('fluxy-tour-highlight'));
    if (activePromoter.onCardClick) {
        cards.forEach(c => c.removeEventListener('click', activePromoter.onCardClick));
    }
    card.classList.add('fluxy-tour-highlight');
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

    const tour = TOUR_CONFIG[card.dataset.platformTour] || {};
    const done = card.classList.contains('is-complete');

    // No forward "Next": the user advances by actually doing the spotlighted
    // guide (the coachmark re-opens at the next one when it finishes). They can
    // only go Back to a previous card, Skip, or click the card to start it.
    popover.innerHTML = `
        <button type="button" class="fluxy-tour-skip" data-promoter-skip>Skip</button>
        <span class="fluxy-learn-promoter-eyebrow">Getting started · ${index + 1}/${cards.length}</span>
        <h3>${tour.label || 'Quick start guide'}</h3>
        <p>${tour.description || ''}</p>
        <p class="fluxy-learn-promoter-hint">${done ? 'You already finished this guide — click it to review.' : 'Click the highlighted card to start this guide.'}</p>
        ${index > 0 ? `<div class="fluxy-tour-actions"><button type="button" class="fluxy-tour-secondary" data-promoter-back>Back</button></div>` : ''}
    `;

    popover.querySelector('[data-promoter-skip]')?.addEventListener('click', () => closeLearningPromoter(true));
    popover.querySelector('[data-promoter-back]')?.addEventListener('click', () => {
        if (activePromoter.index > 0) { activePromoter.index -= 1; renderPromoterStep(); }
    });

    // Only the spotlighted card sits above the backdrop, so a click here is a
    // click on the current guide — close the coachmark and let the card's own
    // handler launch the tour.
    activePromoter.onCardClick = () => closeLearningPromoter(false);
    card.addEventListener('click', activePromoter.onCardClick);

    window.requestAnimationFrame(positionPromoter);
    window.setTimeout(positionPromoter, 220);
    (popover.querySelector('[data-promoter-back]') || popover.querySelector('[data-promoter-skip]'))?.focus();
}

function positionPromoter() {
    if (!activePromoter) return;
    const popover = document.getElementById('fluxy-learn-promoter-popover');
    const card = activePromoter.cards[activePromoter.index];
    if (popover && card) positionPopover(card, popover);
}

function handlePromoterKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        closeLearningPromoter(false);
    }
}

function closeLearningPromoter(skip = false) {
    if (skip) sessionStorage.setItem(PROMOTER_SKIP_KEY, '1');
    document.removeEventListener('keydown', handlePromoterKeydown);
    window.removeEventListener('resize', positionPromoter);
    window.removeEventListener('scroll', positionPromoter, true);
    if (activePromoter) {
        if (activePromoter.onCardClick) {
            activePromoter.cards.forEach(c => c.removeEventListener('click', activePromoter.onCardClick));
        }
        activePromoter.cards.forEach(c => c.classList.remove('fluxy-tour-highlight'));
    }
    document.getElementById('fluxy-learn-promoter-overlay')?.remove();
    document.getElementById('fluxy-learn-promoter-popover')?.remove();
    activePromoter = null;
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
    getPlatformLearningState,
    focusLearningSection,
    promoteLearningSection
};
