'use strict';

// Bank Statement Import — extraction worker (Phase 2).
//
// A Netlify *background* function (name ends `-background`, ~15-min budget) so a
// large multi-page statement can be parsed without hitting the 10s synchronous
// limit. The client POSTs { importId } here right after uploading the file to
// Storage; Netlify returns 202 immediately and this runs detached. We write the
// result straight back to Firestore (the client watches the draft doc), so the
// return value is irrelevant.
//
// Flow: verify the caller's Firebase ID token -> load THEIR draft -> mark it
// processing -> download the stored file via the Admin SDK -> extract (text-based
// PDFs: local pdfjs text + parallel per-chunk OpenAI calls; scanned PDFs: one
// vision call; CSV/XLSX: deterministic SheetJS) -> validate balances -> flag
// possible duplicates against the existing ledger -> write the rows subcollection
// + patch the draft. The model only ever returns JSON; this function does every
// read/write. Statement contents are never logged.

const admin = require('firebase-admin');
const XLSX = require('xlsx');
const { initAdmin } = require('./lib/notify-core');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'fluxyos.firebasestorage.app';
// PDF extraction uses OpenAI (the same key that powers bill scanning), reading
// the PDF directly via the Responses API. The deterministic balance
// reconciliation below catches extraction errors regardless of model. Default
// gpt-4.1-mini for its 32K output window (a long statement's row JSON can exceed
// gpt-4o-mini's 16K cap and truncate); override with BANK_STATEMENT_AI_MODEL.
const AI_MODEL = process.env.BANK_STATEMENT_AI_MODEL || 'gpt-4.1-mini';
const MANUAL_REVIEW_MESSAGE = 'This statement needs manual review. We detected the file but could not extract reliable rows.';

const ALLOWED_CATEGORIES = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS', 'Others'];
const ALLOWED_TYPES = ['income', 'expense', 'transfer', 'refund', 'fee', 'tax'];

// ---- Rupiah / value helpers ------------------------------------------------

// Parse an Indonesian-formatted money cell into a raw integer (dots = thousands,
// comma = decimals). Returns null when there is no parseable number.
function parseRupiah(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Math.round(Math.abs(value));
    const cleaned = String(value).replace(/[^0-9,.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized;
    if (lastComma > lastDot) {
        // 1.234.567,89 -> 1234567.89
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
        // 1,234,567.89 or 1.234.567 (dot as thousands when 3-digit groups)
        normalized = cleaned.replace(/,/g, '');
        const parts = normalized.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            normalized = normalized.replace(/\./g, '');
        }
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : null;
}

// Coerce many date shapes (ISO, dd/mm/yyyy, Excel serial) to a JS Date or null.
function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        // Excel serial date (days since 1899-12-30).
        const d = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
        if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (m) {
        const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
        return new Date(Date.UTC(yr, +m[2] - 1, +m[1])); // dd/mm/yyyy (Indonesian)
    }
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const tsFromDate = (d) => (d ? admin.firestore.Timestamp.fromDate(d) : null);

function normalizeCategory(cat, type) {
    if (typeof cat === 'string' && ALLOWED_CATEGORIES.includes(cat)) return cat;
    return type === 'income' || type === 'refund' ? 'Revenue' : 'Operations';
}
function normalizeType(type, debit, credit) {
    if (typeof type === 'string' && ALLOWED_TYPES.includes(type)) return type;
    return (credit > 0 && !(debit > 0)) ? 'income' : 'expense';
}

// ---- Extraction: PDF via OpenAI -------------------------------------------
//
// Fast path: bank statement PDFs are almost always text-based, so we extract the
// page text locally (pdfjs, ~1s) and run several SMALL OpenAI calls in PARALLEL
// — one per ~5-page chunk — instead of one slow vision pass over the whole file.
// This takes extraction from ~3 minutes to well under a minute. Scanned/image
// PDFs (no extractable text) fall back to the single vision call.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHUNK_PAGES = 4; // pages per parallel extraction call (smaller = more parallelism = faster wall-clock)

// Slim per-chunk row schema — only the fields the model must read off the page.
// suggested_type/vendor/category are derived deterministically in JS afterward,
// which keeps output tokens (and latency) down.
const ROWS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        transactions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    transaction_date: { type: ['string', 'null'] },
                    description_raw: { type: ['string', 'null'] },
                    debit: { type: ['number', 'null'] },
                    credit: { type: ['number', 'null'] },
                    running_balance: { type: ['number', 'null'] },
                },
                required: ['transaction_date', 'description_raw', 'debit', 'credit', 'running_balance'],
            },
        },
    },
    required: ['transactions'],
};

