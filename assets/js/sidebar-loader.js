(function() {
    const sidebarHTML = `
        <!-- Logo Area -->
        <div class="logo-area h-16 flex items-center justify-between px-6 border-b border-gray-800/60 bg-[#0B0F19] sticky top-0 z-10">
            <div class="flex items-center gap-3 cursor-pointer group" onclick="window.location.href='fluxyos.html'">
                <div class="w-7 h-7 text-[#EA580C] shadow-sm flex-shrink-0">
                    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
                        <rect width="40" height="40" rx="8" fill="currentColor" />
                        <g transform="translate(1.5, 0)">
                            <path d="M 7 6 L 33 6 L 27 12 L 13 12 L 13 34 L 7 34 Z" fill="#FFFFFF" />
                            <path d="M 17 18 L 27 18 L 21 24 L 17 24 Z" fill="#FFFFFF" />
                        </g>
                    </svg>
                </div>
                <span class="logo-text font-bold text-lg tracking-tight text-white">FluxyOS</span>
            </div>
            
            <button id="sidebar-toggle" class="toggle-btn p-1.5 text-gray-500 hover:text-white rounded-md hover:bg-gray-800 transition-colors">
                <svg class="toggle-icon w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>
            </button>
        </div>

        <!-- Navigation Menu -->
        <div class="flex-1 overflow-y-auto py-6 px-3 space-y-1.5">
            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Platform</p>
            
            <a href="dashboard.html" id="nav-overview" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                <span class="sidebar-text text-[13px]">Overview</span>
            </a>
            
            <a href="#" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20"></path></svg>
                <span class="sidebar-text text-[13px]">Ledger & Transactions</span>
                <span class="nav-badge ml-auto bg-gray-800 text-gray-300 text-[10px] px-2 py-0.5 rounded-full font-mono">12</span>
            </a>

            <a href="bill.html" id="nav-bills" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="sidebar-text text-[13px]">Bills</span>
                <span class="nav-badge ml-auto bg-[#EA580C]/20 text-[#EA580C] text-[10px] px-2 py-0.5 rounded-full font-bold">12</span>
            </a>

            <a href="#" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="sidebar-text text-[13px]">Vendors & Subscriptions</span>
            </a>

            <a href="#" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path></svg>
                <span class="sidebar-text text-[13px]">Revenue & Ad Sync</span>
            </a>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2">Network</p>

            <a href="#" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                <span class="sidebar-text text-[13px]">Multi-Entity Map</span>
            </a>
            
            <a href="#" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l-4 4-4 4M6 16l-4-4 4-4"></path></svg>
                <span class="sidebar-text text-[13px]">Integrations</span>
            </a>
        </div>

        <!-- User Profile (Bottom) -->
        <div class="p-4 border-t border-gray-800/60 bg-[#0B0F19]">
            <a href="#" class="flex items-center gap-3 hover:bg-gray-800/50 p-2 rounded-lg transition-colors cursor-pointer nav-item">
                <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#F97316] text-white flex items-center justify-center font-bold shadow-sm flex-shrink-0">
                    SJ
                </div>
                <div class="flex-1 min-w-0 user-info">
                    <p class="text-[13px] font-bold text-white truncate">Safrian Jayadi</p>
                    <p class="text-[11px] text-gray-500 truncate">Workspace Owner</p>
                </div>
                <svg class="user-chevron w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"></path></svg>
            </a>
        </div>
    `;

    function inject() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = sidebarHTML;
        sidebar.style.display = 'flex';

        // Highlight Active
        const path = window.location.pathname;
        if (path.includes('dashboard.html')) {
            const el = document.getElementById('nav-overview');
            if (el) el.classList.add('bg-[#1A1F26]', 'text-white', 'border', 'border-gray-700/50', 'shadow-sm');
            const icon = el?.querySelector('svg');
            if (icon) icon.classList.add('text-[#EA580C]');
        } else if (path.includes('bill.html')) {
            const el = document.getElementById('nav-bills');
            if (el) el.classList.add('bg-[#1A1F26]', 'text-white', 'border', 'border-gray-700/50', 'shadow-sm');
            const icon = el?.querySelector('svg');
            if (icon) icon.classList.add('text-[#EA580C]');
        }

        // Re-bind toggle
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.onclick = () => sidebar.classList.toggle('collapsed');
        }
    }

    // Try immediately
    inject();
    // Also try on load just in case
    window.addEventListener('load', inject);
})();
