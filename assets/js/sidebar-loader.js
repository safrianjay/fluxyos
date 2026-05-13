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

        <!-- Navigation Menu -->
        <div class="flex-1 overflow-y-auto py-6 px-3 space-y-2 flex flex-col items-center sm:items-stretch" id="nav-container">
            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2 sidebar-hide">Platform</p>
            
            <a href="/dashboard" id="nav-overview" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Overview</span>
            </a>
            
            <a href="/ledger" id="nav-ledger" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Ledger</span>
            </a>

            <a href="/bill" id="nav-bills" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Bills</span>
            </a>

            <a href="/subscription" id="nav-subscriptions" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Subscriptions</span>
            </a>

            <p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Network</p>
            
            <a href="/integration" id="nav-integrations" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium transition-all w-full justify-center lg:justify-start">
                <svg class="w-6 h-6 lg:w-5 lg:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l-4 4-4 4M6 16l-4-4 4-4"></path></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Integrations</span>
            </a>
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
        'nav-bills': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
        'nav-subscriptions': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20a6 6 0 0 0-12 0"/><circle cx="12" cy="10" r="4"/><circle cx="12" cy="12" r="10"/></svg>',
        'nav-integrations': '<svg class="sidebar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
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

        // Logout
        document.getElementById('logout-btn').onclick = async () => {
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth();
            await signOut(auth);
            window.location.href = '/login';
        };

        // Profile Sync
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js").then(async appMod => {
            const { getApps, initializeApp } = appMod;
            const firebaseConfig = {
                apiKey: "AIzaSyCaJqmpEMulLdMvRT7mYf2K-XDw46-dT7A",
                authDomain: "fluxyos.firebaseapp.com",
                projectId: "fluxyos",
                storageBucket: "fluxyos.firebasestorage.app",
                messagingSenderId: "1084252368929",
                appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
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