const METADATA_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        bank_name: { type: ['string', 'null'] },
        account_holder: { type: ['string', 'null'] },
        account_number_masked: { type: ['string', 'null'] },
        statement_start_date: { type: ['string', 'null'] },
        statement_end_date: { type: ['string', 'null'] },
        opening_balance: { type: ['number', 'null'] },
        closing_balance: { type: ['number', 'null'] },
    },
    required: ['bank_name', 'account_holder', 'account_number_masked', 'statement_start_date', 'statement_end_date', 'opening_balance', 'closing_balance'],
};

// Full schema for the whole-file vision fallback (scanned PDFs).
const VISION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        statement_metadata: METADATA_SCHEMA,
        transactions: ROWS_SCHEMA.properties.transactions,
        validation_notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['statement_metadata', 'transactions', 'validation_notes'],
};

const ROWS_PROMPT = [
    'You extract transaction rows from the raw text of an Indonesian bank statement.',
    'Return EVERY transaction row in order. Rules:',
    '- Amounts are raw integers in IDR. Strip thousands dots and cents (e.g. "1.234.567,00" and "1,234,567.14" both -> 1234567). Never return formatted strings.',
    '- Each row has either a debit (DEBET / money out / Keluar) or a credit (KREDIT / money in / Masuk). Put 0 for the empty side.',
    '- Merge wrapped counterparty / "Berita:" / name lines into description_raw of the row they belong to.',
    '- IGNORE repeated page headers, column headers (TGL/URAIAN/DEBET/KREDIT/SALDO), bank/account header blocks, and any "Saldo Awal" opening-balance line — those are not transactions.',
    '- Dates as YYYY-MM-DD. Use the running balance (SALDO) column for running_balance.',
].join('\n');

const METADATA_PROMPT = [
    'Extract only the header metadata from this Indonesian bank statement text.',
    'Fields: bank_name, account_holder, account_number_masked (MASK it, e.g. "****7877" — never the full number), statement_start_date and statement_end_date (YYYY-MM-DD), opening_balance (the "Saldo Awal" value as a raw IDR integer — strip dots/cents).',
    'closing_balance: return null. Return null for any field that is genuinely absent. Never invent values.',
].join('\n');

// Pull the structured JSON string out of a Responses API payload.
function extractResponseText(payload) {
    if (typeof payload?.output_text === 'string' && payload.output_text) return payload.output_text;
    const output = payload?.output;
    if (!Array.isArray(output)) return null;
    for (const item of output) {
        const content = item?.content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.text?.value === 'string') return part.text.value;
        }
    }
    return null;
}

// One OpenAI Responses call with strict json_schema output + retry on transient
// gateway errors (429 / 5xx incl. Cloudflare 520, network aborts). Returns the
// parsed object.
async function callOpenAI(input, schema, schemaName, maxOut) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');
    const body = JSON.stringify({
        model: AI_MODEL,
        max_output_tokens: maxOut,
        input,
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
    });

    let payload = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 240000);
        let res;
        try {
            res = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                signal: controller.signal,
                body,
            });
        } catch (e) {
            lastErr = `network ${e && e.message ? e.message : e}`;
            if (attempt < 3) { await sleep(attempt * 2500); continue; }
            throw new Error(`OpenAI request failed after retries: ${lastErr}`);
        } finally {
            clearTimeout(timeout);
        }
        if (res.status === 429 || res.status >= 500) {
            lastErr = `HTTP ${res.status}`;
            console.warn('[bank-statement-extract] transient', lastErr, 'attempt', attempt);
            if (attempt < 3) { await sleep(attempt * 2500); continue; }
            throw new Error(`OpenAI transient error after retries: ${lastErr}`);
        }
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        payload = await res.json();
        break;
    }
    if (payload?.status === 'incomplete') {
        throw new Error(`extraction_incomplete:${payload?.incomplete_details?.reason || 'unknown'}`);
    }
    const text = extractResponseText(payload);
    if (!text) throw new Error('extraction_empty');
    try { return JSON.parse(text); } catch (_) { throw new Error('extraction_unparseable'); }
}

