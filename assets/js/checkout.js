import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { BILLING_PLANS, calculateBilling, formatIDR, getCheckoutSelection, isSalesLedPlan } from "./billing-config.js";

// Sales-led plans (Enterprise AI) have no self-serve checkout — bounce to the
// Contact Sales flow if someone deep-links /checkout?plan=enterprise.
function annualSavingsPercent(plan) {
    if (!plan || typeof plan.monthly !== 'number' || !plan.annualMonthlyEquivalent) return 0;
    // Capped at 20% so the displayed discount label stays consistent with the
    // "Save up to 20%" pricing banner (Starter's real saving is 23%; the actual
    // discounted price is unchanged — only the advertised label is capped).
    return Math.min(20, Math.round((1 - plan.annualMonthlyEquivalent / plan.monthly) * 100));
}

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
const auth = getAuth(app);
const data = new DataService(app);
const initial = getCheckoutSelection(window.location.search);
if (isSalesLedPlan(initial.planId)) {
    window.location.replace('/contact-sales');
}
let selectedPlan = initial.planId;
let selectedBilling = initial.billingFrequency;
let selectedMethod = 'qris';
let currentUser = null;
let submitting = false;
let appliedVoucher = null;
let voucherChecking = false;

const VOUCHER_ERROR_COPY = {
    'invalid': 'This voucher code is not valid.',
    'not-started': 'This voucher code is not valid.',
    'expired': 'This voucher has expired.',
    'disabled': 'This voucher is no longer available.',
    'usage-limit': 'This voucher has already reached its usage limit.',
    'plan-mismatch': 'This voucher is not available for this plan.',
    'frequency-mismatch': 'This voucher is not available for this billing frequency.'
};

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const authTimeout = setTimeout(() => window.location.replace('/login'), 2500);
onAuthStateChanged(auth, async (user) => {
    // Resolve the workspace before pricing renders: the indicative line needs the
    // business's base currency, and without this it would always read IDR and
    // stay hidden for exactly the customers it exists for.
    if (user) {
        try {
            const { resolveWorkspace } = await import('/assets/js/workspace-service.js');
            await resolveWorkspace(app, user);
            // Rate first, THEN re-render: updateCheckout() already ran on page
            // load against the IDR default, and painting converted prices before
            // the rate is in hand would show IDR and swap to PHP a moment later —
            // the flicker removed everywhere else in the app.
            await ensureFxRate();
            updateCheckout();
        } catch (_) { /* price still renders in IDR, which is the real charge */ }
    }
    if (!user) return;
    clearTimeout(authTimeout);
    currentUser = user;
    try { await data.ensureBillingSubscription(user.uid); } catch (_) { /* checkout remains available */ }
});

function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('plan', selectedPlan);
    url.searchParams.set('billing', selectedBilling);
    window.history.replaceState({}, '', url);
}

function renderPlanOptions() {
    $('plan-options').innerHTML = Object.values(BILLING_PLANS).filter((plan) => !plan.salesLed).map((plan) => `
        <button class="plan-option${plan.id === selectedPlan ? ' active' : ''}" type="button" data-plan="${plan.id}">
            <div class="plan-option-header">
                <div>
                    <div class="plan-option-name">${escapeHtml(plan.name)}${plan.id === 'growth' ? '<span class="popular-pill">Most popular</span>' : ''}</div>
                    <p class="plan-option-desc">${escapeHtml(plan.description)}</p>
                </div>
                <div class="plan-option-price">${money(selectedBilling === 'annually' ? plan.annualMonthlyEquivalent : plan.monthly)}/mo</div>
            </div>
        </button>
    `).join('');
    document.querySelectorAll('[data-plan]').forEach((button) => {
        button.addEventListener('click', () => {
            selectedPlan = button.dataset.plan;
            updateCheckout();
        });
    });
}

function setVoucherMessage(kind, message) {
    $('voucher-error').classList.toggle('hidden', kind !== 'error');
    $('voucher-success').classList.toggle('hidden', kind !== 'success');
    if (kind === 'error') $('voucher-error').textContent = message;
    if (kind === 'success') $('voucher-success').textContent = message;
}

function renderVoucherState(calculation) {
    const hasVoucher = !!appliedVoucher;
    $('voucher-input-row').classList.toggle('hidden', hasVoucher);
    $('voucher-applied').classList.toggle('hidden', !hasVoucher);
    $('voucher-row').classList.toggle('hidden', !hasVoucher);
    if (!hasVoucher) {
        $('voucher-row-amount').textContent = '';
        return;
    }
    $('voucher-applied-code').textContent = appliedVoucher.code;
    $('voucher-applied-detail').textContent = `${appliedVoucher.discount_value}% off · −${money(calculation.voucherDiscountAmount)}`;
    $('voucher-row-label').textContent = `Voucher ${appliedVoucher.code}`;
    $('voucher-row-amount').textContent = `−${money(calculation.voucherDiscountAmount)}`;
}

