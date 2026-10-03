/* Shared editorial use-case interactions: progressive enhancement, no automatic slide changes. */
(() => {
    const page = document.querySelector('.ag-page');
    if (!page) return;
    // These use-cases have full static mirrors; preserve the saved language choice.
    if (document.documentElement.lang === 'en') {
        try {
            if (localStorage.getItem('fluxyos-lang') === 'id') {
                location.replace('/id' + (page.dataset.localePath || '/use-cases/marketing-agencies') + location.search + location.hash);
                return;
            }
        } catch (_) { /* Storage may be unavailable in private browsing. */ }
    }
    // A prerendered universal promotion reserves its space before scripts load.
    const staticPromo = document.querySelector('[data-static-promo]');
    if (staticPromo) {
        const measurePromo = () => document.documentElement.style.setProperty('--promo-banner-height', `${staticPromo.getBoundingClientRect().height}px`);
        measurePromo();
        if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(measurePromo)).observe(staticPromo);
        window.addEventListener('resize', measurePromo);
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let observer;
    const reveal = () => {
        observer?.disconnect();
        if (reduced.matches || !('IntersectionObserver' in window)) {
            page.classList.remove('ag-motion-ready');
            return;
        }
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: .1 });
        page.querySelectorAll('.ag-reveal').forEach(item => observer.observe(item));
        page.classList.add('ag-motion-ready');
    };
    reveal();
    reduced.addEventListener('change', reveal);

    const carousel = page.querySelector('.ag-carousel');
    if (carousel) {
    const slides = [...carousel.querySelectorAll('.ag-step')];
    const prev = page.querySelector('[data-ag-prev]');
    const next = page.querySelector('[data-ag-next]');
    const status = page.querySelector('[data-ag-status]');
    page.querySelector('.ag-carousel-controls').hidden = false;
    let current = 0, scrollFrame;
    const update = () => {
        current = slides.reduce((best, slide, i) => Math.abs(slide.offsetLeft - slides[0].offsetLeft - carousel.scrollLeft) < Math.abs(slides[best].offsetLeft - slides[0].offsetLeft - carousel.scrollLeft) ? i : best, 0);
        prev.disabled = current === 0;
        next.disabled = current === slides.length - 1;
        status.textContent = `${status.dataset.label} ${current + 1} / ${slides.length}`;
    };
    const go = index => {
        const target = Math.max(0, Math.min(slides.length - 1, index));
        carousel.scrollTo({ left: slides[target].offsetLeft - slides[0].offsetLeft, behavior: reduced.matches ? 'instant' : 'smooth' });
    };
    prev.addEventListener('click', () => go(current - 1));
    next.addEventListener('click', () => go(current + 1));
    carousel.addEventListener('keydown', event => {
        const actions = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: slides.length - 1 };
        if (!(event.key in actions)) return;
        event.preventDefault();
        go(actions[event.key]);
    });
    carousel.addEventListener('scroll', () => {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = requestAnimationFrame(update);
    }, { passive:true });
    const resize = new ResizeObserver(() => requestAnimationFrame(() => { go(current); update(); }));
    resize.observe(carousel);
    update();
    }

    // Shared public dropdowns are initialized by fluxyos.js on every marketing page.
})();