function deriveType(description, debit, credit) {
    const d = String(description || '').toLowerCase();
    if (/pajak|\btax\b|pph|ppn/.test(d)) return 'tax';
    if (/biaya admin|admin fee|\bfee\b|charge|biaya/.test(d)) return 'fee';
    return (credit > 0 && !(debit > 0)) ? 'income' : 'expense';
}

// Normalize a slim model row into the shape the rest of the function consumes.
// suggested_* are derived here (vendor falls back to the description at confirm).
function normalizeRow(r) {
    const debit = r.debit == null ? 0 : Math.round(Math.abs(Number(r.debit) || 0));
    const credit = r.credit == null ? 0 : Math.round(Math.abs(Number(r.credit) || 0));
    const desc = r.description_raw ? String(r.description_raw).trim() : null;
    return {
        transaction_date: toDate(r.transaction_date),
        description_raw: desc,
        debit,
        credit,
        running_balance: r.running_balance == null ? null : Math.round(Number(r.running_balance)),
        suggested_vendor_name: null,
        suggested_category: null,
        suggested_type: deriveType(desc, debit, credit),
        confidence: null,
    };
}

async function extractPdfText(buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        pages.push(tc.items.map((it) => it.str).join(' '));
    }
    try { await doc.destroy(); } catch (_) { /* ignore */ }
    return pages;
}

// Whole-file vision fallback (scanned / image-only PDFs).
async function extractWithOpenAIVision(buffer, mediaType, fileName) {
    const dataUrl = `data:${mediaType};base64,${buffer.toString('base64')}`;
    const input = [
        { role: 'system', content: [{ type: 'input_text', text: `${METADATA_PROMPT}\n\n${ROWS_PROMPT}` }] },
        {
            role: 'user',
            content: [
                { type: 'input_text', text: 'Extract statement_metadata and all transaction rows as structured JSON.' },
                { type: 'input_file', filename: fileName || 'statement.pdf', file_data: dataUrl },
            ],
        },
    ];
    const parsed = await callOpenAI(input, VISION_SCHEMA, 'bank_statement', 32000);
    const meta = parsed.statement_metadata || {};
    const rows = (Array.isArray(parsed.transactions) ? parsed.transactions : []).map(normalizeRow);
    const lastBal = [...rows].reverse().find((r) => r.running_balance != null);
    return {
        metadata: {
            bank_name: meta.bank_name || null,
            account_holder: meta.account_holder || null,
            account_number_masked: meta.account_number_masked || null,
            statement_start_date: toDate(meta.statement_start_date),
            statement_end_date: toDate(meta.statement_end_date),
            opening_balance: meta.opening_balance == null ? null : Math.round(Number(meta.opening_balance)),
            closing_balance: meta.closing_balance != null ? Math.round(Number(meta.closing_balance)) : (lastBal ? lastBal.running_balance : null),
        },
        rows,
    };
}

