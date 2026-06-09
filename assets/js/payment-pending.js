import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { formatIDR, QRIS_PAYMENT_INFO } from "./billing-config.js";

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
const $ = (id) => document.getElementById(id);
const fmtDate = (ts) => ts?.toDate?.()?.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) || 'Not available';
const labels = { qris: 'QRIS', va: 'Virtual Account', card: 'Card', invoice: 'Invoice', bank_transfer: 'Bank transfer', manual: 'Manual verification' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const PROOF_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const SUCCESS_REDIRECT_DELAY_MS = 3400;
const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000; // QRIS payment is valid for 24 hours

let currentUser = null;
let pendingProofFile = null;
let unsubscribeInternalStatus = null;
let redirectTimer = null;
let redirectScheduled = false;
let countdownTimer = null;

const requestIdParam = new URLSearchParams(window.location.search).get('requestId');

const authTimeout = setTimeout(() => window.location.replace('/login'), 2500);
onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    currentUser = user;
    try {
        await refreshStatus();
        startInternalStatusListener(user.uid);
    } catch (_) {
        renderError();
    }
});

window.addEventListener('beforeunload', () => {
    stopInternalStatusListener();
    cancelDashboardRedirect();
    stopCountdown();
});

function showView(view) {
    $('qris-view').classList.toggle('hidden', view !== 'qris');
    $('status-view').classList.toggle('hidden', view !== 'status');
}

async function loadStatusSnapshot() {
    const [subscription, request, reviewReason] = await Promise.all([
        data.ensureBillingSubscription(currentUser.uid),
        requestIdParam
            ? data.getPaymentRequestById(currentUser.uid, requestIdParam)
            : data.getLatestPaymentRequestWithLegacyFallback(currentUser.uid),
        data.getBillingReviewReason(currentUser.uid)
    ]);
    return { subscription, request, reviewReason };
}

async function refreshStatus() {
    if (!currentUser?.uid) return;
    const { subscription, request, reviewReason } = await loadStatusSnapshot();
    route(subscription, request, reviewReason);
}

function startInternalStatusListener(userId) {
    stopInternalStatusListener();
    unsubscribeInternalStatus = data.subscribeInternalUser(userId, async (internalUser) => {
        if (!internalUser || !currentUser?.uid) return;
        const status = internalUser.payment_status;
        const access = internalUser.access_status;
        const shouldRefresh = ['pending', 'submitted', 'under_review', 'verified', 'rejected'].includes(status)
            || ['payment_pending', 'payment_submitted', 'payment_verified', 'active', 'suspended'].includes(access);
        if (!shouldRefresh) return;
        try {
            await refreshStatus();
        } catch (err) {
            console.warn('[payment-pending] live status refresh skipped', err?.code || err);
        }
    }, (err) => console.warn('[payment-pending] live status listener skipped', err?.code || err));
}

function stopInternalStatusListener() {
    if (typeof unsubscribeInternalStatus === 'function') {
        unsubscribeInternalStatus();
    }
    unsubscribeInternalStatus = null;
}

function route(subscription, request, reviewReason) {
    const requestStatus = request?.payment_status;
    if (subscription?.status === 'active'
        || requestStatus === 'verified'
        || subscription?.status === 'payment_failed'
        || requestStatus === 'failed'
        || requestStatus === 'expired') {
        render(subscription, request, reviewReason);
        return;
    }
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
    cancelDashboardRedirect();
    setSuccessMode(false);
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

    const plan = ['core', 'growth', 'enterprise'].includes(request.plan_id) ? request.plan_id : 'growth';
    const billing = ['monthly', 'annually'].includes(request.billing_frequency) ? request.billing_frequency : 'annually';
    $('qris-back-checkout').href = `/checkout?plan=${plan}&billing=${billing}`;

    bindQrisActions(request);
    startCountdown(request);
}

/* 24-hour QRIS payment window countdown shown at the top of the QR card.
   Prefers an explicit expires_at if present, otherwise counts down from the
   request's creation time + 24h. */
function resolvePaymentDeadlineMs(request) {
    const expiresMs = request?.expires_at?.toMillis?.();
    if (Number.isFinite(expiresMs) && expiresMs > 0) return expiresMs;
    const createdMs = request?.created_at?.toMillis?.() ?? request?.submitted_at?.toMillis?.();
    const startMs = Number.isFinite(createdMs) && createdMs > 0 ? createdMs : Date.now();
    return startMs + PAYMENT_WINDOW_MS;
}

