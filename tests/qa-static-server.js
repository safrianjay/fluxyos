#!/usr/bin/env node
/**
 * Tiny static server for the Playwright QA harness.
 *
 * Mirrors Netlify's `cleanUrls`/`prettyUrls` behavior: a request to
 * `/dashboard` (no extension) is served from `dashboard.html`. Without
 * this, login's redirect to `/dashboard` 404s under `python3 -m http.server`.
 *
 * Bound to 127.0.0.1:8765 by default. Override with QA_SERVER_PORT.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.QA_SERVER_PORT || 8765);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.pdf': 'application/pdf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

function safeJoin(root, reqPath) {
    const resolved = path.resolve(root, '.' + reqPath);
    if (!resolved.startsWith(root)) return null;
    return resolved;
}

function tryStat(file) {
    try { return fs.statSync(file); } catch { return null; }
}

function resolveFile(reqPath) {
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const decoded = decodeURIComponent(reqPath);
    const direct = safeJoin(ROOT, decoded);
    if (!direct) return null;
    let stat = tryStat(direct);
    if (stat?.isFile()) return direct;
    if (stat?.isDirectory()) {
        const indexHtml = path.join(direct, 'index.html');
        if (tryStat(indexHtml)?.isFile()) return indexHtml;
    }
    // Netlify clean-URL: try `.html`
    const htmlFallback = direct.replace(/\/$/, '') + '.html';
    if (tryStat(htmlFallback)?.isFile()) return htmlFallback;
    return null;
}

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || '/');
    const file = resolveFile(parsed.pathname || '/');
    if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[qa-static-server] serving ${ROOT} at http://127.0.0.1:${PORT}`);
});
