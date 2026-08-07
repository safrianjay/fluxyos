'use strict';

// Accounting package → single .xlsx workbook, one tab per statement.
//
// This function is a FORMATTER, not a reporting engine. It computes no balances,
// reads no Firestore, and knows nothing about accounting: the client posts the
// already-built row model from accounting.js `accountingPackageSheets()` — the
// same rows the CSV files serialize — and gets a workbook back. That keeps the
// ledger the only source of truth (PROJECT_STRATEGY §6): a second implementation
// of the statements here is exactly the "second source of truth" the accounting
// architecture forbids, and it would drift the first time a statement line changed.
//
// Why server-side at all: the app has no build step, so a client-side workbook
// writer would mean vendoring a bundled library into assets/. SheetJS is already
// a dependency, already bundled into a Netlify function
// (bank-statement-extract-background.js reads spreadsheets with it), so writing
// one costs no new supply chain.
//
// Amounts stay JS numbers all the way into the cells so Excel treats them as
// numbers, not text — an accountant has to be able to sum a column. Rupiah
// display formatting is deliberately NOT applied: the export contract is raw
// integer IDR (PROJECT_BACKGROUND §13), and a formatted string is not summable.

const XLSX = require('xlsx');

const ALLOWED_ORIGINS = [
    'https://fluxyos.com',
    'https://dashboard.fluxyos.com',
    'https://www.fluxyos.com',
    'http://localhost:8000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:8765',
];

// Bounds. The payload is user-influenced (a busy period's General Ledger can be
// large), and Netlify caps a function request at 6MB regardless — failing with a
// clear error beats being killed mid-write.
const MAX_SHEETS = 12;
const MAX_ROWS_PER_SHEET = 50000;
const MAX_COLS = 24;
const MAX_CELL_CHARS = 2000;

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1],
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Vary': 'Origin',
    };
}

function fail(headers, statusCode, error) {
    return {
        statusCode,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error }),
    };
}

// Same verification path as netlify/functions/api.js — the caller's own ID token
// against Identity Toolkit. This function returns only what the caller sent, so
// auth here is about not offering an open document-generation endpoint rather
// than about data access.
async function verifyFirebaseToken(token) {
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) return null;
    try {
        const res = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken: token }),
            }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.users?.[0] ?? null;
    } catch {
        return null;
    }
}

// Excel sheet-name rules: ≤31 chars, none of : \ / ? * [ ], and unique in the
// workbook. A collision or an illegal character throws inside SheetJS, so the
// names are sanitized here rather than trusted from the client.
function safeSheetName(raw, used) {
    let name = String(raw || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
    if (used.has(name.toLowerCase())) {
        const stem = name.slice(0, 28);
        let n = 2;
        while (used.has(`${stem} ${n}`.toLowerCase()) && n < 99) n += 1;
        name = `${stem} ${n}`;
    }
    used.add(name.toLowerCase());
    return name;
}

// Numbers stay numbers; everything else becomes a bounded string. `null` becomes
// an empty cell rather than the string "null".
function cell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value).slice(0, MAX_CELL_CHARS);
}

// The per-file CSV header, as leading rows on each tab. A reviewer opening one
// tab can still tell the period, the basis, and whether the books foot without
// going to another tab — the same reason pkgHeader() exists for the CSV files.
function headerRows(title, period, integrity) {
    const i = integrity || {};
    const range = period.start === period.end ? period.start : `${period.start} to ${period.end}`;
    return [
        ['Report', title],
        ['Period', range],
        ['Basis', 'Posted double-entry ledger (ledger_balances)'],
        ['Generated at', new Date().toISOString()],
        ['Trial balance', i.trialBalanced ? 'In balance' : 'OUT OF BALANCE'],
        ['Balance sheet tie-out', i.bsBalanced ? 'Balanced' : `Out by ${cell(i.bsDelta)}`],
        ['Cash flow tie-out', i.cfBalanced ? 'Ties to cash' : `Out by ${cell(i.cfDelta)}`],
        ['Amounts', 'Raw integer IDR — no formatting, no thousands separators'],
        [],
    ];
}

// Column widths from the widest cell, so an accountant does not open the file to
// a grid of ####. Capped so one long memo cannot push a column off screen.
function columnWidths(rows) {
    const widths = [];
    rows.forEach((row) => {
        (row || []).forEach((value, i) => {
            const len = String(value ?? '').length;
            if (!widths[i] || widths[i] < len) widths[i] = len;
        });
    });
    return widths.map((w) => ({ wch: Math.min(Math.max(w + 2, 10), 42) }));
}

function validate(payload) {
    if (!payload || typeof payload !== 'object') return 'Malformed request body.';
    const { period, sheets } = payload;
    if (!period || typeof period.start !== 'string' || typeof period.end !== 'string') {
        return 'A period with start and end is required.';
    }
    if (!Array.isArray(sheets) || sheets.length === 0) return 'At least one sheet is required.';
    if (sheets.length > MAX_SHEETS) return `Too many sheets (max ${MAX_SHEETS}).`;
    for (const sheet of sheets) {
        if (!sheet || !Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) {
            return 'Each sheet needs a columns array and a rows array.';
        }
        if (sheet.columns.length > MAX_COLS) return `Too many columns (max ${MAX_COLS}).`;
        if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
            return `Sheet "${String(sheet.title || '').slice(0, 40)}" exceeds ${MAX_ROWS_PER_SHEET} rows.`;
        }
        if (sheet.rows.some((r) => !Array.isArray(r))) return 'Each row must be an array of cells.';
    }
    return null;
}

exports.handler = async (event) => {
    const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
    const headers = corsHeaders(origin);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return fail(headers, 405, 'Method not allowed');

    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return fail(headers, 401, 'Sign in to export.');
    const user = await verifyFirebaseToken(token);
    if (!user) return fail(headers, 401, 'Your session expired. Sign in and try again.');

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return fail(headers, 400, 'Malformed request body.');
    }

    const invalid = validate(payload);
    if (invalid) return fail(headers, 400, invalid);

    const { period, integrity, sheets, filename } = payload;

    try {
        const book = XLSX.utils.book_new();
        const used = new Set();

        sheets.forEach((sheet) => {
            const body = [
                ...headerRows(sheet.title || 'Statement', period, integrity),
                sheet.columns.map(cell),
                ...sheet.rows.map((row) => row.slice(0, MAX_COLS).map(cell)),
            ];
            const ws = XLSX.utils.aoa_to_sheet(body);
            // Column widths are the one presentation hint the community build
            // honours. Freeze panes are not, so they are deliberately absent
            // rather than set to a key that silently does nothing.
            ws['!cols'] = columnWidths(body);
            XLSX.utils.book_append_sheet(book, ws, safeSheetName(sheet.title, used));
        });

        const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
        const safeName = String(filename || 'accounting_package.xlsx')
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .slice(0, 120);

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${safeName}"`,
                'Cache-Control': 'no-store',
            },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        console.error('[statements-xlsx] workbook build failed:', err);
        return fail(headers, 500, 'Could not build the workbook.');
    }
};
