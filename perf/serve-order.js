#!/usr/bin/env node
'use strict';
// =============================================================================
// perf/serve-order.js — order.fluxyos.com's page from THIS working tree, so a
// change to order.html can be measured on 4G against production's API, fonts
// and Cloud Storage before it ships. Pair with perf/waterfall.js --map.
//
//   node perf/serve-order.js [--port 8766] [--page path/to/order.html] [--doc-delay 800]
//
// HTTP/2 over TLS with a throwaway self-signed certificate (the browser is told
// to ignore it), brotli like Netlify, and the order site's one rewrite that
// matters: /t/* → the page. Everything under /assets comes from the tree.
// `--page` swaps the page file only — how an A/B against HEAD is run:
//   git show HEAD:order.html > perf/out/order.head.html
// =============================================================================

const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(flag('port', 8766));
const PAGE = path.resolve(flag('page', path.join(ROOT, 'order.html')));
// Holds the page's first byte back, the way production's connection setup and
// edge do (~0.8 s to first byte on the 4G profile, against ~0.01 s locally),
// so what happens WHILE the page downloads is ordered as it is in production.
const DOC_DELAY = Number(flag('doc-delay', 0));

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const KEY = path.join(OUT, 'serve-order.key');
const CERT = path.join(OUT, 'serve-order.crt');
if (!fs.existsSync(KEY) || !fs.existsSync(CERT)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
        '-subj', '/CN=order.fluxyos.com', '-keyout', KEY, '-out', CERT], { stdio: 'ignore' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

const server = http2.createSecureServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT), allowHTTP1: true });
server.on('request', (req, res) => {
    const url = new URL(req.url, 'https://order.fluxyos.com');
    let file;
    if (/^\/t\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.pathname === '/') file = PAGE;
    else file = path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) && file !== PAGE) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404); return res.end(); }
        const type = TYPES[path.extname(file)] || 'application/octet-stream';
        const headers = { 'content-type': type, 'cache-control': 'public,max-age=0,must-revalidate' };
        if (/text|javascript|json|svg/.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) {
            // Quality 5: about what Netlify's edge sends for order.html (78 KB vs 68 at 11).
            body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
            headers['content-encoding'] = 'br';
        }
        const send = () => { res.writeHead(200, headers); res.end(body); };
        if (file === PAGE && DOC_DELAY) setTimeout(send, DOC_DELAY); else send();
    });
});
server.listen(PORT, '127.0.0.1', () => console.log(`[serve-order] https://order.fluxyos.com → 127.0.0.1:${PORT} · page ${path.relative(ROOT, PAGE)}`));
