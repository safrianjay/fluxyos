const ALLOWED_ORIGINS = [
    'https://fluxyos.com',
    'https://www.fluxyos.com',
    'http://localhost:8000',
    'http://127.0.0.1:5500',
];

const MAX_MESSAGE_LENGTH = 500;

function getCorsHeaders(requestOrigin) {
    const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json',
        'Vary': 'Origin',
    };
}

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

function extractToken(event) {
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
}

exports.handler = async (event) => {
    const path = event.path.replace('/.netlify/functions/api', '').replace('/api/v1', '');
    const method = event.httpMethod;
    const requestOrigin = event.headers?.origin || event.headers?.Origin || '';
    const headers = getCorsHeaders(requestOrigin);

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    // Verify Firebase ID token on all non-OPTIONS requests
    const token = extractToken(event);
    if (!token) {
        return { statusCode: 401, headers, body: JSON.stringify({ message: 'Missing authorization token' }) };
    }
    const user = await verifyFirebaseToken(token);
    if (!user) {
        return { statusCode: 401, headers, body: JSON.stringify({ message: 'Invalid or expired token' }) };
    }

    // --- ENDPOINTS ---

    if (path === '/dashboard/summary' && method === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                revenue: "Rp 2.845M",
                revenue_change: "14.2%",
                opex: "Rp 682M",
                margin: 76.0,
                action_items_count: 5,
                action_items_details: "3 Missing Receipts • 2 Approvals"
            })
        };
    }

    if (path === '/ledger' && method === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify([
                { date: 'May 04, 2024', desc: 'Amazon Web Services', cat: 'Infrastructure', amount: '-Rp 12.500.000', status: 'Completed' },
                { date: 'May 03, 2024', desc: 'Client Payment #9921', cat: 'Revenue', amount: '+Rp 85.000.000', status: 'Completed' },
                { date: 'May 02, 2024', desc: 'Google Adwords', cat: 'Marketing', amount: '-Rp 4.200.000', status: 'Pending' },
                { date: 'May 01, 2024', desc: 'WeWork Office Rent', cat: 'Operations', amount: '-Rp 45.000.000', status: 'Completed' }
            ])
        };
    }

    if (path === '/bills' && method === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify([
                { vendor: 'AWS Cloud Services', amount: 'Rp 12.500.000', due: 'May 15, 2024', status: 'Pending' },
                { vendor: 'Google Workspace', amount: 'Rp 1.200.000', due: 'May 18, 2024', status: 'Paid' },
                { vendor: 'Office Rent (May)', amount: 'Rp 45.000.000', due: 'May 10, 2024', status: 'Overdue' }
            ])
        };
    }

    if (path === '/bills/extract' && method === 'POST') {
        return extractBill(event, headers);
    }

    if (path === '/chat' && method === 'POST') {
        let message;
        try {
            const body = JSON.parse(event.body || '{}');
            message = typeof body.message === 'string' ? body.message.trim() : '';
        } catch {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
        }

        if (!message) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'message is required' }) };
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }) };
        }

        let reply = "I'm FluxyOS Brain. I can help you analyze your financial data.";
        const msg = message.toLowerCase();
        if (msg.includes('spend') || msg.includes('opex')) {
            reply = "You spent Rp 682M this month. Your biggest expense was WeWork Office Rent (Rp 45M).";
        } else if (msg.includes('revenue')) {
            reply = "Your revenue is up 14.2% this month, totaling Rp 2.845M!";
        } else if (msg.includes('bill')) {
            reply = "You have 3 upcoming bills. The next one is Office Rent due on May 10th.";
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply })
        };
    }

    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: `Endpoint not found: ${path}` })
    };
};

// ── Bill Extraction ───────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CATEGORIES = ['Revenue', 'Marketing', 'Infrastructure', 'Operations', 'SaaS'];

function errorResponse(headers, status, code, message) {
    return {
        statusCode: status,
        headers,
        body: JSON.stringify({ ok: false, error: { code, message } }),
    };
}

async function extractBill(event, headers) {
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return errorResponse(headers, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const { file_base64, mime_type, file_name, size_bytes } = body || {};
    if (!file_base64 || typeof file_base64 !== 'string') {
        return errorResponse(headers, 400, 'MISSING_FILE', 'file_base64 is required.');
    }
    if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
        return errorResponse(headers, 415, 'UNSUPPORTED_MIME', 'Unsupported file type.');
    }
    if (typeof size_bytes === 'number' && size_bytes > MAX_FILE_BYTES) {
        return errorResponse(headers, 413, 'FILE_TOO_LARGE', 'File is too large.');
    }
    if (file_base64.length > MAX_FILE_BYTES * 1.5) {
        return errorResponse(headers, 413, 'FILE_TOO_LARGE', 'Encoded payload exceeds limit.');
    }

    console.log(`[bills/extract] file=${file_name} mime=${mime_type} size=${size_bytes}`);

    if (!process.env.OPENAI_API_KEY) {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                extraction_source: 'mock',
                data: buildMockExtraction(file_name),
            }),
        };
    }

    try {
        const data = await callOpenAIVision({ file_base64, mime_type, file_name });
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                extraction_source: 'openai',
                data: sanitizeExtraction(data),
            }),
        };
    } catch (err) {
        console.error('[bills/extract] OpenAI call failed:', err?.message || err);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                extraction_source: 'mock',
                data: buildMockExtraction(file_name),
                warnings: ['Live extraction unavailable — showing sample data.'],
            }),
        };
    }
}

