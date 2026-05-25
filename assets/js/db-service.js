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
    async getDashboardOverview(userId, options = {}) {
        const period = this._normalizeOverviewPeriod(options);
        const previousPeriod = this._getPreviousOverviewPeriod(period);
        const sourceStatus = {
            transactions: 'loaded',
            bills: 'loaded',
            subscriptions: 'loaded'
        };
        const limitations = [];

        const [txResult, billsResult, subsResult] = await Promise.allSettled([
            this.getTransactions(userId, 1000),
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

        const periodTransactions = transactions.filter(tx => this._isTransactionInPeriod(tx, period.startDate, period.endDate));
        const previousTransactions = transactions.filter(tx => this._isTransactionInPeriod(tx, previousPeriod.startDate, previousPeriod.endDate));
        const performance = this._calculateOverviewPerformance(periodTransactions);
        const previousPerformance = this._calculateOverviewPerformance(previousTransactions);
        const hasPreviousPeriodData = previousTransactions.length > 0;
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
        if (!userId) return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null };
        try {
            const accounts = await this.getBankAccounts(userId);
            if (!accounts.length) {
                return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null };
            }
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
                sourceType
            };
        } catch (_) {
            return { balance: 0, accountsSynced: 0, syncedAt: null, sourceType: null };
        }
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
    async getActiveBudget(userId) {
        try {
            const q = query(
                collection(this.db, `users/${userId}/budgets`),
                where('status', '==', 'active'),
                orderBy('created_at', 'desc'),
                limit(1)
            );
            const snapshot = await getDocs(q);
            if (snapshot.empty) return null;
            const docSnap = snapshot.docs[0];
            return { id: docSnap.id, ...docSnap.data() };
        } catch (_) {
            // Fallback when composite index is unavailable.
            try {
                const q = query(
                    collection(this.db, `users/${userId}/budgets`),
                    orderBy('created_at', 'desc'),
                    limit(10)
                );
                const snapshot = await getDocs(q);
                const active = snapshot.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .find(b => b.status === 'active');
                return active || null;
            } catch {
                return null;
            }
        }
    }

    async setActiveBudget(userId, data) {
        const total = Math.round(Math.max(0, Number(data.total_budget) || 0));
        const periodType = ['monthly', 'quarterly', 'yearly'].includes(data.period_type)
            ? data.period_type
            : 'monthly';
        const startDate = this._coerceTimestampOrNow(data.period_start);
        const endDate = this._coerceTimestampOrNow(data.period_end);

        const existing = await this.getActiveBudget(userId);
        const payload = {
            name: this._stringOrDefault(data.name, 'OpEx budget', 120),
            period_type: periodType,
            period_start: startDate,
            period_end: endDate,
            currency: 'IDR',
            total_budget: total,
            status: 'active',
            updated_at: serverTimestamp()
        };
        const categoryBudgets = this._normalizeCategoryBudgets(data.category_budgets);
        if (categoryBudgets) payload.category_budgets = categoryBudgets;

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

    _getPreviousOverviewPeriod(period) {
        const start = this._parseDayKey(period.startDate);
        const end = this._parseDayKey(period.endDate);
        if (!start || !end) return { startDate: period.startDate, endDate: period.endDate };

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
