// FluxyOS — Onboarding page logic
// 4-step setup, auth-gated, writes user-scoped Firestore docs only.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { getOnboardingProgress } from "./onboarding-gate.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
const auth = getAuth(app);
const data = new DataService(app);

const STEPS = [
    { key: 'business_setup', shortTitle: 'Basic setup', context: 'Business setup', pillLabel: 'Business setup' },
    { key: 'account_owner',  shortTitle: 'Account owner', context: 'Account owner', pillLabel: 'Account owner' },
    { key: 'finance_setup',  shortTitle: 'Setup focus', context: 'Learning focus', pillLabel: 'Finance setup' },
    { key: 'review',         shortTitle: 'Final check', context: 'Confirm details', pillLabel: 'Review' }
];

const COUNTRY_CODES = ['+62', '+65', '+60', '+1', '+44', '+61'];

const ONBOARDING_PREFERENCES = [
    { value: 'csv_upload', label: 'Upload CSV', tourId: 'ledger' },
    { value: 'add_transaction', label: 'Add transactions manually', tourId: 'ledger' },
    { value: 'add_bill', label: 'Track upcoming bills', tourId: 'bills' },
    { value: 'dashboard_overview', label: 'Understand my dashboard', tourId: 'overview' },
    { value: 'revenue_review', label: 'Review revenue performance', tourId: 'revenue_sync' },
    { value: 'subscriptions', label: 'Track subscriptions', tourId: 'subscriptions' },
    { value: 'fluxy_ai', label: 'Ask Fluxy AI questions', tourId: 'fluxy_ai' }
];

const state = {
    user: null,
    stepIndex: 0,
    completedSteps: [],
    fields: {
        business_name: '',
        role: '',
        main_goal: '',
        monthly_revenue_range: '',
        employee_count_range: '',
        legal_full_name: '',
        phone_country_code: '+62',
        phone_local_number: '',
        phone_number: '',
        id_doc_name: '',
        biz_doc_name: '',
        first_actions: [],
        selected_learning_tours: [],
        primary_learning_tour: null
    },
    submitting: false
};

// ---------- Auth guard ----------
let authTimeout = setTimeout(() => {
    window.location.replace('/login');
}, 2000);

onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    state.user = user;

    // If user is legacy or already completed, send them to the dashboard.
    const progress = await getOnboardingProgress(user.uid);
    if (progress?.onboarding_completed === true || progress?.onboarding_exempt === true) {
        window.location.replace('/dashboard');
        return;
    }

    await hydrateSavedState(user.uid, progress);

    // Resume from saved step if any
    if (progress?.current_step) {
        const resumeIdx = STEPS.findIndex(s => s.key === progress.current_step);
        if (resumeIdx > 0 && resumeIdx < STEPS.length) state.stepIndex = resumeIdx;
    }

    initUI();
});

async function hydrateSavedState(userId, progress) {
    try {
        const [profile, documents] = await Promise.all([
            data.getOnboardingProfile(userId).catch(() => null),
            data.getOnboardingDocuments(userId).catch(() => null)
        ]);
        if (profile) {
            Object.entries({
                business_name: profile.business_name,
                role: profile.role,
                main_goal: profile.main_goal,
                monthly_revenue_range: profile.monthly_revenue_range,
                employee_count_range: profile.employee_count_range,
                legal_full_name: profile.legal_full_name,
                phone_country_code: COUNTRY_CODES.includes(profile.phone_country_code) ? profile.phone_country_code : '+62',
                phone_number: profile.phone_number
            }).forEach(([key, value]) => {
                if (value !== undefined && value !== null) state.fields[key] = value;
            });
            if (state.fields.phone_number) {
                const withoutCode = state.fields.phone_number.startsWith(state.fields.phone_country_code)
                    ? state.fields.phone_number.slice(state.fields.phone_country_code.length)
                    : state.fields.phone_number.replace(/^\+/, '');
                state.fields.phone_local_number = withoutCode;
            }
        }
        if (documents?.identity_document_status === 'uploaded') state.fields.id_doc_name = 'Identity document added';
        if (documents?.business_document_status === 'uploaded') state.fields.biz_doc_name = 'Business document added';
        if (Array.isArray(progress?.selected_first_actions)) {
            state.fields.first_actions = progress.selected_first_actions.filter((value) =>
                ONBOARDING_PREFERENCES.some((item) => item.value === value)
            );
            updateLearningTourState();
        } else if (progress?.selected_first_action) {
            state.fields.first_actions = ONBOARDING_PREFERENCES.some((item) => item.value === progress.selected_first_action)
                ? [progress.selected_first_action]
                : [];
            updateLearningTourState();
        }
        if (Array.isArray(progress?.completed_steps)) state.completedSteps = progress.completed_steps;
    } catch (_) {
        // Resume should never block the setup page; the user can re-enter fields.
    }
}

