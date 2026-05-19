// FluxyOS — Onboarding page logic
// 4-step setup, auth-gated, writes user-scoped Firestore docs only.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { isNewUserAfterCutoff, getOnboardingProgress } from "./onboarding-gate.js";

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
    { key: 'finance_setup',  shortTitle: 'Start using FluxyOS', context: 'First action', pillLabel: 'Finance setup' },
    { key: 'review',         shortTitle: 'Final check', context: 'Confirm details', pillLabel: 'Review' }
];

const state = {
    user: null,
    stepIndex: 0,
    completedSteps: [],
    fields: {
        business_name: '',
        role: 'Owner / Founder',
        main_goal: 'Track revenue and expenses',
        monthly_revenue_range: 'Under Rp 50.000.000',
        employee_count_range: '0 - 10 employees',
        legal_full_name: '',
        phone_number: '',
        id_doc_name: '',
        biz_doc_name: '',
        first_action: 'csv_upload'
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

    // Resume from saved step if any
    if (progress?.current_step) {
        const resumeIdx = STEPS.findIndex(s => s.key === progress.current_step);
        if (resumeIdx > 0 && resumeIdx < STEPS.length) state.stepIndex = resumeIdx;
    }

    initUI();
});

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
    bindInput('#f-legal-name', 'legal_full_name');
    bindInput('#f-phone', 'phone_number');

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

    document.querySelectorAll('input[name="first_action"]').forEach((el) => {
        el.addEventListener('change', () => {
            const selected = document.querySelector('input[name="first_action"]:checked');
            state.fields.first_action = selected?.value || 'csv_upload';
        });
    });
}

function bindInput(selector, fieldKey) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (state.fields[fieldKey] !== undefined && state.fields[fieldKey] !== '') el.value = state.fields[fieldKey];
    el.addEventListener('input', () => {
        state.fields[fieldKey] = el.value;
        el.classList.remove('is-invalid');
    });
    el.addEventListener('change', () => {
        state.fields[fieldKey] = el.value;
    });
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
function showStep() {
    document.querySelectorAll('.onboarding-step').forEach((el) => { el.hidden = true; });
    const step = STEPS[state.stepIndex];
    const stepEl = document.querySelector(`.onboarding-step[data-step="${step.key}"]`);
    if (stepEl) stepEl.hidden = false;

    document.getElementById('step-pill-text').textContent =
        `Step ${state.stepIndex + 1} of ${STEPS.length} · ${step.pillLabel}`;

    document.getElementById('btn-back').hidden = state.stepIndex === 0;
    const isReview = state.stepIndex === STEPS.length - 1;
    document.getElementById('btn-continue').hidden = isReview;
    document.getElementById('btn-submit').hidden = !isReview;

    if (isReview) renderReview();
    renderRail();
}

// ---------- Validation ----------
function validateStep() {
    const step = STEPS[state.stepIndex].key;
    clearInvalidMarkers();

    if (step === 'business_setup') {
        const required = [
            ['#f-business-name', state.fields.business_name?.trim()],
            ['#f-role', state.fields.role],
            ['#f-main-goal', state.fields.main_goal],
            ['#f-revenue', state.fields.monthly_revenue_range],
            ['#f-employees', state.fields.employee_count_range]
        ];
        return validateRequired(required);
    }

    if (step === 'account_owner') {
        const required = [
            ['#f-legal-name', state.fields.legal_full_name?.trim()],
            ['#f-phone', state.fields.phone_number?.trim()]
        ];
        return validateRequired(required);
    }

    if (step === 'finance_setup') {
        return ['csv_upload', 'add_transaction', 'add_bill', 'sample_data'].includes(state.fields.first_action);
    }

    return true;
}

function validateRequired(pairs) {
    let valid = true;
    pairs.forEach(([sel, val]) => {
        if (!val) {
            valid = false;
            const el = document.querySelector(sel);
            if (el) el.classList.add('is-invalid');
        }
    });
    return valid;
}

function clearInvalidMarkers() {
    document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
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
        } else if (stepKey === 'account_owner') {
            await data.saveOnboardingProfile(state.user.uid, {
                legal_full_name: state.fields.legal_full_name,
                phone_number: state.fields.phone_number
            });
            await data.saveOnboardingDocuments(state.user.uid, {
                identity_document_status: 'not_uploaded',
                business_document_status: 'not_uploaded'
            });
        } else if (stepKey === 'finance_setup') {
            await data.saveOnboardingProgress(state.user.uid, {
                selected_first_action: state.fields.first_action,
                current_step: STEPS[state.stepIndex + 1]?.key || 'review'
            });
        }
    } catch (err) {
        // Generic feedback — never expose Firebase error strings
        alert('Could not save your progress. Please try again.');
        return;
    }

    state.completedSteps.push(stepKey);
    state.stepIndex = Math.min(state.stepIndex + 1, STEPS.length - 1);

    await data.saveOnboardingProgress(state.user.uid, {
        current_step: STEPS[state.stepIndex].key,
        completed_steps: state.completedSteps,
        eligible_for_onboarding_gate: true
    }).catch(() => {});

    showStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onBack() {
    if (state.stepIndex === 0) return;
    state.stepIndex -= 1;
    showStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    state.submitting = true;
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        await data.saveOnboardingProfile(state.user.uid, {
            business_name: state.fields.business_name,
            role: state.fields.role,
            main_goal: state.fields.main_goal,
            monthly_revenue_range: state.fields.monthly_revenue_range,
            employee_count_range: state.fields.employee_count_range,
            legal_full_name: state.fields.legal_full_name,
            phone_number: state.fields.phone_number
        });
        await data.saveOnboardingDocuments(state.user.uid, {
            identity_document_status: 'not_uploaded',
            business_document_status: 'not_uploaded'
        });
        await data.completeOnboarding(state.user.uid, {
            selected_first_action: state.fields.first_action
        });
    } catch (err) {
        state.submitting = false;
        btn.disabled = false;
        btn.textContent = 'Submit setup';
        alert('Could not complete setup. Please try again.');
        return;
    }

    routeAfterSubmit(state.fields.first_action);
}

function routeAfterSubmit(firstAction) {
    const map = {
        csv_upload:     '/ledger?openCsv=1',
        add_transaction:'/ledger?openAddTx=1',
        add_bill:       '/bill?openAddBill=1',
        sample_data:    '/dashboard'
    };
    window.location.href = map[firstAction] || '/dashboard';
}

// ---------- Review ----------
function renderReview() {
    const f = state.fields;
    const actionLabels = {
        csv_upload: 'Upload CSV',
        add_transaction: 'Add transaction',
        add_bill: 'Add first bill',
        sample_data: 'Explore sample data'
    };
    const rows = [
        ['Business profile', `${f.business_name || '—'} · ${f.role}`],
        ['Business size', `${f.monthly_revenue_range} · ${f.employee_count_range}`],
        ['Account owner', `${f.legal_full_name || '—'} · ${f.phone_number || '—'}`],
        ['Optional documents', [
            f.id_doc_name ? `Identity: ${f.id_doc_name}` : 'Identity: not added',
            f.biz_doc_name ? `Business: ${f.biz_doc_name}` : 'Business: not added'
        ].join(' · ')],
        ['First finance action', actionLabels[f.first_action] || '—']
    ];
    const list = document.getElementById('review-list');
    list.innerHTML = rows.map(([k, v]) =>
        `<div class="onboarding-review-row"><dt class="onboarding-review-key">${k}</dt><dd class="onboarding-review-val">${escapeHtml(v)}</dd></div>`
    ).join('');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
