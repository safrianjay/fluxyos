/* Progressive enhancement: all workflow panels remain readable without JS. */
(() => {
    const section = document.querySelector('.st-walkthrough');
    if (!section) return;
    const tabs = section.querySelector('.st-walk-tabs');
    const buttons = [...tabs.querySelectorAll('[data-st-step]')];
    const panels = [...section.querySelectorAll('.st-walk-panel')];
    tabs.setAttribute('role', 'tablist');
    const stacked = matchMedia('(max-width:900px)');
    const orient = () => tabs.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
    orient();
    stacked.addEventListener('change', orient);
    const select = index => {
        buttons.forEach((button, i) => {
            button.setAttribute('aria-selected', String(i === index));
            button.tabIndex = i === index ? 0 : -1;
            panels[i].hidden = i !== index;
        });
    };
    buttons.forEach((button, i) => {
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', panels[i].id);
        panels[i].setAttribute('role', 'tabpanel');
        panels[i].setAttribute('aria-labelledby', button.id);
        panels[i].tabIndex = 0;
        button.addEventListener('click', () => select(i));
        button.addEventListener('keydown', event => {
            const destinations = { ArrowDown:(i+1)%buttons.length, ArrowRight:(i+1)%buttons.length, ArrowUp:(i+buttons.length-1)%buttons.length, ArrowLeft:(i+buttons.length-1)%buttons.length, Home:0, End:buttons.length-1 };
            if (!(event.key in destinations)) return;
            event.preventDefault();
            const target = destinations[event.key];
            select(target);
            buttons[target].focus();
        });
    });
    select(0);
    tabs.hidden = false;
    section.classList.add('st-walk-enhanced');
})();