function updateCheckout() {
    // An applied voucher must stay eligible for the current plan + frequency;
    // otherwise it is removed (never silently kept while the price changed).
    if (appliedVoucher) {
        const reason = data._assessVoucherEligibility(appliedVoucher, {
            planId: selectedPlan,
            billingFrequency: selectedBilling
        });
        if (reason) {
            const removedCode = appliedVoucher.code;
            appliedVoucher = null;
            setVoucherMessage('error', `Voucher ${removedCode} was removed: ${(VOUCHER_ERROR_COPY[reason] || VOUCHER_ERROR_COPY.invalid).toLowerCase().replace('this voucher', 'it')}`);
        }
    }
    const calculation = calculateBilling(selectedPlan, selectedBilling, appliedVoucher);
    const { plan } = calculation;
    document.querySelectorAll('[data-billing]').forEach((button) => button.classList.toggle('active', button.dataset.billing === selectedBilling));
    $('summary-total').textContent = money(calculation.totalAmount);
    renderSettlementNote(calculation.totalAmount);
    $('summary-plan-name').textContent = plan.name;
    $('summary-plan-price').textContent = `${money(calculation.monthlyDisplayAmount)}/mo`;
    $('summary-plan-desc').textContent = plan.description;
    $('summary-copy').textContent = `You will be billed ${selectedBilling === 'annually' ? 'annually' : 'monthly'} for FluxyOS ${plan.name}. Estimated PPN is shown before payment.`;
    $('summary-benefits').innerHTML = plan.benefits.map((benefit) => `<li><span class="summary-tick">&#10003;</span><span>${escapeHtml(benefit)}</span></li>`).join('');
    $('subtotal').textContent = money(calculation.subtotalAmount);
    $('discount').textContent = selectedBilling === 'annually' ? `Save ${annualSavingsPercent(plan)}%` : 'Not applied';
    $('tax').textContent = money(calculation.estimatedTaxAmount);
    $('total-due').textContent = money(calculation.totalAmount);
    $('checkout-payable-total').textContent = money(calculation.totalAmount);
    $('monthly-label').textContent = `${money(plan.monthly)}/month`;
    $('annual-label').textContent = `${money(plan.annualMonthlyEquivalent)}/month`;
    renderVoucherState(calculation);
    renderPlanOptions();
    updateUrl();
}

async function applyVoucher() {
    if (voucherChecking || appliedVoucher) return;
    const rawCode = $('voucher-input').value.trim();
    if (!rawCode) {
        setVoucherMessage('error', 'Enter a voucher code first.');
        return;
    }
    voucherChecking = true;
    const applyButton = $('voucher-apply');
    applyButton.disabled = true;
    applyButton.textContent = 'Checking...';
    setVoucherMessage(null);
    try {
        const result = await data.validateVoucherCode({
            code: rawCode,
            planId: selectedPlan,
            billingFrequency: selectedBilling
        });
        if (!result.valid) {
            setVoucherMessage('error', VOUCHER_ERROR_COPY[result.reason] || VOUCHER_ERROR_COPY.invalid);
            return;
        }
        appliedVoucher = result.voucher;
        setVoucherMessage('success', `Voucher applied. You saved ${money(result.discountAmount)}.`);
        updateCheckout();
    } catch (_) {
        setVoucherMessage('error', 'We could not check this voucher. Please try again.');
    } finally {
        voucherChecking = false;
        applyButton.disabled = false;
        applyButton.textContent = 'Apply';
    }
}

function removeVoucher() {
    appliedVoucher = null;
    setVoucherMessage(null);
    updateCheckout();
    $('voucher-input').focus();
}

$('voucher-input').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
});
$('voucher-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        applyVoucher();
    }
});
$('voucher-apply').addEventListener('click', applyVoucher);
$('voucher-remove').addEventListener('click', removeVoucher);

document.querySelectorAll('[data-billing]').forEach((button) => {
    button.addEventListener('click', () => {
        selectedBilling = button.dataset.billing;
        updateCheckout();
    });
});

