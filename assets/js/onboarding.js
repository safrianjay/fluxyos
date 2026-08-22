// FluxyOS — Onboarding page logic
// 4-step setup, auth-gated, writes user-scoped Firestore docs only.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { getOnboardingProgress } from "./onboarding-gate.js";
import { isKycEnforcedUser, resolveKycState, renderKycScreenInto } from "./kyc-gate.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

// Workspace mode is normally switched on by sidebar-loader.js, which this page
// does not load (no sidebar). Without it DataService._scope() resolves to
// users/{uid}, and the user-scoped audit_logs rules were REMOVED on 2026-08-16
// when those collections moved to workspaces/ — so the onboarding.submit audit
// write was denied and took the whole submit down with it. Set it here, before
// any DataService call. Safe: addAuditLog is the only _scope consumer in this
// flow, and onSubmit calls ensureWorkspace (creating the membership) first.
window.FLUXY_WORKSPACE_MODE = true;

const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
const auth = getAuth(app);
const data = new DataService(app);

const STEPS = [
    // Language and region come FIRST: language governs every question after it,
    // and country + base currency are the only choices in this whole flow the
    // user cannot undo. Asking them up front means a mistake costs one dropdown
    // rather than a support ticket and a data migration.
    { key: 'workspace_locale', shortTitle: 'Language & region', context: 'Language and region', pillLabel: 'Language & region' },
    { key: 'business_setup', shortTitle: 'Basic setup', context: 'Business setup', pillLabel: 'Business setup' },
    { key: 'account_owner',  shortTitle: 'Account owner', context: 'Account owner', pillLabel: 'Account owner' },
    { key: 'finance_setup',  shortTitle: 'Setup focus', context: 'Learning focus', pillLabel: 'Finance setup' },
    { key: 'review',         shortTitle: 'Final check', context: 'Confirm details', pillLabel: 'Review' }
];

// Dial codes offered for the WhatsApp number. The four supported business
// countries come first — a Philippine business could not enter its own number
// at all before +63 was added.
const COUNTRY_CODES = ['+62', '+63', '+65', '+60', '+1', '+44', '+61'];

// The business country's own dial code, used to preselect the phone prefix.
const COUNTRY_DIAL = { ID: '+62', PH: '+63', SG: '+65', MY: '+60' };

/*
 * Document hints per business country.
 *
 * "KTP" and "NIB" are Indonesian instruments — a Philippine owner has neither,
 * and being asked for them reads as "this product is not for you". Each market
 * gets the names its own registry actually uses; the generic fallback keeps a
 * new country legible before anyone writes copy for it.
 */
const DOC_HINTS_BY_COUNTRY = {
    ID: {
        identity: 'KTP, passport, or another government-issued ID. JPG, PNG, or PDF up to 5MB.',
        business: 'NIB, company registration, or other business proof. JPG, PNG, or PDF up to 5MB.'
    },
    PH: {
        identity: 'National ID (PhilID), passport, or another government-issued ID. JPG, PNG, or PDF up to 5MB.',
        business: 'DTI or SEC registration, BIR Certificate (2303), or other business proof. JPG, PNG, or PDF up to 5MB.'
    },
    SG: {
        identity: 'NRIC, FIN, passport, or another government-issued ID. JPG, PNG, or PDF up to 5MB.',
        business: 'ACRA business profile, UEN record, or other business proof. JPG, PNG, or PDF up to 5MB.'
    },
    MY: {
        identity: 'MyKad, passport, or another government-issued ID. JPG, PNG, or PDF up to 5MB.',
        business: 'SSM registration, business licence, or other business proof. JPG, PNG, or PDF up to 5MB.'
    }
};
const DOC_HINTS_FALLBACK = {
    identity: 'Passport or another government-issued ID. JPG, PNG, or PDF up to 5MB.',
    business: 'Company registration or other business proof. JPG, PNG, or PDF up to 5MB.'
};

function docHints() {
    return DOC_HINTS_BY_COUNTRY[state.fields.country] || DOC_HINTS_FALLBACK;
}

/*
 * Monthly-revenue bands, in WHOLE currency units, per base currency.
 *
 * These are round LOCAL numbers, deliberately NOT FX conversions of the
 * Indonesian bands. Converting Rp50.000.000 gives ₱174,600 — a band no business
 * owner recognises. The field exists for segmentation (it is stored as a display
 * string and read by the KYC reviewer, never used in a calculation), so local
 * legibility beats arithmetic equivalence.
 *
 * IDR must stay exactly 50/100/500/1000 million: those exact strings are already
 * stored on existing profiles and are dictionary keys in dashboard-i18n.js.
 */
