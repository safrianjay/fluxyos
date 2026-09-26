/* Progressive enhancement: every sample story stays visible without JS. */
// Background-only particle field: pause offscreen; keep text and links untouched.
// One-shot reveals: no continuous motion, and no hidden content without JS.
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const mosaic = document.querySelector('.customer-mosaic');
  if (mosaic) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        mosaic.classList.add('is-revealing');
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    observer.observe(mosaic);
  }
}
document.querySelectorAll('[data-customer-stories]').forEach(section => {
  const controls = section.querySelector('[data-customer-filters]');
  const buttons = [...section.querySelectorAll('[data-customer-filter]')];
  const stories = [...section.querySelectorAll('[data-customer-category]')];
  const status = section.querySelector('[data-customer-count]');
  if (!controls || !status || !buttons.length || !stories.length) return;
  controls.hidden = false;
  const select = button => {
    const category = button.dataset.customerFilter;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    stories.forEach(story => {
      story.hidden = category !== 'all' && story.dataset.customerCategory !== category;
    });
    const visible = stories.filter(story => !story.hidden).length;
    section.querySelector('.customer-story-grid').dataset.visibleCount = String(visible);
    const isID = document.documentElement.lang === 'id';
    status.textContent = isID ? visible + ' cerita' : visible + ' stories';
  };
  buttons.forEach(button => button.addEventListener('click', () => select(button)));
  select(buttons[0]);
});
