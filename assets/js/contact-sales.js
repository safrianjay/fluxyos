(function () {
    'use strict';
    var form = document.getElementById('contact-sales-form');
    if (!form) return;
    var button = document.getElementById('contact-submit'), error = document.getElementById('contact-error');
    var submitting = false;
    function showError(message) { error.textContent = message; error.classList.remove('hidden'); }
    var guard = window.FluxyLeadGuard.create(form, { counter: 'message-counter', widget: 'contact-verification', onError: showError });
    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (submitting) return;
        submitting = true;
        var label = button.textContent;
        error.classList.add('hidden'); button.disabled = true;
        var lang; try { lang = localStorage.getItem('fluxyos-lang'); } catch (_) {}
        button.textContent = lang === 'id' ? 'Mengirim…' : 'Sending…';
        try {
            var payload = await guard.protect(Object.fromEntries(new FormData(form).entries()));
            var response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
            var body = await response.json();
            if (!response.ok || !body.ok) { guard.serverError(body); throw new Error(body.error || 'server_error'); }
            document.getElementById('contact-form-block').classList.add('hidden');
            var success = document.getElementById('contact-success');
            success.classList.remove('hidden'); success.setAttribute('tabindex', '-1'); success.focus({ preventScroll: true });
            success.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        } catch (failure) {
            showError(guard.message(failure.message)); guard.reset();
        } finally { submitting = false; button.disabled = false; button.textContent = label; }
    });
})();