const REVENUE_BANDS = {
    IDR: [50000000, 100000000, 500000000, 1000000000],
    PHP: [250000, 500000, 2500000, 5000000],
    SGD: [5000, 10000, 50000, 100000],
    MYR: [10000, 25000, 100000, 250000]
};

const ONBOARDING_PREFERENCES = [
    { value: 'csv_upload', label: 'Upload CSV', tourId: 'ledger' },
    { value: 'add_transaction', label: 'Add transactions manually', tourId: 'ledger' },
    { value: 'add_bill', label: 'Track upcoming bills', tourId: 'bills' },
    { value: 'dashboard_overview', label: 'Understand my dashboard', tourId: 'overview' },
    { value: 'revenue_review', label: 'Review revenue performance', tourId: 'revenue_sync' },
    { value: 'subscriptions', label: 'Track subscriptions', tourId: 'subscriptions' },
    { value: 'fluxy_ai', label: 'Ask Fluxy AI questions', tourId: 'fluxy_ai' }
];

let openCustomSelect = null;
let customSelectGlobalHandlersBound = false;

const state = {
    user: null,
    stepIndex: 0,
    // True once the user picks a base currency themselves, after which changing
    // the country stops overwriting it. See bindCountryCurrencyDefault().
    currencyTouched: false,
    // True once the profile actually carries country + base_currency, i.e. the
    // locale step has been completed at least once. Drives the resume pin below.
    localeConfirmed: false,
    completedSteps: [],
    fields: {
        business_name: '',
        // Device/UI language. Mirrored to the profile so the KYC reviewer knows
        // which language this business operates in; the live switch itself is
        // localStorage via FluxyI18n. Empty by default ON PURPOSE — bindLanguageSelect
        // seeds it from the language actually in effect, and a hardcoded 'id' here
        // would shadow that for a user already on English.
        language: '',
        // Immutable financial configuration once onboarding completes. Defaults
        // to the primary market; the user may change either before submitting.
        country: 'ID',
        base_currency: 'IDR',
        role: '',
        main_goal: '',
        monthly_revenue_range: '',
        employee_count_range: '',
        legal_full_name: '',
        phone_country_code: '+62',
        phone_local_number: '',
        phone_number: '',
        id_doc_name: '',
        id_doc_path: '',
        biz_doc_name: '',
        biz_doc_path: '',
        first_actions: [],
        selected_learning_tours: [],
        primary_learning_tour: null
    },
    submitting: false,
    resubmitting: false,
    uploading: { identity: false, business: false }
};

// ---------- Auth guard ----------
let authTimeout = setTimeout(() => {
    window.location.replace('/login');
}, 2000);

onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    state.user = user;

    // If user is legacy or exempt, send them to the dashboard.
    const progress = await getOnboardingProgress(user.uid);
    if (progress?.onboarding_exempt === true) {
        window.location.replace('/dashboard');
        return;
    }
    if (progress?.onboarding_completed === true) {
        // Already submitted. Bouncing an unverified user to /dashboard would just
        // land them on the same review screen, so show it here instead — except
        // for 'needs_revision', which needs the wizard itself to resubmit.
        const kyc = await resolveKycState(user);
        if (!kyc.blocked) {
            window.location.replace('/dashboard');
            return;
        }
        if (kyc.variant !== 'revision') {
            showKycReviewScreen(kyc);
            return;
        }
        state.resubmitting = true;
    }

    await hydrateSavedState(user.uid, progress);

    // Resume from saved step if any
    if (progress?.current_step) {
        const resumeIdx = STEPS.findIndex(s => s.key === progress.current_step);
        if (resumeIdx > 0 && resumeIdx < STEPS.length) state.stepIndex = resumeIdx;
    }

    // A user already mid-onboarding when the locale step shipped has
    // current_step 'business_setup', which now resolves to index 1 — they would
    // skip the locale step and their workspace would never receive a base
    // currency. Pin them to step 0 until the profile actually carries one.
    if (!state.localeConfirmed) state.stepIndex = 0;

    // Restore anything stashed across a language reload. Runs last so it wins
    // over the resume logic — the user was already on a step when they switched.
    restoreLocaleStash();

    initUI();
});

// Replace the whole setup shell — wizard card AND the step-progress rail — with
// the review screen. Mounting inside .onboarding-content would nest the review
// card inside the wizard card, and leave the rail claiming "Step 1 · Basic setup"
// next to a message saying setup is already submitted.
function showKycReviewScreen(kyc) {
    renderKycScreenInto(kyc, document.querySelector('.onboarding-shell'));
}

