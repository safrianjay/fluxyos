/**
 * Global Transaction Modal
 */
window.showAddTransactionModal = function() {
    if (document.getElementById('global-tx-modal')) {
        document.getElementById('global-tx-modal').classList.remove('hidden');
        document.getElementById('global-tx-modal').classList.add('flex');
        return;
    }

    const modalHTML = `
        <div id="global-tx-modal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0B0F19]/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-300">
                <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h3 class="text-lg font-bold text-gray-900">Add Transaction</h3>
                    <button onclick="window.closeAddTransactionModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <form id="global-tx-form" class="p-6 space-y-5">
                    <div>
                        <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Amount (Rp)</label>
                        <input type="number" id="tx-amount" required placeholder="0" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#E85D19] focus:border-[#E85D19] outline-none font-mono font-bold text-lg">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Vendor / Description</label>
                        <input type="text" id="tx-vendor" required placeholder="e.g. AWS, Client Payment" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Category</label>
                            <select id="tx-category" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                <option value="Revenue">Revenue</option>
                                <option value="Marketing">Marketing</option>
                                <option value="Infrastructure">Infrastructure</option>
                                <option value="Operations">Operations</option>
                                <option value="SaaS">SaaS</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Type</label>
                            <select id="tx-type" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E85D19]">
                                <option value="expense">Expense</option>
                                <option value="revenue">Revenue</option>
                            </select>
                        </div>
                    </div>
                    <button type="submit" id="tx-submit-btn" class="w-full py-4 bg-[#E85D19] hover:bg-[#D44400] text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                        <span>Add Transaction</span>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </button>
                </form>
            </div>
        </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHTML;
    document.body.appendChild(wrapper);

    // Form Submission
    document.getElementById('global-tx-form').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('tx-submit-btn');
        btn.disabled = true;
        btn.innerText = "Deploying...";

        try {
            const data = {
                amount: parseFloat(document.getElementById('tx-amount').value),
                vendor_name: document.getElementById('tx-vendor').value,
                category: document.getElementById('tx-category').value,
                type: document.getElementById('tx-type').value,
                status: 'Completed',
                icon: document.getElementById('tx-type').value === 'revenue' ? '💰' : '💸'
            };

            // Initialize Firebase if not already done
            const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
            const firebaseConfig = {
                apiKey: "AIzaSyCaJqmpEMulLdMvRT7mYf2K-XDw46-dT7A",
                authDomain: "fluxyos.firebaseapp.com",
                projectId: "fluxyos",
                storageBucket: "fluxyos.firebasestorage.app",
                messagingSenderId: "1084252368929",
                appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
            };
            
            let app;
            if (getApps().length === 0) app = initializeApp(firebaseConfig);
            else app = getApps()[0];

            const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(app);
            const user = auth.currentUser;

            if (user) {
                const { default: DataService } = await import('./db-service.js');
                const ds = new DataService(app); 
                await ds.addTransaction(user.uid, data);
                
                window.closeAddTransactionModal();
                if (window.loadDashboard) window.loadDashboard();
                if (window.loadLedger) window.loadLedger();
            } else {
                alert("Session expired. Please log in again.");
            }
        } catch (err) {
            console.error(err);
            if (err.code === 'permission-denied') {
                alert("Permission Denied: Please ensure Firestore is enabled in your Firebase Console and rules are set to allow authenticated users.");
            } else {
                alert("Error deploying transaction: " + err.message);
            }
        } finally {
            btn.disabled = false;
            btn.innerText = "Add Transaction";
        }
    };
};

window.closeAddTransactionModal = function() {
    const modal = document.getElementById('global-tx-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.renderEmptyState = function(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defaultConfig = {
        title: "No Data Found",
        description: "Start by adding your first record to see the engine in motion.",
        buttonText: "Add Record",
        onAction: () => window.showAddTransactionModal(),
        icon: `<svg class="w-8 h-8 text-[#E85D19]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>`
    };

    const c = { ...defaultConfig, ...config };

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 text-center px-6 animate-in fade-in duration-700">
            <div class="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-6 shadow-sm border border-orange-100">
                ${c.icon}
            </div>
            <h3 class="text-xl font-bold text-gray-900 mb-2 tracking-tight">${c.title}</h3>
            <p class="text-[14px] text-gray-500 max-w-[320px] leading-relaxed mb-8">${c.description}</p>
            <button id="empty-state-action" class="inline-flex items-center gap-2 bg-[#E85D19] hover:bg-[#D44400] text-white font-bold text-[13px] px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                ${c.buttonText}
            </button>
        </div>
    `;

    document.getElementById('empty-state-action').onclick = c.onAction;
};

// Global toggle for Fluxy AI (Drawer)
window.toggleFluxyAI = (state) => {
    if (window.toggleAI) window.toggleAI(state);
    else console.warn("AI Chat not loaded yet");
};
