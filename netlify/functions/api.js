exports.handler = async (event, context) => {
    const path = event.path.replace('/.netlify/functions/api', '').replace('/api/v1', '');
    const method = event.httpMethod;

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    // --- ENDPOINTS ---

    // 1. Dashboard Summary
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

    // 2. Ledger
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

    // 3. Bills
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

    // 4. Brain Chat
    if (path === '/chat' && method === 'POST') {
        const { message } = JSON.parse(event.body);
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
