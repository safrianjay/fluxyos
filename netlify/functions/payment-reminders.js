'use strict';

// Scheduled hourly. Reminds users who selected a plan and reached the QRIS
// screen but haven't completed payment (billing_payment_requests still
// awaiting_payment). Schedule-only; gated by NOTIFY_ENABLED.
const { schedule } = require('@netlify/functions');
const { initAdmin, sweepPendingPayments } = require('./lib/notify-core');

exports.handler = schedule('30 * * * *', async () => {
    if (process.env.NOTIFY_ENABLED !== 'true') {
        console.log('payment-reminders skipped: NOTIFY_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await sweepPendingPayments(db, { now: new Date(), logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