function buildMockExtraction(fileName) {
    const stem = (fileName || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Sample Vendor';
    return {
        document_type: 'invoice',
        vendor_name: stem.slice(0, 60),
        amount: 1250000,
        currency: 'IDR',
        due_date: null,
        invoice_date: null,
        invoice_number: null,
        category: 'Operations',
        confidence: { overall: 0.5, vendor_name: 0.5, amount: 0.6, due_date: 0.3, category: 0.4 },
        warnings: ['Bill scanning provider not configured — showing sample data.'],
        raw_text_preview: null,
    };
}

const BILL_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        document_type: { type: 'string', enum: ['bill', 'invoice', 'receipt', 'payment_request', 'unknown'] },
        vendor_name: { type: ['string', 'null'] },
        amount: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
        invoice_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
        invoice_number: { type: ['string', 'null'] },
        category: { type: 'string', enum: ALLOWED_CATEGORIES },
        confidence: {
            type: 'object',
            additionalProperties: false,
            properties: {
                overall: { type: 'number' },
                vendor_name: { type: 'number' },
                amount: { type: 'number' },
                due_date: { type: 'number' },
                category: { type: 'number' },
            },
            required: ['overall', 'vendor_name', 'amount', 'due_date', 'category'],
        },
        warnings: { type: 'array', items: { type: 'string' } },
        raw_text_preview: { type: ['string', 'null'] },
    },
    required: [
        'document_type', 'vendor_name', 'amount', 'currency',
        'due_date', 'invoice_date', 'invoice_number', 'category',
        'confidence', 'warnings', 'raw_text_preview'
    ],
};

const EXTRACTION_SYSTEM_PROMPT = `You are a financial document extraction engine for FluxyOS, an Indonesian business finance platform.

Extract structured bill data from the document. Return only fields you can confidently read from the document; use null when uncertain. Never invent values.

Rules:
- amount must be a raw integer (no currency symbol, no separators). Prefer the total amount due / grand total / amount payable. Never confuse subtotal, tax, or unit price with the total.
- Normalize Indonesian Rupiah formats: "Rp 1.250.000" -> 1250000, "IDR 1,250,000" -> 1250000, "1.250.000,00" -> 1250000.
- Default currency to "IDR" only when the document uses Rp / IDR / Indonesian language.
- due_date must be explicit on the document (Due Date, Pay Before, Jatuh Tempo, Batas Pembayaran, Payment Due). Do not infer from invoice_date.
- Dates must be YYYY-MM-DD strings or null.
- category must be one of Revenue, Marketing, Infrastructure, Operations, SaaS. If uncertain, use Operations and set category confidence below 0.7.
- confidence scores are 0..1.
- raw_text_preview: first ~300 chars of visible text, or null.
- Add a warning string for any field you had to guess.`;

async function callOpenAIVision({ file_base64, mime_type, file_name }) {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_BILL_MODEL || 'gpt-4o-mini';
    const dataUrl = `data:${mime_type};base64,${file_base64}`;
    const isPdf = mime_type === 'application/pdf';

    const userContent = [
        { type: 'input_text', text: 'Extract the bill fields from this document.' },
    ];
    if (isPdf) {
        userContent.push({
            type: 'input_file',
            filename: file_name || 'bill.pdf',
            file_data: dataUrl,
        });
    } else {
        userContent.push({ type: 'input_image', image_url: dataUrl });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let res;
    try {
        res = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                input: [
                    { role: 'system', content: [{ type: 'input_text', text: EXTRACTION_SYSTEM_PROMPT }] },
                    { role: 'user', content: userContent },
                ],
                text: {
                    format: {
                        type: 'json_schema',
                        name: 'bill_extraction',
                        schema: BILL_JSON_SCHEMA,
                        strict: true,
                    },
                },
            }),
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const payload = await res.json();
    const text = extractResponseText(payload);
    if (!text) throw new Error('OpenAI returned empty content');
    return JSON.parse(text);
}

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

function sanitizeExtraction(data) {
    if (!data || typeof data !== 'object') return buildMockExtraction(null);
    const category = ALLOWED_CATEGORIES.includes(data.category) ? data.category : 'Operations';
    const confidence = data.confidence && typeof data.confidence === 'object' ? data.confidence : {};
    return {
        document_type: typeof data.document_type === 'string' ? data.document_type : 'unknown',
        vendor_name: typeof data.vendor_name === 'string' ? data.vendor_name : null,
        amount: typeof data.amount === 'number' ? Math.round(data.amount) : null,
        currency: typeof data.currency === 'string' ? data.currency : 'IDR',
        due_date: typeof data.due_date === 'string' ? data.due_date : null,
        invoice_date: typeof data.invoice_date === 'string' ? data.invoice_date : null,
        invoice_number: typeof data.invoice_number === 'string' ? data.invoice_number : null,
        category,
        confidence: {
            overall: numOrZero(confidence.overall),
            vendor_name: numOrZero(confidence.vendor_name),
            amount: numOrZero(confidence.amount),
            due_date: numOrZero(confidence.due_date),
            category: numOrZero(confidence.category),
        },
        warnings: Array.isArray(data.warnings) ? data.warnings.filter(s => typeof s === 'string').slice(0, 6) : [],
        raw_text_preview: typeof data.raw_text_preview === 'string' ? data.raw_text_preview.slice(0, 500) : null,
    };
}

function numOrZero(n) {
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
