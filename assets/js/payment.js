// FluxyOS — Payment page logic (manual bank-transfer proof submission).
// Auth-guarded. Reads billing access + latest payment verification, renders the
// right state (form / under review / rejected / verified), and submits proof via
// the shared FluxyDocumentAttachment uploader + DataService.submitPaymentVerification.
// Does NOT auto-activate — internal verification is required. See
// docs/TRIAL_ACCESS_AND_PAYMENT_BANNER_PLAN.md §21–§22.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import DataService from "./db-service.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
    measurementId: "G-ZN7J6DRD2L"
};

// Static MVP pricing — no payment gateway / plan engine yet (plan §28).
const PLAN = { plan_id: 'starter', name: 'Starter', amount: 199000, billing_period: 'monthly' };

const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

let currentUser = null;
let proofUploader = null;

const $ = (id) => document.getElementById(id);
const fmtRp = (n) => 'Rp ' + (Math.abs(Number(n) || 0)).toLocaleString('id-ID');
const fmtDate = (ts) => {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
    return d ? d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
};

const authTimeout = setTimeout(() => window.location.replace('/login'), 2500);

onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    clearTimeout(authTimeout);
    currentUser = user;
    init();
});

async function init() {
    $('plan-name').textContent = PLAN.name;
    $('plan-amount').textContent = fmtRp(PLAN.amount);
    $('transfer-reference').textContent = 'FLX-' + currentUser.uid.slice(0, 6).toUpperCase();
    $('amount-paid').value = String(PLAN.amount);

    let access = null;
    let latest = null;
    try {
        access = await ds.getBillingAccess(currentUser.uid);
        latest = await ds.getLatestPaymentVerification(currentUser.uid);
    } catch (e) {
        console.warn('[payment] status read failed');
    }

    renderStatus(access, latest);
}

function renderStatus(access, latest) {
    const accessStatus = access?.access_status || null;
    const paymentStatus = access?.payment_status || latest?.status || null;
    const isActive = accessStatus === 'active' || accessStatus === 'payment_verified' || paymentStatus === 'verified';
    const isRejected = paymentStatus === 'rejected';
    const isUnderReview = !isActive && !isRejected && (accessStatus === 'payment_submitted' || paymentStatus === 'submitted' || paymentStatus === 'under_review');

    if (isActive) {
        showStatusStrip('info', 'Workspace active', 'Your payment is verified and your FluxyOS workspace is fully unlocked.');
        showResult('Payment verified', 'Thanks — your account is active. You have full access to FluxyOS.', latest);
        return;
    }
    if (isUnderReview) {
        showStatusStrip('info', 'Payment submitted · Under review', 'Your payment proof is being reviewed. We’ll unlock your workspace after verification.');
        showResult('Payment under review', 'We’ve received your payment proof. Our team verifies payments manually — you’ll get access as soon as it’s confirmed.', latest);
        return;
    }
    if (isRejected) {
        showStatusStrip('warn', 'Payment needs revision', latest?.reviewer_note ? `Reviewer note: ${latest.reviewer_note}` : 'Your payment could not be verified. Please upload a valid proof or contact support.');
        showForm();
        return;
    }
    // Trial active / expiring / expired, or payment not started → show the form.
    if (accessStatus === 'trial_expired') {
        showStatusStrip('warn', 'Trial ended', 'Your data is safe, but FluxyOS is locked until payment is completed.');
    } else if (access && access.trial_ends_at) {
        showStatusStrip('clock', 'Complete payment to keep access', 'Pay anytime to keep your workspace after your trial ends.');
    } else {
        showStatusStrip('clock', 'Complete payment', 'Submit your bank-transfer proof below to activate your workspace.');
    }
    showForm();
}

