// FluxyOS — Connection guard.
//
// An ad/privacy blocker (uBlock, AdGuard, Brave Shields, …) can block Firestore's
// realtime connection at the browser level (net::ERR_BLOCKED_BY_CLIENT). The app
// can't override the extension, so instead we DETECT the block and show a clear,
// non-technical banner that guides the user to fix it — rather than leaving them
// stuck on cryptic "permission denied" save errors.
//
// Detection: a one-shot no-cors probe to the exact Firestore channel endpoint the
// blocklists target. If the extension blocks it, fetch rejects (and the real SDK
// connection is blocked too); a reachable server resolves (even on an error
// status, since the response is opaque under no-cors).
(function () {
    if (window.__fluxyConnGuard) return;
    window.__fluxyConnGuard = true;

    var PROJECT = 'fluxyos';
    var DISMISS_KEY = 'fluxy_conn_block_dismissed';
    var CHANNEL_URL = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel'
        + '?database=projects%2F' + PROJECT + '%2Fdatabases%2F(default)&gsessionid=probe&VER=8&RID=0&t=1';

    function probeBlocked() {
        // Resolves true if the channel endpoint is blocked client-side.
        return fetch(CHANNEL_URL, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
            .then(function () { return false; })
            .catch(function () { return true; });
    }

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
        if (document.getElementById('fluxy-conn-banner')) return;
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

    function check() {
        if (!navigator.onLine) return;
        try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch (_) {}
        probeBlocked().then(function (blocked) { if (blocked) showBanner(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', check);
    } else {
        check();
    }
})();