document.querySelectorAll('[data-method]').forEach((button) => {
    button.addEventListener('click', () => {
        selectedMethod = button.dataset.method;
        document.querySelectorAll('[data-method]').forEach((item) => item.classList.toggle('active', item === button));
        document.querySelectorAll('[data-payment-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.paymentPanel !== selectedMethod));
    });
});

$('submit-button').addEventListener('click', async () => {
    if (submitting) return;
    const error = $('form-error');
    error.classList.add('hidden');
    if (!currentUser?.uid) {
        error.textContent = 'Your session is still loading. Please try again.';
        error.classList.remove('hidden');
        return;
    }
    submitting = true;
    const button = $('submit-button');
    button.disabled = true;
    button.textContent = 'Submitting request...';
    try {
        const created = await data.createPaymentRequest(currentUser.uid, {
            plan_id: selectedPlan,
            billing_frequency: selectedBilling,
            payment_method: selectedMethod,
            voucher_code: appliedVoucher ? appliedVoucher.code : null
        });
        // QRIS shows the "pay this QR" screen first; other methods go straight to
        // verification-in-progress.
        window.location.replace(created?.payment_status === 'awaiting_payment'
            ? `/payment-pending?requestId=${encodeURIComponent(created.id)}`
            : '/payment-pending');
    } catch (submitError) {
        // The transaction revalidates the voucher server-side; surface a voucher
        // failure inline (e.g. last slot taken or disabled since apply) and drop
        // the stale applied state so the user sees the undiscounted total.
        const voucherReason = String(submitError?.message || '').startsWith('voucher-')
            ? submitError.message.slice('voucher-'.length)
            : null;
        if (voucherReason) {
            appliedVoucher = null;
            updateCheckout();
            setVoucherMessage('error', VOUCHER_ERROR_COPY[voucherReason] || VOUCHER_ERROR_COPY.invalid);
        } else {
            error.textContent = 'We could not submit your payment request. Please try again.';
            error.classList.remove('hidden');
        }
        submitting = false;
        button.disabled = false;
        button.textContent = 'Submit payment request';
    }
});

updateCheckout();

/*
 * Indicative price in the workspace's currency — NEVER a replacement for the
 * charge.
 *
 * FluxyOS bills in IDR through QRIS/VA, which are Indonesian rails, and applies
 * Indonesian PPN because FluxyOS is an Indonesian seller. Rendering "₱2,650" as
 * the price would claim a peso charge that no provider here can make. So the IDR
 * figure stays the price, and the converted amount sits beside it, labelled with
 * what is actually settled.
 *
 * Rate comes from the shared /.netlify/functions/fx-rate proxy — the same
 * centralised source the ledger uses. No page-local conversion constants.
 *
 * When market-region pricing arrives this is where it plugs in: the source price
 * stops being IDR and this line stops being a conversion.
 */
// Re-run when the workspace currency lands, wherever it lands from.
if (typeof document !== 'undefined') {
    document.addEventListener('fluxy:workspace-ready', async () => {
        try { await ensureFxRate(); updateCheckout(); } catch (_) { /* nothing to refresh yet */ }
    });
}

/*
 * Checkout pricing in the BUSINESS's currency.
 *
 * Plans are priced in IDR (FluxyOS is an Indonesian seller and its PPN is
 * Indonesian). A Philippine client cannot judge "Rp74.458.800", so the price they
 * read is their own currency, converted from the IDR source at the shared
 * fx-rate proxy — the same central source the ledger uses, never a page-local
 * constant.
 *
 * Payment is a MANUAL TRANSFER today, so the IDR figure is not decoration: it is
 * the amount that actually has to arrive. It stays on screen beneath the total,
 * with the rate and its date, because a converted headline without a settlement
 * figure would leave the client guessing what to send.
 *
 * When a gateway lands, this is the seam that changes: the price stops being a
 * conversion and the settlement note stops being needed.
 */
let fxRate = null;          // base units per 1 IDR
let fxDate = null;
let fxTried = false;

function priceCurrency() {
    const M = window.FluxyMoney;
    return M ? M.baseCurrency() : 'IDR';
}

/** Format an IDR-denominated plan amount in the business's currency. */
function money(idrAmount) {
    const M = window.FluxyMoney;
    const base = priceCurrency();
    if (!M || base === 'IDR' || !fxRate) return formatIDR(idrAmount);
    const cfg = M.CURRENCIES[base];
    const minor = Math.round(Number(idrAmount || 0) * fxRate * cfg.minorPerUnit);
    return M.formatMoney(minor, base);
}

/** Fetch the rate once per page. Returns true when a conversion is available. */
async function ensureFxRate() {
    const base = priceCurrency();
    if (base === 'IDR' || fxTried) return !!fxRate;
    fxTried = true;
    try {
        const res = await fetch(`/.netlify/functions/fx-rate?from=IDR&to=${encodeURIComponent(base)}`);
        const data = res.ok ? await res.json() : null;
        if (data && Number(data.rate) > 0) { fxRate = Number(data.rate); fxDate = data.date || null; }
    } catch (_) { /* prices stay in IDR, which is always correct */ }
    return !!fxRate;
}

/** The settlement note under the total. Only for a non-IDR business. */
function renderSettlementNote(idrTotal) {
    const el = $('summary-indicative');
    if (!el) return;
    if (priceCurrency() === 'IDR') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (!fxTried) {
        el.innerHTML = '<span class="inline-block h-3 w-56 rounded bg-gray-200 animate-pulse"></span>';
        return;
    }
    el.textContent = fxRate
        ? `Transfer ${formatIDR(idrTotal)} — settled in IDR${fxDate ? ` · rate ${fxDate}` : ''}`
        : 'Charged in IDR.';
}
