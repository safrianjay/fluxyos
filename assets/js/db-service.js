import { getFirestore, collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, limit, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

class DataService {
    constructor(app) {
        this.db = getFirestore(app);
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
            timestamp: timestamp || serverTimestamp()
        });
    }

    async addTransactions(userId, rows) {
        const batch = writeBatch(this.db);
        const txCollection = collection(this.db, `users/${userId}/transactions`);

        rows.forEach(row => {
            const { timestamp, ...rest } = row;
            batch.set(doc(txCollection), {
                ...rest,
                timestamp: timestamp || serverTimestamp()
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

    // --- SUMMARY STATS ---
    async getDashboardStats(userId) {
        const txs = await this.getTransactions(userId, 1000);
        let revenue = 0;
        let opex = 0;

        txs.forEach(tx => {
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
            action_items_count: txs.filter(t => t.status === 'Missing Receipt').length
        };
    }
}

export default DataService;