async function hydrateSavedState(userId, progress) {
    try {
        const [profile, documents] = await Promise.all([
            data.getOnboardingProfile(userId).catch(() => null),
            data.getOnboardingDocuments(userId).catch(() => null)
        ]);
        if (profile) {
            Object.entries({
                business_name: profile.business_name,
                language: profile.language,
                country: profile.country,
                base_currency: profile.base_currency,
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
            state.localeConfirmed = !!(profile.country && profile.base_currency);
            if (state.fields.phone_number) {
                const withoutCode = state.fields.phone_number.startsWith(state.fields.phone_country_code)
                    ? state.fields.phone_number.slice(state.fields.phone_country_code.length)
                    : state.fields.phone_number.replace(/^\+/, '');
                state.fields.phone_local_number = withoutCode;
            }
        }
        // Restore the real storage paths, not just a label — a user resuming
        // onboarding (or resubmitting after needs_revision) must not silently
        // lose an already-uploaded document and get blocked by the required check.
        if (documents?.identity_document_status === 'uploaded') {
            state.fields.id_doc_path = documents.identity_document_storage_path || '';
            state.fields.id_doc_name = documents.identity_document_file_name || 'Identity document added';
        }
        if (documents?.business_document_status === 'uploaded') {
            state.fields.biz_doc_path = documents.business_document_storage_path || '';
            state.fields.biz_doc_name = documents.business_document_file_name || 'Business document added';
        }
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
    document.getElementById('tos-agree-checkbox')?.addEventListener('change', () => {
        document.getElementById('tos-agree-label')?.classList.remove('is-invalid');
        const err = document.getElementById('tos-agree-error');
        if (err) err.textContent = '';
    });

    // Live-bind form fields
    bindInput('#f-business-name', 'business_name');
    bindLanguageSelect();
    bindInput('#f-country', 'country');
    bindInput('#f-base-currency', 'base_currency');
    bindCountryCurrencyDefault();
    bindInput('#f-role', 'role');
    bindInput('#f-main-goal', 'main_goal');
    bindInput('#f-revenue', 'monthly_revenue_range');
    bindInput('#f-employees', 'employee_count_range');
    bindLegalNameInput();
    bindPhoneInputs();
    [
        '#f-language-custom',
        '#f-country-custom',
        '#f-base-currency-custom',
        '#f-role-custom',
        '#f-main-goal-custom',
        '#f-revenue-custom',
        '#f-employees-custom',
        '#f-phone-country-custom'
    ].forEach((selector) => mountOnboardingCustomSelect(selector));
    bindCustomSelectGlobalHandlers();
    // Seed the seam from the hydrated state (a resumed session may already be on
    // PHP) BEFORE building the revenue bands, or they render in rupiah for one
    // paint and then change under the user.
    window.FluxyMoney.setBaseCurrency(state.fields.base_currency);
    renderRevenueOptions();
    applyCountryDependentCopy();
    syncFormFromState();

    document.getElementById('f-id-doc').addEventListener('change', (e) => {
        handleDocSelect('identity', e.target.files?.[0]);
    });
    document.getElementById('f-biz-doc').addEventListener('change', (e) => {
        handleDocSelect('business', e.target.files?.[0]);
    });

    document.querySelectorAll('input[name="first_actions"]').forEach((el) => {
        el.addEventListener('change', () => {
            state.fields.first_actions = getSelectedFirstActions();
            updateLearningTourState();
            clearFieldError('#finance-actions', 'finance-actions-error');
        });
    });
}

const DOC_UI = {
    identity: { nameEl: 'f-id-doc-name', hintEl: 'f-id-doc-hint', input: 'f-id-doc', nameField: 'id_doc_name', pathField: 'id_doc_path' },
    business: { nameEl: 'f-biz-doc-name', hintEl: 'f-biz-doc-hint', input: 'f-biz-doc', nameField: 'biz_doc_name', pathField: 'biz_doc_path' }
};

function setDocHint(docType, message, tone) {
    const hint = document.getElementById(DOC_UI[docType].hintEl);
    if (!hint) return;
    hint.textContent = message;
    hint.classList.toggle('is-error', tone === 'error');
    hint.classList.toggle('is-ok', tone === 'ok');
}

// Upload on select rather than at submit: a 5MB scan over a phone connection is
// slow, and a type/size rejection has to surface while the user is still looking
// at the field — not as a failed submit three steps later.
async function handleDocSelect(docType, file) {
    const cfg = DOC_UI[docType];
    const nameEl = document.getElementById(cfg.nameEl);
    if (!file) {
        state.fields[cfg.nameField] = '';
        state.fields[cfg.pathField] = '';
        if (nameEl) nameEl.textContent = 'Choose file';
        setDocHint(docType, DOC_DEFAULT_HINT[docType], null);
        return;
    }
    if (nameEl) nameEl.textContent = file.name;
    state.fields[cfg.nameField] = file.name;
    state.fields[cfg.pathField] = '';
    state.uploading[docType] = true;
    setDocHint(docType, 'Uploading…', null);
    try {
        const res = await data.uploadKycDocument(state.user.uid, docType, file);
        state.fields[cfg.pathField] = res.storagePath;
        state.fields[cfg.nameField] = res.fileName;
        setDocHint(docType, 'Uploaded', 'ok');
        clearFieldError(`#${cfg.input}`, 'account-docs-error');
    } catch (err) {
        state.fields[cfg.pathField] = '';
        state.fields[cfg.nameField] = '';
        if (nameEl) nameEl.textContent = 'Choose file';
        const code = err?.message === 'file-too-large'
            ? 'That file is larger than 5MB. Please upload a smaller scan or photo.'
            : err?.message === 'file-type-unsupported'
                ? 'Please upload a JPG, PNG, or PDF.'
                : 'Upload failed. Check your connection and try again.';
        setDocHint(docType, code, 'error');
    } finally {
        state.uploading[docType] = false;
    }
}

const DOC_DEFAULT_HINT = {
    get identity() { return docHints().identity; },
    get business() { return docHints().business; }
};

// Files are already in Storage by the time this runs (uploaded on select), so
// this only records where they landed.
function docsPayload() {
    return {
        identity_document_status: state.fields.id_doc_path ? 'uploaded' : 'not_uploaded',
        identity_document_storage_path: state.fields.id_doc_path || null,
        identity_document_file_name: state.fields.id_doc_name || null,
        business_document_status: state.fields.biz_doc_path ? 'uploaded' : 'not_uploaded',
        business_document_storage_path: state.fields.biz_doc_path || null,
        business_document_file_name: state.fields.biz_doc_name || null
    };
}

function syncFormFromState() {
    const legal = document.querySelector('#f-legal-name');
    if (legal) legal.value = state.fields.legal_full_name || '';
    syncCustomSelectFromState('#f-role', '#f-role-custom', state.fields.role);
    syncCustomSelectFromState('#f-main-goal', '#f-main-goal-custom', state.fields.main_goal);
    syncCustomSelectFromState('#f-revenue', '#f-revenue-custom', state.fields.monthly_revenue_range);
    syncCustomSelectFromState('#f-employees', '#f-employees-custom', state.fields.employee_count_range);
    const country = document.querySelector('#f-phone-country');
    if (country) country.value = COUNTRY_CODES.includes(state.fields.phone_country_code) ? state.fields.phone_country_code : '+62';
    document.querySelector('#f-phone-country-custom')?.onboardingSelect?.setValue(country?.value || '+62');
    const phone = document.querySelector('#f-phone-local');
    if (phone) phone.value = state.fields.phone_local_number || '';
    document.querySelectorAll('input[name="first_actions"]').forEach((el) => {
        el.checked = state.fields.first_actions.includes(el.value);
    });
}

function syncCustomSelectFromState(sourceSelector, customSelector, value) {
    const source = document.querySelector(sourceSelector);
    const cleanValue = value || '';
    if (source) source.value = cleanValue;
    document.querySelector(customSelector)?.onboardingSelect?.setValue(cleanValue);
}

function mountOnboardingCustomSelect(rootSelector) {
    const root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
    if (!root || root.onboardingSelect) return root?.onboardingSelect || null;
    const source = document.getElementById(root.dataset.sourceSelect || '');
    if (!source) return null;
    const options = Array.from(source.options).map((opt) => ({
        value: opt.value,
        label: opt.textContent.trim(),
        disabled: opt.disabled
    }));
    const ariaLabel = root.dataset.ariaLabel || source.getAttribute('aria-label') || 'Select option';
    root.innerHTML = `
        <button type="button" class="onboarding-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">
            <span class="onboarding-select-label"></span>
            <svg class="onboarding-select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 8l4 4 4-4"/>
            </svg>
        </button>
        <div class="onboarding-select-menu" role="listbox" tabindex="-1"></div>
    `;

    const trigger = root.querySelector('.onboarding-select-trigger');
    const labelEl = root.querySelector('.onboarding-select-label');
    const menu = root.querySelector('.onboarding-select-menu');
    menu.innerHTML = options.map((opt) => `
        <button type="button" role="option" class="onboarding-select-option" data-value="${escapeHtml(opt.value)}" ${opt.disabled ? 'aria-disabled="true" disabled' : ''}>
            <span>${escapeHtml(opt.label)}</span>
            <svg class="onboarding-select-option-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M5 10l4 4 7-8"/>
            </svg>
        </button>
    `).join('');

    function findOption(value) {
        return options.find((opt) => opt.value === value) || options[0];
    }

    function renderSelected() {
        const opt = findOption(instance.value);
        labelEl.textContent = opt?.label || 'Select';
        menu.querySelectorAll('.onboarding-select-option').forEach((optionEl) => {
            optionEl.setAttribute('aria-selected', optionEl.dataset.value === instance.value ? 'true' : 'false');
        });
    }

    function positionMenu() {
        menu.style.maxWidth = `${Math.max(220, Math.min(root.getBoundingClientRect().width, window.innerWidth - 32))}px`;
    }

    function open() {
        if (openCustomSelect && openCustomSelect !== instance) openCustomSelect.close();
        root.dataset.open = 'true';
        trigger.setAttribute('aria-expanded', 'true');
        openCustomSelect = instance;
        positionMenu();
        requestAnimationFrame(positionMenu);
        const selected = menu.querySelector('[aria-selected="true"]:not([disabled])') || menu.querySelector('.onboarding-select-option:not([disabled])');
        selected?.focus();
    }

    function close() {
        root.dataset.open = 'false';
        trigger.setAttribute('aria-expanded', 'false');
        if (openCustomSelect === instance) openCustomSelect = null;
    }

    function toggle() {
        if (root.dataset.open === 'true') close();
        else open();
    }

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        toggle();
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });
    menu.addEventListener('click', (event) => {
        const optionEl = event.target.closest('.onboarding-select-option');
        if (!optionEl || optionEl.disabled) return;
        event.stopPropagation();
        instance.setValue(optionEl.dataset.value, { emit: true });
        close();
        trigger.focus();
    });
    menu.addEventListener('keydown', (event) => {
        const items = Array.from(menu.querySelectorAll('.onboarding-select-option:not([disabled])'));
        const index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            items[Math.min(index + 1, items.length - 1)]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            items[Math.max(index - 1, 0)]?.focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            items[0]?.focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            items[items.length - 1]?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
            trigger.focus();
        }
    });

    const instance = {
        value: source.value || options[0]?.value || '',
        root,
        menu,
        setValue(value, { emit = false } = {}) {
            instance.value = value || '';
            source.value = instance.value;
            renderSelected();
            if (emit) source.dispatchEvent(new Event('change', { bubbles: true }));
            if (source.id === 'f-phone-country') {
                clearFieldError('#f-phone-local', 'f-phone-error');
            }
        },
        close,
        positionMenu
    };
    root.onboardingSelect = instance;
    renderSelected();
    return instance;
}