// ---------- UI init ----------
function initUI() {
    renderRail();
    showStep();

    document.getElementById('btn-continue').addEventListener('click', onContinue);
    document.getElementById('btn-back').addEventListener('click', onBack);
    document.getElementById('btn-submit').addEventListener('click', onSubmit);
    document.getElementById('btn-save-later').addEventListener('click', onSaveLater);

    // Live-bind form fields
    bindInput('#f-business-name', 'business_name');
    bindInput('#f-role', 'role');
    bindInput('#f-main-goal', 'main_goal');
    bindInput('#f-revenue', 'monthly_revenue_range');
    bindInput('#f-employees', 'employee_count_range');
    bindLegalNameInput();
    bindPhoneInputs();
    syncFormFromState();

    document.getElementById('f-id-doc').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        state.fields.id_doc_name = file?.name || '';
        document.getElementById('f-id-doc-name').textContent = file?.name || 'Choose file';
    });
    document.getElementById('f-biz-doc').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        state.fields.biz_doc_name = file?.name || '';
        document.getElementById('f-biz-doc-name').textContent = file?.name || 'Choose file';
    });

    document.querySelectorAll('input[name="first_actions"]').forEach((el) => {
        el.addEventListener('change', () => {
            state.fields.first_actions = getSelectedFirstActions();
            updateLearningTourState();
            clearFieldError('#finance-actions', 'finance-actions-error');
        });
    });
}

function syncFormFromState() {
    const legal = document.querySelector('#f-legal-name');
    if (legal) legal.value = state.fields.legal_full_name || '';
    const country = document.querySelector('#f-phone-country');
    if (country) country.value = COUNTRY_CODES.includes(state.fields.phone_country_code) ? state.fields.phone_country_code : '+62';
    const phone = document.querySelector('#f-phone-local');
    if (phone) phone.value = state.fields.phone_local_number || '';
    document.querySelectorAll('input[name="first_actions"]').forEach((el) => {
        el.checked = state.fields.first_actions.includes(el.value);
    });
}

function bindInput(selector, fieldKey) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (state.fields[fieldKey] !== undefined && state.fields[fieldKey] !== '') el.value = state.fields[fieldKey];
    el.addEventListener('input', () => {
        state.fields[fieldKey] = el.value;
        clearFieldError(selector);
    });
    el.addEventListener('change', () => {
        state.fields[fieldKey] = el.value;
        clearFieldError(selector);
    });
}

function bindLegalNameInput() {
    const el = document.querySelector('#f-legal-name');
    if (!el) return;
    el.addEventListener('input', () => {
        const clean = el.value.replace(/[^A-Za-z\s]/g, '').replace(/\s{2,}/g, ' ');
        if (el.value !== clean) el.value = clean;
        state.fields.legal_full_name = clean;
        clearFieldError('#f-legal-name', 'f-legal-name-error');
    });
    el.addEventListener('paste', () => {
        window.setTimeout(() => {
            const clean = el.value.replace(/[^A-Za-z\s]/g, '').replace(/\s{2,}/g, ' ');
            if (el.value !== clean) el.value = clean;
            state.fields.legal_full_name = clean;
        }, 0);
    });
}

function bindPhoneInputs() {
    const country = document.querySelector('#f-phone-country');
    const local = document.querySelector('#f-phone-local');
    if (country) {
        country.value = state.fields.phone_country_code;
        country.addEventListener('change', () => {
            state.fields.phone_country_code = COUNTRY_CODES.includes(country.value) ? country.value : '+62';
            updateNormalizedPhone();
            clearFieldError('#f-phone-local', 'f-phone-error');
        });
    }
    if (local) {
        local.addEventListener('input', () => {
            const clean = local.value.replace(/[^\d\s-]/g, '');
            if (local.value !== clean) local.value = clean;
            state.fields.phone_local_number = clean;
            updateNormalizedPhone();
            clearFieldError('#f-phone-local', 'f-phone-error');
        });
    }
}

