// FluxyOS — Connection guard.
//
// An ad/privacy blocker (uBlock, AdGuard, Brave Shields, …) can block Firestore's
// realtime connection at the browser level (net::ERR_BLOCKED_BY_CLIENT), which
// silently breaks saves/live updates — a dead end for non-technical users who
// can't be expected to configure their browser. The app can't override the
// extension, so instead we DETECT the failure and show a clear, non-technical
// banner that guides the user to fix it.
//
// Detection is two-pronged:
//   1) REACTIVE — the Firestore SDK logs a console warning/error when it can't
//      reach the backend ("Could not reach Cloud Firestore backend",
//      "WebChannelConnection ... transport errored", "client is offline"). We
//      intercept those and surface the banner.
//   2) ACTIVE PROBE — some blockers (and net::ERR_BLOCKED_BY_CLIENT in
//      particular) kill the request at the network layer WITHOUT any
//      interceptable SDK console call, so the page just shows a silent
//      "0 data" / "Missing or insufficient permissions" dead end. To catch that
//      we fire ONE lightweight no-cors probe at firestore.googleapis.com on
//      load: a healthy network resolves it (opaque response), a blocked/offline
//      client rejects it — and only then do we show the banner. One request per
//      session, skipped once dismissed, so a healthy load stays quiet.
(function () {
    if (window.__fluxyConnGuard) return;
    window.__fluxyConnGuard = true;

    var DISMISS_KEY = 'fluxy_conn_block_dismissed';
    var shown = false;

    var FAILURE_RE = /could not reach cloud firestore backend|webchannelconnection .* transport errored|(listen|write) stream .* (transport errored|error)|client is offline|failed to reach|err_blocked_by_client/i;

    function buildBanner() {
        var bar = document.createElement('div');
        bar.id = 'fluxy-conn-banner';
        bar.setAttribute('role', 'alert');
        bar.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483646',
            'background:#0B0F19', 'color:#fff', 'box-shadow:0 6px 24px rgba(11,15,25,0.28)',
            'font-family:Inter,system-ui,sans-serif', 'padding:12px 16px'
        ].join(';');
        bar.innerHTML = ''
            + '<div style="max-width:1100px;margin:0 auto;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">'
            + '  <span style="flex-shrink:0;display:inline-flex;width:28px;height:28px;border-radius:8px;background:rgba(234,88,12,0.18);color:#FDBA74;align-items:center;justify-content:center">'
            + '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>'
            + '  </span>'
            + '  <div style="flex:1;min-width:220px">'
            + '    <p style="margin:0;font-size:13px;font-weight:700">FluxyOS is partly blocked by your browser</p>'
            + '    <p style="margin:3px 0 0;font-size:12px;color:#CBD5E1;line-height:1.45">An ad-blocker or privacy extension is stopping FluxyOS from saving and loading your data. Turn it off for this site, then reload.</p>'
            + '    <div id="fluxy-conn-steps" style="display:none;margin-top:8px;font-size:12px;color:#CBD5E1;line-height:1.6">'
            + '      <div>1. Click your ad-blocker or shield icon near the top-right of your browser.</div>'
            + '      <div>2. Turn it off for this site (fluxyos.com).</div>'
            + '      <div>3. Reload the page.</div>'
            + '      <div style="margin-top:4px;color:#94A3B8">Using Brave? Click the lion icon in the address bar and set Shields down for this site.</div>'
            + '    </div>'
            + '  </div>'
            + '  <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
            + '    <button id="fluxy-conn-how" type="button" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer">How to fix</button>'
            + '    <button id="fluxy-conn-reload" type="button" style="background:#fff;color:#0B0F19;border:0;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Reload</button>'
            + '    <button id="fluxy-conn-dismiss" type="button" aria-label="Dismiss" style="background:transparent;color:#94A3B8;border:0;font-size:18px;line-height:1;cursor:pointer;padding:4px">&times;</button>'
            + '  </div>'
            + '</div>';
        return bar;
    }

    function showBanner() {
        if (shown || document.getElementById('fluxy-conn-banner')) return;
        try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch (_) {}
        if (!document.body) { document.addEventListener('DOMContentLoaded', showBanner); return; }
        shown = true;
        var bar = buildBanner();
        document.body.appendChild(bar);
        bar.querySelector('#fluxy-conn-how').onclick = function () {
            var steps = bar.querySelector('#fluxy-conn-steps');
            steps.style.display = steps.style.display === 'none' ? 'block' : 'none';
        };
        bar.querySelector('#fluxy-conn-reload').onclick = function () { window.location.reload(); };
        bar.querySelector('#fluxy-conn-dismiss').onclick = function () {
            try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) {}
            bar.remove();
        };
    }

    function inspect(args) {
        try {
            var msg = Array.prototype.map.call(args, function (a) { return typeof a === 'string' ? a : (a && a.message) || ''; }).join(' ');
            if (FAILURE_RE.test(msg)) showBanner();
        } catch (_) { /* never let detection break logging */ }
    }

    // Intercept the SDK's connection-failure logs without swallowing them.
    ['error', 'warn'].forEach(function (level) {
        var orig = console[level] ? console[level].bind(console) : function () {};
        console[level] = function () { inspect(arguments); return orig.apply(console, arguments); };
    });

    // ACTIVE PROBE — catch network-layer blocks (net::ERR_BLOCKED_BY_CLIENT) that
    // never surface as an interceptable SDK console call. A no-cors fetch to the
    // Firestore host resolves with an opaque response on a healthy network (any
    // HTTP status counts as "reachable") and rejects only when the request is
    // blocked at the client/network layer or the device is offline. We fire it
    // once, after the SDK has had a beat to start, and skip it entirely once the
    // user has dismissed the banner.
    function probeFirestoreReachable() {
        try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch (_) {}
        if (shown || typeof fetch !== 'function') return;
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 6000) : null;
        // Use a stable 204 probe endpoint so an otherwise healthy network does not
        // generate a harmless 404 console error from the Firestore probe.
        fetch('https://www.gstatic.com/generate_204?_=' + Date.now(), {
            method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit',
            signal: ctrl ? ctrl.signal : undefined
        }).then(function () {
            // Reachable (opaque/any status) — the connection is fine. Do nothing.
            if (timer) clearTimeout(timer);
        }).catch(function () {
            // Rejected = blocked by an extension/network filter, or offline. This
            // is the silent "0 data" case; surface the actionable banner. (Abort
            // from our own timeout also lands here, which is the right call: a
            // Firestore probe that can't complete in 6s is a real connection
            // problem for a realtime app.)
            if (timer) clearTimeout(timer);
            showBanner();
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(probeFirestoreReachable, 1500); });
    } else {
        setTimeout(probeFirestoreReachable, 1500);
    }
})();
