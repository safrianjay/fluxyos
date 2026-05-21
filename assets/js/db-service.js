import { getFirestore, collection, query, where, getDocs, getDoc, setDoc, addDoc, updateDoc, serverTimestamp, orderBy, limit, writeBatch, doc, Timestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
        return await addDoc(collection(this.db, `users/${userId}/bills`), {
            ...rest,
            timestamp: timestamp || serverTimestamp()
        });
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

    // --- RECEIPTS ---
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
        const payload = this._cleanDefined({
            business_name: this._stringOrDefault(data.business_name, '', 120),
            role: this._allowedValue(data.role,
                ['Owner / Founder', 'Finance admin', 'Accountant', 'Operations manager', 'Staff'],
                'Owner / Founder'),
            main_goal: this._stringOrDefault(data.main_goal, '', 160),
            monthly_revenue_range: this._stringOrDefault(data.monthly_revenue_range, '', 80),
            employee_count_range: this._stringOrDefault(data.employee_count_range, '', 80),
            legal_full_name: this._stringOrDefault(data.legal_full_name, '', 120),
            phone_number: this._nullableString(data.phone_number, 32),
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
        const selectedAction = this._allowedValue(payload.selected_first_action,
            ['csv_upload', 'add_transaction', 'add_bill', 'sample_data'],
            'csv_upload');
        await setDoc(this._onboardingDoc(userId, 'progress'), {
            onboarding_completed: true,
            onboarding_exempt: false,
            eligible_for_onboarding_gate: false,
            current_step: 'complete',
            selected_first_action: selectedAction,
            source: 'onboarding_v2',
            completed_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        await this.addAuditLog(userId, {
            action: 'onboarding.submit',
            target_collection: 'onboarding',
            target_id: 'progress',
            after: { onboarding_completed: true, selected_first_action: selectedAction },
            source: 'onboarding'
        });
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
    async getDashboardStats(userId, period = null) {
        const txs = await this.getTransactions(userId, 1000);
        const filteredTxs = period?.start && period?.end
            ? txs.filter(tx => this._isTransactionInPeriod(tx, period.start, period.end))
            : txs;
        let revenue = 0;
        let opex = 0;

        filteredTxs.forEach(tx => {
            const type = String(tx.type || '').toLowerCase();
            if (['revenue', 'income', 'refund', 'pending_receivable'].includes(type)) revenue += tx.amount;
            else if (['expense', 'fee', 'tax', 'pending_payable'].includes(type)) opex += Math.abs(tx.amount);
        });

        const margin = revenue > 0 ? ((revenue - opex) / revenue) * 100 : 0;

        return {
            revenue: revenue,
            opex: opex,
            margin: margin,
            revenue_change: "0%", // Placeholder for growth calculation
            action_items_count: filteredTxs.filter(t => t.status === 'Missing Receipt').length
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
        if (tx.timestamp && typeof tx.timestamp.toDate === 'function') return tx.timestamp.toDate();
        if (tx.timestamp instanceof Date) return tx.timestamp;
        if (typeof tx.timestamp === 'string' || typeof tx.timestamp === 'number') {
            const parsed = new Date(tx.timestamp);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
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
                categories: ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS']
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
