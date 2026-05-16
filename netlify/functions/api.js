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