// ---------- Rail ----------
function renderRail() {
    const list = document.getElementById('rail-steps');
    list.innerHTML = '';
    STEPS.forEach((s, idx) => {
        const li = document.createElement('li');
        const isDone = idx < state.stepIndex;
        const isCurrent = idx === state.stepIndex;
        li.className = 'onboarding-rail-step ' + (isDone ? 'is-done' : isCurrent ? 'is-current' : 'is-upcoming');

        let title, sub;
        if (isCurrent) {
            title = 'Current step';
            sub = s.shortTitle;
        } else if (isDone) {
            title = 'Completed';
            sub = 'Done';
        } else if (idx === STEPS.length - 1) {
            title = 'Final check';
            sub = 'Confirm details';
        } else {
            title = 'Next';
            sub = 'Unlocks after this step';
        }

        li.innerHTML = `
            <span class="onboarding-rail-step-marker">${isDone ? '✓' : idx + 1}</span>
            <span class="onboarding-rail-step-label">
                <span class="onboarding-rail-step-title">${title}</span>
                <span class="onboarding-rail-step-sub">${sub}</span>
            </span>
        `;
        list.appendChild(li);
    });

    const currentStep = STEPS[state.stepIndex];
    document.getElementById('rail-context').textContent = `Step ${state.stepIndex + 1} · ${currentStep.shortTitle}`;
}

// ---------- Step display ----------
function showStep(direction = 'forward') {
    document.querySelectorAll('.onboarding-step').forEach((el) => { el.hidden = true; });
    const step = STEPS[state.stepIndex];
    const stepEl = document.querySelector(`.onboarding-step[data-step="${step.key}"]`);
    if (stepEl) {
        stepEl.hidden = false;
        // Contained slide + fade animation inside the right card.
        // Forward = next step rises from below; backward = previous step
        // settles in from above. Respect reduced-motion preference.
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced && stepEl.animate) {
            const fromY = direction === 'backward' ? -28 : 28;
            stepEl.animate(
                [
                    { opacity: 0, transform: `translateY(${fromY}px)` },
                    { opacity: 1, transform: 'translateY(0)' }
                ],
                { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
            );
        }
    }

    document.getElementById('btn-back').hidden = state.stepIndex === 0;
    const isReview = state.stepIndex === STEPS.length - 1;
    document.getElementById('btn-continue').hidden = isReview;
    document.getElementById('btn-submit').hidden = !isReview;

    if (isReview) renderReview();
    renderRail();
}

// ---------- Validation ----------
function getSelectedFirstActions() {
    return Array.from(document.querySelectorAll('input[name="first_actions"]:checked'))
        .map((el) => el.value)
        .filter((value) => ONBOARDING_PREFERENCES.some((item) => item.value === value));
}

function getLearningToursForActions(actions = state.fields.first_actions) {
    const tours = [];
    actions.forEach((action) => {
        const tourId = ONBOARDING_PREFERENCES.find((item) => item.value === action)?.tourId;
        if (tourId && !tours.includes(tourId)) tours.push(tourId);
    });
    return tours;
}

function updateLearningTourState() {
    state.fields.selected_learning_tours = getLearningToursForActions();
    state.fields.primary_learning_tour = state.fields.selected_learning_tours[0] || null;
}

function normalizePhoneNumber(countryCode, localNumber) {
    const code = COUNTRY_CODES.includes(countryCode) ? countryCode : '+62';
    const localDigits = String(localNumber || '').replace(/\D/g, '').replace(/^0+/, '');
    return localDigits ? `${code}${localDigits}` : '';
}

function updateNormalizedPhone() {
    state.fields.phone_number = normalizePhoneNumber(
        state.fields.phone_country_code,
        state.fields.phone_local_number
    );
}

