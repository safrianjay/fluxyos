import { getFirestore, collection, query, getDocs, addDoc, updateDoc, serverTimestamp, orderBy, limit, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
}

export default DataService;
