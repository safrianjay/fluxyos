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
        <!-- Logo Area -->
        <div class="logo-area h-16 flex items-center justify-between px-6 border-b border-gray-800/60 bg-[#0B0F19] sticky top-0 z-10">
            <div class="flex items-center gap-3 cursor-pointer group" onclick="window.location.href='dashboard.html'">
                <div class="w-8 h-8 text-[#EA580C] flex-shrink-0">
                    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
                        <rect width="40" height="40" rx="8" fill="currentColor" />
                        <path d="M 12 10 H 28 V 15 H 18 V 20 H 26 V 25 H 18 V 32 H 12 V 10 Z" fill="white" />
                    </svg>
                </div>
                <span class="logo-text font-bold text-lg tracking-tight text-white group-hover:text-[#EA580C] transition-colors">FluxyOS</span>
            </div>
            <button id="sidebar-toggle" class="p-1.5 text-gray-500 hover:text-white rounded-md hover:bg-gray-800 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>
            </button>
        </div>

        <!-- Navigation Menu -->
        <div class="flex-1 overflow-y-auto py-6 px-3 space-y-1.5">
            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2 sidebar-hide">Platform</p>
            
            <a href="dashboard.html" id="nav-overview" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Overview</span>
            </a>
            
            <a href="ledger.html" id="nav-ledger" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Ledger</span>
            </a>

            <a href="bill.html" id="nav-bills" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Bills</span>
            </a>

            <a href="subscription.html" id="nav-subscriptions" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Subscriptions</span>
            </a>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Network</p>
            
            <a href="integration.html" id="nav-integrations" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-colors">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l-4 4-4 4M6 16l-4-4 4-4"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Integrations</span>
            </a>
        </div>

        <!-- USER PROFILE & SIGNOUT (Bottom) -->
        <div class="p-4 border-t border-gray-800/60 bg-[#0B0F19]">
            <div class="flex items-center gap-3 p-2 rounded-lg mb-2">
                <img id="sidebar-user-avatar" src="https://ui-avatars.com/api/?name=User&background=EA580C&color=fff" alt="User" class="w-9 h-9 rounded-full border border-gray-700 flex-shrink-0">
                <div class="flex-1 min-w-0 sidebar-hide">
                    <p class="text-[13px] font-bold text-white truncate" id="sidebar-user-name">Loading...</p>
                    <p class="text-[11px] text-gray-500 truncate">Account Owner</p>
                </div>
            </div>
            <button id="logout-btn" class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-500 font-medium transition-colors">
                <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                <span class="sidebar-text text-[12px] sidebar-hide">Sign Out</span>
            </button>
        </div>
    `;

    function inject() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = sidebarHTML;
        
        // Highlight Active
        const path = window.location.pathname;
        const pageIdMap = {
            'dashboard.html': 'nav-overview',
            'ledger.html': 'nav-ledger',
            'bill.html': 'nav-bills',
            'subscription.html': 'nav-subscriptions',
            'integration.html': 'nav-integrations'
        };

        const activeId = Object.keys(pageIdMap).find(p => path.includes(p));
        if (activeId) {
            const el = document.getElementById(pageIdMap[activeId]);
            if (el) {
                el.classList.add('bg-[#1A1F26]', 'text-white', 'border', 'border-gray-700/50', 'shadow-sm');
                const icon = el.querySelector('svg');
                if (icon) icon.classList.add('text-[#EA580C]');
            }
        }

        // Sidebar Toggle
        const toggleBtn = document.getElementById('sidebar-toggle');
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('w-[260px]');
            sidebar.classList.toggle('w-[80px]');
            const hides = sidebar.querySelectorAll('.sidebar-hide');
            hides.forEach(el => el.classList.toggle('hidden'));
            
            // Rotate icon
            toggleBtn.querySelector('svg').classList.toggle('rotate-180');
        };

        // Logout
        document.getElementById('logout-btn').onclick = async () => {
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth();
            await signOut(auth);
            window.location.href = 'login.html';
        };

        // Profile Sync
        const { getAuth: getAuthSync, onAuthStateChanged } = import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js").then(mod => {
            const auth = mod.getAuth();
            mod.onAuthStateChanged(auth, (user) => {
                if (user) {
                    const nameElem = document.getElementById('sidebar-user-name');
                    const avatarElem = document.getElementById('sidebar-user-avatar');
                    if (nameElem) nameElem.innerText = user.displayName || user.email.split('@')[0];
                    if (avatarElem && user.photoURL) avatarElem.src = user.photoURL;
                }
            });
        });
    }

    inject();
    window.addEventListener('load', inject);
})();
