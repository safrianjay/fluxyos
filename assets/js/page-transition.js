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
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function showTransition() {
        injectStyles();
        createOverlay().classList.add('is-active');
    }

    function hideTransition() {
        document.getElementById(OVERLAY_ID)?.classList.remove('is-active');
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
            showTransition();

            const destination = new URL(link.getAttribute('href'), window.location.href).href;
            window.setTimeout(() => {
                window.location.href = destination;
            }, 180);
        }, true);

        window.addEventListener('beforeunload', showTransition);
        window.addEventListener('pageshow', hideTransition);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
