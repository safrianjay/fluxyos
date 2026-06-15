import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { BILLING_PLANS, calculateBilling, formatIDR, getCheckoutSelection, isSalesLedPlan } from "./billing-config.js";

// Sales-led plans (Enterprise AI) have no self-serve checkout — bounce to the
// Contact Sales flow if someone deep-links /checkout?plan=enterprise.
function annualSavingsPercent(plan) {
    if (!plan || typeof plan.monthly !== 'number' || !plan.annualMonthlyEquivalent) return 0;
    return Math.round((1 - plan.annualMonthlyEquivalent / plan.monthly) * 100);
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
                <div class="plan-option-price">${formatIDR(selectedBilling === 'annually' ? plan.annualMonthlyEquivalent : plan.monthly)}/mo</div>
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
    $('voucher-applied-detail').textContent = `${appliedVoucher.discount_value}% off · −${formatIDR(calculation.voucherDiscountAmount)}`;
    $('voucher-row-label').textContent = `Voucher ${appliedVoucher.code}`;
    $('voucher-row-amount').textContent = `−${formatIDR(calculation.voucherDiscountAmount)}`;
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
    $('summary-total').textContent = formatIDR(calculation.totalAmount);
    $('summary-plan-name').textContent = plan.name;
    $('summary-plan-price').textContent = `${formatIDR(calculation.monthlyDisplayAmount)}/mo`;
    $('summary-plan-desc').textContent = plan.description;
    $('summary-copy').textContent = `You will be billed ${selectedBilling === 'annually' ? 'annually' : 'monthly'} for FluxyOS ${plan.name}. Estimated PPN is shown before payment.`;
    $('summary-benefits').innerHTML = plan.benefits.map((benefit) => `<li><span class="summary-tick">&#10003;</span><span>${escapeHtml(benefit)}</span></li>`).join('');
    $('subtotal').textContent = formatIDR(calculation.subtotalAmount);
    $('discount').textContent = selectedBilling === 'annually' ? `Save ${annualSavingsPercent(plan)}%` : 'Not applied';
    $('tax').textContent = formatIDR(calculation.estimatedTaxAmount);
    $('total-due').textContent = formatIDR(calculation.totalAmount);
    $('checkout-payable-total').textContent = formatIDR(calculation.totalAmount);
    $('monthly-label').textContent = `${formatIDR(plan.monthly)}/month`;
    $('annual-label').textContent = `${formatIDR(plan.annualMonthlyEquivalent)}/month`;
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
        setVoucherMessage('success', `Voucher applied. You saved ${formatIDR(result.discountAmount)}.`);
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
