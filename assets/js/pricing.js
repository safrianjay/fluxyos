document.addEventListener('DOMContentLoaded', () => {
    const toggleContainer = document.getElementById('toggle-container');
    const toggleBtn = document.getElementById('billing-toggle');
    const dot = document.getElementById('toggle-dot');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual = document.getElementById('label-annual');
    
    const activePrices = document.querySelectorAll('.active-price');
    const slashPrices = document.querySelectorAll('.slash-price');
    const mobileMenu = document.getElementById('mobile-menu') || document.getElementById('pricing-mobile-menu');
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle') || document.querySelector('.pricing-mobile-menu-toggle');

    const setMobileMenu = isOpen => {
        if (!mobileMenu || !mobileMenuToggle) return;

        const openIcon = mobileMenuToggle.querySelector('[data-menu-open-icon]');
        const closeIcon = mobileMenuToggle.querySelector('[data-menu-close-icon]');

        mobileMenu.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('mobile-menu-open', isOpen);
        mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
        mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
        openIcon?.classList.toggle('hidden', isOpen);
        closeIcon?.classList.toggle('hidden', !isOpen);
    };

    mobileMenuToggle?.addEventListener('click', () => {
        setMobileMenu(mobileMenu?.classList.contains('hidden'));
    });

    document.querySelectorAll('.mobile-menu-link, .pricing-mobile-menu-link').forEach(link => {
        link.addEventListener('click', () => setMobileMenu(false));
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setMobileMenu(false);
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) setMobileMenu(false);
    });
    
    // Default State
    let isAnnual = true;

    // Handle Toggle Click
    toggleContainer.addEventListener('click', (e) => {
        // Prevent bubbling if user clicked directly on the button to avoid double firing
        if(e.target === toggleBtn || toggleBtn.contains(e.target)) return;
        toggleLogic();
    });

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLogic();
    });

    function toggleLogic() {
        isAnnual = !isAnnual;

        if (isAnnual) {
            // Switch visual toggle to Annual
            dot.classList.remove('translate-x-1');
            dot.classList.add('translate-x-6');
            
            labelMonthly.classList.remove('text-white', 'font-bold');
            labelMonthly.classList.add('text-gray-400');
            labelAnnual.classList.add('text-white', 'font-bold');
            labelAnnual.classList.remove('text-gray-400');
            toggleBtn.classList.add('bg-[#EA580C]');
            toggleBtn.classList.remove('bg-gray-600');

            // Update prices to Annual & show slash
            activePrices.forEach(el => el.textContent = el.getAttribute('data-annual'));
            slashPrices.forEach(el => {
                el.style.opacity = '1';
                el.style.visibility = 'visible';
            });
        } else {
            // Switch visual toggle to Monthly
            dot.classList.remove('translate-x-6');
            dot.classList.add('translate-x-1');
            
            labelMonthly.classList.add('text-white', 'font-bold');
            labelMonthly.classList.remove('text-gray-400');
            labelAnnual.classList.remove('text-white', 'font-bold');
            labelAnnual.classList.add('text-gray-400');
            toggleBtn.classList.remove('bg-[#EA580C]');
            toggleBtn.classList.add('bg-gray-600');

            // Update prices to Monthly & hide slash
            activePrices.forEach(el => el.textContent = el.getAttribute('data-monthly'));
            slashPrices.forEach(el => {
                el.style.opacity = '0';
                el.style.visibility = 'hidden';
            });
        }
    }
});
