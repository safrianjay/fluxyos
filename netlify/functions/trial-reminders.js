'use strict';

// Scheduled daily (02:00 UTC ≈ 09:00 WIB). Sends "trial ending soon" emails for
// subscriptions that end within 24h. No public HTTP surface — schedule only.
const { schedule } = require('@netlify/functions');
const { initAdmin, sweepTrialEnding } = require('./lib/notify-core');

exports.handler = schedule('0 2 * * *', async () => {
    // Default-off kill switch: must be explicitly "true" to run.
    if (process.env.NOTIFY_ENABLED !== 'true') {
        console.log('trial-reminders skipped: NOTIFY_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await sweepTrialEnding(db, { logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
