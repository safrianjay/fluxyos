'use strict';

// Scheduled every 5 minutes. Sends welcome + KYC + payment notification emails
// by reconciling the internal index. No public HTTP surface — schedule only.
const { schedule } = require('@netlify/functions');
const { initAdmin, reconcileInternalUsers } = require('./lib/notify-core');

exports.handler = schedule('*/5 * * * *', async () => {
    // Default-off kill switch: must be explicitly "true" to run.
    if (process.env.NOTIFY_ENABLED !== 'true') {
        console.log('notify-sweep skipped: NOTIFY_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await reconcileInternalUsers(db, { logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