// Primary PDF path: local text extraction + parallel per-chunk row calls.
async function extractFromPdf(buffer, fileName) {
    let pages = [];
    try { pages = await extractPdfText(buffer); } catch (e) {
        console.warn('[bank-statement-extract] pdf text extraction failed, using vision:', e && e.message ? e.message : e);
    }
    const avgChars = pages.length ? pages.reduce((a, p) => a + p.length, 0) / pages.length : 0;
    if (pages.length === 0 || avgChars < 40) {
        console.log('[bank-statement-extract] sparse text (avg', Math.round(avgChars), 'chars/pg) -> vision fallback');
        return extractWithOpenAIVision(buffer, 'application/pdf', fileName);
    }
    console.log('[bank-statement-extract]', pages.length, 'pages, avg', Math.round(avgChars), 'chars/pg -> parallel text chunks');

    const chunks = [];
    for (let i = 0; i < pages.length; i += CHUNK_PAGES) chunks.push(pages.slice(i, i + CHUNK_PAGES).join('\n\n'));

    const metaInput = [
        { role: 'system', content: [{ type: 'input_text', text: METADATA_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: pages.slice(0, 2).join('\n\n') }] },
    ];
    const rowInputs = chunks.map((text) => ([
        { role: 'system', content: [{ type: 'input_text', text: ROWS_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text }] },
    ]));

    // One metadata call + N row-chunk calls, all in parallel.
    const [metaRes, ...rowResults] = await Promise.all([
        callOpenAI(metaInput, METADATA_SCHEMA, 'metadata', 2000),
        ...rowInputs.map((inp) => callOpenAI(inp, ROWS_SCHEMA, 'rows', 8000)),
    ]);

    const rows = [];
    rowResults.forEach((r) => {
        (Array.isArray(r.transactions) ? r.transactions : []).forEach((t) => rows.push(normalizeRow(t)));
    });

    const meta = metaRes || {};
    const lastBal = [...rows].reverse().find((r) => r.running_balance != null);
    return {
        metadata: {
            bank_name: meta.bank_name || null,
            account_holder: meta.account_holder || null,
            account_number_masked: meta.account_number_masked || null,
            statement_start_date: toDate(meta.statement_start_date),
            statement_end_date: toDate(meta.statement_end_date),
            opening_balance: meta.opening_balance == null ? null : Math.round(Number(meta.opening_balance)),
            closing_balance: meta.closing_balance != null ? Math.round(Number(meta.closing_balance)) : (lastBal ? lastBal.running_balance : null),
        },
        rows,
    };
}

// ---- Extraction: CSV / XLSX via SheetJS (deterministic) --------------------

const HEADER_HINTS = {
    date: ['tgl', 'tanggal', 'date', 'posting', 'transaction date', 'tgl trans'],
    description: ['uraian', 'description', 'keterangan', 'desc', 'berita', 'remark', 'narrative'],
    debit: ['debet', 'debit', 'keluar', 'dr', 'withdrawal'],
    credit: ['kredit', 'credit', 'masuk', 'cr', 'deposit'],
    balance: ['saldo', 'balance', 'running'],
};

function matchColumn(headers, hints) {
    for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] || '').toLowerCase().trim();
        if (hints.some((hint) => h.includes(hint))) return i;
    }
    return -1;
}

function extractFromSpreadsheet(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    if (!grid.length) throw new Error('empty_spreadsheet');

    // Find the header row (the first row that maps a date + at least one amount column).
    let headerIdx = -1; let cols = null;
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
        const c = {
            date: matchColumn(grid[i], HEADER_HINTS.date),
            description: matchColumn(grid[i], HEADER_HINTS.description),
            debit: matchColumn(grid[i], HEADER_HINTS.debit),
            credit: matchColumn(grid[i], HEADER_HINTS.credit),
            balance: matchColumn(grid[i], HEADER_HINTS.balance),
        };
        if (c.date >= 0 && (c.debit >= 0 || c.credit >= 0)) { headerIdx = i; cols = c; break; }
    }
    if (headerIdx < 0 || !cols) throw new Error('no_header');

    const rows = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const r = grid[i];
        const date = toDate(r[cols.date]);
        const debit = cols.debit >= 0 ? (parseRupiah(r[cols.debit]) || 0) : 0;
        const credit = cols.credit >= 0 ? (parseRupiah(r[cols.credit]) || 0) : 0;
        if (!date && !debit && !credit) continue; // skip blank / summary lines
        rows.push({
            transaction_date: date,
            description_raw: cols.description >= 0 ? String(r[cols.description] || '').trim().slice(0, 500) || null : null,
            debit, credit,
            running_balance: cols.balance >= 0 ? parseRupiah(r[cols.balance]) : null,
            suggested_vendor_name: null, suggested_category: null, suggested_type: null, confidence: null,
        });
    }
    if (!rows.length) throw new Error('no_rows');
    return { metadata: { bank_name: null, account_holder: null, account_number_masked: null, statement_start_date: null, statement_end_date: null, opening_balance: null, closing_balance: null }, rows };
}

