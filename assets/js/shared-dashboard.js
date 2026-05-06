/**
 * Shared Dashboard Utilities
 */

window.renderEmptyState = function(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defaultConfig = {
        title: "No Data Found",
        description: "Start by adding your first record to see the engine in motion.",
        buttonText: "Add Record",
        onAction: () => console.log("Action clicked"),
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
