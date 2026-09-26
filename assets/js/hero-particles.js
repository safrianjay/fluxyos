document.querySelectorAll('[data-hero-particles]').forEach(canvas => {
  const hero = canvas.parentElement;
  const context = canvas?.getContext('2d');
  if (!context || !hero) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const continuous = hero.classList.contains('customer-hero');
  let paused = false;
  const pointer = { x: -1000, y: -1000 };
  let width = 0, height = 0, frame = 0, last = 0, elapsed = 0, visible = true;
  const particles = Array.from({ length: continuous ? 420 : 180 }, (_, i) => ({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * Math.PI * 2,
    accent: i % 9 === 0
  }));
  const draw = () => {
    context.clearRect(0, 0, width, height);
    particles.forEach(p => {
      const drift = reduced.matches ? 0 : Math.sin(elapsed * 0.65 + p.phase) * 10;
      let x = p.x * width + drift;
      let y = p.y * height + (reduced.matches ? 0 : Math.cos(elapsed * 0.5 + p.phase) * 8);
      const dx = x - pointer.x, dy = y - pointer.y, distance = Math.hypot(dx, dy);
      if (!reduced.matches && distance > 0 && distance < 140) {
        const force = (1 - distance / 140) * 22;
        x += dx / distance * force;
        y += dy / distance * force;
      }
      // Keep the central copy clear; stronger detail toward the outer edges.
      const edge = Math.min(1, Math.abs(x - width / 2) / (width * 0.38));
      context.globalAlpha = (0.25 + edge * 0.45) * Math.min(1, (height - y) / 60);
      context.fillStyle = p.accent ? '#EA580C' : '#98A2B3';
      context.fillRect(x, y, p.accent ? 3.5 : 2.8, p.accent ? 3.5 : 2.8);
    });
    context.globalAlpha = 1;
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
  const tick = time => {
    frame = 0;
    if (!visible || document.hidden || reduced.matches || paused) return;
    if (last) elapsed += Math.min((time - last) / 1000, 0.05);
    last = time;
    draw();
    if (continuous || elapsed < 4.8) frame = requestAnimationFrame(tick);
  };
  const resume = () => {
    stop();
    draw();
    if (visible && !document.hidden && !reduced.matches && !paused && (continuous || elapsed < 4.8)) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    const box = hero.getBoundingClientRect();
    width = box.width; height = box.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.dataset.ready = '';
    draw();
  };
  hero.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const box = hero.getBoundingClientRect();
    pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top;
    if (!frame && !reduced.matches && !paused) draw();
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1000; if (!frame && !paused) draw(); });
  let resizeFrame = 0;
  if ('ResizeObserver' in window) new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  }).observe(hero);
  else window.addEventListener('resize', resize, { passive: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    resume();
  }).observe(hero);
  document.addEventListener('visibilitychange', resume);
  reduced.addEventListener('change', resume);
  resize();
  resume();
});