function validateStep() {
    const step = STEPS[state.stepIndex].key;
    clearInvalidMarkers();

    if (step === 'business_setup') {
        const required = [
            ['#f-business-name', state.fields.business_name?.trim(), 'f-business-name-error'],
            ['#f-role', state.fields.role, 'f-role-error'],
            ['#f-main-goal', state.fields.main_goal, 'f-main-goal-error'],
            ['#f-revenue', state.fields.monthly_revenue_range, 'f-revenue-error'],
            ['#f-employees', state.fields.employee_count_range, 'f-employees-error']
        ];
        return validateRequired(required);
    }

    if (step === 'account_owner') {
        let valid = true;
        const fullName = state.fields.legal_full_name?.trim() || '';
        if (fullName.length < 4 || !/^[A-Za-z\s]+$/.test(fullName)) {
            valid = false;
            setFieldError('#f-legal-name', 'f-legal-name-error', 'Use letters only, minimum 4 characters.');
        }
        updateNormalizedPhone();
        const localDigits = String(state.fields.phone_local_number || '').replace(/\D/g, '').replace(/^0+/, '');
        if (!COUNTRY_CODES.includes(state.fields.phone_country_code) || !localDigits) {
            valid = false;
            setFieldError('#f-phone-local', 'f-phone-error', 'Enter a WhatsApp number after the country code.');
        }
        return valid;
    }

    if (step === 'finance_setup') {
        state.fields.first_actions = getSelectedFirstActions();
        updateLearningTourState();
        if (!state.fields.first_actions.length) {
            setFieldError('#finance-actions', 'finance-actions-error', 'Pick at least one setup focus.');
            return false;
        }
        return true;
    }

    return true;
}

function validateRequired(pairs) {
    let valid = true;
    pairs.forEach(([sel, val, errorId]) => {
        if (!val) {
            valid = false;
            setFieldError(sel, errorId);
        }
    });
    return valid;
}

function clearInvalidMarkers() {
    document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    document.querySelectorAll('.onboarding-error').forEach((el) => { el.textContent = ''; });
}

function setFieldError(selector, errorId, message = 'This field is required.') {
    const el = document.querySelector(selector);
    if (el) el.classList.add('is-invalid');
    const resolvedErrorId = errorId || el?.getAttribute('aria-describedby');
    if (resolvedErrorId) {
        const error = document.getElementById(resolvedErrorId);
        if (error) error.textContent = message;
    }
}

function clearFieldError(selector, errorId) {
    const el = document.querySelector(selector);
    if (el) el.classList.remove('is-invalid');
    const resolvedErrorId = errorId || el?.getAttribute('aria-describedby');
    if (resolvedErrorId) {
        const error = document.getElementById(resolvedErrorId);
        if (error) error.textContent = '';
    }
}

// ---------- Step transitions ----------
async function onContinue() {
    if (!validateStep()) return;
    const stepKey = STEPS[state.stepIndex].key;

    try {
        if (stepKey === 'business_setup') {
            await data.saveOnboardingProfile(state.user.uid, {
                business_name: state.fields.business_name,
                role: state.fields.role,
                main_goal: state.fields.main_goal,
                monthly_revenue_range: state.fields.monthly_revenue_range,
                employee_count_range: state.fields.employee_count_range
            });
            // Mirror business_name to settings/company as soon as it's
            // entered so the dashboard sidebar resolves to the right name
            // the moment the user lands there — no waiting on the final
            // submit. Surfaces errors loudly via console.
            try {
                await data.saveCompanySettings(state.user.uid, {
                    business_name: state.fields.business_name
                });
            } catch (e) {
                console.warn('[onboarding] step1 settings/company mirror failed', e);
            }
        } else if (stepKey === 'account_owner') {
            updateNormalizedPhone();
            await data.saveOnboardingProfile(state.user.uid, {
                legal_full_name: state.fields.legal_full_name,
                phone_country_code: state.fields.phone_country_code,
                phone_number: state.fields.phone_number
            });
            await data.saveOnboardingDocuments(state.user.uid, {
                identity_document_status: 'not_uploaded',
                business_document_status: 'not_uploaded'
            });
        } else if (stepKey === 'finance_setup') {
            state.fields.first_actions = getSelectedFirstActions();
            updateLearningTourState();
            await data.saveOnboardingProgress(state.user.uid, {
                selected_first_action: state.fields.first_actions[0] || null,
                selected_first_actions: state.fields.first_actions,
                selected_learning_tours: state.fields.selected_learning_tours,
                primary_learning_tour: state.fields.primary_learning_tour,
                current_step: STEPS[state.stepIndex + 1]?.key || 'review'
            });
        }
    } catch (err) {
        // Generic feedback — never expose Firebase error strings
        await (window.showAlertDialog?.({
            title: 'Could not save your progress',
            body: 'Something went wrong while saving this step. Check your connection and try again — your previous answers are still here.',
            confirmLabel: 'OK'
        }) ?? Promise.resolve());
        return;
    }

    state.completedSteps.push(stepKey);
    state.stepIndex = Math.min(state.stepIndex + 1, STEPS.length - 1);

    await data.saveOnboardingProgress(state.user.uid, {
        current_step: STEPS[state.stepIndex].key,
        completed_steps: state.completedSteps,
        eligible_for_onboarding_gate: true
    }).catch(() => {});

    showStep('forward');
}

