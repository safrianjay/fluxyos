/**
 * Footer Loader — loads footer HTML and starts universe canvas animation
 */

function loadFooter() {
    if (document.querySelector('.footer-component')) return;

    const path = window.location.pathname;
    if (path.includes('/dashboard') || path.includes('/bill') || path.includes('/subscription')) return;

    fetch('includes/footer.html')
        .then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); })
        .then(html => {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const footer = tmp.firstElementChild;
            document.body.appendChild(footer);
            loadFooterStyles();
            initUniverseCanvas(footer.querySelector('.footer-canvas'));
        })
        .catch(() => {});
}

function loadFooterStyles() {
    if (document.querySelector('link[href*="footer.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/css/footer.css';
    document.head.appendChild(link);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFooter);
} else {
    loadFooter();
}
