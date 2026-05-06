document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = '/api/v1';

    // Elements
    const kpiRevenue = document.getElementById('kpi-revenue');
    const kpiRevenueChange = document.getElementById('kpi-revenue-change');
    const kpiOpex = document.getElementById('kpi-opex');
    const kpiMargin = document.getElementById('kpi-margin');
    const kpiMarginBar = document.getElementById('kpi-margin-bar');
    const kpiActionCount = document.getElementById('kpi-action-count');
    const kpiActionDetails = document.getElementById('kpi-action-details');
    const ledgerBody = document.getElementById('ledger-body');
    const chatInput = document.getElementById('brain-chat-input');
    const chatSubmit = document.getElementById('brain-chat-submit');

    // Fetch Dashboard Summary
    async function fetchSummary() {
        try {
            const response = await fetch(`${API_BASE}/dashboard/summary`);
            const data = await response.json();
            
            if (kpiRevenue) kpiRevenue.textContent = data.revenue;
            if (kpiRevenueChange) kpiRevenueChange.textContent = data.revenue_change;
            if (kpiOpex) kpiOpex.textContent = data.opex;
            if (kpiMargin) kpiMargin.textContent = `${data.margin.toFixed(1)}%`;
            if (kpiMarginBar) kpiMarginBar.style.width = `${data.margin}%`;
            if (kpiActionCount) kpiActionCount.textContent = `${data.action_items_count} Items`;
            if (kpiActionDetails) kpiActionDetails.textContent = data.action_items_details;
        } catch (error) {
            console.error('Error fetching summary:', error);
        }
    }

    // Fetch Ledger
    async function fetchLedger() {
        try {
            const response = await fetch(`${API_BASE}/dashboard/ledger`);
            const data = await response.json();
            
            if (!ledgerBody) return;
            
            ledgerBody.innerHTML = data.map(tx => `
                <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                    <td class="px-5 py-3.5">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-[12px] shadow-sm">
                                ${tx.icon}
                            </div>
                            <div>
                                <p class="font-bold text-gray-900">${tx.vendor_name}</p>
                                <p class="text-[11px] text-gray-500">${new Date(tx.timestamp).toLocaleString()}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-5 py-3.5">
                        <span class="${tx.category_name === 'Revenue' ? 'bg-gray-100 text-gray-600' : 'bg-[#FFEDD5] text-[#C2410C]'} px-2 py-0.5 rounded text-[11px] font-bold">
                            ${tx.category_name}
                        </span>
                    </td>
                    <td class="px-5 py-3.5 text-gray-600 text-[12px] font-medium">${tx.entity_name}</td>
                    <td class="px-5 py-3.5 text-right font-mono font-bold ${tx.amount > 0 ? 'text-green-600' : 'text-gray-900'}">
                        ${tx.amount > 0 ? '+' : ''}Rp ${Math.abs(tx.amount).toLocaleString()}
                    </td>
                    <td class="px-5 py-3.5 text-right">
                        <span class="inline-flex items-center gap-1.5 ${tx.status === 'Missing Receipt' ? 'text-red-500 bg-red-50 px-2 py-1 rounded text-[10px]' : 'text-green-600 text-[11px]'} font-bold">
                            ${tx.status}
                        </span>
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            console.error('Error fetching ledger:', error);
        }
    }

    // AI Brain Chat
    async function handleChat() {
        const message = chatInput.value.trim();
        if (!message) return;

        chatInput.value = 'Thinking...';
        chatInput.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/brain/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            const data = await response.json();
            
            // For now, we'll just alert or log the response
            // In a real UI, this would update the chat history
            alert(`FluxyOS Brain: ${data.response}\n\nSuggested: ${data.suggested_action || 'N/A'}`);
            chatInput.value = '';
        } catch (error) {
            console.error('Error in Brain chat:', error);
            chatInput.value = message;
        } finally {
            chatInput.disabled = false;
        }
    }

    if (chatSubmit) chatSubmit.addEventListener('click', handleChat);
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleChat();
        });
    }

    // Initial Load
    fetchSummary();
    fetchLedger();
});
