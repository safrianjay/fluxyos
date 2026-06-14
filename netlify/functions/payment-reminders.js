'use strict';

// Scheduled every 5 minutes. Two billing-payment nudges:
//  - submitted (pending_verification) → "Payment received — under review" (near-immediate)
//  - still on the QR screen (awaiting_payment, 3–26h old) → "finish your payment"
// Schedule-only; gated by NOTIFY_ENABLED.
const { schedule } = require('@netlify/functions');
const { initAdmin, sweepSubmittedPayments, sweepPendingPayments } = require('./lib/notify-core');

exports.handler = schedule('*/5 * * * *', async () => {
    if (process.env.NOTIFY_ENABLED !== 'true') {
        console.log('payment-reminders skipped: NOTIFY_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const now = new Date();
    const received = await sweepSubmittedPayments(db, { now, logger: console });
    const pending = await sweepPendingPayments(db, { now, logger: console });
    return { statusCode: 200, body: JSON.stringify({ received, pending }) };
});
