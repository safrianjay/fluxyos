/* Background verification shared by both public lead forms. */
(function () {
    'use strict';
    var V = window.FluxyLeadValidation;
    var scriptPromise;
    function loadTurnstile() {
        if (window.turnstile) return Promise.resolve();
        if (!scriptPromise) scriptPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var timer = setTimeout(function () { script.remove(); scriptPromise = null; reject(new Error('verification_unavailable')); }, 15000);
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.onload = function () { clearTimeout(timer); if (window.turnstile) resolve(); else { scriptPromise = null; reject(new Error('verification_unavailable')); } };
            script.onerror = function () { clearTimeout(timer); script.remove(); scriptPromise = null; reject(new Error('verification_unavailable')); };
            document.head.appendChild(script);
        });
        return scriptPromise;
    }
    window.FluxyLeadGuard = { create: function (form, options) {
        var email = form.elements.email, message = form.elements.message;
        var counter = document.getElementById(options.counter);
        var container = document.getElementById(options.widget);
        var start = performance.now(), config, widget, token = '', ready, waiter, needsReset = false;
        function locale() { if (options.locale) return options.locale; try { return localStorage.getItem('fluxyos-lang') || 'en'; } catch (_) { return 'en'; } }
        function text(code) { return V.message(code, locale()); }
        function show(code) { options.onError(text(code)); }
        var emailError = document.createElement('p');
        emailError.id = email.id + '-validation';
        emailError.className = 'hidden text-[13px] text-red-600 mt-1.5';
        emailError.setAttribute('aria-live', 'polite');
        email.insertAdjacentElement('afterend', emailError);
        email.setAttribute('aria-describedby', ((email.getAttribute('aria-describedby') || '') + ' ' + emailError.id).trim());
        function emailCheck(complete) {
            var code = V.emailError(email.value.trim());
            if (!complete && code === 'invalid_email') code = '';
            email.setCustomValidity(code ? text(code) : '');
            email.toggleAttribute('aria-invalid', !!code);
            if (code) email.setAttribute('aria-invalid', 'true');
            emailError.textContent = code ? text(code) : '';
            emailError.classList.toggle('hidden', !code);
        }
        email.addEventListener('input', function () { emailCheck(false); });
        email.addEventListener('blur', function () { if (email.value) emailCheck(true); });
        Object.keys(V.LIMITS).forEach(function (name) {
            var field = form.elements[name];
            if (field && /^(INPUT|TEXTAREA)$/.test(field.tagName)) field.maxLength = V.LIMITS[name];
        });
        function count() {
            if (counter) counter.textContent = message.value.length + ' / ' + V.MESSAGE_MAX;
            message.setCustomValidity(message.value.length > V.MESSAGE_MAX ? text('message_too_long') : '');
        }
        message.addEventListener('input', count); count();
        form.addEventListener('input', function (event) {
            if (event.target !== email && event.target !== message) { event.target.setCustomValidity(''); event.target.removeAttribute('aria-invalid'); }
        });
        function serverError(body) {
            var field = body.field && form.elements[body.field];
            if (field && typeof field.setCustomValidity === 'function') {
                field.setCustomValidity(text(body.error)); field.setAttribute('aria-invalid', 'true');
                if (field === email) { emailError.textContent = text(body.error); emailError.classList.remove('hidden'); }
                field.focus();
            }
            show(body.error);
        }
        function reset() {
            token = ''; needsReset = false;
            if (widget !== undefined && window.turnstile) window.turnstile.reset(widget);
        }
        function failed(code) {
            token = ''; needsReset = true;
            if (waiter) { waiter.reject(new Error(code)); waiter = null; }
            show(code);
        }
        function init() {
            if (ready) return ready;
            ready = (async function () {
                var response = await fetch('/.netlify/functions/contact-form-config', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
                if (!response.ok) throw new Error('verification_unavailable');
                config = await response.json();
                if (!config.session || !config.nonce) throw new Error('verification_unavailable');
                if (config.mode === 'pending') { container.hidden = true; return; }
                if (!config.siteKey) throw new Error('verification_unavailable');
                container.hidden = false;
                await loadTurnstile();
                widget = window.turnstile.render(container, {
                    sitekey: config.siteKey, action: config.action, cData: config.nonce,
                    appearance: 'interaction-only', execution: 'render', theme: 'light',
                    size: container.clientWidth < 300 ? 'compact' : 'flexible',
                    'response-field': false, 'refresh-expired': 'auto',
                    callback: function (value) { token = value; if (waiter) { waiter.resolve(value); waiter = null; } },
                    'expired-callback': function () { token = ''; },
                    'error-callback': function () { failed('verification_unavailable'); return true; },
                    'timeout-callback': function () { failed('verification_failed'); }
                });
            })().catch(function (error) { ready = null; throw error; });
            return ready;
        }
        // Start while the prospect fills the form, not after pressing Submit.
        init().catch(function () { show('verification_unavailable'); });
        return {
            message: text, serverError: serverError, reset: reset,
            protect: async function (payload) {
                var checked = V.validate(payload);
                if (!checked.ok) { serverError(checked); throw new Error(checked.error); }
                if (config && Date.now() - config.issuedAt > 90 * 60 * 1000) {
                    if (widget !== undefined) window.turnstile.remove(widget);
                    widget = undefined; token = ''; ready = null;
                }
                try { await init(); } catch (_) { throw new Error('verification_unavailable'); }
                if (config.mode === 'pending') return Object.assign({}, payload, { form_session: config.session, completion_ms: Math.min(7200000, Math.round(performance.now() - start)) });
                if (!token) await new Promise(function (resolve, reject) {
                    var timer = setTimeout(function () { waiter = null; reject(new Error('verification_failed')); }, 90000);
                    waiter = { resolve: function () { clearTimeout(timer); resolve(); }, reject: function (error) { clearTimeout(timer); reject(error); } };
                    // Do not restart a challenge the visitor is already solving.
                    if (needsReset) reset();
                });
                return Object.assign({}, payload, { form_session: config.session, 'cf-turnstile-response': token, completion_ms: Math.min(7200000, Math.round(performance.now() - start)) });
            }
        };
    } };
})();