function bindCustomSelectGlobalHandlers() {
    if (customSelectGlobalHandlersBound) return;
    customSelectGlobalHandlersBound = true;
    document.addEventListener('click', (event) => {
        if (!openCustomSelect) return;
        if (openCustomSelect.root.contains(event.target)) return;
        openCustomSelect.close();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openCustomSelect) openCustomSelect.close();
    });
    document.addEventListener('scroll', (event) => {
        if (!openCustomSelect) return;
        if (openCustomSelect.menu?.contains(event.target)) return;
        openCustomSelect.close();
    }, true);
    window.addEventListener('resize', () => openCustomSelect?.close());
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

/*
 * Country PRE-SELECTS the base currency; it never constrains it.
 *
 * Under IAS 21 functional currency follows the primary economic environment,
 * not the place of incorporation — a Singapore-incorporated entity may
 * legitimately keep its books in another currency. So changing the country
 * moves the currency to that country's default ONLY while the user has not
 * deliberately chosen one themselves; after that, their choice stands.
 */
const LOCALE_STASH_KEY = 'fluxy_onboarding_stash';

/*
 * Language picker.
 *
 * FluxyI18n.setLang('en') RELOADS the page — reverting Bahasa in place would mean
 * tracking every original string, so the dictionary reloads instead. Mid-onboarding
 * that would discard whatever the user had typed, so stash the in-flight fields
 * first and restore them on the way back in.
 */
