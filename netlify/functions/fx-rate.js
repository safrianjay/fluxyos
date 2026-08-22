'use strict';

// FX rate lookup for invoice/bill payments — returns the BASE-currency-per-1-unit
// rate for a given transaction currency on a given date. Proxies the free, no-key
// Frankfurter API (ECB reference rates; historical dates supported). Called
// same-origin from the mark-paid flow, so no CSP/connect-src change is needed and
// the rate fetch stays off the client's network policy. Public data — no auth.
//
// The target used to be hardcoded to IDR, which made this unusable for any
// non-Indonesian workspace: a Philippine business needs USD->PHP, not USD->IDR.
// `to` is now any supported workspace BASE currency (mirrors BASE_SUPPORTED in
// assets/js/money-format.js); `from` is any transaction currency.
// Coverage verified against the provider on 2026-08-22 for PHP/MYR/SGD/IDR.

const ALLOWED = ['https://fluxyos.com', 'https://dashboard.fluxyos.com', 'https://www.fluxyos.com', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8765'];
// Transaction currencies a document may be denominated in.
const SOURCES = ['USD', 'SGD', 'IDR', 'PHP', 'MYR'];
// Workspace accounting currencies a rate may convert INTO.
const TARGETS = ['IDR', 'PHP', 'SGD', 'MYR'];

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const cors = {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : 'https://dashboard.fluxyos.com',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=3600',
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    const q = event.queryStringParameters || {};
    const from = String(q.from || '').toUpperCase();
    const to = String(q.to || 'IDR').toUpperCase();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? q.date : 'latest';

    if (!SOURCES.includes(from) || !TARGETS.includes(to)) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'unsupported_currency' }) };
    }
    // Same currency on both sides is not a conversion — never ask the provider,
    // and never let a stale published rate introduce drift into a 1:1 posting.
    if (from === to) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rate: 1, date, from, to, source: 'identity' }) };
    }

    async function fetchRate(when) {
        const url = `https://api.frankfurter.app/${when}?from=${from}&to=${to}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) return null;
            const data = await res.json();
            const rate = data && data.rates && Number(data.rates[to]);
            return rate > 0 ? { rate, date: data.date || when } : null;
        } catch (_) {
            return null;
        } finally {
            clearTimeout(t);
        }
    }

    try {
        // Try the exact date first; fall back to the latest published rate
        // (weekends/holidays have no ECB fixing).
        let result = await fetchRate(date);
        if (!result && date !== 'latest') result = await fetchRate('latest');
        if (!result) return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'rate_unavailable' }) };
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rate: result.rate, date: result.date, from, to, source: 'frankfurter' }) };
    } catch (e) {
        return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'rate_unavailable' }) };
    }
};