function showStatusStrip(variant, title, body) {
    $('payment-status-title').textContent = title;
    $('payment-status-body').textContent = body;
    const iconWrap = $('payment-status-icon');
    if (variant === 'warn') {
        iconWrap.className = 'w-10 h-10 flex-shrink-0 rounded-lg bg-amber-50 text-amber-600 inline-flex items-center justify-center';
        iconWrap.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else if (variant === 'info') {
        iconWrap.className = 'w-10 h-10 flex-shrink-0 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center';
        iconWrap.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    } else {
        iconWrap.className = 'w-10 h-10 flex-shrink-0 rounded-lg bg-orange-50 text-[#EA580C] inline-flex items-center justify-center';
        iconWrap.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    }
}

function showResult(title, body, latest) {
    $('payment-form-section').classList.add('hidden');
    const section = $('payment-result-section');
    section.classList.remove('hidden');
    $('payment-result-title').textContent = title;
    $('payment-result-body').textContent = body;
    const meta = $('payment-result-meta');
    if (latest) {
        meta.innerHTML = `
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Amount</dt><dd class="font-semibold" style="font-family:'Fira Code',monospace;">${fmtRp(latest.amount)}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Submitted</dt><dd class="font-semibold">${fmtDate(latest.submitted_at || latest.created_at)}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Proof</dt><dd class="font-semibold truncate max-w-[60%]">${escapeHtml(latest.proof_file_name || '—')}</dd></div>
        `;
    } else {
        meta.innerHTML = '';
    }
}

function showForm() {
    $('payment-result-section').classList.add('hidden');
    $('payment-form-section').classList.remove('hidden');
    mountUploader();
    wireForm();
}

function mountUploader() {
    if (proofUploader || !window.FluxyDocumentAttachment) return;
    proofUploader = window.FluxyDocumentAttachment.mount({
        hostEl: $('payment-proof-host'),
        role: 'payment_proof',
        sourceContext: 'payment'
    });
    // Re-evaluate the submit button when the file selection changes.
    $('payment-proof-host').addEventListener('change', refreshSubmitState);
    $('payment-proof-host').addEventListener('click', () => setTimeout(refreshSubmitState, 0));
}

function parseAmount(value) {
    return parseInt(String(value || '').replace(/\D/g, ''), 10) || 0;
}

function wireForm() {
    const amountInput = $('amount-paid');
    amountInput.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '');
        e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
        refreshSubmitState();
    });
    // Normalise the prefilled default once.
    amountInput.value = Number(PLAN.amount).toLocaleString('id-ID');

    $('payment-submit-btn').addEventListener('click', onSubmit);
    refreshSubmitState();
}

function refreshSubmitState() {
    const amount = parseAmount($('amount-paid').value);
    const hasProof = !!(proofUploader && proofUploader.getPendingFile());
    $('payment-submit-btn').disabled = !(amount > 0 && hasProof);
}

function showError(message) {
    const el = $('payment-form-error');
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearError() {
    $('payment-form-error').classList.add('hidden');
}

async function onSubmit() {
    clearError();
    const amount = parseAmount($('amount-paid').value);
    const file = proofUploader?.getPendingFile();
    if (!(amount > 0)) { showError('Enter the amount you paid.'); return; }
    if (!file) { showError('Upload your transfer proof.'); return; }

    const btn = $('payment-submit-btn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Submitting…';

    try {
        const uploaded = await window.FluxyDocumentAttachment.prepareAttachmentForNewRecord({
            ds, userId: currentUser.uid, file,
            role: 'payment_proof', sourceContext: 'payment', Timestamp
        });
        await ds.submitPaymentVerification(currentUser.uid, {
            amount,
            plan_id: PLAN.plan_id,
            billing_period: PLAN.billing_period,
            payment_method: 'bank_transfer',
            proof_document_id: uploaded.documentId,
            proof_file_name: file.name,
            submitted_note: $('payment-note').value
        });
        window.showToast?.('Payment proof submitted. We’ll verify it shortly.', 'success');
        const latest = await ds.getLatestPaymentVerification(currentUser.uid).catch(() => null);
        showStatusStrip('info', 'Payment submitted · Under review', 'Your payment proof is being reviewed. We’ll unlock your workspace after verification.');
        showResult('Payment under review', 'We’ve received your payment proof. Our team verifies payments manually — you’ll get access as soon as it’s confirmed.', latest);
    } catch (e) {
        console.warn('[payment] submit failed', e?.message || e);
        showError('We couldn’t submit your payment. Please check your file and try again.');
        btn.disabled = false;
        btn.textContent = original;
    }
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
