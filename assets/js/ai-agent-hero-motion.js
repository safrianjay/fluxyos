// Falling punch-card field: independent column speeds, twinkle, and a
// softly pointer-reactive neutral field. UI/content is never drawn on canvas.
(() => {
  const canvas = document.querySelector('.agent-hero-particles');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const hero = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, time = 0, previous = 0, frame = 0, visible = true;
  let resizeFrame = 0;
  const target = { x: .5, y: .5, strength: 0 };
  const pointer = { ...target };
  const hash = value => {
    const n = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const paint = () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    const offset = reduced.matches ? 0 : time * .08;
    const field = (x, y, radius, strength) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(152,162,179,${strength})`);
      gradient.addColorStop(1, 'rgba(152,162,179,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    };
    const pullX = (pointer.x - .5) * width * .3 * pointer.strength;
    const pullY = (pointer.y - .5) * height * .2 * pointer.strength;
    field(width * .08 + Math.sin(offset * 1.3) * width * .05 + pullX,
      height * .54 + Math.cos(offset * .9) * height * .04 + pullY, width * .48, .52);
    field(width * .86 + Math.cos(offset * 1.1) * width * .04 + pullX * .7,
      height * .6 + Math.sin(offset * 1.5) * height * .05 + pullY, width * .4, .4);
    // Keep the text, top, and bottom white. The pixel field sits at the sides.
    const wash = context.createLinearGradient(0, 0, 0, height);
    wash.addColorStop(0, '#fff');
    wash.addColorStop(.22, '#ffffff30');
    wash.addColorStop(.7, '#ffffff00');
    wash.addColorStop(1, '#fff');
    context.fillStyle = wash;
    context.fillRect(0, 0, width, height);
    if (pointer.strength) {
      const light = context.createRadialGradient(pointer.x * width, pointer.y * height, 0,
        pointer.x * width, pointer.y * height, width * .3);
      light.addColorStop(0, `rgba(255,255,255,${pointer.strength * .6})`);
      light.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = light;
      context.fillRect(0, 0, width, height);
    }
    const cellWidth = height / 110;
    const cellHeight = cellWidth * 2.4;
    for (let column = 0; column < Math.ceil(width / cellWidth); column++) {
      const fall = time * height * (.02 + hash(column * 7.31) * .03);
      const shift = fall % cellHeight;
      const rowOffset = Math.floor(fall / cellHeight);
      for (let row = -1; row < Math.ceil(height / cellHeight); row++) {
        const seed = column * 173 + (row - rowOffset) * 79;
        if (hash(seed) < .92) continue;
        const x = (column + .5) * cellWidth;
        const y = (row + .5) * cellHeight + shift;
        const phase = hash(seed + 31.7) * Math.PI * 2;
        const rate = .6 + hash(seed + 91.3) * 1.4;
        const twinkle = .35 + .65 * Math.pow(.5 + .5 * Math.sin(time * rate + phase), 3);
        const sides = .12 + .85 * smooth(.12, .42, Math.abs(x / width - .5));
        const fade = smooth(0, .3, y / height) * (1 - smooth(.7, 1, y / height));
        context.globalAlpha = twinkle * sides * fade * .9;
        context.fillStyle = '#fff';
        context.fillRect(x, y, cellWidth * .48, cellHeight * .42);
      }
    }
    context.globalAlpha = 1;
  };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
  const tick = now => {
    frame = 0;
    if (!visible || document.hidden || reduced.matches) return;
    if (previous) time += Math.min((now - previous) / 1000, .05);
    previous = now;
    pointer.x += (target.x - pointer.x) * .1;
    pointer.y += (target.y - pointer.y) * .1;
    pointer.strength += (target.strength - pointer.strength) * .04;
    paint();
    frame = requestAnimationFrame(tick);
  };
  const resume = () => {
    stop();
    if (reduced.matches) { time = 0; pointer.strength = 0; }
    paint();
    if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    const box = hero.getBoundingClientRect();
    width = box.width; height = box.height;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.dataset.ready = '';
    paint();
  };
  hero.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || reduced.matches) return;
    const box = hero.getBoundingClientRect();
    target.x = (event.clientX - box.left) / width;
    target.y = (event.clientY - box.top) / height;
    target.strength = 1;
  }, { passive:true });
  hero.addEventListener('pointerleave', () => { target.strength = 0; });
  if ('ResizeObserver' in window) new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize);
  }).observe(hero);
  else window.addEventListener('resize', resize, { passive:true });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; resume();
  }).observe(hero);
  document.addEventListener('visibilitychange', resume);
  reduced.addEventListener('change', resume);
  resize(); resume();
})();