function onBack() {
    if (state.stepIndex === 0) return;
    state.stepIndex -= 1;
    showStep('backward');
}

async function onSaveLater() {
    try {
        await data.skipOnboarding(state.user.uid, STEPS[state.stepIndex].key);
    } catch (err) {
        // proceed anyway — dashboard will still render the gate based on fail-open behavior
    }
    window.location.href = '/dashboard';
}

async function onSubmit() {
    if (state.submitting) return;
    if (!validateAllBeforeSubmit()) return;
    state.submitting = true;
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    showSubmitLoader();

    try {
        updateNormalizedPhone();
        state.fields.first_actions = getSelectedFirstActions();
        updateLearningTourState();
        await data.saveOnboardingProfile(state.user.uid, {
            business_name: state.fields.business_name,
            role: state.fields.role,
            main_goal: state.fields.main_goal,
            monthly_revenue_range: state.fields.monthly_revenue_range,
            employee_count_range: state.fields.employee_count_range,
            legal_full_name: state.fields.legal_full_name,
            phone_country_code: state.fields.phone_country_code,
            phone_number: state.fields.phone_number
        });
        await data.saveOnboardingDocuments(state.user.uid, {
            identity_document_status: 'not_uploaded',
            business_document_status: 'not_uploaded'
        });
        // Mirror the business name into the canonical settings/company doc so
        // the sidebar entity switcher and Settings → Business stay in sync.
        // Treated as critical now — without it the dashboard's first read of
        // settings/company falls back to onboarding/profile, which works but
        // means edits made from Settings later may diverge.
        try {
            await data.saveCompanySettings(state.user.uid, {
                business_name: state.fields.business_name
            });
            console.log('[onboarding] settings/company mirrored', { business_name: state.fields.business_name });
        } catch (e) {
            console.warn('[onboarding] settings/company mirror failed', e);
        }
        await data.completeOnboarding(state.user.uid, {
            selected_first_action: state.fields.first_actions[0] || null,
            selected_first_actions: state.fields.first_actions,
            selected_learning_tours: state.fields.selected_learning_tours,
            primary_learning_tour: state.fields.primary_learning_tour
        });
    } catch (err) {
        state.submitting = false;
        btn.disabled = false;
        btn.textContent = 'Submit setup';
        hideSubmitLoader();
        await (window.showAlertDialog?.({
            title: 'Could not complete setup',
            body: 'Something went wrong while creating your workspace. Check your connection and try again — your answers are still here.',
            confirmLabel: 'OK',
            tone: 'danger'
        }) ?? Promise.resolve());
        return;
    }

    routeAfterSubmit();
}

function validateAllBeforeSubmit() {
    const reviewIndex = STEPS.findIndex((step) => step.key === 'review');
    for (let idx = 0; idx < reviewIndex; idx += 1) {
        state.stepIndex = idx;
        showStep(idx === 0 ? 'backward' : 'forward');
        if (!validateStep()) return false;
    }
    state.stepIndex = reviewIndex;
    showStep('forward');
    return true;
}

