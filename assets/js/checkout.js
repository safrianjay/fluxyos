import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { BILLING_PLANS, calculateBilling, formatBilling, getCheckoutSelection, isSalesLedPlan, billingCurrency, planPrice, billingTaxFor, PAYMENT_INSTRUCTIONS, isPaymentInstructionReady } from "./billing-config.js";

// Sales-led plans (Enterprise AI) have no self-serve checkout — bounce to the
// Contact Sales flow if someone deep-links /checkout?plan=enterprise.
function annualSavingsPercent(plan) {
    // Prices live in the per-currency book, not on the plan. Read the billed
    // currency's ladder — the saving is the same ratio in every currency, but
    // reading plan.monthly (now absent) silently returned 0% for everyone.
    const price = planPrice(plan && plan.id, billingCurrency());
    if (!price || typeof price.monthly !== 'number' || !price.annualMonthlyEquivalent) return 0;
    // Capped at 20% so the displayed discount label stays consistent with the
    // "Save up to 20%" pricing banner (Starter's real saving is 23%; the actual
    // discounted price is unchanged — only the advertised label is capped).
    return Math.min(20, Math.round((1 - price.annualMonthlyEquivalent / price.monthly) * 100));
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
let selectedMethod = PAYMENT_INSTRUCTIONS[billingCurrency()].method;
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
        // Resolving the workspace and re-rendering are SEPARATE concerns. They
        // used to share one try/catch, and when the FX call in between was
        // deleted the resulting ReferenceError was swallowed here — so
        // updateCheckout() never ran and a peso workspace was quoted in rupiah,
        // with nothing in the console to show for it. A failed resolve must not
        // take the re-render down with it.
        try {
            const { resolveWorkspace } = await import('/assets/js/workspace-service.js');
            await resolveWorkspace(app, user);
        } catch (_) { /* seam falls back to IDR; never strand the page */ }
        // Always re-render: the first paint ran against the IDR default before
        // the workspace was known.
        updateCheckout();
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
                <div class="plan-option-price">${money(selectedBilling === 'annually' ? planPrice(plan.id, priceCurrency()).annualMonthlyEquivalent : plan.monthly)}/mo</div>
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
    const calculation = calculateBilling(selectedPlan, selectedBilling, appliedVoucher, priceCurrency());
    const { plan } = calculation;
    document.querySelectorAll('[data-billing]').forEach((button) => button.classList.toggle('active', button.dataset.billing === selectedBilling));
    $('summary-total').textContent = money(calculation.totalAmount);
    renderSettlementNote();
    $('summary-plan-name').textContent = plan.name;
    $('summary-plan-price').textContent = `${money(calculation.monthlyDisplayAmount)}/mo`;
    $('summary-plan-desc').textContent = plan.description;
    const tax = billingTaxFor(priceCurrency());
    $('summary-copy').textContent = `You will be billed ${selectedBilling === 'annually' ? 'annually' : 'monthly'} for FluxyOS ${plan.name}.${tax.rate > 0 ? ` Estimated ${tax.label} is shown before payment.` : ''}`;
    $('summary-benefits').innerHTML = plan.benefits.map((benefit) => `<li><span class="summary-tick">&#10003;</span><span>${escapeHtml(benefit)}</span></li>`).join('');
    $('subtotal').textContent = money(calculation.subtotalAmount);
    $('discount').textContent = selectedBilling === 'annually' ? `Save ${annualSavingsPercent(plan)}%` : 'Not applied';
    $('tax').textContent = money(calculation.estimatedTaxAmount);
    // PPN is Indonesian VAT on an Indonesian seller's invoice. When it is not
    // Every billing currency carries a tax: Indonesia PPN 11%, Philippines VAT
    // 12% on digital services. The LABEL and rate follow the currency — a Manila
    // client should never read the word PPN.
    document.querySelectorAll('[data-tax-label]').forEach((el) => { el.textContent = `Estimated ${tax.label}`; });
    document.querySelectorAll('[data-tax-note]').forEach((el) => {
        el.textContent = `${tax.label} estimate uses an effective ${tax.rate}% calculation on digital services.`;
    });
    $('total-due').textContent = money(calculation.totalAmount);
    $('checkout-payable-total').textContent = money(calculation.totalAmount);
    $('monthly-label').textContent = `${money(planPrice(plan.id, priceCurrency()).monthly)}/month`;
    $('annual-label').textContent = `${money(planPrice(plan.id, priceCurrency()).annualMonthlyEquivalent)}/month`;
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
            currency: priceCurrency(),
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
 * Prices come from the pinned per-currency price book — there is no conversion
 * on this page. PLAN_PRICES holds a real peso ladder and firestore.rules
 * enforces the same numbers, so what the customer reads is what is charged.
 *
 * This listener exists only because the workspace currency can land after first
 * paint: the page renders once against the IDR default, then again once the
 * business country is known.
 */
// Re-run when the workspace currency lands, wherever it lands from.
if (typeof document !== 'undefined') {
    document.addEventListener('fluxy:workspace-ready', async () => {
        updateCheckout();
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
/* Prices are PINNED per currency in the billing price book — never converted at
 * runtime. A price that moves with the daily FX fix cannot be put on an invoice
 * or a bank-transfer instruction, and the customer cannot check it. So there is
 * no FX call on this page any more: PLAN_PRICES holds a real peso ladder, and
 * firestore.rules enforces the same numbers server-side. */

function priceCurrency() {
    return billingCurrency();
}

/** Format a billing amount (minor units) in the currency being charged. */
function money(minorAmount) {
    return formatBilling(minorAmount, priceCurrency());
}

/** Payment instructions for the billed currency. QRIS is Indonesia-only. */
function renderSettlementNote() {
    const el = $('summary-indicative');
    if (!el) return;
    const ccy = priceCurrency();
    if (ccy === 'IDR') { el.classList.add('hidden'); return; }
    // Until the transfer account is filled in, say so plainly rather than
    // rendering an instruction with blank fields that nobody can act on.
    el.textContent = isPaymentInstructionReady(ccy)
        ? (PAYMENT_INSTRUCTIONS[ccy].note || '')
        : 'Contact hello@fluxyos.com to complete payment for this plan.';
    el.classList.remove('hidden');
}
