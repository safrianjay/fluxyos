(function() {
    // 1. Load Global Assets (AI Chat & CSS)
    const assets = [
        { type: 'link', rel: 'stylesheet', href: 'assets/css/ai-chat.css' },
        { type: 'script', src: 'assets/js/ai-chat.js' }
    ];

    assets.forEach(asset => {
        if (!document.querySelector(`[href="${asset.href}"]`) && !document.querySelector(`[src="${asset.src}"]`)) {
            if (asset.type === 'link') {
                const el = document.createElement('link');
                el.rel = asset.rel;
                el.href = asset.href;
                document.head.appendChild(el);
            } else {
                const el = document.createElement('script');
                el.src = asset.src;
                document.body.appendChild(el);
            }
        }
    });

    const sidebarHTML = `
        <!-- Logo Area (Official Login Page Logo) -->
        <div class="logo-area h-16 flex items-center px-4 border-b border-slate-200 bg-white sticky top-0 z-10" id="sidebar-header">
            <div id="logo-container" class="flex items-center gap-3 cursor-pointer group overflow-hidden w-full">
                <div class="w-9 h-9 text-[#F3F6FA] flex-shrink-0" id="logo-icon">
                    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
                        <rect width="40" height="40" rx="8" fill="currentColor" />
                        <g transform="translate(1.5, 0)">
                            <path d="M 7 6 L 33 6 L 27 12 L 13 12 L 13 34 L 7 34 Z" fill="#1E2F4A" />
                            <path d="M 17 18 L 27 18 L 21 24 L 17 24 Z" fill="#1E2F4A" />
                        </g>
                    </svg>
                </div>
                <span class="logo-text font-bold text-[18px] tracking-tight text-[#1E2F4A] transition-colors">FluxyOS</span>
            </div>
        </div>

        <!-- Entity Switcher (Global HQ) -->
        <div class="entity-switcher-wrap relative px-3 py-3 bg-white" id="entity-switcher-wrap">
            <button type="button" id="entity-switcher-btn"
                class="entity-switcher w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                aria-haspopup="listbox" aria-expanded="false">
                <span class="entity-status-dot w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></span>
                <span class="flex-1 min-w-0">
                    <span class="entity-name block text-[12px] font-semibold text-[#1E2F4A] truncate leading-tight">Global HQ</span>
                    <span class="entity-sub block text-[10px] text-slate-500 truncate leading-tight mt-0.5">Consolidated</span>
                </span>
                <svg class="entity-chevron w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="entity-switcher-menu" class="entity-menu hidden absolute left-3 right-3 top-[calc(100%-4px)] z-30 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden" role="listbox">
                <button type="button" class="entity-menu-item w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50" role="option" aria-selected="true">
                    <span class="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></span>
                    <span class="flex-1 min-w-0">
                        <span class="block text-[12px] font-semibold text-[#1E2F4A] truncate leading-tight">Global HQ</span>
                        <span class="block text-[10px] text-slate-500 truncate leading-tight">Consolidated</span>
                    </span>
                    <svg class="w-3 h-3 text-[#EA580C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                </button>
                <button type="button" class="entity-menu-add w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] text-slate-400 border-t border-slate-100 cursor-not-allowed" disabled>
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    Add entity
                    <span class="ml-auto text-[9px] font-semibold uppercase tracking-wide text-slate-400">Soon</span>
                </button>
            </div>
        </div>

        <!-- Divider sized to match the entity switcher (mx-3 mirrors the wrap's px-3) -->
        <div class="mx-3 border-b border-slate-200" id="entity-switcher-divider"></div>

        <!-- Navigation Menu -->
        <div class="flex-1 overflow-y-auto py-6 px-3 flex flex-col items-center sm:items-stretch" id="nav-container">
            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2 sidebar-hide">Command</p>

            <a href="/dashboard" id="nav-overview" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Overview</span>
            </a>

            <button type="button" id="nav-fluxy-ai" class="nav-item nav-item-action flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Fluxy AI</span>
            </button>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Money Movement</p>

            <a href="/ledger" id="nav-ledger" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Transactions</span>
            </a>

            <button type="button" id="nav-revenue-sync" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 17l6-6 4 4 8-8"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Revenue Sync</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <a href="/bill" id="nav-bills" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Bills</span>
            </a>

            <a href="/subscription" id="nav-subscriptions" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Subscriptions</span>
            </a>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Operations</p>

            <button type="button" id="nav-vendor-spend" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Vendor Spend</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <button type="button" id="nav-receipt-capture" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Receipt Capture</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <button type="button" id="nav-budgets" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-9-9v9z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Budgets</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <button type="button" id="nav-approvals" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Approvals</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Reporting</p>

            <button type="button" id="nav-reports" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3v18h18"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Reports & Exports</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <button type="button" id="nav-audit-log" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6M9 16h6"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Audit Log</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Workspace</p>

            <a href="/integration" id="nav-integrations" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l-4 4-4 4M6 16l-4-4 4-4"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Integrations</span>
            </a>

            <button type="button" id="nav-settings" class="nav-item nav-item-disabled flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 font-medium w-full justify-center lg:justify-start" disabled aria-disabled="true">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Settings</span>
                <span class="sidebar-soon-badge sidebar-hide">Soon</span>
            </button>
        </div>

        <!-- USER PROFILE & SIGNOUT (Bottom) -->
        <div class="p-4 border-t border-gray-800/60 bg-[#0B0F19] flex flex-col items-center lg:items-stretch" id="profile-area">
            <div class="flex items-center gap-3 p-2 rounded-lg mb-2 w-full justify-center lg:justify-start overflow-hidden">
                <img id="sidebar-user-avatar" src="https://ui-avatars.com/api/?name=User&background=EA580C&color=fff" alt="User" class="w-10 h-10 rounded-full border border-gray-700 flex-shrink-0">
                <div class="flex-1 min-w-0 sidebar-hide">
                    <p class="text-[13px] font-bold text-white truncate" id="sidebar-user-name">Loading...</p>
                    <p class="text-[11px] text-gray-500 truncate">Account Owner</p>
                </div>
            </div>
            <button id="logout-btn" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-500 font-medium transition-colors justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-4 lg:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                <span class="sidebar-text text-[12px] sidebar-hide">Sign Out</span>
            </button>
        </div>
    `;

    const dashboardLucideIcons = {
        'nav-overview': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
        'nav-ledger': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h10"/><path d="M3 12h8"/><path d="M3 18h6"/><circle cx="17" cy="18" r="3"/></svg>',
        'nav-fluxy-ai': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
        'nav-revenue-sync': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
        'nav-bills': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
        'nav-subscriptions': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/></svg>',
        'nav-vendor-spend': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 12h20"/></svg>',
        'nav-receipt-capture': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2z"/><path d="M16 8h-6"/><path d="M16 12H8"/><path d="M13 16H8"/></svg>',
        'nav-budgets': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/></svg>',
        'nav-approvals': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
        'nav-reports': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16V9"/><path d="M12 16V5"/><path d="M17 16v-3"/></svg>',
        'nav-audit-log': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
        'nav-integrations': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
        'nav-settings': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M9.67 2h4.66l.8 2.4 2.43 1 2.26-1.13 2.33 4.04-2.02 1.46.03 2.63 1.99 1.51-2.33 4.04-2.27-1.08-2.42 1-.8 2.13H9.67l-.8-2.13-2.42-1-2.27 1.08-2.33-4.04 1.99-1.51.03-2.63-2.02-1.46 2.33-4.04 2.26 1.13 2.43-1z"/><circle cx="12" cy="12" r="3"/></svg>',
        'logout-btn': '<svg class="sidebar-icon sidebar-logout-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>'
    };

    function applyAppSidebarTheme(sidebar) {
        sidebar.classList.add('app-sidebar-light');
        sidebar.classList.remove('w-[260px]', 'w-[240px]', 'w-[452px]', 'bg-[#0B0F19]', 'text-gray-300', 'border-gray-800');
        sidebar.classList.add('w-[220px]', 'bg-white', 'text-[#1E2F4A]', 'border-slate-200', 'rounded-tl-[8px]', 'overflow-hidden');

        Object.entries(dashboardLucideIcons).forEach(([id, svg]) => {
            const node = document.getElementById(id);
            const icon = node ? node.querySelector('svg') : null;
            if (icon) icon.outerHTML = svg;
        });
    }

    function inject() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = sidebarHTML;
        applyAppSidebarTheme(sidebar);

        // Entity Switcher dropdown
        const entityBtn = document.getElementById('entity-switcher-btn');
        const entityMenu = document.getElementById('entity-switcher-menu');
        if (entityBtn && entityMenu) {
            const closeMenu = () => {
                entityMenu.classList.add('hidden');
                entityBtn.setAttribute('aria-expanded', 'false');
            };
            entityBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = entityMenu.classList.toggle('hidden');
                entityBtn.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
            });
            document.addEventListener('click', (e) => {
                if (!entityMenu.contains(e.target) && !entityBtn.contains(e.target)) closeMenu();
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
        }

        // Highlight Active
        const path = window.location.pathname;
        const pageIdMap = {
            'dashboard': 'nav-overview',
            'ledger': 'nav-ledger',
            'bill': 'nav-bills',
            'subscription': 'nav-subscriptions',
            'integration': 'nav-integrations'
        };

        const activeId = Object.keys(pageIdMap).find(p => path.includes(p));
        if (activeId) {
            const el = document.getElementById(pageIdMap[activeId]);
            if (el) {
                el.classList.add('dashboard-active');
                const icon = el.querySelector('svg');
                if (icon) icon.classList.add('text-[#EA580C]');
            }
        }

        const fluxyAiButton = document.getElementById('nav-fluxy-ai');
        if (fluxyAiButton) {
            fluxyAiButton.onclick = () => {
                if (typeof window.toggleFluxyAI === 'function') {
                    window.toggleFluxyAI();
                }
            };
        }

        // Logout
        let logoutInFlight = false;
        document.getElementById('logout-btn').onclick = async (event) => {
            if (logoutInFlight) return;
            logoutInFlight = true;
            const logoutBtn = event.currentTarget;
            logoutBtn.disabled = true;
            logoutBtn.classList.add('cursor-not-allowed', 'opacity-70');
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth();
            try {
                await signOut(auth);
                window.location.href = '/login';
            } catch (error) {
                console.error('Sign out failed:', error);
                logoutInFlight = false;
                logoutBtn.disabled = false;
                logoutBtn.classList.remove('cursor-not-allowed', 'opacity-70');
            }
        };

        // Profile Sync
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js").then(async appMod => {
            const { getApps, initializeApp } = appMod;
            const firebaseConfig = {
                apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
                authDomain: "fluxyos.firebaseapp.com",
                projectId: "fluxyos",
                storageBucket: "fluxyos.firebasestorage.app",
                messagingSenderId: "1084252368929",
                appId: "1:1084252368929:web:da73dc0db83fe592c7f360",
                measurementId: "G-ZN7J6DRD2L"
            };
            
            let app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

            import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").then(mod => {
                const auth = mod.getAuth(app);
                mod.onAuthStateChanged(auth, (user) => {
                    if (user) {
                        const nameElem = document.getElementById('sidebar-user-name');
                        const avatarElem = document.getElementById('sidebar-user-avatar');
                        if (nameElem) nameElem.innerText = user.displayName || user.email.split('@')[0];
                        if (avatarElem && user.photoURL) avatarElem.src = user.photoURL;
                    }
                });
            });
        });
    }

    inject();
})();
