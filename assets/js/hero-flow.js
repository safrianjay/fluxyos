/* Finite decorative hero motion: no cards, controls, or automatic content changes. */
(()=>{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 document.querySelectorAll('[data-hero-motion]').forEach(hero=>{
  let visible=false;
  const sync=()=>{hero.dataset.motionRunning=String(visible&&!document.hidden&&!reduced.matches)};
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync()},{threshold:.1}).observe(hero);
  document.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);sync();
 });
})();
