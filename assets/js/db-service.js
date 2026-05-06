import { getFirestore, collection, query, where, getDocs, addDoc, serverTimestamp, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
        return await addDoc(collection(this.db, `users/${userId}/transactions`), {
            ...data,
            timestamp: serverTimestamp()
        });
    }

    // --- BILLS ---
    async addBill(userId, data) {
        return await addDoc(collection(this.db, `users/${userId}/bills`), {
            ...data,
            timestamp: serverTimestamp()
        });
    }

    async getBills(userId) {
        const q = query(collection(this.db, `users/${userId}/bills`), orderBy('dueDate', 'asc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // --- SUBSCRIPTIONS ---
    async addSubscription(userId, data) {
        return await addDoc(collection(this.db, `users/${userId}/subscriptions`), {
            ...data,
            timestamp: serverTimestamp()
        });
    }

    async getSubscriptions(userId) {
        const q = query(collection(this.db, `users/${userId}/subscriptions`), orderBy('amount', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // --- SUMMARY STATS ---
    async getDashboardStats(userId) {
        const txs = await this.getTransactions(userId, 1000);
        let revenue = 0;
        let opex = 0;

        txs.forEach(tx => {
            if (tx.type === 'revenue') revenue += tx.amount;
            else opex += Math.abs(tx.amount);
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
