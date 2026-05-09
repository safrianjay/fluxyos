function _fluxyosInit() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canAnimate = !reduceMotion && window.anime;
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const heroCopyItems = document.querySelectorAll('.hero-copy h1, .hero-copy p, .hero-copy ul li, .hero-copy button');
    const heroLayers = document.querySelectorAll('.hero-layer');
    const revealItems = [
        ...document.querySelectorAll('section:not(.landing-hero) h2, section:not(.landing-hero) h3, section:not(.landing-hero) p, .ui-shadow-hover, .tab-content, footer > div')
    ].filter((item, index, list) => {
        if (list.indexOf(item) !== index) return false;
        return !item.closest('.tab-content') || item.classList.contains('tab-content');
    });

    revealItems.forEach(item => item.classList.add('scroll-reveal'));

    const formatCount = (element, value) => {
        const prefix = element.dataset.prefix || '';
        const suffix = element.dataset.suffix || '';
        const locale = element.dataset.locale || 'en-US';
        return `${prefix}${Math.round(value).toLocaleString(locale)}${suffix}`;
    };

    const animateCount = element => {
        if (element.dataset.counted === 'true') return;
        element.dataset.counted = 'true';

        const target = Number(element.dataset.count);
        if (!Number.isFinite(target)) return;

        if (!canAnimate) {
            element.textContent = formatCount(element, target);
            return;
        }

        anime({
            targets: { value: 0 },
            value: target,
            duration: 1200,
            easing: 'easeOutCubic',
            update: animation => {
                element.textContent = formatCount(element, animation.animatables[0].target.value);
            },
            complete: () => {
                element.textContent = formatCount(element, target);
            }
        });
    };

    if (canAnimate) {
        anime({
            targets: '[data-animate="nav"]',
            opacity: [0, 1],
            translateY: [-12, 0],
            duration: 650,
            easing: 'easeOutCubic',
            complete: anim => {
                anim.animatables.forEach(({ target }) => { target.style.transform = ''; });
            }
        });

        anime({
            targets: heroCopyItems,
            opacity: [0, 1],
            translateY: [26, 0],
            delay: anime.stagger(80, { start: 120 }),
            duration: 760,
            easing: 'easeOutCubic'
        });

        anime({
            targets: heroLayers,
            opacity: [0, 1],
            translateY: [24, 0],
            scale: [0.96, 1],
            delay: anime.stagger(130, { start: 260 }),
            duration: 900,
            easing: 'easeOutExpo',
            complete: () => {
                heroLayers.forEach(item => {
                    item.classList.add('is-visible');
                    item.style.opacity = '';
                    item.style.transform = '';
                });
            }
        });
    } else {
        document.querySelectorAll('[data-animate], .hero-layer, .scroll-reveal').forEach(item => {
            item.classList.add('is-visible');
            item.style.opacity = '';
            item.style.transform = '';
        });
    }

    const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            const target = entry.target;
            revealObserver.unobserve(target);

            if (canAnimate) {
                anime({
                    targets: target,
                    opacity: [0, 1],
                    translateY: [22, 0],
                    duration: 700,
                    easing: 'easeOutCubic',
                    complete: () => {
                        target.classList.add('is-visible');
                        target.style.opacity = '';
                        target.style.transform = '';
                    }
                });
            } else {
                target.classList.add('is-visible');
            }
        });
    }, { threshold: 0.16, rootMargin: '0px 0px -40px 0px' });

    revealItems.forEach(item => revealObserver.observe(item));

    const countObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            animateCount(entry.target);
            countObserver.unobserve(entry.target);
        });
    }, { threshold: 0.45 });

    document.querySelectorAll('[data-count]').forEach(item => countObserver.observe(item));

    let _savedScrollY = 0;

    const setMobileMenu = isOpen => {
        if (!mobileMenu || !mobileMenuToggle) return;

        const openIcon = mobileMenuToggle.querySelector('[data-menu-open-icon]');
        const closeIcon = mobileMenuToggle.querySelector('[data-menu-close-icon]');

        if (isOpen) {
            _savedScrollY = window.scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = `-${_savedScrollY}px`;
            document.body.style.width = '100%';
            mobileMenu.scrollTop = 0;
        } else {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            window.scrollTo(0, _savedScrollY);
        }

        mobileMenu.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('mobile-menu-open', isOpen);
        mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
        mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
        openIcon?.classList.toggle('hidden', isOpen);
        closeIcon?.classList.toggle('hidden', !isOpen);

        if (isOpen && canAnimate) {
            anime({
                targets: mobileMenu,
                opacity: [0, 1],
                translateY: [-8, 0],
                duration: 260,
                easing: 'easeOutCubic'
            });
        }
    };

    mobileMenuToggle?.addEventListener('click', () => {
        setMobileMenu(mobileMenu?.classList.contains('hidden'));
    });

    document.querySelectorAll('.mobile-menu-link').forEach(link => {
        link.addEventListener('click', () => setMobileMenu(false));
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setMobileMenu(false);
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) setMobileMenu(false);
    });

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active styling from all buttons
            tabButtons.forEach(btn => {
                btn.classList.remove('bg-gradient-to-r', 'from-[#EA580C]', 'to-[#F97316]', 'text-white', 'shadow-md');
                btn.classList.add('text-gray-400', 'hover:text-white');
            });

            // Add active styling to clicked button
            button.classList.remove('text-gray-400', 'hover:text-white');
            button.classList.add('bg-gradient-to-r', 'from-[#EA580C]', 'to-[#F97316]', 'text-white', 'shadow-md');

            // Hide all tab contents
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });

            // Show target tab content
            const targetId = button.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.classList.remove('hidden');
                if (canAnimate) {
                    anime({
                        targets: targetElement,
                        opacity: [0, 1],
                        translateY: [14, 0],
                        duration: 420,
                        easing: 'easeOutCubic'
                    });
                }
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _fluxyosInit);
} else {
    _fluxyosInit();
}