function bindLanguageSelect() {
    const el = document.querySelector('#f-language');
    if (!el) return;
    // Reflect the language actually in effect. A returning user may already be on
    // English via Settings while their profile carries nothing — showing "Bahasa
    // Indonesia" over an English page is the control lying about its own state.
    if (!state.fields.language) state.fields.language = window.FluxyI18n?.getLang?.() || 'id';
    el.value = state.fields.language;
    el.addEventListener('change', () => {
        const lang = el.value === 'en' ? 'en' : 'id';
        state.fields.language = lang;
        clearFieldError('#f-language');
        try {
            sessionStorage.setItem(LOCALE_STASH_KEY, JSON.stringify({
                fields: state.fields,
                stepIndex: state.stepIndex,
                currencyTouched: state.currencyTouched
            }));
        } catch (_) {}
        // Translates in place for 'id'; reloads for 'en'. Either way the stash
        // above makes the round trip lossless.
        window.FluxyI18n?.setLang(lang);
    });
}

/** Re-apply anything stashed before a language reload. Consumed once. */
function restoreLocaleStash() {
    let raw = null;
    try { raw = sessionStorage.getItem(LOCALE_STASH_KEY); } catch (_) {}
    if (!raw) return;
    try { sessionStorage.removeItem(LOCALE_STASH_KEY); } catch (_) {}
    try {
        const saved = JSON.parse(raw);
        if (saved && saved.fields) Object.assign(state.fields, saved.fields);
        if (typeof saved?.stepIndex === 'number') state.stepIndex = saved.stepIndex;
        if (typeof saved?.currencyTouched === 'boolean') state.currencyTouched = saved.currencyTouched;
    } catch (_) {}
}

