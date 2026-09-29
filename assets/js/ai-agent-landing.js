(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.querySelector('.footer-component .footer-canvas');
    if (canvas && typeof window.initUniverseCanvas === 'function') window.initUniverseCanvas(canvas);
  }, { once: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const workspace = document.querySelector('[data-agent-insights]');
  if (workspace) {
    const cards = [...workspace.querySelectorAll('details')];
    const visual = workspace.querySelector('.agent-insight-visual');
    const original = visual.innerHTML;
    const variations = [
      original,
      document.querySelector('.agent-workflow:last-child .agent-visual').innerHTML,
      document.querySelector('.agent-capture-workspace .agent-window:first-child').outerHTML
    ];
    cards.forEach((card,i) => card.addEventListener('toggle',() => {
      if (!card.open) return;
      cards.forEach(other => { if (other !== card) other.open = false; });
      visual.innerHTML = variations[i];
      visual.classList.remove('agent-changing');
      if (!reduced.matches) requestAnimationFrame(() => visual.classList.add('agent-changing'));
    }));
  }
  if ('IntersectionObserver' in window && !reduced.matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('agent-revealed');
        observer.unobserve(entry.target);
      }
    }),{threshold:0.2});
    document.querySelectorAll('.agent-feature,.agent-visual,.agent-insight-visual').forEach(element => observer.observe(element));
  }
})();
