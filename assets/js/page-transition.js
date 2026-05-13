(function () {
    if (window.__fluxyPageTransitionReady) return;
    window.__fluxyPageTransitionReady = true;

    const OVERLAY_ID = 'fluxy-page-transition';
    const STYLE_ID = 'fluxy-page-transition-styles';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${OVERLAY_ID} {
                position: fixed;
                inset: 0;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.94);
                -webkit-backdrop-filter: blur(10px);
                backdrop-filter: blur(10px);
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                transition: opacity 180ms ease, visibility 180ms ease;
            }

            #${OVERLAY_ID}.is-active {
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
            }

            .fluxy-page-transition__logo {
                width: 54px;
                height: 54px;
                color: #0B0F19;
                filter: drop-shadow(0 18px 28px rgba(11, 15, 25, 0.18));
                animation: fluxyLogoBreathe 900ms ease-in-out infinite alternate;
                transform-origin: center;
            }

            .fluxy-page-transition__logo rect {
                animation: fluxyLogoGlow 900ms ease-in-out infinite alternate;
            }

            #${OVERLAY_ID}.is-app-transition {
                align-items: stretch;
                justify-content: flex-start;
                background: rgba(249, 250, 251, 0.96);
                -webkit-backdrop-filter: none;
                backdrop-filter: none;
            }

            .fluxy-page-transition__app {
                display: none;
                width: 100%;
                min-height: 100%;
                background: #F9FAFB;
            }

            #${OVERLAY_ID}.is-app-transition .fluxy-page-transition__logo {
                display: none;
            }

            #${OVERLAY_ID}.is-app-transition .fluxy-page-transition__app {
                display: flex;
            }

            .fluxy-page-transition__sidebar {
                width: 220px;
                flex: 0 0 220px;
                background: #FFFFFF;
                border-right: 1px solid #E2E8F0;
                padding: 20px 18px;
            }

            .fluxy-page-transition__main {
                flex: 1;
                padding: 18px 28px;
            }

            .fluxy-page-transition__topbar {
                height: 44px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 24px;
            }

            .fluxy-page-transition__grid {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 16px;
                margin-bottom: 24px;
            }

            .fluxy-page-transition__card,
            .fluxy-page-transition__panel {
                background: #FFFFFF;
                border: 1px solid #E5E7EB;
                border-radius: 12px;
                padding: 20px;
            }

            .fluxy-page-transition__card {
                min-height: 116px;
            }

            .fluxy-page-transition__panel {
                min-height: 280px;
            }

            .fluxy-page-transition__line,
            .fluxy-page-transition__block,
            .fluxy-page-transition__avatar {
                overflow: hidden;
                position: relative;
                background: #E5E7EB;
            }

            .fluxy-page-transition__line::after,
            .fluxy-page-transition__block::after,
            .fluxy-page-transition__avatar::after {
                content: '';
                position: absolute;
                inset: 0;
                transform: translateX(-100%);
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent);
                animation: fluxyShimmer 950ms ease-in-out infinite;
            }

            .fluxy-page-transition__line {
                height: 12px;
                border-radius: 999px;
                margin-bottom: 12px;
            }

            .fluxy-page-transition__block {
                height: 150px;
                border-radius: 8px;
            }

            .fluxy-page-transition__avatar {
                width: 36px;
                height: 36px;
                border-radius: 10px;
                margin-bottom: 30px;
            }

            @keyframes fluxyShimmer {
                to {
                    transform: translateX(100%);
                }
            }

            @keyframes fluxyLogoBreathe {
                from {
                    transform: translateY(0) scale(0.96) rotate(-2deg);
                }
                to {
                    transform: translateY(-3px) scale(1.04) rotate(2deg);
                }
            }

            @keyframes fluxyLogoGlow {
                from {
                    fill: #0B0F19;
                }
                to {
                    fill: #EA580C;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .fluxy-page-transition__logo,
                .fluxy-page-transition__logo rect {
                    animation: none;
                }

                .fluxy-page-transition__line::after,
                .fluxy-page-transition__block::after,
                .fluxy-page-transition__avatar::after {
                    animation: none;
                }
            }

            @media (max-width: 760px) {
                .fluxy-page-transition__sidebar {
                    width: 64px;
                    flex-basis: 64px;
                    padding: 16px 12px;
                }

                .fluxy-page-transition__main {
                    padding: 16px;
                }

                .fluxy-page-transition__grid {
                    grid-template-columns: 1fr;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function createOverlay() {
        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.setAttribute('aria-label', 'Loading FluxyOS');
        overlay.innerHTML = `
            <svg class="fluxy-page-transition__logo" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect width="40" height="40" rx="8" fill="currentColor" />
                <g transform="translate(1.5, 0)">
                    <path d="M 7 6 L 33 6 L 27 12 L 13 12 L 13 34 L 7 34 Z" fill="#FFFFFF" />
                    <path d="M 17 18 L 27 18 L 21 24 L 17 24 Z" fill="#FFFFFF" />
                </g>
            </svg>
            <div class="fluxy-page-transition__app" aria-hidden="true">
                <div class="fluxy-page-transition__sidebar">
                    <div class="fluxy-page-transition__avatar"></div>
                    <div class="fluxy-page-transition__line" style="width: 74%"></div>
                    <div class="fluxy-page-transition__line" style="width: 58%"></div>
                    <div class="fluxy-page-transition__line" style="width: 68%; margin-top: 28px"></div>
                    <div class="fluxy-page-transition__line" style="width: 82%"></div>
                    <div class="fluxy-page-transition__line" style="width: 76%"></div>
                </div>
                <div class="fluxy-page-transition__main">
                    <div class="fluxy-page-transition__topbar">
                        <div class="fluxy-page-transition__line" style="width: 170px; margin-bottom: 0"></div>
                        <div class="fluxy-page-transition__line" style="width: 220px; margin-bottom: 0"></div>
                    </div>
                    <div class="fluxy-page-transition__grid">
                        <div class="fluxy-page-transition__card">
                            <div class="fluxy-page-transition__line" style="width: 48%"></div>
                            <div class="fluxy-page-transition__line" style="width: 72%; height: 22px; margin-top: 28px"></div>
                        </div>
                        <div class="fluxy-page-transition__card">
                            <div class="fluxy-page-transition__line" style="width: 54%"></div>
                            <div class="fluxy-page-transition__line" style="width: 66%; height: 22px; margin-top: 28px"></div>
                        </div>
                        <div class="fluxy-page-transition__card">
                            <div class="fluxy-page-transition__line" style="width: 50%"></div>
                            <div class="fluxy-page-transition__line" style="width: 58%; height: 22px; margin-top: 28px"></div>
                        </div>
                        <div class="fluxy-page-transition__card">
                            <div class="fluxy-page-transition__line" style="width: 60%"></div>
                            <div class="fluxy-page-transition__line" style="width: 46%; height: 22px; margin-top: 28px"></div>
                        </div>
                    </div>
                    <div class="fluxy-page-transition__panel">
                        <div class="fluxy-page-transition__line" style="width: 24%"></div>
                        <div class="fluxy-page-transition__line" style="width: 36%"></div>
                        <div class="fluxy-page-transition__block" style="margin-top: 28px"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function isAppRoute(pathname = window.location.pathname) {
        return /\/(dashboard|ledger|bill|subscription|integration)(\.html)?\/?$/.test(pathname);
    }

    function showTransition(useAppShimmer = isAppRoute()) {
        injectStyles();
        const overlay = createOverlay();
        overlay.classList.toggle('is-app-transition', useAppShimmer);
        overlay.setAttribute('aria-label', useAppShimmer ? 'Loading dashboard' : 'Loading FluxyOS');
        overlay.classList.add('is-active');
    }

    function hideTransition() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;
        overlay.classList.remove('is-active');
        overlay.classList.remove('is-app-transition');
    }

    function isNavigableLink(event, link) {
        if (!link || event.defaultPrevented) return false;
        if (event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (link.target && link.target !== '_self') return false;
        if (link.hasAttribute('download')) return false;

        const rawHref = link.getAttribute('href');
        if (!rawHref || rawHref.startsWith('#')) return false;
        if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return false;

        const url = new URL(rawHref, window.location.href);
        if (url.origin !== window.location.origin) return false;
        if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return false;

        return true;
    }

    function init() {
        injectStyles();
        createOverlay();
        hideTransition();

        document.addEventListener('click', event => {
            const link = event.target.closest?.('a[href]');
            if (!isNavigableLink(event, link)) return;

            event.preventDefault();
            const destination = new URL(link.getAttribute('href'), window.location.href).href;
            showTransition(isAppRoute(window.location.pathname) || isAppRoute(new URL(destination).pathname));
            window.setTimeout(() => {
                window.location.href = destination;
            }, 180);
        }, true);

        window.addEventListener('beforeunload', () => showTransition(isAppRoute()));
        window.addEventListener('pageshow', hideTransition);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