// ---- Validation + duplicate detection -------------------------------------

function reconcile(metadata, rows) {
    let totalDebit = 0; let totalCredit = 0;
    rows.forEach((r) => { totalDebit += r.debit || 0; totalCredit += r.credit || 0; });

    let balanceCheck = 'unavailable';
    if (metadata.opening_balance != null && metadata.closing_balance != null) {
        balanceCheck = (metadata.opening_balance + totalCredit - totalDebit === metadata.closing_balance) ? 'passed' : 'failed';
    }
    // Per-row running balance check.
    let runningCheck = 'unavailable';
    const haveRunning = rows.length > 0 && rows.every((r) => r.running_balance != null);
    if (haveRunning && metadata.opening_balance != null) {
        runningCheck = 'passed';
        let prev = metadata.opening_balance;
        for (const r of rows) {
            const expected = prev + (r.credit || 0) - (r.debit || 0);
            if (expected !== r.running_balance) { runningCheck = 'failed'; r._running_mismatch = true; }
            prev = r.running_balance;
        }
    }
    return { totalDebit, totalCredit, balanceCheck, runningCheck };
}

// Flag rows that look like an existing ledger transaction: same amount + same
// direction within +/- 2 days. Reads only the statement period to stay cheap.
async function detectDuplicates(db, uid, rows, metadata) {
    const start = metadata.statement_start_date || rows.map((r) => r.transaction_date).filter(Boolean).sort((a, b) => a - b)[0];
    const end = metadata.statement_end_date || rows.map((r) => r.transaction_date).filter(Boolean).sort((a, b) => b - a)[0];
    if (!start || !end) return;
    let existing = [];
    try {
        const snap = await db.collection(`users/${uid}/transactions`)
            .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(new Date(start.getTime() - 2 * 86400000)))
            .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(new Date(end.getTime() + 2 * 86400000)))
            .get();
        existing = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (_) { return; }
    const DAY = 86400000;
    for (const r of rows) {
        if (!r.transaction_date) continue;
        const amount = r.credit > 0 ? r.credit : r.debit;
        const incoming = r.credit > 0;
        const hit = existing.find((tx) => {
            const txMs = tx.timestamp && tx.timestamp.toMillis ? tx.timestamp.toMillis() : null;
            if (txMs == null) return false;
            if (Math.abs(txMs - r.transaction_date.getTime()) > 2 * DAY) return false;
            if (Math.round(Math.abs(Number(tx.amount) || 0)) !== amount) return false;
            const txIncome = ['income', 'revenue', 'refund', 'pending_receivable'].includes(String(tx.type));
            return txIncome === incoming;
        });
        if (hit) { r._duplicate = true; r._matched_transaction_id = hit.id; }
    }
}

// ---- Firestore write -------------------------------------------------------

