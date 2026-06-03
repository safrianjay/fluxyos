import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { formatIDR, QRIS_PAYMENT_INFO } from "./billing-config.js";

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
const $ = (id) => document.getElementById(id);
const fmtDate = (ts) => ts?.toDate?.()?.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) || 'Not available';
const labels = { qris: 'QRIS', va: 'Virtual Account', card: 'Card', invoice: 'Invoice', bank_transfer: 'Bank transfer', manual: 'Manual verification' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const PROOF_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

let currentUser = null;
let pendingProofFile = null;

const requestIdParam = new URLSearchParams(window.location.search).get('requestId');

const authTimeout = setTimeout(() => window.location.replace('/login'), 2500);
onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    currentUser = user;
    try {
        const [subscription, request, reviewReason] = await Promise.all([
            data.ensureBillingSubscription(user.uid),
            requestIdParam
                ? data.getPaymentRequestById(user.uid, requestIdParam)
                : data.getLatestPaymentRequestWithLegacyFallback(user.uid),
            data.getBillingReviewReason(user.uid)
        ]);
        route(subscription, request, reviewReason);
    } catch (_) {
        renderError();
    }
});

function showView(view) {
    $('qris-view').classList.toggle('hidden', view !== 'qris');
    $('status-view').classList.toggle('hidden', view !== 'status');
}

function route(subscription, request, reviewReason) {
    if (request?.payment_status === 'awaiting_payment') {
        renderQris(request);
        return;
    }
    render(subscription, request, reviewReason);
}

/* ---------------- QRIS payment screen (awaiting_payment) ---------------- */

function billingLabel(frequency) {
    return frequency === 'annually' ? 'Annual billing' : 'Monthly billing';
}

function renderQris(request) {
    showView('qris');
    const amount = formatIDR(request.total_amount);
    $('qris-amount').textContent = amount;
    $('qris-plan-name').textContent = request.plan_name || 'FluxyOS plan';
    $('qris-plan-billing').textContent = billingLabel(request.billing_frequency);
    $('qris-plan-copy').textContent = `Scan to pay for FluxyOS ${request.plan_name || 'plan'}. Your package activates only after we verify the payment.`;

    $('qris-detail-amount').textContent = amount;
    $('qris-detail-plan').textContent = request.plan_name || 'FluxyOS plan';
    $('qris-detail-billing').textContent = request.billing_frequency === 'annually' ? 'Annually' : 'Monthly';
    $('qris-detail-id').textContent = request.id || '—';

    $('qris-image').src = QRIS_PAYMENT_INFO.imagePath;
    $('qris-image').alt = `QRIS payment QR code for ${QRIS_PAYMENT_INFO.merchantName}`;
    $('qris-merchant').textContent = 'Scan with any QRIS-enabled bank or e-wallet app';
    $('qris-bank-name').textContent = QRIS_PAYMENT_INFO.recipientName;
    $('qris-bank-bank').textContent = QRIS_PAYMENT_INFO.bankName;
    $('qris-bank-number').textContent = QRIS_PAYMENT_INFO.referenceNumber;

    const plan = ['core', 'growth', 'enterprise'].includes(request.plan_id) ? request.plan_id : 'growth';
    const billing = ['monthly', 'annually'].includes(request.billing_frequency) ? request.billing_frequency : 'annually';
    $('qris-back-checkout').href = `/checkout?plan=${plan}&billing=${billing}`;

    bindQrisActions(request);
}

function bindQrisActions(request) {
    const confirmBtn = $('confirm-paid-btn');
    const verifyStage = $('qris-stage-verify');
    const submitBtn = $('submit-verify-btn');
    const fileInput = $('proof-file');
    const proofName = $('proof-name');
    const proofRemove = $('proof-remove');
    const errorEl = $('qris-error');

    const showError = (message) => {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    };
    const clearError = () => {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    };

    confirmBtn.onclick = () => {
        verifyStage.classList.remove('hidden');
        verifyStage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    fileInput.onchange = () => {
        clearError();
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!PROOF_ALLOWED_MIME.includes(file.type)) {
            fileInput.value = '';
            pendingProofFile = null;
            resetProofUi();
            showError('Use a JPG, PNG, WebP, or PDF file.');
            return;
        }
        if (file.size > PROOF_MAX_BYTES) {
            fileInput.value = '';
            pendingProofFile = null;
            resetProofUi();
            showError('File is larger than 5 MB.');
            return;
        }
        pendingProofFile = file;
        proofName.textContent = file.name;
        proofRemove.classList.remove('hidden');
    };

    proofRemove.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.value = '';
        pendingProofFile = null;
        resetProofUi();
        clearError();
    };

    function resetProofUi() {
        proofName.textContent = 'Choose an image or PDF';
        proofRemove.classList.add('hidden');
    }

    submitBtn.onclick = async () => {
        if (submitBtn.disabled) return;
        clearError();
        if (!currentUser?.uid) {
            showError('Your session is still loading. Please try again.');
            return;
        }
        submitBtn.disabled = true;
        confirmBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        try {
            let proof = {};
            if (pendingProofFile) {
                const uploaded = await data.uploadDocument(currentUser.uid, pendingProofFile);
                await data.addDocumentMetadata(currentUser.uid, uploaded.documentId, {
                    file_name: uploaded.fileName,
                    file_mime_type: uploaded.fileMimeType,
                    file_size: uploaded.fileSize,
                    storage_path: uploaded.storagePath,
                    document_role: 'payment_proof',
                    source_context: 'payment',
                    upload_status: 'uploaded'
                });
                proof = { proofDocumentId: uploaded.documentId, proofFileName: uploaded.fileName };
            }
            await data.submitPaymentRequestForVerification(currentUser.uid, request.id, proof);
            pendingProofFile = null;
            render(
                { status: 'pending_verification', plan_name: request.plan_name, plan_id: request.plan_id, billing_frequency: request.billing_frequency },
                { ...request, payment_status: 'pending_verification' }
            );
        } catch (_) {
            submitBtn.disabled = false;
            confirmBtn.disabled = false;
            submitBtn.textContent = 'Submit for verification';
            showError('We could not submit your confirmation. Please try again.');
        }
    };
}