function showSubmitLoader() {
    if (document.getElementById('onboarding-submit-loader')) return;
    const host = document.querySelector('.onboarding-content');
    if (!host) return;
    const overlay = document.createElement('div');
    overlay.id = 'onboarding-submit-loader';
    overlay.className = 'onboarding-submit-loader';
    overlay.innerHTML = `
        <div class="onboarding-submit-loader-card">
            <div class="absolute -inset-12 scan-loader-bg-purple opacity-25 blur-2xl"></div>
            <div class="absolute inset-0" style="background: radial-gradient(ellipse at center, rgba(255,255,255,0) 30%, rgba(255,255,255,0.92) 78%);"></div>
            <span class="scan-star scan-star-lg" style="top:14%; left:12%; animation-delay: 0s;"></span>
            <span class="scan-star" style="top:22%; right:14%; animation-delay: 0.7s;"></span>
            <span class="scan-star scan-star-sm" style="top:8%; left:46%; animation-delay: 1.1s;"></span>
            <span class="scan-star scan-star-sm" style="top:46%; left:6%; animation-delay: 1.6s;"></span>
            <span class="scan-star" style="bottom:24%; right:10%; animation-delay: 0.4s;"></span>
            <span class="scan-star scan-star-sm" style="bottom:14%; left:24%; animation-delay: 1.3s;"></span>
            <span class="scan-star scan-star-lg" style="bottom:10%; right:30%; animation-delay: 0.2s;"></span>
            <span class="scan-star scan-star-sm" style="top:52%; right:7%; animation-delay: 0.9s;"></span>
            <span class="scan-star scan-star-sm" style="bottom:6%; left:50%; animation-delay: 1.8s;"></span>
            <div class="onboarding-submit-loader-inner">
                <div class="onboarding-submit-loader-halo">
                    <div class="absolute inset-0 rounded-full scan-loader-halo-purple opacity-70 blur-2xl"></div>
                    <div class="absolute inset-3 rounded-full scan-loader-halo-purple opacity-55 blur-md"></div>
                    <div class="relative scan-loader-pulse">
                        <div class="onboarding-submit-loader-tile">
                            <img src="assets/images/favicon.svg" alt="" class="onboarding-submit-loader-mark scan-loader-spin" aria-hidden="true">
                        </div>
                    </div>
                </div>
                <p class="onboarding-submit-loader-title">Setting up your workspace…</p>
                <p class="onboarding-submit-loader-sub">This usually takes a few seconds.</p>
            </div>
        </div>
    `;
    host.appendChild(overlay);
}

function hideSubmitLoader() {
    const overlay = document.getElementById('onboarding-submit-loader');
    if (overlay) overlay.remove();
}

function routeAfterSubmit() {
    // Guarantee the onboarding coachmark shows the first time this just-onboarded
    // user reaches the overview. Honored + cleared by dashboard.html.
    sessionStorage.setItem('fluxy_learning_promote_force', '1');
    if (state.fields.primary_learning_tour) {
        sessionStorage.setItem('fluxy_pending_tour', state.fields.primary_learning_tour);
    } else {
        sessionStorage.removeItem('fluxy_pending_tour');
    }
    if (state.fields.selected_learning_tours.length) {
        sessionStorage.setItem('fluxy_pending_tours', JSON.stringify(state.fields.selected_learning_tours));
    } else {
        sessionStorage.removeItem('fluxy_pending_tours');
    }
    window.location.href = '/dashboard';
}

// ---------- Review ----------
function renderReview() {
    const f = state.fields;
    const preferenceLabels = f.first_actions
        .map((value) => ONBOARDING_PREFERENCES.find((item) => item.value === value)?.label)
        .filter(Boolean);
    const preferenceHtml = preferenceLabels.length
        ? `<span class="onboarding-chip-list">${preferenceLabels.map((label) => `<span class="onboarding-chip">${escapeHtml(label)}</span>`).join('')}</span>`
        : '—';
    const documentsHtml = [
        f.id_doc_name ? `Identity: ${f.id_doc_name}` : 'Identity: not added',
        f.biz_doc_name ? `Business: ${f.biz_doc_name}` : 'Business: not added'
    ].map((label) => `<span class="onboarding-chip">${escapeHtml(label)}</span>`).join('');
    const rows = [
        ['Business details', `${f.business_name || '—'} · ${f.role || '—'}`, false],
        ['Business size', `${f.monthly_revenue_range || '—'} · ${f.employee_count_range || '—'}`, false],
        ['Account owner', f.legal_full_name || '—', false],
        ['Preferred WhatsApp number', f.phone_number || '—', false],
        ['Selected setup focus', preferenceHtml, true],
        ['Document upload statuses', `<span class="onboarding-chip-list">${documentsHtml}</span>`, true]
    ];
    const list = document.getElementById('review-list');
    list.innerHTML = rows.map(([k, v, isHtml]) =>
        `<div class="onboarding-review-row"><dt class="onboarding-review-key">${k}</dt><dd class="onboarding-review-val">${isHtml ? v : escapeHtml(v)}</dd></div>`
    ).join('');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