function bindCountryCurrencyDefault() {
    const country = document.querySelector('#f-country');
    const currency = document.querySelector('#f-base-currency');
    if (!country || !currency) return;

    // Preview the whole form in the chosen currency, and rebuild the revenue
    // bands to match. The seam is reset per page load by workspace-service, so
    // setting it here cannot leak into a later session.
    const applyCurrency = (code) => {
        window.FluxyMoney.setBaseCurrency(code);
        renderRevenueOptions();
    };

    currency.addEventListener('change', () => {
        state.currencyTouched = true;
        applyCurrency(currency.value);
    });

    country.addEventListener('change', () => {
        applyCountryDependentCopy();
        if (state.currencyTouched) return;
        const next = window.FluxyMoney && window.FluxyMoney.currencyForCountry(country.value);
        if (!next || next === currency.value) return;
        currency.value = next;
        state.fields.base_currency = next;
        // Deliberately NOT dispatching 'change' here: that would fire the
        // listener above and mark the currency as user-chosen, so the next
        // country change would stop updating it. Set the state directly and
        // push the value into the enhanced control that renders over the
        // native <select>.
        document.querySelector('#f-base-currency-custom')?.onboardingSelect?.setValue(next);
        applyCurrency(next);
        clearFieldError('#f-base-currency');
    });
}

/*
 * Rebuild the monthly-revenue options in the selected base currency.
 *
 * Without this the bands stay in rupiah while the workspace is in pesos — the
 * screen asks a Philippine owner to classify their revenue in a currency they do
 * not use. Reported from the live onboarding form on 2026-08-22.
 */
function revenueOptionLabels() {
    const M = window.FluxyMoney;
    const ccy = M.baseCurrency();
    const bands = REVENUE_BANDS[ccy] || REVENUE_BANDS[M.DEFAULT_BASE];
    const minorPerUnit = (M.CURRENCIES[ccy] || M.CURRENCIES[M.DEFAULT_BASE]).minorPerUnit;
    // Whole units only — "Under ₱250,000" reads as a band; "₱250,000.00" reads as
    // a price. formatBasePrecise(x, 0) keeps IDR byte-identical to the old labels.
    const f = (units) => M.formatBasePrecise(units * minorPerUnit, 0);
    const labels = [`Under ${f(bands[0])}`];
    for (let i = 0; i < bands.length - 1; i += 1) labels.push(`${f(bands[i])} - ${f(bands[i + 1])}`);
    labels.push(`Above ${f(bands[bands.length - 1])}`);
    return labels;
}

/*
 * Re-apply everything downstream of the business country: the KYC document hints
 * (KTP/NIB mean nothing in Manila) and the WhatsApp dial code. The hints are
 * literal text in onboarding.html, so nothing repaints them on its own.
 */
function applyCountryDependentCopy() {
    const hints = docHints();
    const idHint = document.getElementById('f-id-doc-hint');
    const bizHint = document.getElementById('f-biz-doc-hint');
    // Only reset a hint that is still showing guidance — never stomp on an
    // upload result ("Uploaded", or an error the user still needs to read).
    if (idHint && !idHint.classList.contains('is-ok') && !idHint.classList.contains('is-error')) {
        idHint.textContent = hints.identity;
    }
    if (bizHint && !bizHint.classList.contains('is-ok') && !bizHint.classList.contains('is-error')) {
        bizHint.textContent = hints.business;
    }

    // Preselect the country's dial code, but never overwrite a number the user
    // has already started typing a prefix for.
    const dial = COUNTRY_DIAL[state.fields.country];
    const phone = document.querySelector('#f-phone-country');
    if (dial && phone && !state.fields.phone_local_number) {
        state.fields.phone_country_code = dial;
        phone.value = dial;
        document.querySelector('#f-phone-country-custom')?.onboardingSelect?.setValue(dial);
    }
}

