/* FluxyOS event signup (event.html).
 *
 * Reached by QR at a live event, so the failure modes that matter are the ones
 * that happen standing up on a phone with poor signal: a double-tap on Register,
 * a mistyped number, or a submit that appears to do nothing. Each is handled
 * explicitly below.
 *
 * The lead is written server-side by netlify/functions/submit-contact-sales.js
 * (Admin SDK). The browser never writes to Firestore — firestore.rules denies all
 * client writes to sales_leads, which is what keeps a public form spam-proof.
 */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var form = $('event-form');
    if (!form) return;

    var submitBtn = $('ev-submit');
    var formError = $('ev-form-error');
    var categoryEl = $('ev-category');
    var otherWrap = $('ev-other-wrap');
    var otherEl = $('ev-other');
    var submitting = false;

    // ---- "Others" reveal --------------------------------------------------
    categoryEl.addEventListener('change', function () {
        var isOther = categoryEl.value === 'Others';
        otherWrap.classList.toggle('hidden', !isOther);
        if (isOther) otherEl.focus(); else { otherEl.value = ''; clearError(otherEl); }
    });

    // ---- validation -------------------------------------------------------
    function errNode(el) { return document.querySelector('[data-err-for="' + el.id + '"]'); }
    function showError(el, msg) {
        el.setAttribute('aria-invalid', 'true');
        var n = errNode(el);
        if (n) { if (msg) n.textContent = msg; n.style.display = 'block'; }
    }
    function clearError(el) {
        el.removeAttribute('aria-invalid');
        var n = errNode(el);
        if (n) n.style.display = 'none';
    }

    var isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };
    // Six digits is the server's floor too. Deliberately loose: attendees write
    // numbers as +62, 08…, or with spaces and dashes, and rejecting a reachable
    // number at a live event costs a lead for no benefit.
    var digits = function (v) { return (String(v).match(/\d/g) || []).length; };

    function validate() {
        var checks = [
            [$('ev-name'), function (v) { return v.trim().length > 0; }],
            [$('ev-whatsapp'), function (v) { return digits(v) >= 6; }],
            [$('ev-email'), function (v) { return isEmail(v.trim()); }],
            [$('ev-company'), function (v) { return v.trim().length > 0; }],
            [categoryEl, function (v) { return !!v; }]
        ];
        if (categoryEl.value === 'Others') {
            checks.push([otherEl, function (v) { return v.trim().length > 1; }]);
        }
        var firstBad = null;
        checks.forEach(function (pair) {
            var el = pair[0], ok = pair[1](el.value);
            if (ok) clearError(el);
            else { showError(el); if (!firstBad) firstBad = el; }
        });
        return firstBad;
    }

    // Clear a field's error as soon as it is corrected — leaving red on a field
    // the user has already fixed is the most common reason a form feels broken.
    ['ev-name', 'ev-whatsapp', 'ev-email', 'ev-company', 'ev-other'].forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener('input', function () { if (el.getAttribute('aria-invalid')) clearError(el); });
    });

    // ---- submit -----------------------------------------------------------
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (submitting) return;                      // double-tap guard

        formError.classList.add('hidden');
        var bad = validate();
        if (bad) {
            bad.focus();
            bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Registering…';

        // "Others" is stored in the same column the dropdown writes, so the
        // internal console has ONE field to filter on rather than two that
        // disagree.
        var category = categoryEl.value === 'Others'
            ? otherEl.value.trim().slice(0, 60)
            : categoryEl.value;

        var payload = {
            name: $('ev-name').value.trim(),
            email: $('ev-email').value.trim(),
            whatsapp: $('ev-whatsapp').value.trim(),
            company: $('ev-company').value.trim(),
            business_type: category,
            message: $('ev-message').value.trim(),
            source: 'event-signup',
            'bot-field': (form.querySelector('[name="bot-field"]') || {}).value || ''
        };

        try {
            var res = await fetch('/.netlify/functions/submit-contact-sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('http_' + res.status);
            showDone();
        } catch (_) {
            // Never lose a lead silently at an event: say what to do next.
            formError.textContent = 'We could not register you just now — check your connection and tap Register again.';
            formError.classList.remove('hidden');
            formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            submitting = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register';
        }
    });

    function showDone() {
        $('form-view').classList.add('hidden');
        $('done-view').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        try { confetti(); } catch (_) { /* celebration is never load-bearing */ }
    }

    // ---- confetti ---------------------------------------------------------
    // Canvas rather than a library: no external script can load here anyway, and
    // ~40 lines beats a dependency on a page whose whole job is one form.
    function confetti() {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var cv = $('confetti');
        if (!cv || !cv.getContext) return;
        var ctx = cv.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        function size() {
            cv.width = window.innerWidth * dpr;
            cv.height = window.innerHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        size();
        window.addEventListener('resize', size);

        var COLORS = ['#EA580C', '#F59E0B', '#16A34A', '#3B82F6', '#8B5CF6'];
        var W = window.innerWidth, H = window.innerHeight;
        var bits = [];
        for (var i = 0; i < 110; i++) {
            bits.push({
                x: W / 2 + (Math.random() - 0.5) * W * 0.6,
                y: -20 - Math.random() * H * 0.3,
                w: 6 + Math.random() * 5,
                h: 9 + Math.random() * 7,
                c: COLORS[(Math.random() * COLORS.length) | 0],
                vx: (Math.random() - 0.5) * 2.4,
                vy: 2.4 + Math.random() * 3,
                rot: Math.random() * Math.PI,
                vr: (Math.random() - 0.5) * 0.22
            });
        }
        var start = Date.now();
        (function tick() {
            var elapsed = Date.now() - start;
            ctx.clearRect(0, 0, W, H);
            var alive = false;
            bits.forEach(function (b) {
                b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.vy += 0.045;
                if (b.y < H + 30) alive = true;
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.rot);
                ctx.globalAlpha = elapsed > 2600 ? Math.max(0, 1 - (elapsed - 2600) / 900) : 1;
                ctx.fillStyle = b.c;
                ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
                ctx.restore();
            });
            if (alive && elapsed < 3600) requestAnimationFrame(tick);
            else ctx.clearRect(0, 0, W, H);
        })();
    }
})();
