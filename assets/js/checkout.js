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
        // The currency is now as resolved as it is going to get — either the
        // workspace answered, or it failed and IDR is genuinely what we have.
        // Either way the amounts stop shimmering and paint for real.
        revealAmounts();
        // revealAmounts() re-renders only on the first call; a later auth event
        // still needs a repaint.
        updateCheckout();
    }
    // Signed out: the authTimeout above sends them to /login, but reveal anyway
    // so a slow redirect does not leave a shimmering page behind it.
    if (!user) { revealAmounts(); return; }
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
                <div class="plan-option-price">${moneyHtml(money(selectedBilling === 'annually' ? planPrice(plan.id, priceCurrency()).annualMonthlyEquivalent : planPrice(plan.id, priceCurrency()).monthly))}/mo</div>
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
    paintMoney($('voucher-applied-detail'), `${appliedVoucher.discount_value}% off · −${money(calculation.voucherDiscountAmount)}`);
    $('voucher-row-label').textContent = `Voucher ${appliedVoucher.code}`;
    paintMoney($('voucher-row-amount'), `−${money(calculation.voucherDiscountAmount)}`);
}

// The billing currency is not known at module load: it comes from the
// workspace, which needs auth first. Until then, money slots shimmer instead of
// showing the IDR default — otherwise every non-IDR customer watches the rupiah
// ladder for ~500ms before it swaps, and the page has quoted them a price we
// will not charge.
//
// Structure paints immediately; only amounts wait. Set true once the workspace
// resolves (or fails to, in which case IDR is genuinely the answer we have).
let currencyReady = false;

/** Paint a money slot, or shimmer it while the currency is still unknown. */
function paintMoney(el, text) {
    if (!el) return;
    if (currencyReady) {
        el.classList.remove('amount-pending');
        el.textContent = text;
        return;
    }
    el.classList.add('amount-pending');
    // Keep a non-breaking space so the element keeps its line box and nothing
    // reflows when the real figure lands.
    el.textContent = '\u00a0';
}

/** Stop shimmering and paint real figures. Idempotent. */
function revealAmounts() {
    if (currencyReady) return;
    currencyReady = true;
    updateCheckout();
}

// Failsafe. resolveWorkspace() has its own 6s timeout, and a page that shimmers
// for six seconds is worse than one showing the currency we already have — the
// seam falls back to IDR, which is right for most workspaces and recoverable
// for the rest, whereas a permanently skeletoned purchase screen is not.
setTimeout(revealAmounts, 3500);

/** Markup form, for slots rendered inside an innerHTML template. */
function moneyHtml(text) {
    return currencyReady
        ? escapeHtml(text)
        : '<span class="amount-pending">&nbsp;</span>';
}


// Payment rails are per currency — QRIS is Indonesian and a PH customer cannot
// scan it. Rendered rather than static so the wrong rail is never selectable,
// and shimmered until the currency is known so the Indonesian set never flashes.
const METHOD_LABELS = {
    qris: 'QRIS', va: 'Virtual Account', card: 'Card',
    invoice: 'Invoice', bank_transfer: 'Bank Transfer'
};

function renderPaymentMethods() {
    const host = $('payment-methods');
    if (!host) return;
    if (!currencyReady) {
        host.innerHTML = '<span class="amount-pending" style="width:7rem;height:2.5rem">&nbsp;</span>';
        // The markup ships with the QRIS panel visible. Leaving it up during the
        // wait shows Indonesian payment copy to a peso customer — the same leak
        // as the rupiah figures, just in prose.
        document.querySelectorAll('[data-payment-panel]').forEach((p) => p.classList.add('hidden'));
        return;
    }
    const methods = (PAYMENT_INSTRUCTIONS[priceCurrency()] || PAYMENT_INSTRUCTIONS.IDR).methods;
    if (!methods.includes(selectedMethod)) selectedMethod = methods[0];
    host.innerHTML = methods.map((m) => (
        `<button class="method-button${m === selectedMethod ? ' active' : ''}" type="button" data-method="${m}">${escapeHtml(METHOD_LABELS[m] || m)}</button>`
    )).join('');
    host.querySelectorAll('[data-method]').forEach((button) => {
        button.addEventListener('click', () => {
            selectedMethod = button.dataset.method;
            renderPaymentMethods();
            syncPaymentPanels();
        });
    });
    syncPaymentPanels();
}

// A panel only exists for the rails the markup ships; an unmatched method simply
// shows none, which is correct for bank_transfer (its instructions live in the
// settlement note under the total).
function syncPaymentPanels() {
    document.querySelectorAll('[data-payment-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.paymentPanel !== selectedMethod);
    });
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
    paintMoney($('summary-total'), money(calculation.totalAmount));
    renderSettlementNote();
    $('summary-plan-name').textContent = plan.name;
    paintMoney($('summary-plan-price'), `${money(calculation.monthlyDisplayAmount)}/mo`);
    $('summary-plan-desc').textContent = plan.description;
    const tax = billingTaxFor(priceCurrency());
    // The sentence itself is currency-independent; only the trailing tax clause
    // is. Render the sentence immediately and append the clause once the
    // currency lands, rather than shimmering a whole line of copy into a stub.
    $('summary-copy').textContent = `You will be billed ${selectedBilling === 'annually' ? 'annually' : 'monthly'} for FluxyOS ${plan.name}.`
        + (currencyReady && tax.rate > 0 ? ` Estimated ${tax.label} is shown before payment.` : '');
    $('summary-benefits').innerHTML = plan.benefits.map((benefit) => `<li><span class="summary-tick">&#10003;</span><span>${escapeHtml(benefit)}</span></li>`).join('');
    paintMoney($('subtotal'), money(calculation.subtotalAmount));
    $('discount').textContent = selectedBilling === 'annually' ? `Save ${annualSavingsPercent(plan)}%` : 'Not applied';
    paintMoney($('tax'), money(calculation.estimatedTaxAmount));
    // PPN is Indonesian VAT on an Indonesian seller's invoice. When it is not
    // Every billing currency carries a tax: Indonesia PPN 11%, Philippines VAT
    // 12% on digital services. The LABEL and rate follow the currency — a Manila
    // client should never read the word PPN.
    // The label flashes PPN -> VAT exactly like the figures do, so it waits too.
    document.querySelectorAll('[data-tax-label]').forEach((el) => {
        paintMoney(el, `Estimated ${tax.label}`);
    });
    document.querySelectorAll('[data-tax-note]').forEach((el) => {
        paintMoney(el, `${tax.label} estimate uses an effective ${tax.rate}% calculation on digital services.`);
    });
    paintMoney($('total-due'), money(calculation.totalAmount));
    paintMoney($('checkout-payable-total'), money(calculation.totalAmount));
    paintMoney($('monthly-label'), `${money(planPrice(plan.id, priceCurrency()).monthly)}/month`);
    paintMoney($('annual-label'), `${money(planPrice(plan.id, priceCurrency()).annualMonthlyEquivalent)}/month`);
    renderVoucherState(calculation);
    renderPlanOptions();
    renderPaymentMethods();
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
    document.addEventListener('fluxy:workspace-ready', () => {
        revealAmounts();
        updateCheckout();
    });
}

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
