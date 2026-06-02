import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import DataService from "./db-service.js";
import { formatIDR } from "./billing-config.js";

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

const authTimeout = setTimeout(() => window.location.replace('/login'), 2500);
onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    try {
        const [subscription, request] = await Promise.all([
            data.ensureBillingSubscription(user.uid),
            data.getLatestPaymentRequestWithLegacyFallback(user.uid)
        ]);
        render(subscription, request);
    } catch (_) {
        renderError();
    }
});

function retryUrl(subscription, request) {
    const plan = ['core', 'growth', 'enterprise'].includes(request?.plan_id || subscription?.plan_id) ? (request?.plan_id || subscription?.plan_id) : 'growth';
    const billing = ['monthly', 'annually'].includes(request?.billing_frequency || subscription?.billing_frequency) ? (request?.billing_frequency || subscription?.billing_frequency) : 'annually';
    return `/checkout?plan=${plan}&billing=${billing}`;
}

function setContent({ pill, title, body, helper = '', primaryLabel = 'Go to Dashboard', primaryHref = '/dashboard', showSupport = true }) {
    $('status-pill').textContent = pill;
    $('status-title').textContent = title;
    $('status-body').textContent = body;
    $('status-helper').textContent = helper;
    $('status-helper').classList.toggle('hidden', !helper);
    $('primary-action').textContent = primaryLabel;
    $('primary-action').href = primaryHref;
    $('secondary-action').classList.toggle('hidden', !showSupport);
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
        <div class="meta-row"><dt>Submitted</dt><dd>${fmtDate(request.submitted_at || request.created_at)}</dd></div>
    `;
    meta.classList.remove('hidden');
}

function render(subscription, request) {
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
            body: 'Please submit a new payment request to continue after your trial ends.',
            primaryLabel: 'Retry payment',
            primaryHref: retryUrl(subscription, request)
        });
        return;
    }
    if (request && (requestStatus === 'pending_verification' || subscription?.status === 'pending_verification')) {
        setContent({
            pill: 'Pending verification',
            title: 'Payment verification in progress',
            body: `We received your payment request for ${request.plan_name || subscription?.plan_name || 'your FluxyOS plan'}. Your payment is being verified. This usually takes a few minutes, but invoice or bank transfer payments may take longer.`,
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
    setContent({
        pill: 'Could not load status',
        title: 'We could not load your payment status',
        body: 'Please refresh the page or contact support if the issue continues.'
    });
}