function startCountdown(request) {
    stopCountdown();
    const box = $('qris-countdown');
    const label = $('qris-countdown-label');
    const value = $('qris-countdown-value');
    if (!box || !label || !value) return;
    const deadlineMs = resolvePaymentDeadlineMs(request);
    const pad = (n) => String(n).padStart(2, '0');

    const tick = () => {
        const remaining = deadlineMs - Date.now();
        if (remaining <= 0) {
            stopCountdown();
            box.classList.add('is-expired');
            label.textContent = 'Payment window expired';
            value.textContent = '00:00:00';
            const confirmBtn = $('confirm-paid-btn');
            const submitBtn = $('submit-verify-btn');
            if (confirmBtn) confirmBtn.disabled = true;
            if (submitBtn) submitBtn.disabled = true;
            return;
        }
        const totalSec = Math.floor(remaining / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        box.classList.remove('is-expired');
        label.textContent = 'Complete payment within';
        value.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
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
                const uploaded = await data.uploadDocument(currentUser.uid, pendingProofFile, { bypassPlanLimit: true });
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

    /* Cancel payment → confirm in a modal → void the request, revert to trial,
       and return the user to plan selection. */
    const cancelBtn = $('cancel-payment-btn');
    const modal = $('cancel-modal');
    const modalBackdrop = $('cancel-modal-backdrop');
    const modalKeep = $('cancel-modal-keep');
    const modalConfirm = $('cancel-modal-confirm');
    const modalError = $('cancel-modal-error');

    function onCancelModalKeydown(event) {
        if (event.key === 'Escape' && !modalConfirm.disabled) closeCancelModal();
    }
    const closeCancelModal = () => {
        modal.classList.add('hidden');
        modalError.classList.add('hidden');
        modalError.textContent = '';
        modalConfirm.disabled = false;
        modalKeep.disabled = false;
        modalConfirm.textContent = 'Yes, cancel payment';
        document.removeEventListener('keydown', onCancelModalKeydown);
    };
    const openCancelModal = () => {
        modal.classList.remove('hidden');
        document.addEventListener('keydown', onCancelModalKeydown);
        modalKeep.focus();
    };

    cancelBtn.onclick = openCancelModal;
    modalKeep.onclick = closeCancelModal;
    modalBackdrop.onclick = () => { if (!modalConfirm.disabled) closeCancelModal(); };
    modalConfirm.onclick = async () => {
        if (modalConfirm.disabled) return;
        if (!currentUser?.uid) {
            modalError.textContent = 'Your session is still loading. Please try again.';
            modalError.classList.remove('hidden');
            return;
        }
        modalConfirm.disabled = true;
        modalKeep.disabled = true;
        modalConfirm.textContent = 'Canceling...';
        modalError.classList.add('hidden');
        try {
            await data.cancelPaymentRequest(currentUser.uid, request.id);
            stopCountdown();
            stopInternalStatusListener();
            window.location.replace('/pricing');
        } catch (_) {
            modalConfirm.disabled = false;
            modalKeep.disabled = false;
            modalConfirm.textContent = 'Yes, cancel payment';
            modalError.textContent = 'We could not cancel the payment. Please try again.';
            modalError.classList.remove('hidden');
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

function setSuccessMode(enabled) {
    document.querySelector('.status-shell')?.classList.toggle('is-success', enabled);
    $('status-success-icon')?.classList.toggle('hidden', !enabled);
}

function cancelDashboardRedirect() {
    if (redirectTimer) clearTimeout(redirectTimer);
    redirectTimer = null;
    redirectScheduled = false;
}

function scheduleDashboardRedirect() {
    if (redirectScheduled) return;
    redirectScheduled = true;
    redirectTimer = setTimeout(() => {
        window.location.replace('/dashboard');
    }, SUCCESS_REDIRECT_DELAY_MS);
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
    stopCountdown();
    showView('status');
    renderMeta(request);
    const requestStatus = request?.payment_status;
    if (subscription?.status === 'active' || requestStatus === 'verified') {
        setSuccessMode(true);
        setContent({
            pill: 'Payment verified',
            title: 'Payment confirmed',
            body: `Your ${request?.plan_name || subscription?.plan_name || 'FluxyOS'} package is active. We are opening your dashboard now.`,
            helper: 'Redirecting automatically in a few seconds.',
            primaryLabel: 'Open dashboard now',
            primaryHref: '/dashboard',
            showSupport: false
        });
        scheduleDashboardRedirect();
        return;
    }
    cancelDashboardRedirect();
    setSuccessMode(false);
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
