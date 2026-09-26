/* Progressive enhancement: all workflow examples remain readable without JS. */
(() => {
document.querySelectorAll('[data-feature-tabs]').forEach(group => {
  group.setAttribute('data-tabs-enhanced', '');
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const select = (tab, focus = false) => {
      tabs.forEach(candidate => {
        const active = candidate === tab;
        candidate.setAttribute('aria-selected', String(active));
        candidate.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(candidate.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        select(tabs[next], true);
      });
    });
    if (tabs.length) select(tabs[0]);
  });
})();