function renderRevenueOptions() {
    const select = document.querySelector('#f-revenue');
    if (!select) return;
    const labels = revenueOptionLabels();

    // A band chosen in the previous currency is meaningless in the new one —
    // "Rp50.000.000 - Rp100.000.000" on a peso workspace is not a smaller number,
    // it is a different question. Drop it rather than silently mis-filing them.
    if (state.fields.monthly_revenue_range && !labels.includes(state.fields.monthly_revenue_range)) {
        state.fields.monthly_revenue_range = '';
    }

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = !state.fields.monthly_revenue_range;
    placeholder.textContent = 'Select monthly revenue';
    select.appendChild(placeholder);
    labels.forEach((label) => {
        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        if (label === state.fields.monthly_revenue_range) opt.selected = true;
        select.appendChild(opt);
    });
    select.value = state.fields.monthly_revenue_range || '';

    // The enhanced control snapshots its options at mount and refuses to remount,
    // so clear it before rebuilding or it keeps showing the old currency's bands.
    const custom = document.querySelector('#f-revenue-custom');
    if (custom) {
        custom.onboardingSelect = null;
        custom.innerHTML = '';
        mountOnboardingCustomSelect(custom);
        custom.onboardingSelect?.setValue(state.fields.monthly_revenue_range || '');
    }
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

function getQueuedLearningTours(actions = state.fields.first_actions) {
    const tours = ['overview'];
    getLearningToursForActions(actions).forEach((tourId) => {
        if (!tours.includes(tourId)) tours.push(tourId);
    });
    return tours;
}

function updateLearningTourState() {
    state.fields.selected_learning_tours = getQueuedLearningTours();
    state.fields.primary_learning_tour = 'overview';
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

    if (step === 'workspace_locale') {
        return validateRequired([
            ['#f-language', state.fields.language, 'f-language-error'],
            ['#f-country', state.fields.country, 'f-country-error'],
            ['#f-base-currency', state.fields.base_currency, 'f-base-currency-error']
        ]);
    }

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
        // The identity document is the one thing a reviewer actually verifies, so
        // it is required — an optional field here left the review queue with
        // nothing to check. The business document stays optional: plenty of
        // Indonesian SMBs are unregistered sole traders with no NIB to upload.
        if (state.uploading.identity || state.uploading.business) {
            valid = false;
            setFieldError('#f-id-doc', 'account-docs-error', 'Wait for the upload to finish.');
        } else if (!state.fields.id_doc_path) {
            valid = false;
            setFieldError('#f-id-doc', 'account-docs-error', 'Upload an identity document so we can verify your account.');
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
    const custom = getCustomSelectForSource(el);
    if (custom) custom.classList.add('is-invalid');
    const resolvedErrorId = errorId || el?.getAttribute('aria-describedby');
    if (resolvedErrorId) {
        const error = document.getElementById(resolvedErrorId);
        if (error) error.textContent = message;
    }
}

function clearFieldError(selector, errorId) {
    const el = document.querySelector(selector);
    if (el) el.classList.remove('is-invalid');
    const custom = getCustomSelectForSource(el);
    if (custom) custom.classList.remove('is-invalid');
    const resolvedErrorId = errorId || el?.getAttribute('aria-describedby');
    if (resolvedErrorId) {
        const error = document.getElementById(resolvedErrorId);
        if (error) error.textContent = '';
    }
}

function getCustomSelectForSource(sourceEl) {
    if (!sourceEl?.id) return null;
    return document.querySelector(`.onboarding-custom-select[data-source-select="${sourceEl.id}"]`);
}

// ---------- Step transitions ----------
async function onContinue() {
    if (!validateStep()) return;
    const stepKey = STEPS[state.stepIndex].key;

    try {
        if (stepKey === 'workspace_locale') {
            await data.saveOnboardingProfile(state.user.uid, {
                language: state.fields.language,
                country: state.fields.country,
                base_currency: state.fields.base_currency
            });
            state.localeConfirmed = true;
        }

        if (stepKey === 'business_setup') {
            await data.saveOnboardingProfile(state.user.uid, {
                business_name: state.fields.business_name,
                country: state.fields.country,
                base_currency: state.fields.base_currency,
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
            await data.saveOnboardingDocuments(state.user.uid, docsPayload());
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

async function onSubmit() {
    if (state.submitting) return;
    const tosCheckbox = document.getElementById('tos-agree-checkbox');
    const tosLabel = document.getElementById('tos-agree-label');
    const tosError = document.getElementById('tos-agree-error');
    if (tosCheckbox && !tosCheckbox.checked) {
        tosLabel?.classList.add('is-invalid');
        if (tosError) tosError.textContent = 'Please agree to the Terms of Service and Privacy Policy to continue.';
        tosCheckbox.focus();
        return;
    }
    if (tosLabel) tosLabel.classList.remove('is-invalid');
    if (tosError) tosError.textContent = '';
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
            language: state.fields.language,
            country: state.fields.country,
            base_currency: state.fields.base_currency,
            role: state.fields.role,
            main_goal: state.fields.main_goal,
            monthly_revenue_range: state.fields.monthly_revenue_range,
            employee_count_range: state.fields.employee_count_range,
            legal_full_name: state.fields.legal_full_name,
            phone_country_code: state.fields.phone_country_code,
            phone_number: state.fields.phone_number
        });
        await data.saveOnboardingDocuments(state.user.uid, docsPayload());

        // Stamp the workspace with its IMMUTABLE financial configuration. This is
        // the canonical home — workspaces/{id} is shared by every member, whereas
        // settings/ is user-scoped and would let two people in one company
        // disagree about the currency the books are kept in.
        //
        // Critical, not best-effort: without it the workspace resolves to the IDR
        // default and a Philippine business would silently keep books in rupiah.
        // firestore.rules enforces set-once, so a resubmission after
        // needs_revision cannot change an already-stamped currency.
        await data.ensureWorkspace(state.user.uid, {
            email: state.user.email || null,
            displayName: state.user.displayName || null,
            name: state.fields.business_name || null,
            country: state.fields.country,
            baseCurrency: state.fields.base_currency
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
            primary_learning_tour: state.fields.primary_learning_tour,
            // Post-cutoff users are locked out until a reviewer approves their
            // KYC. The flag is persisted because db-service only ever sees a uid,
            // never the auth metadata this decision needs.
            kyc_enforced: isKycEnforcedUser(state.user)
        });
        // Surface this freshly-submitted user in the internal operations index so
        // the team can review KYC. Best-effort — never blocks onboarding success.
        try {
            await data.syncSelfToInternalIndex(state.user.uid, {
                email: state.user.email || null,
                display_name: state.user.displayName || null,
                // Only a real resubmission may move a reviewer's 'needs_revision'
                // back into the queue — an ordinary page load must never clear it.
                resubmitted: state.resubmitting
            });
        } catch (e) {
            console.warn('[onboarding] internal index sync skipped', e);
        }
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

    await routeAfterSubmit();
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

async function routeAfterSubmit() {
    // The platform stays locked until a reviewer verifies this submission, so the
    // first post-submit frame is the review screen — not /dashboard. Legacy
    // (pre-cutoff) users are never enforced and still land on the dashboard.
    //
    // When the user IS locked, the coachmark queue is deliberately not seeded:
    // sessionStorage cannot survive a multi-day review, so kyc-gate.js re-queues
    // it from onboarding/progress at the moment access actually opens instead.
    try {
        const kyc = await resolveKycState(state.user);
        if (kyc.blocked) {
            showKycReviewScreen(kyc);
            return;
        }
    } catch (e) {
        console.warn('[onboarding] KYC state check skipped', e);
    }

    // Guarantee the onboarding coachmark shows the first time this just-onboarded
    // user reaches the overview. Honored + cleared by dashboard.html.
    sessionStorage.setItem('fluxy_learning_promote_force', '1');
    sessionStorage.setItem('fluxy_pending_tour', 'overview');
    if (state.fields.selected_learning_tours.length) {
        sessionStorage.setItem('fluxy_pending_tours', JSON.stringify(state.fields.selected_learning_tours));
    } else {
        sessionStorage.setItem('fluxy_pending_tours', JSON.stringify(['overview']));
    }
    window.location.href = '/dashboard';
}

// ---------- Review ----------
function renderReview() {
    const f = state.fields;
    // Stored values are English (schema §4f); composite " · " rows never hit
    // the i18n walker as exact strings, so translate the parts for display.
    const tt = (s) => (s ? (window.FluxyI18n?.t(s) ?? s) : '—');
    const preferenceLabels = f.first_actions
        .map((value) => ONBOARDING_PREFERENCES.find((item) => item.value === value)?.label)
        .filter(Boolean);
    const preferenceHtml = preferenceLabels.length
        ? `<span class="onboarding-chip-list">${preferenceLabels.map((label) => `<span class="onboarding-chip">${escapeHtml(label)}</span>`).join('')}</span>`
        : '—';
    const documentsHtml = [
        f.id_doc_name ? `${tt('Identity:')} ${tt(f.id_doc_name)}` : 'Identity: not added',
        f.biz_doc_name ? `${tt('Business:')} ${tt(f.biz_doc_name)}` : 'Business: not added'
    ].map((label) => `<span class="onboarding-chip">${escapeHtml(label)}</span>`).join('');
    const rows = [
        ['Business details', `${f.business_name || '—'} · ${tt(f.role)}`, false],
        // Surfaced explicitly because it is the one choice on this form the user
        // cannot undo afterwards — it should be read before submit, not discovered
        // in Settings later.
        ['Country and base currency',
            `${tt(window.FluxyMoney.COUNTRY_LABELS[f.country] || f.country || '—')} · ${tt(f.base_currency || '—')}`, false],
        ['Business size', `${tt(f.monthly_revenue_range)} · ${tt(f.employee_count_range)}`, false],
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
