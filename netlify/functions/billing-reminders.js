'use strict';

// Scheduled daily (03:00 UTC). Sends billing/repayment reminders and the
// account-locked email based on each subscription's current_period_end:
// 7d before, 1d before, 3d after (overdue), 7d after (locked). Schedule-only.
// Gated by NOTIFY_ENABLED (same kill switch as the other notification sweeps).
const { schedule } = require('@netlify/functions');
const { initAdmin, sweepBillingReminders } = require('./lib/notify-core');

exports.handler = schedule('0 3 * * *', async () => {
    if (process.env.NOTIFY_ENABLED !== 'true') {
        console.log('billing-reminders skipped: NOTIFY_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await sweepBillingReminders(db, { now: new Date(), logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
