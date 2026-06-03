import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { BILLING_PLANS, calculateBilling, formatIDR, getCheckoutSelection } from "./billing-config.js";

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
const initial = getCheckoutSelection(window.location.search);
let selectedPlan = initial.planId;
let selectedBilling = initial.billingFrequency;
let selectedMethod = 'qris';
let currentUser = null;
let submitting = false;

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
    $('plan-options').innerHTML = Object.values(BILLING_PLANS).map((plan) => `
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

function updateCheckout() {
    const calculation = calculateBilling(selectedPlan, selectedBilling);
    const { plan } = calculation;
    document.querySelectorAll('[data-billing]').forEach((button) => button.classList.toggle('active', button.dataset.billing === selectedBilling));
    $('summary-total').textContent = formatIDR(calculation.totalAmount);
    $('summary-plan-name').textContent = plan.name;
    $('summary-plan-price').textContent = `${formatIDR(calculation.monthlyDisplayAmount)}/mo`;
    $('summary-plan-desc').textContent = plan.description;
    $('summary-copy').textContent = `You will be billed ${selectedBilling === 'annually' ? 'annually' : 'monthly'} for FluxyOS ${plan.name}. Estimated PPN is shown before payment.`;
    $('summary-benefits').innerHTML = plan.benefits.map((benefit) => `<li><span class="summary-tick">&#10003;</span><span>${escapeHtml(benefit)}</span></li>`).join('');
    $('subtotal').textContent = formatIDR(calculation.subtotalAmount);
    $('discount').textContent = selectedBilling === 'annually' ? 'Save 20%' : 'Not applied';
    $('tax').textContent = formatIDR(calculation.estimatedTaxAmount);
    $('total-due').textContent = formatIDR(calculation.totalAmount);
    $('checkout-payable-total').textContent = formatIDR(calculation.totalAmount);
    $('monthly-label').textContent = `${formatIDR(plan.monthly)}/month`;
    $('annual-label').textContent = `${formatIDR(plan.annualMonthlyEquivalent)}/month`;
    renderPlanOptions();
    updateUrl();
}

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
            payment_method: selectedMethod
        });
        // QRIS shows the "pay this QR" screen first; other methods go straight to
        // verification-in-progress.
        window.location.replace(created?.payment_status === 'awaiting_payment'
            ? `/payment-pending?requestId=${encodeURIComponent(created.id)}`
            : '/payment-pending');
    } catch (_) {
        error.textContent = 'We could not submit your payment request. Please try again.';
        error.classList.remove('hidden');
        submitting = false;
        button.disabled = false;
        button.textContent = 'Submit payment request';
    }
});

updateCheckout();
