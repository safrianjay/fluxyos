import { getFirestore, collection, query, getDocs, getDoc, setDoc, addDoc, updateDoc, serverTimestamp, orderBy, limit, writeBatch, doc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

        return entries.reduce((settings, [docId, data]) => {
            settings[docId] = { ...this._defaultSettings(docId), ...data };
            return settings;
        }, {});
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
