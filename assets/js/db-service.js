import { getFirestore, initializeFirestore, collection, query, where, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, limit, writeBatch, runTransaction, doc, Timestamp, arrayUnion, arrayRemove, onSnapshot, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { resolveDb } from "/assets/js/firestore-db.js";
import { BILLING_PLANS, calculateBilling, normalizeBillingFrequency, normalizePaymentMethod, normalizePlanId, getPlanLimits, resolveCheckoutPlanId, PLAN_DISPLAY_NAMES } from "./billing-config.js";
import { buildJournal, buildOpeningJournal, buildClosingJournal, buildReversalJournal, buildManualJournal, CHART_OF_ACCOUNTS_SEED, signedBalance, periodKey as acctPeriodKey } from "./accounting-engine.js";
import { buildTaxAppendix, TAX_RATES } from "./tax-engine.js";

// 3-day trial access & payment status enums (users/{uid}/billing/access).
// See docs/TRIAL_ACCESS_AND_PAYMENT_BANNER_PLAN.md and PROJECT_BACKGROUND §4k.
const TRIAL_DURATION_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_STATUSES = [
    'trial_not_started', 'trial_active', 'trial_expiring', 'trial_expired',
    'payment_pending', 'payment_submitted', 'payment_verified', 'active', 'suspended'
];
const BILLING_PAYMENT_STATUSES = [
    'not_started', 'pending', 'submitted', 'under_review', 'verified', 'rejected'
];
const BILLING_ACCOUNT_STATUSES = ['trial', 'active', 'suspended'];
// The open internal_users index uses its own (KYC-centric) payment enum that has
// no `not_started`; map/skip unsupported values when denormalizing.
const INTERNAL_PAYMENT_STATUSES = [
    'not_required', 'pending', 'submitted', 'under_review', 'verified', 'rejected', 'expired'
];
// Legacy self-heal: older clients mirrored the raw billing_subscription.status
// (`trialing`, `awaiting_payment`, …) straight into internal_users.access_status,
// which is NOT in ACCESS_STATUSES. Because the internal_users UPDATE rule
// re-validates the ENTIRE doc, such a stray value bricks every reviewer action on
// that user (permission-denied). This maps a billing status onto the internal
// access enum so the field can be corrected in-place; unknown → 'trial_active'.
const BILLING_TO_ACCESS_STATUS = {
    trialing: 'trial_active',
    awaiting_payment: 'payment_pending',
    pending_verification: 'payment_submitted',
    active: 'active',
    past_due: 'trial_expired',
    expired: 'trial_expired',
    payment_failed: 'payment_pending'
};

// ===== Accounting Center (Phase 1) =====
// Starter IDR-focused SMB chart-of-accounts catalog. Codes/names are strings
// only — these are display/mapping references, never financial values.
const ACCOUNTING_ACCOUNT_CATALOG = {
    '1100': { name: 'Accounts Receivable', type: 'asset' },
    '2000': { name: 'Accounts Payable', type: 'liability' },
    '4000': { name: 'Revenue', type: 'revenue' },
    '6100': { name: 'Marketing Expense', type: 'expense' },
    '6200': { name: 'Software / SaaS Expense', type: 'expense' },
    '6300': { name: 'Infrastructure Expense', type: 'expense' },
    '6400': { name: 'Operations Expense', type: 'expense' },
    '6500': { name: 'Tax Expense', type: 'expense' },
    '6600': { name: 'Bank Fees', type: 'expense' },
    '6999': { name: 'Other Expense', type: 'expense' }
};
// Built-in category → account code. Only these categories are considered
// confidently mappable by default; anything else (custom / "Others") is treated
// as unmapped until the user saves an explicit mapping.
const ACCOUNTING_CATEGORY_DEFAULTS = {
    'Revenue': '4000',
    'Marketing': '6100',
    'SaaS': '6200',
    'Infrastructure': '6300',
    'Operations': '6400'
};
// Transaction type → account code (used for non-category-driven types).
const ACCOUNTING_TYPE_DEFAULTS = {
    'income': '4000',
    'revenue': '4000',
    'refund': '4000',
    'fee': '6600',
    'tax': '6500',
    'pending_payable': '2000',
    'pending_receivable': '1100'
};
// Fallback suggestion for unmapped spend so the preview always shows a target.
const ACCOUNTING_UNMAPPED_FALLBACK_CODE = '6999';
// Per-bucket readiness penalty weights and the cap applied to each bucket so a
// single noisy bucket can never dominate the whole score.
const ACCOUNTING_PENALTY_WEIGHTS = {
    missing_receipt: 8,
    missing_category: 6,
    unmapped_account: 6,
    bill_missing_due_date: 8,
    bill_missing_invoice: 6,
    bank_import_needs_review: 10,
    subscription_missing_renewal_date: 6
};
const ACCOUNTING_PENALTY_CAP = 24;

// Income Statement Preview (Accounting Center) — transaction-type buckets.
// Revenue-side and operating-expense-side types mirror getDashboardStats /
// _calculateOverviewPerformance so the preview never disagrees with Overview.
const INCOME_STATEMENT_REVENUE_TYPES = ['income', 'revenue', 'refund', 'pending_receivable'];
const INCOME_STATEMENT_OPEX_TYPES = ['expense', 'fee', 'tax', 'pending_payable'];

class DataService {
    constructor(app) {
        this.app = app;
        // Force long polling so an ad/privacy blocker or proxy that breaks
        // Firestore's streaming WebChannel can't silently kill reads/writes. The
        // setting only sticks if applied on the FIRST Firestore access per app,
        // so every entry point shares resolveDb (see assets/js/firestore-db.js).
        this.db = resolveDb(app);
        this._storage = null;
        // The acting user's uid for audit attribution. In the workspace model the
        // scope id (workspaceId) is distinct from the actor (the signed-in user),
        // so pages call setActor(user.uid) once after auth. Audit/attribution
        // fields read this rather than the positional scope argument.
        this.actorUid = null;
        this.actorRole = null;
    }

    // Pin the acting user's uid (and optionally workspace role) for audit
    // attribution. Call once after auth; call again once the role resolves.
    setActor(uid, role = null) {
        this.actorUid = uid || null;
        if (role !== null) this.actorRole = role;
        return this;
    }

    // STAGE 2 scope resolver. Finance/operational collections route through this
    // so they live under workspaces/{scopeId} once the workspace data migration
    // has run, or under users/{scopeId} otherwise. The switch is the global flag
    // window.FLUXY_WORKSPACE_MODE (default OFF), so deploying this code changes
    // NOTHING until the flag is flipped post-migration. For an owner the scopeId
    // (passed by pages) equals their uid == their workspaceId, so owner behaviour
    // is byte-identical; teammates pass FluxyWorkspace.id. Identity collections
    // (billing/onboarding/settings/usage_limits/ai_chats) do NOT use this and stay
    // user-scoped. See docs/WORKSPACE_TEAM_MANAGEMENT_STAGE2.md.
    _workspaceMode() {
        return typeof window !== 'undefined' && window.FLUXY_WORKSPACE_MODE === true;
    }
    _scope(scopeId) {
        if (!this._workspaceMode()) return `users/${scopeId}`;
        // In workspace mode, target the resolved workspace: the owner's id for a
        // teammate (so they see the shared data), or the user's own id for an
        // owner. Prefer the live resolution, then the per-session cache (so reads
        // are correct immediately on cross-page navigation, before re-resolution),
        // then the passed scope id. Owner-safe (their uid == their workspaceId).
        let wsId = (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.id) || null;
        if (!wsId && typeof sessionStorage !== 'undefined') {
            try { const c = JSON.parse(sessionStorage.getItem('fluxy_ws') || 'null'); if (c && c.id) wsId = c.id; } catch (_) {}
        }
        return `workspaces/${wsId || scopeId}`;
    }

    // --- TRANSACTIONS (LEDGER) ---
    _isVoidedTransaction(record = {}) {
        return record?.is_voided === true || String(record?.status || '').trim().toLowerCase() === 'voided';
    }

    _activeTransactions(records = []) {
        return records.filter(record => !this._isVoidedTransaction(record));
    }

    _transactionAuditSnapshot(record = {}) {
        const keys = [
            'amount',
            'vendor_name',
            'category',
            'type',
            'status',
            'timestamp',
            'source',
            'receipt_url',
            'attached_documents',
            'is_voided',
            'voided_at',
            'voided_by',
            'void_reason',
            'updated_at',
            'updated_by'
        ];
        const out = {};
        keys.forEach(key => {
            if (record && record[key] !== undefined) out[key] = record[key] ?? null;
        });
        return out;
    }

    _normalizeTransactionPatch(patch = {}, existing = {}) {
        const payload = {};

        if (Object.prototype.hasOwnProperty.call(patch, 'amount')) {
            const amount = Math.round(Number(String(patch.amount).replace(/[^\d]/g, '')) || 0);
            if (amount <= 0) throw new Error('Amount must be greater than zero.');
            payload.amount = amount;
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'vendor_name')) {
            payload.vendor_name = this._stringOrDefault(patch.vendor_name, '', 160);
            if (!payload.vendor_name) throw new Error('Vendor / description is required.');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
            payload.category = this._stringOrDefault(patch.category, '', 40);
            if (!payload.category) throw new Error('Category is required.');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'type')) {
            payload.type = this._stringOrDefault(patch.type, String(existing.type || 'expense'), 40).toLowerCase().replace(/\s+/g, '_');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
            const allowedStatuses = ['Completed', 'Missing Receipt', 'Pending', 'Upcoming', 'Reconciled', 'Cancelled'];
            payload.status = this._allowedValue(patch.status, allowedStatuses, existing.status || 'Completed');
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'timestamp')) {
            payload.timestamp = this._coerceTimestampOrNow(patch.timestamp);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'date')) {
            payload.timestamp = this._coerceTimestampOrNow(patch.date);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'icon')) {
            payload.icon = this._stringOrDefault(patch.icon, existing.icon || '', 16);
        } else if (payload.type) {
            payload.icon = ['income', 'revenue', 'refund', 'pending_receivable'].includes(payload.type) ? '💰' : '💸';
        }

        payload.updated_at = serverTimestamp();
        return this._cleanDefined(payload);
    }

    async getTransactions(userId, limitCount = 50) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/transactions`),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return this._activeTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }

    async getRevenueTransactionsForDashboardStats(userId) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/transactions`),
            where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable'])
        );
        const snapshot = await getDocs(q);
        return this._activeTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }

    async getLedgerCashPosition(userId) {
        if (!userId) return { cashIn: 0, cashOut: 0, net: 0, recordCount: 0, _entries: [] };
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/transactions`),
                where('cash_effective', '==', true),
                limit(2000)
            );
            const snapshot = await getDocs(q);
            let cashIn = 0, cashOut = 0, count = 0;
            const entries = [];
            snapshot.forEach(d => {
                const data = d.data();
                if (data.is_voided) return;
                const amount = this._safeInteger(data.amount);
                const direction = data.cash_direction;
                if (direction !== 'in' && direction !== 'out') return;
                const ts = data.timestamp?.toDate?.() || data.cash_effective_at?.toDate?.();
                if (direction === 'in') cashIn += amount;
                else cashOut += amount;
                count++;
                entries.push({ direction, amount, tsMs: ts ? ts.getTime() : 0 });
            });
            return { cashIn, cashOut, net: cashIn - cashOut, recordCount: count, _entries: entries };
        } catch {
            return { cashIn: 0, cashOut: 0, net: 0, recordCount: 0, _entries: [] };
        }
    }

    async getTransactionsForDashboardOverview(userId, allTime = false) {
        if (!allTime) return this.getTransactions(userId, 1000);
        const q = query(
            collection(this.db, `${this._scope(userId)}/transactions`),
            orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(q);
        return this._activeTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }

    async getTransactionById(userId, transactionId) {
        if (!userId || !transactionId) throw new Error('userId and transactionId required');
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/transactions/${transactionId}`));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    }

    async updateTransaction(userId, transactionId, patch = {}, reason = 'Edited from ledger') {
        if (!userId || !transactionId) throw new Error('userId and transactionId required');
        const ref = doc(this.db, `${this._scope(userId)}/transactions/${transactionId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Transaction not found.');
        const existing = snap.data() || {};
        if (this._isVoidedTransaction(existing)) throw new Error('Voided transactions cannot be edited.');
        await this._assertEditablePeriod(userId, existing);

        const payload = this._normalizeTransactionPatch(patch, existing);
        payload.updated_by = userId;
        const after = { ...existing, ...payload };

        const batch = writeBatch(this.db);
        // Keep the ledger correct: reverse the old journal and repost from the
        // edited state (into an open period). Merge the new journal pointer into
        // the same source update — one write per doc per batch.
        const journalFields = await this._correctSourceJournal(userId, batch, 'transactions', ref, existing, after);
        Object.assign(payload, journalFields);
        batch.update(ref, payload);
        batch.set(doc(collection(this.db, `${this._scope(userId)}/audit_logs`)), {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'transaction.update',
            target_collection: 'transactions',
            target_id: transactionId,
            before: this._transactionAuditSnapshot(existing),
            after: this._transactionAuditSnapshot(after),
            reason: this._stringOrDefault(reason, 'Edited from ledger', 500),
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: transactionId, ...after };
    }

    async voidTransaction(userId, transactionId, reason) {
        if (!userId || !transactionId) throw new Error('userId and transactionId required');
        const cleanReason = this._stringOrDefault(reason, '', 500);
        if (!cleanReason) throw new Error('Void reason is required.');

        const ref = doc(this.db, `${this._scope(userId)}/transactions/${transactionId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Transaction not found.');
        const existing = snap.data() || {};
        if (this._isVoidedTransaction(existing)) throw new Error('Transaction is already voided.');
        await this._assertEditablePeriod(userId, existing);

        const payload = {
            is_voided: true,
            status: 'Voided',
            voided_at: serverTimestamp(),
            voided_by: (this.actorUid || userId),
            void_reason: cleanReason,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        };

        const batch = writeBatch(this.db);
        // Voiding reverses the document's journal (no repost) so the ledger and
        // trial balance no longer reflect the cancelled transaction.
        const journalFields = await this._correctSourceJournal(userId, batch, 'transactions', ref, existing, null);
        Object.assign(payload, journalFields);
        batch.update(ref, payload);
        batch.set(doc(collection(this.db, `${this._scope(userId)}/audit_logs`)), {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'transaction.void',
            target_collection: 'transactions',
            target_id: transactionId,
            before: this._transactionAuditSnapshot(existing),
            after: {
                is_voided: true,
                status: 'Voided',
                voided_by: (this.actorUid || userId),
                void_reason: cleanReason
            },
            reason: cleanReason,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: transactionId, ...existing, ...payload };
    }

    async updateTransactionCashImpact(userId, transactionId, payload, reason) {
        if (!userId || !transactionId) throw new Error('userId and transactionId required');
        const ref = doc(this.db, `${this._scope(userId)}/transactions/${transactionId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Transaction not found.');
        const existing = snap.data() || {};
        if (this._isVoidedTransaction(existing)) throw new Error('Voided transactions cannot be edited.');

        const CASH_SNAPSHOT_FIELDS = ['cash_effective', 'cash_status', 'cash_direction', 'cash_account_id', 'cash_match_status'];
        const before = {};
        CASH_SNAPSHOT_FIELDS.forEach(k => { before[k] = existing[k] ?? null; });

        // Only cash-impact fields are allowed in the update — never touch amount, type, etc.
        const update = {};
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_effective'))  update.cash_effective  = Boolean(payload.cash_effective);
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_status'))     update.cash_status     = String(payload.cash_status || 'none');
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_direction'))  update.cash_direction  = String(payload.cash_direction || 'none');
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_account_id')) update.cash_account_id = payload.cash_account_id || null;
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_match_status')) update.cash_match_status = payload.cash_match_status || null;
        if (Object.prototype.hasOwnProperty.call(payload, 'cash_effective_at')) update.cash_effective_at = payload.cash_effective_at || null;
        update.cash_assignment_reason    = this._stringOrDefault(reason, '', 500) || null;
        update.cash_assignment_updated_at = serverTimestamp();
        update.cash_assignment_updated_by = userId;
        update.updated_at = serverTimestamp();
        update.updated_by = userId;

        const after = {};
        CASH_SNAPSHOT_FIELDS.forEach(k => { after[k] = update[k] !== undefined ? update[k] : (existing[k] ?? null); });

        const batch = writeBatch(this.db);
        batch.update(ref, update);
        batch.set(doc(collection(this.db, `${this._scope(userId)}/audit_logs`)), {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'transaction.cash_impact_updated',
            target_collection: 'transactions',
            target_id: transactionId,
            before,
            after,
            reason: update.cash_assignment_reason,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: transactionId, ...existing, ...update };
    }

    async addTransaction(userId, data) {
        const { timestamp, ...rest } = data;
        const scope = this._scope(userId);
        const ref = doc(collection(this.db, `${scope}/transactions`));
        const payload = { ...rest, timestamp: timestamp || serverTimestamp(), created_at: serverTimestamp() };
        const batch = writeBatch(this.db);
        // Post the double-entry journal atomically with the transaction. Posting
        // never blocks the write — failures mark the row `pending` for a sweep.
        await this._postSourceJournal(userId, batch, 'transactions', ref, payload, { date: timestamp });
        batch.set(ref, payload);
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'transaction.create', 'transactions', ref.id, {
            amount: data.amount, vendor_name: data.vendor_name, category: data.category,
            type: data.type, status: data.status
        });
        return ref;
    }

    async addTransactions(userId, rows) {
        const batch = writeBatch(this.db);
        const txCollection = collection(this.db, `${this._scope(userId)}/transactions`);
        const uploadedAt = serverTimestamp();

        rows.forEach(row => {
            const { timestamp, ...rest } = row;
            batch.set(doc(txCollection), {
                ...rest,
                timestamp: timestamp || serverTimestamp(),
                created_at: uploadedAt,
                // Bulk imports don't post journals inline (would blow the 500-write
                // batch ceiling). Mark them pending so the Accounting Center sweep
                // (postPendingJournals) can post them in chunked batches afterward.
                accounting_status: 'pending'
            });
        });

        await batch.commit();
        // One summary entry per import (not per row) to avoid flooding the feed.
        await this._auditCreateBestEffort(userId, 'transaction.import', 'transactions', '', {
            count: Array.isArray(rows) ? rows.length : 0
        });
    }

    // --- BILLS ---
    async addBill(userId, data) {
        const { timestamp, ...rest } = data;
        const payload = {
            ...rest,
            timestamp: timestamp || serverTimestamp()
        };
        // Strip any null budget fields so an unmatched bill stays on the
        // legacy schema (Firestore rules allow these fields to be absent,
        // but only allow strings or omission — not literal `null`).
        ['budget_id', 'budget_allocation_id', 'budget_match_method', 'budget_match_status', 'budget_impact_status']
            .forEach((field) => { if (payload[field] == null) delete payload[field]; });
        const scope = this._scope(userId);
        const ref = doc(collection(this.db, `${scope}/bills`));
        const batch = writeBatch(this.db);
        // A bill accrues the expense now (Dr expense / Cr Accounts Payable). The
        // later "mark paid" creates a linked expense transaction that settles A/P.
        await this._postSourceJournal(userId, batch, 'bills', ref, payload, { date: data.due_date || timestamp });
        batch.set(ref, payload);
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'bill.create', 'bills', ref.id, {
            amount: data.amount, vendor_name: data.vendor_name, category: data.category,
            due_date: data.due_date, payment_status: data.payment_status
        });
        return ref;
    }

    async getBills(userId) {
        const q = query(collection(this.db, `${this._scope(userId)}/bills`), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Single-record fetch for universal record deep-linking — lets the Bills page
    // snap its date range to a linked bill that sits outside the current period.
    async getBillById(userId, billId) {
        if (!userId || !billId) throw new Error('userId and billId required');
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/bills/${billId}`));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    }

    // Mark a bill paid: unpaid -> paid, ONLY on explicit user confirmation. Mirrors
    // markInvoicePaid. Creates the linked expense ledger transaction (the bill's
    // amount/vendor/category, type 'expense' so it counts as actual_used), carries
    // the bill's existing budget assignment onto it (committed -> actual on the same
    // allocation), stamps the bill paid + converted_to_actual + linked_transaction_id,
    // and writes the audit log — all in one batch so a rules rejection leaves nothing
    // half-written. The bill drops out of budget *committed* totals (getBudgetUsage
    // skips converted_to_actual / linked bills), so there is no double count.
    // Paid is terminal: no un-pay path exists.
    async markBillPaid(userId, billId, { paymentDate = null, cashFields = null } = {}) {
        if (!userId || !billId) throw new Error('userId and billId required');
        const bill = await this.getBillById(userId, billId);
        if (!bill) throw new Error('Bill not found.');
        if (bill.payment_status === 'paid') throw new Error('This bill is already marked as paid.');
        const amount = Math.round(Math.abs(Number(bill.amount) || 0));
        if (!(amount > 0)) throw new Error('Bill amount must be greater than zero.');

        const txRef = doc(collection(this.db, `${this._scope(userId)}/transactions`));
        const transaction = {
            amount,
            vendor_name: bill.vendor_name || 'Bill',
            category: bill.category || 'Operations',
            type: 'expense',
            status: 'Completed',
            icon: '💸',
            timestamp: this._coerceTimestampOrNow(paymentDate),
            notes: `Payment for bill ${bill.vendor_name || billId}`,
            linked_bill_id: billId,
            created_at: serverTimestamp()
        };
        // Carry over the bill's explicit budget assignment so the actual spend lands
        // on the same allocation it was committed to. Category-only commitments need
        // no copy — resolveRecordAssignment re-matches the expense by category.
        if (bill.budget_match_status === 'excluded') {
            transaction.budget_id = bill.budget_id ?? null;
            transaction.budget_allocation_id = null;
            transaction.budget_match_method = 'excluded';
            transaction.budget_match_status = 'excluded';
        } else if (bill.budget_id && bill.budget_allocation_id) {
            transaction.budget_id = bill.budget_id;
            transaction.budget_allocation_id = bill.budget_allocation_id;
            transaction.budget_match_method = 'manual';
            transaction.budget_match_status = 'matched';
            transaction.budget_match_confidence = 1;
        }
        // Cash impact: default to actual cash-out; the caller may pass derived fields
        // (FluxyCashImpact.derive) to record the paying bank account / pending state.
        const cash = (cashFields && typeof cashFields === 'object') ? cashFields : {
            cash_effective: true,
            cash_status: 'actual',
            cash_direction: 'out',
            cash_account_id: null,
            cash_source: 'manual',
            cash_match_status: 'manual',
            cash_effective_at: transaction.timestamp
        };
        Object.assign(transaction, cash);

        const batch = writeBatch(this.db);
        // The linked payment carries linked_bill_id, so the engine posts BILL-PAY
        // (Dr Accounts Payable / Cr Cash) — settling the A/P the bill accrued at
        // creation rather than recognizing the expense a second time.
        await this._postSourceJournal(userId, batch, 'transactions', txRef, transaction, { date: transaction.timestamp });
        batch.set(txRef, transaction);
        batch.update(doc(this.db, `${this._scope(userId)}/bills/${billId}`), {
            payment_status: 'paid',
            budget_impact_status: 'converted_to_actual',
            linked_transaction_id: txRef.id,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        });
        batch.set(doc(collection(this.db, `${this._scope(userId)}/audit_logs`)), {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'bill.mark_paid',
            target_collection: 'bills',
            target_id: billId,
            before: { payment_status: bill.payment_status ?? 'unpaid', budget_impact_status: bill.budget_impact_status ?? null },
            after: { payment_status: 'paid', budget_impact_status: 'converted_to_actual', transaction_id: txRef.id, amount },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: billId, transactionId: txRef.id };
    }

    // --- SUBSCRIPTIONS ---
    async addSubscription(userId, data) {
        const { timestamp, ...rest } = data;
        const scope = this._scope(userId);
        const ref = doc(collection(this.db, `${scope}/subscriptions`));
        const payload = { ...rest, timestamp: timestamp || serverTimestamp() };
        const batch = writeBatch(this.db);
        await this._postSourceJournal(userId, batch, 'subscriptions', ref, payload, { date: data.renewal_date || timestamp });
        batch.set(ref, payload);
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'subscription.create', 'subscriptions', ref.id, {
            amount: data.amount, vendor_name: data.vendor_name, category: data.category,
            renewal_date: data.renewal_date
        });
        return ref;
    }

    async getSubscriptions(userId) {
        const q = query(collection(this.db, `${this._scope(userId)}/subscriptions`), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Single-record fetch for universal record deep-linking (mirrors getBillById).
    async getSubscriptionById(userId, subscriptionId) {
        if (!userId || !subscriptionId) throw new Error('userId and subscriptionId required');
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/subscriptions/${subscriptionId}`));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    }

    // --- SETTINGS ---
    async getUserSettings(userId) {
        const docIds = ['company', 'finance', 'import_rules', 'ai', 'whatsapp', 'email_preferences'];
        const entries = await Promise.all(docIds.map(async (docId) => {
            const snap = await getDoc(this._settingsDoc(userId, docId));
            return [docId, snap.exists() ? snap.data() : {}];
        }));

        const settings = entries.reduce((settings, [docId, data]) => {
            settings[docId] = { ...this._defaultSettings(docId), ...data };
            return settings;
        }, {});

        settings.reports = await this.getReportsSettings(userId);
        return settings;
    }

    async getReportsSettings(userId) {
        try {
            const snap = await getDoc(this._settingsDoc(userId, 'reports'));
            return { ...this._defaultSettings('reports'), ...(snap.exists() ? snap.data() : {}) };
        } catch (error) {
            console.warn('Could not load reports settings; using defaults.', error);
            return this._defaultSettings('reports');
        }
    }

    async saveReportsSettings(userId, data) {
        const allowedSources = ['none', 'tagged_income_categories'];
        const rawIds = Array.isArray(data.recurring_revenue_category_ids) ? data.recurring_revenue_category_ids : [];
        const cleanIds = rawIds
            .filter(v => typeof v === 'string')
            .map(v => v.trim())
            .filter(v => v.length > 0 && v.length <= 80)
            .slice(0, 32);
        const payload = this._cleanDefined({
            arr_source: allowedSources.includes(data.arr_source) ? data.arr_source : (cleanIds.length ? 'tagged_income_categories' : 'none'),
            recurring_revenue_category_ids: cleanIds,
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'reports'), payload, { merge: true });
        return payload;
    }

    async saveCompanySettings(userId, data) {
        const payload = this._cleanDefined({
            business_name: this._stringOrDefault(data.business_name, 'Global HQ', 120),
            business_type: this._stringOrDefault(data.business_type, '', 80),
            country: this._stringOrDefault(data.country, 'Indonesia', 80),
            entity_label: this._stringOrDefault(data.entity_label, 'Consolidated', 80),
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'company'), payload, { merge: true });
        return payload;
    }

    async saveFinanceSettings(userId, data) {
        const payload = this._cleanDefined({
            currency: 'IDR',
            locale: 'id-ID',
            timezone: this._allowedValue(data.timezone, ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'], 'Asia/Jakarta'),
            date_format: this._allowedValue(data.date_format, ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], 'DD MMM YYYY'),
            categories: this._normalizeCategories(data.categories),
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'finance'), payload, { merge: true });
        return payload;
    }

    async saveImportRules(userId, data) {
        const payload = this._cleanDefined({
            csv_date_behavior: this._allowedValue(data.csv_date_behavior, ['use_row_date', 'use_upload_date'], 'use_row_date'),
            unknown_document_route: 'ai_review',
            bill_scan_behavior: 'create_bill_draft',
            receipt_scan_behavior: 'create_ledger_draft',
            payment_screenshot_behavior: 'create_review_item',
            require_confirmation_before_save: true,
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'import_rules'), payload, { merge: true });
        return payload;
    }

    async saveAISettings(userId, data) {
        const payload = this._cleanDefined({
            answer_style: this._allowedValue(data.answer_style, ['concise', 'practical', 'detailed'], 'practical'),
            default_analysis_period: this._allowedValue(data.default_analysis_period, ['current_month', 'last_month', 'last_90_days'], 'current_month'),
            show_data_quality_warnings: data.show_data_quality_warnings !== false,
            allow_ai_suggestions: data.allow_ai_suggestions !== false,
            allow_ai_draft_actions: data.allow_ai_draft_actions === true,
            require_confirmation_before_save: true,
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'ai'), payload, { merge: true });
        return payload;
    }

    async saveEmailPreferences(userId, data) {
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const hour = Number(data.delivery_hour);
        const m = data.metrics || {};
        const payload = this._cleanDefined({
            weekly_digest_enabled: data.weekly_digest_enabled !== false,
            delivery_day: this._allowedValue(data.delivery_day, days, 'monday'),
            delivery_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
            timezone: this._stringOrDefault(data.timezone, 'Asia/Jakarta', 64),
            metrics: {
                financial_health: m.financial_health !== false,
                cash_position: m.cash_position !== false,
                bills: m.bills !== false,
                budgets: m.budgets !== false,
                revenue: m.revenue !== false,
                expenses: m.expenses !== false,
                subscriptions: m.subscriptions !== false,
                vendors: m.vendors !== false
            },
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'email_preferences'), payload, { merge: true });
        return payload;
    }

    async getWhatsAppSettings(userId) {
        const snap = await getDoc(this._settingsDoc(userId, 'whatsapp'));
        return { ...this._defaultSettings('whatsapp'), ...(snap.exists() ? snap.data() : {}) };
    }

    async saveWhatsAppSettings(userId, data) {
        const payload = this._cleanDefined({
            status: this._allowedValue(data.status, ['not_connected', 'pending', 'connected'], 'not_connected'),
            phone_number: this._nullableString(data.phone_number, 32),
            business_display_name: this._nullableString(data.business_display_name, 120),
            last_sync_at: data.last_sync_at || null,
            last_verified_at: data.last_verified_at || null,
            provider: 'whatsapp_cloud_api',
            updated_at: serverTimestamp()
        });
        await setDoc(this._settingsDoc(userId, 'whatsapp'), payload, { merge: true });
        return payload;
    }

    // --- RECEIPTS (legacy single-image flow; new code should use the DOCUMENTS methods below) ---
    async uploadReceipt(userId, file) {
        await this.assertCanUseStorage(userId, file?.size || 0, { source: 'receipt' });
        const { getStorage, ref, uploadBytes, getDownloadURL } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);
        const path = `users/${userId}/receipts/${Date.now()}-${file.name}`;
        const snap = await uploadBytes(ref(this._storage, path), file, { contentType: file.type || 'image/jpeg' });
        return getDownloadURL(snap.ref);
    }

    async updateTransactionReceipt(userId, txId, receiptUrl) {
        // updated_at must be refreshed to request.time, else the transaction
        // update rule rejects any record that has already been edited.
        await updateDoc(doc(this.db, `${this._scope(userId)}/transactions/${txId}`), {
            receipt_url: receiptUrl,
            status: 'Completed',
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        });
    }

    // --- DOCUMENTS (Phase 1 shared attachment) ---
    // Uploads a file to users/{uid}/documents/{documentId}/{fileName}, returning
    // the allocated documentId, storage_path, and (for images only) a public
    // download URL for the legacy `receipt_url` dual-write on transactions.
    async uploadDocument(userId, file, options = {}) {
        if (!options.bypassPlanLimit) {
            await this.assertCanUseStorage(userId, file?.size || 0, { source: 'document' });
            // Monthly document-processing quota (payment-proof uploads bypass via
            // bypassPlanLimit so a user can always activate their subscription).
            await this.assertCanProcessDocument(userId, 1, { source: options.source || 'document' });
        }
        const { getStorage, ref, uploadBytes, getDownloadURL } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);

        const documentRef = doc(collection(this.db, `${this._scope(userId)}/documents`));
        const documentId = documentRef.id;
        const safeName = String(file.name || 'document').replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'document';
        const storagePath = `${this._scope(userId)}/documents/${documentId}/${safeName}`;
        const snap = await uploadBytes(
            ref(this._storage, storagePath),
            file,
            { contentType: file.type || 'application/octet-stream' }
        );

        let downloadURL = null;
        if (file.type && file.type.startsWith('image/')) {
            try { downloadURL = await getDownloadURL(snap.ref); } catch (_) { downloadURL = null; }
        }

        return {
            documentId,
            storagePath,
            fileName: safeName,
            fileMimeType: file.type || 'application/octet-stream',
            fileSize: file.size || 0,
            downloadURL
        };
    }

    async addDocumentMetadata(userId, documentId, payload) {
        const docRef = doc(this.db, `${this._scope(userId)}/documents/${documentId}`);
        await setDoc(docRef, {
            file_name: payload.file_name,
            file_mime_type: payload.file_mime_type,
            file_size: payload.file_size,
            storage_path: payload.storage_path,
            document_role: payload.document_role,
            source_context: payload.source_context,
            target_collection: payload.target_collection || null,
            target_id: payload.target_id || '',
            upload_status: payload.upload_status || 'uploaded',
            extraction_status: 'not_requested',
            review_status: 'not_required',
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        return docRef;
    }

    async linkDocumentTarget(userId, documentId, targetCollection, targetId) {
        const docMetaRef = doc(this.db, `${this._scope(userId)}/documents/${documentId}`);
        await updateDoc(docMetaRef, {
            target_collection: targetCollection,
            target_id: targetId,
            updated_at: serverTimestamp()
        });
    }

    async attachDocumentToRecord(userId, targetCollection, targetId, attachment) {
        if (!['transactions', 'bills', 'subscriptions'].includes(targetCollection)) {
            throw new Error(`Cannot attach a document to '${targetCollection}'.`);
        }
        const recordRef = doc(this.db, `${this._scope(userId)}/${targetCollection}/${targetId}`);
        const update = { attached_documents: arrayUnion(attachment) };
        if (targetCollection === 'bills') update.invoice_status = 'attached';
        await updateDoc(recordRef, update);

        // Link metadata back to the record it was attached to.
        const docMetaRef = doc(this.db, `${this._scope(userId)}/documents/${attachment.document_id}`);
        await updateDoc(docMetaRef, {
            target_collection: targetCollection,
            target_id: targetId,
            updated_at: serverTimestamp()
        });
    }

    async updateTransactionType(userId, txId, newType, newIcon) {
        await updateDoc(doc(this.db, `${this._scope(userId)}/transactions/${txId}`), {
            type: newType,
            icon: newIcon,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        });
    }

    // --- ONBOARDING ---
    _onboardingDoc(userId, docId) {
        return doc(this.db, `users/${userId}/onboarding/${docId}`);
    }

    async getOnboardingProgress(userId) {
        const snap = await getDoc(this._onboardingDoc(userId, 'progress'));
        return snap.exists() ? snap.data() : null;
    }

    async getOnboardingProfile(userId) {
        const snap = await getDoc(this._onboardingDoc(userId, 'profile'));
        return snap.exists() ? snap.data() : null;
    }

    async getOnboardingDocuments(userId) {
        const snap = await getDoc(this._onboardingDoc(userId, 'documents'));
        return snap.exists() ? snap.data() : null;
    }

    async saveOnboardingProgress(userId, data) {
        const payload = this._cleanDefined({
            ...data,
            updated_at: serverTimestamp()
        });
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            created_at: serverTimestamp(),
            ...payload
        }, { merge: true });
        return payload;
    }

    async saveOnboardingProfile(userId, data) {
        const allowedRoles = ['Owner / Founder', 'Finance admin', 'Accountant', 'Operations manager', 'Staff'];
        const payload = this._cleanDefined({
            business_name: Object.prototype.hasOwnProperty.call(data, 'business_name')
                ? this._stringOrDefault(data.business_name, '', 120) : undefined,
            role: Object.prototype.hasOwnProperty.call(data, 'role')
                ? this._allowedValue(data.role, allowedRoles, '') : undefined,
            main_goal: Object.prototype.hasOwnProperty.call(data, 'main_goal')
                ? this._stringOrDefault(data.main_goal, '', 160) : undefined,
            monthly_revenue_range: Object.prototype.hasOwnProperty.call(data, 'monthly_revenue_range')
                ? this._stringOrDefault(data.monthly_revenue_range, '', 80) : undefined,
            employee_count_range: Object.prototype.hasOwnProperty.call(data, 'employee_count_range')
                ? this._stringOrDefault(data.employee_count_range, '', 80) : undefined,
            legal_full_name: Object.prototype.hasOwnProperty.call(data, 'legal_full_name')
                ? this._stringOrDefault(data.legal_full_name, '', 120) : undefined,
            phone_country_code: Object.prototype.hasOwnProperty.call(data, 'phone_country_code')
                ? this._nullableString(data.phone_country_code, 8) : undefined,
            phone_number: Object.prototype.hasOwnProperty.call(data, 'phone_number')
                ? this._nullableString(data.phone_number, 32) : undefined,
            updated_at: serverTimestamp()
        });
        await setDoc(this._onboardingDoc(userId, 'profile'), {
            created_at: serverTimestamp(),
            ...payload
        }, { merge: true });
        return payload;
    }

    async saveOnboardingDocuments(userId, data) {
        const payload = this._cleanDefined({
            identity_document_status: this._allowedValue(data.identity_document_status, ['not_uploaded', 'uploaded'], 'not_uploaded'),
            identity_document_storage_path: null,
            business_document_status: this._allowedValue(data.business_document_status, ['not_uploaded', 'uploaded'], 'not_uploaded'),
            business_document_storage_path: null,
            updated_at: serverTimestamp()
        });
        await setDoc(this._onboardingDoc(userId, 'documents'), {
            created_at: serverTimestamp(),
            ...payload
        }, { merge: true });
        return payload;
    }

    async completeOnboarding(userId, payload = {}) {
        const allowedActions = [
            'csv_upload',
            'add_transaction',
            'add_bill',
            'dashboard_overview',
            'revenue_review',
            'subscriptions',
            'fluxy_ai'
        ];
        const allowedTours = ['overview', 'ledger', 'bills', 'budgets', 'fluxy_ai', 'revenue_sync', 'subscriptions'];
        const selectedActions = Array.isArray(payload.selected_first_actions)
            ? payload.selected_first_actions.filter((value, index, arr) => allowedActions.includes(value) && arr.indexOf(value) === index)
            : [];
        const selectedAction = this._allowedValue(payload.selected_first_action, allowedActions, selectedActions[0] || null);
        const selectedTours = Array.isArray(payload.selected_learning_tours)
            ? payload.selected_learning_tours.filter((value, index, arr) => allowedTours.includes(value) && arr.indexOf(value) === index)
            : [];
        const primaryTour = this._allowedValue(payload.primary_learning_tour, allowedTours, selectedTours[0] || null);
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            onboarding_completed: true,
            onboarding_exempt: false,
            eligible_for_onboarding_gate: false,
            current_step: 'complete',
            selected_first_action: selectedAction,
            selected_first_actions: selectedActions,
            selected_learning_tours: selectedTours,
            primary_learning_tour: primaryTour,
            source: 'onboarding_v2',
            completed_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'onboarding.submit',
            target_collection: 'onboarding',
            target_id: 'progress',
            after: {
                onboarding_completed: true,
                selected_first_action: selectedAction,
                selected_first_actions: selectedActions,
                selected_learning_tours: selectedTours,
                primary_learning_tour: primaryTour
            },
            source: 'onboarding'
        });
        // Start the 3-day trial now that the user has reached the product value
        // moment. Best-effort — a failure here must never block onboarding success.
        try {
            await this.ensureBillingSubscription(userId);
        } catch (e) {
            console.warn('[onboarding] trial access creation skipped');
        }
    }

    async skipOnboarding(userId, currentStep = 'business_setup') {
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            onboarding_completed: false,
            onboarding_exempt: false,
            eligible_for_onboarding_gate: true,
            current_step: currentStep,
            skipped: true,
            source: 'onboarding_v2',
            skipped_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'onboarding.skip',
            target_collection: 'onboarding',
            target_id: 'progress',
            after: { skipped: true, current_step: currentStep },
            reason: 'User selected Save and finish later',
            source: 'onboarding'
        });
    }

    async markLegacyOnboardingExempt(userId) {
        const existing = await this.getOnboardingProgress(userId);
        if (existing?.onboarding_exempt === true || existing?.onboarding_completed === true) return;
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            onboarding_exempt: true,
            onboarding_completed: false,
            eligible_for_onboarding_gate: false,
            source: 'legacy_exemption',
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    // Invited members join an existing workspace and are NEVER owners — they must
    // skip the owner KYC/onboarding flow entirely. A distinct 'invited_member'
    // source keeps the onboarding gate off (it is not 'legacy_exemption', so it is
    // not self-healed) while letting platform-learning treat them as eligible for
    // the product coachmarks.
    async markInvitedMemberExempt(userId) {
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            onboarding_exempt: true,
            eligible_for_onboarding_gate: false,
            source: 'invited_member',
            updated_at: serverTimestamp(),
            created_at: serverTimestamp()
        }, { merge: true });
    }

    // --- PLATFORM LEARNING ---
    _platformLearningDoc(userId) {
        return doc(this.db, `users/${userId}/platform_learning/state`);
    }

    _platformLearningPayload(data = {}) {
        return this._cleanDefined({
            dismissed: data.dismissed === true,
            dismissed_at: data.dismissed_at === undefined ? null : data.dismissed_at,
            first_rendered_at: data.first_rendered_at,
            last_seen_at: data.last_seen_at,
            started_tours: Array.isArray(data.started_tours) ? data.started_tours : undefined,
            completed_tours: Array.isArray(data.completed_tours) ? data.completed_tours : undefined,
            skipped_tours: Array.isArray(data.skipped_tours) ? data.skipped_tours : undefined,
            active_tour: data.active_tour === undefined ? null : data.active_tour,
            updated_at: serverTimestamp()
        });
    }

    async getPlatformLearningState(userId) {
        const snap = await getDoc(this._platformLearningDoc(userId));
        if (!snap.exists()) {
            return {
                dismissed: false,
                dismissed_at: null,
                first_rendered_at: null,
                last_seen_at: null,
                started_tours: [],
                completed_tours: [],
                skipped_tours: [],
                active_tour: null
            };
        }
        const data = snap.data();
        return {
            dismissed: data.dismissed === true,
            dismissed_at: data.dismissed_at || null,
            first_rendered_at: data.first_rendered_at || null,
            last_seen_at: data.last_seen_at || null,
            started_tours: Array.isArray(data.started_tours) ? data.started_tours : [],
            completed_tours: Array.isArray(data.completed_tours) ? data.completed_tours : [],
            skipped_tours: Array.isArray(data.skipped_tours) ? data.skipped_tours : [],
            active_tour: data.active_tour || null,
            updated_at: data.updated_at || null
        };
    }

    async savePlatformLearningState(userId, data = {}) {
        const existing = await this.getPlatformLearningState(userId);
        const payload = this._platformLearningPayload({
            dismissed: existing.dismissed,
            dismissed_at: existing.dismissed_at,
            first_rendered_at: existing.first_rendered_at || serverTimestamp(),
            last_seen_at: serverTimestamp(),
            started_tours: existing.started_tours,
            completed_tours: existing.completed_tours,
            skipped_tours: existing.skipped_tours,
            active_tour: existing.active_tour,
            ...data
        });
        await setDoc(this._platformLearningDoc(userId), payload, { merge: true });
        return payload;
    }

    async markPlatformTourStarted(userId, tourId) {
        await setDoc(this._platformLearningDoc(userId), {
            dismissed: false,
            last_seen_at: serverTimestamp(),
            started_tours: arrayUnion(tourId),
            active_tour: tourId,
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    async markPlatformTourCompleted(userId, tourId) {
        await setDoc(this._platformLearningDoc(userId), {
            completed_tours: arrayUnion(tourId),
            active_tour: null,
            last_seen_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    async markPlatformTourSkipped(userId, tourId) {
        await setDoc(this._platformLearningDoc(userId), {
            skipped_tours: arrayUnion(tourId),
            active_tour: null,
            last_seen_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    async dismissPlatformLearning(userId) {
        await setDoc(this._platformLearningDoc(userId), {
            dismissed: true,
            dismissed_at: serverTimestamp(),
            active_tour: null,
            last_seen_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    // Reset coachmark/tour progress so the next run always starts at step 1.
    // Used when a user joins a workspace via invitation — every invited member
    // gets the full Getting Started flow from the beginning, never resumed.
    async resetPlatformLearningState(userId) {
        await setDoc(this._platformLearningDoc(userId), {
            dismissed: false,
            dismissed_at: null,
            started_tours: [],
            completed_tours: [],
            skipped_tours: [],
            active_tour: null,
            last_seen_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
    }

    // --- REPORTS & EXPORTS ---
    // Period-scoped fetchers. startKey / endKey are 'YYYY-MM-DD' day keys
    // (inclusive on both ends, interpreted in the client's local timezone).
    async getTransactionsForPeriod(userId, startKey, endKey, options = {}) {
        return this._getRecordsForPeriod(userId, 'transactions', startKey, endKey, options);
    }

    async getBillsForPeriod(userId, startKey, endKey) {
        return this._getRecordsForPeriod(userId, 'bills', startKey, endKey);
    }

    async getSubscriptionsForPeriod(userId, startKey, endKey) {
        return this._getRecordsForPeriod(userId, 'subscriptions', startKey, endKey);
    }

    async _getRecordsForPeriod(userId, collectionName, startKey, endKey, options = {}) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return [];
        const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
        // Workspace-scoped (Stage 2): the period readers behind the Ledger, the
        // Money Movement strip, and the dashboard KPIs must go through _scope() so
        // invited members read the shared workspace data — a hardcoded users/{uid}
        // here made members read their own (empty) collection and see 0 records.
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/${collectionName}`),
                where('timestamp', '>=', Timestamp.fromDate(start)),
                where('timestamp', '<', Timestamp.fromDate(endExclusive)),
                orderBy('timestamp', 'desc'),
                limit(1000)
            );
            const snapshot = await getDocs(q);
            const records = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            return collectionName === 'transactions' && options.includeVoided !== true ? this._activeTransactions(records) : records;
        } catch (e) {
            // Fallback for missing/legacy timestamp indexing: client-side filter.
            const q = query(
                collection(this.db, `${this._scope(userId)}/${collectionName}`),
                orderBy('timestamp', 'desc'),
                limit(1000)
            );
            const snapshot = await getDocs(q);
            const records = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => this._isTransactionInPeriod(r, startKey, endKey));
            return collectionName === 'transactions' && options.includeVoided !== true ? this._activeTransactions(records) : records;
        }
    }

    async getRecentExportLogs(userId, limitCount = 10) {
        // Fetch a broader audit window then filter by action; avoids needing a
        // composite (action, created_at) index for an MVP read.
        const logs = await this.getAuditLogs(userId, Math.max(limitCount * 5, 50));
        return logs.filter(log => log.action === 'export.create').slice(0, limitCount);
    }

    async createExportAuditLog(userId, payload = {}) {
        return await this.addAuditLog(userId, {
            action: 'export.create',
            // Must be one of the values allowed by firestore.rules
            // isValidAuditLog. Reports & Exports targets the report_exports
            // metadata collection.
            target_collection: 'report_exports',
            target_id: payload.target_id || '',
            before: null,
            after: payload.after || null,
            reason: payload.reason || null,
            source: payload.source || 'dashboard'
        });
    }

    async addReportExport(userId, data = {}) {
        // Metadata only. Never store row-level financial data or CSV content.
        const payload = {
            report_type: data.report_type || 'monthly_report_pack',
            period_start: data.period_start || null,
            period_end: data.period_end || null,
            formats: Array.isArray(data.formats) ? data.formats : ['csv_bundle'],
            status: data.status || 'generated',
            included_sections: Array.isArray(data.included_sections) ? data.included_sections : [],
            record_counts: data.record_counts || {},
            warning_counts: data.warning_counts || {},
            limitations: Array.isArray(data.limitations) ? data.limitations : [],
            created_at: serverTimestamp(),
            created_by: (this.actorUid || userId)
        };
        // Optional YTD/YoY scope metadata. The firestore rule allows the field
        // to be absent — only include it when supplied.
        if (data.report_scope && typeof data.report_scope === 'object') {
            payload.report_scope = data.report_scope;
        }
        return await addDoc(collection(this.db, `${this._scope(userId)}/report_exports`), payload);
    }

    async getRecentReportExports(userId, limitCount = 10) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/report_exports`),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // --- AUDIT LOGS ---
    async addAuditLog(userId, data) {
        return await addDoc(collection(this.db, `${this._scope(userId)}/audit_logs`), {
            actor_uid: (this.actorUid || userId),
            actor_role: data.actor_role || null,
            action: data.action,
            target_collection: data.target_collection,
            target_id: data.target_id || '',
            before: data.before || null,
            after: data.after || null,
            reason: data.reason || null,
            source: data.source || 'dashboard',
            created_at: serverTimestamp()
        });
    }

    async getAuditLogs(userId, limitCount = 100) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/audit_logs`),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Best-effort "created" audit log for simple addDoc create paths (transactions,
    // bills, subscriptions). Never throws — a create must not fail because its
    // audit entry was rejected. `after` is cleaned to defined values only so it
    // stays a plain snapshot map (the create rules pin the 10 top-level fields,
    // which addAuditLog already writes). Powers the Activity Log feed.
    async _auditCreateBestEffort(userId, action, targetCollection, targetId, after = {}) {
        try {
            const clean = {};
            Object.keys(after || {}).forEach((k) => {
                if (after[k] !== undefined && after[k] !== null) clean[k] = after[k];
            });
            await this.addAuditLog(userId, {
                action,
                target_collection: targetCollection,
                target_id: targetId || '',
                before: null,
                after: clean,
                source: 'dashboard'
            });
        } catch (e) {
            console.warn('[audit] create log skipped', action, e && e.message ? e.message : e);
        }
    }

    // ====================================================================
    // WORKSPACE TEAM MANAGEMENT & RBAC
    //
    // Workspace-scoped membership/invites/audit. Seeding rule: for existing
    // single-user accounts workspaceId == the owner's uid (so the migration is
    // reference-safe). Invites are keyed by lowercased email so Firestore rules
    // can verify a self-join without a query. See firestore.rules → WORKSPACES
    // and docs/SECURITY_SYSTEM.md §3–6.
    // ====================================================================

    _emailKey(email) {
        return String(email || '').trim().toLowerCase();
    }

    // Best-effort workspace-scoped audit log. Never throws (mirrors the
    // post-commit best-effort audits used elsewhere). actor_uid comes from
    // this.actorUid (set via setActor), which Firestore rules pin to the caller.
    async _workspaceAudit(workspaceId, data) {
        try {
            return await addDoc(collection(this.db, `workspaces/${workspaceId}/audit_logs`), {
                actor_uid: this.actorUid,
                actor_role: data.actor_role || this.actorRole || null,
                action: data.action,
                target_collection: data.target_collection,
                target_id: data.target_id || '',
                before: data.before || null,
                after: data.after || null,
                reason: data.reason || null,
                source: data.source || 'dashboard',
                created_at: serverTimestamp()
            });
        } catch (e) {
            console.warn('[workspace audit] skipped', e);
            return null;
        }
    }

    // Bootstrap the caller's own workspace (id == uid): profile doc, owner
    // membership, and the reverse-lookup pointer. Idempotent.
    async ensureWorkspace(uid, opts = {}) {
        const wsRef = doc(this.db, `workspaces/${uid}`);
        let wsExists = false;
        try { wsExists = (await getDoc(wsRef)).exists(); } catch (_) {}
        if (!wsExists) {
            await setDoc(wsRef, {
                owner_uid: uid,
                name: opts.name || null,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp()
            });
        }
        const memberRef = doc(this.db, `workspaces/${uid}/members/${uid}`);
        let memberExists = false;
        try { memberExists = (await getDoc(memberRef)).exists(); } catch (_) {}
        if (!memberExists) {
            await setDoc(memberRef, {
                uid,
                email: opts.email || null,
                display_name: opts.displayName || null,
                role: 'owner',
                status: 'active',
                invited_by: null,
                joined_at: serverTimestamp(),
                updated_at: serverTimestamp()
            });
        }
        try {
            await setDoc(doc(this.db, `user_workspaces/${uid}`), {
                workspaceIds: arrayUnion(uid),
                default: uid,
                updated_at: serverTimestamp()
            }, { merge: true });
        } catch (_) {}
        return { workspaceId: uid, role: 'owner' };
    }

    async getWorkspaceProfile(workspaceId) {
        const snap = await getDoc(doc(this.db, `workspaces/${workspaceId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Denormalize the OWNER's subscription summary onto the workspace doc so every
    // member (who cannot read the owner's user-scoped billing) sees the same plan.
    // Owner-only by construction: ownerUid == workspaceId, and only the owner can
    // read users/{ownerUid}/billing_subscription and write the plan fields (rules).
    // Non-sensitive fields only — no amounts or payment details. Best-effort.
    async syncWorkspacePlan(ownerUid) {
        try {
            const subSnap = await getDoc(doc(this.db, `users/${ownerUid}/billing_subscription/current`));
            if (!subSnap.exists()) return;
            const s = subSnap.data() || {};
            await setDoc(doc(this.db, `workspaces/${ownerUid}`), {
                plan_id: s.plan_id || null,
                plan_name: s.plan_name || null,
                subscription_status: s.status || null,
                billing_frequency: s.billing_frequency || null,
                // Trial timing so every member inherits the SAME trial state and
                // banner. Non-sensitive (no amounts / payment ids). Members expire
                // client-side from trial_ends_at (no per-member billing doc).
                trial_started_at: s.trial_started_at || null,
                trial_ends_at: s.trial_ends_at || null,
                current_period_end: s.current_period_end || null,
                plan_synced_at: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.warn('[workspace plan sync] skipped', e);
        }
    }

    // Real-time: invoke `callback` only when ANOTHER member commits a change to a
    // workspace collection. Skips the initial snapshot (first fire) and this
    // client's own optimistic writes (metadata.hasPendingWrites), so a member's
    // own actions don't double-trigger. Returns an unsubscribe function.
    watchCollection(scopeId, collectionName, callback) {
        const ref = collection(this.db, `${this._scope(scopeId)}/${collectionName}`);
        let initialized = false;
        return onSnapshot(ref, (snap) => {
            if (!initialized) { initialized = true; return; }
            if (snap.metadata && snap.metadata.hasPendingWrites) return;
            try { callback(snap); } catch (_) {}
        }, (err) => console.warn('[watchCollection] ' + collectionName, err && err.message ? err.message : err));
    }

    async getMembers(workspaceId) {
        const snap = await getDocs(collection(this.db, `workspaces/${workspaceId}/members`));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async getInvites(workspaceId, { pendingOnly = true } = {}) {
        const snap = await getDocs(collection(this.db, `workspaces/${workspaceId}/invites`));
        let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (pendingOnly) rows = rows.filter(r => r.status === 'pending');
        return rows;
    }

    // Create (or re-send) a pending invite. Returns { id } where id == email key.
    async inviteMember(workspaceId, { email, role, invitedBy = null, invitedByEmail = null, expiresAt = null } = {}) {
        const key = this._emailKey(email);
        if (!key) throw new Error('An email address is required.');
        if (!['admin', 'finance', 'accountant', 'viewer'].includes(role)) throw new Error('Invalid role.');
        const ref = doc(this.db, `workspaces/${workspaceId}/invites/${key}`);
        await setDoc(ref, {
            email: key,
            role,
            status: 'pending',
            invited_by: invitedBy,
            invited_by_email: invitedByEmail ? this._emailKey(invitedByEmail) : null,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            expires_at: expiresAt,
            accepted_by: null,
            accepted_at: null
        });
        await this._workspaceAudit(workspaceId, {
            action: 'member.invite', target_collection: 'invites', target_id: key, after: { email: key, role }
        });
        return { id: key };
    }

    async revokeInvite(workspaceId, email) {
        const key = this._emailKey(email);
        await deleteDoc(doc(this.db, `workspaces/${workspaceId}/invites/${key}`));
        await this._workspaceAudit(workspaceId, {
            action: 'invite.revoke', target_collection: 'invites', target_id: key
        });
    }

    async updateMemberRole(workspaceId, memberUid, role) {
        if (!['admin', 'finance', 'accountant', 'viewer'].includes(role)) throw new Error('Invalid role.');
        const ref = doc(this.db, `workspaces/${workspaceId}/members/${memberUid}`);
        let before = {};
        try { before = (await getDoc(ref)).data() || {}; } catch (_) {}
        await updateDoc(ref, { role, updated_at: serverTimestamp() });
        await this._workspaceAudit(workspaceId, {
            action: 'member.role_change', target_collection: 'members', target_id: memberUid,
            before: { role: before.role || null }, after: { role }
        });
    }

    async removeMember(workspaceId, memberUid) {
        const ref = doc(this.db, `workspaces/${workspaceId}/members/${memberUid}`);
        let before = {};
        try { before = (await getDoc(ref)).data() || {}; } catch (_) {}
        await deleteDoc(ref);
        await this._workspaceAudit(workspaceId, {
            action: 'member.remove', target_collection: 'members', target_id: memberUid,
            before: { role: before.role || null, email: before.email || null }
        });
    }

    // Invitee self-joins from a pending invite. Creates their member doc and
    // flips the invite to accepted in one batch (rules verify both transitions).
    async acceptInvite(workspaceId, uid, { email, displayName = null } = {}) {
        const key = this._emailKey(email);
        const inviteRef = doc(this.db, `workspaces/${workspaceId}/invites/${key}`);
        const inviteSnap = await getDoc(inviteRef);
        if (!inviteSnap.exists()) throw new Error('Invite not found.');
        const invite = inviteSnap.data() || {};
        if (invite.status !== 'pending') throw new Error('This invite is no longer available.');
        const role = invite.role;
        const batch = writeBatch(this.db);
        batch.set(doc(this.db, `workspaces/${workspaceId}/members/${uid}`), {
            uid,
            email: key,
            display_name: displayName,
            role,
            status: 'active',
            invited_by: invite.invited_by || null,
            joined_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        batch.update(inviteRef, {
            status: 'accepted', accepted_by: uid, accepted_at: serverTimestamp(), updated_at: serverTimestamp()
        });
        await batch.commit();
        try {
            await setDoc(doc(this.db, `user_workspaces/${uid}`), {
                workspaceIds: arrayUnion(workspaceId),
                default: workspaceId,
                updated_at: serverTimestamp()
            }, { merge: true });
        } catch (_) {}
        return { workspaceId, role };
    }

    async getWorkspaceAuditLogs(workspaceId, limitCount = 50) {
        try {
            const q = query(
                collection(this.db, `workspaces/${workspaceId}/audit_logs`),
                orderBy('created_at', 'desc'),
                limit(limitCount)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.warn('[workspace audit] read skipped', e);
            return [];
        }
    }

    // --- INVOICES (Create Invoice MVP) ---
    // Owner-scoped customer invoices under users/{uid}/invoices with an
    // items subcollection. Amounts are raw integer Rupiah — never formatted
    // strings. A finalized (open) invoice is an expected receivable only:
    // it NEVER creates a ledger transaction in v1.
    // See docs/fluxyos_create_invoice_feature_plan.md.

    _normalizeInvoiceItem(item = {}, index = 0) {
        const description = this._stringOrDefault(item.description, '', 240);
        if (!description) throw new Error('Item description is required.');
        const quantity = Math.round((Number(item.quantity) || 0) * 100) / 100;
        if (!(quantity > 0)) throw new Error('Item quantity must be greater than zero.');
        const unitPrice = Math.round(Number(String(item.unit_price).replace(/[^\d]/g, '')) || 0);
        if (!(unitPrice > 0)) throw new Error('Item unit price must be greater than zero.');
        return {
            description,
            quantity,
            unit_price: unitPrice,
            amount: Math.round(quantity * unitPrice),
            position: Number.isFinite(Number(item.position)) ? Number(item.position) : index
        };
    }

    _calculateInvoiceTotals(items = [], taxRatePercent = null) {
        const subtotal = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const rate = taxRatePercent == null ? null : Math.min(Math.max(Number(taxRatePercent) || 0, 0), 100);
        const tax = rate ? Math.round(subtotal * rate / 100) : 0;
        const discount = 0; // Discounts are out of scope for invoice v1.
        const total = Math.max(subtotal + tax - discount, 0);
        return {
            subtotal_amount: subtotal,
            tax_rate_percent: rate,
            tax_amount: tax,
            discount_amount: discount,
            total_amount: total,
            amount_due: total
        };
    }

    _invoiceAuditSnapshot(invoice = {}) {
        const keys = [
            'invoice_number', 'status', 'currency', 'customer_name', 'customer_email',
            'due_terms', 'item_count', 'subtotal_amount', 'tax_amount', 'discount_amount',
            'total_amount', 'amount_due', 'payment_collection_method'
        ];
        const out = {};
        keys.forEach(key => {
            if (invoice && invoice[key] !== undefined) out[key] = invoice[key] ?? null;
        });
        return out;
    }

    _invoiceAuditRef(userId) {
        return doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
    }

    _invoiceAuditPayload(userId, action, targetId, { before = null, after = null, reason = null } = {}) {
        return {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action,
            target_collection: 'invoices',
            target_id: targetId || '',
            before,
            after,
            reason,
            source: 'dashboard',
            created_at: serverTimestamp()
        };
    }

    // Builds the normalized invoice document payload (without items) from
    // editor state. All amounts are recalculated server of record style here
    // so the UI can never persist a stale or formatted total.
    _normalizeInvoiceData(userId, invoiceData = {}, normalizedItems = []) {
        const totals = this._calculateInvoiceTotals(
            normalizedItems,
            invoiceData.tax_rate_percent
        );
        const dueTermsAllowed = ['due_on_receipt', 'due_in_7_days', 'due_in_14_days', 'due_in_30_days', 'custom'];
        return {
            customer_name: this._stringOrDefault(invoiceData.customer_name, '', 160),
            customer_email: invoiceData.customer_email
                ? this._stringOrDefault(invoiceData.customer_email, '', 160) || null
                : null,
            customer_language: this._stringOrDefault(invoiceData.customer_language, 'English', 40),
            currency: 'IDR',
            issue_date: this._coerceTimestampOrNow(invoiceData.issue_date),
            due_date: invoiceData.due_date ? this._coerceTimestampOrNow(invoiceData.due_date) : null,
            due_terms: this._allowedValue(invoiceData.due_terms, dueTermsAllowed, 'due_in_30_days'),
            item_count: normalizedItems.length,
            // Customer withholding (the customer withholds PPh on payment). Optional.
            customer_npwp: invoiceData.customer_npwp ? (this._nullableString(invoiceData.customer_npwp, 32)) : null,
            customer_withholding_rate: (Number(invoiceData.customer_withholding_rate) > 0)
                ? Math.min(Math.max(Number(invoiceData.customer_withholding_rate), 0), 100) : null,
            customer_withholding_type: invoiceData.customer_withholding_type ? this._nullableString(invoiceData.customer_withholding_type, 40) : null,
            customer_withholding_code: invoiceData.customer_withholding_code ? this._nullableString(invoiceData.customer_withholding_code, 40) : null,
            ...totals,
            memo: invoiceData.memo ? this._stringOrDefault(invoiceData.memo, '', 500) || null : null,
            footer: invoiceData.footer ? this._stringOrDefault(invoiceData.footer, '', 500) || null : null,
            payment_collection_method: this._allowedValue(
                invoiceData.payment_collection_method,
                ['request_payment', 'manual_only'],
                'request_payment'
            ),
            payment_link_enabled: invoiceData.payment_link_enabled === true,
            payment_page_url: null,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        };
    }

    // User-friendly per-user invoice number: INV-YYYYMM-0001. Zero-padded so
    // lexical order matches chronological order; derived from the latest
    // existing number (no global counters).
    async generateInvoiceNumber(userId) {
        const now = new Date();
        const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
        let sequence = 1;
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/invoices`),
                orderBy('invoice_number', 'desc'),
                limit(1)
            );
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const latest = String(snapshot.docs[0].data().invoice_number || '');
                if (latest.startsWith(prefix)) {
                    const parsed = parseInt(latest.slice(prefix.length), 10);
                    if (Number.isFinite(parsed)) sequence = parsed + 1;
                }
            }
        } catch (e) {
            // Fall through to a time-based suffix when the read fails — a
            // unique-enough number is better than a blocked draft.
            return `${prefix}${String(Date.now()).slice(-6)}`;
        }
        return `${prefix}${String(sequence).padStart(4, '0')}`;
    }

    async getInvoices(userId, limitCount = 100) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/invoices`),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async getInvoice(userId, invoiceId) {
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async getInvoiceItems(userId, invoiceId) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items`),
            orderBy('position', 'asc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Creates the draft invoice + its items + the audit log in ONE batch so a
    // rules rejection leaves nothing half-written. invoiceData.items is the
    // full editor item list.
    async createInvoiceDraft(userId, invoiceData = {}) {
        const items = (Array.isArray(invoiceData.items) ? invoiceData.items : [])
            .map((item, index) => this._normalizeInvoiceItem(item, index));
        const invoiceRef = doc(collection(this.db, `${this._scope(userId)}/invoices`));
        const invoiceNumber = invoiceData.invoice_number || await this.generateInvoiceNumber(userId);
        const payload = {
            invoice_number: this._stringOrDefault(invoiceNumber, '', 40),
            status: 'draft',
            ...this._normalizeInvoiceData(userId, invoiceData, items),
            finalized_at: null,
            sent_at: null,
            paid_at: null,
            voided_at: null,
            void_reason: null,
            created_at: serverTimestamp(),
            created_by: (this.actorUid || userId)
        };

        const batch = writeBatch(this.db);
        batch.set(invoiceRef, payload);
        items.forEach(item => {
            batch.set(doc(collection(this.db, `${this._scope(userId)}/invoices/${invoiceRef.id}/items`)), {
                ...item,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp()
            });
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.draft_created', invoiceRef.id, {
                after: this._invoiceAuditSnapshot({ ...payload, invoice_number: payload.invoice_number })
            })
        );
        await batch.commit();
        return { id: invoiceRef.id, invoice_number: payload.invoice_number };
    }

    // Updates a draft invoice and syncs its item subcollection (upsert kept
    // rows, delete removed rows) in one batch, with per-item audit logs.
    async updateInvoiceDraft(userId, invoiceId, invoiceData = {}) {
        const existing = await this.getInvoice(userId, invoiceId);
        if (!existing) throw new Error('Invoice not found.');
        // Drafts are editable; a finalized invoice stays editable only while it
        // is "finalize only" — open and not yet marked sent. Editing preserves
        // the existing status (an open invoice is not reverted to draft).
        const editable = existing.status === 'draft' || (existing.status === 'open' && !existing.sent_at);
        if (!editable) throw new Error('Only draft or unsent finalized invoices can be edited.');
        const existingItems = await this.getInvoiceItems(userId, invoiceId);
        const existingById = new Map(existingItems.map(item => [item.id, item]));

        const incoming = (Array.isArray(invoiceData.items) ? invoiceData.items : [])
            .map((item, index) => ({ id: item.id || null, ...this._normalizeInvoiceItem(item, index) }));

        const payload = this._normalizeInvoiceData(userId, invoiceData, incoming);
        const batch = writeBatch(this.db);
        batch.update(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`), payload);

        const keptIds = new Set();
        incoming.forEach(item => {
            const { id, ...fields } = item;
            if (id && existingById.has(id)) {
                keptIds.add(id);
                batch.set(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${id}`), {
                    ...fields,
                    created_at: existingById.get(id).created_at,
                    updated_at: serverTimestamp()
                });
                batch.set(
                    this._invoiceAuditRef(userId),
                    this._invoiceAuditPayload(userId, 'invoice.item_updated', invoiceId, {
                        before: { description: existingById.get(id).description, amount: existingById.get(id).amount },
                        after: { description: fields.description, amount: fields.amount }
                    })
                );
            } else {
                batch.set(doc(collection(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items`)), {
                    ...fields,
                    created_at: serverTimestamp(),
                    updated_at: serverTimestamp()
                });
                batch.set(
                    this._invoiceAuditRef(userId),
                    this._invoiceAuditPayload(userId, 'invoice.item_added', invoiceId, {
                        after: { description: fields.description, amount: fields.amount }
                    })
                );
            }
        });
        existingItems.forEach(item => {
            if (!keptIds.has(item.id)) {
                batch.delete(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${item.id}`));
                batch.set(
                    this._invoiceAuditRef(userId),
                    this._invoiceAuditPayload(userId, 'invoice.item_deleted', invoiceId, {
                        before: { description: item.description, amount: item.amount }
                    })
                );
            }
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.draft_updated', invoiceId, {
                before: this._invoiceAuditSnapshot(existing),
                after: this._invoiceAuditSnapshot({ ...existing, ...payload, status: existing.status })
            })
        );
        await batch.commit();
        return { id: invoiceId };
    }

    async addInvoiceItem(userId, invoiceId, itemData = {}) {
        const item = this._normalizeInvoiceItem(itemData, Number(itemData.position) || 0);
        const batch = writeBatch(this.db);
        batch.set(doc(collection(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items`)), {
            ...item,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.item_added', invoiceId, {
                after: { description: item.description, amount: item.amount }
            })
        );
        await batch.commit();
    }

    async updateInvoiceItem(userId, invoiceId, itemId, itemData = {}) {
        const existingSnap = await getDoc(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${itemId}`));
        if (!existingSnap.exists()) throw new Error('Invoice item not found.');
        const existing = existingSnap.data();
        const item = this._normalizeInvoiceItem(itemData, Number(itemData.position) || 0);
        const batch = writeBatch(this.db);
        batch.set(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${itemId}`), {
            ...item,
            created_at: existing.created_at,
            updated_at: serverTimestamp()
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.item_updated', invoiceId, {
                before: { description: existing.description, amount: existing.amount },
                after: { description: item.description, amount: item.amount }
            })
        );
        await batch.commit();
    }

    async deleteInvoiceItem(userId, invoiceId, itemId) {
        const existingSnap = await getDoc(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${itemId}`));
        const existing = existingSnap.exists() ? existingSnap.data() : {};
        const batch = writeBatch(this.db);
        batch.delete(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}/items/${itemId}`));
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.item_deleted', invoiceId, {
                before: { description: existing.description ?? null, amount: existing.amount ?? null }
            })
        );
        await batch.commit();
    }

    // Finalize: draft -> open. Validates required fields, stamps finalized_at
    // (and sent_at when markSent), and writes the audit log(s) in the same
    // batch. NEVER creates a ledger transaction — an open invoice is an
    // expected receivable only.
    async finalizeInvoice(userId, invoiceId, { markSent = false } = {}) {
        const invoice = await this.getInvoice(userId, invoiceId);
        if (!invoice) throw new Error('Invoice not found.');
        if (invoice.status !== 'draft') throw new Error('Only draft invoices can be finalized.');
        if (!invoice.customer_name) throw new Error('Customer name is required before finalizing.');
        if (!invoice.due_date) throw new Error('Due date is required before finalizing.');
        if (!(invoice.item_count > 0)) throw new Error('Add at least one line item before finalizing.');
        if (!(invoice.total_amount > 0)) throw new Error('Invoice total must be greater than zero.');
        if (markSent && !invoice.customer_email) {
            throw new Error('Customer email is required to mark the invoice as sent.');
        }

        const patch = {
            status: 'open',
            finalized_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        };
        if (markSent) patch.sent_at = serverTimestamp();

        const batch = writeBatch(this.db);
        const invoiceRef = doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`);
        // Finalizing issues the invoice: post INV-ISSUE (Dr Accounts Receivable /
        // Cr Revenue) for the total. Merge the journal pointer into the same
        // invoice update (one write per doc per batch).
        const issueDoc = { ...invoice, ...patch, status: 'open' };
        await this._postSourceJournal(userId, batch, 'invoices', invoiceRef, issueDoc, { date: invoice.issue_date });
        if (issueDoc.journal_ref) patch.journal_ref = issueDoc.journal_ref;
        if (issueDoc.accounting_status) patch.accounting_status = issueDoc.accounting_status;
        batch.update(invoiceRef, patch);
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.finalized', invoiceId, {
                before: this._invoiceAuditSnapshot(invoice),
                after: this._invoiceAuditSnapshot({ ...invoice, status: 'open' })
            })
        );
        if (markSent) {
            batch.set(
                this._invoiceAuditRef(userId),
                this._invoiceAuditPayload(userId, 'invoice.sent', invoiceId, {
                    after: { invoice_number: invoice.invoice_number ?? null, customer_email: invoice.customer_email ?? null }
                })
            );
        }
        await batch.commit();
        return { id: invoiceId };
    }

    // Records that an already-open invoice was sent outside FluxyOS (no email
    // provider exists in v1 — this is a manual status stamp only).
    async recordInvoiceSent(userId, invoiceId) {
        const invoice = await this.getInvoice(userId, invoiceId);
        if (!invoice) throw new Error('Invoice not found.');
        if (invoice.status !== 'open') throw new Error('Only open invoices can be marked as sent.');
        const batch = writeBatch(this.db);
        batch.update(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`), {
            sent_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.sent', invoiceId, {
                after: { invoice_number: invoice.invoice_number ?? null, customer_email: invoice.customer_email ?? null }
            })
        );
        await batch.commit();
        return { id: invoiceId };
    }

    // Mark paid: open -> paid, ONLY on explicit user confirmation. Creates the
    // linked income ledger transaction (full invoice total, category Revenue),
    // stamps paid_at + linked_transaction_id, and writes the audit log — all in
    // one batch so a rules rejection leaves nothing half-written. Paid is
    // terminal: no edit, void, or un-pay path exists after this.
    async markInvoicePaid(userId, invoiceId, { paymentDate = null } = {}) {
        const invoice = await this.getInvoice(userId, invoiceId);
        if (!invoice) throw new Error('Invoice not found.');
        if (invoice.status !== 'open') throw new Error('Only open invoices can be marked as paid.');
        const amount = Math.round(Number(invoice.total_amount) || 0);
        if (!(amount > 0)) throw new Error('Invoice total must be greater than zero.');

        const txRef = doc(collection(this.db, `${this._scope(userId)}/transactions`));
        const transaction = {
            amount,
            vendor_name: invoice.customer_name,
            category: 'Revenue',
            type: 'income',
            status: 'Completed',
            icon: '💰',
            timestamp: this._coerceTimestampOrNow(paymentDate),
            invoice_number: invoice.invoice_number ?? null,
            notes: `Payment for invoice ${invoice.invoice_number || invoiceId}`,
            created_at: serverTimestamp()
        };
        if (invoice.issue_date) transaction.invoice_date = invoice.issue_date;
        // If the invoice was issued under the accounting kernel (has a journal),
        // link the payment so it posts INV-PAY (Dr Cash / Cr A/R) — settling the
        // receivable instead of recognizing revenue twice. Legacy invoices with no
        // INV-ISSUE journal fall back to a plain income posting (Dr Cash/Cr Revenue).
        if (invoice.journal_ref) transaction.linked_invoice_id = invoiceId;

        // Customer withholding: if the invoice records that the customer withholds PPh,
        // stamp the computed amount on the payment so the engine reclasses it to 1150
        // (creditable) and books Cash at the net received. Base is the invoice subtotal.
        const cwRate = Number(invoice.customer_withholding_rate) || 0;
        if (cwRate > 0 && invoice.journal_ref) {
            const base = Math.round(Number(invoice.subtotal_amount) || 0);
            const pph = Math.round((base * cwRate) / 100);
            if (pph > 0) {
                transaction.customer_withholding_amount = pph;
                transaction.withholding_rate = cwRate;
                transaction.withholding_type = invoice.customer_withholding_type || 'PPh 23';
                transaction.withholding_code = invoice.customer_withholding_code || 'PPH_WHT';
                transaction.taxable_base = base;
                if (invoice.customer_npwp) transaction.customer_npwp = invoice.customer_npwp;
            }
        }

        const batch = writeBatch(this.db);
        await this._postSourceJournal(userId, batch, 'transactions', txRef, transaction, { date: transaction.timestamp });
        batch.set(txRef, transaction);
        batch.update(doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`), {
            status: 'paid',
            paid_at: serverTimestamp(),
            linked_transaction_id: txRef.id,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        });
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.mark_paid', invoiceId, {
                before: this._invoiceAuditSnapshot(invoice),
                after: {
                    invoice_number: invoice.invoice_number ?? null,
                    amount,
                    transaction_id: txRef.id
                }
            })
        );
        await batch.commit();
        return { id: invoiceId, transactionId: txRef.id };
    }

    // Void instead of delete. Requires a reason; paid invoices cannot be
    // voided (terminal status), and the rules block it as well.
    async voidInvoice(userId, invoiceId, reason = null) {
        const cleanReason = this._stringOrDefault(reason, '', 500);
        if (!cleanReason) throw new Error('A reason is required to void an invoice.');
        const invoice = await this.getInvoice(userId, invoiceId);
        if (!invoice) throw new Error('Invoice not found.');
        if (!['draft', 'open'].includes(invoice.status)) {
            throw new Error('Only draft or open invoices can be voided.');
        }
        const batch = writeBatch(this.db);
        const invoiceRef = doc(this.db, `${this._scope(userId)}/invoices/${invoiceId}`);
        const voidPatch = {
            status: 'void',
            voided_at: serverTimestamp(),
            void_reason: cleanReason,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        };
        // Voiding an issued invoice reverses its INV-ISSUE journal so Revenue and
        // A/R no longer reflect it. Drafts never posted, so there's nothing to reverse.
        if (invoice.status === 'open' && invoice.journal_ref) {
            const jf = await this._correctSourceJournal(userId, batch, 'invoices', invoiceRef, invoice, null);
            if (jf.accounting_status) voidPatch.accounting_status = jf.accounting_status;
        }
        batch.update(invoiceRef, voidPatch);
        batch.set(
            this._invoiceAuditRef(userId),
            this._invoiceAuditPayload(userId, 'invoice.voided', invoiceId, {
                before: this._invoiceAuditSnapshot(invoice),
                after: this._invoiceAuditSnapshot({ ...invoice, status: 'void' }),
                reason: cleanReason
            })
        );
        await batch.commit();
        return { id: invoiceId };
    }

    // --- ACCOUNTING CENTER (Phase 1) ---
    // Read-only accounting-readiness layer over existing operational records.
    // Computes a deterministic readiness score, a cleanup queue, an account
    // mapping preview, and a close-readiness checklist for the selected period.
    // Reads only user-scoped collections; never invents numbers.

    _accountInfo(code) {
        const acct = ACCOUNTING_ACCOUNT_CATALOG[code];
        return acct
            ? { code, name: acct.name, type: acct.type }
            : { code: ACCOUNTING_UNMAPPED_FALLBACK_CODE, ...{ name: ACCOUNTING_ACCOUNT_CATALOG[ACCOUNTING_UNMAPPED_FALLBACK_CODE].name, type: 'expense' } };
    }

    // Resolve the source key + default account suggestion for a transaction-like
    // record. Returns { sourceType, sourceValue, account, isDefaultMapped }.
    // isDefaultMapped is false for custom / "Others" / unrecognized categories.
    _resolveAccountingSource(record) {
        const type = String(record.type || '').toLowerCase().trim();
        const category = typeof record.category === 'string' ? record.category.trim() : '';
        // Type-driven records (AR/AP, fees, tax, income/refund) map by type.
        if (ACCOUNTING_TYPE_DEFAULTS[type] && (type !== 'expense')) {
            const code = ACCOUNTING_TYPE_DEFAULTS[type];
            return { sourceType: 'transaction_type', sourceValue: type, account: this._accountInfo(code), isDefaultMapped: true };
        }
        // Category-driven records.
        if (category && ACCOUNTING_CATEGORY_DEFAULTS[category]) {
            const code = ACCOUNTING_CATEGORY_DEFAULTS[category];
            return { sourceType: 'transaction_category', sourceValue: category, account: this._accountInfo(code), isDefaultMapped: true };
        }
        // Unknown / custom / "Others" / empty category → not confidently mapped.
        const sourceValue = category || (type ? type : 'Uncategorized');
        return {
            sourceType: category ? 'transaction_category' : 'transaction_type',
            sourceValue,
            account: this._accountInfo(ACCOUNTING_UNMAPPED_FALLBACK_CODE),
            isDefaultMapped: false
        };
    }

    async getAccountingMappings(userId) {
        if (!userId) return [];
        try {
            const snapshot = await getDocs(collection(this.db, `${this._scope(userId)}/accounting_mappings`));
            return snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(m => m.status !== 'archived');
        } catch (_) {
            return [];
        }
    }

    // Upsert a saved mapping. Doc id is deterministic from source_type+value so a
    // re-save updates the existing mapping rather than duplicating it.
    async saveAccountingMapping(userId, data = {}) {
        if (!userId) throw new Error('userId required');
        const sourceType = data.source_type === 'transaction_type' ? 'transaction_type' : 'transaction_category';
        const sourceValue = this._nullableString(data.source_value, 60);
        if (!sourceValue) throw new Error('source_value required');
        const code = this._nullableString(data.target_account_code, 12);
        if (!code) throw new Error('target_account_code required');
        const catalog = ACCOUNTING_ACCOUNT_CATALOG[code];
        const targetName = this._nullableString(data.target_account_name, 80) || (catalog ? catalog.name : null);
        const targetType = data.target_account_type || (catalog ? catalog.type : null);
        if (!targetName || !targetType) throw new Error('target account name/type required');

        // Deterministic id keeps one mapping per source. Sanitize for a doc id.
        const safeKey = `${sourceType}__${sourceValue}`.toLowerCase().replace(/[^a-z0-9_]+/g, '-').slice(0, 140);
        const ref = doc(this.db, `${this._scope(userId)}/accounting_mappings/${safeKey}`);
        const existing = await getDoc(ref);
        const payload = {
            source_type: sourceType,
            source_value: sourceValue,
            target_account_code: code,
            target_account_name: targetName,
            target_account_type: targetType,
            confidence: 'user_confirmed',
            status: 'active',
            updated_at: serverTimestamp()
        };
        if (existing.exists()) {
            payload.created_at = existing.data().created_at || serverTimestamp();
            await setDoc(ref, payload);
        } else {
            payload.created_at = serverTimestamp();
            await setDoc(ref, payload);
        }
        await this.addAuditLog(userId, {
            action: existing.exists() ? 'accounting_mapping.updated' : 'accounting_mapping.created',
            target_collection: 'accounting_mappings',
            target_id: safeKey,
            after: { source_type: sourceType, source_value: sourceValue, target_account_code: code },
            source: 'dashboard'
        });
        this._acctMapCache = {}; // invalidate the posting-engine mapping cache
        return { id: safeKey, ...payload };
    }

    // =====================================================================
    // TAX CENTER (Indonesia) — company tax profile
    // The profile (NPWP, PKP status, UMKM flag, default PPN rate) drives every
    // branch of the pure tax engine (assets/js/tax-engine.js). Workspace-scoped,
    // single doc id `current`. See docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md §6.
    // =====================================================================

    async getTaxProfile(userId) {
        if (!userId) return null;
        try {
            const snap = await getDoc(doc(this.db, `${this._scope(userId)}/company_tax_profile/current`));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        } catch (_) {
            return null;
        }
    }

    // Upsert the workspace tax profile. Sanitizes/validates the fields the rules
    // enforce (pkp_status enum, npwp/nik strings, default_ppn_rate 0–100, umkm bool)
    // so a bad write never reaches Firestore, then writes a tax_profile.update audit.
    async saveTaxProfile(userId, data = {}) {
        if (!userId) throw new Error('userId required');
        const pkpStatus = String(data.pkp_status || '').toLowerCase() === 'pkp' ? 'pkp' : 'non_pkp';
        let ppnRate = Math.round(Number(data.default_ppn_rate));
        if (!Number.isFinite(ppnRate) || ppnRate < 0) ppnRate = 11;
        if (ppnRate > 100) ppnRate = 100;
        const ref = doc(this.db, `${this._scope(userId)}/company_tax_profile/current`);
        const existing = await getDoc(ref);
        const payload = {
            npwp: this._nullableString(data.npwp, 32),
            nik: this._nullableString(data.nik, 32),
            pkp_status: pkpStatus,
            pkp_effective_date: data.pkp_effective_date || null,
            umkm_final: data.umkm_final === true,
            tax_office_kpp: this._nullableString(data.tax_office_kpp, 120),
            business_classification: this._nullableString(data.business_classification, 120),
            default_ppn_rate: ppnRate,
            updated_at: serverTimestamp(),
            updated_by: (this.actorUid || userId)
        };
        payload.created_at = existing.exists() ? (existing.data().created_at || serverTimestamp()) : serverTimestamp();
        await setDoc(ref, payload);
        await this.addAuditLog(userId, {
            action: 'tax_profile.update',
            target_collection: 'company_tax_profile',
            target_id: 'current',
            after: { pkp_status: pkpStatus, umkm_final: payload.umkm_final, default_ppn_rate: ppnRate },
            source: 'dashboard'
        });
        this._taxProfileCache = {}; // invalidate the posting-engine profile cache
        return { id: 'current', ...payload };
    }

    // Active tax mappings (category/type → tax_code). Drives explicit-treatment-only
    // PPN posting (see tax-engine selectExplicitTaxRules). Archived rows excluded.
    async getTaxMappings(userId) {
        if (!userId) return [];
        try {
            const snap = await getDocs(collection(this.db, `${this._scope(userId)}/tax_mappings`));
            return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.status !== 'archived');
        } catch (_) {
            return [];
        }
    }

    // Upsert a tax mapping. Deterministic doc id from source_type+value so a re-save
    // updates rather than duplicates. tax_rate_percent is derived from the engine's
    // rate table so UI and posting can never disagree. Writes an audit log and
    // invalidates the posting-engine mapping cache.
    async saveTaxMapping(userId, data = {}) {
        if (!userId) throw new Error('userId required');
        const sourceType = data.source_type === 'transaction_type' ? 'transaction_type' : 'transaction_category';
        const sourceValue = this._nullableString(data.source_value, 60);
        if (!sourceValue) throw new Error('source_value required');
        const taxCode = this._nullableString(data.tax_code, 40);
        if (!taxCode || !TAX_RATES[taxCode]) throw new Error('valid tax_code required');
        const safeKey = `${sourceType}__${sourceValue}`.toLowerCase().replace(/[^a-z0-9_]+/g, '-').slice(0, 140);
        const ref = doc(this.db, `${this._scope(userId)}/tax_mappings/${safeKey}`);
        const existing = await getDoc(ref);
        const payload = {
            source_type: sourceType,
            source_value: sourceValue,
            tax_code: taxCode,
            tax_rate_percent: TAX_RATES[taxCode].rate,
            status: 'active',
            updated_at: serverTimestamp(),
            created_at: existing.exists() ? (existing.data().created_at || serverTimestamp()) : serverTimestamp()
        };
        await setDoc(ref, payload);
        await this.addAuditLog(userId, {
            action: existing.exists() ? 'tax_mapping.update' : 'tax_mapping.create',
            target_collection: 'tax_mappings',
            target_id: safeKey,
            after: { source_type: sourceType, source_value: sourceValue, tax_code: taxCode },
            source: 'dashboard'
        });
        this._taxMapCacheTax = {};
        return { id: safeKey, ...payload };
    }

    // Soft-archive a tax mapping (status → archived). Merge keeps tax_code present so
    // the update passes the rules validator. Invalidates the posting cache.
    async archiveTaxMapping(userId, mappingId) {
        if (!userId || !mappingId) throw new Error('userId + mappingId required');
        const ref = doc(this.db, `${this._scope(userId)}/tax_mappings/${mappingId}`);
        await setDoc(ref, { status: 'archived', updated_at: serverTimestamp() }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'tax_mapping.archive', target_collection: 'tax_mappings', target_id: mappingId, source: 'dashboard'
        });
        this._taxMapCacheTax = {};
    }

    // PPN for a period straight from the ledger (the source of truth), via a targeted
    // 2-doc read of the deterministic ledger_balances ids (never scan the whole
    // collection — it is large). output = 2100 credit balance, input = 1130 debit
    // balance, payable = output − input. Returns zeros on any error.
    async getPpnLedger(userId, periodKey) {
        const zero = { output: 0, input: 0, payable: 0 };
        if (!userId || !periodKey) return zero;
        try {
            const scope = this._scope(userId);
            const [outSnap, inSnap] = await Promise.all([
                getDoc(doc(this.db, `${scope}/ledger_balances/${periodKey}__2100`)),
                getDoc(doc(this.db, `${scope}/ledger_balances/${periodKey}__1130`))
            ]);
            const od = outSnap.exists() ? outSnap.data() : {};
            const id = inSnap.exists() ? inSnap.data() : {};
            const output = (Number(od.credit_total) || 0) - (Number(od.debit_total) || 0);
            const input = (Number(id.debit_total) || 0) - (Number(id.credit_total) || 0);
            return { output, input, payable: output - input };
        } catch (_) {
            return zero;
        }
    }

    // Withholding for a period from the ledger: PPh Payable (2110 credit balance, what
    // we withheld and owe DJP) and creditable PPh withheld by customers (1150 debit
    // balance). Targeted 2-doc read by deterministic id; zeros on error.
    async getWhtLedger(userId, periodKey) {
        const zero = { payable: 0, credit: 0 };
        if (!userId || !periodKey) return zero;
        try {
            const scope = this._scope(userId);
            const [pay, cr] = await Promise.all([
                getDoc(doc(this.db, `${scope}/ledger_balances/${periodKey}__2110`)),
                getDoc(doc(this.db, `${scope}/ledger_balances/${periodKey}__1150`))
            ]);
            const p = pay.exists() ? pay.data() : {};
            const c = cr.exists() ? cr.data() : {};
            const payable = (Number(p.credit_total) || 0) - (Number(p.debit_total) || 0);
            const credit = (Number(c.debit_total) || 0) - (Number(c.credit_total) || 0);
            return { payable, credit };
        } catch (_) {
            return zero;
        }
    }

    // --- TAX PERIODS (compute / file) -----------------------------------
    // Compute a monthly tax period summary from the ledger (the source of truth) and
    // persist it as a cached tax_periods doc (id `monthly-YYYY-MM`). Status → computed.
    // Refuses to recompute a filed/settled period. Writes a tax_period.compute audit.
    async computeTaxPeriod(userId, periodKey) {
        if (!userId || !periodKey) throw new Error('userId + periodKey required');
        const [ppn, wht] = await Promise.all([this.getPpnLedger(userId, periodKey), this.getWhtLedger(userId, periodKey)]);
        const ref = doc(this.db, `${this._scope(userId)}/tax_periods/monthly-${periodKey}`);
        const existing = await getDoc(ref);
        if (existing.exists() && ['filed', 'settled'].includes(existing.data().status)) {
            throw new Error('This period is filed and cannot be recomputed.');
        }
        const payload = {
            period_type: 'monthly',
            period_key: periodKey,
            status: 'computed',
            ppn_output: ppn.output, ppn_input: ppn.input, ppn_payable: ppn.payable,
            pph_withheld: wht.payable, pph_credit: wht.credit,
            updated_at: serverTimestamp(),
            created_at: existing.exists() ? (existing.data().created_at || serverTimestamp()) : serverTimestamp()
        };
        await setDoc(ref, payload, { merge: true });
        await this.addAuditLog(userId, {
            action: 'tax_period.compute', target_collection: 'tax_periods', target_id: `monthly-${periodKey}`,
            after: { ppn_payable: ppn.payable, pph_withheld: wht.payable, pph_credit: wht.credit }, source: 'dashboard'
        });
        return { id: `monthly-${periodKey}`, ...payload };
    }

    // Mark a computed period as filed (locks it from recompute). Audited.
    async fileTaxPeriod(userId, periodKey) {
        if (!userId || !periodKey) throw new Error('userId + periodKey required');
        const ref = doc(this.db, `${this._scope(userId)}/tax_periods/monthly-${periodKey}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Compute the period before filing.');
        await setDoc(ref, {
            status: 'filed', closed_by: (this.actorUid || userId), closed_at: serverTimestamp(), updated_at: serverTimestamp()
        }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'tax_period.close', target_collection: 'tax_periods', target_id: `monthly-${periodKey}`, source: 'dashboard'
        });
    }

    async getTaxPeriod(userId, periodKey) {
        if (!userId || !periodKey) return null;
        try {
            const snap = await getDoc(doc(this.db, `${this._scope(userId)}/tax_periods/monthly-${periodKey}`));
            return snap.exists() ? { id: snap.id, ...snap.data() } : null;
        } catch (_) { return null; }
    }

    async listTaxPeriods(userId, { max = 24 } = {}) {
        if (!userId) return [];
        try {
            const snap = await getDocs(collection(this.db, `${this._scope(userId)}/tax_periods`));
            // Real tax periods can't be in the far future; drop implausible years
            // (e.g. QA/synthetic docs) BEFORE the sort+slice so they can never
            // crowd out the current month.
            const maxYear = new Date().getFullYear() + 1;
            return snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter((p) => {
                    const m = /^(\d{4})/.exec(String(p.period_key || ''));
                    return m && Number(m[1]) <= maxYear;
                })
                .sort((a, b) => String(b.period_key || '').localeCompare(String(a.period_key || '')))
                .slice(0, max);
        } catch (_) { return []; }
    }

    // Record a tax filing for a period (the DJP-facing artifact: SPT type, reference
    // number, status). Append-only collection; audited (tax_filing.submit).
    async addTaxFiling(userId, { periodKey, filing_type = 'SPT_PPN', reference_number = null, external_link = null, status = 'filed' } = {}) {
        if (!userId || !periodKey) throw new Error('userId + periodKey required');
        const ref = doc(collection(this.db, `${this._scope(userId)}/tax_filings`));
        const payload = {
            period_id: `monthly-${periodKey}`,
            filing_type,
            filing_date: serverTimestamp(),
            reference_number: this._nullableString(reference_number, 80),
            external_link: this._nullableString(external_link, 300),
            status,
            filed_by: (this.actorUid || userId),
            entity_id: this._resolvedScopeId(userId),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        };
        await setDoc(ref, payload);
        await this.addAuditLog(userId, {
            action: 'tax_filing.submit', target_collection: 'tax_filings', target_id: ref.id,
            after: { period: periodKey, filing_type, status, reference_number: payload.reference_number }, source: 'dashboard'
        });
        return { id: ref.id, ...payload };
    }

    async listTaxFilings(userId, { periodKey = null, max = 50 } = {}) {
        if (!userId) return [];
        try {
            const snap = await getDocs(collection(this.db, `${this._scope(userId)}/tax_filings`));
            let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (periodKey) rows = rows.filter(r => r.period_id === `monthly-${periodKey}`);
            return rows.slice(0, max);
        } catch (_) { return []; }
    }

    // --- CORPORATE TAX (Phase 4) ----------------------------------------
    // Record a monthly PPh 25 installment. It is a creditable PREPAYMENT, so it posts
    // Dr 1140 Prepaid PPh 25 / Cr 1000 Cash — NOT tax expense — through the kernel
    // (a numbered manual journal). Audited. See INDONESIA_TAX_CENTER_ARCHITECTURE §18b.
    async recordCorporateTaxPayment(userId, { amount, reference = null } = {}) {
        if (!userId) throw new Error('userId required');
        const amt = Math.round(Number(amount) || 0);
        if (amt <= 0) throw new Error('Amount must be greater than zero.');
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const journal = buildManualJournal({
            lines: [{ account_code: '1140', debit: amt }, { account_code: '1000', credit: amt }],
            date: new Date(),
            description: 'PPh 25 installment',
            reference: this._nullableString(reference, 80),
            subtype: 'corporate_tax'
        });
        const batch = writeBatch(this.db);
        this._assignJournalNumbers([journal], await this._reserveJournalNumbers(userId, { [String(journal.period_key).slice(0, 4)]: 1 }));
        const acc = {};
        const jr = this._attachJournalToBatch(batch, scope, journal, { entityId, balanceAcc: acc });
        this._flushBalanceAcc(batch, scope, entityId, acc);
        await batch.commit();
        await this.addAuditLog(userId, {
            action: 'tax_payment.create', target_collection: 'journals', target_id: jr.id,
            after: { kind: 'pph25', amount: amt }, source: 'dashboard'
        });
        return { journal_ref: jr.id, amount: amt };
    }

    // Aggregate ledger_balances for one fiscal year: net revenue, net expense, and
    // per-account net debit (for prepaid 1140 / withheld 1150). Filters by period_key
    // year prefix. Fetches the collection and filters (like getTrialBalance).
    async _yearLedgerAggregate(userId, fiscalYear) {
        const agg = { revenue: 0, expense: 0, code: {} };
        const snap = await getDocs(collection(this.db, `${this._scope(userId)}/ledger_balances`));
        snap.docs.forEach((d) => {
            const b = d.data();
            if (String(b.period_key || '').slice(0, 4) !== String(fiscalYear)) return;
            const debit = Number(b.debit_total) || 0;
            const credit = Number(b.credit_total) || 0;
            agg.code[b.account_code] = (agg.code[b.account_code] || 0) + (debit - credit);
            if (b.account_type === 'revenue') agg.revenue += (credit - debit);
            else if (b.account_type === 'expense') agg.expense += (debit - credit);
        });
        return agg;
    }

    // Compute the annual corporate income tax for a fiscal year. Scheme follows the
    // profile: UMKM final = 0.5% × turnover; otherwise ordinary CIT = 22% × taxable
    // income (book net income ± fiscal adjustment). PPh 29 = CIT − prepaid PPh 25
    // (1140) − PPh withheld by others (1150). Pure read (no write) — for preview.
    async computeAnnualCorporateTax(userId, fiscalYear, { fiscalAdjustment = 0 } = {}) {
        if (!userId || !fiscalYear) throw new Error('userId + fiscalYear required');
        const [profile, agg] = await Promise.all([this.getTaxProfile(userId), this._yearLedgerAggregate(userId, fiscalYear)]);
        const umkm = !!(profile && profile.umkm_final === true);
        const turnover = Math.max(Math.round(agg.revenue), 0);
        const netIncome = Math.round(agg.revenue - agg.expense);
        const adj = Math.round(Number(fiscalAdjustment) || 0);
        const taxableIncome = netIncome + adj;
        const cit = umkm ? Math.round(turnover * 0.005) : Math.round(Math.max(taxableIncome, 0) * 0.22);
        const prepaid = Math.max(Math.round(agg.code['1140'] || 0), 0);
        const withheld = Math.max(Math.round(agg.code['1150'] || 0), 0);
        return {
            fiscal_year: String(fiscalYear), scheme: umkm ? 'umkm_final' : 'ordinary',
            turnover, net_income: netIncome, fiscal_adjustment: adj, taxable_income: taxableIncome,
            cit, prepaid, withheld, pph29: cit - prepaid - withheld
        };
    }

    // Post the annual reconciliation: recognise CIT (Dr 6500), consume the prepaid +
    // withheld credits (Cr 1140 / Cr 1150), and book the remainder to 2200 (PPh 29
    // payable, or a debit overpayment). Writes an annual tax_periods doc + audit.
    // Idempotent: refuses if the year is already reconciled.
    // Fiscal-adjustment line list for a fiscal year (permanent/temporary book-to-tax
    // differences). Stored as data on the annual tax_periods doc (status stays 'open'
    // until reconciliation posts) so the list survives sessions and lands on the
    // audit trail. Editable only until the year is reconciled.
    _normalizeFiscalAdjustments(lines) {
        return (Array.isArray(lines) ? lines : [])
            .map((l) => ({
                label: this._nullableString(l && l.label, 120) || 'Adjustment',
                amount: Math.round(Number(l && l.amount) || 0),
                kind: (l && l.kind) === 'temporary' ? 'temporary' : 'permanent'
            }))
            .filter((l) => l.amount !== 0)
            .slice(0, 40);
    }

    async getFiscalAdjustments(userId, fiscalYear) {
        if (!userId || !fiscalYear) return [];
        try {
            const snap = await getDoc(doc(this.db, `${this._scope(userId)}/tax_periods/annual-${fiscalYear}`));
            const rows = snap.exists() ? snap.data().fiscal_adjustments : null;
            return Array.isArray(rows) ? rows : [];
        } catch (_) { return []; }
    }

    async saveFiscalAdjustments(userId, fiscalYear, lines) {
        if (!userId || !/^\d{4}$/.test(String(fiscalYear))) throw new Error('userId + 4-digit fiscalYear required');
        const clean = this._normalizeFiscalAdjustments(lines);
        const ref = doc(this.db, `${this._scope(userId)}/tax_periods/annual-${fiscalYear}`);
        const existing = await getDoc(ref);
        if (existing.exists() && ['computed', 'filed', 'settled'].includes(existing.data().status)) {
            throw new Error(`Annual tax for ${fiscalYear} is already reconciled — adjustments are locked.`);
        }
        await setDoc(ref, {
            period_type: 'annual',
            period_key: String(fiscalYear),
            status: existing.exists() ? (existing.data().status || 'open') : 'open',
            fiscal_adjustments: clean,
            fiscal_adjustment_total: clean.reduce((s, l) => s + l.amount, 0),
            updated_at: serverTimestamp(),
            created_at: existing.exists() ? (existing.data().created_at || serverTimestamp()) : serverTimestamp()
        }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'tax_period.adjustments_updated', target_collection: 'tax_periods', target_id: `annual-${fiscalYear}`,
            after: { lines: clean.length, total: clean.reduce((s, l) => s + l.amount, 0) }, source: 'dashboard'
        });
        return clean;
    }

    async postAnnualCorporateTax(userId, fiscalYear, { fiscalAdjustment = 0 } = {}) {
        const r = await this.computeAnnualCorporateTax(userId, fiscalYear, { fiscalAdjustment });
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const pref = doc(this.db, `${scope}/tax_periods/annual-${r.fiscal_year}`);
        const existing = await getDoc(pref);
        if (existing.exists() && ['computed', 'filed', 'settled'].includes(existing.data().status)) {
            throw new Error(`Annual tax for ${r.fiscal_year} is already reconciled.`);
        }
        const lines = [];
        if (r.cit > 0) lines.push({ account_code: '6500', debit: r.cit });
        if (r.prepaid > 0) lines.push({ account_code: '1140', credit: r.prepaid });
        if (r.withheld > 0) lines.push({ account_code: '1150', credit: r.withheld });
        if (r.pph29 > 0) lines.push({ account_code: '2200', credit: r.pph29 });
        else if (r.pph29 < 0) lines.push({ account_code: '2200', debit: -r.pph29 });
        if (!lines.length) throw new Error(`Nothing to reconcile for ${r.fiscal_year}.`);
        const journal = buildManualJournal({
            lines, date: new Date(`${r.fiscal_year}-12-31T00:00:00`),
            description: `Annual corporate tax ${r.fiscal_year} (${r.scheme === 'umkm_final' ? 'UMKM 0.5%' : 'CIT 22%'})`,
            subtype: 'corporate_annual'
        });
        const batch = writeBatch(this.db);
        this._assignJournalNumbers([journal], await this._reserveJournalNumbers(userId, { [String(journal.period_key).slice(0, 4)]: 1 }));
        const acc = {};
        const jr = this._attachJournalToBatch(batch, scope, journal, { entityId, balanceAcc: acc });
        this._flushBalanceAcc(batch, scope, entityId, acc);
        batch.set(pref, {
            period_type: 'annual', period_key: String(r.fiscal_year), status: 'computed', scheme: r.scheme,
            cit: r.cit, prepaid_credits: r.prepaid + r.withheld, pph29_payable: Math.max(r.pph29, 0),
            journal_ref: jr.id, updated_at: serverTimestamp(),
            created_at: existing.exists() ? (existing.data().created_at || serverTimestamp()) : serverTimestamp()
        }, { merge: true });
        await batch.commit();
        await this.addAuditLog(userId, {
            action: 'tax_period.compute', target_collection: 'tax_periods', target_id: `annual-${r.fiscal_year}`,
            after: { scheme: r.scheme, cit: r.cit, pph29: r.pph29 }, source: 'dashboard'
        });
        return { ...r, journal_ref: jr.id };
    }

    // Corporate-tax credit position across all periods (lifetime running balances):
    // prepaid PPh 25 (1140), PPh withheld by others (1150), and PPh 29 payable (2200).
    async getCorporateTaxSummary(userId) {
        const zero = { prepaid_pph25: 0, pph_credit: 0, pph29_payable: 0 };
        if (!userId) return zero;
        try {
            const scope = this._scope(userId);
            const q = (code) => getDocs(query(collection(this.db, `${scope}/ledger_balances`), where('account_code', '==', code)));
            const [a, b, c] = await Promise.all([q('1140'), q('1150'), q('2200')]);
            const sum = (snap, side) => snap.docs.reduce((s, d) => s + (Number(d.data()[side]) || 0), 0);
            return {
                prepaid_pph25: sum(a, 'debit_total') - sum(a, 'credit_total'),
                pph_credit: sum(b, 'debit_total') - sum(b, 'credit_total'),
                pph29_payable: sum(c, 'credit_total') - sum(c, 'debit_total')
            };
        } catch (_) {
            return zero;
        }
    }

    // Read the tax lines for a period (optionally a direction). Returns [] on any
    // error so the Tax Center renders an empty state rather than throwing. Posting
    // of tax_transactions is wired in a later phase; today this is normally empty.
    async getTaxTransactions(userId, { periodKey = null, max = 500 } = {}) {
        if (!userId) return [];
        try {
            const base = collection(this.db, `${this._scope(userId)}/tax_transactions`);
            const q = periodKey
                ? query(base, where('period_key', '==', periodKey), limit(max))
                : query(base, limit(max));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            return [];
        }
    }

    // =====================================================================
    // ACCOUNTING KERNEL (double-entry posting, ledger, periods)
    // The pure rules live in accounting-engine.js; this section is the
    // Firestore I/O layer that posts journals atomically with the business
    // document and reads back the ledger. See docs/PROJECT_BACKGROUND.md §4n.
    // =====================================================================

    // Bare workspace/user id (not the path) for entity_id stamping. Mirrors the
    // resolution _scope() does, but returns just the id.
    _resolvedScopeId(scopeId) {
        if (!this._workspaceMode()) return scopeId;
        let wsId = (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.id) || null;
        if (!wsId && typeof sessionStorage !== 'undefined') {
            try { const c = JSON.parse(sessionStorage.getItem('fluxy_ws') || 'null'); if (c && c.id) wsId = c.id; } catch (_) {}
        }
        return wsId || scopeId;
    }

    // Saved account mappings as the engine's { 'category:X' | 'type:y' -> code }
    // shape. Cached per scope for the session so create-time posting stays fast.
    async _loadAcctMappings(userId) {
        this._acctMapCache = this._acctMapCache || {};
        const key = this._scope(userId);
        if (this._acctMapCache[key]) return this._acctMapCache[key];
        const raw = await this.getAccountingMappings(userId).catch(() => []);
        const map = {};
        raw.forEach((m) => {
            if (!m.target_account_code) return;
            if (m.source_type === 'transaction_category') map[`category:${m.source_value}`] = m.target_account_code;
            else if (m.source_type === 'transaction_type') map[`type:${String(m.source_value).toLowerCase()}`] = m.target_account_code;
        });
        this._acctMapCache[key] = map;
        return map;
    }

    // --- TAX CENTER posting integration ---------------------------------
    // Cached workspace tax profile (drives PKP gating in the tax engine).
    async _loadTaxProfile(userId) {
        this._taxProfileCache = this._taxProfileCache || {};
        const key = this._scope(userId);
        if (key in this._taxProfileCache) return this._taxProfileCache[key];
        const p = await this.getTaxProfile(userId).catch(() => null);
        this._taxProfileCache[key] = p;
        return p;
    }
    // Cached category/type → tax_code map (explicit tax treatments only).
    async _loadTaxMappings(userId) {
        this._taxMapCacheTax = this._taxMapCacheTax || {};
        const key = this._scope(userId);
        if (this._taxMapCacheTax[key]) return this._taxMapCacheTax[key];
        const map = {};
        try {
            const snap = await getDocs(collection(this.db, `${key}/tax_mappings`));
            snap.forEach((d) => {
                const m = d.data();
                if (m.status === 'archived' || !m.tax_code) return;
                if (m.source_type === 'transaction_category') map[`category:${m.source_value}`] = m.tax_code;
                else if (m.source_type === 'transaction_type') map[`type:${String(m.source_value).toLowerCase()}`] = m.tax_code;
            });
        } catch (_) { /* collection may not exist yet */ }
        this._taxMapCacheTax[key] = map;
        return map;
    }
    // Graft PPN gross-up lines onto a freshly-built journal IN PLACE (tax-exclusive
    // model). Only fires when the document carries an explicit tax treatment
    // (tax_code or a saved tax_mapping) — so untaxed documents post byte-identical to
    // before. Each appended pair is balanced, so totals stay equal. Returns the
    // tax_transactions metadata rows for the caller to stage (post path only).
    // Never throws — tax must never block the base accounting post.
    async _applyTaxAppendix(userId, journal, sourceCollection, payload) {
        try {
            if (!journal || !Array.isArray(journal.lines)) return [];
            const [profile, taxMappings] = await Promise.all([
                this._loadTaxProfile(userId),
                this._loadTaxMappings(userId)
            ]);
            if (!profile) return [];
            const appendix = buildTaxAppendix({
                baseJournal: journal, collection: sourceCollection, document: payload, profile, mappings: taxMappings
            });
            if (!appendix || !appendix.lines.length) return [];
            journal.lines = journal.lines.concat(appendix.lines);
            journal.total_debit = journal.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
            journal.total_credit = journal.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
            journal.is_balanced = journal.total_debit === journal.total_credit;
            return appendix.tax_transactions || [];
        } catch (_) {
            return [];
        }
    }

    // Write one journal + its ledger_balances increments into an existing batch.
    // Returns the new journal DocumentReference. Shared by document posting,
    // opening balances, period close, and corrections.
    //
    // When `balanceAcc` is provided, ledger_balances increments are accumulated
    // into it instead of written immediately — the caller flushes once via
    // _flushBalanceAcc. This is REQUIRED when a single batch posts more than one
    // journal touching the same account+period (corrections post a reversal + a
    // repost): Firestore forbids writing the same document twice in one batch.
    _attachJournalToBatch(batch, scope, journal, { entityId = null, balanceAcc = null } = {}) {
        const journalRef = doc(collection(this.db, `${scope}/journals`));
        batch.set(journalRef, {
            ...journal,
            entity_id: entityId,
            created_by: journal.created_by || this.actorUid || null,
            posted_by: this.actorUid || null,
            posted_at: serverTimestamp(),
            created_at: serverTimestamp()
        });
        (journal.lines || []).forEach((l) => {
            if (balanceAcc) {
                const key = `${journal.period_key}__${l.account_code}`;
                const e = balanceAcc[key] || (balanceAcc[key] = {
                    period_key: journal.period_key, account_code: l.account_code,
                    account_type: l.account_type, debit: 0, credit: 0
                });
                e.debit += Number(l.debit) || 0;
                e.credit += Number(l.credit) || 0;
                return;
            }
            batch.set(doc(this.db, `${scope}/ledger_balances/${journal.period_key}__${l.account_code}`), {
                period_key: journal.period_key,
                account_code: l.account_code,
                account_type: l.account_type,
                entity_id: entityId,
                currency: 'IDR',
                debit_total: increment(Number(l.debit) || 0),
                credit_total: increment(Number(l.credit) || 0),
                updated_at: serverTimestamp()
            }, { merge: true });
        });
        return journalRef;
    }

    // Reserve N sequential journal numbers per period-year in a single atomic
    // transaction, so concurrent posts can never collide on a number. `yearCounts`
    // is { '2026': 2, '2025': 1 }. Returns { '2026': base, ... } where the first
    // number to assign for a year is base+1. Runs BEFORE the writeBatch commit;
    // a failed batch afterwards leaves a harmless gap (never a duplicate).
    async _reserveJournalNumbers(userId, yearCounts) {
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const years = Object.keys(yearCounts || {}).filter((y) => Number(yearCounts[y]) > 0);
        if (!years.length) return {};
        const bases = {};
        await runTransaction(this.db, async (tx) => {
            const refs = years.map((y) => doc(this.db, `${scope}/counters/journal-${y}`));
            const snaps = await Promise.all(refs.map((r) => tx.get(r)));
            years.forEach((y, i) => {
                const cur = snaps[i].exists() ? Number(snaps[i].data().seq || 0) : 0;
                bases[y] = cur;
                tx.set(refs[i], {
                    seq: cur + Number(yearCounts[y]),
                    entity_id: entityId,
                    updated_at: serverTimestamp()
                }, { merge: true });
            });
        });
        return bases;
    }

    // Stamp journal_number (JE-YYYY-NNNNNN) + journal_seq onto each journal in
    // order, consuming the reserved per-year bases. Numbering follows the journal's
    // own accounting-period year. Mutates and returns the journals.
    _assignJournalNumbers(journals, bases) {
        const cursor = {};
        (journals || []).forEach((j) => {
            const y = String(j.period_key || '').slice(0, 4) || String(new Date().getFullYear());
            cursor[y] = (cursor[y] == null ? (Number(bases[y]) || 0) : cursor[y]) + 1;
            const seq = cursor[y];
            j.journal_seq = seq;
            j.journal_number = `JE-${y}-${String(seq).padStart(6, '0')}`;
        });
        return journals;
    }

    // Human-readable number of the source document for register/detail display
    // without an extra fetch. Only set when a real document number exists.
    _sourceNumberOf(sourceCollection, payload) {
        if (!payload) return null;
        if (sourceCollection === 'invoices') return payload.invoice_number || null;
        return null;
    }

    // Flush an accumulated balance map (one merged increment per account+period).
    _flushBalanceAcc(batch, scope, entityId, balanceAcc) {
        Object.values(balanceAcc).forEach((e) => {
            batch.set(doc(this.db, `${scope}/ledger_balances/${e.period_key}__${e.account_code}`), {
                period_key: e.period_key, account_code: e.account_code, account_type: e.account_type,
                entity_id: entityId, currency: 'IDR',
                debit_total: increment(e.debit), credit_total: increment(e.credit),
                updated_at: serverTimestamp()
            }, { merge: true });
        });
    }

    // The period a correction should post into: the original period if it's still
    // open, otherwise the current month (the correction-in-current-period rule —
    // never mutate a closed book's history).
    async _openTargetPeriod(userId, candidate) {
        const pk = candidate || acctPeriodKey(new Date());
        const p = await this.getPeriod(userId, pk);
        return p.status === 'open' ? pk : acctPeriodKey(new Date());
    }

    // Block edits/voids of a document whose accounting period is closed or locked.
    // A closed book must not be mutated: the user reopens the period first (or the
    // correction would silently land in a different open period, mismatching the
    // source). Throws a clear message instead of a raw Firestore permission error.
    async _assertEditablePeriod(userId, existing) {
        let pk = null;
        if (existing && existing.journal_ref) {
            const j = await this.getJournalById(userId, existing.journal_ref);
            if (j) pk = j.period_key;
        }
        if (!pk && existing) {
            const when = existing.timestamp || existing.due_date || existing.renewal_date || existing.date || null;
            if (when) {
                const date = when.toDate ? when.toDate() : (when.seconds ? new Date(when.seconds * 1000) : when);
                pk = acctPeriodKey(date);
            }
        }
        if (!pk) return;
        const period = await this.getPeriod(userId, pk);
        if (period.status === 'closed' || period.status === 'locked') {
            throw new Error(`This transaction is in a closed accounting period (${pk}). Reopen the period before editing or voiding it.`);
        }
    }

    // Keep the ledger in step with an edited/voided document. Reverses the
    // document's existing journal and (for an edit) reposts from the new state —
    // both into an OPEN period. Returns { journal_ref, accounting_status } for the
    // caller to merge into its own source-doc update (one write per doc per batch).
    // afterPayload === null means a void (reverse only, no repost). Best-effort:
    // a failure never blocks the edit/void.
    async _correctSourceJournal(userId, batch, sourceCollection, sourceRef, existing, afterPayload) {
        const result = {};
        try {
            const scope = this._scope(userId);
            const entityId = this._resolvedScopeId(userId);
            const acc = {};
            let targetPeriod = null;
            let reversal = null;
            let oldJournalId = existing && existing.journal_ref;
            if (oldJournalId) {
                const oldJournal = await this.getJournalById(userId, oldJournalId);
                if (oldJournal && !oldJournal.reversed_by_journal_id) {
                    targetPeriod = await this._openTargetPeriod(userId, oldJournal.period_key);
                    reversal = buildReversalJournal({ ...oldJournal, id: oldJournalId }, { targetPeriodKey: targetPeriod });
                } else {
                    oldJournalId = null; // already reversed / nothing to reverse
                }
            }
            let fresh = null;
            if (afterPayload) {
                const mappings = await this._loadAcctMappings(userId);
                fresh = buildJournal({
                    collection: sourceCollection, id: sourceRef.id, document: afterPayload, mappings,
                    date: afterPayload.timestamp || afterPayload.due_date || afterPayload.renewal_date || null
                });
                if (fresh) {
                    fresh.period_key = targetPeriod || await this._openTargetPeriod(userId, fresh.period_key);
                    fresh.source_number = this._sourceNumberOf(sourceCollection, afterPayload);
                    // Re-apply PPN to the repost so an edit keeps the ledger correct: the
                    // reversal above already unwinds the old journal's tax lines, and this
                    // grafts the recomputed tax onto the fresh entry. (tax_transactions
                    // detail rows are rewritten on the post path; corrections rely on the
                    // ledger + reconcile script — see INDONESIA_TAX_CENTER_ARCHITECTURE §9.)
                    await this._applyTaxAppendix(userId, fresh, sourceCollection, afterPayload);
                }
            }
            // Reserve numbers for the journals that will post (reversal first, then
            // repost) in one transaction before staging them in the batch.
            const pending = [];
            if (reversal) pending.push(reversal);
            if (fresh) pending.push(fresh);
            if (pending.length) {
                const counts = {};
                pending.forEach((j) => { const y = String(j.period_key).slice(0, 4); counts[y] = (counts[y] || 0) + 1; });
                this._assignJournalNumbers(pending, await this._reserveJournalNumbers(userId, counts));
            }
            if (reversal && oldJournalId) {
                const revRef = this._attachJournalToBatch(batch, scope, reversal, { entityId, balanceAcc: acc });
                batch.update(doc(this.db, `${scope}/journals/${oldJournalId}`), { reversed_by_journal_id: revRef.id });
            }
            if (fresh) {
                const newRef = this._attachJournalToBatch(batch, scope, fresh, { entityId, balanceAcc: acc });
                result.journal_ref = newRef.id;
                result.accounting_status = 'posted';
            } else if (afterPayload) {
                result.accounting_status = 'excluded';
            } else {
                result.accounting_status = 'reversed';
            }
            this._flushBalanceAcc(batch, scope, entityId, acc);
        } catch (err) {
            console.warn('[accounting] correction skipped:', err && err.message ? err.message : err);
        }
        return result;
    }

    // Build the journal for a business document and stage it in `batch`. Mutates
    // `payload` to carry journal_ref + accounting_status. Posting NEVER blocks the
    // document: any engine/build error marks the doc `pending` for a later sweep.
    // Block posting into a closed/locked period up front with a clear message,
    // rather than letting the journal create fail the whole batch with a raw
    // Firestore permission error. The target period is the document's effective
    // date (serverTimestamp sentinels resolve ~now → current period).
    async _assertOpenPostingPeriod(userId, when) {
        let date;
        if (when && typeof when.toDate === 'function') date = when.toDate();
        else if (when && typeof when.seconds === 'number') date = new Date(when.seconds * 1000);
        else if (when instanceof Date) date = when;
        else date = new Date();
        if (isNaN(date.getTime())) return;
        const pk = acctPeriodKey(date);
        const period = await this.getPeriod(userId, pk);
        if (period.status === 'closed' || period.status === 'locked') {
            throw new Error(`Cannot post to a closed accounting period (${pk}). Reopen the period, or use a date in an open period.`);
        }
    }

    async _postSourceJournal(userId, batch, sourceCollection, sourceRef, payload, opts = {}) {
        await this._assertOpenPostingPeriod(userId, opts.date || payload.timestamp || payload.due_date || payload.renewal_date || null);
        try {
            const mappings = await this._loadAcctMappings(userId);
            const journal = buildJournal({
                collection: sourceCollection,
                id: sourceRef.id,
                document: payload,
                mappings,
                date: opts.date || payload.timestamp || payload.due_date || payload.renewal_date || null
            });
            if (!journal) { payload.accounting_status = 'excluded'; return null; }
            journal.source_number = this._sourceNumberOf(sourceCollection, payload);
            // Tax Center: graft PPN gross-up lines IN PLACE before numbering/attach, so
            // the journal number, ledger_balances, and rules balance-check all see the
            // final lines. No-op unless the document has an explicit tax treatment.
            const taxTxRows = await this._applyTaxAppendix(userId, journal, sourceCollection, payload);
            const bases = await this._reserveJournalNumbers(userId, { [String(journal.period_key).slice(0, 4)]: 1 });
            this._assignJournalNumbers([journal], bases);
            const scope = this._scope(userId);
            const entityId = this._resolvedScopeId(userId);
            // Accumulate ledger_balances and flush once: a tax gross-up line reuses an
            // existing account (Cash / A-R / A-P), so writing balances per-line would
            // hit the same ledger_balances doc twice in one batch — which Firestore
            // forbids. The accumulator collapses same-account lines into one increment.
            const acc = {};
            const journalRef = this._attachJournalToBatch(batch, scope, journal, { entityId, balanceAcc: acc });
            this._flushBalanceAcc(batch, scope, entityId, acc);
            payload.journal_ref = journalRef.id;
            payload.accounting_status = 'posted';
            // Stage one tax_transactions row per PPN line, linked to the journal.
            (taxTxRows || []).forEach((t) => {
                const tref = doc(collection(this.db, `${scope}/tax_transactions`));
                batch.set(tref, {
                    ...t,
                    source_collection: sourceCollection,
                    source_id: sourceRef.id,
                    source_number: journal.source_number || null,
                    journal_ref: journalRef.id,
                    entity_id: entityId,
                    status: 'posted',
                    created_by: this.actorUid || userId,
                    created_at: serverTimestamp()
                });
            });
            return journalRef.id;
        } catch (err) {
            if (err && typeof err.message === 'string' && /cannot post to a closed accounting period/i.test(err.message)) {
                throw err;
            }
            console.warn('[accounting] posting skipped, marked pending:', err && err.message ? err.message : err);
            payload.accounting_status = 'pending';
            return null;
        }
    }

    // Count source documents awaiting a journal. Bulk imports (CSV, bank
    // statements) mark rows accounting_status:'pending' instead of posting inline.
    async countPendingPostings(userId, collections = ['transactions', 'bills', 'subscriptions']) {
        const scope = this._scope(userId);
        const counts = await Promise.all(collections.map(async (col) => {
            try {
                const snap = await getDocs(query(collection(this.db, `${scope}/${col}`), where('accounting_status', '==', 'pending')));
                return snap.size;
            } catch (_) { return 0; }
        }));
        return counts.reduce((a, b) => a + b, 0);
    }

    // Sweep: post journals for documents marked accounting_status:'pending' (from
    // CSV / bank-statement bulk imports that skipped inline posting). Numbered like
    // live posting, idempotent (only touches 'pending'), chunked to respect the
    // 500-write batch ceiling, and never posts into a CLOSED period (those stay
    // pending and are reported). Returns { posted, excluded, skippedClosed }.
    async postPendingJournals(userId, { collections = ['transactions', 'bills', 'subscriptions'], max = 1000 } = {}) {
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const mappings = await this._loadAcctMappings(userId);

        const items = [];
        for (const col of collections) {
            try {
                const snap = await getDocs(query(collection(this.db, `${scope}/${col}`), where('accounting_status', '==', 'pending'), limit(max)));
                snap.forEach((d) => items.push({ collection: col, ref: d.ref, id: d.id, data: d.data() }));
            } catch (_) { /* collection may not exist */ }
        }
        if (!items.length) return { posted: 0, excluded: 0, skippedClosed: 0 };

        const periodsSnap = await getDocs(collection(this.db, `${scope}/periods`));
        const closed = new Set();
        periodsSnap.forEach((d) => { const p = d.data(); if (p.status === 'closed' || p.status === 'locked') closed.add(p.period_key); });

        const toPost = [];
        const toExclude = [];
        let skippedClosed = 0;
        for (const it of items) {
            const journal = buildJournal({
                collection: it.collection, id: it.id, document: it.data, mappings,
                date: it.data.timestamp || it.data.due_date || it.data.renewal_date || null
            });
            if (!journal) { toExclude.push(it.ref); continue; }
            if (closed.has(journal.period_key)) { skippedClosed++; continue; }
            journal.source_number = this._sourceNumberOf(it.collection, it.data);
            toPost.push({ ref: it.ref, journal });
        }

        if (toPost.length) {
            const counts = {};
            toPost.forEach((p) => { const y = String(p.journal.period_key).slice(0, 4); counts[y] = (counts[y] || 0) + 1; });
            this._assignJournalNumbers(toPost.map((p) => p.journal), await this._reserveJournalNumbers(userId, counts));
        }

        let posted = 0;
        let excluded = 0;
        const CHUNK = 120;
        for (let i = 0; i < toPost.length; i += CHUNK) {
            const slice = toPost.slice(i, i + CHUNK);
            const batch = writeBatch(this.db);
            const acc = {};
            slice.forEach((p) => {
                const jr = this._attachJournalToBatch(batch, scope, p.journal, { entityId, balanceAcc: acc });
                batch.update(p.ref, { journal_ref: jr.id, accounting_status: 'posted' });
            });
            this._flushBalanceAcc(batch, scope, entityId, acc);
            await batch.commit();
            posted += slice.length;
        }
        for (let i = 0; i < toExclude.length; i += 400) {
            const slice = toExclude.slice(i, i + 400);
            const batch = writeBatch(this.db);
            slice.forEach((ref) => batch.update(ref, { accounting_status: 'excluded' }));
            await batch.commit();
            excluded += slice.length;
        }
        if (posted || excluded) {
            await this._auditCreateBestEffort(userId, 'journal.sweep', 'journals', '', { posted, excluded, skipped_closed: skippedClosed });
        }
        return { posted, excluded, skippedClosed };
    }

    // Idempotent Chart of Accounts seed. Writes only the accounts that don't yet
    // exist, so it is safe to call on every Accounting Center load.
    async seedChartOfAccounts(userId) {
        const scope = this._scope(userId);
        const existing = await getDocs(collection(this.db, `${scope}/chart_of_accounts`));
        const have = new Set(existing.docs.map((d) => d.id));
        const entityId = this._resolvedScopeId(userId);
        const batch = writeBatch(this.db);
        let created = 0;
        CHART_OF_ACCOUNTS_SEED.forEach((a) => {
            if (have.has(a.code)) return;
            batch.set(doc(this.db, `${scope}/chart_of_accounts/${a.code}`), {
                code: a.code,
                name: a.name,
                type: a.type,
                subtype: null,
                parent_code: null,
                normal_balance: (a.type === 'asset' || a.type === 'expense') ? 'debit' : 'credit',
                is_active: true,
                currency: 'IDR',
                entity_id: entityId,
                opening_balance: 0,
                created_at: serverTimestamp()
            });
            created += 1;
        });
        if (created) await batch.commit();
        return created;
    }

    async getChartOfAccounts(userId) {
        const snap = await getDocs(collection(this.db, `${this._scope(userId)}/chart_of_accounts`));
        return snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    }

    // Recent journals (newest first). Posted journals come from the posted_at-ordered
    // query; drafts (which carry no posted_at, so the order query omits them) are
    // fetched separately and surfaced first when includeDrafts is set. All other
    // filters apply client-side, so no composite index is required at this volume.
    // GL/trial-balance callers leave includeDrafts off — drafts are not in the ledger.
    async listJournals(userId, {
        periodKey: pk = null, accountCode = null, status = null, journalType = null,
        sourceCollection = null, createdBy = null, amountMin = null, amountMax = null,
        search = null, includeDrafts = false, max = 200
    } = {}) {
        const coll = collection(this.db, `${this._scope(userId)}/journals`);
        const tasks = [getDocs(query(coll, orderBy('posted_at', 'desc'), limit(max)))];
        if (includeDrafts) tasks.push(getDocs(query(coll, where('status', '==', 'draft'), limit(50))));
        const snaps = await Promise.all(tasks);
        let rows = snaps[0].docs.map((d) => ({ id: d.id, ...d.data() }));
        if (includeDrafts && snaps[1]) {
            rows = [...snaps[1].docs.map((d) => ({ id: d.id, ...d.data() })), ...rows];
        }
        const typeOf = (j) => j.journal_type || (j.posting_rule_id === 'MANUAL' ? 'manual' : 'system');
        if (pk) rows = rows.filter((j) => j.period_key === pk);
        if (accountCode) rows = rows.filter((j) => (j.lines || []).some((l) => l.account_code === accountCode));
        if (status) rows = rows.filter((j) => (j.status || 'posted') === status);
        if (journalType) rows = rows.filter((j) => typeOf(j) === journalType);
        if (sourceCollection) {
            rows = sourceCollection === 'manual'
                ? rows.filter((j) => !(j.source && j.source.collection))
                : rows.filter((j) => (j.source && j.source.collection) === sourceCollection);
        }
        if (createdBy) rows = rows.filter((j) => (j.created_by || j.posted_by) === createdBy);
        if (amountMin != null) rows = rows.filter((j) => Number(j.total_debit || 0) >= amountMin);
        if (amountMax != null) rows = rows.filter((j) => Number(j.total_debit || 0) <= amountMax);
        if (search) {
            const q = String(search).toLowerCase();
            rows = rows.filter((j) => [j.journal_number, j.description, j.memo, j.source_number, j.posting_rule_id]
                .some((v) => String(v || '').toLowerCase().includes(q)));
        }
        return rows;
    }

    async getJournalById(userId, journalId) {
        if (!journalId) return null;
        const s = await getDoc(doc(this.db, `${this._scope(userId)}/journals/${journalId}`));
        return s.exists() ? { id: s.id, ...s.data() } : null;
    }

    // Trial balance from the running ledger_balances snapshots (not by summing all
    // journal lines — that is the §7 scalability requirement). Optionally scoped to
    // one period. Each account nets to a single debit- or credit-column figure.
    async getTrialBalance(userId, { periodKey: pk = null } = {}) {
        const [snap, coa] = await Promise.all([
            getDocs(collection(this.db, `${this._scope(userId)}/ledger_balances`)),
            this.getChartOfAccounts(userId)
        ]);
        const meta = {};
        coa.forEach((a) => { meta[a.code] = { name: a.name, type: a.type }; });
        const agg = {};
        snap.docs.forEach((d) => {
            const b = d.data();
            if (pk && b.period_key !== pk) return;
            const c = b.account_code;
            if (!agg[c]) {
                agg[c] = {
                    account_code: c,
                    account_type: (meta[c] && meta[c].type) || b.account_type || 'asset',
                    account_name: (meta[c] && meta[c].name) || c,
                    debit_total: 0,
                    credit_total: 0
                };
            }
            agg[c].debit_total += Number(b.debit_total || 0);
            agg[c].credit_total += Number(b.credit_total || 0);
        });
        const rows = Object.values(agg)
            .map((r) => {
                const net = r.debit_total - r.credit_total;
                return {
                    ...r,
                    debit_amount: net > 0 ? net : 0,
                    credit_amount: net < 0 ? -net : 0,
                    balance: signedBalance(r.account_type, r.debit_total, r.credit_total)
                };
            })
            .filter((r) => r.debit_total || r.credit_total)
            .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));
        const totalDebit = rows.reduce((s, r) => s + r.debit_amount, 0);
        const totalCredit = rows.reduce((s, r) => s + r.credit_amount, 0);
        return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
    }

    // General ledger for one account: every journal line that touches the account,
    // with a running balance in the account's natural direction.
    async getGeneralLedger(userId, accountCode, { periodKey: pk = null, max = 300 } = {}) {
        if (!accountCode) return { account_code: accountCode, entries: [], closing: 0 };
        const journals = await this.listJournals(userId, { periodKey: pk, accountCode, max });
        const coa = await this.getChartOfAccounts(userId);
        const acct = coa.find((a) => a.code === accountCode);
        const type = acct ? acct.type : 'asset';
        const ordered = journals.slice().sort((a, b) => this._journalSortKey(a) - this._journalSortKey(b));
        let running = 0;
        const entries = [];
        ordered.forEach((j) => {
            (j.lines || []).filter((l) => l.account_code === accountCode).forEach((l) => {
                running += signedBalance(type, l.debit, l.credit);
                entries.push({
                    journal_id: j.id,
                    period_key: j.period_key,
                    posting_rule_id: j.posting_rule_id,
                    source: j.source || null,
                    memo: l.memo || j.memo || '',
                    debit: Number(l.debit) || 0,
                    credit: Number(l.credit) || 0,
                    running_balance: running
                });
            });
        });
        return { account_code: accountCode, account_name: acct ? acct.name : accountCode, account_type: type, entries, closing: running };
    }

    // General ledger for EVERY account that has activity, built from a single
    // journals fetch (posted only — drafts are not in the ledger) and grouped by
    // account, each with its own running balance. Powers the GL "All accounts"
    // view. Bounded by `max` journals to keep the all-accounts render light.
    async getGeneralLedgerAll(userId, { periodKey: pk = null, max = 500 } = {}) {
        const [journals, coa] = await Promise.all([
            this.listJournals(userId, { periodKey: pk, max }),
            this.getChartOfAccounts(userId)
        ]);
        const meta = {};
        coa.forEach((a) => { meta[a.code] = { name: a.name, type: a.type }; });
        const ordered = journals.slice().sort((a, b) => this._journalSortKey(a) - this._journalSortKey(b));
        const acctMap = {};
        ordered.forEach((j) => {
            (j.lines || []).forEach((l) => {
                const code = l.account_code;
                const type = (meta[code] && meta[code].type) || l.account_type || 'asset';
                const acc = acctMap[code] || (acctMap[code] = {
                    account_code: code,
                    account_name: (meta[code] && meta[code].name) || l.account_name || code,
                    account_type: type,
                    entries: [],
                    running: 0
                });
                acc.running += signedBalance(type, l.debit, l.credit);
                acc.entries.push({
                    journal_id: j.id,
                    period_key: j.period_key,
                    posting_rule_id: j.posting_rule_id,
                    source: j.source || null,
                    memo: l.memo || j.memo || '',
                    debit: Number(l.debit) || 0,
                    credit: Number(l.credit) || 0,
                    running_balance: acc.running
                });
            });
        });
        return Object.values(acctMap)
            .map((a) => ({ account_code: a.account_code, account_name: a.account_name, account_type: a.account_type, entries: a.entries, closing: a.running }))
            .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));
    }

    _journalSortKey(j) {
        const t = j.posted_at;
        if (t && typeof t.toMillis === 'function') return t.toMillis();
        if (t && typeof t.seconds === 'number') return t.seconds * 1000;
        return 0;
    }

    async getPeriod(userId, pk) {
        if (!pk) return { period_key: pk, status: 'open' };
        const s = await getDoc(doc(this.db, `${this._scope(userId)}/periods/${pk}`));
        return s.exists() ? { id: s.id, ...s.data() } : { period_key: pk, status: 'open' };
    }

    async listPeriods(userId) {
        const s = await getDocs(collection(this.db, `${this._scope(userId)}/periods`));
        return s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.period_key).localeCompare(String(a.period_key)));
    }

    // Close a period: roll its net income into Retained Earnings via a closing
    // journal and lock the period to `closed`. Refuses to close an out-of-balance
    // period. The closing journal posts WHILE the period is still open (the lock
    // write commits in the same batch), so future journals into it are blocked.
    async closePeriod(userId, pk) {
        if (!pk) throw new Error('period_key required');
        const current = await this.getPeriod(userId, pk);
        if (current.status === 'closed' || current.status === 'locked') {
            throw new Error('Period is already closed');
        }
        const tb = await this.getTrialBalance(userId, { periodKey: pk });
        if (!tb.balanced) throw new Error('Trial balance is out of balance — cannot close this period');
        let revenue = 0;
        let expense = 0;
        tb.rows.forEach((r) => {
            const natural = signedBalance(r.account_type, r.debit_total, r.credit_total);
            if (r.account_type === 'revenue') revenue += natural;
            if (r.account_type === 'expense') expense += natural;
        });
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const batch = writeBatch(this.db);
        const closing = buildClosingJournal({ revenueTotal: revenue, expenseTotal: expense, periodKey: pk });
        if (closing) {
            this._assignJournalNumbers([closing], await this._reserveJournalNumbers(userId, { [String(closing.period_key).slice(0, 4)]: 1 }));
            this._attachJournalToBatch(batch, scope, closing, { entityId });
        }
        batch.set(doc(this.db, `${scope}/periods/${pk}`), {
            period_key: pk,
            status: 'closed',
            entity_id: entityId,
            closed_by: this.actorUid || null,
            closed_at: serverTimestamp(),
            retained_earnings_posted: !!closing,
            updated_at: serverTimestamp()
        }, { merge: true });
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'period.close', 'periods', pk, { revenue, expense, net: revenue - expense });
        return { period_key: pk, revenue, expense, net: revenue - expense };
    }

    // Reopen a closed/locked period (owner/admin — enforced by rules). Two steps,
    // because a journal can only post into an OPEN period: (1) flip the period to
    // open, then (2) reverse its closing journal so Retained Earnings backs out and
    // Revenue/Expense are restored. Idempotent: only reverses CLOSE journals not
    // already reversed, so a retry after a partial failure completes the reversal.
    async reopenPeriod(userId, pk) {
        if (!pk) throw new Error('period_key required');
        const period = await this.getPeriod(userId, pk);
        if (period.status !== 'closed' && period.status !== 'locked') {
            throw new Error('Only a closed or locked period can be reopened.');
        }
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);

        // Step 1: open the period (so the reversal can post into it).
        const open = writeBatch(this.db);
        open.set(doc(this.db, `${scope}/periods/${pk}`), {
            period_key: pk,
            status: 'open',
            entity_id: entityId,
            reopened_by: this.actorUid || null,
            reopened_at: serverTimestamp(),
            retained_earnings_posted: false,
            updated_at: serverTimestamp()
        }, { merge: true });
        await open.commit();

        // Step 2: reverse the period's closing journal(s) not already reversed.
        const closeJournals = (await this.listJournals(userId, { periodKey: pk, max: 500 }))
            .filter((j) => j.posting_rule_id === 'CLOSE' && j.source && j.source.id === pk && !j.reversed_by_journal_id);
        let reversed = 0;
        if (closeJournals.length) {
            const batch = writeBatch(this.db);
            const acc = {};
            const counts = {};
            closeJournals.forEach((j) => { const y = String(j.period_key).slice(0, 4); counts[y] = (counts[y] || 0) + 1; });
            const bases = await this._reserveJournalNumbers(userId, counts);
            const reversals = closeJournals.map((j) => buildReversalJournal({ ...j, id: j.id }, { targetPeriodKey: pk }));
            this._assignJournalNumbers(reversals, bases);
            reversals.forEach((rev, i) => {
                const rref = this._attachJournalToBatch(batch, scope, rev, { entityId, balanceAcc: acc });
                batch.update(doc(this.db, `${scope}/journals/${closeJournals[i].id}`), { reversed_by_journal_id: rref.id });
                reversed += 1;
            });
            this._flushBalanceAcc(batch, scope, entityId, acc);
            await batch.commit();
        }
        await this._auditCreateBestEffort(userId, 'period.reopen', 'periods', pk, { reversed_close_journals: reversed });
        return { period_key: pk, status: 'open', reversed_close_journals: reversed };
    }

    // --- Manual journals (accountant workflow: Draft -> Posted) ---------------
    // Manual journals are the EXCEPTION path for accounting activity the posting
    // engine does not cover (opening balances, accruals, adjustments, reclasses,
    // depreciation, FX). They never auto-post: a draft is saved (no number, no
    // ledger impact), edited, then explicitly posted (number assigned, immutable).

    // Resolve account name/type from the workspace chart of accounts; normalize a
    // raw UI line list into stored journal lines (integers, one non-zero side).
    _normalizeManualLines(lines, coa) {
        const idx = {};
        (coa || []).forEach((a) => { idx[a.code] = { name: a.name, type: a.type }; });
        return (lines || []).map((l) => {
            const code = String(l.account_code || '').trim();
            const acct = idx[code] || null;
            const debit = Math.max(0, Math.round(Number(l.debit) || 0));
            const credit = Math.max(0, Math.round(Number(l.credit) || 0));
            return {
                account_code: code,
                account_type: acct ? acct.type : (l.account_type || 'expense'),
                account_name: acct ? acct.name : (l.account_name || code),
                debit,
                credit,
                currency: 'IDR',
                fx_rate: 1,
                functional_amount: debit || credit,
                memo: l.memo || ''
            };
        }).filter((l) => l.account_code && (l.debit > 0 || l.credit > 0));
    }

    async createManualJournalDraft(userId, { date = null, period_key = null, description = '', reference = '', subtype = null, memo = '', lines = [] } = {}) {
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const pk = period_key || acctPeriodKey(date ? new Date(date) : new Date());
        const cleanLines = this._normalizeManualLines(lines, await this.getChartOfAccounts(userId));
        const totalDebit = cleanLines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = cleanLines.reduce((s, l) => s + l.credit, 0);
        const ref = doc(collection(this.db, `${scope}/journals`));
        await setDoc(ref, {
            posting_rule_id: 'MANUAL',
            journal_type: 'manual',
            manual_subtype: subtype || null,
            status: 'draft',
            source: { collection: null, id: null },
            source_number: null,
            period_key: pk,
            description: description || 'Manual journal',
            reference: reference || null,
            memo: memo || description || '',
            lines: cleanLines,
            total_debit: totalDebit,
            total_credit: totalCredit,
            is_balanced: totalDebit === totalCredit && totalDebit > 0,
            currency: 'IDR',
            entity_id: entityId,
            created_by: this.actorUid || null,
            generated_by: this.actorUid || null,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        await this._auditCreateBestEffort(userId, 'journal.draft_created', 'journals', ref.id, { period_key: pk });
        return ref.id;
    }

    async updateManualJournalDraft(userId, journalId, { date, period_key, description, reference, subtype, memo, lines } = {}) {
        const scope = this._scope(userId);
        const existing = await this.getJournalById(userId, journalId);
        if (!existing) throw new Error('Draft not found');
        if (existing.status !== 'draft') throw new Error('Only draft journals can be edited');
        const update = { updated_at: serverTimestamp() };
        if (date != null || period_key != null) update.period_key = period_key || acctPeriodKey(date ? new Date(date) : new Date());
        if (description != null) update.description = description || 'Manual journal';
        if (reference != null) update.reference = reference || null;
        if (subtype != null) update.manual_subtype = subtype || null;
        if (memo != null) update.memo = memo;
        if (lines != null) {
            const cleanLines = this._normalizeManualLines(lines, await this.getChartOfAccounts(userId));
            update.lines = cleanLines;
            update.total_debit = cleanLines.reduce((s, l) => s + l.debit, 0);
            update.total_credit = cleanLines.reduce((s, l) => s + l.credit, 0);
            update.is_balanced = update.total_debit === update.total_credit && update.total_debit > 0;
        }
        await updateDoc(doc(this.db, `${scope}/journals/${journalId}`), update);
        return journalId;
    }

    async deleteManualJournalDraft(userId, journalId) {
        const existing = await this.getJournalById(userId, journalId);
        if (!existing) return;
        if (existing.status !== 'draft') throw new Error('Only draft journals can be deleted');
        await deleteDoc(doc(this.db, `${this._scope(userId)}/journals/${journalId}`));
        await this._auditCreateBestEffort(userId, 'journal.draft_deleted', 'journals', journalId, {});
    }

    // Post a draft: re-finalize through the engine (asserts balance), confirm the
    // target period is open, reserve a number, then flip the SAME doc to posted and
    // write its ledger_balances increments — atomically in one batch.
    async postManualJournal(userId, journalId) {
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const draft = await this.getJournalById(userId, journalId);
        if (!draft) throw new Error('Draft not found');
        if (draft.status !== 'draft') throw new Error('Journal is not a draft');
        const coa = await this.getChartOfAccounts(userId);
        const accountIndex = {};
        coa.forEach((a) => { accountIndex[a.code] = { name: a.name, type: a.type }; });
        // Throws on imbalance — a draft must be balanced before it can post.
        const built = buildManualJournal({
            lines: draft.lines,
            period_key: draft.period_key,
            description: draft.description,
            reference: draft.reference || null,
            subtype: draft.manual_subtype || null,
            accountIndex
        });
        const period = await this.getPeriod(userId, built.period_key);
        if (period.status === 'closed' || period.status === 'locked') {
            throw new Error('Cannot post into a closed period');
        }
        this._assignJournalNumbers([built], await this._reserveJournalNumbers(userId, { [String(built.period_key).slice(0, 4)]: 1 }));
        const batch = writeBatch(this.db);
        batch.set(doc(this.db, `${scope}/journals/${journalId}`), {
            ...built,
            status: 'posted',
            entity_id: entityId,
            generated_by: this.actorUid || draft.generated_by || null,
            created_by: draft.created_by || this.actorUid || null,
            posted_by: this.actorUid || null,
            posted_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        built.lines.forEach((l) => {
            batch.set(doc(this.db, `${scope}/ledger_balances/${built.period_key}__${l.account_code}`), {
                period_key: built.period_key,
                account_code: l.account_code,
                account_type: l.account_type,
                entity_id: entityId,
                currency: 'IDR',
                debit_total: increment(Number(l.debit) || 0),
                credit_total: increment(Number(l.credit) || 0),
                updated_at: serverTimestamp()
            }, { merge: true });
        });
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'journal.posted', 'journals', journalId, { journal_number: built.journal_number });
        return { id: journalId, journal_number: built.journal_number };
    }

    // User-triggered reversal from the Journal Detail page. Builds a reversing entry
    // into the current OPEN period (never mutating a closed book), assigns it a
    // number, and links it back to the original via reversed_by_journal_id.
    async reverseJournal(userId, journalId) {
        const scope = this._scope(userId);
        const entityId = this._resolvedScopeId(userId);
        const original = await this.getJournalById(userId, journalId);
        if (!original) throw new Error('Journal not found');
        if (original.status === 'draft') throw new Error('Draft journals cannot be reversed — edit or discard the draft instead');
        if (original.reversed_by_journal_id) throw new Error('This journal has already been reversed');
        const targetPeriod = await this._openTargetPeriod(userId, original.period_key);
        const reversal = buildReversalJournal({ ...original, id: journalId }, { targetPeriodKey: targetPeriod });
        this._assignJournalNumbers([reversal], await this._reserveJournalNumbers(userId, { [String(reversal.period_key).slice(0, 4)]: 1 }));
        const batch = writeBatch(this.db);
        const revRef = this._attachJournalToBatch(batch, scope, reversal, { entityId });
        batch.update(doc(this.db, `${scope}/journals/${journalId}`), { reversed_by_journal_id: revRef.id });
        await batch.commit();
        await this._auditCreateBestEffort(userId, 'journal.reversed', 'journals', journalId, { reversal_id: revRef.id, journal_number: reversal.journal_number });
        return { reversal_id: revRef.id, journal_number: reversal.journal_number };
    }

    // Orchestrates the period reads and returns the full readiness snapshot used
    // by accounting.js. startKey/endKey are 'YYYY-MM-DD' day keys.
    async getAccountingReadiness(userId, startKey, endKey) {
        const [transactions, bills, subscriptions, savedMappings, bankImports] = await Promise.all([
            this.getTransactionsForPeriod(userId, startKey, endKey).catch(() => []),
            this.getBillsForPeriod(userId, startKey, endKey).catch(() => []),
            this.getSubscriptionsForPeriod(userId, startKey, endKey).catch(() => []),
            this.getAccountingMappings(userId).catch(() => []),
            this.listBankStatementImports(userId, 100).catch(() => [])
        ]);

        const savedKeys = new Set(
            savedMappings.map(m => `${m.source_type}::${String(m.source_value || '').trim()}`)
        );
        const isSaved = (sourceType, sourceValue) => savedKeys.has(`${sourceType}::${String(sourceValue || '').trim()}`);

        const recordsTotal = transactions.length + bills.length + subscriptions.length;
        const hasData = recordsTotal > 0 || bankImports.length > 0;

        const cleanupItems = [];
        const issueRecordKeys = new Set();
        const unmappedSources = new Map(); // sourceKey -> preview entry
        let unmappedRecordCount = 0;

        const flagRecord = (col, id) => issueRecordKeys.add(`${col}:${id}`);

        // --- Transactions ---
        transactions.forEach(tx => {
            const vendor = tx.vendor_name || tx.merchant_name || tx.vendor || null;
            const category = typeof tx.category === 'string' ? tx.category.trim() : '';
            if (tx.status === 'Missing Receipt') {
                cleanupItems.push({
                    type: 'missing_receipt',
                    label: 'Missing receipt',
                    description: `${vendor || 'Transaction'} has no receipt attached.`,
                    source_collection: 'transactions',
                    source_id: tx.id,
                    amount: typeof tx.amount === 'number' ? tx.amount : null,
                    vendor_name: vendor,
                    severity: 'high',
                    recommended_action: 'Attach a receipt to this transaction.'
                });
                flagRecord('transactions', tx.id);
            }
            if (!category) {
                cleanupItems.push({
                    type: 'missing_category',
                    label: 'Missing category',
                    description: `${vendor || 'Transaction'} has no category.`,
                    source_collection: 'transactions',
                    source_id: tx.id,
                    amount: typeof tx.amount === 'number' ? tx.amount : null,
                    vendor_name: vendor,
                    severity: 'medium',
                    recommended_action: 'Set a category so it can map to an account.'
                });
                flagRecord('transactions', tx.id);
            } else {
                const resolved = this._resolveAccountingSource(tx);
                const saved = isSaved(resolved.sourceType, resolved.sourceValue);
                if (!resolved.isDefaultMapped && !saved) {
                    unmappedRecordCount += 1;
                    flagRecord('transactions', tx.id);
                    const key = `${resolved.sourceType}::${resolved.sourceValue}`;
                    if (!unmappedSources.has(key)) {
                        unmappedSources.set(key, {
                            source_type: resolved.sourceType,
                            source_value: resolved.sourceValue,
                            target_account_code: resolved.account.code,
                            target_account_name: resolved.account.name,
                            target_account_type: resolved.account.type,
                            status: 'unmapped'
                        });
                        cleanupItems.push({
                            type: 'unmapped_account',
                            label: 'Unmapped category',
                            description: `"${resolved.sourceValue}" is not mapped to an accounting account.`,
                            source_collection: 'transactions',
                            source_id: tx.id,
                            amount: null,
                            vendor_name: null,
                            severity: 'medium',
                            recommended_action: `Map "${resolved.sourceValue}" to an account in Account Mapping.`
                        });
                    }
                }
            }
        });

        // --- Bills ---
        bills.forEach(bill => {
            const vendor = bill.vendor || bill.vendor_name || null;
            if (!bill.due_date) {
                cleanupItems.push({
                    type: 'bill_missing_due_date',
                    label: 'Bill missing due date',
                    description: `${vendor || 'Bill'} has no due date.`,
                    source_collection: 'bills',
                    source_id: bill.id,
                    amount: typeof bill.amount === 'number' ? bill.amount : null,
                    vendor_name: vendor,
                    severity: 'high',
                    recommended_action: 'Set a due date on this bill.'
                });
                flagRecord('bills', bill.id);
            }
            const hasInvoice = bill.invoice_status === 'attached'
                || (Array.isArray(bill.attached_documents) && bill.attached_documents.length > 0);
            if (!hasInvoice) {
                cleanupItems.push({
                    type: 'bill_missing_invoice',
                    label: 'Bill missing invoice',
                    description: `${vendor || 'Bill'} has no invoice attached.`,
                    source_collection: 'bills',
                    source_id: bill.id,
                    amount: typeof bill.amount === 'number' ? bill.amount : null,
                    vendor_name: vendor,
                    severity: 'medium',
                    recommended_action: 'Attach the invoice document to this bill.'
                });
                flagRecord('bills', bill.id);
            }
        });

        // --- Subscriptions ---
        subscriptions.forEach(sub => {
            const vendor = sub.vendor || sub.vendor_name || null;
            if (!sub.renewal_date) {
                cleanupItems.push({
                    type: 'subscription_missing_renewal_date',
                    label: 'Subscription missing renewal date',
                    description: `${vendor || 'Subscription'} has no renewal date.`,
                    source_collection: 'subscriptions',
                    source_id: sub.id,
                    amount: typeof sub.amount === 'number' ? sub.amount : null,
                    vendor_name: vendor,
                    severity: 'low',
                    recommended_action: 'Set a renewal date on this subscription.'
                });
                flagRecord('subscriptions', sub.id);
            }
        });

        // --- Bank statement imports needing review (period-agnostic; pending queue) ---
        const pendingImports = bankImports.filter(imp =>
            ['draft', 'needs_review', 'ready_to_import'].includes(imp.review_status)
        );
        const bankSupported = bankImports.length > 0;
        pendingImports.forEach(imp => {
            cleanupItems.push({
                type: 'bank_import_needs_review',
                label: 'Bank import needs review',
                description: `${imp.bank_name || 'Bank statement'} import is "${imp.review_status}".`,
                source_collection: 'bank_statement_imports',
                source_id: imp.id,
                amount: null,
                vendor_name: imp.bank_name || null,
                severity: 'high',
                recommended_action: 'Review and confirm this bank statement import.'
            });
        });

        // --- Mapping preview (distinct sources seen in the period) ---
        const mappingPreview = [];
        const previewSeen = new Set();
        const addPreview = (sourceType, sourceValue, account, defaultMapped) => {
            const key = `${sourceType}::${sourceValue}`;
            if (previewSeen.has(key)) return;
            previewSeen.add(key);
            const saved = isSaved(sourceType, sourceValue);
            const savedMap = saved
                ? savedMappings.find(m => m.source_type === sourceType && String(m.source_value).trim() === String(sourceValue).trim())
                : null;
            mappingPreview.push({
                source_type: sourceType,
                source_value: sourceValue,
                target_account_code: savedMap ? savedMap.target_account_code : account.code,
                target_account_name: savedMap ? savedMap.target_account_name : account.name,
                target_account_type: savedMap ? savedMap.target_account_type : account.type,
                status: saved ? 'saved' : (defaultMapped ? 'suggested' : 'unmapped')
            });
        };
        transactions.forEach(tx => {
            if (!(typeof tx.category === 'string' && tx.category.trim())) return;
            const resolved = this._resolveAccountingSource(tx);
            addPreview(resolved.sourceType, resolved.sourceValue, resolved.account, resolved.isDefaultMapped);
        });
        mappingPreview.sort((a, b) => {
            const rank = { unmapped: 0, suggested: 1, saved: 2 };
            return (rank[a.status] - rank[b.status]) || a.source_value.localeCompare(b.source_value);
        });

        // --- Score ---
        const penaltyCounts = {
            missing_receipt: cleanupItems.filter(i => i.type === 'missing_receipt').length,
            missing_category: cleanupItems.filter(i => i.type === 'missing_category').length,
            unmapped_account: unmappedSources.size,
            bill_missing_due_date: cleanupItems.filter(i => i.type === 'bill_missing_due_date').length,
            bill_missing_invoice: cleanupItems.filter(i => i.type === 'bill_missing_invoice').length,
            bank_import_needs_review: pendingImports.length,
            subscription_missing_renewal_date: cleanupItems.filter(i => i.type === 'subscription_missing_renewal_date').length
        };
        let penaltyTotal = 0;
        Object.keys(ACCOUNTING_PENALTY_WEIGHTS).forEach(type => {
            const raw = (penaltyCounts[type] || 0) * ACCOUNTING_PENALTY_WEIGHTS[type];
            penaltyTotal += Math.min(raw, ACCOUNTING_PENALTY_CAP);
        });
        let score = hasData ? Math.max(0, Math.min(100, Math.round(100 - penaltyTotal))) : null;
        if (score !== null && !Number.isFinite(score)) score = 0;

        let band = 'no_data';
        if (score !== null) {
            if (score >= 80) band = 'ready';
            else if (score >= 50) band = 'almost';
            else band = 'needs_cleanup';
        }

        const recordsReviewed = Math.max(0, recordsTotal - issueRecordKeys.size);
        let closeStatus = 'no_data';
        if (hasData) {
            if (score >= 80 && cleanupItems.length === 0) closeStatus = 'ready_to_close';
            else if (score >= 80) closeStatus = 'ready_to_close';
            else closeStatus = 'needs_cleanup';
        }

        const limitations = [];
        if (!bankSupported) {
            limitations.push('No bank statement imported yet — bank reconciliation readiness is not included.');
        }

        const closeChecklist = {
            transactions_reviewed: transactions.length > 0
                && cleanupItems.filter(i => i.source_collection === 'transactions').length === 0,
            missing_receipts_resolved: cleanupItems.filter(i => i.type === 'missing_receipt').length === 0,
            bills_reviewed: cleanupItems.filter(i => i.source_collection === 'bills').length === 0,
            bank_imports_reviewed: pendingImports.length === 0,
            categories_mapped: unmappedSources.size === 0
        };

        return {
            hasData,
            period: { start: startKey, end: endKey },
            score,
            band,
            kpis: {
                readiness_score: score,
                cleanup_items: cleanupItems.length,
                records_total: recordsTotal,
                records_reviewed: recordsReviewed,
                unmapped_records: unmappedRecordCount,
                close_status: closeStatus
            },
            counts: {
                transactions: transactions.length,
                bills: bills.length,
                subscriptions: subscriptions.length,
                missing_receipts: penaltyCounts.missing_receipt,
                missing_categories: penaltyCounts.missing_category,
                unmapped_categories: unmappedSources.size,
                bills_missing_due_date: penaltyCounts.bill_missing_due_date,
                bills_missing_invoice: penaltyCounts.bill_missing_invoice,
                subscriptions_missing_renewal: penaltyCounts.subscription_missing_renewal_date,
                bank_imports_pending: pendingImports.length
            },
            cleanupItems,
            mappingPreview,
            closeChecklist,
            closeStatus,
            limitations,
            bankSupported
        };
    }

    // Thin wrapper for callers/tests that only need the cleanup queue.
    async getAccountingCleanupItems(userId, startKey, endKey) {
        const readiness = await this.getAccountingReadiness(userId, startKey, endKey);
        return readiness.cleanupItems;
    }

    // --- BALANCE SHEET (Management View, Phase 1) ---
    // Builds a point-in-time management balance sheet from existing user-scoped
    // FluxyOS records only. This is not a posted double-entry statement: no
    // chart of accounts, journal entries, retained earnings, or formal equity.
    async getBalanceSheetReport(userId, options = {}) {
        if (!userId) throw new Error('userId required');
        const asOfDate = this._normalizeBalanceSheetDate(options.asOfDate || new Date());
        const compareAsOfDate = options.compareAsOfDate ? this._normalizeBalanceSheetDate(options.compareAsOfDate) : null;
        const filters = options.filters && typeof options.filters === 'object' ? options.filters : {};
        const sectionFilter = ['assets', 'liabilities'].includes(filters.section) ? filters.section : 'all';
        const sourceFilter = ['bank_accounts', 'transactions', 'bills'].includes(filters.source) ? filters.source : 'all';

        const [accounts, snapshots, transactions, bills] = await Promise.all([
            this.getBankAccounts(userId).catch(() => []),
            this.getBankBalanceSnapshots(userId, { limit: 200 }).catch(() => []),
            this._getBalanceSheetTransactionsOnOrBefore(userId, asOfDate).catch(() => []),
            this.getBills(userId).catch(() => [])
        ]);
        const compareTransactions = compareAsOfDate
            ? await this._getBalanceSheetTransactionsOnOrBefore(userId, compareAsOfDate).catch(() => [])
            : [];

        const activeAccounts = accounts.filter(account => String(account.status || 'active').toLowerCase() === 'active');
        const warnings = [];
        if (!activeAccounts.length) {
            warnings.push({
                id: 'missing_cash_balance',
                type: 'missing_cash_balance',
                severity: 'warning',
                message: 'No active cash or bank balance has been set.',
                action_label: 'Set up cash balance',
                action_href: '/settings-cash'
            });
        }

        const current = this._buildBalanceSheetSnapshot({ asOfDate, accounts: activeAccounts, snapshots, transactions, bills });
        const compare = compareAsOfDate
            ? this._buildBalanceSheetSnapshot({ asOfDate: compareAsOfDate, accounts: activeAccounts, snapshots, transactions: compareTransactions, bills })
            : null;

        const row = ({ id, code, label, source, total, records, children = [] }) => {
            const compareLine = compare?.lines?.[id] || null;
            const compareTotal = compareAsOfDate && compareLine && compareLine.record_count > 0 ? compareLine.total : null;
            return {
                id,
                code,
                label,
                level: 1,
                source,
                total: this._safeInteger(total),
                compare_total: compareTotal === null ? null : this._safeInteger(compareTotal),
                change: compareTotal === null ? null : this._safeInteger(total - compareTotal),
                record_count: records.length,
                children
            };
        };

        const cashChildren = current.cash.records.map(account => {
            const compareAccount = compare?.cash.records.find(item => item.id === account.id) || null;
            const compareTotal = compareAccount ? compareAccount.latest_balance : null;
            return {
                id: `cash_bank__${account.id}`,
                code: '',
                label: account.account_name || account.bank_name || 'Bank account',
                level: 2,
                source: 'bank_accounts',
                total: this._safeInteger(account.latest_balance),
                compare_total: compareTotal === null ? null : this._safeInteger(compareTotal),
                change: compareTotal === null ? null : this._safeInteger(account.latest_balance - compareTotal),
                record_count: 1,
                children: []
            };
        });

        const assetsRows = [
            row({
                id: 'cash_bank',
                code: '1000',
                label: 'Cash & Bank',
                source: 'bank_accounts',
                total: current.cash.total,
                records: current.cash.records,
                children: cashChildren
            }),
            row({
                id: 'accounts_receivable',
                code: '1100',
                label: 'Accounts Receivable',
                source: 'transactions',
                total: current.accounts_receivable.total,
                records: current.accounts_receivable.records
            })
        ];

        const liabilityRows = [
            row({
                id: 'accounts_payable',
                code: '2000',
                label: 'Accounts Payable',
                source: 'bills',
                total: current.accounts_payable.total,
                records: current.accounts_payable.records
            }),
            row({
                id: 'pending_payables',
                code: '2100',
                label: 'Pending Payables',
                source: 'transactions',
                total: current.pending_payables.total,
                records: current.pending_payables.records
            })
        ];

        const applySourceFilter = rows => sourceFilter === 'all' ? rows : rows.filter(item => item.source === sourceFilter);
        const visibleAssets = applySourceFilter(assetsRows);
        const visibleLiabilities = applySourceFilter(liabilityRows);
        const sectionTotal = rows => rows.reduce((sum, item) => sum + this._safeInteger(item.total), 0);
        const sectionCompareTotal = rows => rows.some(item => item.compare_total !== null)
            ? rows.reduce((sum, item) => sum + this._safeInteger(item.compare_total), 0)
            : null;

        const assetsTotal = sectionTotal(visibleAssets);
        const liabilitiesTotal = sectionTotal(visibleLiabilities);
        const compareAssetsTotal = sectionCompareTotal(visibleAssets);
        const compareLiabilitiesTotal = sectionCompareTotal(visibleLiabilities);
        const netPosition = assetsTotal - liabilitiesTotal;
        const compareNetPosition = compareAssetsTotal === null || compareLiabilitiesTotal === null
            ? null
            : compareAssetsTotal - compareLiabilitiesTotal;

        const sections = [
            {
                id: 'assets',
                label: 'Assets',
                total: assetsTotal,
                compare_total: compareAssetsTotal,
                change: compareAssetsTotal === null ? null : assetsTotal - compareAssetsTotal,
                rows: visibleAssets
            },
            {
                id: 'liabilities',
                label: 'Liabilities',
                total: liabilitiesTotal,
                compare_total: compareLiabilitiesTotal,
                change: compareLiabilitiesTotal === null ? null : liabilitiesTotal - compareLiabilitiesTotal,
                rows: visibleLiabilities
            }
        ].filter(section => sectionFilter === 'all' || section.id === sectionFilter);

        return {
            report_type: 'balance_sheet',
            report_label: 'Balance Sheet',
            currency: 'IDR',
            as_of_date: this._getDayKey(asOfDate),
            compare_as_of_date: compareAsOfDate ? this._getDayKey(compareAsOfDate) : null,
            cadence: ['monthly', 'quarterly', 'yearly'].includes(options.cadence) ? options.cadence : 'monthly',
            generated_at: new Date().toISOString(),
            totals: {
                assets: assetsTotal,
                liabilities: liabilitiesTotal,
                net_position: netPosition,
                compare_assets: compareAssetsTotal,
                compare_liabilities: compareLiabilitiesTotal,
                compare_net_position: compareNetPosition
            },
            sections,
            warnings,
            related_records_index: {
                cash_bank: current.cash.records,
                accounts_receivable: current.accounts_receivable.records,
                accounts_payable: current.accounts_payable.records,
                pending_payables: current.pending_payables.records
            },
            coverage: {
                bank_accounts_count: current.cash.records.length,
                receivable_transaction_count: current.accounts_receivable.records.length,
                unpaid_bill_count: current.accounts_payable.records.length,
                payable_transaction_count: current.pending_payables.records.length
            }
        };
    }

    async _getBalanceSheetTransactionsOnOrBefore(userId, asOfDate) {
        const end = new Date(asOfDate);
        end.setHours(23, 59, 59, 999);
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/transactions`),
                where('timestamp', '<=', Timestamp.fromDate(end)),
                orderBy('timestamp', 'desc'),
                limit(2000)
            );
            const snapshot = await getDocs(q);
            return this._activeTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (_) {
            const q = query(
                collection(this.db, `${this._scope(userId)}/transactions`),
                orderBy('timestamp', 'desc'),
                limit(2000)
            );
            const snapshot = await getDocs(q);
            return this._activeTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
                .filter(tx => {
                    const date = this._getTransactionDate(tx);
                    return date && date <= end;
                });
        }
    }

    _buildBalanceSheetSnapshot({ asOfDate, accounts = [], snapshots = [], transactions = [], bills = [] }) {
        const end = new Date(asOfDate);
        end.setHours(23, 59, 59, 999);
        const sourceSnapshots = new Map();
        snapshots.forEach(snapshot => {
            const accountId = snapshot.bank_account_id;
            const date = this._getRecordDate(snapshot, 'snapshot_at');
            if (!accountId || !date || date > end) return;
            const previous = sourceSnapshots.get(accountId);
            if (!previous || date > previous.date) {
                sourceSnapshots.set(accountId, { snapshot, date });
            }
        });

        const cashRecords = accounts.map(account => {
            const snap = sourceSnapshots.get(account.id)?.snapshot || null;
            const balance = snap ? Number(snap.balance) : Number(account.latest_balance);
            const balanceDate = snap
                ? this._getRecordDate(snap, 'snapshot_at')
                : this._getRecordDate(account, 'latest_balance_at');
            return {
                source_collection: 'bank_accounts',
                id: account.id,
                account_name: account.account_name || '',
                bank_name: account.bank_name || '',
                latest_balance: this._safeInteger(balance),
                latest_balance_at: balanceDate ? this._getDayKey(balanceDate) : null,
                source_type: snap?.source_type || account.source_type || 'manual',
                status: account.status || 'active'
            };
        });

        const receivables = transactions
            .filter(tx => String(tx.type || '').toLowerCase() === 'pending_receivable')
            .map(tx => this._balanceSheetTransactionSummary(tx));
        const pendingPayables = transactions
            .filter(tx => String(tx.type || '').toLowerCase() === 'pending_payable')
            .map(tx => this._balanceSheetTransactionSummary(tx));
        const unpaidBills = bills
            .filter(bill => this._isBalanceSheetBillOpenAsOf(bill, end))
            .map(bill => this._balanceSheetBillSummary(bill));

        return {
            cash: {
                total: cashRecords.reduce((sum, account) => sum + this._safeInteger(account.latest_balance), 0),
                records: cashRecords
            },
            accounts_receivable: {
                total: receivables.reduce((sum, tx) => sum + this._safeInteger(tx.amount), 0),
                records: receivables
            },
            accounts_payable: {
                total: unpaidBills.reduce((sum, bill) => sum + this._safeInteger(bill.amount), 0),
                records: unpaidBills
            },
            pending_payables: {
                total: pendingPayables.reduce((sum, tx) => sum + this._safeInteger(tx.amount), 0),
                records: pendingPayables
            },
            get lines() {
                return {
                    cash_bank: { total: this.cash.total, record_count: this.cash.records.length },
                    accounts_receivable: { total: this.accounts_receivable.total, record_count: this.accounts_receivable.records.length },
                    accounts_payable: { total: this.accounts_payable.total, record_count: this.accounts_payable.records.length },
                    pending_payables: { total: this.pending_payables.total, record_count: this.pending_payables.records.length }
                };
            }
        };
    }

    _isBalanceSheetBillOpenAsOf(bill, asOfEnd) {
        const status = String(bill.payment_status || '').trim().toLowerCase();
        if (status === 'paid') return false;
        const amount = Number(bill.amount);
        if (!Number.isFinite(amount) || amount <= 0) return false;
        const date = this._firstRecordDate(bill, ['due_date', 'date', 'timestamp', 'created_at']);
        return Boolean(date && date <= asOfEnd);
    }

    _balanceSheetTransactionSummary(tx) {
        const date = this._getTransactionDate(tx);
        return {
            source_collection: 'transactions',
            id: tx.id,
            vendor_name: tx.vendor_name || tx.merchant_name || tx.vendor || 'Transaction',
            amount: this._safeInteger(Math.abs(Number(tx.amount) || 0)),
            category: tx.category || null,
            status: tx.status || null,
            type: String(tx.type || '').toLowerCase(),
            timestamp: date ? this._getDayKey(date) : null
        };
    }

    _balanceSheetBillSummary(bill) {
        const dueDate = this._getRecordDate(bill, 'due_date');
        const fallbackDate = this._firstRecordDate(bill, ['date', 'timestamp', 'created_at']);
        return {
            source_collection: 'bills',
            id: bill.id,
            vendor_name: bill.vendor_name || bill.merchant_name || bill.vendor || 'Bill',
            amount: this._safeInteger(Math.abs(Number(bill.amount) || 0)),
            due_date: dueDate ? this._getDayKey(dueDate) : null,
            payment_status: bill.payment_status || 'unpaid',
            category: bill.category || null,
            timestamp: fallbackDate ? this._getDayKey(fallbackDate) : null
        };
    }

    _normalizeBalanceSheetDate(value) {
        const date = value instanceof Date ? new Date(value) : new Date(value);
        const safe = Number.isNaN(date.getTime()) ? new Date() : date;
        safe.setHours(23, 59, 59, 999);
        return safe;
    }

    _safeInteger(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.round(numeric) : 0;
    }

    // --- INCOME STATEMENT PREVIEW (Accounting Center) ---
    // Builds a deterministic P&L preview (Revenue → Cost of Revenue → Gross
    // Profit → Operating Expenses → Operating Income → Other Income/Expense →
    // Net Income) from ledger transactions only. This is a *preview*, not a
    // posted journal-entry statement: no journal posting, no period close, no
    // new collections, no AI writes. Bills/subscriptions are not folded into the
    // amounts (they would double-count realized spend); they only inform the
    // confidence banner. Readiness is reused as supporting confidence metadata.
    //
    // `period` / `comparisonPeriod` accept { start, end } day-key objects (the
    // comparison defaults to the immediately preceding period).
    async getIncomeStatementPreview(userId, period, comparisonPeriod) {
        const cur = this._coercePeriodKeys(period)
            || { start: this._getMonthStartKey(new Date()), end: this._getMonthEndKey(new Date()) };
        const prevKeys = this._coercePeriodKeys(comparisonPeriod)
            || this._previousPeriodRange(cur.start, cur.end);

        const [readiness, curTx, prevTx, savedMappings] = await Promise.all([
            this.getAccountingReadiness(userId, cur.start, cur.end).catch(() => null),
            this.getTransactionsForPeriod(userId, cur.start, cur.end).catch(() => []),
            this.getTransactionsForPeriod(userId, prevKeys.start, prevKeys.end).catch(() => []),
            this.getAccountingMappings(userId).catch(() => [])
        ]);

        const cogsKeys = this._incomeStatementCogsKeys(savedMappings);

        const curB = this._buildIncomeStatementBuckets(curTx, cogsKeys);
        const prevB = this._buildIncomeStatementBuckets(prevTx, cogsKeys);

        // --- Summary (raw integers; positive magnitudes for components) ---
        const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
        const sum = b => {
            const revenue = b.revenue.total;
            const cost_of_revenue = b.cogs.total;
            const gross_profit = revenue - cost_of_revenue;
            const operating_expenses = b.opex.total;
            const operating_income = gross_profit - operating_expenses;
            const other_income = b.otherIncome.total;
            const other_expense = b.otherExpense.total;
            const net_income = operating_income + other_income - other_expense;
            return {
                revenue, cost_of_revenue, gross_profit, operating_expenses,
                operating_income, other_income, other_expense, net_income,
                gross_margin_pct: revenue > 0 ? round1((gross_profit / revenue) * 100) : 0,
                net_margin_pct: revenue > 0 ? round1((net_income / revenue) * 100) : 0,
                operating_margin_pct: revenue > 0 ? round1((operating_income / revenue) * 100) : 0
            };
        };
        const summary = sum(curB);
        const prevSummary = sum(prevB);

        // --- Rows + related-records index ---
        const relatedIndex = {};
        const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';

        const childRows = (groupId, curBucket, prevBucket) => {
            const labels = new Set([...curBucket.lines.keys(), ...prevBucket.lines.keys()]);
            return [...labels].map(label => {
                const curLine = curBucket.lines.get(label) || { amount: 0, records: [] };
                const prevLine = prevBucket.lines.get(label) || { amount: 0, records: [] };
                const id = `${groupId}__${slug(label)}`;
                relatedIndex[id] = curLine.records.map(r => this._incomeRecordSummary(r));
                const status = this._incomeLineStatus(curLine.records, false);
                return {
                    id, label, level: 'child', kind: curBucket.kind,
                    current_amount: curLine.amount, previous_amount: prevLine.amount,
                    ...this._incomeChange(curLine.amount, prevLine.amount),
                    status: status.label, status_tone: status.tone, children: []
                };
            }).sort((a, b) => b.current_amount - a.current_amount);
        };

        const groupRow = (id, label, curBucket, prevBucket) => {
            relatedIndex[id] = curBucket.records.map(r => this._incomeRecordSummary(r));
            const status = this._incomeLineStatus(curBucket.records, true);
            return {
                id, label, level: 'group', kind: curBucket.kind,
                current_amount: curBucket.total, previous_amount: prevBucket.total,
                ...this._incomeChange(curBucket.total, prevBucket.total),
                status: status.label, status_tone: status.tone,
                children: childRows(id, curBucket, prevBucket)
            };
        };

        const subtotalRow = (id, label, curVal, prevVal, statusLabel, note) => {
            relatedIndex[id] = [];
            return {
                id, label, level: id === 'net_income' ? 'total' : 'subtotal',
                kind: 'subtotal',
                current_amount: curVal, previous_amount: prevVal,
                ...this._incomeChange(curVal, prevVal),
                status: statusLabel, status_tone: 'neutral', note: note || null, children: []
            };
        };

        const rows = [
            groupRow('revenue', 'Revenue', curB.revenue, prevB.revenue),
            groupRow('cost_of_revenue', 'Cost of Revenue', curB.cogs, prevB.cogs),
            subtotalRow('gross_profit', 'Gross Profit', summary.gross_profit, prevSummary.gross_profit,
                `${summary.gross_margin_pct}% margin`, 'Gross Profit = Revenue − Cost of Revenue'),
            groupRow('operating_expenses', 'Operating Expenses', curB.opex, prevB.opex),
            subtotalRow('operating_income', 'Operating Income', summary.operating_income, prevSummary.operating_income,
                `${summary.operating_margin_pct}% margin`, 'Operating Income = Gross Profit − Operating Expenses'),
            groupRow('other_income', 'Other Income', curB.otherIncome, prevB.otherIncome),
            groupRow('other_expense', 'Other Expense', curB.otherExpense, prevB.otherExpense),
            subtotalRow('net_income', 'Net Income', summary.net_income, prevSummary.net_income,
                'Preview only', 'Net Income = Operating Income + Other Income − Other Expense')
        ];

        // --- Confidence banner (readiness as supporting metadata) ---
        const band = readiness ? readiness.band : 'no_data';
        const score = readiness ? readiness.score : null;
        const cleanupCount = readiness ? readiness.cleanupItems.length : 0;
        const txCount = readiness ? readiness.counts.transactions : curTx.length;
        const billCount = readiness ? readiness.counts.bills : 0;
        const confidenceMeta = {
            ready: { label: 'Ready', tone: 'success' },
            almost: { label: 'Almost ready', tone: 'warning' },
            needs_cleanup: { label: 'Needs cleanup', tone: 'danger' },
            no_data: { label: 'No data', tone: 'neutral' }
        }[band] || { label: 'No data', tone: 'neutral' };

        const countPhrase = `${txCount} transaction${txCount === 1 ? '' : 's'}`
            + (billCount > 0 ? ` and ${billCount} bill${billCount === 1 ? '' : 's'}` : '');
        const cleanupPhrase = cleanupCount > 0
            ? `${cleanupCount} record${cleanupCount === 1 ? ' needs' : 's need'} cleanup before this can be treated as accounting-ready.`
            : 'Records look review-ready for an accounting preview.';

        const confidence = {
            label: confidenceMeta.label,
            tone: confidenceMeta.tone,
            score,
            cleanup_count: cleanupCount,
            message: `This preview is based on ${countPhrase}. ${cleanupPhrase}`
        };

        const hasIncomeData = curTx.length > 0;
        const hasData = hasIncomeData || (readiness ? readiness.hasData : false);

        return {
            hasData,
            hasIncomeData,
            period: { label: this._incomeStatementColumnLabel(cur.start, cur.end), start_date: cur.start, end_date: cur.end },
            comparison_period: { label: this._incomeStatementColumnLabel(prevKeys.start, prevKeys.end), start_date: prevKeys.start, end_date: prevKeys.end },
            confidence,
            summary,
            previous_summary: prevSummary,
            rows,
            related_records_index: relatedIndex,
            readiness,
            limitations: [
                'This is an accounting-ready preview, not a posted journal-entry statement.',
                'Income statement amounts use ledger transactions only; bills and subscriptions are not yet folded into the numbers.',
                'Cost of Revenue uses saved accounting mappings only. Unmapped categories stay under Operating Expenses.'
            ]
        };
    }

    async getIncomeStatementRelatedRecords(userId, params = {}) {
        if (!userId) throw new Error('userId required');
        const cur = this._coercePeriodKeys(params.period)
            || { start: this._getMonthStartKey(new Date()), end: this._getMonthEndKey(new Date()) };
        const comparisonPeriod = this._coerceIncomeStatementComparison(cur, params.compare);

        const [preview, bills, subscriptions, savedMappings] = await Promise.all([
            this.getIncomeStatementPreview(userId, cur, comparisonPeriod),
            this.getBillsForPeriod(userId, cur.start, cur.end).catch(() => []),
            this.getSubscriptionsForPeriod(userId, cur.start, cur.end).catch(() => []),
            this.getAccountingMappings(userId).catch(() => [])
        ]);

        const context = this._resolveIncomeStatementDrilldownContext(preview, params);
        const row = context.row;
        const cogsKeys = this._incomeStatementCogsKeys(savedMappings);
        const transactionRecords = ((preview.related_records_index && preview.related_records_index[row.id]) || [])
            .map(record => this._incomeRelatedRecordViewModel(record));

        const supportingRecords = [
            ...bills.map(bill => this._incomeBillRelatedRecordSummary(bill, cogsKeys)),
            ...subscriptions.map(sub => this._incomeSubscriptionRelatedRecordSummary(sub, cogsKeys))
        ].filter(record => this._incomeSupportingRecordMatches(record, context, params));

        const records = [...transactionRecords, ...supportingRecords]
            .filter(record => this._incomeRecordMatchesParams(record, params))
            .sort((a, b) => {
                const left = this._parseDayKey(a.date)?.getTime() || 0;
                const right = this._parseDayKey(b.date)?.getTime() || 0;
                return right - left;
            });

        const cleanupCount = records.filter(record => record.status_filter === 'missing_receipt').length;
        const suggested = this._incomeRelatedSuggestedAction(row, cleanupCount);
        const limitations = [
            ...(preview.limitations || []),
            'Bills and subscriptions shown here are supporting context; Income Statement amounts remain transaction-backed.'
        ];
        if (context.usedFallback) {
            limitations.push('The requested Income Statement line was not recognized, so Revenue records are shown.');
        }

        return {
            section: context.section,
            label: row.label,
            period: preview.period,
            comparison_period: preview.comparison_period,
            summary: {
                current_amount: this._safeInteger(row.current_amount),
                previous_amount: this._safeInteger(row.previous_amount),
                change_amount: this._safeInteger(row.change_amount),
                change_pct: row.change_pct === null || row.change_pct === undefined ? null : Number(row.change_pct),
                status_label: row.status || 'No records',
                cleanup_count: cleanupCount,
                record_count: records.length,
                supporting_record_count: supportingRecords.length
            },
            suggested_action: suggested,
            records,
            limitations
        };
    }

    _coercePeriodKeys(period) {
        if (!period || typeof period !== 'object') return null;
        const start = period.start || period.startDate || period.startKey;
        const end = period.end || period.endDate || period.endKey;
        return (start && end) ? { start, end } : null;
    }

    _coerceIncomeStatementComparison(period, compare) {
        if (!compare || compare === 'previous_period') return this._previousPeriodRange(period.start, period.end);
        const explicit = this._coercePeriodKeys(compare);
        if (explicit) return explicit;
        if (typeof compare === 'string' && /^\d{4}-\d{2}$/.test(compare)) {
            const [year, month] = compare.split('-').map(Number);
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0);
            return { start: this._getDayKey(start), end: this._getDayKey(end) };
        }
        if (compare === 'previous_month') {
            const start = this._parseDayKey(period.start);
            if (start) {
                const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
                const prevEnd = new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0);
                return { start: this._getDayKey(prevStart), end: this._getDayKey(prevEnd) };
            }
        }
        return this._previousPeriodRange(period.start, period.end);
    }

    _incomeStatementCogsKeys(savedMappings = []) {
        const cogsKeys = new Set();
        savedMappings.forEach(m => {
            const section = String(m.statement_section || '').toLowerCase();
            const acctType = String(m.target_account_type || '').toLowerCase();
            if (section === 'cost_of_revenue' || acctType === 'cost_of_revenue') {
                cogsKeys.add(`${m.source_type}::${String(m.source_value || '').trim().toLowerCase()}`);
            }
        });
        return cogsKeys;
    }

    _incomeStatementSlug(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '') || 'revenue';
    }

    _incomeStatementGroupId(value) {
        const slug = this._incomeStatementSlug(value);
        const map = {
            revenue: 'revenue',
            'cost-of-revenue': 'cost_of_revenue',
            cogs: 'cost_of_revenue',
            'operating-expenses': 'operating_expenses',
            opex: 'operating_expenses',
            'other-income': 'other_income',
            'other-expense': 'other_expense'
        };
        return map[slug] || slug.replace(/-/g, '_');
    }

    _flattenIncomeStatementRows(preview) {
        const rows = [];
        (preview.rows || []).forEach(row => {
            rows.push({ ...row });
            (row.children || []).forEach(child => rows.push({ ...child, parent_id: row.id }));
        });
        return rows;
    }

    _resolveIncomeStatementDrilldownContext(preview, params = {}) {
        const rows = this._flattenIncomeStatementRows(preview);
        const requestedSection = this._incomeStatementSlug(params.section || 'revenue');
        const requestedParent = params.parent ? this._incomeStatementGroupId(params.parent) : null;
        const requestedCategory = params.category ? this._incomeStatementSlug(params.category) : null;
        const groupSection = this._incomeStatementGroupId(requestedSection);

        let row = null;
        if (requestedParent) {
            row = rows.find(item => item.parent_id === requestedParent
                && (this._incomeStatementSlug(item.label) === requestedSection
                    || this._incomeStatementSlug(item.label) === requestedCategory
                    || this._incomeStatementSlug(item.id) === requestedSection));
        }
        if (!row) {
            row = rows.find(item => !item.parent_id
                && (item.id === groupSection
                    || this._incomeStatementSlug(item.id) === requestedSection
                    || this._incomeStatementSlug(item.label) === requestedSection));
        }
        if (!row) {
            row = rows.find(item => this._incomeStatementSlug(item.label) === requestedSection
                || this._incomeStatementSlug(item.id) === requestedSection);
        }

        const fallbackRow = rows.find(item => item.id === 'revenue') || rows[0] || {
            id: 'revenue',
            label: 'Revenue',
            level: 'group',
            current_amount: 0,
            previous_amount: 0,
            change_amount: 0,
            change_pct: null,
            status: 'No records',
            status_tone: 'neutral'
        };
        const resolved = row || fallbackRow;
        return {
            section: this._incomeStatementSlug(resolved.parent_id ? resolved.label : resolved.id),
            row: resolved,
            parent_id: resolved.parent_id || null,
            group_id: resolved.parent_id || resolved.id,
            line_slug: resolved.parent_id ? this._incomeStatementSlug(resolved.label) : null,
            usedFallback: !row
        };
    }

    _incomeRelatedRecordViewModel(record = {}) {
        const vendor = record.vendor_name || record.description || 'Record';
        const source = record.source_collection || 'transactions';
        return {
            source_collection: source,
            source_id: record.source_id || record.id || null,
            source_label: record.source_label || this._incomeSourceLabel(source),
            vendor_name: vendor,
            description: record.description || null,
            amount: this._safeInteger(Math.abs(Number(record.amount) || 0)),
            category: record.category || null,
            type: String(record.type || '').toLowerCase().replace(/\s+/g, '_'),
            status: record.status || 'Completed',
            status_filter: record.status_filter || this._incomeRelatedStatusFilter(record.status || 'Completed'),
            date: record.date || null,
            source_route: record.source_route || this._incomeSourceRoute(source, vendor, record.source_id || record.id)
        };
    }

    _incomeSourceLabel(source) {
        return {
            transactions: 'Transactions',
            bills: 'Bills',
            subscriptions: 'Subscriptions'
        }[source] || 'Records';
    }

    _incomeSourceRoute(source, searchText, recordId = null) {
        const base = {
            transactions: '/ledger',
            bills: '/bill',
            subscriptions: '/subscription'
        }[source] || '/accounting';
        // Every record-backed destination supports universal deep-linking: pass the
        // id so the target page snaps its date range to the record's own period,
        // locates the row, scrolls it into view, and highlights it — regardless of
        // the currently selected date filter. Vendor search stays period-scoped, so
        // it is only a fallback when no id is available.
        if (recordId && (source === 'transactions' || source === 'bills' || source === 'subscriptions')) {
            return `${base}?record=${encodeURIComponent(recordId)}`;
        }
        const query = String(searchText || '').trim();
        return query ? `${base}?search=${encodeURIComponent(query)}` : base;
    }

    _incomeRelatedStatusFilter(status) {
        const s = String(status || '').trim().toLowerCase();
        return (s.includes('missing') || s.includes('overdue') || s.includes('needs'))
            ? 'missing_receipt'
            : 'completed';
    }

    _incomeSupportingSection(record = {}, cogsKeys = new Set(), defaultCategory = 'Operations') {
        const category = (typeof record.category === 'string' && record.category.trim()) ? record.category.trim() : defaultCategory;
        const type = String(record.type || 'expense').toLowerCase().trim().replace(/\s+/g, '_');
        const isCogs = (category && cogsKeys.has(`transaction_category::${category.toLowerCase()}`))
            || cogsKeys.has(`transaction_type::${type}`);
        return {
            section: isCogs ? 'cost_of_revenue' : 'operating_expenses',
            line: isCogs ? (category || 'Cost of revenue') : (type === 'fee' ? 'Fees' : type === 'tax' ? 'Tax' : (category || defaultCategory)),
            category,
            type
        };
    }

    _incomeBillStatus(bill = {}) {
        const paymentStatus = String(bill.payment_status || '').toLowerCase();
        if (paymentStatus === 'paid') return 'Paid';
        const dueDate = this._getRecordDate(bill, 'due_date');
        if (!dueDate) return 'Missing Due Date';
        const hasInvoice = bill.invoice_status === 'attached'
            || (Array.isArray(bill.attached_documents) && bill.attached_documents.length > 0);
        if (!hasInvoice) return 'Missing Receipt';
        return 'Scheduled';
    }

    _incomeBillRelatedRecordSummary(bill = {}, cogsKeys = new Set()) {
        const vendor = bill.vendor_name || bill.merchant_name || bill.vendor || 'Bill';
        const classification = this._incomeSupportingSection({ ...bill, type: bill.type || 'pending_payable' }, cogsKeys, 'Operations');
        const date = this._firstRecordDate(bill, ['due_date', 'date', 'timestamp', 'created_at']);
        const status = this._incomeBillStatus(bill);
        return {
            source_collection: 'bills',
            source_id: bill.id,
            source_label: 'Bills',
            vendor_name: vendor,
            description: bill.description || bill.notes || null,
            amount: this._safeInteger(Math.abs(Number(bill.amount) || 0)),
            category: classification.category,
            type: classification.type || 'pending_payable',
            status,
            status_filter: this._incomeRelatedStatusFilter(status),
            date: date ? this._getDayKey(date) : null,
            statement_section: classification.section,
            statement_line: classification.line,
            source_route: this._incomeSourceRoute('bills', vendor, bill.id)
        };
    }

    _incomeSubscriptionRelatedRecordSummary(sub = {}, cogsKeys = new Set()) {
        const vendor = sub.name || sub.vendor_name || sub.vendor || 'Subscription';
        const classification = this._incomeSupportingSection({ ...sub, type: sub.type || 'expense' }, cogsKeys, 'SaaS');
        const date = this._firstRecordDate(sub, ['renewal_date', 'date', 'timestamp', 'created_at']);
        const status = sub.renewal_date ? (sub.status || 'Active') : 'Missing Renewal';
        return {
            source_collection: 'subscriptions',
            source_id: sub.id,
            source_label: 'Subscriptions',
            vendor_name: vendor,
            description: sub.description || sub.notes || null,
            amount: this._safeInteger(Math.abs(Number(sub.amount) || 0)),
            category: classification.category,
            type: classification.type || 'expense',
            status,
            status_filter: this._incomeRelatedStatusFilter(status),
            date: date ? this._getDayKey(date) : null,
            statement_section: classification.section,
            statement_line: classification.line,
            source_route: this._incomeSourceRoute('subscriptions', vendor, sub.id)
        };
    }

    _incomeSupportingRecordMatches(record = {}, context = {}, params = {}) {
        if (record.statement_section !== context.group_id) return false;
        if (context.line_slug && this._incomeStatementSlug(record.statement_line) !== context.line_slug) return false;
        if (params.category && this._incomeStatementSlug(record.category) !== this._incomeStatementSlug(params.category)) return false;
        return true;
    }

    _incomeRecordMatchesParams(record = {}, params = {}) {
        if (params.type) {
            const wantedType = String(params.type).toLowerCase().trim().replace(/\s+/g, '_');
            if (wantedType && String(record.type || '').toLowerCase() !== wantedType) return false;
        }
        if (params.category) {
            const wantedCategory = this._incomeStatementSlug(params.category);
            if (wantedCategory && this._incomeStatementSlug(record.category) !== wantedCategory) return false;
        }
        return true;
    }

    _incomeRelatedSuggestedAction(row = {}, cleanupCount = 0) {
        const groupId = row.parent_id || row.id || '';
        if (cleanupCount > 0) {
            return {
                tone: 'warning',
                title: `${cleanupCount} cleanup item${cleanupCount === 1 ? '' : 's'} found`,
                body: 'Review missing receipts, due dates, or renewal details before closing this period.'
            };
        }
        if (groupId === 'cost_of_revenue') {
            return {
                tone: 'neutral',
                title: 'Review mappings before treating these as direct costs.',
                body: 'Cost of Revenue only includes categories or types explicitly mapped to COGS.'
            };
        }
        if (groupId === 'operating_expenses') {
            return {
                tone: 'neutral',
                title: 'No action needed — these expenses look review-ready.',
                body: 'Use the table to inspect vendors, categories, and supporting bills or subscriptions.'
            };
        }
        return {
            tone: 'success',
            title: 'No action needed — these records look review-ready.',
            body: 'Use the table if you need to inspect source records for this Income Statement line.'
        };
    }

    // Immediately-preceding comparison period. A full calendar month maps to the
    // previous calendar month; any other range maps to the preceding window of
    // equal length so Change/Change % stay meaningful.
    _previousPeriodRange(startKey, endKey) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return { start: startKey, end: endKey };
        if (startKey === this._getMonthStartKey(start) && endKey === this._getMonthEndKey(start)) {
            const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
            const prevEnd = new Date(prevStart.getFullYear(), prevStart.getMonth() + 1, 0);
            return { start: this._getDayKey(prevStart), end: this._getDayKey(prevEnd) };
        }
        const rangeDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const prevEnd = this._addDays(start, -1);
        const prevStart = this._addDays(prevEnd, -(rangeDays - 1));
        return { start: this._getDayKey(prevStart), end: this._getDayKey(prevEnd) };
    }

    // Column-header label: "May 2026" for a full month, otherwise "May 1–Jun 2".
    // Display-only (never stored) — formats in the active app language.
    _incomeStatementColumnLabel(startKey, endKey) {
        const loc = (typeof window !== 'undefined' && window.FluxyI18n?.locale?.()) || 'en-US';
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return 'Period';
        if (startKey === this._getMonthStartKey(start) && endKey === this._getMonthEndKey(start)) {
            return start.toLocaleDateString(loc, { month: 'short', year: 'numeric' });
        }
        return `${start.toLocaleDateString(loc, { month: 'short', day: 'numeric' })}–${end.toLocaleDateString(loc, { month: 'short', day: 'numeric' })}`;
    }

    _incomeChange(current, previous) {
        const change_amount = (Number(current) || 0) - (Number(previous) || 0);
        const pct = previous !== 0 ? (change_amount / Math.abs(previous)) * 100 : null;
        return {
            change_amount,
            change_pct: (pct !== null && Number.isFinite(pct)) ? Math.round(pct * 10) / 10 : null
        };
    }

    _incomeRecordSummary(tx) {
        const date = this._getTransactionDate(tx);
        const vendor = tx.vendor_name || tx.merchant_name || tx.vendor || 'Transaction';
        return {
            source_collection: 'transactions',
            source_id: tx.id,
            source_label: 'Transactions',
            vendor_name: vendor,
            description: tx.description || tx.memo || tx.notes || null,
            amount: Math.abs(Number(tx.amount) || 0),
            category: (typeof tx.category === 'string' && tx.category.trim()) ? tx.category.trim() : null,
            type: String(tx.type || '').toLowerCase(),
            status: tx.status || 'Completed',
            date: date ? this._getDayKey(date) : null,
            status_filter: this._incomeRelatedStatusFilter(tx.status || 'Completed'),
            source_route: this._incomeSourceRoute('transactions', vendor, tx.id)
        };
    }

    // Bucket transactions into revenue / cost-of-revenue / operating-expense /
    // other lines. Components hold positive magnitudes; the statement sign is
    // decided at render time by row kind.
    _buildIncomeStatementBuckets(transactions = [], cogsKeys = new Set()) {
        const out = {
            revenue: { kind: 'revenue', total: 0, lines: new Map(), records: [] },
            cogs: { kind: 'cost', total: 0, lines: new Map(), records: [] },
            opex: { kind: 'cost', total: 0, lines: new Map(), records: [] },
            otherIncome: { kind: 'revenue', total: 0, lines: new Map(), records: [] },
            otherExpense: { kind: 'cost', total: 0, lines: new Map(), records: [] }
        };
        const add = (bucket, label, amount, tx) => {
            bucket.total += amount;
            bucket.records.push(tx);
            const line = bucket.lines.get(label) || { amount: 0, records: [] };
            line.amount += amount;
            line.records.push(tx);
            bucket.lines.set(label, line);
        };

        transactions.forEach(tx => {
            const type = String(tx.type || '').toLowerCase().trim();
            const category = (typeof tx.category === 'string') ? tx.category.trim() : '';
            const amount = Math.abs(Number(tx.amount) || 0);
            if (!amount) return;

            if (INCOME_STATEMENT_REVENUE_TYPES.includes(type)) {
                add(out.revenue, category || 'Revenue', amount, tx);
            } else if (INCOME_STATEMENT_OPEX_TYPES.includes(type)) {
                const isCogs = (category && cogsKeys.has(`transaction_category::${category.toLowerCase()}`))
                    || cogsKeys.has(`transaction_type::${type}`);
                if (isCogs) {
                    add(out.cogs, category || 'Cost of revenue', amount, tx);
                } else {
                    const line = type === 'fee' ? 'Fees' : type === 'tax' ? 'Tax' : (category || 'Others');
                    add(out.opex, line, amount, tx);
                }
            }
            // transfer / adjustment / custom types are neutral — excluded from P&L.
        });
        return out;
    }

    // Status for an income-statement row from its current-period transactions.
    // Group rows collapse to Mapped / Review / Needs cleanup; child rows surface
    // the specific count so the table reads like the cleanup queue.
    _incomeLineStatus(records = [], isGroup = false) {
        if (!records.length) return { label: 'No records', tone: 'neutral' };
        const missingReceipts = records.filter(r => r.status === 'Missing Receipt').length;
        const missingCategory = records.filter(r => !(typeof r.category === 'string' && r.category.trim())).length;
        const unmapped = new Set();
        records.forEach(r => {
            if (!(typeof r.category === 'string' && r.category.trim())) return;
            const resolved = this._resolveAccountingSource(r);
            if (!resolved.isDefaultMapped) unmapped.add(`${resolved.sourceType}::${resolved.sourceValue}`);
        });

        if (isGroup) {
            if (missingReceipts || missingCategory) return { label: 'Needs cleanup', tone: 'warning' };
            if (unmapped.size) return { label: 'Review', tone: 'warning' };
            return { label: 'Mapped', tone: 'success' };
        }
        if (missingReceipts) return { label: `${missingReceipts} missing receipt${missingReceipts === 1 ? '' : 's'}`, tone: 'danger' };
        if (missingCategory) return { label: `${missingCategory} missing categor${missingCategory === 1 ? 'y' : 'ies'}`, tone: 'danger' };
        if (unmapped.size) return { label: `${unmapped.size} unmapped`, tone: 'warning' };
        return { label: 'Mapped', tone: 'neutral' };
    }

    // --- INTERNAL OPERATIONS CONSOLE (Phase 1 MVP) ---
    // `internal_users` and `internal_audit_logs` are operational-metadata-only
    // collections. They must never store financial ledger rows, bills,
    // subscriptions, balances, secrets, or formatted currency strings.
    //
    // MVP_INTERNAL_ONLY_TEMPORARY_AUTH — the console that drives these methods is
    // gated by a client-side credential, not a Firebase identity, so the matching
    // firestore.rules are intentionally open. Replace with Firebase custom claims
    // or a backend-verified admin session before production.
    _internalUserDoc(userId) {
        return doc(this.db, `internal_users/${userId}`);
    }

    async getInternalUsers({ limitCount = 200 } = {}) {
        const q = query(
            collection(this.db, 'internal_users'),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async getInternalUser(userId) {
        const snap = await getDoc(this._internalUserDoc(userId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Public Contact Sales leads (written by the submit-contact-sales Netlify
    // function via the Admin SDK). Read-only surface for the internal console.
    async getSalesLeads({ limitCount = 200 } = {}) {
        const q = query(
            collection(this.db, 'sales_leads'),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Console workflow status for a lead. firestore.rules restricts the update to
    // status + status_updated_at only (core lead fields stay immutable).
    async updateSalesLeadStatus(leadId, status) {
        if (!['new', 'contacted', 'closed', 'spam'].includes(status)) throw new Error('invalid-status');
        await updateDoc(doc(this.db, `sales_leads/${leadId}`), {
            status,
            status_updated_at: serverTimestamp()
        });
        return { id: leadId, status };
    }

    // --- Internal outreach leads (Sales Leads → Outreach subpage) ---
    // Top-level collection; the bilingual meeting-reminder email is sent by the
    // token-gated send-lead-outreach Netlify function.
    async getOutreachLeads({ limitCount = 200 } = {}) {
        const q = query(collection(this.db, 'outreach_leads'), orderBy('created_at', 'desc'), limit(limitCount));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async addOutreachLead(data) {
        const payload = { status: 'new', ...data, created_at: serverTimestamp(), updated_at: serverTimestamp() };
        // Rules allow these to be absent but never literal null.
        ['role', 'company', 'last_sent_at'].forEach((f) => { if (payload[f] == null) delete payload[f]; });
        const ref = await addDoc(collection(this.db, 'outreach_leads'), payload);
        return ref.id;
    }

    async updateOutreachLead(leadId, patch = {}) {
        await updateDoc(doc(this.db, `outreach_leads/${leadId}`), { ...patch, updated_at: serverTimestamp() });
        return { id: leadId };
    }

    async deleteOutreachLead(leadId) {
        await deleteDoc(doc(this.db, `outreach_leads/${leadId}`));
    }

    subscribeInternalUser(userId, onChange, onError) {
        if (!userId) return () => {};
        return onSnapshot(this._internalUserDoc(userId), (snap) => {
            onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        }, onError);
    }

    async addInternalAuditLog(payload = {}) {
        return await addDoc(collection(this.db, 'internal_audit_logs'), {
            actor_uid: payload.actor_uid || null,
            actor_username: this._stringOrDefault(payload.actor_username, 'fluxyos admin', 80),
            actor_role: 'internal_admin',
            action: this._stringOrDefault(payload.action, 'internal.note.update', 80),
            target_user_id: this._stringOrDefault(payload.target_user_id, '', 160),
            before: payload.before || null,
            after: payload.after || null,
            reason: this._nullableString(payload.reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
    }

    // Queue a "send weekly digest now" job for the Netlify worker to execute.
    // mode: 'send' broadcasts to all enabled users; 'dryRun' only counts.
    async requestDigestBroadcast(mode = 'send', requestedBy = 'fluxyos admin') {
        const ref = await addDoc(collection(this.db, 'internal_digest_jobs'), {
            mode: mode === 'dryRun' ? 'dryRun' : 'send',
            status: 'pending',
            requested_by: this._stringOrDefault(requestedBy, 'fluxyos admin', 80),
            requested_at: serverTimestamp(),
            started_at: null,
            finished_at: null,
            result: null,
            error: null
        });
        return ref.id;
    }

    async getDigestBroadcastJob(jobId) {
        const snap = await getDoc(doc(this.db, `internal_digest_jobs/${jobId}`));
        return snap.exists() ? { id: jobId, ...snap.data() } : null;
    }

    async getInternalAuditLogs(limitCount = 100) {
        const q = query(
            collection(this.db, 'internal_audit_logs'),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Return a patch that corrects any constrained internal_users enum field
    // whose stored value is out-of-enum (legacy poison), so a reviewer's update
    // can pass the whole-doc validation rule. Only invalid fields are touched;
    // valid docs return {}. access_status maps a stray billing status onto the
    // internal enum; payment_status falls back to the neutral 'pending'.
    _healInternalEnumFields(existing = {}) {
        const out = {};
        if ('access_status' in existing && existing.access_status != null
            && !ACCESS_STATUSES.includes(existing.access_status)) {
            out.access_status = BILLING_TO_ACCESS_STATUS[existing.access_status] || 'trial_active';
        }
        if ('payment_status' in existing && existing.payment_status != null
            && !INTERNAL_PAYMENT_STATUSES.includes(existing.payment_status)) {
            out.payment_status = 'pending';
        }
        return out;
    }

    // Apply a reviewer status change to internal_users/{userId} and write the
    // matching internal audit log atomically (single writeBatch — so a status
    // change is never left unlogged). `auditContext` must carry primitive
    // before/after snapshots (no serverTimestamp sentinels) so the audit row
    // stays readable.
    async updateInternalUserStatus(userId, statusPayload = {}, auditContext = {}) {
        const ref = this._internalUserDoc(userId);
        const beforeSnap = await getDoc(ref);
        if (!beforeSnap.exists()) {
            throw new Error('internal-user-not-found');
        }
        // Self-heal legacy poison: the internal_users UPDATE rule re-validates the
        // ENTIRE merged doc against isValidInternalUser, so any pre-existing field
        // holding an out-of-enum value makes this write fail with permission-denied
        // — even though the reviewer only touched status fields. Fold corrections
        // into the SAME batch so the action succeeds and repairs the doc at once.
        const corrections = this._healInternalEnumFields(beforeSnap.data() || {});
        const payload = this._cleanDefined({ ...corrections, ...statusPayload, updated_at: serverTimestamp() });
        const batch = writeBatch(this.db);
        batch.update(ref, payload);
        batch.set(doc(collection(this.db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: 'fluxyos admin',
            actor_role: 'internal_admin',
            action: this._stringOrDefault(auditContext.action, 'internal.note.update', 80),
            target_user_id: userId,
            before: auditContext.before || null,
            after: auditContext.after || null,
            reason: this._nullableString(auditContext.reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return payload;
    }

    // Each user's own client upserts its own internal_users row from onboarding
    // data. Profile/derived fields are always refreshed; reviewer-controlled
    // status fields are only seeded on first create (or advanced from
    // not_started/in_progress to submitted), so an admin decision is never
    // clobbered on the user's next login.
    async syncSelfToInternalIndex(userId, opts = {}) {
        if (!userId) return null;
        const ref = this._internalUserDoc(userId);
        const [snap, profile, progress] = await Promise.all([
            getDoc(ref),
            this.getOnboardingProfile(userId).catch(() => null),
            this.getOnboardingProgress(userId).catch(() => null)
        ]);
        const onboardingCompleted = progress?.onboarding_completed === true;
        const phoneParts = [profile?.phone_country_code, profile?.phone_number].filter(Boolean).join(' ').trim();
        // Always refresh identity + onboarding flag. Only write profile-derived
        // fields when an onboarding profile actually loaded, so a transient read
        // failure or a pre-onboarding login never wipes a stored business name.
        // Organization = the workspace/org name the user belongs to (owner's org for
        // members); falls back to the user's own onboarding business_name. Only
        // written when we have a value, so a caller that omits it (e.g. onboarding
        // pre-workspace) never clobbers a good mirror with null.
        const orgValue = opts.organization != null
            ? opts.organization
            : (profile ? profile.business_name : undefined);
        const profileFields = this._cleanDefined({
            email: this._nullableString(opts.email, 160),
            display_name: this._nullableString(opts.display_name, 160),
            business_name: profile ? this._nullableString(profile.business_name, 120) : undefined,
            role: profile ? this._nullableString(profile.role, 80) : undefined,
            phone_number: profile ? this._nullableString(phoneParts || null, 40) : undefined,
            organization: orgValue !== undefined ? this._nullableString(orgValue, 160) : undefined,
            workspace_role: opts.workspace_role != null ? this._nullableString(opts.workspace_role, 40) : undefined,
            onboarding_completed: onboardingCompleted,
            updated_at: serverTimestamp()
        });

        if (!snap.exists()) {
            const kycStatus = onboardingCompleted ? 'submitted' : (profile ? 'in_progress' : 'not_started');
            const accountStatus = onboardingCompleted ? 'kyc_submitted' : (profile ? 'kyc_incomplete' : 'registered');
            await setDoc(ref, {
                user_id: userId,
                email: profileFields.email || null,
                display_name: profileFields.display_name || null,
                business_name: profileFields.business_name || null,
                role: profileFields.role || null,
                phone_number: profileFields.phone_number || null,
                organization: profileFields.organization || null,
                workspace_role: profileFields.workspace_role || null,
                account_status: accountStatus,
                kyc_status: kycStatus,
                payment_status: 'pending',
                onboarding_completed: onboardingCompleted,
                kyc_submitted_at: onboardingCompleted ? serverTimestamp() : null,
                kyc_reviewed_at: null,
                payment_submitted_at: null,
                payment_verified_at: null,
                plan_id: null,
                payment_amount: null,
                payment_method: null,
                assigned_reviewer_id: null,
                last_internal_note: null,
                risk_level: null,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp()
            });
            return 'created';
        }

        const existing = snap.data() || {};
        const patch = { ...profileFields };
        // Advance KYC to submitted only while the user is still pre-submission —
        // never overwrite a reviewer's approved/needs_revision/rejected decision.
        if (onboardingCompleted && (existing.kyc_status === 'not_started' || existing.kyc_status === 'in_progress')) {
            patch.kyc_status = 'submitted';
            if (existing.account_status === 'registered' || existing.account_status === 'kyc_incomplete') {
                patch.account_status = 'kyc_submitted';
            }
            if (!existing.kyc_submitted_at) patch.kyc_submitted_at = serverTimestamp();
        }
        await setDoc(ref, patch, { merge: true });
        return 'updated';
    }

    // Lightweight presence heartbeat: stamps internal_users/{uid}.last_active_at
    // so the ops console can show Online / last-seen. Throttled in-process to at
    // most one write per ACTIVITY_MIN_INTERVAL_MS to keep Firestore writes
    // negligible; the caller (sidebar-loader) also skips it when the tab is
    // hidden. Best-effort — never throws into the caller. internal_users is the
    // open, field-validated ops index, so the user's own client may write here.
    async touchActivity(userId) {
        if (!userId) return false;
        const ACTIVITY_MIN_INTERVAL_MS = 60 * 1000;
        const now = Date.now();
        this._lastActivityTouchAt = this._lastActivityTouchAt || 0;
        if (now - this._lastActivityTouchAt < ACTIVITY_MIN_INTERVAL_MS) return false;
        this._lastActivityTouchAt = now;
        try {
            await setDoc(this._internalUserDoc(userId), { last_active_at: serverTimestamp() }, { merge: true });
            return true;
        } catch (e) {
            this._lastActivityTouchAt = 0; // let the next tick retry after a failed write
            return false;
        }
    }

    // ===== BILLING ACCESS & 3-DAY TRIAL =====
    // Owner-scoped access-state doc at users/{uid}/billing/access. The trial starts
    // after onboarding completion (not registration). Client-side trial/expiry logic
    // here is UX only — production needs backend/rules enforcement. Access/payment
    // data never leaves users/{uid}; only non-financial status fields are mirrored
    // into the open internal_users index for the ops console.
    _billingAccessDoc(userId) {
        return doc(this.db, `users/${userId}/billing/access`);
    }

    _paymentVerificationsCol(userId) {
        return collection(this.db, `users/${userId}/payment_verifications`);
    }

    _billingSubscriptionDoc(userId) {
        return doc(this.db, `users/${userId}/billing_subscription/current`);
    }

    _billingPaymentRequestsCol(userId) {
        return collection(this.db, `users/${userId}/billing_payment_requests`);
    }

    async getBillingSubscription(userId) {
        if (!userId) return null;
        const snap = await getDoc(this._billingSubscriptionDoc(userId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Reads the shared Fluxy AI quota (AI chat + Overview AI Finance Summary) for
    // display + on-load locking. Mirrors consumeAIQuotaIfNeeded /
    // PLAN_AI_PERIOD_LIMITS in netlify/functions/api.js. Returns
    // { scope, used, limit, remaining, unlimited, locked }. The backend remains
    // the source of truth; on a read error we return unlocked so the UI never
    // false-locks (the backend still enforces on generate).
    async getAiUsage(userId) {
        const trialLimit = getPlanLimits('trial')?.ai_chat_limit ?? 1;
        if (!userId) return { scope: 'trial', used: 0, limit: trialLimit, remaining: trialLimit, unlimited: false, locked: false };
        const toMillis = (value) => {
            if (!value) return null;
            if (typeof value.toMillis === 'function') return value.toMillis();
            if (typeof value.seconds === 'number') return value.seconds * 1000;
            if (value instanceof Date) return value.getTime();
            const ms = new Date(value).getTime();
            return Number.isNaN(ms) ? null : ms;
        };
        const readCount = async (docId) => {
            const snap = await getDoc(doc(this.db, `users/${userId}/usage_limits/${docId}`));
            return snap.exists() ? { data: snap.data(), count: Math.max(0, Number(snap.data().count) || 0) } : null;
        };
        try {
            if (window.FluxyWorkspace?.plan?.id) {
                const wsLimit = getPlanLimits(window.FluxyWorkspace.plan.id)?.ai_chat_limit;
                if (wsLimit == null) {
                    return { scope: 'plan', used: 0, limit: null, remaining: Infinity, unlimited: true, locked: false };
                }
            }

            const sub = await this.getBillingSubscription(userId);
            const status = sub?.status || null;
            const planId = sub?.plan_id || null;
            const isPaidActive = (status === 'active' || status === 'cancel_scheduled') && planId && planId !== 'trial';

            if (isPaidActive) {
                const limit = getPlanLimits(planId)?.ai_chat_limit;
                if (limit == null) return { scope: 'plan', used: 0, limit: null, remaining: Infinity, unlimited: true, locked: false };
                const periodStartMs = toMillis(sub.current_period_start);
                let used = 0;
                if (periodStartMs) {
                    const existing = await readCount('ai_chat_plan');
                    if (existing && toMillis(existing.data.period_start) === periodStartMs) used = existing.count;
                } else {
                    const existing = await readCount(`ai_chat_${this._jakartaMonthKey()}`);
                    used = existing ? existing.count : 0;
                }
                const remaining = Math.max(0, limit - used);
                return { scope: 'plan', used, limit, remaining, unlimited: false, locked: remaining <= 0 };
            }

            // Trial scope (covers trial / trialing / awaiting_payment /
            // pending_verification / payment_failed / expired and missing sub).
            const existing = await readCount('ai_chat_trial');
            const used = existing ? existing.count : 0;
            const remaining = Math.max(0, trialLimit - used);
            return { scope: 'trial', used, limit: trialLimit, remaining, unlimited: false, locked: remaining <= 0 };
        } catch (_) {
            return { scope: 'unknown', used: 0, limit: null, remaining: Infinity, unlimited: false, locked: false, unknown: true };
        }
    }

    _jakartaMonthKey() {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
        const year = parts.find(p => p.type === 'year')?.value || '0000';
        const month = parts.find(p => p.type === 'month')?.value || '01';
        return `${year}-${month}`;
    }

    async upsertBillingSubscription(userId, subscriptionData = {}) {
        if (!userId) throw new Error('missing-user');
        const payload = this._cleanDefined({
            ...subscriptionData,
            updated_at: serverTimestamp()
        });
        await setDoc(this._billingSubscriptionDoc(userId), payload, { merge: true });
        try {
            const fresh = await this.getBillingSubscription(userId);
            if (fresh) await this.syncInternalUserBillingSubscriptionIndex(userId, fresh);
        } catch (_) { /* internal mirror is non-critical */ }
        return payload;
    }

    // ===== Voucher codes (checkout discounts; internal-console managed) =====
    // Voucher docs live at voucher_codes/{CODE} (doc id == normalized uppercase
    // code). Client-side validation here is UX only — the binding price check
    // happens in firestore.rules at payment-request creation, which re-reads
    // the voucher doc and recomputes the discount itself.

    _voucherCodeDoc(code) {
        return doc(this.db, `voucher_codes/${code}`);
    }

    _voucherRegistryDoc() {
        return doc(this.db, 'voucher_code_index/registry');
    }

    _voucherRedemptionsCol() {
        return collection(this.db, 'voucher_redemptions');
    }

    normalizeVoucherCode(value) {
        const clean = String(value ?? '').trim().toUpperCase();
        return /^[A-Z0-9_-]{4,32}$/.test(clean) ? clean : null;
    }

    // Returns null when the voucher is usable for the selection, otherwise one
    // of: invalid | disabled | expired | not-started | usage-limit |
    // plan-mismatch | frequency-mismatch.
    _assessVoucherEligibility(voucher, { planId, billingFrequency, now = new Date() } = {}) {
        if (!voucher || voucher.discount_type !== 'percentage') return 'invalid';
        if (!Number.isInteger(voucher.discount_value) || voucher.discount_value < 1 || voucher.discount_value > 100) return 'invalid';
        if (voucher.status === 'disabled') return 'disabled';
        if (voucher.status === 'expired') return 'expired';
        if (voucher.status !== 'active') return 'invalid';
        if (voucher.valid_from && typeof voucher.valid_from.toDate === 'function' && voucher.valid_from.toDate() > now) return 'not-started';
        if (voucher.valid_until && typeof voucher.valid_until.toDate === 'function' && voucher.valid_until.toDate() < now) return 'expired';
        if (Array.isArray(voucher.allowed_plan_ids) && !voucher.allowed_plan_ids.includes(planId)) return 'plan-mismatch';
        if (Array.isArray(voucher.allowed_billing_frequencies) && !voucher.allowed_billing_frequencies.includes(billingFrequency)) return 'frequency-mismatch';
        if (voucher.max_redemptions != null && (voucher.redemption_count || 0) >= voucher.max_redemptions) return 'usage-limit';
        return null;
    }

    async getVoucherCode(code) {
        const normalized = this.normalizeVoucherCode(code);
        if (!normalized) return null;
        const snap = await getDoc(this._voucherCodeDoc(normalized));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Checkout apply-time validation (UX). Returns the computed amounts so the
    // summary can render; the same math is re-enforced by rules on submit.
    async validateVoucherCode({ code, planId, billingFrequency } = {}) {
        const normalized = this.normalizeVoucherCode(code);
        if (!normalized) return { valid: false, reason: 'invalid' };
        const voucher = await this.getVoucherCode(normalized);
        if (!voucher) return { valid: false, reason: 'invalid' };
        const reason = this._assessVoucherEligibility(voucher, { planId, billingFrequency });
        if (reason) return { valid: false, reason };
        const calculation = calculateBilling(planId, billingFrequency, voucher);
        return {
            valid: true,
            voucher,
            code: normalized,
            discountPercent: voucher.discount_value,
            subtotalAmount: calculation.subtotalAmount,
            discountAmount: calculation.voucherDiscountAmount,
            taxAmount: calculation.estimatedTaxAmount,
            totalAmount: calculation.totalAmount
        };
    }

    // Internal console list. voucher_codes denies `list` queries, so codes are
    // looked up through the registry doc and fanned out to per-code gets.
    async getVoucherCodes() {
        const registrySnap = await getDoc(this._voucherRegistryDoc());
        const codes = registrySnap.exists() && Array.isArray(registrySnap.data().codes)
            ? registrySnap.data().codes
            : [];
        if (!codes.length) return [];
        const snaps = await Promise.all(codes.map((code) =>
            getDoc(this._voucherCodeDoc(code)).catch(() => null)
        ));
        return snaps
            .filter((snap) => snap && snap.exists())
            .map((snap) => ({ id: snap.id, ...snap.data() }))
            .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));
    }

    // Internal console create. Voucher doc + registry entry + audit log commit
    // atomically (same pattern as updateInternalUserStatus).
    async createVoucherCode(data = {}, auditContext = {}) {
        const code = this.normalizeVoucherCode(data.code);
        if (!code) throw new Error('invalid-voucher-code');
        const discountValue = Number(data.discount_value);
        if (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 100) throw new Error('invalid-discount-value');
        const maxRedemptions = data.max_redemptions == null || data.max_redemptions === ''
            ? null
            : Number(data.max_redemptions);
        if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000)) {
            throw new Error('invalid-max-redemptions');
        }
        const validFrom = data.valid_from instanceof Date ? Timestamp.fromDate(data.valid_from) : null;
        const validUntil = data.valid_until instanceof Date ? Timestamp.fromDate(data.valid_until) : null;
        if (validFrom && validUntil && validUntil.toMillis() <= validFrom.toMillis()) throw new Error('invalid-date-range');
        const allowedPlanIds = Array.isArray(data.allowed_plan_ids) && data.allowed_plan_ids.length
            ? data.allowed_plan_ids.filter((id) => ['core', 'growth', 'enterprise'].includes(id))
            : null;
        if (Array.isArray(data.allowed_plan_ids) && data.allowed_plan_ids.length && (!allowedPlanIds || !allowedPlanIds.length)) {
            throw new Error('invalid-allowed-plans');
        }
        const allowedFrequencies = Array.isArray(data.allowed_billing_frequencies) && data.allowed_billing_frequencies.length
            ? data.allowed_billing_frequencies.filter((freq) => ['monthly', 'annually'].includes(freq))
            : null;
        if (Array.isArray(data.allowed_billing_frequencies) && data.allowed_billing_frequencies.length
            && (!allowedFrequencies || !allowedFrequencies.length)) {
            throw new Error('invalid-allowed-frequencies');
        }
        const existing = await getDoc(this._voucherCodeDoc(code));
        if (existing.exists()) throw new Error('voucher-exists');

        const createdBy = this._stringOrDefault(data.created_by, 'fluxyos admin', 80);
        const voucherPayload = {
            code,
            discount_type: 'percentage',
            discount_value: discountValue,
            status: 'active',
            max_redemptions: maxRedemptions,
            redemption_count: 0,
            valid_from: validFrom,
            valid_until: validUntil,
            allowed_plan_ids: allowedPlanIds,
            allowed_billing_frequencies: allowedFrequencies,
            created_by: createdBy,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            disabled_at: null,
            disabled_by: null,
            notes: this._nullableString(data.notes, 500)
        };
        const batch = writeBatch(this.db);
        batch.set(this._voucherCodeDoc(code), voucherPayload);
        batch.set(this._voucherRegistryDoc(), {
            codes: arrayUnion(code),
            updated_at: serverTimestamp()
        }, { merge: true });
        batch.set(doc(collection(this.db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: this._stringOrDefault(auditContext.actor_username, 'fluxyos admin', 80),
            actor_role: 'internal_admin',
            action: 'voucher.create',
            target_user_id: code,
            before: null,
            after: {
                code,
                discount_value: discountValue,
                max_redemptions: maxRedemptions,
                status: 'active'
            },
            reason: this._nullableString(auditContext.reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: code, ...voucherPayload };
    }

    // Internal console edit. Only post-create-safe fields are editable; code,
    // discount percent, and the redemption counter stay immutable (rules too).
    async updateVoucherCode(code, patch = {}, auditContext = {}) {
        const normalized = this.normalizeVoucherCode(code);
        if (!normalized) throw new Error('invalid-voucher-code');
        const existing = await this.getVoucherCode(normalized);
        if (!existing) throw new Error('voucher-not-found');
        const updatePayload = this._cleanDefined({
            notes: 'notes' in patch ? this._nullableString(patch.notes, 500) : undefined,
            valid_until: 'valid_until' in patch
                ? (patch.valid_until instanceof Date ? Timestamp.fromDate(patch.valid_until) : null)
                : undefined,
            max_redemptions: 'max_redemptions' in patch
                ? (patch.max_redemptions == null ? null : Number(patch.max_redemptions))
                : undefined,
            updated_at: serverTimestamp()
        });
        const batch = writeBatch(this.db);
        batch.update(this._voucherCodeDoc(normalized), updatePayload);
        batch.set(doc(collection(this.db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: this._stringOrDefault(auditContext.actor_username, 'fluxyos admin', 80),
            actor_role: 'internal_admin',
            action: 'voucher.update',
            target_user_id: normalized,
            before: auditContext.before || null,
            after: auditContext.after || null,
            reason: this._nullableString(auditContext.reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return updatePayload;
    }

    async disableVoucherCode(code, reason = null, auditContext = {}) {
        const normalized = this.normalizeVoucherCode(code);
        if (!normalized) throw new Error('invalid-voucher-code');
        const existing = await this.getVoucherCode(normalized);
        if (!existing) throw new Error('voucher-not-found');
        if (existing.status === 'disabled') return existing;
        const disabledBy = this._stringOrDefault(auditContext.actor_username, 'fluxyos admin', 80);
        const batch = writeBatch(this.db);
        batch.update(this._voucherCodeDoc(normalized), {
            status: 'disabled',
            disabled_at: serverTimestamp(),
            disabled_by: disabledBy,
            updated_at: serverTimestamp()
        });
        batch.set(doc(collection(this.db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: disabledBy,
            actor_role: 'internal_admin',
            action: 'voucher.disable',
            target_user_id: normalized,
            before: { status: existing.status },
            after: { status: 'disabled' },
            reason: this._nullableString(reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { ...existing, status: 'disabled' };
    }

    // Internal console hard delete. Removes the voucher doc + its registry entry
    // + writes an audit log atomically. Past voucher_redemptions are immutable
    // and intentionally kept (the Discount-given KPI reads them, not the code).
    async deleteVoucherCode(code, auditContext = {}) {
        const normalized = this.normalizeVoucherCode(code);
        if (!normalized) throw new Error('invalid-voucher-code');
        const existing = await this.getVoucherCode(normalized);
        if (!existing) throw new Error('voucher-not-found');
        const batch = writeBatch(this.db);
        batch.delete(this._voucherCodeDoc(normalized));
        batch.set(this._voucherRegistryDoc(), {
            codes: arrayRemove(normalized),
            updated_at: serverTimestamp()
        }, { merge: true });
        batch.set(doc(collection(this.db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: this._stringOrDefault(auditContext.actor_username, 'fluxyos admin', 80),
            actor_role: 'internal_admin',
            action: 'voucher.delete',
            target_user_id: normalized,
            before: {
                status: existing.status,
                discount_value: existing.discount_value,
                redemption_count: existing.redemption_count || 0
            },
            after: null,
            reason: this._nullableString(auditContext.reason, 500),
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { id: normalized, deleted: true };
    }

    async getVoucherRedemptions(voucherId) {
        const normalized = this.normalizeVoucherCode(voucherId);
        if (!normalized) return [];
        const snapshot = await getDocs(query(this._voucherRedemptionsCol(), where('voucher_id', '==', normalized)));
        return snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.created_at?.toMillis?.() || 0) - (a.created_at?.toMillis?.() || 0));
    }

    async getAllVoucherRedemptions({ limitCount = 1000 } = {}) {
        const snapshot = await getDocs(query(this._voucherRedemptionsCol(), orderBy('created_at', 'desc'), limit(limitCount)));
        return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    // Best-effort hook for the internal console's payment.verify action: a
    // verified payment settles the user's reserved redemptions to redeemed.
    async markVoucherRedemptionsRedeemed(userId) {
        if (!userId) return 0;
        const snapshot = await getDocs(query(
            this._voucherRedemptionsCol(),
            where('user_id', '==', userId),
            where('status', '==', 'reserved')
        ));
        await Promise.all(snapshot.docs.map((d) => updateDoc(d.ref, {
            status: 'redeemed',
            redeemed_at: serverTimestamp()
        })));
        return snapshot.size;
    }

    async createPaymentRequest(userId, paymentData = {}) {
        if (!userId) throw new Error('missing-user');
        if (!BILLING_PLANS[paymentData.plan_id]) throw new Error('invalid-plan');
        // Sales-led plans (Enterprise AI) have no self-serve amount — they are
        // provisioned through Contact Sales, never a checkout payment request.
        if (BILLING_PLANS[paymentData.plan_id].salesLed) throw new Error('sales-led-plan');
        if (!['monthly', 'annually'].includes(paymentData.billing_frequency)) throw new Error('invalid-billing-frequency');
        const planId = normalizePlanId(paymentData.plan_id);
        const billingFrequency = normalizeBillingFrequency(paymentData.billing_frequency);
        const paymentMethod = normalizePaymentMethod(paymentData.payment_method);
        if (!paymentMethod) throw new Error('invalid-payment-method');

        // Optional voucher: a present-but-malformed code is an error (never
        // silently bill full price after the UI showed a discount).
        const voucherCode = paymentData.voucher_code == null || paymentData.voucher_code === ''
            ? null
            : this.normalizeVoucherCode(paymentData.voucher_code);
        if (paymentData.voucher_code && !voucherCode) throw new Error('voucher-invalid');

        const calculation = calculateBilling(planId, billingFrequency);
        // QRIS uses a manual "pay the QR first" step: the request starts as
        // awaiting_payment and only moves to pending_verification after the user
        // confirms payment on the QR screen. Other methods submit for verification
        // immediately (unchanged behavior).
        const paymentStatus = paymentMethod === 'qris' ? 'awaiting_payment' : 'pending_verification';
        const currentSubscription = await this.getBillingSubscription(userId);

        // Don't stack payments. If one is already in flight, return it instead of
        // creating a second request: a second create would re-snapshot the prior
        // state from the TRANSIENT awaiting/pending subscription (not the real paid
        // plan), so canceling it would strand the user on trial. The caller
        // redirects to /payment-pending for the returned request.
        const openRequestId = currentSubscription?.current_payment_request_id || null;
        if (openRequestId
            && (currentSubscription.status === 'awaiting_payment' || currentSubscription.status === 'pending_verification')) {
            const existing = await this.getPaymentRequestById(userId, openRequestId).catch(() => null);
            if (existing && (existing.payment_status === 'awaiting_payment' || existing.payment_status === 'pending_verification')) {
                return existing;
            }
        }

        // Voucher checkout commits through a transaction (request + subscription
        // + redemption + counter together) so rules can cross-check the whole
        // commit and the last-slot race stays safe.
        if (voucherCode) {
            return await this._createVoucherPaymentRequest(userId, {
                planId,
                billingFrequency,
                paymentMethod,
                paymentStatus,
                voucherCode
            });
        }

        const requestRef = doc(this._billingPaymentRequestsCol(userId));
        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        const batch = writeBatch(this.db);
        const requestPayload = {
            plan_id: planId,
            plan_name: calculation.plan.name,
            billing_frequency: billingFrequency,
            subtotal_amount: calculation.subtotalAmount,
            estimated_tax_amount: calculation.estimatedTaxAmount,
            total_amount: calculation.totalAmount,
            currency: 'IDR',
            payment_method: paymentMethod,
            payment_status: paymentStatus,
            provider: 'manual',
            provider_payment_id: null,
            provider_invoice_url: null,
            submitted_at: serverTimestamp(),
            verified_at: null,
            failed_at: null,
            expires_at: null,
            user_confirmed_payment_at: null,
            submitted_for_verification_at: null,
            proof_document_id: null,
            proof_file_name: null,
            proof_uploaded_at: null,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            // Snapshot of the subscription BEFORE this checkout, so canceling can
            // restore it (e.g. keep an existing paid plan) instead of dropping to
            // trial. Mirrors the live doc exactly — enforced by Firestore rules.
            prev_plan_id: currentSubscription?.plan_id || null,
            prev_plan_name: currentSubscription?.plan_name || null,
            prev_status: currentSubscription?.status || null,
            prev_billing_frequency: currentSubscription?.billing_frequency || null,
            voucher_id: null,
            voucher_code: null,
            voucher_discount_percent: null,
            voucher_discount_amount: null
        };

        batch.set(requestRef, requestPayload);
        const subscriptionPayload = {
            plan_id: planId,
            plan_name: calculation.plan.name,
            status: paymentStatus,
            billing_frequency: billingFrequency,
            current_payment_request_id: requestRef.id,
            trial_started_at: currentSubscription?.trial_started_at || null,
            trial_ends_at: currentSubscription?.trial_ends_at || null,
            current_period_start: currentSubscription?.current_period_start || null,
            current_period_end: currentSubscription?.current_period_end || null,
            updated_at: serverTimestamp()
        };
        batch.set(this._billingSubscriptionDoc(userId), subscriptionPayload);
        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'billing.payment_request_created',
            target_collection: 'billing_payment_requests',
            target_id: requestRef.id,
            before: null,
            after: {
                plan_id: planId,
                billing_frequency: billingFrequency,
                total_amount: calculation.totalAmount,
                currency: 'IDR',
                payment_method: paymentMethod,
                payment_status: paymentStatus
            },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        try {
            await this.syncInternalUserBillingSubscriptionIndex(
                userId,
                { id: 'current', ...subscriptionPayload },
                { id: requestRef.id, ...requestPayload }
            );
        } catch (_) { /* internal mirror is non-critical */ }
        return { id: requestRef.id, ...requestPayload };
    }

    // Voucher checkout. One transaction commits the payment request (with the
    // voucher snapshot), the subscription transition, the voucher_redemptions
    // doc, and the redemption_count bump together. Reads happen first (SDK
    // requirement); on contention the transaction retries with fresh reads, so
    // two users racing for the last slot of a limited voucher can never both
    // succeed — the loser re-reads, fails eligibility, and gets
    // voucher-usage-limit. Throws voucher-invalid | voucher-disabled |
    // voucher-expired | voucher-not-started | voucher-usage-limit |
    // voucher-plan-mismatch | voucher-frequency-mismatch.
    async _createVoucherPaymentRequest(userId, { planId, billingFrequency, paymentMethod, paymentStatus, voucherCode }) {
        const voucherRef = this._voucherCodeDoc(voucherCode);
        const subscriptionRef = this._billingSubscriptionDoc(userId);
        const result = await runTransaction(this.db, async (txn) => {
            const voucherSnap = await txn.get(voucherRef);
            if (!voucherSnap.exists()) throw new Error('voucher-invalid');
            const voucher = voucherSnap.data();
            const reason = this._assessVoucherEligibility(voucher, { planId, billingFrequency });
            if (reason) throw new Error(`voucher-${reason}`);
            const subscriptionSnap = await txn.get(subscriptionRef);
            const prevSubscription = subscriptionSnap.exists() ? subscriptionSnap.data() : null;

            const calculation = calculateBilling(planId, billingFrequency, voucher);
            const requestRef = doc(this._billingPaymentRequestsCol(userId));
            const requestPayload = {
                plan_id: planId,
                plan_name: calculation.plan.name,
                billing_frequency: billingFrequency,
                subtotal_amount: calculation.subtotalAmount,
                estimated_tax_amount: calculation.estimatedTaxAmount,
                total_amount: calculation.totalAmount,
                currency: 'IDR',
                payment_method: paymentMethod,
                payment_status: paymentStatus,
                provider: 'manual',
                provider_payment_id: null,
                provider_invoice_url: null,
                submitted_at: serverTimestamp(),
                verified_at: null,
                failed_at: null,
                expires_at: null,
                user_confirmed_payment_at: null,
                submitted_for_verification_at: null,
                proof_document_id: null,
                proof_file_name: null,
                proof_uploaded_at: null,
                created_at: serverTimestamp(),
                updated_at: serverTimestamp(),
                prev_plan_id: prevSubscription?.plan_id || null,
                prev_plan_name: prevSubscription?.plan_name || null,
                prev_status: prevSubscription?.status || null,
                prev_billing_frequency: prevSubscription?.billing_frequency || null,
                voucher_id: voucherCode,
                voucher_code: voucherCode,
                voucher_discount_percent: voucher.discount_value,
                voucher_discount_amount: calculation.voucherDiscountAmount
            };
            txn.set(requestRef, requestPayload);

            const subscriptionPayload = {
                plan_id: planId,
                plan_name: calculation.plan.name,
                status: paymentStatus,
                billing_frequency: billingFrequency,
                current_payment_request_id: requestRef.id,
                trial_started_at: prevSubscription?.trial_started_at || null,
                trial_ends_at: prevSubscription?.trial_ends_at || null,
                current_period_start: prevSubscription?.current_period_start || null,
                current_period_end: prevSubscription?.current_period_end || null,
                updated_at: serverTimestamp()
            };
            txn.set(subscriptionRef, subscriptionPayload);

            txn.set(doc(collection(this.db, `${this._scope(userId)}/audit_logs`)), {
                actor_uid: (this.actorUid || userId),
                actor_role: null,
                action: 'billing.payment_request_created',
                target_collection: 'billing_payment_requests',
                target_id: requestRef.id,
                before: null,
                after: {
                    plan_id: planId,
                    billing_frequency: billingFrequency,
                    total_amount: calculation.totalAmount,
                    currency: 'IDR',
                    payment_method: paymentMethod,
                    payment_status: paymentStatus,
                    voucher_code: voucherCode,
                    voucher_discount_amount: calculation.voucherDiscountAmount
                },
                reason: null,
                source: 'dashboard',
                created_at: serverTimestamp()
            });

            txn.set(doc(this._voucherRedemptionsCol(), requestRef.id), {
                voucher_id: voucherCode,
                code: voucherCode,
                user_id: userId,
                checkout_session_id: requestRef.id,
                plan_id: planId,
                billing_frequency: billingFrequency,
                original_amount: calculation.subtotalAmount,
                discount_amount: calculation.voucherDiscountAmount,
                final_amount: calculation.totalAmount,
                currency: 'IDR',
                status: 'reserved',
                created_at: serverTimestamp(),
                redeemed_at: null
            });

            // Explicit value (not increment()): the transactional read makes it
            // race-safe and it matches the rules' exact +1 check.
            txn.update(voucherRef, {
                redemption_count: (voucher.redemption_count || 0) + 1,
                updated_at: serverTimestamp()
            });

            return {
                request: { id: requestRef.id, ...requestPayload },
                subscriptionPayload
            };
        });
        try {
            await this.syncInternalUserBillingSubscriptionIndex(
                userId,
                { id: 'current', ...result.subscriptionPayload },
                result.request
            );
        } catch (_) { /* internal mirror is non-critical */ }
        return result.request;
    }

    async getPaymentRequestById(userId, paymentRequestId) {
        if (!userId || !paymentRequestId) return null;
        const snap = await getDoc(doc(this._billingPaymentRequestsCol(userId), paymentRequestId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Move a QRIS request from awaiting_payment to pending_verification after the
    // user confirms they paid the QR. Optionally records a proof reference
    // (document id + file name only — never the file bytes). Request update,
    // subscription transition, and audit log commit together in one batch.
    async submitPaymentRequestForVerification(userId, paymentRequestId, options = {}) {
        if (!userId) throw new Error('missing-user');
        if (!paymentRequestId) throw new Error('missing-request');
        const request = await this.getPaymentRequestById(userId, paymentRequestId);
        if (!request) throw new Error('request-not-found');
        if (request.payment_status !== 'awaiting_payment') {
            // Already submitted/verified/etc. — treat as a no-op success.
            return request;
        }

        const proofDocumentId = this._nullableString(options.proofDocumentId, 160);
        const proofFileName = this._nullableString(options.proofFileName, 240);
        const hasProof = !!proofDocumentId && !!proofFileName;

        const currentSubscription = await this.getBillingSubscription(userId);
        const requestRef = doc(this._billingPaymentRequestsCol(userId), paymentRequestId);
        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        const batch = writeBatch(this.db);

        const requestUpdate = {
            payment_status: 'pending_verification',
            user_confirmed_payment_at: serverTimestamp(),
            submitted_for_verification_at: serverTimestamp(),
            updated_at: serverTimestamp()
        };
        if (hasProof) {
            requestUpdate.proof_document_id = proofDocumentId;
            requestUpdate.proof_file_name = proofFileName;
            requestUpdate.proof_uploaded_at = serverTimestamp();
        }
        batch.update(requestRef, requestUpdate);

        const subscriptionPayload = {
            plan_id: request.plan_id,
            plan_name: request.plan_name,
            status: 'pending_verification',
            billing_frequency: request.billing_frequency,
            current_payment_request_id: paymentRequestId,
            trial_started_at: currentSubscription?.trial_started_at || null,
            trial_ends_at: currentSubscription?.trial_ends_at || null,
            current_period_start: currentSubscription?.current_period_start || null,
            current_period_end: currentSubscription?.current_period_end || null,
            updated_at: serverTimestamp()
        };
        batch.set(this._billingSubscriptionDoc(userId), subscriptionPayload);

        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'billing.payment_confirmation_submitted',
            target_collection: 'billing_payment_requests',
            target_id: paymentRequestId,
            before: { payment_status: 'awaiting_payment' },
            after: {
                payment_status: 'pending_verification',
                payment_method: request.payment_method,
                proof_attached: hasProof
            },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });

        await batch.commit();
        const updatedRequest = { ...request, ...requestUpdate, payment_status: 'pending_verification' };
        try {
            await this.syncInternalUserBillingSubscriptionIndex(
                userId,
                { id: 'current', ...subscriptionPayload },
                updatedRequest
            );
        } catch (_) { /* internal mirror is non-critical */ }
        return updatedRequest;
    }

    // Owner cancels an in-flight QRIS payment (awaiting_payment or
    // pending_verification). In one batch it voids the request
    // (payment_status -> canceled), reverts the subscription back to its trial
    // state — so access, plan limits, and the settings page stop reflecting the
    // unpaid plan — and writes an audit log. After commit it mirrors the
    // reverted status to internal_users so the ops console shows the user is no
    // longer in a payment flow. verified/failed transitions stay server-owned.
    async cancelPaymentRequest(userId, paymentRequestId) {
        if (!userId) throw new Error('missing-user');
        if (!paymentRequestId) throw new Error('missing-request');
        const request = await this.getPaymentRequestById(userId, paymentRequestId);
        if (!request) throw new Error('request-not-found');
        if (request.payment_status !== 'awaiting_payment' && request.payment_status !== 'pending_verification') {
            // Already verified/failed/expired/canceled — nothing to cancel.
            return request;
        }

        const currentSubscription = await this.getBillingSubscription(userId);
        const trialStartedAt = currentSubscription?.trial_started_at || null;
        const trialEndsAt = currentSubscription?.trial_ends_at || null;
        const periodStart = currentSubscription?.current_period_start || null;
        const periodEnd = currentSubscription?.current_period_end || null;

        // Restore the subscription to the state captured when this payment was
        // started (snapshot on the request), so canceling never downgrades an
        // existing paid plan. If the user was already on a paid plan, restore it
        // (period preserved); otherwise revert to a live trial, or expired if the
        // trial has lapsed.
        const wasActive = request.prev_status === 'active'
            && ['core', 'growth', 'enterprise'].includes(request.prev_plan_id);
        let subscriptionPayload;
        if (wasActive) {
            subscriptionPayload = {
                plan_id: request.prev_plan_id,
                plan_name: request.prev_plan_name,
                status: 'active',
                billing_frequency: request.prev_billing_frequency || null,
                current_payment_request_id: null,
                trial_started_at: trialStartedAt,
                trial_ends_at: trialEndsAt,
                current_period_start: periodStart,
                current_period_end: periodEnd,
                updated_at: serverTimestamp()
            };
        } else {
            const trialEndMs = trialEndsAt?.toMillis?.() ?? null;
            const revertStatus = (trialEndMs !== null && trialEndMs < Date.now()) ? 'expired' : 'trialing';
            subscriptionPayload = {
                plan_id: 'trial',
                plan_name: 'Trial',
                status: revertStatus,
                billing_frequency: null,
                current_payment_request_id: null,
                trial_started_at: trialStartedAt,
                trial_ends_at: trialEndsAt,
                current_period_start: null,
                current_period_end: null,
                updated_at: serverTimestamp()
            };
        }

        const requestRef = doc(this._billingPaymentRequestsCol(userId), paymentRequestId);
        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        const batch = writeBatch(this.db);

        batch.update(requestRef, {
            payment_status: 'canceled',
            updated_at: serverTimestamp()
        });

        batch.set(this._billingSubscriptionDoc(userId), subscriptionPayload);

        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'billing.payment_request_canceled',
            target_collection: 'billing_payment_requests',
            target_id: paymentRequestId,
            before: { payment_status: request.payment_status },
            after: { payment_status: 'canceled', restored_status: subscriptionPayload.status, restored_plan_id: subscriptionPayload.plan_id },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });

        await batch.commit();

        // A voucher checkout reserved a redemption — settle it to cancelled so
        // the internal usage view stays truthful. Best-effort: the redemption
        // doc shares the request's ID, and rules only allow reserved →
        // cancelled, so a repeat/odd-state cancel is a safe no-op failure.
        // (The voucher's redemption_count is NOT decremented in v1: rules only
        // permit +1 bumps, so a cancelled redemption still consumes a slot.)
        if (request.voucher_id) {
            try {
                await updateDoc(doc(this._voucherRedemptionsCol(), paymentRequestId), { status: 'cancelled' });
            } catch (_) { /* redemption settle is non-critical */ }
        }

        try {
            // Pass no request so the mirror reflects the reverted trial plan
            // (plan_id: 'trial') rather than the now-voided paid plan.
            await this.syncInternalUserBillingSubscriptionIndex(
                userId,
                { id: 'current', ...subscriptionPayload }
            );
        } catch (_) { /* internal mirror is non-critical */ }

        return { id: paymentRequestId, ...request, payment_status: 'canceled' };
    }

    async getLatestPaymentRequest(userId) {
        if (!userId) return null;
        const q = query(this._billingPaymentRequestsCol(userId), orderBy('created_at', 'desc'), limit(1));
        const snap = await getDocs(q);
        const row = snap.docs[0];
        return row ? { id: row.id, ...row.data() } : null;
    }

    async getLatestPaymentRequestWithLegacyFallback(userId) {
        const current = await this.getLatestPaymentRequest(userId);
        if (current) return current;
        const legacy = await this.getLatestPaymentVerification(userId);
        if (!legacy) return null;
        return {
            id: legacy.id,
            plan_id: legacy.plan_id || 'legacy',
            plan_name: legacy.plan_id === 'starter' ? 'Starter' : (legacy.plan_id || 'Legacy plan'),
            billing_frequency: legacy.billing_period === 'annual' ? 'annually' : (legacy.billing_period || 'monthly'),
            total_amount: Number(legacy.amount) || 0,
            currency: legacy.currency || 'IDR',
            payment_method: legacy.payment_method || 'manual',
            payment_status: legacy.status === 'verified'
                ? 'verified'
                : (legacy.status === 'rejected' ? 'failed' : 'pending_verification'),
            submitted_at: legacy.submitted_at || legacy.created_at || null,
            created_at: legacy.created_at || null,
            is_legacy: true
        };
    }

    _canonicalSubscriptionFromLegacy(access) {
        if (!access) return null;
        const knownPlan = BILLING_PLANS[access.plan_id] ? access.plan_id : null;
        const active = access.access_status === 'active'
            || access.access_status === 'payment_verified'
            || access.payment_status === 'verified';
        const pending = access.access_status === 'payment_submitted'
            || ['submitted', 'under_review'].includes(access.payment_status);
        const failed = access.payment_status === 'rejected';
        const expired = access.access_status === 'trial_expired';
        const suspended = access.access_status === 'suspended';
        const status = suspended
            ? 'suspended'
            : active
                ? 'active'
                : pending
                    ? 'pending_verification'
                    : failed
                        ? 'payment_failed'
                        : expired
                            ? 'expired'
                            : 'trialing';

        return {
            plan_id: knownPlan || (status === 'trialing' || status === 'expired' ? 'trial' : null),
            plan_name: knownPlan ? BILLING_PLANS[knownPlan].name : (status === 'trialing' || status === 'expired' ? 'Trial' : null),
            status,
            billing_frequency: null,
            current_payment_request_id: null,
            trial_started_at: access.trial_started_at || null,
            trial_ends_at: access.trial_ends_at || null,
            current_period_start: null,
            current_period_end: null
        };
    }

    _billingPeriodForFrequency(billingFrequency, startValue = null) {
        if (!['monthly', 'annually'].includes(billingFrequency)) return null;
        const startTs = startValue ? this._coerceTimestampOrNow(startValue) : Timestamp.fromDate(new Date());
        const startDate = startTs.toDate();
        const endDate = new Date(startDate.getTime());
        if (billingFrequency === 'annually') {
            endDate.setFullYear(endDate.getFullYear() + 1);
        } else {
            endDate.setMonth(endDate.getMonth() + 1);
        }
        return {
            current_period_start: startTs,
            current_period_end: Timestamp.fromDate(endDate)
        };
    }

    _needsActiveBillingPeriod(subscription) {
        return subscription?.status === 'active'
            && ['monthly', 'annually'].includes(subscription.billing_frequency)
            && !subscription.current_period_end;
    }

    async backfillActiveBillingPeriod(userId, subscription, startValue = null) {
        if (!this._needsActiveBillingPeriod(subscription)) return subscription;
        const period = this._billingPeriodForFrequency(subscription.billing_frequency, startValue);
        if (!period) return subscription;
        await this.upsertBillingSubscription(userId, period);
        return { ...subscription, ...period };
    }

    // Carry a reviewer's verify/reject decision from the open internal_users index
    // into the canonical billing_subscription (the ops console has no Firebase
    // identity, so it can't write owner-scoped billing docs itself). Only acts on
    // reviewable states and only when the internal decision is newer than the
    // subscription's own last write — so a fresh retry is never clobbered by a
    // stale prior rejection. Verified payments also stamp the billing period from
    // the admin verification time so settings can show the next billing date.
    // UX-only enforcement: a real backend should own this.
    async reconcileBillingFromInternalIndex(userId, subscription) {
        try {
            if (!subscription || subscription.status === 'suspended') {
                return subscription;
            }
            const internal = await this.getInternalUser(userId);
            if (!internal) return subscription;
            const subUpdatedMs = subscription.updated_at?.toMillis?.() ?? 0;
            const intUpdatedMs = internal.updated_at?.toMillis?.() ?? 0;
            let newStatus = null;
            let updatePayload = null;
            if (internal.payment_status === 'verified') {
                // Active sub missing its billing period → backfill it (no status change).
                if (this._needsActiveBillingPeriod(subscription)) {
                    return await this.backfillActiveBillingPeriod(userId, subscription, internal.payment_verified_at || null);
                }
                // A verified payment is a definitive grant: promote to active, but
                // only from a NOT-yet-active state. `active` is a no-op and
                // `cancel_scheduled` is a deliberate user choice (renewal canceled,
                // access kept until period end) — re-promoting it would silently
                // undo the cancellation on the next read. Mirrors the allowed prev
                // states of the isInternalReviewReconcile Firestore rule.
                // Do NOT require the internal write to be newer — the automatic
                // trial-expiry write bumps the subscription's updated_at after the
                // manual review, which would otherwise strand the approved user
                // on the "Your trial has ended" banner forever.
                if (['pending_verification', 'awaiting_payment', 'expired', 'trialing'].includes(subscription.status)) {
                    newStatus = 'active';
                    const period = subscription.current_period_end
                        ? null
                        : this._billingPeriodForFrequency(subscription.billing_frequency, internal.payment_verified_at || null);
                    updatePayload = this._cleanDefined(period ? { status: newStatus, ...period } : { status: newStatus });
                }
            } else if (internal.payment_status === 'rejected'
                && ['pending_verification', 'awaiting_payment'].includes(subscription.status)
                && intUpdatedMs > subUpdatedMs) {
                // Only fail an in-flight payment, and never clobber a fresh retry.
                newStatus = 'payment_failed';
                updatePayload = { status: newStatus };
            }
            if (!newStatus || newStatus === subscription.status) return subscription;
            await this.upsertBillingSubscription(userId, updatePayload || { status: newStatus });
            return { ...subscription, ...(updatePayload || { status: newStatus }) };
        } catch (_) {
            return subscription;
        }
    }

    // Read the reviewer's note (rejection/verification reason) for display on the
    // user's payment status page. Open internal_users read; non-sensitive metadata.
    async getBillingReviewReason(userId) {
        if (!userId) return null;
        try {
            const internal = await this.getInternalUser(userId);
            return internal?.last_internal_note || null;
        } catch (_) {
            return null;
        }
    }

    async ensureBillingSubscription(userId) {
        if (!userId) return null;
        const current = await this.getBillingSubscription(userId);
        if (current) {
            const reconciled = await this.reconcileBillingFromInternalIndex(userId, current);
            return this.expireBillingSubscriptionIfNeeded(userId, reconciled || current);
        }

        const legacyAccess = await this.getBillingAccess(userId).catch(() => null);
        if (legacyAccess) {
            const translated = this._canonicalSubscriptionFromLegacy(legacyAccess);
            if (translated?.status === 'suspended' || !translated?.plan_id) {
                return translated;
            }
            await this.upsertBillingSubscription(userId, translated);
            return { id: 'current', ...translated };
        }

        const progress = await this.getOnboardingProgress(userId).catch(() => null);
        const eligible = !!progress && (progress.onboarding_completed === true || progress.onboarding_exempt === true);
        if (!eligible) return null;

        const startMs = progress.completed_at?.toMillis?.() || Date.now();
        const subscription = {
            plan_id: 'trial',
            plan_name: 'Trial',
            status: 'trialing',
            billing_frequency: null,
            current_payment_request_id: null,
            trial_started_at: Timestamp.fromMillis(startMs),
            trial_ends_at: Timestamp.fromMillis(startMs + TRIAL_DURATION_DAYS * DAY_MS),
            current_period_start: null,
            current_period_end: null
        };
        await this.upsertBillingSubscription(userId, subscription);
        try {
            await this.addAuditLog(userId, {
                action: 'trial.created',
                target_collection: 'billing',
                target_id: 'current',
                after: { status: 'trialing', trial_duration_days: TRIAL_DURATION_DAYS },
                source: 'system'
            });
        } catch (_) { /* non-fatal */ }
        return { id: 'current', ...subscription };
    }

    async expireBillingSubscriptionIfNeeded(userId, subscription = null) {
        const current = subscription || await this.getBillingSubscription(userId);
        if (!current || current.status !== 'trialing') return current;
        const endMs = current.trial_ends_at?.toMillis?.();
        if (!endMs || endMs >= Date.now()) return current;
        await this.upsertBillingSubscription(userId, { status: 'expired' });
        try {
            await this.addAuditLog(userId, {
                action: 'trial.expired',
                target_collection: 'billing',
                target_id: 'current',
                before: { status: 'trialing' },
                after: { status: 'expired' },
                source: 'system'
            });
        } catch (_) { /* non-fatal */ }
        return { ...current, status: 'expired' };
    }

    // ===== Billing & plan settings page (Phase 1, read-only view) =====
    // The Billing & plan settings surface reads the SAME canonical subscription
    // doc the trial/paywall system uses (users/{uid}/billing_subscription/current)
    // so it never diverges from the live access banner. It normalizes that doc
    // into a presentation view-model and layers seat/storage limits from
    // PLAN_LIMITS. The frontend NEVER writes subscription status here — billing
    // actions go to a trusted backend that is not part of this build and fail
    // safely (see the request* methods). Firestore rules also block client
    // status writes, so there is no frontend-only subscription mutation path.

    _billingPlanCatalogEntry(planId) {
        const limits = getPlanLimits(planId) || {
            tier: null,
            seat_limit: null,
            storage_limit_bytes: null,
            storage_limit_gb: null,
            storage_note: null,
            ai_chat_limit: null,
            ai_chat_scope: null,
            doc_processing_limit: null
        };
        return {
            seat_limit: limits.seat_limit ?? null,
            storage_limit_bytes: limits.storage_limit_bytes ?? null,
            storage_limit_gb: limits.storage_limit_gb ?? null,
            storage_note: limits.storage_note || null,
            ai_chat_limit: limits.ai_chat_limit ?? null,
            ai_chat_scope: limits.ai_chat_scope || null,
            doc_processing_limit: limits.doc_processing_limit ?? null,
            tier: limits.tier || null
        };
    }

    _effectiveBillingPlanId(subscription) {
        if (!subscription || !subscription.status) return null;
        if ((subscription.status === 'active' || subscription.status === 'cancel_scheduled') && subscription.plan_id) {
            return subscription.plan_id;
        }
        // While a payment is waiting/reviewing, access still behaves like trial
        // until the internal verification promotes the plan to active.
        if (['trialing', 'awaiting_payment', 'pending_verification', 'payment_failed', 'expired'].includes(subscription.status)) {
            return 'trial';
        }
        return subscription.plan_id || null;
    }

    async getBillingEntitlements(userId, subscription = null) {
        const current = subscription || await this.ensureBillingSubscription(userId).catch(() => null);
        const effectivePlanId = this._effectiveBillingPlanId(current);
        const limits = this._billingPlanCatalogEntry(effectivePlanId);
        return {
            subscription: current,
            effective_plan_id: effectivePlanId,
            is_trial_entitlement: effectivePlanId === 'trial',
            ...limits
        };
    }

    async assertCanUseStorage(userId, incomingBytes = 0, options = {}) {
        if (!userId) throw new Error('Please sign in again before uploading.');
        const size = Math.max(0, Math.floor(Number(incomingBytes) || 0));
        const entitlements = await this.getBillingEntitlements(userId);
        const limitBytes = Number(entitlements.storage_limit_bytes);
        if (!Number.isFinite(limitBytes) || limitBytes <= 0) return true;
        const usage = await this.getBillingUsage(userId);
        if (!usage.storage?.available) {
            const err = new Error('Storage usage could not be checked. Please try again.');
            err.code = 'storage_usage_unavailable';
            throw err;
        }
        const used = Math.max(0, Number(usage.storage.bytes) || 0);
        if (used + size <= limitBytes) return true;
        const err = new Error(entitlements.is_trial_entitlement
            ? 'Your trial storage limit is 5 MB. Choose a plan to upload more documents.'
            : 'Your plan storage limit has been reached. Upgrade your plan to upload more documents.');
        err.code = entitlements.is_trial_entitlement ? 'trial_storage_limit_reached' : 'storage_limit_reached';
        err.limitBytes = limitBytes;
        err.usedBytes = used;
        err.incomingBytes = size;
        err.source = options.source || 'storage';
        throw err;
    }

    _normalizeBillingSettingsOverview(subscription) {
        if (!subscription || !subscription.status) {
            return { status: 'none', raw_status: subscription?.status || null, has_plan: false, plan_id: null };
        }
        const rawStatus = String(subscription.status);
        const planId = subscription.plan_id || null;
        // Seat/storage/AI limits reflect what the user can actually use RIGHT NOW,
        // not the plan they are paying for. While a payment is awaiting/pending
        // verification (or trial/expired), access still behaves like trial until
        // the internal verification promotes the plan to active — so we layer the
        // entitlement fields from the EFFECTIVE plan, matching getBillingEntitlements
        // and assertCanUseStorage. Identity fields (plan_id/name/description/price)
        // still describe the plan being activated so the chip can say "… in review".
        const catalog = this._billingPlanCatalogEntry(this._effectiveBillingPlanId(subscription));
        const billingFrequency = subscription.billing_frequency || null;
        let priceAmount = null;
        if (BILLING_PLANS[planId] && (billingFrequency === 'monthly' || billingFrequency === 'annually')) {
            priceAmount = calculateBilling(planId, billingFrequency).monthlyDisplayAmount;
        }
        return {
            status: rawStatus,
            raw_status: rawStatus,
            has_plan: rawStatus !== 'none',
            plan_id: planId,
            plan_tier: catalog.tier,
            plan_name: subscription.plan_name || PLAN_DISPLAY_NAMES[planId] || (planId || 'Plan'),
            plan_description: BILLING_PLANS[planId]?.description || null,
            billing_cycle: billingFrequency,
            price_amount: priceAmount,
            sales_led: BILLING_PLANS[planId]?.salesLed === true,
            currency: 'IDR',
            seat_limit: catalog.seat_limit,
            storage_limit_gb: catalog.storage_limit_gb,
            storage_limit_bytes: catalog.storage_limit_bytes,
            storage_note: catalog.storage_note,
            ai_chat_limit: catalog.ai_chat_limit,
            ai_chat_scope: catalog.ai_chat_scope,
            trial_start_at: subscription.trial_started_at || null,
            trial_end_at: subscription.trial_ends_at || null,
            current_period_start: subscription.current_period_start || null,
            current_period_end: subscription.current_period_end || null,
            renews_at: subscription.renews_at || subscription.current_period_end || null,
            cancel_at_period_end: subscription.cancel_at_period_end === true,
            provider: subscription.provider || null,
            billing_email: subscription.billing_email || null,
            payment_status: subscription.payment_status || null,
            latest_invoice_id: subscription.latest_invoice_id || null,
            current_payment_request_id: subscription.current_payment_request_id || null,
            updated_at: subscription.updated_at || null
        };
    }

    async getBillingSettingsOverview(userId) {
        if (!userId) return { status: 'none', has_plan: false, plan_id: null };
        let subscription = null;
        try {
            subscription = await this.ensureBillingSubscription(userId);
        } catch (ensureErr) {
            // ensureBillingSubscription performs writes (trial create / expiry /
            // reconcile) and can fail transiently. Fall back to a plain read; if
            // that ALSO throws, let it propagate so the page shows its error state
            // instead of a misleading "no plan".
            subscription = await this.getBillingSubscription(userId);
        }
        return this._normalizeBillingSettingsOverview(subscription);
    }

    async getBillingInvoices(userId, limitCount = 20) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `users/${userId}/billing_invoices`),
                orderBy('invoice_date', 'desc'),
                limit(limitCount)
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            // billing_invoices has no client write path and may not be deployed/
            // populated yet; a missing rule or empty collection both resolve to
            // "no history" rather than a thrown error.
            return [];
        }
    }

    _startOfCurrentMonthMs() {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    // `YYYY-MM` in Asia/Jakarta — must match the brain endpoint's monthKeyJakarta
    // so the client reads the same `ai_chat_<YYYY-MM>` counter the server writes.
    _currentMonthKey() {
        const jakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        return `${jakarta.getFullYear()}-${String(jakarta.getMonth() + 1).padStart(2, '0')}`;
    }

    // Client preflight for monthly document-processing quota. Mirrors the
    // storage preflight model (assertCanUseStorage): not fully race-proof, but
    // it blocks the common over-limit case before an upload. `null` limit =
    // unlimited (enterprise) or unmetered scope (trial is storage-bound).
    async assertCanProcessDocument(userId, incomingCount = 1, options = {}) {
        if (!userId) throw new Error('Please sign in again before uploading.');
        const entitlements = await this.getBillingEntitlements(userId);
        const limit = Number(entitlements.doc_processing_limit);
        if (!Number.isFinite(limit) || limit <= 0) return true;
        const usage = await this.getBillingUsage(userId);
        if (!usage.documents_this_month?.available) return true; // never block on an unavailable count
        const used = Math.max(0, Number(usage.documents_this_month.count) || 0);
        if (used + incomingCount <= limit) return true;
        const err = new Error('Your plan’s monthly document processing limit has been reached. Upgrade your plan to process more documents.');
        err.code = 'doc_processing_limit_reached';
        err.limit = limit;
        err.used = used;
        err.source = options.source || 'document';
        throw err;
    }

    async getBillingUsage(userId) {
        const usage = {
            storage: { bytes: 0, available: false },
            documents_this_month: { count: 0, available: false },
            report_exports_this_month: { count: 0, available: false },
            ai_questions_this_month: { count: null, available: false },
            whatsapp_uploads_this_month: { count: null, available: false }
        };
        if (!userId) return usage;
        const monthStartMs = this._startOfCurrentMonthMs();
        const entitlements = await this.getBillingEntitlements(userId).catch(() => null);
        const aiLimit = entitlements?.ai_chat_limit ?? null;
        const aiScope = entitlements?.ai_chat_scope || 'trial';
        const docLimit = entitlements?.doc_processing_limit ?? null;

        // Storage + document uploads share one bounded read of the documents
        // collection so we never invent numbers or double-read.
        try {
            let bytes = 0;
            let docsThisMonth = 0;
            const docsSnap = await getDocs(query(collection(this.db, `${this._scope(userId)}/documents`), limit(500)));
            docsSnap.forEach((d) => {
                const data = d.data() || {};
                const size = Number(data.file_size);
                if (Number.isFinite(size) && size > 0) bytes += size;
                const createdMs = data.created_at?.toMillis?.() ?? 0;
                if (createdMs >= monthStartMs) docsThisMonth += 1;
            });
            // Bank statement imports also consume storage.
            try {
                const impSnap = await getDocs(query(collection(this.db, `${this._scope(userId)}/bank_statement_imports`), limit(500)));
                impSnap.forEach((d) => {
                    const size = Number((d.data() || {}).file_size);
                    if (Number.isFinite(size) && size > 0) bytes += size;
                });
            } catch (_) { /* optional source */ }
            usage.storage = { bytes, available: true };
            usage.documents_this_month = { count: docsThisMonth, available: true, limit: docLimit };
        } catch (_) { /* leave as unavailable — never fabricate */ }

        // Report exports this month (bounded recent read, filtered client-side).
        try {
            const exports = await this.getRecentReportExports(userId, 100);
            const count = exports.filter((e) => (e.created_at?.toMillis?.() ?? 0) >= monthStartMs).length;
            usage.report_exports_this_month = { count, available: true };
        } catch (_) { /* leave as unavailable */ }

        try {
            // Trial uses the lifetime `ai_chat_trial` counter; paid plans use the
            // per-month `ai_chat_<YYYY-MM>` counter written by the brain endpoint.
            const aiDocId = aiScope === 'plan' ? `ai_chat_${this._currentMonthKey()}` : 'ai_chat_trial';
            const aiSnap = await getDoc(doc(this.db, `users/${userId}/usage_limits/${aiDocId}`));
            const count = aiSnap.exists() ? Number((aiSnap.data() || {}).count) : 0;
            usage.ai_questions_this_month = {
                count: Number.isFinite(count) ? Math.max(0, count) : 0,
                limit: aiLimit,
                available: true
            };
        } catch (_) { /* leave as unavailable */ }

        return usage;
    }

    // Billing actions are owned by a trusted backend that is NOT part of this
    // build. These helpers attempt the documented endpoints and fail safely;
    // they never fake success and never mutate subscription status client-side.
    _billingApiUrl(path) {
        return `/api/v1/billing${path}`;
    }

    async _callBillingApi(path, { method = 'POST', body = null } = {}) {
        let controller = null;
        let timer = null;
        try {
            controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            if (controller) timer = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(this._billingApiUrl(path), {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : null,
                signal: controller ? controller.signal : undefined
            });
            if (timer) clearTimeout(timer);
            if (!res.ok) return { ok: false, status: res.status, reason: 'backend_unavailable' };
            // Guard against SPA/HTML fallbacks (Netlify serves index.html for
            // unknown routes with status 200): only a real JSON billing response
            // counts as connected, so we never mistake the SPA shell for success.
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                return { ok: false, status: res.status, reason: 'backend_unavailable' };
            }
            let data = null;
            try { data = await res.json(); } catch (_) { return { ok: false, status: res.status, reason: 'invalid_response' }; }
            return { ok: true, status: res.status, data };
        } catch (_) {
            if (timer) clearTimeout(timer);
            return { ok: false, status: 0, reason: 'backend_unavailable' };
        }
    }

    async requestBillingCheckout(userId, planId) {
        const res = await this._callBillingApi('/checkout', { body: { uid: userId || null, plan_id: planId || null } });
        if (res.ok && res.data && typeof res.data.checkout_url === 'string' && res.data.checkout_url) {
            return { ok: true, checkout_url: res.data.checkout_url };
        }
        // No billing backend in this build → route to the existing manual checkout
        // page (a real flow). This is not a fake success and never changes status.
        const checkoutPlan = resolveCheckoutPlanId(planId);
        return { ok: true, fallback: true, checkout_url: `/checkout?plan=${encodeURIComponent(checkoutPlan)}&billing=annually` };
    }

    async requestBillingUpgrade(userId, planId) {
        const res = await this._callBillingApi('/upgrade', { body: { uid: userId || null, plan_id: planId || null } });
        if (res.ok && res.data && typeof res.data.checkout_url === 'string' && res.data.checkout_url) {
            return { ok: true, checkout_url: res.data.checkout_url };
        }
        const checkoutPlan = resolveCheckoutPlanId(planId);
        return { ok: true, fallback: true, checkout_url: `/checkout?plan=${encodeURIComponent(checkoutPlan)}&billing=annually` };
    }

    // Owner schedules cancellation of an active subscription's renewal. Access is
    // retained until the current period ends (status -> cancel_scheduled, which
    // _effectiveBillingPlanId still treats as a paid entitlement); only the
    // lifecycle status changes. Writes an audit log and mirrors to internal_users.
    async requestCancelRenewal(userId) {
        if (!userId) return { ok: false, reason: 'missing-user' };
        const sub = await this.getBillingSubscription(userId);
        if (!sub || sub.status !== 'active') return { ok: false, reason: 'not_active' };

        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        const batch = writeBatch(this.db);
        batch.update(this._billingSubscriptionDoc(userId), {
            status: 'cancel_scheduled',
            updated_at: serverTimestamp()
        });
        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'billing.renewal_canceled',
            target_collection: 'billing',
            target_id: 'current',
            before: { status: 'active' },
            after: { status: 'cancel_scheduled' },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        try {
            await this.syncInternalUserBillingSubscriptionIndex(userId, { id: 'current', ...sub, status: 'cancel_scheduled' });
        } catch (_) { /* internal mirror is non-critical */ }
        return { ok: true };
    }

    // Owner resumes renewal on a cancel_scheduled subscription (-> active). They
    // already hold the paid entitlement during the scheduled period, so this is
    // never an access escalation.
    async requestReactivateSubscription(userId) {
        if (!userId) return { ok: false, reason: 'missing-user' };
        const sub = await this.getBillingSubscription(userId);
        if (!sub || sub.status !== 'cancel_scheduled') return { ok: false, reason: 'not_cancel_scheduled' };

        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        const batch = writeBatch(this.db);
        batch.update(this._billingSubscriptionDoc(userId), {
            status: 'active',
            updated_at: serverTimestamp()
        });
        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: 'billing.renewal_reactivated',
            target_collection: 'billing',
            target_id: 'current',
            before: { status: 'cancel_scheduled' },
            after: { status: 'active' },
            reason: null,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        try {
            await this.syncInternalUserBillingSubscriptionIndex(userId, { id: 'current', ...sub, status: 'active' });
        } catch (_) { /* internal mirror is non-critical */ }
        return { ok: true };
    }

    async getBillingAccess(userId) {
        if (!userId) return null;
        const snap = await getDoc(this._billingAccessDoc(userId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    // Create the access doc once. Idempotent — returns the existing doc untouched if
    // it already exists, so a trial is never reset. Stores concrete Timestamps for
    // trial_started_at/trial_ends_at so countdown + mirror math is consistent.
    async createTrialAccess(userId, payload = {}) {
        const ref = this._billingAccessDoc(userId);
        const existing = await getDoc(ref);
        if (existing.exists()) return { id: existing.id, ...existing.data() };

        const durationDays = Number.isFinite(payload.trial_duration_days) ? payload.trial_duration_days : TRIAL_DURATION_DAYS;
        const startMs = (payload.trial_started_at && typeof payload.trial_started_at.toMillis === 'function')
            ? payload.trial_started_at.toMillis()
            : Date.now();
        const startTs = Timestamp.fromMillis(startMs);
        const endTs = Timestamp.fromMillis(startMs + durationDays * DAY_MS);

        const data = {
            access_status: this._allowedValue(payload.access_status, ACCESS_STATUSES, 'trial_active'),
            trial_duration_days: durationDays,
            trial_started_at: startTs,
            trial_ends_at: endTs,
            trial_expired_at: null,
            payment_required: payload.payment_required !== false,
            payment_status: this._allowedValue(payload.payment_status, BILLING_PAYMENT_STATUSES, 'not_started'),
            plan_id: this._nullableString(payload.plan_id, 40),
            account_status: this._allowedValue(payload.account_status, BILLING_ACCOUNT_STATUSES, 'trial'),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        };
        await setDoc(ref, data);
        return { id: 'access', ...data };
    }

    // Start the trial only after the user can access the app (onboarding completed
    // or legacy-exempt). No-op if an access doc already exists. Best-effort audit +
    // internal mirror — never throws into the caller's critical path.
    async ensureTrialAccessAfterOnboarding(userId) {
        if (!userId) return null;
        const existing = await this.getBillingAccess(userId);
        if (existing) return existing;

        const progress = await this.getOnboardingProgress(userId).catch(() => null);
        const eligible = !!progress && (progress.onboarding_completed === true || progress.onboarding_exempt === true);
        if (!eligible) return null;

        const startTs = (progress.completed_at && typeof progress.completed_at.toMillis === 'function')
            ? progress.completed_at
            : null;
        const created = await this.createTrialAccess(userId, {
            access_status: 'trial_active',
            trial_duration_days: TRIAL_DURATION_DAYS,
            trial_started_at: startTs,
            payment_status: 'not_started',
            account_status: 'trial'
        });

        try {
            await this.addAuditLog(userId, {
                action: 'trial.created',
                target_collection: 'billing',
                target_id: 'access',
                after: { access_status: 'trial_active', trial_duration_days: TRIAL_DURATION_DAYS },
                source: 'system'
            });
        } catch (e) { /* non-fatal */ }
        try { await this.syncInternalUserAccessIndex(userId, created); } catch (e) { /* non-fatal */ }
        return created;
    }

    async updateBillingAccess(userId, payload = {}) {
        if (!userId) return null;
        const clean = this._cleanDefined({
            access_status: 'access_status' in payload ? this._allowedValue(payload.access_status, ACCESS_STATUSES, undefined) : undefined,
            payment_status: 'payment_status' in payload ? this._allowedValue(payload.payment_status, BILLING_PAYMENT_STATUSES, undefined) : undefined,
            account_status: 'account_status' in payload ? this._allowedValue(payload.account_status, BILLING_ACCOUNT_STATUSES, undefined) : undefined,
            plan_id: 'plan_id' in payload ? this._nullableString(payload.plan_id, 40) : undefined,
            trial_expired_at: payload.trial_expired_at instanceof Timestamp ? payload.trial_expired_at : undefined,
            updated_at: serverTimestamp()
        });
        await setDoc(this._billingAccessDoc(userId), clean, { merge: true });
        try {
            const fresh = await this.getBillingAccess(userId);
            if (fresh) await this.syncInternalUserAccessIndex(userId, fresh);
        } catch (e) { /* non-fatal */ }
        return clean;
    }

    // Flip an active trial to expired once trial_ends_at has passed. UX-only — a real
    // server check is still required for enforcement (documented limitation).
    async expireTrialIfNeeded(userId) {
        const access = await this.getBillingAccess(userId);
        if (!access) return null;
        const endsAt = access.trial_ends_at;
        const endMs = endsAt && typeof endsAt.toMillis === 'function' ? endsAt.toMillis() : null;
        const inTrial = access.access_status === 'trial_active' || access.access_status === 'trial_expiring';
        if (!inTrial || endMs === null || endMs >= Date.now()) return access;

        await setDoc(this._billingAccessDoc(userId), {
            access_status: 'trial_expired',
            trial_expired_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        try {
            await this.addAuditLog(userId, {
                action: 'trial.expired',
                target_collection: 'billing',
                target_id: 'access',
                before: { access_status: access.access_status },
                after: { access_status: 'trial_expired' },
                source: 'system'
            });
        } catch (e) { /* non-fatal */ }
        const updated = { ...access, access_status: 'trial_expired' };
        try { await this.syncInternalUserAccessIndex(userId, updated); } catch (e) { /* non-fatal */ }
        return updated;
    }

    async getPaymentVerifications(userId) {
        if (!userId) return [];
        const q = query(this._paymentVerificationsCol(userId), orderBy('created_at', 'desc'), limit(20));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    async getLatestPaymentVerification(userId) {
        const list = await this.getPaymentVerifications(userId);
        return list[0] || null;
    }

    // Manual bank-transfer proof submission. Writes the owner-scoped verification doc
    // and flips billing access to payment_submitted in one batch, then best-effort
    // denormalizes status metadata (no proof image) to the open internal index so the
    // console Payment Review queue can see it. NEVER auto-activates the user.
    async submitPaymentVerification(userId, payload = {}) {
        if (!userId) throw new Error('missing-user');
        const amount = Math.max(0, Math.round(Number(payload.amount) || 0));
        const planId = this._nullableString(payload.plan_id, 40);
        const billingPeriod = this._allowedValue(payload.billing_period, ['monthly', 'annual', 'custom'], 'monthly');
        const paymentMethod = this._allowedValue(payload.payment_method, ['bank_transfer', 'manual', 'other'], 'bank_transfer');
        const proofDocId = this._nullableString(payload.proof_document_id, 160);
        const proofFileName = this._nullableString(payload.proof_file_name, 240);
        const note = this._nullableString(payload.submitted_note, 500);

        const batch = writeBatch(this.db);
        const verRef = doc(this._paymentVerificationsCol(userId));
        batch.set(verRef, {
            amount,
            currency: 'IDR',
            plan_id: planId,
            billing_period: billingPeriod,
            payment_method: paymentMethod,
            proof_document_id: proofDocId,
            proof_file_name: proofFileName,
            submitted_note: note,
            status: 'submitted',
            reviewer_id: null,
            reviewer_note: null,
            submitted_at: serverTimestamp(),
            reviewed_at: null,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        batch.set(this._billingAccessDoc(userId), {
            access_status: 'payment_submitted',
            payment_status: 'submitted',
            plan_id: planId,
            updated_at: serverTimestamp()
        }, { merge: true });
        await batch.commit();

        try {
            await this.syncInternalUserAccessIndex(userId, {
                access_status: 'payment_submitted',
                payment_status: 'submitted',
                payment_submitted_at: serverTimestamp(),
                plan_id: planId,
                payment_amount: amount,
                payment_method: paymentMethod,
                payment_proof_file_name: proofFileName
            });
        } catch (e) { console.warn('[billing] internal payment sync skipped'); }
        try {
            await this.addAuditLog(userId, {
                action: 'payment.submitted',
                target_collection: 'payment_verifications',
                target_id: verRef.id,
                after: { amount, payment_method: paymentMethod, status: 'submitted' },
                source: 'dashboard'
            });
        } catch (e) { /* non-fatal */ }
        return { id: verRef.id, amount, status: 'submitted' };
    }

    _internalBillingMirrorPayload(subscription = {}, request = null) {
        if (!subscription) return null;
        const requestStatus = request?.payment_status || null;
        const status = subscription.status || requestStatus || null;
        const trialEndMs = subscription.trial_ends_at?.toMillis?.() ?? null;
        const trialIsEnding = trialEndMs !== null && trialEndMs - Date.now() <= DAY_MS;
        let accessStatus;
        let paymentStatus;

        if (status === 'active' || requestStatus === 'verified') {
            accessStatus = 'active';
            paymentStatus = 'verified';
        } else if (status === 'cancel_scheduled') {
            // Renewal canceled but still inside the paid period — access remains.
            accessStatus = 'active';
            paymentStatus = 'verified';
        } else if (status === 'payment_failed' || requestStatus === 'failed') {
            accessStatus = 'payment_pending';
            paymentStatus = 'rejected';
        } else if (status === 'awaiting_payment' || requestStatus === 'awaiting_payment') {
            accessStatus = 'payment_pending';
            paymentStatus = 'pending';
        } else if (status === 'pending_verification' || requestStatus === 'pending_verification') {
            accessStatus = 'payment_submitted';
            paymentStatus = 'submitted';
        } else if (status === 'expired') {
            accessStatus = 'trial_expired';
            paymentStatus = 'pending';
        } else if (status === 'trialing') {
            accessStatus = trialIsEnding ? 'trial_expiring' : 'trial_active';
            paymentStatus = 'pending';
        } else if (status === 'suspended') {
            accessStatus = 'suspended';
        }

        const paymentAmount = Number(request?.total_amount);
        return this._cleanDefined({
            access_status: accessStatus,
            payment_status: paymentStatus,
            trial_started_at: subscription.trial_started_at || undefined,
            trial_ends_at: subscription.trial_ends_at || undefined,
            payment_submitted_at: paymentStatus === 'submitted'
                ? (request?.submitted_for_verification_at || request?.user_confirmed_payment_at || request?.submitted_at || serverTimestamp())
                : undefined,
            payment_verified_at: paymentStatus === 'verified' ? (request?.verified_at || undefined) : undefined,
            plan_id: 'plan_id' in subscription || request?.plan_id ? (request?.plan_id || subscription.plan_id || null) : undefined,
            payment_amount: Number.isFinite(paymentAmount) ? paymentAmount : undefined,
            payment_method: request?.payment_method || undefined,
            payment_proof_file_name: request?.proof_file_name || undefined
        });
    }

    async syncInternalUserBillingSubscriptionIndex(userId, subscription = {}, request = null) {
        if (!userId || !subscription) return null;
        let linkedRequest = request || null;
        if (!linkedRequest && subscription.current_payment_request_id) {
            linkedRequest = await this.getPaymentRequestById(userId, subscription.current_payment_request_id).catch(() => null);
        }
        const payload = this._internalBillingMirrorPayload(subscription, linkedRequest);
        if (!payload || !Object.keys(payload).length) return null;
        return await this.syncInternalUserAccessIndex(userId, payload);
    }

    // Mirror non-financial trial/payment status fields into internal_users/{uid}.
    // Reuses the open index seeded by syncSelfToInternalIndex; never writes ledger
    // data, secrets, or formatted currency, and never clobbers reviewer KYC fields.
    async syncInternalUserAccessIndex(userId, payload = {}) {
        if (!userId) return null;
        const ref = this._internalUserDoc(userId);
        const snap = await getDoc(ref);

        let daysRemaining;
        const endsAt = payload.trial_ends_at;
        if (endsAt && typeof endsAt.toMillis === 'function') {
            const diff = endsAt.toMillis() - Date.now();
            daysRemaining = diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
        }
        const internalPaymentStatus = 'payment_status' in payload
            ? this._allowedValue(payload.payment_status, INTERNAL_PAYMENT_STATUSES, undefined)
            : undefined;

        const patch = this._cleanDefined({
            access_status: 'access_status' in payload ? this._allowedValue(payload.access_status, ACCESS_STATUSES, undefined) : undefined,
            trial_started_at: payload.trial_started_at instanceof Timestamp ? payload.trial_started_at : undefined,
            trial_ends_at: payload.trial_ends_at instanceof Timestamp ? payload.trial_ends_at : undefined,
            trial_days_remaining: daysRemaining,
            payment_status: internalPaymentStatus,
            payment_submitted_at: payload.payment_submitted_at,
            payment_verified_at: payload.payment_verified_at,
            plan_id: 'plan_id' in payload ? (payload.plan_id || null) : undefined,
            payment_amount: 'payment_amount' in payload ? (Number.isFinite(payload.payment_amount) ? payload.payment_amount : null) : undefined,
            payment_method: 'payment_method' in payload ? (payload.payment_method || null) : undefined,
            payment_proof_file_name: 'payment_proof_file_name' in payload ? (payload.payment_proof_file_name || null) : undefined,
            updated_at: serverTimestamp()
        });

        if (!snap.exists()) {
            // Normally seeded by syncSelfToInternalIndex on login; seed a minimal row
            // if it isn't there yet so trial status is still visible to the console.
            await setDoc(ref, this._cleanDefined({
                user_id: userId,
                account_status: 'registered',
                kyc_status: 'not_started',
                payment_status: internalPaymentStatus || 'pending',
                created_at: serverTimestamp(),
                ...patch
            }));
            return 'created';
        }
        await setDoc(ref, patch, { merge: true });
        return 'updated';
    }

    // --- FLUXY AI CHAT HISTORY ---
    getAIChatExpiryDate() {
        // TODO: Configure Firestore TTL or scheduled cleanup for ai_chats.expires_at.
        return Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
    }

    async createAIChat(userId, data = {}) {
        const expiresAt = data.expires_at || this.getAIChatExpiryDate();
        return await addDoc(collection(this.db, `users/${userId}/ai_chats`), {
            title: data.title || 'New AI chat',
            summary: data.summary || '',
            last_message_preview: data.last_message_preview || '',
            intent: data.intent || 'finance_analysis',
            source: 'ai_command_center',
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            last_activity_at: serverTimestamp(),
            expires_at: expiresAt,
            message_count: Number(data.message_count || 0),
            status: 'active'
        });
    }

    async getRecentAIChats(userId, limitCount = 5) {
        const q = query(
            collection(this.db, `users/${userId}/ai_chats`),
            orderBy('updated_at', 'desc'),
            limit(Math.max(limitCount * 4, 20))
        );
        const snapshot = await getDocs(q);
        const now = Date.now();
        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(chat => chat.status === 'active' && !this._isExpired(chat.expires_at, now))
            .slice(0, limitCount);
    }

    async getAIChat(userId, chatId) {
        const snap = await getDoc(doc(this.db, `users/${userId}/ai_chats/${chatId}`));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    }

    async getAIChatMessages(userId, chatId) {
        const q = query(
            collection(this.db, `users/${userId}/ai_chats/${chatId}/messages`),
            orderBy('created_at', 'asc'),
            limit(200)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async addAIChatMessage(userId, chatId, data) {
        const expiresAt = data.expires_at || this.getAIChatExpiryDate();
        return await addDoc(collection(this.db, `users/${userId}/ai_chats/${chatId}/messages`), {
            role: data.role,
            content: data.content || '',
            structured_answer: data.structured_answer || null,
            attachments: Array.isArray(data.attachments) ? data.attachments : [],
            created_at: serverTimestamp(),
            expires_at: expiresAt
        });
    }

    async updateAIChatMeta(userId, chatId, data = {}) {
        const payload = {
            ...data,
            updated_at: serverTimestamp(),
            last_activity_at: serverTimestamp(),
            expires_at: data.expires_at || this.getAIChatExpiryDate()
        };
        delete payload.id;
        await updateDoc(doc(this.db, `users/${userId}/ai_chats/${chatId}`), payload);
    }

    async softDeleteAIChat(userId, chatId) {
        await updateDoc(doc(this.db, `users/${userId}/ai_chats/${chatId}`), {
            status: 'deleted',
            deleted_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
    }

    // --- SUMMARY STATS ---
    async getDashboardOverview(userId, options = {}) {
        let period = this._normalizeOverviewPeriod(options);
        let previousPeriod = this._getPreviousOverviewPeriod(period);
        const sourceStatus = {
            transactions: 'loaded',
            bills: 'loaded',
            subscriptions: 'loaded'
        };
        const limitations = [];

        const [txResult, billsResult, subsResult] = await Promise.allSettled([
            this.getTransactionsForDashboardOverview(userId, period.mode === 'all_time'),
            this.getBills(userId),
            this.getSubscriptions(userId)
        ]);

        const transactions = txResult.status === 'fulfilled' ? txResult.value : [];
        const bills = billsResult.status === 'fulfilled' ? billsResult.value : [];
        const subscriptions = subsResult.status === 'fulfilled' ? subsResult.value : [];

        if (txResult.status !== 'fulfilled') {
            sourceStatus.transactions = 'error';
            limitations.push('Transactions data could not be loaded, so performance and ledger preview may be incomplete.');
        }
        if (billsResult.status !== 'fulfilled') {
            sourceStatus.bills = 'error';
            limitations.push('Bills data could not be loaded, so cash pressure may be incomplete.');
        }
        if (subsResult.status !== 'fulfilled') {
            sourceStatus.subscriptions = 'error';
            limitations.push('Subscriptions data could not be loaded, so upcoming renewals may be incomplete.');
        }

        if (period.mode === 'all_time') {
            period = this._resolveAllTimeOverviewPeriod(period, transactions, bills, subscriptions);
            previousPeriod = this._getPreviousOverviewPeriod(period);
        }

        const periodTransactions = transactions.filter(tx => this._isTransactionInPeriod(tx, period.startDate, period.endDate));
        const previousTransactions = transactions.filter(tx => this._isTransactionInPeriod(tx, previousPeriod.startDate, previousPeriod.endDate));
        const performance = this._calculateOverviewPerformance(periodTransactions);
        const previousPerformance = this._calculateOverviewPerformance(previousTransactions);
        const hasPreviousPeriodData = period.mode !== 'all_time' && previousTransactions.length > 0;
        performance.revenueChangePct = hasPreviousPeriodData ? this._safePercentChange(performance.revenue, previousPerformance.revenue) : null;
        performance.opexChangePct = hasPreviousPeriodData ? this._safePercentChange(performance.opex, previousPerformance.opex) : null;
        performance.marginChangePct = hasPreviousPeriodData && previousPerformance.revenue > 0
            ? performance.grossMargin - previousPerformance.grossMargin
            : null;

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const attentionEnd = this._addDays(now, 30);
        // Only bills that still need paying count as upcoming/overdue. A bill
        // marked paid (or voided) must drop out of the Upcoming rail, the action
        // items, and the payables/cash-pressure totals below.
        const isOpenBill = (bill) => String(bill?.payment_status || '').toLowerCase() !== 'paid' && !bill?.is_voided;
        const openBills = bills.filter(isOpenBill);
        const overdueBills = openBills.filter(bill => this._isBeforeToday(this._getRecordDate(bill, 'due_date'), now));
        const billsDueSoon = openBills.filter(bill => this._isInUpcomingWindow(this._getRecordDate(bill, 'due_date'), now, attentionEnd, period.startDate, period.endDate));
        const renewalsSoon = subscriptions.filter(sub => this._isInUpcomingWindow(this._getRecordDate(sub, 'renewal_date'), now, attentionEnd, period.startDate, period.endDate));
        const missingReceipts = periodTransactions.filter(tx => tx.status === 'Missing Receipt');
        const pendingReceivables = periodTransactions.filter(tx => String(tx.type || '').toLowerCase() === 'pending_receivable');
        const pendingPayables = periodTransactions.filter(tx => String(tx.type || '').toLowerCase() === 'pending_payable');

        const upcomingBills = [...overdueBills, ...billsDueSoon]
            .filter((bill, index, arr) => arr.findIndex(item => item.id === bill.id) === index)
            .sort((a, b) => this._sortByDate(a, b, 'due_date'))
            .slice(0, 5);
        const upcomingSubscriptions = renewalsSoon
            .sort((a, b) => this._sortByDate(a, b, 'renewal_date'))
            .slice(0, 5);

        const upcomingObligations = this._sumAmounts(upcomingBills)
            + this._sumAmounts(upcomingSubscriptions)
            + this._sumAmounts(pendingPayables);
        const expectedIncoming = this._sumAmounts(pendingReceivables);
        const netPressure = expectedIncoming - upcomingObligations;
        const receivablesTotal = this._sumAmounts(pendingReceivables);
        const payablesTotal = this._sumAmounts(billsDueSoon) + this._sumAmounts(overdueBills) + this._sumAmounts(renewalsSoon) + this._sumAmounts(pendingPayables);
        const receivablesDueSoon = expectedIncoming;
        const payablesDueSoon = this._sumAmounts(billsDueSoon) + this._sumAmounts(pendingPayables);

        const actionItems = {
            total: missingReceipts.length + overdueBills.length + billsDueSoon.length + renewalsSoon.length,
            missingReceipts: missingReceipts.length,
            overdueBills: overdueBills.length,
            billsDueSoon: billsDueSoon.length,
            renewalsSoon: renewalsSoon.length,
            highOpexIncrease: performance.opexChangePct !== null && performance.opexChangePct >= 25
        };
        if (actionItems.highOpexIncrease) actionItems.total += 1;

        const overview = {
            period: {
                label: period.label,
                mode: period.mode,
                startDate: period.startDate,
                endDate: period.endDate,
                previousStartDate: previousPeriod.startDate,
                previousEndDate: previousPeriod.endDate
            },
            performance,
            actionItems,
            cashPressure: {
                upcomingObligations,
                expectedIncoming,
                netPressure,
                limitation: 'Cash pressure is estimated from FluxyOS records only. Connect bank balance later for real liquidity analysis.'
            },
            receivablesPayables: {
                receivablesTotal,
                payablesTotal,
                netExpected: receivablesTotal - payablesTotal,
                receivableCount: pendingReceivables.length,
                payableCount: overdueBills.length + billsDueSoon.length + renewalsSoon.length + pendingPayables.length
            },
            upcoming: {
                bills: upcomingBills,
                subscriptions: upcomingSubscriptions
            },
            chartTransactions: periodTransactions,
            ledgerPreview: periodTransactions
                .sort((a, b) => this._sortByDate(b, a, 'timestamp'))
                .slice(0, 5),
            limitations,
            sourceStatus
        };

        const billsInPeriod = bills.filter(bill => {
            const date = this._getRecordDate(bill, 'due_date');
            if (!date) return false;
            const key = this._getDayKey(date);
            return key >= period.startDate && key <= period.endDate;
        });
        const subsInPeriod = subscriptions.filter(sub => {
            const date = this._getRecordDate(sub, 'renewal_date');
            if (!date) return false;
            const key = this._getDayKey(date);
            return key >= period.startDate && key <= period.endDate;
        });
        const aiSnapshotBills = [...billsInPeriod, ...upcomingBills]
            .filter((bill, index, arr) => arr.findIndex(item => item.id === bill.id) === index);
        const aiSnapshotSubscriptions = [...subsInPeriod, ...upcomingSubscriptions]
            .filter((sub, index, arr) => arr.findIndex(item => item.id === sub.id) === index);

        overview.aiSnapshot = {
            transactions: periodTransactions,
            bills: aiSnapshotBills,
            subscriptions: aiSnapshotSubscriptions
        };

        overview.cashFlow = this._buildCashFlowBuckets(
            periodTransactions, billsInPeriod, subsInPeriod,
            period.startDate, period.endDate
        );
        overview.payablesByCategory = this._buildPayablesByCategory(
            pendingPayables, overdueBills, billsDueSoon, renewalsSoon
        );
        overview.reportReadiness = this._buildReportReadiness(
            missingReceipts, overdueBills
        );

        const [bankCashRaw, monthlyBudget] = await Promise.all([
            this._getBankCashSnapshot(userId),
            this._getMonthlyOpexBudget(userId)
        ]);
        overview.bankCash = {
            ...bankCashRaw,
            thirtyDayOutlook: bankCashRaw.balance + receivablesDueSoon - payablesDueSoon
        };
        overview.budget = {
            monthly: monthlyBudget,
            used: performance.opex,
            usedPct: monthlyBudget > 0 ? (performance.opex / monthlyBudget) * 100 : 0,
            remaining: monthlyBudget > 0 ? Math.max(monthlyBudget - performance.opex, 0) : 0
        };
        overview.cashPressure = {
            ...overview.cashPressure,
            ...this._buildCashPressure({
                bankBalance: bankCashRaw.balance,
                receivablesDueSoon,
                payablesDueSoon,
                overdueCount: overdueBills.length
            }),
            overdueCount: overdueBills.length
        };

        overview.insights = this._buildOverviewInsights(overview, periodTransactions.length);
        return overview;
    }

    async _getBankCashSnapshot(userId) {
        if (!userId) return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null, balanceHistory: [] };
        try {
            const accounts = await this.getBankAccounts(userId);
            if (!accounts.length) {
                return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null, balanceHistory: [] };
            }
            const snapshots = await this.getBankBalanceSnapshots(userId, { limit: 200 }).catch(() => []);
            let balance = 0;
            let syncedAt = null;
            let sourceType = null;
            accounts.forEach(account => {
                const raw = Number(account.latest_balance);
                if (Number.isFinite(raw) && raw > 0) balance += raw;
                const stamp = this._getRecordDate(account, 'latest_balance_at');
                if (stamp && (!syncedAt || stamp > syncedAt)) syncedAt = stamp;
                if (!sourceType) sourceType = account.source_type || null;
            });
            return {
                balance: Math.round(balance),
                accountsSynced: accounts.length,
                syncedAt: syncedAt ? syncedAt.toISOString() : null,
                sourceType,
                balanceHistory: this._buildBankCashHistory(accounts, snapshots)
            };
        } catch (_) {
            return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null, balanceHistory: [] };
        }
    }

    _buildBankCashHistory(accounts = [], snapshots = []) {
        const activeAccountIds = new Set(accounts.map(account => account.id));
        const balances = new Map();
        const history = [];

        snapshots
            .filter(snapshot => activeAccountIds.has(snapshot.bank_account_id))
            .map(snapshot => {
                const rawBalance = Number(snapshot.balance);
                return {
                    accountId: snapshot.bank_account_id,
                    balance: Number.isFinite(rawBalance) ? Math.max(0, rawBalance) : 0,
                    date: this._getRecordDate(snapshot, 'snapshot_at')
                };
            })
            .filter(snapshot => snapshot.date)
            .sort((a, b) => a.date - b.date)
            .forEach(snapshot => {
                balances.set(snapshot.accountId, snapshot.balance);
                history.push({
                    at: snapshot.date.toISOString(),
                    balance: Array.from(balances.values()).reduce((total, value) => total + value, 0)
                });
            });

        return history;
    }

    async _getMonthlyOpexBudget(userId) {
        if (!userId) return 0;
        try {
            const budget = await this.getActiveBudget(userId);
            if (!budget) return 0;
            const total = Number(budget.total_budget);
            if (!Number.isFinite(total) || total <= 0) return 0;
            const periodType = String(budget.period_type || 'monthly');
            if (periodType === 'monthly') return Math.round(total);
            if (periodType === 'quarterly') return Math.round(total / 3);
            if (periodType === 'yearly') return Math.round(total / 12);
            return Math.round(total);
        } catch (_) {
            return 0;
        }
    }

    // --- BANK ACCOUNTS (Phase 1: manual only) ---
    async getBankAccounts(userId) {
        const q = query(
            collection(this.db, `${this._scope(userId)}/bank_accounts`),
            orderBy('created_at', 'desc'),
            limit(50)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(account => account.status !== 'archived');
    }

    async addManualBankAccount(userId, data) {
        const balance = Math.round(Math.max(0, Number(data.current_balance) || 0));
        const balanceDate = this._coerceTimestampOrNow(data.balance_date);
        const payload = {
            account_name: this._stringOrDefault(data.account_name, 'Bank account', 120),
            bank_name: this._stringOrDefault(data.bank_name, 'Bank', 80),
            bank_code: this._nullableString(data.bank_code, 16),
            currency: 'IDR',
            last_four: this._nullableString(data.last_four, 4),
            source_type: 'manual',
            provider: null,
            provider_account_id: null,
            status: 'active',
            latest_balance: balance,
            latest_balance_at: balanceDate,
            sync_status: 'manual',
            last_sync_at: null,
            confidence: 'user_entered',
            notes: this._nullableString(data.notes, 500),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        };
        const accountRef = await addDoc(collection(this.db, `${this._scope(userId)}/bank_accounts`), payload);

        await addDoc(collection(this.db, `${this._scope(userId)}/bank_balance_snapshots`), {
            bank_account_id: accountRef.id,
            balance,
            currency: 'IDR',
            source_type: 'manual',
            snapshot_at: balanceDate,
            confidence: 'user_entered',
            notes: null,
            created_at: serverTimestamp()
        });

        await this.addAuditLog(userId, {
            action: 'bank_account.created',
            target_collection: 'bank_accounts',
            target_id: accountRef.id,
            after: {
                account_name: payload.account_name,
                bank_name: payload.bank_name,
                source_type: 'manual',
                latest_balance: balance
            },
            source: 'dashboard'
        });

        return { id: accountRef.id, ...payload };
    }

    async updateBankAccountBalance(userId, accountId, data) {
        if (!userId || !accountId) throw new Error('userId and accountId required');
        const balance = Math.round(Math.max(0, Number(data.balance) || 0));
        const snapshotDate = this._coerceTimestampOrNow(data.snapshot_at);

        const accountRef = doc(this.db, `${this._scope(userId)}/bank_accounts/${accountId}`);
        const existing = await getDoc(accountRef);
        if (!existing.exists()) throw new Error('bank account not found');
        const existingData = existing.data() || {};

        const merged = {
            account_name: existingData.account_name,
            bank_name: existingData.bank_name,
            bank_code: existingData.bank_code ?? null,
            currency: 'IDR',
            last_four: existingData.last_four ?? null,
            source_type: existingData.source_type || 'manual',
            provider: existingData.provider ?? null,
            provider_account_id: existingData.provider_account_id ?? null,
            status: existingData.status || 'active',
            latest_balance: balance,
            latest_balance_at: snapshotDate,
            sync_status: existingData.sync_status || 'manual',
            last_sync_at: existingData.last_sync_at ?? null,
            confidence: 'user_entered',
            notes: this._nullableString(data.notes ?? existingData.notes ?? '', 500),
            created_at: existingData.created_at,
            updated_at: serverTimestamp()
        };
        await updateDoc(accountRef, merged);

        await addDoc(collection(this.db, `${this._scope(userId)}/bank_balance_snapshots`), {
            bank_account_id: accountId,
            balance,
            currency: 'IDR',
            source_type: existingData.source_type || 'manual',
            snapshot_at: snapshotDate,
            confidence: 'user_entered',
            notes: this._nullableString(data.notes, 500),
            created_at: serverTimestamp()
        });

        await this.addAuditLog(userId, {
            action: 'bank_account.balance_updated',
            target_collection: 'bank_accounts',
            target_id: accountId,
            before: { latest_balance: Number(existingData.latest_balance) || 0 },
            after: { latest_balance: balance },
            source: 'dashboard'
        });

        return { id: accountId, ...merged };
    }

    async archiveBankAccount(userId, accountId, reason = null) {
        if (!userId || !accountId) throw new Error('userId and accountId required');
        const accountRef = doc(this.db, `${this._scope(userId)}/bank_accounts/${accountId}`);
        const existing = await getDoc(accountRef);
        if (!existing.exists()) throw new Error('bank account not found');
        const existingData = existing.data() || {};

        const merged = {
            account_name: existingData.account_name,
            bank_name: existingData.bank_name,
            bank_code: existingData.bank_code ?? null,
            currency: 'IDR',
            last_four: existingData.last_four ?? null,
            source_type: existingData.source_type || 'manual',
            provider: existingData.provider ?? null,
            provider_account_id: existingData.provider_account_id ?? null,
            status: 'archived',
            latest_balance: Number(existingData.latest_balance) || 0,
            latest_balance_at: existingData.latest_balance_at,
            sync_status: existingData.sync_status || 'manual',
            last_sync_at: existingData.last_sync_at ?? null,
            confidence: existingData.confidence ?? 'user_entered',
            notes: existingData.notes ?? null,
            created_at: existingData.created_at,
            updated_at: serverTimestamp()
        };
        await updateDoc(accountRef, merged);

        await this.addAuditLog(userId, {
            action: 'bank_account.archived',
            target_collection: 'bank_accounts',
            target_id: accountId,
            before: { status: existingData.status || 'active' },
            after: { status: 'archived' },
            reason: this._nullableString(reason, 200),
            source: 'dashboard'
        });
    }

    async getBankBalanceSnapshots(userId, options = {}) {
        if (!userId) return [];
        const limitCount = Math.max(1, Math.min(200, Number(options.limit) || 50));
        try {
            const constraints = [
                orderBy('snapshot_at', 'desc'),
                limit(limitCount)
            ];
            if (options.accountId) constraints.unshift(where('bank_account_id', '==', options.accountId));
            const q = query(collection(this.db, `${this._scope(userId)}/bank_balance_snapshots`), ...constraints);
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            const q = query(
                collection(this.db, `${this._scope(userId)}/bank_balance_snapshots`),
                orderBy('snapshot_at', 'desc'),
                limit(limitCount)
            );
            const snapshot = await getDocs(q);
            const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            return options.accountId ? rows.filter(r => r.bank_account_id === options.accountId) : rows;
        }
    }

    // --- BANK STATEMENT IMPORTS (Phase 1: draft + review only) ---
    // Creates a review draft for an uploaded bank statement. Phase 1 never
    // creates ledger transactions and never updates a bank account balance.
    // Confirm/reject is implemented later; the draft sits in `review_status:
    // "draft"` (or "needs_review" / "rejected") until then.
    async createBankStatementImport(userId, data = {}) {
        if (!userId) throw new Error('userId required');
        await this.assertCanUseStorage(userId, data.file_size || 0, { source: 'bank_statement_import' });
        const payload = this._cleanDefined({
            bank_account_id: this._nullableString(data.bank_account_id, 120),
            file_name: this._stringOrDefault(data.file_name, 'bank_statement', 240),
            file_mime_type: this._stringOrDefault(data.file_mime_type, 'application/octet-stream', 120),
            file_size: Math.max(0, Math.floor(Number(data.file_size) || 0)),
            storage_path: this._nullableString(data.storage_path, 400),

            document_type: 'bank_statement',
            extraction_status: this._allowedValue(data.extraction_status,
                ['pending', 'processing', 'completed', 'failed'], 'pending'),
            review_status: this._allowedValue(data.review_status,
                ['draft', 'needs_review', 'ready_to_import', 'imported', 'rejected'], 'draft'),

            bank_name: this._nullableString(data.bank_name, 80),
            account_holder: this._nullableString(data.account_holder, 160),
            account_number_masked: this._nullableString(data.account_number_masked, 32),
            currency: 'IDR',

            statement_start_date: data.statement_start_date ? this._coerceTimestampOrNow(data.statement_start_date) : null,
            statement_end_date: data.statement_end_date ? this._coerceTimestampOrNow(data.statement_end_date) : null,
            opening_balance: data.opening_balance == null ? null : Math.round(Number(data.opening_balance) || 0),
            closing_balance: data.closing_balance == null ? null : Math.round(Number(data.closing_balance) || 0),
            total_debit: data.total_debit == null ? null : Math.round(Number(data.total_debit) || 0),
            total_credit: data.total_credit == null ? null : Math.round(Number(data.total_credit) || 0),
            row_count: data.row_count == null ? 0 : Math.max(0, Math.floor(Number(data.row_count) || 0)),

            balance_check_status: this._allowedValue(data.balance_check_status,
                ['passed', 'failed', 'unavailable'], 'unavailable'),
            running_balance_check_status: this._allowedValue(data.running_balance_check_status,
                ['passed', 'failed', 'unavailable'], 'unavailable'),
            duplicate_count: Math.max(0, Math.floor(Number(data.duplicate_count) || 0)),
            needs_review_count: Math.max(0, Math.floor(Number(data.needs_review_count) || 0)),

            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            confirmed_at: null,
            imported_at: null
        });
        const ref = await addDoc(collection(this.db, `${this._scope(userId)}/bank_statement_imports`), payload);

        await this.addAuditLog(userId, {
            action: 'bank_statement.import_created',
            target_collection: 'bank_statement_imports',
            target_id: ref.id,
            after: {
                file_name: payload.file_name,
                file_mime_type: payload.file_mime_type,
                file_size: payload.file_size,
                review_status: payload.review_status,
                extraction_status: payload.extraction_status
            },
            source: 'dashboard'
        });

        return { id: ref.id, ...payload };
    }

    async getBankStatementImport(userId, importId) {
        if (!userId || !importId) return null;
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async listBankStatementImports(userId, limitCount = 25) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/bank_statement_imports`),
                orderBy('created_at', 'desc'),
                limit(Math.max(1, Math.min(100, Number(limitCount) || 25)))
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            return [];
        }
    }

    async updateBankStatementImport(userId, importId, data = {}) {
        if (!userId || !importId) throw new Error('userId and importId required');
        const ref = doc(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}`);
        const existing = await getDoc(ref);
        if (!existing.exists()) throw new Error('bank statement import not found');
        const allowed = {};
        const stringFields = ['bank_name', 'account_holder', 'account_number_masked'];
        stringFields.forEach(k => {
            if (k in data) allowed[k] = this._nullableString(data[k], 200);
        });
        if ('storage_path' in data) {
            allowed.storage_path = this._nullableString(data.storage_path, 400);
        }
        if ('review_status' in data) {
            allowed.review_status = this._allowedValue(data.review_status,
                ['draft', 'needs_review', 'ready_to_import', 'imported', 'rejected'], 'draft');
        }
        if ('extraction_status' in data) {
            allowed.extraction_status = this._allowedValue(data.extraction_status,
                ['pending', 'processing', 'completed', 'failed'], 'pending');
        }
        if ('balance_check_status' in data) {
            allowed.balance_check_status = this._allowedValue(data.balance_check_status,
                ['passed', 'failed', 'unavailable'], 'unavailable');
        }
        if ('running_balance_check_status' in data) {
            allowed.running_balance_check_status = this._allowedValue(data.running_balance_check_status,
                ['passed', 'failed', 'unavailable'], 'unavailable');
        }
        const intFields = ['row_count', 'duplicate_count', 'needs_review_count'];
        intFields.forEach(k => {
            if (k in data) allowed[k] = Math.max(0, Math.floor(Number(data[k]) || 0));
        });
        const numberFields = ['opening_balance', 'closing_balance', 'total_debit', 'total_credit'];
        numberFields.forEach(k => {
            if (k in data) allowed[k] = data[k] == null ? null : Math.round(Number(data[k]) || 0);
        });
        if ('statement_start_date' in data) {
            allowed.statement_start_date = data.statement_start_date
                ? this._coerceTimestampOrNow(data.statement_start_date) : null;
        }
        if ('statement_end_date' in data) {
            allowed.statement_end_date = data.statement_end_date
                ? this._coerceTimestampOrNow(data.statement_end_date) : null;
        }
        allowed.updated_at = serverTimestamp();
        await updateDoc(ref, allowed);
        return { id: importId, ...allowed };
    }

    async addBankStatementRows(userId, importId, rows = []) {
        if (!userId || !importId) throw new Error('userId and importId required');
        if (!Array.isArray(rows) || rows.length === 0) return [];
        const safeRows = rows.slice(0, 1000);
        const rowsCol = collection(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}/rows`);
        const batch = writeBatch(this.db);
        const created = [];
        safeRows.forEach((row, idx) => {
            const rowRef = doc(rowsCol);
            const payload = this._cleanDefined({
                row_index: Number.isFinite(Number(row.row_index)) ? Number(row.row_index) : idx,
                transaction_date: row.transaction_date ? this._coerceTimestampOrNow(row.transaction_date) : null,
                posting_date: row.posting_date ? this._coerceTimestampOrNow(row.posting_date) : null,
                description_raw: this._nullableString(row.description_raw, 500),
                debit: row.debit == null ? null : Math.round(Number(row.debit) || 0),
                credit: row.credit == null ? null : Math.round(Number(row.credit) || 0),
                running_balance: row.running_balance == null ? null : Math.round(Number(row.running_balance) || 0),

                suggested_vendor_name: this._nullableString(row.suggested_vendor_name, 160),
                suggested_category: this._nullableString(row.suggested_category, 80),
                suggested_type: this._nullableString(row.suggested_type, 40),

                match_status: this._allowedValue(row.match_status,
                    ['new', 'possible_duplicate', 'matched_existing', 'ignored', 'needs_review'], 'new'),
                matched_transaction_id: this._nullableString(row.matched_transaction_id, 120),
                confidence: row.confidence == null ? null : Math.max(0, Math.min(1, Number(row.confidence) || 0)),

                selected_for_import: row.selected_for_import !== false,
                review_status: this._allowedValue(row.review_status,
                    ['pending', 'confirmed', 'ignored'], 'pending'),
                created_transaction_id: null,
                created_at: serverTimestamp()
            });
            batch.set(rowRef, payload);
            created.push({ id: rowRef.id });
        });
        await batch.commit();
        return created;
    }

    async getBankStatementRows(userId, importId, limitCount = 1000) {
        if (!userId || !importId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}/rows`),
                orderBy('row_index', 'asc'),
                limit(Math.max(1, Math.min(1000, Number(limitCount) || 1000)))
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            return [];
        }
    }

    async uploadBankStatementFile(userId, importId, file) {
        if (!userId || !importId) throw new Error('userId and importId required');
        if (!file) throw new Error('file required');
        await this.assertCanUseStorage(userId, file.size || 0, { source: 'bank_statement_import' });
        const { getStorage, ref, uploadBytes } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);

        const safeName = String(file.name || 'bank_statement')
            .replace(/[^\w.\-]+/g, '_')
            .slice(0, 200) || 'bank_statement';
        const storagePath = `${this._scope(userId)}/bank_statement_imports/${importId}/${safeName}`;
        await uploadBytes(
            ref(this._storage, storagePath),
            file,
            { contentType: file.type || 'application/octet-stream' }
        );
        return {
            storagePath,
            fileName: safeName,
            fileMimeType: file.type || 'application/octet-stream',
            fileSize: file.size || 0
        };
    }

    // Kick off backend extraction for an uploaded draft. The background function
    // returns 202 and writes the parsed rows + metadata straight to Firestore, so
    // the caller watches the draft doc (watchBankStatementImport) for the result.
    async requestBankStatementExtraction(importId, idToken) {
        if (!importId) throw new Error('importId required');
        if (!idToken) throw new Error('idToken required');
        const res = await fetch('/api/v1/bank-statements/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ importId })
        });
        // Background functions reply 202 with no body; treat any 2xx as accepted.
        if (!res.ok && res.status !== 202) throw new Error(`extraction_request_failed_${res.status}`);
        return true;
    }

    // Live-subscribe to a draft so the panel can react to extraction_status flips.
    // Returns the unsubscribe function.
    watchBankStatementImport(userId, importId, callback) {
        if (!userId || !importId || typeof callback !== 'function') return () => {};
        const ref = doc(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}`);
        return onSnapshot(ref, (snap) => {
            callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        }, () => callback(null));
    }

    // Single-row review edit (select/ignore, edited suggestions). created_at is
    // never sent, so the rules' immutability check on it holds.
    async updateBankStatementRow(userId, importId, rowId, data = {}) {
        if (!userId || !importId || !rowId) throw new Error('userId, importId and rowId required');
        const ref = doc(this.db, `${this._scope(userId)}/bank_statement_imports/${importId}/rows/${rowId}`);
        const allowed = {};
        if ('selected_for_import' in data) allowed.selected_for_import = data.selected_for_import !== false;
        if ('suggested_vendor_name' in data) allowed.suggested_vendor_name = this._nullableString(data.suggested_vendor_name, 160);
        if ('suggested_category' in data) allowed.suggested_category = this._nullableString(data.suggested_category, 80);
        if ('suggested_type' in data) allowed.suggested_type = this._nullableString(data.suggested_type, 40);
        if ('match_status' in data) {
            allowed.match_status = this._allowedValue(data.match_status,
                ['new', 'possible_duplicate', 'matched_existing', 'ignored', 'needs_review'], 'new');
        }
        if ('review_status' in data) {
            allowed.review_status = this._allowedValue(data.review_status,
                ['pending', 'confirmed', 'ignored'], 'pending');
        }
        if (Object.keys(allowed).length === 0) return { id: rowId };
        await updateDoc(ref, allowed);
        return { id: rowId, ...allowed };
    }

    // Confirm-to-ledger: create a transaction for each selected, not-yet-imported
    // row and link them back. Mirrors addTransactions' batched-write pattern;
    // chunked under the 500-op batch limit. Idempotent — rows already carrying a
    // created_transaction_id are skipped. Cash-balance update is Phase 3.
    async confirmBankStatementImport(userId, importId, rows = []) {
        if (!userId || !importId) throw new Error('userId and importId required');
        const importable = (Array.isArray(rows) ? rows : []).filter(r =>
            r && r.selected_for_import !== false && r.review_status !== 'ignored'
            && !r.created_transaction_id && ((Number(r.credit) || 0) > 0 || (Number(r.debit) || 0) > 0));

        const txCol = collection(this.db, `${this._scope(userId)}/transactions`);
        const importPath = `${this._scope(userId)}/bank_statement_imports/${importId}`;
        let created = 0;

        // ~200 rows/batch keeps ops (tx create + row update = 2 each) under 500.
        for (let i = 0; i < importable.length; i += 200) {
            const batch = writeBatch(this.db);
            importable.slice(i, i + 200).forEach((row) => {
                const credit = Math.round(Math.abs(Number(row.credit) || 0));
                const debit = Math.round(Math.abs(Number(row.debit) || 0));
                const isIncome = credit > 0 && !(debit > 0);
                const amount = credit > 0 ? credit : debit;
                const type = ['income', 'expense', 'transfer', 'refund', 'fee', 'tax'].includes(row.suggested_type)
                    ? row.suggested_type : (isIncome ? 'income' : 'expense');
                const vendor = (row.suggested_vendor_name || row.description_raw || 'Bank statement').toString().trim().slice(0, 160);
                const category = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS', 'Others'].includes(row.suggested_category)
                    ? row.suggested_category : (type === 'income' || type === 'refund' ? 'Revenue' : 'Operations');

                const txRef = doc(txCol);
                batch.set(txRef, {
                    amount,
                    vendor_name: vendor,
                    category,
                    type,
                    status: 'Completed',
                    icon: (type === 'income' || type === 'refund') ? '💰' : '💸',
                    timestamp: row.transaction_date ? this._coerceTimestampOrNow(row.transaction_date) : serverTimestamp(),
                    created_at: serverTimestamp(),
                    source: 'bank_statement_import',
                    bank_statement_import_id: importId,
                    bank_statement_row_id: row.id,
                    imported_at: serverTimestamp(),
                    // Posted later by the Accounting Center sweep (postPendingJournals).
                    accounting_status: 'pending'
                });
                batch.update(doc(this.db, `${importPath}/rows/${row.id}`), {
                    created_transaction_id: txRef.id,
                    review_status: 'confirmed'
                });
                created += 1;
            });
            await batch.commit();
        }

        // Mark the draft imported and log the action (best-effort).
        await updateDoc(doc(this.db, importPath), {
            review_status: 'imported',
            confirmed_at: serverTimestamp(),
            imported_at: serverTimestamp(),
            updated_at: serverTimestamp()
        });
        try {
            await this.addAuditLog(userId, {
                action: 'bank_statement.import_confirmed',
                target_collection: 'bank_statement_imports',
                target_id: importId,
                after: { imported_transactions: created },
                source: 'dashboard'
            });
        } catch (_) { /* non-fatal */ }

        return { created };
    }

    async archiveBudget(userId, budgetId, reason = null) {
        if (!userId || !budgetId) throw new Error('userId and budgetId required');
        const ref = doc(this.db, `${this._scope(userId)}/budgets/${budgetId}`);
        const existing = await getDoc(ref);
        if (!existing.exists()) throw new Error('budget not found');
        const data = existing.data() || {};
        const payload = {
            name: data.name,
            period_type: data.period_type,
            period_start: data.period_start,
            period_end: data.period_end,
            currency: 'IDR',
            total_budget: Number(data.total_budget) || 0,
            status: 'archived',
            created_at: data.created_at,
            updated_at: serverTimestamp()
        };
        if (data.category_budgets) payload.category_budgets = data.category_budgets;
        await updateDoc(ref, payload);

        await this.addAuditLog(userId, {
            action: 'budget.archived',
            target_collection: 'budgets',
            target_id: budgetId,
            before: { status: data.status || 'active' },
            after: { status: 'archived' },
            reason: this._nullableString(reason, 200),
            source: 'dashboard'
        });
    }

    async getBudgetHistory(userId, limitCount = 20) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/budgets`),
                orderBy('created_at', 'desc'),
                limit(limitCount)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            return [];
        }
    }

    _coerceTimestampOrNow(value) {
        if (!value) return Timestamp.fromDate(new Date());
        if (value instanceof Date) return Timestamp.fromDate(value);
        if (typeof value.toDate === 'function') {
            try { return Timestamp.fromDate(value.toDate()); } catch { return Timestamp.fromDate(new Date()); }
        }
        if (typeof value === 'string' || typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? Timestamp.fromDate(new Date()) : Timestamp.fromDate(parsed);
        }
        return Timestamp.fromDate(new Date());
    }

    // --- BUDGETS ---
    _budgetDate(value) {
        if (!value) return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
        if (typeof value.toDate === 'function') {
            try {
                const date = value.toDate();
                return Number.isNaN(date.getTime()) ? null : date;
            } catch {
                return null;
            }
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    _budgetDayKey(value) {
        const date = this._budgetDate(value);
        return date ? this._getDayKey(date) : null;
    }

    _normalizeBudgetType(value, periodType) {
        if (value === 'annual') return 'annual';
        if (value === 'period') return 'period';
        return 'period';
    }

    _normalizePeriodType(value, budgetType = 'period') {
        const allowed = budgetType === 'annual'
            ? ['yearly']
            : ['monthly', 'quarterly', 'custom', 'yearly'];
        return allowed.includes(value) ? value : (budgetType === 'annual' ? 'yearly' : 'monthly');
    }

    _periodLabelFromDates(periodType, startValue, endValue) {
        const start = this._budgetDate(startValue);
        const end = this._budgetDate(endValue);
        if (!start || !end) return 'Operating period';
        if (periodType === 'monthly') {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
        if (periodType === 'quarterly') {
            const quarter = Math.floor(start.getMonth() / 3) + 1;
            return `Q${quarter} ${start.getFullYear()}`;
        }
        if (periodType === 'yearly') {
            return `FY${start.getFullYear()}`;
        }
        const fmt = { day: 'numeric', month: 'short', year: 'numeric' };
        return `${start.toLocaleDateString('en-US', fmt)} - ${end.toLocaleDateString('en-US', fmt)}`;
    }

    _normalizeBudgetRecord(raw = {}) {
        if (!raw) return null;
        const periodType = this._normalizePeriodType(raw.period_type || raw.periodType, raw.budget_type || raw.budgetType);
        const budgetType = this._normalizeBudgetType(raw.budget_type || raw.budgetType, periodType);
        const label = this._stringOrDefault(
            raw.period_label || raw.periodLabel || '',
            '',
            120
        ) || this._periodLabelFromDates(periodType, raw.period_start, raw.period_end);
        return {
            ...raw,
            budget_type: budgetType,
            period_type: this._normalizePeriodType(periodType, budgetType),
            period_label: label
        };
    }

    async getBudget(userId, budgetId) {
        if (!userId || !budgetId) return null;
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/budgets/${budgetId}`));
        if (!snap.exists()) return null;
        return this._normalizeBudgetRecord({ id: snap.id, ...snap.data() });
    }

    async getBudgets(userId, limitCount = 200) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/budgets`),
                orderBy('updated_at', 'desc'),
                limit(limitCount)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(d => this._normalizeBudgetRecord({ id: d.id, ...d.data() }))
                .filter(Boolean)
                .filter(b => b.status !== 'archived');
        } catch (_) {
            try {
                const q = query(
                    collection(this.db, `${this._scope(userId)}/budgets`),
                    orderBy('created_at', 'desc'),
                    limit(limitCount)
                );
                const snapshot = await getDocs(q);
                return snapshot.docs
                    .map(d => this._normalizeBudgetRecord({ id: d.id, ...d.data() }))
                    .filter(Boolean)
                    .filter(b => b.status !== 'archived');
            } catch {
                return [];
            }
        }
    }

    async getAnnualBudgets(userId) {
        const budgets = await this.getBudgets(userId, 200);
        return budgets.filter(b => b.budget_type === 'annual');
    }

    async getPeriodBudgets(userId, parentBudgetId = null) {
        const budgets = await this.getBudgets(userId, 300);
        return budgets
            .filter(b => (b.budget_type || 'period') !== 'annual')
            .filter(b => !parentBudgetId || b.parent_budget_id === parentBudgetId)
            .sort((a, b) => {
                const aTime = this._budgetDate(a.updated_at)?.getTime()
                    || this._budgetDate(a.created_at)?.getTime()
                    || this._budgetDate(a.period_start)?.getTime()
                    || 0;
                const bTime = this._budgetDate(b.updated_at)?.getTime()
                    || this._budgetDate(b.created_at)?.getTime()
                    || this._budgetDate(b.period_start)?.getTime()
                    || 0;
                return bTime - aTime;
            });
    }

    async getActiveBudget(userId) {
        const periods = await this.getPeriodBudgets(userId, null);
        const activePeriod = periods.find(b => b.status === 'active');
        if (activePeriod) return activePeriod;
        const budgets = await this.getBudgets(userId, 50);
        return budgets.find(b => b.status === 'active') || null;
    }

    async setActiveBudget(userId, data) {
        const total = Math.round(Math.max(0, Number(data.total_budget) || 0));
        const periodType = ['monthly', 'quarterly', 'yearly', 'custom'].includes(data.period_type)
            ? data.period_type
            : 'monthly';
        const startDate = this._coerceTimestampOrNow(data.period_start);
        const endDate = this._coerceTimestampOrNow(data.period_end);

        const existing = await this.getActiveBudget(userId);
        const payload = {
            name: this._stringOrDefault(data.name, 'OpEx budget', 120),
            budget_type: periodType === 'yearly' ? 'annual' : 'period',
            parent_budget_id: this._nullableString(data.parent_budget_id, 120),
            period_type: periodType,
            period_label: this._stringOrDefault(data.period_label, '', 120)
                || this._periodLabelFromDates(periodType, startDate, endDate),
            period_start: startDate,
            period_end: endDate,
            currency: 'IDR',
            total_budget: total,
            status: 'active',
            updated_at: serverTimestamp()
        };
        const categoryBudgets = this._normalizeCategoryBudgets(data.category_budgets);
        if (categoryBudgets) payload.category_budgets = categoryBudgets;
        const notes = this._nullableString(data.notes, 500);
        if (notes) payload.notes = notes;

        let budgetId;
        if (existing) {
            budgetId = existing.id;
            await updateDoc(doc(this.db, `${this._scope(userId)}/budgets/${existing.id}`), payload);
        } else {
            const ref = await addDoc(collection(this.db, `${this._scope(userId)}/budgets`), {
                ...payload,
                created_at: serverTimestamp()
            });
            budgetId = ref.id;
        }

        await this.addAuditLog(userId, {
            action: existing ? 'budget.updated' : 'budget.created',
            target_collection: 'budgets',
            target_id: budgetId,
            after: { total_budget: total, period_type: periodType, name: payload.name },
            source: 'dashboard'
        });

        return { id: budgetId, ...payload };
    }

    async getBudgetByPeriod(userId, { period_type, period_start, period_end, parent_budget_id = null } = {}) {
        const startKey = this._budgetDayKey(period_start);
        const endKey = this._budgetDayKey(period_end);
        if (!startKey || !endKey) return null;
        const budgets = await this.getPeriodBudgets(userId, parent_budget_id);
        return budgets.find(b => {
            if (period_type && b.period_type !== period_type) return false;
            return this._budgetDayKey(b.period_start) === startKey
                && this._budgetDayKey(b.period_end) === endKey;
        }) || null;
    }

    async getBudgetForDate(userId, dateValue) {
        const date = this._budgetDate(dateValue) || new Date();
        const day = this._getDayKey(date);
        const budgets = await this.getPeriodBudgets(userId, null);
        const periodHit = budgets.find(b => {
            const start = this._budgetDayKey(b.period_start);
            const end = this._budgetDayKey(b.period_end);
            return start && end && start <= day && day <= end && b.status === 'active';
        });
        if (periodHit) return periodHit;
        const annuals = await this.getAnnualBudgets(userId);
        return annuals.find(b => {
            const start = this._budgetDayKey(b.period_start);
            const end = this._budgetDayKey(b.period_end);
            return start && end && start <= day && day <= end && b.status === 'active';
        }) || null;
    }

    _normalizeCategoryBudgets(input) {
        if (!input || typeof input !== 'object') return null;
        const allowed = new Set(['Marketing', 'Infrastructure', 'Operations', 'SaaS', 'Others']);
        const cleaned = {};
        Object.entries(input).forEach(([key, value]) => {
            if (!allowed.has(key)) return;
            const num = Math.round(Math.max(0, Number(value) || 0));
            if (num > 0) cleaned[key] = num;
        });
        return Object.keys(cleaned).length ? cleaned : null;
    }

    // --- BUDGET ALLOCATIONS ---
    // NOTE: addBudgetWithAllocations archives prior allocations on every save
    // rather than deleting them. Limits below are deliberately generous to
    // tolerate a long edit history; Phase 2 should hard-delete archived rows
    // once the audit-log retention story covers the lost history.
    async getBudgetAllocations(userId, budgetId) {
        if (!userId || !budgetId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/budget_allocations`),
                where('parent_budget_id', '==', budgetId),
                orderBy('created_at', 'asc'),
                limit(500)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(a => a.status !== 'archived');
        } catch (_) {
            // Fallback when composite index is unavailable.
            try {
                const q = query(
                    collection(this.db, `${this._scope(userId)}/budget_allocations`),
                    limit(1000)
                );
                const snapshot = await getDocs(q);
                return snapshot.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(a => a.parent_budget_id === budgetId && a.status !== 'archived')
                    .sort((a, b) => {
                        const aTs = a.created_at?.toDate?.()?.getTime?.() || 0;
                        const bTs = b.created_at?.toDate?.()?.getTime?.() || 0;
                        return aTs - bTs;
                    });
            } catch {
                return [];
            }
        }
    }

    async getBudgetAllocation(userId, allocationId) {
        if (!userId || !allocationId) return null;
        const snap = await getDoc(doc(this.db, `${this._scope(userId)}/budget_allocations/${allocationId}`));
        if (!snap.exists()) return null;
        const allocation = { id: snap.id, ...snap.data() };
        return allocation.status === 'archived' ? null : allocation;
    }

    _normalizeBudgetMatchValue(value) {
        return String(value || '').trim().toLowerCase();
    }

    _allocationMatchesRecord(record, allocation) {
        if (!record || !allocation?.id) return { matched: false, source: 'none' };
        const explicitAllocationId = String(record.budget_allocation_id || '').trim();
        if (explicitAllocationId) {
            return explicitAllocationId === allocation.id
                ? { matched: true, source: 'explicit' }
                : { matched: false, source: 'explicit_other' };
        }

        const scopeType = this._normalizeBudgetMatchValue(allocation.scope_type);
        if (scopeType !== 'category') return { matched: false, source: 'unsafe_scope' };
        const scopeValues = Array.isArray(allocation.scope_values)
            ? allocation.scope_values.map(v => this._normalizeBudgetMatchValue(v)).filter(Boolean)
            : [];
        const category = this._normalizeBudgetMatchValue(record.category);
        if (!category || scopeValues.length === 0) return { matched: false, source: 'unsafe_scope' };
        return scopeValues.includes(category)
            ? { matched: true, source: 'category' }
            : { matched: false, source: 'category_other' };
    }

    _allocationRecordDate(record, fields) {
        return this._firstRecordDate(record, fields);
    }

    _recordGroupName(record) {
        return String(
            record.vendor_name
            || record.merchant_name
            || record.vendor
            || record.category
            || 'Unspecified'
        ).trim() || 'Unspecified';
    }

    _allocationUsageStatus(allocated, spentReserved) {
        const base = Math.max(0, Number(allocated) || 0);
        if (base <= 0) return 'not_allocated';
        const pct = (Number(spentReserved) || 0) / base * 100;
        if (pct >= 100) return 'exceeded';
        if (pct >= 85) return 'at_risk';
        if (pct >= 70) return 'watch';
        return 'healthy';
    }

    _normalizeAllocationRecord(record, { source, bucket, date, matchSource }) {
        const amount = Math.abs(Number(record?.amount) || 0);
        const type = source === 'bill'
            ? 'bill'
            : String(record?.type || '').toLowerCase().replace(/\s+/g, '_');
        const groupName = this._recordGroupName(record);
        return {
            id: record.id,
            source,
            kind: source === 'bill' ? 'bill' : (type === 'pending_payable' ? 'pending_payable' : 'transaction'),
            bucket,
            amount,
            date,
            day_key: date ? this._getDayKey(date) : '',
            group_name: groupName,
            counterparty: String(record.vendor_name || record.merchant_name || record.vendor || groupName || 'Unspecified'),
            category: String(record.category || 'Unspecified'),
            status: String(record.payment_status || record.status || record.budget_impact_status || (bucket === 'reserved' ? 'Pending' : 'Posted')),
            type,
            memo: String(record.memo || record.description || record.notes || ''),
            match_source: matchSource,
            raw: record
        };
    }

    _buildAllocationGroups(records, allocatedAmount) {
        const groups = new Map();
        records.forEach(record => {
            const key = record.group_name || 'Unspecified';
            if (!groups.has(key)) {
                groups.set(key, {
                    id: key,
                    name: key,
                    record_count: 0,
                    actual_total: 0,
                    reserved_total: 0,
                    spent_reserved_total: 0,
                    latest_record_date: null,
                    status: 'healthy'
                });
            }
            const group = groups.get(key);
            group.record_count += 1;
            if (record.bucket === 'actual') group.actual_total += record.amount;
            else group.reserved_total += record.amount;
            group.spent_reserved_total += record.amount;
            if (!group.latest_record_date || (record.date && record.date > group.latest_record_date)) {
                group.latest_record_date = record.date || group.latest_record_date;
            }
        });
        return Array.from(groups.values())
            .map(group => {
                const usagePercent = allocatedAmount > 0
                    ? (group.spent_reserved_total / allocatedAmount) * 100
                    : 0;
                return {
                    ...group,
                    usage_percent: Number.isFinite(usagePercent) ? usagePercent : 0,
                    status: this._allocationUsageStatus(allocatedAmount, group.spent_reserved_total)
                };
            })
            .sort((a, b) => b.spent_reserved_total - a.spent_reserved_total);
    }

    _buildAllocationTrend(records, startDate, endDate) {
        // Four weekly buckets across the budget period. A budget period is
        // typically a single month, so monthly buckets gave only one data
        // point (a useless line). Splitting the period into 4 equal weeks
        // gives the area chart enough points to read as a trend.
        const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
        const spanMs = Math.max(1, end.getTime() - start.getTime());
        const WEEKS = 4;
        const bucketMs = spanMs / WEEKS;

        const buckets = Array.from({ length: WEEKS }, (_, i) => ({
            key: `w${i + 1}`,
            label: `Week ${i + 1}`,
            actual: 0
        }));

        records
            .filter(record => record.bucket === 'actual' && record.date)
            .forEach(record => {
                const offset = record.date.getTime() - start.getTime();
                if (offset < 0 || offset > spanMs) return;
                const idx = Math.min(WEEKS - 1, Math.max(0, Math.floor(offset / bucketMs)));
                buckets[idx].actual += record.amount;
            });
        return buckets;
    }

    async getMatchedAllocationRecords(userId, budget, allocation) {
        if (!userId || !budget?.id || !allocation?.id) {
            return {
                transactions: [],
                bills: [],
                records: [],
                groups: [],
                trend: [],
                totals: { actual: 0, reserved: 0, spentReserved: 0, recordCount: 0 }
            };
        }

        const startDate = this._budgetDate(budget.period_start);
        const endDate = this._budgetDate(budget.period_end);
        if (!startDate || !endDate) {
            return {
                transactions: [],
                bills: [],
                records: [],
                groups: [],
                trend: [],
                totals: { actual: 0, reserved: 0, spentReserved: 0, recordCount: 0 }
            };
        }

        const startKey = this._getDayKey(startDate);
        const endKey = this._getDayKey(endDate);
        const [transactionsRaw, billsRaw] = await Promise.all([
            this.getTransactions(userId, 1000),
            this.getBills(userId)
        ]);

        const actualTypes = new Set(['expense', 'fee', 'tax']);
        const records = [];
        const transactions = [];
        const bills = [];

        transactionsRaw.forEach(tx => {
            if (tx.budget_match_status === 'excluded') return;
            if (tx.budget_id && tx.budget_id !== budget.id) return;
            const type = String(tx.type || '').toLowerCase().replace(/\s+/g, '_');
            const bucket = actualTypes.has(type) ? 'actual' : (type === 'pending_payable' ? 'reserved' : null);
            if (!bucket) return;
            const date = this._allocationRecordDate(tx, ['timestamp', 'date', 'created_at']);
            if (!date || !this._isRecordInPeriod(tx, startKey, endKey, ['timestamp', 'date', 'created_at'])) return;
            const match = this._allocationMatchesRecord(tx, allocation);
            if (!match.matched) return;
            const normalized = this._normalizeAllocationRecord(tx, {
                source: 'transaction',
                bucket,
                date,
                matchSource: match.source
            });
            transactions.push({ ...tx, _allocationRecord: normalized, _matchSource: match.source });
            records.push(normalized);
        });

        const includeBillStatuses = new Set(['unpaid', 'open', 'pending', 'overdue']);
        billsRaw.forEach(bill => {
            if (bill.budget_match_status === 'excluded') return;
            if (bill.budget_id && bill.budget_id !== budget.id) return;
            const status = String(bill.payment_status || bill.status || 'unpaid').toLowerCase().replace(/\s+/g, '_');
            if (!includeBillStatuses.has(status)) return;
            if (bill.budget_impact_status === 'converted_to_actual') return;
            if (bill.linked_transaction_id) return;
            const date = this._allocationRecordDate(bill, ['due_date', 'timestamp', 'date', 'created_at']);
            if (!date || !this._isRecordInPeriod(bill, startKey, endKey, ['due_date', 'timestamp', 'date', 'created_at'])) return;
            const match = this._allocationMatchesRecord(bill, allocation);
            if (!match.matched) return;
            const normalized = this._normalizeAllocationRecord(bill, {
                source: 'bill',
                bucket: 'reserved',
                date,
                matchSource: match.source
            });
            bills.push({ ...bill, _allocationRecord: normalized, _matchSource: match.source });
            records.push(normalized);
        });

        records.sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
        const actual = records
            .filter(record => record.bucket === 'actual')
            .reduce((sum, record) => sum + record.amount, 0);
        const reserved = records
            .filter(record => record.bucket === 'reserved')
            .reduce((sum, record) => sum + record.amount, 0);
        const allocated = Math.max(0, Number(allocation.allocated_amount) || 0);
        const groups = this._buildAllocationGroups(records, allocated);
        const trend = this._buildAllocationTrend(records, startDate, endDate);

        return {
            transactions,
            bills,
            records,
            groups,
            trend,
            totals: {
                actual,
                reserved,
                spentReserved: actual + reserved,
                recordCount: records.length
            }
        };
    }

    _normalizeAllocationInput(input) {
        const allowedCats = new Set(['Marketing', 'Infrastructure', 'Operations', 'SaaS']);
        const list = Array.isArray(input) ? input : [];
        return list
            .map(row => {
                const name = this._stringOrDefault(row?.name, '', 120);
                const allocated = Math.round(Math.max(0, Number(row?.allocated_amount) || 0));
                const rawScope = Array.isArray(row?.scope_values) ? row.scope_values : [];
                const scope = Array.from(new Set(
                    rawScope
                        .map(v => String(v || '').trim())
                        .filter(v => v.length > 0 && v.length <= 80)
                ));
                const validScope = scope.filter(v => allowedCats.has(v));
                const threshold = Number(row?.alert_threshold_percent);
                const createdFromAllocationId = this._nullableString(row?.created_from_allocation_id, 120);
                return {
                    name,
                    allocated_amount: allocated,
                    scope_type: 'category',
                    scope_values: validScope.length ? validScope.slice(0, 10) : scope.slice(0, 10),
                    alert_threshold_percent: Number.isFinite(threshold) ? Math.max(0, Math.min(100, threshold)) : 80,
                    hard_limit_enabled: Boolean(row?.hard_limit_enabled),
                    created_from_allocation_id: createdFromAllocationId,
                    status: 'active'
                };
            })
            .filter(row => row.name && row.allocated_amount > 0 && row.scope_values.length > 0);
    }

    async addBudgetWithAllocations(userId, budgetData, allocations = []) {
        if (!userId) throw new Error('userId required');
        const cleaned = this._normalizeAllocationInput(allocations);
        const totalAllocated = cleaned.reduce((sum, row) => sum + row.allocated_amount, 0);
        const totalBudget = Math.round(Math.max(0, Number(budgetData.total_budget) || 0));
        if (totalBudget <= 0) {
            throw new Error('Total budget amount must be greater than zero.');
        }
        if (totalAllocated > totalBudget) {
            throw new Error('Total allocations cannot exceed the main budget amount.');
        }

        // Build a denormalized category map so the existing dashboard
        // OpEx-vs-Budget tracker and settings-budget.html history stay in sync.
        const categoryBudgets = {};
        cleaned.forEach(row => {
            row.scope_values.forEach(cat => {
                if (cat === 'Marketing' || cat === 'Infrastructure' || cat === 'Operations' || cat === 'SaaS') {
                    categoryBudgets[cat] = (categoryBudgets[cat] || 0) + row.allocated_amount;
                }
            });
        });

        // Atomic write: the budget doc, the archive of any prior allocations,
        // and the new allocation set all commit in one Firestore batch. If any
        // part is rejected (validation, permission-denied, network), nothing
        // is written — the existing budget doc stays intact.
        const requestedType = budgetData.budget_type === 'annual' ? 'annual' : 'period';
        const periodType = this._normalizePeriodType(budgetData.period_type, requestedType);
        const startDate = this._coerceTimestampOrNow(budgetData.period_start);
        const endDate = this._coerceTimestampOrNow(budgetData.period_end);
        const name = this._stringOrDefault(budgetData.name, 'OpEx budget', 120);
        const notes = this._nullableString(budgetData.notes, 500);
        const periodLabel = this._stringOrDefault(budgetData.period_label, '', 120)
            || this._periodLabelFromDates(periodType, startDate, endDate);
        const parentBudgetId = this._nullableString(budgetData.parent_budget_id, 120);
        const createdFromBudgetId = this._nullableString(budgetData.created_from_budget_id, 120);

        const existing = budgetData.budget_id
            ? await this.getBudget(userId, budgetData.budget_id)
            : null;
        let budgetRef;
        let budgetIsNew = false;
        if (existing) {
            budgetRef = doc(this.db, `${this._scope(userId)}/budgets/${existing.id}`);
        } else {
            budgetRef = doc(collection(this.db, `${this._scope(userId)}/budgets`));
            budgetIsNew = true;
        }

        // Existing allocations belong to the existing budget id, if any.
        const allocsToArchive = existing
            ? await this.getBudgetAllocations(userId, existing.id)
            : [];

        const batch = writeBatch(this.db);

        if (budgetIsNew) {
            const createPayload = {
                name,
                budget_type: requestedType,
                parent_budget_id: parentBudgetId,
                period_type: periodType,
                period_label: periodLabel,
                period_start: startDate,
                period_end: endDate,
                currency: 'IDR',
                total_budget: totalBudget,
                category_budgets: categoryBudgets,
                notes: notes || null,
                status: 'active',
                created_at: serverTimestamp(),
                updated_at: serverTimestamp()
            };
            if (createdFromBudgetId) createPayload.created_from_budget_id = createdFromBudgetId;
            batch.set(budgetRef, createPayload);
        } else {
            // batch.update is a merge — created_at is preserved automatically,
            // satisfying isValidBudgetUpdate's `data.created_at == existingData.created_at`.
            const updatePayload = {
                name,
                budget_type: requestedType,
                parent_budget_id: parentBudgetId,
                period_type: periodType,
                period_label: periodLabel,
                period_start: startDate,
                period_end: endDate,
                currency: 'IDR',
                total_budget: totalBudget,
                category_budgets: categoryBudgets,
                notes: notes || null,
                status: 'active',
                updated_at: serverTimestamp()
            };
            if (existing.created_from_budget_id || createdFromBudgetId) {
                updatePayload.created_from_budget_id = createdFromBudgetId || existing.created_from_budget_id;
            }
            batch.update(budgetRef, updatePayload);
        }

        // Archive prior allocations via partial update; the merge keeps every
        // other required field intact so hasAll / hasOnly stay valid.
        allocsToArchive.forEach(prev => {
            const ref = doc(this.db, `${this._scope(userId)}/budget_allocations/${prev.id}`);
            batch.update(ref, {
                status: 'archived',
                updated_at: serverTimestamp()
            });
        });

        const allocationsCol = collection(this.db, `${this._scope(userId)}/budget_allocations`);
        const allocationRefs = [];
        cleaned.forEach(row => {
            const ref = doc(allocationsCol);
            allocationRefs.push(ref);
            const allocationPayload = {
                parent_budget_id: budgetRef.id,
                name: row.name,
                allocated_amount: row.allocated_amount,
                scope_type: 'category',
                scope_values: row.scope_values,
                alert_threshold_percent: row.alert_threshold_percent,
                hard_limit_enabled: row.hard_limit_enabled,
                status: 'active',
                created_at: serverTimestamp(),
                updated_at: serverTimestamp()
            };
            if (row.created_from_allocation_id) {
                allocationPayload.created_from_allocation_id = row.created_from_allocation_id;
            }
            batch.set(ref, allocationPayload);
        });

        await batch.commit();

        // Audit logs are best-effort and non-fatal — the data write already
        // succeeded by the time we get here.
        try {
            await this.addAuditLog(userId, {
                action: budgetIsNew ? 'budget.created' : 'budget.updated',
                target_collection: 'budgets',
                target_id: budgetRef.id,
                after: { total_budget: totalBudget, period_type: periodType, name, allocation_count: cleaned.length },
                source: 'dashboard'
            });
            await this.addAuditLog(userId, {
                action: 'budget.allocations_updated',
                target_collection: 'budget_allocations',
                target_id: budgetRef.id,
                after: { budget_id: budgetRef.id, allocation_count: cleaned.length, total_allocated: totalAllocated },
                source: 'dashboard'
            });
        } catch (_) { /* non-fatal */ }

        const budget = {
            id: budgetRef.id,
            name,
            budget_type: requestedType,
            parent_budget_id: parentBudgetId,
            period_type: periodType,
            period_label: periodLabel,
            period_start: startDate,
            period_end: endDate,
            currency: 'IDR',
            total_budget: totalBudget,
            status: 'active'
        };
        budget.category_budgets = categoryBudgets;
        budget.notes = notes || null;

        return {
            budget,
            allocations: cleaned.map((row, i) => ({ id: allocationRefs[i].id, ...row, parent_budget_id: budgetRef.id }))
        };
    }

    async duplicateBudgetPeriod(userId, sourceBudgetId, targetBudgetData = {}) {
        if (!userId) throw new Error('userId required');
        if (!sourceBudgetId) throw new Error('sourceBudgetId required');
        const sourceBudget = await this.getBudget(userId, sourceBudgetId);
        if (!sourceBudget) throw new Error('Source budget not found.');
        if (sourceBudget.budget_type === 'annual' || sourceBudget.period_type === 'yearly') {
            throw new Error('Only period budgets can be duplicated.');
        }
        const sourceAllocations = await this.getBudgetAllocations(userId, sourceBudgetId);
        const duplicate = await this.addBudgetWithAllocations(userId, {
            ...targetBudgetData,
            budget_type: 'period',
            total_budget: Number(targetBudgetData.total_budget) || Number(sourceBudget.total_budget) || 0,
            name: targetBudgetData.name || targetBudgetData.period_label || `${sourceBudget.name || 'Budget'} copy`,
            parent_budget_id: targetBudgetData.parent_budget_id || sourceBudget.parent_budget_id || null,
            created_from_budget_id: sourceBudgetId
        }, sourceAllocations.map(a => ({
            name: a.name,
            allocated_amount: Number(a.allocated_amount) || 0,
            scope_values: Array.isArray(a.scope_values) ? a.scope_values : [],
            alert_threshold_percent: Number(a.alert_threshold_percent) || 80,
            hard_limit_enabled: Boolean(a.hard_limit_enabled),
            created_from_allocation_id: a.id
        })));

        const batch = writeBatch(this.db);
        duplicate.allocations.forEach((alloc, index) => {
            const source = sourceAllocations[index];
            if (!source?.id || !alloc?.id) return;
            batch.update(doc(this.db, `${this._scope(userId)}/budget_allocations/${alloc.id}`), {
                created_from_allocation_id: source.id,
                updated_at: serverTimestamp()
            });
        });
        await batch.commit();

        try {
            await this.addAuditLog(userId, {
                action: 'budget.created',
                target_collection: 'budgets',
                target_id: duplicate.budget.id,
                after: {
                    budget_id: duplicate.budget.id,
                    created_from_budget_id: sourceBudgetId,
                    allocation_count: duplicate.allocations.length
                },
                source: 'dashboard'
            });
        } catch (_) { /* non-fatal */ }
        return duplicate;
    }

    async calculateAnnualEnvelope(userId, annualBudgetId) {
        const annual = await this.getBudget(userId, annualBudgetId);
        if (!annual) return null;
        const annualStart = this._budgetDayKey(annual.period_start);
        const annualEnd = this._budgetDayKey(annual.period_end);
        const periods = await this.getPeriodBudgets(userId, annual.id);
        const plannedPeriods = periods.reduce((sum, budget) => sum + Math.max(0, Number(budget.total_budget) || 0), 0);
        let spentReservedYtd = 0;
        if (annualStart && annualEnd) {
            const today = this._getDayKey(new Date());
            const ytdEnd = annualEnd > today ? today : annualEnd;
            const [transactions, bills] = await Promise.all([
                this.getTransactions(userId, 1000),
                this.getBills(userId)
            ]);
            const SPEND_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);
            transactions
                .filter(tx => this._isRecordInPeriod(tx, annualStart, ytdEnd, ['date', 'timestamp', 'created_at']))
                .forEach(tx => {
                    if (SPEND_TYPES.has(String(tx.type || '').toLowerCase())) {
                        spentReservedYtd += Math.abs(Number(tx.amount) || 0);
                    }
                });
            bills
                .filter(bill => this._isRecordInPeriod(bill, annualStart, ytdEnd, ['due_date', 'date', 'timestamp', 'created_at']))
                .forEach(bill => {
                    if (bill.payment_status === 'paid') return;
                    if (bill.budget_impact_status === 'converted_to_actual' || bill.linked_transaction_id) return;
                    spentReservedYtd += Math.abs(Number(bill.amount) || 0);
                });
        }
        const yearlyBudget = Math.max(0, Number(annual.total_budget) || 0);
        return {
            annual_budget: annual,
            yearly_budget: yearlyBudget,
            planned_periods: plannedPeriods,
            spent_reserved_ytd: spentReservedYtd,
            unplanned_capacity: yearlyBudget - plannedPeriods
        };
    }

    async getBudgetUsage(userId, budgetId, options = {}) {
        if (!userId || !budgetId) {
            return this._emptyBudgetUsage();
        }
        const budgetRef = doc(this.db, `${this._scope(userId)}/budgets/${budgetId}`);
        const budgetSnap = await getDoc(budgetRef);
        if (!budgetSnap.exists()) return this._emptyBudgetUsage();

        const budget = { id: budgetSnap.id, ...budgetSnap.data() };
        const startDate = budget.period_start?.toDate?.() || null;
        const endDate = budget.period_end?.toDate?.() || null;
        if (!startDate || !endDate) {
            return { ...this._emptyBudgetUsage(), budget };
        }

        const startKey = this._getDayKey(startDate);
        const endKey = this._getDayKey(endDate);

        const inBudgetRange = (record, fields) => {
            const date = this._firstRecordDate(record, fields);
            if (!date) return false;
            const startCompare = new Date(startDate);
            startCompare.setHours(0, 0, 0, 0);
            const endCompare = new Date(endDate);
            endCompare.setHours(23, 59, 59, 999);
            return date >= startCompare && date <= endCompare;
        };

        const [allocations, allTransactions, allBills] = await Promise.all([
            this.getBudgetAllocations(userId, budgetId),
            this.getTransactions(userId, 1000),
            this.getBills(userId)
        ]);
        const transactions = allTransactions.filter(tx => inBudgetRange(tx, ['date', 'timestamp', 'created_at']));
        const bills = allBills.filter(bill => inBudgetRange(bill, ['due_date', 'date', 'timestamp', 'created_at']));

        const SPEND_TYPES = new Set(['expense', 'fee', 'tax']);
        const COMMIT_TYPES = new Set(['pending_payable']);

        const isBillUnpaid = (bill) => bill?.payment_status !== 'paid';
        const isBillCommittable = (bill) =>
            bill?.budget_impact_status !== 'converted_to_actual' && !bill?.linked_transaction_id;

        // Phase 2 resolver — single source of truth for "which allocation
        // does this record count against?". See resolveRecordAssignment for
        // the priority chain.
        const totals = new Map();
        allocations.forEach(a => totals.set(a.id, { actual: 0, committed: 0 }));
        let unallocatedActual = 0;
        let unallocatedCommitted = 0;

        const allocateActual = (allocationId, amount) => {
            if (allocationId) totals.get(allocationId).actual += amount;
            else unallocatedActual += amount;
        };
        const allocateCommitted = (allocationId, amount) => {
            if (allocationId) totals.get(allocationId).committed += amount;
            else unallocatedCommitted += amount;
        };

        transactions.forEach(tx => {
            const amount = Math.abs(Number(tx.amount) || 0);
            if (amount === 0) return;
            const isSpend = SPEND_TYPES.has(tx.type);
            const isCommit = COMMIT_TYPES.has(tx.type);
            if (!isSpend && !isCommit) return;
            const { allocationId, source } = this.resolveRecordAssignment(tx, budget, allocations);
            if (source === 'excluded') return;
            if (isSpend) allocateActual(allocationId, amount);
            else allocateCommitted(allocationId, amount);
        });

        bills.forEach(bill => {
            const amount = Math.abs(Number(bill.amount) || 0);
            if (amount === 0) return;
            if (!isBillUnpaid(bill)) return;
            if (!isBillCommittable(bill)) return;
            const { allocationId, source } = this.resolveRecordAssignment(bill, budget, allocations);
            if (source === 'excluded') return;
            allocateCommitted(allocationId, amount);
        });

        const allocationsWithUsage = allocations.map(alloc => {
            const bucket = totals.get(alloc.id) || { actual: 0, committed: 0 };
            const allocated = Math.max(0, Number(alloc.allocated_amount) || 0);
            const actual = bucket.actual;
            const committed = bucket.committed;
            const remaining = allocated - actual - committed;
            const usagePercent = allocated > 0
                ? ((actual + committed) / allocated) * 100
                : 0;
            return {
                id: alloc.id,
                name: alloc.name,
                allocated_amount: allocated,
                scope_type: alloc.scope_type,
                scope_values: Array.isArray(alloc.scope_values) ? alloc.scope_values : [],
                actual_used: actual,
                committed_amount: committed,
                remaining_amount: remaining,
                usage_percent: Number.isFinite(usagePercent) ? usagePercent : 0,
                status: this._budgetAllocationStatus(usagePercent)
            };
        });

        const totalAllocated = allocationsWithUsage.reduce((s, a) => s + a.allocated_amount, 0);
        const totalActual = allocationsWithUsage.reduce((s, a) => s + a.actual_used, 0);
        const totalCommitted = allocationsWithUsage.reduce((s, a) => s + a.committed_amount, 0);
        const totalBudget = Math.max(0, Number(budget.total_budget) || 0);
        const totalRemaining = totalBudget - totalActual - totalCommitted;
        const mainUsagePercent = totalBudget > 0
            ? ((totalActual + totalCommitted) / totalBudget) * 100
            : 0;

        return {
            budget,
            allocations: allocationsWithUsage,
            summary: {
                total_amount: totalBudget,
                total_allocated: totalAllocated,
                unallocated_budget_amount: totalBudget - totalAllocated,
                total_actual_used: totalActual,
                total_committed: totalCommitted,
                total_remaining: totalRemaining,
                usage_percent: Number.isFinite(mainUsagePercent) ? mainUsagePercent : 0
            },
            unallocated: {
                actual_amount: unallocatedActual,
                committed_amount: unallocatedCommitted
            }
        };
    }

    _emptyBudgetUsage() {
        return {
            budget: null,
            allocations: [],
            summary: {
                total_amount: 0,
                total_allocated: 0,
                unallocated_budget_amount: 0,
                total_actual_used: 0,
                total_committed: 0,
                total_remaining: 0,
                usage_percent: 0
            },
            unallocated: { actual_amount: 0, committed_amount: 0 }
        };
    }

    _budgetAllocationStatus(usagePercent) {
        const u = Number.isFinite(usagePercent) ? usagePercent : 0;
        if (u >= 100) return 'exceeded';
        if (u >= 85) return 'at_risk';
        if (u >= 70) return 'watch';
        return 'healthy';
    }

    // Match a (possibly in-progress) bill draft to an active budget
    // allocation. Returns { activeBudget, allocation, status, exceedsBy }.
    // Pure logic — no Firestore writes. Used by both the bill drawer
    // preview and the bill-save payload.
    matchBillToAllocation({ billData, activeBudget, allocations }) {
        if (!activeBudget) {
            return { activeBudget: null, allocation: null, status: 'no_active_budget', exceedsBy: 0 };
        }
        const start = activeBudget.period_start?.toDate?.() || null;
        const end = activeBudget.period_end?.toDate?.() || null;
        if (!start || !end) {
            return { activeBudget, allocation: null, status: 'no_active_budget', exceedsBy: 0 };
        }
        const date = this._firstRecordDate(billData, ['due_date', 'date', 'timestamp', 'created_at']) || new Date();
        const startCompare = new Date(start);
        startCompare.setHours(0, 0, 0, 0);
        const endCompare = new Date(end);
        endCompare.setHours(23, 59, 59, 999);
        if (date < startCompare || date > endCompare) {
            return { activeBudget, allocation: null, status: 'out_of_period', exceedsBy: 0 };
        }

        const cat = String(billData?.category || '').trim();
        if (!cat) {
            return { activeBudget, allocation: null, status: 'unmatched', exceedsBy: 0 };
        }
        const active = (allocations || []).filter(a => a.status !== 'archived');
        const matches = active.filter(a => Array.isArray(a.scope_values) && a.scope_values.includes(cat));
        if (matches.length === 0) {
            return { activeBudget, allocation: null, status: 'unmatched', exceedsBy: 0 };
        }
        const allocation = matches[0];
        const billAmount = Math.abs(Number(billData?.amount) || 0);
        const remaining = Math.max(0, Number(allocation.remaining_amount) || 0);
        const exceedsBy = billAmount > remaining ? (billAmount - remaining) : 0;
        const status = matches.length > 1
            ? 'needs_review'
            : (exceedsBy > 0 ? 'exceeded' : 'matched');
        return { activeBudget, allocation, status, exceedsBy };
    }

    // ── Phase 2: assignment priority resolver ──────────────────────────
    // Pure logic. Decides which allocation a record counts against:
    //   1. Excluded → null (record drops out of totals entirely)
    //   2. Explicit budget_allocation_id pointing at an active allocation
    //   3. Category match (legacy fallback for records without budget fields)
    //   4. None → unallocated bucket
    resolveRecordAssignment(record, activeBudget, allocations) {
        if (!record) return { allocationId: null, source: 'none' };

        if (record.budget_match_status === 'excluded') {
            return { allocationId: null, source: 'excluded' };
        }

        const activeAllocs = (allocations || []).filter(a => a.status !== 'archived');
        const activeIds = new Set(activeAllocs.map(a => a.id));

        if (record.budget_allocation_id && activeIds.has(record.budget_allocation_id)) {
            const source = record.budget_match_method === 'manual' ? 'manual' : 'explicit';
            return { allocationId: record.budget_allocation_id, source };
        }

        const cat = String(record.category || '').trim();
        if (cat) {
            const hit = activeAllocs.find(a => Array.isArray(a.scope_values) && a.scope_values.includes(cat));
            if (hit) return { allocationId: hit.id, source: 'category' };
        }

        return { allocationId: null, source: 'none' };
    }

    // ── Phase 2: related-record reads ──────────────────────────────────
    async getBudgetRelatedRecords(userId, budgetId, allocationId) {
        const usage = await this.getBudgetUsage(userId, budgetId);
        if (!usage.budget) return { transactions: [], bills: [], excluded: { transactions: [], bills: [] } };

        const startDate = usage.budget.period_start?.toDate?.();
        const endDate = usage.budget.period_end?.toDate?.();
        if (!startDate || !endDate) return { transactions: [], bills: [], excluded: { transactions: [], bills: [] } };

        const startKey = this._getDayKey(startDate);
        const endKey = this._getDayKey(endDate);
        const [transactionsRaw, billsRaw] = await Promise.all([
            this.getTransactions(userId, 1000),
            this.getBills(userId)
        ]);
        const transactions = transactionsRaw.filter(tx => this._isRecordInPeriod(tx, startKey, endKey, ['date', 'timestamp', 'created_at']));
        const bills = billsRaw.filter(bill => this._isRecordInPeriod(bill, startKey, endKey, ['due_date', 'date', 'timestamp', 'created_at']));

        const SPEND_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);
        const matchedTx = [];
        const matchedBills = [];
        const excludedTx = [];
        const excludedBills = [];

        transactions.forEach(tx => {
            if (!SPEND_TYPES.has(tx.type)) return;
            const { allocationId: rid, source } = this.resolveRecordAssignment(tx, usage.budget, usage.allocations);
            if (source === 'excluded') excludedTx.push({ ...tx, _matchSource: source, _allocationId: null });
            else if (rid === allocationId) matchedTx.push({ ...tx, _matchSource: source, _allocationId: rid });
        });

        bills.forEach(bill => {
            if (bill.payment_status === 'paid') return;
            if (bill.budget_impact_status === 'converted_to_actual' || bill.linked_transaction_id) return;
            const { allocationId: rid, source } = this.resolveRecordAssignment(bill, usage.budget, usage.allocations);
            if (source === 'excluded') excludedBills.push({ ...bill, _matchSource: source, _allocationId: null });
            else if (rid === allocationId) matchedBills.push({ ...bill, _matchSource: source, _allocationId: rid });
        });

        return { transactions: matchedTx, bills: matchedBills, excluded: { transactions: excludedTx, bills: excludedBills } };
    }

    async getUnallocatedBudgetRecords(userId, budgetId) {
        const usage = await this.getBudgetUsage(userId, budgetId);
        if (!usage.budget) return { transactions: [], bills: [] };

        const startDate = usage.budget.period_start?.toDate?.();
        const endDate = usage.budget.period_end?.toDate?.();
        if (!startDate || !endDate) return { transactions: [], bills: [] };

        const startKey = this._getDayKey(startDate);
        const endKey = this._getDayKey(endDate);
        const [transactionsRaw, billsRaw] = await Promise.all([
            this.getTransactions(userId, 1000),
            this.getBills(userId)
        ]);
        const transactions = transactionsRaw.filter(tx => this._isRecordInPeriod(tx, startKey, endKey, ['date', 'timestamp', 'created_at']));
        const bills = billsRaw.filter(bill => this._isRecordInPeriod(bill, startKey, endKey, ['due_date', 'date', 'timestamp', 'created_at']));

        const SPEND_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);
        const unallocTx = [];
        const unallocBills = [];

        transactions.forEach(tx => {
            if (!SPEND_TYPES.has(tx.type)) return;
            const { allocationId, source } = this.resolveRecordAssignment(tx, usage.budget, usage.allocations);
            if (source === 'none') unallocTx.push({ ...tx, _matchSource: source });
        });
        bills.forEach(bill => {
            if (bill.payment_status === 'paid') return;
            if (bill.budget_impact_status === 'converted_to_actual' || bill.linked_transaction_id) return;
            const { allocationId, source } = this.resolveRecordAssignment(bill, usage.budget, usage.allocations);
            if (source === 'none') unallocBills.push({ ...bill, _matchSource: source });
        });

        return { transactions: unallocTx, bills: unallocBills };
    }

    async getBudgetActivityLogs(userId, budgetId, limitCount = 100) {
        if (!userId || !budgetId) return [];
        try {
            const q = query(
                collection(this.db, `${this._scope(userId)}/audit_logs`),
                orderBy('created_at', 'desc'),
                limit(500)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(log => typeof log.action === 'string'
                    && log.action.startsWith('budget_')
                    && log.after?.budget_id === budgetId)
                .slice(0, limitCount);
        } catch (_) {
            return [];
        }
    }

    // ── Phase 2: assignment writers (atomic record-update + audit log) ─
    _budgetSnapshot(record) {
        const keys = [
            'budget_id', 'budget_allocation_id', 'budget_match_method',
            'budget_match_status', 'budget_match_confidence',
            'budget_assignment_reason', 'budget_exclusion_reason',
            'budget_impact_status'
        ];
        const out = {};
        keys.forEach(k => {
            if (record && record[k] !== undefined) out[k] = record[k] ?? null;
        });
        return out;
    }

    async _commitBudgetUpdate(userId, targetCollection, recordId, updateFields, auditAction, reason, activeBudgetId) {
        if (!userId) throw new Error('userId required');
        if (!recordId) throw new Error('recordId required');
        const cleanReason = this._stringOrDefault(reason, '', 500);
        if (!cleanReason) throw new Error('Reason is required.');

        const ref = doc(this.db, `${this._scope(userId)}/${targetCollection}/${recordId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Record not found.');
        const existing = snap.data() || {};
        const before = this._budgetSnapshot(existing);

        // Always set the assignment trace fields.
        const payload = {
            ...updateFields,
            budget_assignment_reason: cleanReason,
            budget_assignment_updated_at: serverTimestamp(),
            budget_assignment_updated_by: (this.actorUid || userId)
        };
        if (targetCollection === 'transactions') {
            payload.updated_at = serverTimestamp();
            payload.updated_by = userId;
        }

        const batch = writeBatch(this.db);
        batch.update(ref, payload);
        const auditRef = doc(collection(this.db, `${this._scope(userId)}/audit_logs`));
        batch.set(auditRef, {
            actor_uid: (this.actorUid || userId),
            actor_role: null,
            action: auditAction,
            target_collection: targetCollection,
            target_id: recordId,
            before,
            after: {
                ...this._budgetSnapshot({ ...existing, ...payload }),
                budget_id: activeBudgetId || payload.budget_id || existing.budget_id || null
            },
            reason: cleanReason,
            source: 'dashboard',
            created_at: serverTimestamp()
        });
        await batch.commit();
        return { ok: true };
    }

    async updateTransactionBudgetAssignment(userId, transactionId, { budgetId, allocationId, reason }) {
        if (!allocationId) throw new Error('allocationId required.');
        return this._commitBudgetUpdate(userId, 'transactions', transactionId, {
            budget_id: budgetId,
            budget_allocation_id: allocationId,
            budget_match_method: 'manual',
            budget_match_status: 'matched',
            budget_match_confidence: 1,
            budget_exclusion_reason: null
        }, 'budget_assignment.update', reason, budgetId);
    }

    async updateBillBudgetAssignment(userId, billId, { budgetId, allocationId, reason }) {
        if (!allocationId) throw new Error('allocationId required.');
        return this._commitBudgetUpdate(userId, 'bills', billId, {
            budget_id: budgetId,
            budget_allocation_id: allocationId,
            budget_match_method: 'manual',
            budget_match_status: 'matched',
            budget_impact_status: 'committed',
            budget_exclusion_reason: null
        }, 'budget_assignment.update', reason, budgetId);
    }

    async excludeTransactionFromBudget(userId, transactionId, { budgetId, reason }) {
        return this._commitBudgetUpdate(userId, 'transactions', transactionId, {
            budget_id: budgetId,
            budget_allocation_id: null,
            budget_match_method: 'excluded',
            budget_match_status: 'excluded',
            budget_exclusion_reason: this._stringOrDefault(reason, '', 500)
        }, 'budget_assignment.exclude', reason, budgetId);
    }

    async excludeBillFromBudget(userId, billId, { budgetId, reason }) {
        return this._commitBudgetUpdate(userId, 'bills', billId, {
            budget_id: budgetId,
            budget_allocation_id: null,
            budget_match_method: 'excluded',
            budget_match_status: 'excluded',
            budget_impact_status: 'released',
            budget_exclusion_reason: this._stringOrDefault(reason, '', 500)
        }, 'budget_assignment.exclude', reason, budgetId);
    }

    async restoreBudgetAssignment(userId, targetCollection, recordId, { reason, budgetId }) {
        const updates = {
            budget_id: budgetId || null,
            budget_allocation_id: null,
            budget_match_method: 'auto',
            budget_match_status: 'matched',
            budget_exclusion_reason: null
        };
        if (targetCollection === 'bills') updates.budget_impact_status = 'committed';
        return this._commitBudgetUpdate(userId, targetCollection, recordId, updates,
            'budget_assignment.restore', reason, budgetId);
    }

    _buildCashPressure({ bankBalance = 0, receivablesDueSoon = 0, payablesDueSoon = 0, overdueCount = 0 }) {
        const safeBank = Number.isFinite(bankBalance) ? bankBalance : 0;
        const safeIn = Number.isFinite(receivablesDueSoon) ? receivablesDueSoon : 0;
        const safeOut = Number.isFinite(payablesDueSoon) ? payablesDueSoon : 0;
        const outlook = safeBank + safeIn - safeOut;
        let riskLevel = 'low';
        if (overdueCount > 0 && (safeBank + safeIn) < safeOut) {
            riskLevel = 'critical';
        } else if (outlook < 0) {
            riskLevel = 'high';
        } else if (safeOut > 0 && outlook < safeOut) {
            riskLevel = 'watch';
        }
        return {
            outlook,
            bankBalance: safeBank,
            receivablesDueSoon: safeIn,
            payablesDueSoon: safeOut,
            riskLevel
        };
    }

    _buildCashFlowBuckets(transactions = [], bills = [], subscriptions = [], startKey, endKey) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return [];
        const rangeDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const bucketType = rangeDays <= 14 ? 'day' : (rangeDays > 93 ? 'month' : 'week');
        const buckets = [];

        if (bucketType === 'month') {
            let cursor = this._getMonthStartKey(start);
            while (cursor <= endKey) {
                const cursorDate = this._parseDayKey(cursor);
                const monthEnd = this._getMonthEndKey(cursorDate);
                const bucketStart = cursor < startKey ? startKey : cursor;
                const bucketEnd = monthEnd > endKey ? endKey : monthEnd;
                buckets.push({
                    start: bucketStart,
                    end: bucketEnd,
                    label: this._formatCashFlowLabel(bucketStart, bucketEnd, 'month'),
                    cashIn: 0,
                    cashOut: 0,
                    netCashFlow: 0
                });
                const next = this._parseDayKey(cursor);
                next.setMonth(next.getMonth() + 1);
                cursor = this._getMonthStartKey(next);
            }
        } else {
            const step = bucketType === 'day' ? 1 : 7;
            let cursor = startKey;
            while (cursor <= endKey) {
                const bucketEndDate = this._addDays(this._parseDayKey(cursor), step - 1);
                const bucketEndKey = this._getDayKey(bucketEndDate);
                const bucketEnd = bucketEndKey > endKey ? endKey : bucketEndKey;
                buckets.push({
                    start: cursor,
                    end: bucketEnd,
                    label: this._formatCashFlowLabel(cursor, bucketEnd, bucketType),
                    cashIn: 0,
                    cashOut: 0,
                    netCashFlow: 0
                });
                const nextDate = this._addDays(this._parseDayKey(bucketEnd), 1);
                cursor = this._getDayKey(nextDate);
            }
        }

        const findBucket = (dayKey) => buckets.find(b => dayKey >= b.start && dayKey <= b.end);

        transactions.forEach(tx => {
            const date = this._getTransactionDate(tx);
            if (!date) return;
            const dayKey = this._getDayKey(date);
            const bucket = findBucket(dayKey);
            if (!bucket) return;
            const amount = Math.abs(Number(tx.amount) || 0);
            const type = String(tx.type || '').toLowerCase();
            if (['revenue', 'income', 'refund', 'pending_receivable'].includes(type)) bucket.cashIn += amount;
            else if (['expense', 'fee', 'tax', 'pending_payable'].includes(type)) bucket.cashOut += amount;
        });

        bills.forEach(bill => {
            const date = this._getRecordDate(bill, 'due_date');
            if (!date) return;
            const dayKey = this._getDayKey(date);
            const bucket = findBucket(dayKey);
            if (!bucket) return;
            bucket.cashOut += Math.abs(Number(bill.amount) || 0);
        });

        subscriptions.forEach(sub => {
            const date = this._getRecordDate(sub, 'renewal_date');
            if (!date) return;
            const dayKey = this._getDayKey(date);
            const bucket = findBucket(dayKey);
            if (!bucket) return;
            bucket.cashOut += Math.abs(Number(sub.amount) || 0);
        });

        buckets.forEach(b => { b.netCashFlow = b.cashIn - b.cashOut; });

        if (!buckets.length) {
            buckets.push({
                start: startKey,
                end: endKey,
                label: this._formatCashFlowLabel(startKey, endKey, 'day'),
                cashIn: 0,
                cashOut: 0,
                netCashFlow: 0
            });
        }

        return buckets;
    }

    // Chart bucket label — display-only, formats in the active app language.
    _formatCashFlowLabel(startKey, endKey, bucketType) {
        const loc = (typeof window !== 'undefined' && window.FluxyI18n?.locale?.()) || 'en-US';
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return '';
        if (bucketType === 'month') return start.toLocaleDateString(loc, { month: 'short', year: 'numeric' });
        if (startKey === endKey) return start.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
        if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            return `${start.toLocaleDateString(loc, { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
        }
        return `${start.toLocaleDateString(loc, { month: 'short', day: 'numeric' })}-${end.toLocaleDateString(loc, { month: 'short', day: 'numeric' })}`;
    }

    _buildPayablesByCategory(...recordArrays) {
        const totals = new Map();
        recordArrays.flat().forEach(record => {
            const category = (record.category && String(record.category).trim()) || 'Uncategorized';
            const amount = Math.abs(Number(record.amount) || 0);
            if (amount <= 0) return;
            totals.set(category, (totals.get(category) || 0) + amount);
        });
        const entries = Array.from(totals.entries())
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5);
        const max = entries[0]?.amount || 1;
        return entries.map(item => ({ ...item, percentage: Math.round((item.amount / max) * 100) }));
    }

    _buildReportReadiness(missingReceipts = [], overdueBills = []) {
        const missingCount = missingReceipts.length;
        const overdueCount = overdueBills.length;
        const dataWarnings = [];

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const oldOverdue = overdueBills.some(bill => {
            const date = this._getRecordDate(bill, 'due_date');
            if (!date) return false;
            const days = Math.round((now - date) / 86400000);
            return days > 60;
        });
        if (oldOverdue) dataWarnings.push('Old due dates');

        let status;
        if (missingCount === 0 && overdueCount === 0) status = 'Ready';
        else if (overdueCount > 3 || dataWarnings.length > 0) status = 'Not ready';
        else status = 'Needs review';

        return {
            status,
            missingReceipts: missingCount,
            overdueBills: overdueCount,
            dataWarnings
        };
    }

    async getDashboardStats(userId, period = null) {
        const overview = await this.getDashboardOverview(userId, {
            startDate: period?.start,
            endDate: period?.end
        });

        return {
            revenue: overview.performance.revenue,
            opex: overview.performance.opex,
            margin: overview.performance.grossMargin,
            revenue_change: overview.performance.revenueChangePct,
            action_items_count: overview.actionItems.total
        };
    }

    _isTransactionInPeriod(tx, startKey, endKey) {
        const date = this._getTransactionDate(tx);
        if (!date) return false;
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return false;
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
    }

    _getTransactionDate(tx) {
        const date = this._firstRecordDate(tx, ['date', 'timestamp', 'created_at']);
        if (date) return date;
        if (tx.timestamp && typeof tx.timestamp.toDate === 'function') return tx.timestamp.toDate();
        if (tx.timestamp instanceof Date) return tx.timestamp;
        if (typeof tx.timestamp === 'string' || typeof tx.timestamp === 'number') {
            const parsed = new Date(tx.timestamp);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    }

    _firstRecordDate(record, fields = []) {
        for (const field of fields) {
            const date = this._getRecordDate(record, field);
            if (date) return date;
        }
        return null;
    }

    _isRecordInPeriod(record, startKey, endKey, fields = ['timestamp']) {
        const date = this._firstRecordDate(record, fields);
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!date || !start || !end) return false;
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
    }

    _parseDayKey(dayKey) {
        if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
        const [year, month, day] = dayKey.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    _isExpired(value, now = Date.now()) {
        if (!value) return false;
        if (value && typeof value.toDate === 'function') return value.toDate().getTime() <= now;
        const parsed = new Date(value);
        return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= now;
    }

    _normalizeOverviewPeriod(options = {}) {
        const todayKey = this._getDayKey(new Date());
        const defaultStart = this._getMonthStartKey(new Date());
        const defaultEnd = this._getMonthEndKey(new Date());
        const startDate = options.startDate || options.start || defaultStart;
        const endDate = options.endDate || options.end || defaultEnd;
        return {
            label: options.label || this._formatOverviewPeriodLabel(startDate, endDate),
            mode: options.mode || 'custom',
            startDate,
            endDate: endDate > todayKey ? todayKey : endDate
        };
    }

    _resolveAllTimeOverviewPeriod(period, transactions = [], bills = [], subscriptions = []) {
        let earliest = null;
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const includeDate = date => {
            if (!date || Number.isNaN(date.getTime()) || date > today) return;
            if (!earliest || date < earliest) earliest = date;
        };

        transactions.forEach(tx => includeDate(this._getRecordDate(tx, 'timestamp') || this._getRecordDate(tx, 'created_at')));
        bills.forEach(bill => includeDate(this._getRecordDate(bill, 'due_date') || this._getRecordDate(bill, 'timestamp') || this._getRecordDate(bill, 'created_at')));
        subscriptions.forEach(sub => includeDate(this._getRecordDate(sub, 'renewal_date') || this._getRecordDate(sub, 'timestamp') || this._getRecordDate(sub, 'created_at')));

        const todayKey = this._getDayKey(new Date());
        return {
            ...period,
            label: 'All time',
            startDate: earliest ? this._getDayKey(earliest) : todayKey,
            endDate: todayKey
        };
    }

    _getPreviousOverviewPeriod(period) {
        const start = this._parseDayKey(period.startDate);
        const end = this._parseDayKey(period.endDate);
        if (!start || !end) return { startDate: period.startDate, endDate: period.endDate };

        if (period.mode === 'all_time') {
            return { startDate: period.startDate, endDate: period.endDate };
        }

        if (period.mode === 'this_month') {
            const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
            const previousMonthEnd = new Date(previousStart.getFullYear(), previousStart.getMonth() + 1, 0);
            const equivalentEndDay = Math.min(end.getDate(), previousMonthEnd.getDate());
            const previousEnd = new Date(previousStart.getFullYear(), previousStart.getMonth(), equivalentEndDay);
            return {
                startDate: this._getDayKey(previousStart),
                endDate: this._getDayKey(previousEnd)
            };
        }

        if (period.mode === 'last_month') {
            const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
            const previousEnd = new Date(previousStart.getFullYear(), previousStart.getMonth() + 1, 0);
            return {
                startDate: this._getDayKey(previousStart),
                endDate: this._getDayKey(previousEnd)
            };
        }

        if (period.mode === 'year_to_date') {
            const previousStart = new Date(start);
            previousStart.setFullYear(start.getFullYear() - 1);
            const previousEnd = new Date(end);
            previousEnd.setFullYear(end.getFullYear() - 1);
            return {
                startDate: this._getDayKey(previousStart),
                endDate: this._getDayKey(previousEnd)
            };
        }

        const rangeDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const previousEnd = this._addDays(start, -1);
        const previousStart = this._addDays(previousEnd, -(rangeDays - 1));
        return {
            startDate: this._getDayKey(previousStart),
            endDate: this._getDayKey(previousEnd)
        };
    }

    _calculateOverviewPerformance(transactions = []) {
        let revenue = 0;
        let opex = 0;
        transactions.forEach(tx => {
            const amount = Math.abs(Number(tx.amount) || 0);
            const type = String(tx.type || '').toLowerCase();
            if (['revenue', 'income', 'refund', 'pending_receivable'].includes(type)) revenue += amount;
            else if (['expense', 'fee', 'tax', 'pending_payable'].includes(type)) opex += amount;
        });
        const grossMargin = revenue > 0 ? ((revenue - opex) / revenue) * 100 : 0;
        return {
            revenue,
            opex,
            grossMargin: Number.isFinite(grossMargin) ? grossMargin : 0,
            revenueChangePct: null,
            opexChangePct: null,
            marginChangePct: null
        };
    }

    _safePercentChange(current, previous) {
        const currentValue = Number(current) || 0;
        const previousValue = Number(previous) || 0;
        if (previousValue === 0) return null;
        const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
        return Number.isFinite(change) ? change : null;
    }

    _getRecordDate(record, fieldName) {
        const value = record?.[fieldName];
        if (value && typeof value.toDate === 'function') return value.toDate();
        if (value instanceof Date) return value;
        if (typeof value === 'string' || typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    }

    _isBeforeToday(date, today) {
        if (!date) return false;
        const normalized = new Date(date);
        normalized.setHours(0, 0, 0, 0);
        return normalized < today;
    }

    _isInUpcomingWindow(date, today, attentionEnd, periodStartKey, periodEndKey) {
        if (!date) return false;
        const normalized = new Date(date);
        normalized.setHours(0, 0, 0, 0);
        const dayKey = this._getDayKey(normalized);
        const inNextThirtyDays = normalized >= today && normalized <= attentionEnd;
        const inSelectedPeriod = dayKey >= periodStartKey && dayKey <= periodEndKey;
        return inNextThirtyDays || inSelectedPeriod;
    }

    _sumAmounts(records = []) {
        return records.reduce((total, record) => total + Math.abs(Number(record.amount) || 0), 0);
    }

    _sortByDate(a, b, fieldName) {
        const left = this._getRecordDate(a, fieldName);
        const right = this._getRecordDate(b, fieldName);
        return (left ? left.getTime() : 0) - (right ? right.getTime() : 0);
    }

    _getCashPressureRisk(netPressure, obligations, incoming, overdueCount) {
        if (overdueCount > 0 || (obligations > 0 && netPressure < 0 && Math.abs(netPressure) > Math.max(incoming, 1))) return 'high';
        if (obligations > 0 && netPressure < 0) return 'watch';
        return 'low';
    }

    _buildOverviewInsights(overview, transactionCount) {
        const p = overview.performance;
        const risk = overview.cashPressure.riskLevel;
        let mainRisk = 'No urgent finance risk detected from available records.';
        let recommendedAction = 'Keep reviewing new records as they come in.';
        let positiveSignal = p.revenue > p.opex && p.revenue > 0
            ? 'Revenue is higher than OpEx for this period.'
            : 'The overview has enough structure to highlight what needs attention.';

        if (overview.actionItems.overdueBills > 0) {
            mainRisk = `${overview.actionItems.overdueBills} overdue bill${overview.actionItems.overdueBills === 1 ? '' : 's'} may need review.`;
            recommendedAction = 'Open Bills and review overdue obligations first.';
        } else if (overview.actionItems.missingReceipts > 0) {
            mainRisk = `${overview.actionItems.missingReceipts} transaction${overview.actionItems.missingReceipts === 1 ? '' : 's'} need receipt cleanup.`;
            recommendedAction = 'Open Ledger and resolve missing receipts before reporting.';
        } else if (risk !== 'low') {
            mainRisk = 'Upcoming obligations may pressure expected cash.';
            recommendedAction = 'Review upcoming bills and subscriptions before adding new spend.';
        } else if (transactionCount === 0) {
            positiveSignal = 'No transactions were found for this period yet.';
            mainRisk = 'There is not enough period data for a confident finance read.';
            recommendedAction = 'Add transactions or import ledger data to make Overview useful.';
        }

        return {
            summary: `Here's what I'm seeing: ${positiveSignal} ${mainRisk}`,
            mainRisk,
            recommendedAction,
            limitations: overview.limitations
        };
    }

    _getDayKey(date = new Date()) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    _getMonthStartKey(date = new Date()) {
        return this._getDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
    }

    _getMonthEndKey(date = new Date()) {
        return this._getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
    }

    _addDays(date, delta) {
        const next = date instanceof Date ? new Date(date) : this._parseDayKey(date);
        next.setDate(next.getDate() + delta);
        return next;
    }

    _formatOverviewPeriodLabel(startKey, endKey) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return 'Selected period';
        if (startKey === this._getMonthStartKey(start) && endKey === this._getMonthEndKey(start)) {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
        return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    _settingsDoc(userId, docId) {
        return doc(this.db, `users/${userId}/settings/${docId}`);
    }

    _defaultSettings(docId) {
        const defaults = {
            company: {
                business_name: 'Global HQ',
                business_type: '',
                country: 'Indonesia',
                entity_label: 'Consolidated'
            },
            finance: {
                currency: 'IDR',
                locale: 'id-ID',
                timezone: 'Asia/Jakarta',
                date_format: 'DD MMM YYYY',
                categories: ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'],
                monthly_opex_budget: 0
            },
            import_rules: {
                csv_date_behavior: 'use_row_date',
                unknown_document_route: 'ai_review',
                bill_scan_behavior: 'create_bill_draft',
                receipt_scan_behavior: 'create_ledger_draft',
                payment_screenshot_behavior: 'create_review_item',
                require_confirmation_before_save: true
            },
            ai: {
                answer_style: 'practical',
                default_analysis_period: 'current_month',
                show_data_quality_warnings: true,
                allow_ai_suggestions: true,
                allow_ai_draft_actions: false,
                require_confirmation_before_save: true
            },
            whatsapp: {
                status: 'not_connected',
                phone_number: null,
                business_display_name: null,
                last_sync_at: null,
                last_verified_at: null,
                provider: 'whatsapp_cloud_api'
            },
            reports: {
                arr_source: 'none',
                recurring_revenue_category_ids: []
            },
            email_preferences: {
                weekly_digest_enabled: true,
                delivery_day: 'monday',
                delivery_hour: 9,
                timezone: 'Asia/Jakarta',
                metrics: {
                    financial_health: true,
                    cash_position: true,
                    bills: true,
                    budgets: true,
                    revenue: true,
                    expenses: true,
                    subscriptions: true,
                    vendors: true
                }
            }
        };
        return defaults[docId] || {};
    }

    _cleanDefined(data) {
        return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    }

    _stringOrDefault(value, fallback, maxLength = 120) {
        const clean = String(value ?? '').trim().slice(0, maxLength);
        return clean || fallback;
    }

    _nullableString(value, maxLength = 120) {
        const clean = String(value ?? '').trim().slice(0, maxLength);
        return clean || null;
    }

    _allowedValue(value, allowed, fallback) {
        return allowed.includes(value) ? value : fallback;
    }

    _normalizeCategories(categories) {
        const fallback = this._defaultSettings('finance').categories;
        if (!Array.isArray(categories)) return fallback;
        const allowed = new Set(fallback);
        const clean = categories.filter(category => allowed.has(category));
        return clean.length ? clean : fallback;
    }
}

export default DataService;