/* ---------------- Status card (pending / active / failed / empty) ---------------- */

function retryUrl(subscription, request) {
    const plan = ['core', 'growth', 'enterprise'].includes(request?.plan_id || subscription?.plan_id) ? (request?.plan_id || subscription?.plan_id) : 'growth';
    const billing = ['monthly', 'annually'].includes(request?.billing_frequency || subscription?.billing_frequency) ? (request?.billing_frequency || subscription?.billing_frequency) : 'annually';
    return `/checkout?plan=${plan}&billing=${billing}`;
}

function setContent({ pill, title, body, helper = '', primaryLabel = 'Go to Dashboard', primaryHref = '/dashboard', showSupport = true, secondaryLabel = null, secondaryHref = null }) {
    $('status-pill').textContent = pill;
    $('status-title').textContent = title;
    $('status-body').textContent = body;
    $('status-helper').textContent = helper;
    $('status-helper').classList.toggle('hidden', !helper);
    $('primary-action').textContent = primaryLabel;
    $('primary-action').href = primaryHref;
    const secondary = $('secondary-action');
    if (secondaryLabel && secondaryHref) {
        secondary.textContent = secondaryLabel;
        secondary.href = secondaryHref;
        secondary.classList.remove('hidden');
    } else {
        secondary.textContent = 'Contact support';
        secondary.href = 'mailto:support@fluxyos.com?subject=FluxyOS%20payment%20support';
        secondary.classList.toggle('hidden', !showSupport);
    }
}

function renderMeta(request) {
    const meta = $('status-meta');
    if (!request) {
        meta.classList.add('hidden');
        return;
    }
    meta.innerHTML = `
        <div class="meta-row"><dt>Package</dt><dd>${escapeHtml(request.plan_name || 'FluxyOS plan')}</dd></div>
        <div class="meta-row"><dt>Billing</dt><dd>${request.billing_frequency === 'annually' ? 'Annually' : 'Monthly'}</dd></div>
        <div class="meta-row"><dt>Total</dt><dd>${formatIDR(request.total_amount)}</dd></div>
        <div class="meta-row"><dt>Method</dt><dd>${labels[request.payment_method] || 'Manual verification'}</dd></div>
        <div class="meta-row"><dt>Submitted</dt><dd>${fmtDate(request.submitted_for_verification_at || request.submitted_at || request.created_at)}</dd></div>
    `;
    meta.classList.remove('hidden');
}

function render(subscription, request, reviewReason) {
    showView('status');
    renderMeta(request);
    const requestStatus = request?.payment_status;
    if (subscription?.status === 'active' || requestStatus === 'verified') {
        setContent({
            pill: 'Payment verified',
            title: 'Your FluxyOS plan is active',
            body: `Your ${request?.plan_name || subscription?.plan_name || 'FluxyOS'} package is active. You can continue using your workspace.`
        });
        return;
    }
    if (requestStatus === 'failed' || requestStatus === 'expired' || subscription?.status === 'payment_failed') {
        setContent({
            pill: 'Payment needs attention',
            title: 'Payment could not be verified',
            body: 'Your payment was reviewed and could not be verified. Please complete the payment again to keep using FluxyOS after your trial ends.',
            helper: reviewReason ? `Reason from our team: ${reviewReason}` : '',
            primaryLabel: 'Complete payment again',
            primaryHref: retryUrl(subscription, request),
            secondaryLabel: 'Back to dashboard',
            secondaryHref: '/dashboard'
        });
        return;
    }
    if (request && (requestStatus === 'pending_verification' || subscription?.status === 'pending_verification')) {
        setContent({
            pill: 'Pending verification',
            title: 'Payment verification in progress',
            body: `We received your payment confirmation for ${request.plan_name || subscription?.plan_name || 'your FluxyOS plan'}. Our team will verify the payment manually and activate your FluxyOS plan after confirmation.`,
            helper: 'You can continue using FluxyOS during your trial while we verify your payment.'
        });
        return;
    }
    setContent({
        pill: 'No request found',
        title: 'No pending payment found',
        body: 'Choose a FluxyOS package to start a new payment request.',
        primaryLabel: 'Back to pricing',
        primaryHref: '/pricing'
    });
}

function renderError() {
    showView('status');
    setContent({
        pill: 'Could not load status',
        title: 'We could not load your payment status',
        body: 'Please refresh the page or contact support if the issue continues.'
    });
}
