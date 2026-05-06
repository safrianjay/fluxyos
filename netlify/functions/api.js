exports.handler = async (event, context) => {
    const path = event.path.replace('/.netlify/functions/api', '');
    const method = event.httpMethod;

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

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
    if (path === '/dashboard/ledger' && method === 'GET') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify([
                {
                    id: 1,
                    vendor_name: "TikTok Ads Pte Ltd",
                    amount: -4250000.0,
                    status: "Receipt Auto-Matched",
                    timestamp: new Date().toISOString(),
                    category_name: "Q3 Marketing",
                    entity_name: "E-Commerce Brand",
                    icon: "📢"
                },
                {
                    id: 2,
                    vendor_name: "Midtrans Settlement",
                    amount: 18420000.0,
                    status: "Cleared",
                    timestamp: new Date(Date.now() - 86400000).toISOString(),
                    category_name: "Revenue",
                    entity_name: "Global HQ",
                    icon: "M"
                },
                {
                    id: 3,
                    vendor_name: "AWS EMEA",
                    amount: -1850000.0,
                    status: "Missing Receipt",
                    timestamp: new Date(Date.now() - 86400000).toISOString(),
                    category_name: "IT & Server",
                    entity_name: "Global HQ",
                    icon: "💳"
                }
            ])
        };
    }

    // 3. Brain Chat
    if (path === '/brain/chat' && method === 'POST') {
        const { message } = JSON.parse(event.body);
        let response = "I'm FluxyOS Brain. I can help you analyze your transactions.";
        if (message.toLowerCase().includes('spend')) {
            response = "Your total OpEx this month is Rp 682M. The largest contributor is TikTok Ads.";
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                response,
                suggested_action: "View Insights"
            })
        };
    }

    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "Endpoint not found" })
    };
};