async function writeResults(db, draftRef, metadata, rows, recon) {
    const FV = admin.firestore.FieldValue;
    const rowsCol = draftRef.collection('rows');
    let duplicateCount = 0; let needsReviewCount = 0;

    // Chunk row writes (Admin batch hard limit = 500 ops).
    for (let i = 0; i < rows.length; i += 450) {
        const batch = db.batch();
        rows.slice(i, i + 450).forEach((r, j) => {
            const isDup = !!r._duplicate;
            const needsReview = !!r._running_mismatch || (!r.transaction_date) || (r.debit === 0 && r.credit === 0);
            if (isDup) duplicateCount += 1;
            if (needsReview && !isDup) needsReviewCount += 1;
            const type = normalizeType(r.suggested_type, r.debit, r.credit);
            batch.set(rowsCol.doc(), {
                row_index: i + j,
                transaction_date: tsFromDate(r.transaction_date),
                posting_date: null,
                description_raw: r.description_raw ? String(r.description_raw).slice(0, 500) : null,
                debit: r.debit || 0,
                credit: r.credit || 0,
                running_balance: r.running_balance == null ? null : r.running_balance,
                suggested_vendor_name: r.suggested_vendor_name ? String(r.suggested_vendor_name).slice(0, 160) : null,
                suggested_category: normalizeCategory(r.suggested_category, type),
                suggested_type: type,
                match_status: isDup ? 'possible_duplicate' : (needsReview ? 'needs_review' : 'new'),
                matched_transaction_id: r._matched_transaction_id || null,
                confidence: r.confidence,
                selected_for_import: !isDup, // duplicates default to OFF
                review_status: 'pending',
                created_transaction_id: null,
                created_at: FV.serverTimestamp(),
            });
        });
        await batch.commit();
    }

    await draftRef.update({
        extraction_status: 'completed',
        review_status: recon.balanceCheck === 'failed' || needsReviewCount > 0 ? 'needs_review' : 'ready_to_import',
        bank_name: metadata.bank_name,
        account_holder: metadata.account_holder,
        account_number_masked: metadata.account_number_masked,
        statement_start_date: tsFromDate(metadata.statement_start_date),
        statement_end_date: tsFromDate(metadata.statement_end_date),
        opening_balance: metadata.opening_balance,
        closing_balance: metadata.closing_balance,
        total_debit: recon.totalDebit,
        total_credit: recon.totalCredit,
        row_count: rows.length,
        balance_check_status: recon.balanceCheck,
        running_balance_check_status: recon.runningCheck,
        duplicate_count: duplicateCount,
        needs_review_count: needsReviewCount,
        updated_at: FV.serverTimestamp(),
    });
}

// ---- Handler ---------------------------------------------------------------

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    let db; let draftRef = null;
    try {
        const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
        const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
        if (!token) return { statusCode: 401, body: 'missing token' };

        db = initAdmin();
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;
        const importId = String((JSON.parse(event.body || '{}').importId) || '').slice(0, 200);
        if (!importId) return { statusCode: 400, body: 'missing importId' };

        draftRef = db.doc(`users/${uid}/bank_statement_imports/${importId}`);
        const snap = await draftRef.get();
        if (!snap.exists) return { statusCode: 404, body: 'not found' };
        const draft = snap.data() || {};
        if (!draft.storage_path) { await draftRef.update({ extraction_status: 'failed', updated_at: admin.firestore.FieldValue.serverTimestamp() }); return { statusCode: 400, body: 'no file' }; }

        await draftRef.update({ extraction_status: 'processing', updated_at: admin.firestore.FieldValue.serverTimestamp() });

        const [buffer] = await admin.storage().bucket(STORAGE_BUCKET).file(draft.storage_path).download();
        const mime = String(draft.file_mime_type || '');
        const name = String(draft.file_name || '').toLowerCase();

        const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
        console.log('[bank-statement-extract] start', importId, '| pdf:', isPdf, '| model:', AI_MODEL);
        const extracted = isPdf ? await extractFromPdf(buffer, draft.file_name) : extractFromSpreadsheet(buffer);
        console.log('[bank-statement-extract] extracted rows:', extracted.rows.length);

        const recon = reconcile(extracted.metadata, extracted.rows);
        await detectDuplicates(db, uid, extracted.rows, extracted.metadata);
        await writeResults(db, draftRef, extracted.metadata, extracted.rows, recon);

        return { statusCode: 200, body: 'ok' };
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error('[bank-statement-extract] failed:', (err && err.status) || '', msg);
        if (draftRef) {
            try {
                await draftRef.update({
                    extraction_status: 'failed',
                    review_status: 'needs_review',
                    updated_at: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (_) { /* ignore */ }
        }
        return { statusCode: 200, body: msg };
    }
};

exports.MANUAL_REVIEW_MESSAGE = MANUAL_REVIEW_MESSAGE;
