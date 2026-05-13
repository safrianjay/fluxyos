/**
 * Universe starfield canvas — reusable for any container.
 * Call initUniverseCanvas(canvasEl) after inserting the canvas into the DOM.
 */
(function loadFluxyPageTransition() {
    if (window.__fluxyPageTransitionScriptRequested) return;
    window.__fluxyPageTransitionScriptRequested = true;

    const script = document.createElement('script');
    script.src = '/assets/js/page-transition.js';
    script.defer = true;
    document.head.appendChild(script);
})();

function initUniverseCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, stars, rafId;

    const NUM_STARS = 220;
    const BASE_SPEED = 0.18;

    function resize() {
        const parent = canvas.parentElement;
        w = canvas.width  = parent.offsetWidth;
        h = canvas.height = parent.offsetHeight;
        spawnStars();
    }

    function spawnStars() {
        stars = Array.from({ length: NUM_STARS }, () => makeStar(false));
    }

    function makeStar(fromCenter) {
        const angle  = Math.random() * Math.PI * 2;
        const startR = fromCenter
            ? Math.random() * 10
            : Math.random() * Math.min(w, h) * 0.45;
        return {
            x:     w / 2 + Math.cos(angle) * startR,
            y:     h / 2 + Math.sin(angle) * startR,
            angle,
            speed: BASE_SPEED + Math.random() * BASE_SPEED * 1.8,
            size:  Math.random() * 1.4 + 0.3,
            life:  Math.random(),
            color: Math.random() < 0.2 ? [200, 170, 255] : [230, 220, 255],
        };
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);

        // Base fill
        ctx.fillStyle = '#0B0F19';
        ctx.fillRect(0, 0, w, h);

        // Dark purple center glow
        const core = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, h * 0.55);
        core.addColorStop(0,   'rgba(88,28,135,0.18)');
        core.addColorStop(0.5, 'rgba(59,7,100,0.1)');
        core.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = core;
        ctx.fillRect(0, 0, w, h);

        // Dark purple nebula edges (left + right)
        [[0, 0.4], [w, 0.4]].forEach(([cx, alpha]) => {
            const g = ctx.createRadialGradient(cx, h/2, 0, cx, h/2, w * 0.6);
            g.addColorStop(0,   `rgba(109,40,217,${alpha})`);
            g.addColorStop(0.4, 'rgba(59,7,100,0.2)');
            g.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        });

        // Stars
        stars.forEach(s => {
            s.x += Math.cos(s.angle) * s.speed;
            s.y += Math.sin(s.angle) * s.speed;
            s.life = Math.min(1, s.life + 0.004);

            if (s.x < -2 || s.x > w + 2 || s.y < -2 || s.y > h + 2) {
                Object.assign(s, makeStar(true));
                return;
            }

            const dist    = Math.hypot(s.x - w/2, s.y - h/2);
            const opacity = Math.min(1, s.life * 2) * Math.min(1, dist / 30);
            const tailLen = dist * 0.055 * (s.speed / BASE_SPEED);
            const tx = s.x - Math.cos(s.angle) * tailLen;
            const ty = s.y - Math.sin(s.angle) * tailLen;

            const grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
            grad.addColorStop(0, `rgba(${s.color},0)`);
            grad.addColorStop(1, `rgba(${s.color},${opacity * 0.85})`);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = s.size * 0.7;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${s.color},${opacity})`;
            ctx.fill();
        });

        rafId = requestAnimationFrame(draw);
    }

    // Pause when off-screen
    const io = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { if (!rafId) draw(); }
        else { cancelAnimationFrame(rafId); rafId = null; }
    }, { threshold: 0.01 });
    io.observe(canvas.parentElement);

    new ResizeObserver(resize).observe(canvas.parentElement);

    resize();
}
