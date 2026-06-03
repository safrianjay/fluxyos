import { getFirestore, collection, query, where, getDocs, getDoc, setDoc, addDoc, updateDoc, serverTimestamp, orderBy, limit, writeBatch, doc, Timestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { BILLING_PLANS, calculateBilling, normalizeBillingFrequency, normalizePaymentMethod, normalizePlanId } from "./billing-config.js";

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

class DataService {
    constructor(app) {
        this.app = app;
        this.db = getFirestore(app);
        this._storage = null;
    }

    // --- TRANSACTIONS (LEDGER) ---
    async getTransactions(userId, limitCount = 50) {
        const q = query(
            collection(this.db, `users/${userId}/transactions`),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async getRevenueTransactionsForDashboardStats(userId) {
        const q = query(
            collection(this.db, `users/${userId}/transactions`),
            where('type', 'in', ['income', 'revenue', 'refund', 'pending_receivable'])
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async getTransactionsForDashboardOverview(userId, allTime = false) {
        if (!allTime) return this.getTransactions(userId, 1000);
        const q = query(
            collection(this.db, `users/${userId}/transactions`),
            orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async addTransaction(userId, data) {
        const { timestamp, ...rest } = data;
        return await addDoc(collection(this.db, `users/${userId}/transactions`), {
            ...rest,
            timestamp: timestamp || serverTimestamp(),
            created_at: serverTimestamp()
        });
    }

    async addTransactions(userId, rows) {
        const batch = writeBatch(this.db);
        const txCollection = collection(this.db, `users/${userId}/transactions`);
        const uploadedAt = serverTimestamp();

        rows.forEach(row => {
            const { timestamp, ...rest } = row;
            batch.set(doc(txCollection), {
                ...rest,
                timestamp: timestamp || serverTimestamp(),
                created_at: uploadedAt
            });
        });

        await batch.commit();
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
        return await addDoc(collection(this.db, `users/${userId}/bills`), payload);
    }

    async getBills(userId) {
        const q = query(collection(this.db, `users/${userId}/bills`), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // --- SUBSCRIPTIONS ---
    async addSubscription(userId, data) {
        const { timestamp, ...rest } = data;
        return await addDoc(collection(this.db, `users/${userId}/subscriptions`), {
            ...rest,
            timestamp: timestamp || serverTimestamp()
        });
    }

    async getSubscriptions(userId) {
        const q = query(collection(this.db, `users/${userId}/subscriptions`), orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // --- SETTINGS ---
    async getUserSettings(userId) {
        const docIds = ['company', 'finance', 'import_rules', 'ai', 'whatsapp'];
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
        const { getStorage, ref, uploadBytes, getDownloadURL } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);
        const path = `users/${userId}/receipts/${Date.now()}-${file.name}`;
        const snap = await uploadBytes(ref(this._storage, path), file, { contentType: file.type || 'image/jpeg' });
        return getDownloadURL(snap.ref);
    }

    async updateTransactionReceipt(userId, txId, receiptUrl) {
        await updateDoc(doc(this.db, `users/${userId}/transactions/${txId}`), {
            receipt_url: receiptUrl,
            status: 'Completed'
        });
    }

    // --- DOCUMENTS (Phase 1 shared attachment) ---
    // Uploads a file to users/{uid}/documents/{documentId}/{fileName}, returning
    // the allocated documentId, storage_path, and (for images only) a public
    // download URL for the legacy `receipt_url` dual-write on transactions.
    async uploadDocument(userId, file) {
        const { getStorage, ref, uploadBytes, getDownloadURL } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);

        const documentRef = doc(collection(this.db, `users/${userId}/documents`));
        const documentId = documentRef.id;
        const safeName = String(file.name || 'document').replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'document';
        const storagePath = `users/${userId}/documents/${documentId}/${safeName}`;
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
        const docRef = doc(this.db, `users/${userId}/documents/${documentId}`);
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
        const docMetaRef = doc(this.db, `users/${userId}/documents/${documentId}`);
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
        const recordRef = doc(this.db, `users/${userId}/${targetCollection}/${targetId}`);
        const update = { attached_documents: arrayUnion(attachment) };
        if (targetCollection === 'bills') update.invoice_status = 'attached';
        await updateDoc(recordRef, update);

        // Link metadata back to the record it was attached to.
        const docMetaRef = doc(this.db, `users/${userId}/documents/${attachment.document_id}`);
        await updateDoc(docMetaRef, {
            target_collection: targetCollection,
            target_id: targetId,
            updated_at: serverTimestamp()
        });
    }

    async updateTransactionType(userId, txId, newType, newIcon) {
        await updateDoc(doc(this.db, `users/${userId}/transactions/${txId}`), {
            type: newType,
            icon: newIcon
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

    // --- REPORTS & EXPORTS ---
    // Period-scoped fetchers. startKey / endKey are 'YYYY-MM-DD' day keys
    // (inclusive on both ends, interpreted in the client's local timezone).
    async getTransactionsForPeriod(userId, startKey, endKey) {
        return this._getRecordsForPeriod(userId, 'transactions', startKey, endKey);
    }

    async getBillsForPeriod(userId, startKey, endKey) {
        return this._getRecordsForPeriod(userId, 'bills', startKey, endKey);
    }

    async getSubscriptionsForPeriod(userId, startKey, endKey) {
        return this._getRecordsForPeriod(userId, 'subscriptions', startKey, endKey);
    }

    async _getRecordsForPeriod(userId, collectionName, startKey, endKey) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return [];
        const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
        try {
            const q = query(
                collection(this.db, `users/${userId}/${collectionName}`),
                where('timestamp', '>=', Timestamp.fromDate(start)),
                where('timestamp', '<', Timestamp.fromDate(endExclusive)),
                orderBy('timestamp', 'desc'),
                limit(1000)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            // Fallback for missing/legacy timestamp indexing: client-side filter.
            const q = query(
                collection(this.db, `users/${userId}/${collectionName}`),
                orderBy('timestamp', 'desc'),
                limit(1000)
            );
            const snapshot = await getDocs(q);
            return snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => this._isTransactionInPeriod(r, startKey, endKey));
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
            created_by: userId
        };
        // Optional YTD/YoY scope metadata. The firestore rule allows the field
        // to be absent — only include it when supplied.
        if (data.report_scope && typeof data.report_scope === 'object') {
            payload.report_scope = data.report_scope;
        }
        return await addDoc(collection(this.db, `users/${userId}/report_exports`), payload);
    }

    async getRecentReportExports(userId, limitCount = 10) {
        const q = query(
            collection(this.db, `users/${userId}/report_exports`),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // --- AUDIT LOGS ---
    async addAuditLog(userId, data) {
        return await addDoc(collection(this.db, `users/${userId}/audit_logs`), {
            actor_uid: userId,
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
            collection(this.db, `users/${userId}/audit_logs`),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

    async getInternalAuditLogs(limitCount = 100) {
        const q = query(
            collection(this.db, 'internal_audit_logs'),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
        const payload = this._cleanDefined({ ...statusPayload, updated_at: serverTimestamp() });
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
        const profileFields = this._cleanDefined({
            email: this._nullableString(opts.email, 160),
            display_name: this._nullableString(opts.display_name, 160),
            business_name: profile ? this._nullableString(profile.business_name, 120) : undefined,
            role: profile ? this._nullableString(profile.role, 80) : undefined,
            phone_number: profile ? this._nullableString(phoneParts || null, 40) : undefined,
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

    async upsertBillingSubscription(userId, subscriptionData = {}) {
        if (!userId) throw new Error('missing-user');
        const payload = this._cleanDefined({
            ...subscriptionData,
            updated_at: serverTimestamp()
        });
        await setDoc(this._billingSubscriptionDoc(userId), payload, { merge: true });
        return payload;
    }

    async createPaymentRequest(userId, paymentData = {}) {
        if (!userId) throw new Error('missing-user');
        if (!BILLING_PLANS[paymentData.plan_id]) throw new Error('invalid-plan');
        if (!['monthly', 'annually'].includes(paymentData.billing_frequency)) throw new Error('invalid-billing-frequency');
        const planId = normalizePlanId(paymentData.plan_id);
        const billingFrequency = normalizeBillingFrequency(paymentData.billing_frequency);
        const paymentMethod = normalizePaymentMethod(paymentData.payment_method);
        if (!paymentMethod) throw new Error('invalid-payment-method');

        const calculation = calculateBilling(planId, billingFrequency);
        // QRIS uses a manual "pay the QR first" step: the request starts as
        // awaiting_payment and only moves to pending_verification after the user
        // confirms payment on the QR screen. Other methods submit for verification
        // immediately (unchanged behavior).
        const paymentStatus = paymentMethod === 'qris' ? 'awaiting_payment' : 'pending_verification';
        const currentSubscription = await this.getBillingSubscription(userId);
        const requestRef = doc(this._billingPaymentRequestsCol(userId));
        const auditRef = doc(collection(this.db, `users/${userId}/audit_logs`));
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
            updated_at: serverTimestamp()
        };

        batch.set(requestRef, requestPayload);
        batch.set(this._billingSubscriptionDoc(userId), {
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
        });
        batch.set(auditRef, {
            actor_uid: userId,
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
        return { id: requestRef.id, ...requestPayload };
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
        const auditRef = doc(collection(this.db, `users/${userId}/audit_logs`));
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

        batch.set(this._billingSubscriptionDoc(userId), {
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
        });

        batch.set(auditRef, {
            actor_uid: userId,
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
        return { ...request, ...requestUpdate, payment_status: 'pending_verification' };
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

    async ensureBillingSubscription(userId) {
        if (!userId) return null;
        const current = await this.getBillingSubscription(userId);
        if (current) return this.expireBillingSubscriptionIfNeeded(userId, current);

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
        const overdueBills = bills.filter(bill => this._isBeforeToday(this._getRecordDate(bill, 'due_date'), now));
        const billsDueSoon = bills.filter(bill => this._isInUpcomingWindow(this._getRecordDate(bill, 'due_date'), now, attentionEnd, period.startDate, period.endDate));
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
            })
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
            collection(this.db, `users/${userId}/bank_accounts`),
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
        const accountRef = await addDoc(collection(this.db, `users/${userId}/bank_accounts`), payload);

        await addDoc(collection(this.db, `users/${userId}/bank_balance_snapshots`), {
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

        const accountRef = doc(this.db, `users/${userId}/bank_accounts/${accountId}`);
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

        await addDoc(collection(this.db, `users/${userId}/bank_balance_snapshots`), {
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
        const accountRef = doc(this.db, `users/${userId}/bank_accounts/${accountId}`);
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
            const q = query(collection(this.db, `users/${userId}/bank_balance_snapshots`), ...constraints);
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (_) {
            const q = query(
                collection(this.db, `users/${userId}/bank_balance_snapshots`),
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
        const ref = await addDoc(collection(this.db, `users/${userId}/bank_statement_imports`), payload);

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
        const snap = await getDoc(doc(this.db, `users/${userId}/bank_statement_imports/${importId}`));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    async listBankStatementImports(userId, limitCount = 25) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `users/${userId}/bank_statement_imports`),
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
        const ref = doc(this.db, `users/${userId}/bank_statement_imports/${importId}`);
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
        const rowsCol = collection(this.db, `users/${userId}/bank_statement_imports/${importId}/rows`);
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
                collection(this.db, `users/${userId}/bank_statement_imports/${importId}/rows`),
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
        const { getStorage, ref, uploadBytes } =
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        if (!this._storage) this._storage = getStorage(this.app);

        const safeName = String(file.name || 'bank_statement')
            .replace(/[^\w.\-]+/g, '_')
            .slice(0, 200) || 'bank_statement';
        const storagePath = `users/${userId}/bank_statement_imports/${importId}/${safeName}`;
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

    async archiveBudget(userId, budgetId, reason = null) {
        if (!userId || !budgetId) throw new Error('userId and budgetId required');
        const ref = doc(this.db, `users/${userId}/budgets/${budgetId}`);
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
                collection(this.db, `users/${userId}/budgets`),
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
        const snap = await getDoc(doc(this.db, `users/${userId}/budgets/${budgetId}`));
        if (!snap.exists()) return null;
        return this._normalizeBudgetRecord({ id: snap.id, ...snap.data() });
    }

    async getBudgets(userId, limitCount = 200) {
        if (!userId) return [];
        try {
            const q = query(
                collection(this.db, `users/${userId}/budgets`),
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
                    collection(this.db, `users/${userId}/budgets`),
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
            await updateDoc(doc(this.db, `users/${userId}/budgets/${existing.id}`), payload);
        } else {
            const ref = await addDoc(collection(this.db, `users/${userId}/budgets`), {
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
                collection(this.db, `users/${userId}/budget_allocations`),
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
                    collection(this.db, `users/${userId}/budget_allocations`),
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
        const snap = await getDoc(doc(this.db, `users/${userId}/budget_allocations/${allocationId}`));
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
            budgetRef = doc(this.db, `users/${userId}/budgets/${existing.id}`);
        } else {
            budgetRef = doc(collection(this.db, `users/${userId}/budgets`));
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
            const ref = doc(this.db, `users/${userId}/budget_allocations/${prev.id}`);
            batch.update(ref, {
                status: 'archived',
                updated_at: serverTimestamp()
            });
        });

        const allocationsCol = collection(this.db, `users/${userId}/budget_allocations`);
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
            batch.update(doc(this.db, `users/${userId}/budget_allocations/${alloc.id}`), {
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
        const budgetRef = doc(this.db, `users/${userId}/budgets/${budgetId}`);
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
                collection(this.db, `users/${userId}/audit_logs`),
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

        const ref = doc(this.db, `users/${userId}/${targetCollection}/${recordId}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Record not found.');
        const existing = snap.data() || {};
        const before = this._budgetSnapshot(existing);

        // Always set the assignment trace fields.
        const payload = {
            ...updateFields,
            budget_assignment_reason: cleanReason,
            budget_assignment_updated_at: serverTimestamp(),
            budget_assignment_updated_by: userId
        };

        const batch = writeBatch(this.db);
        batch.update(ref, payload);
        const auditRef = doc(collection(this.db, `users/${userId}/audit_logs`));
        batch.set(auditRef, {
            actor_uid: userId,
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

    _formatCashFlowLabel(startKey, endKey, bucketType) {
        const start = this._parseDayKey(startKey);
        const end = this._parseDayKey(endKey);
        if (!start || !end) return '';
        if (bucketType === 'month') return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        if (startKey === endKey) return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
            return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
        }
        return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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
