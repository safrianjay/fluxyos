'use strict';

// Scheduled hourly. Sends the Weekly Financial Digest to each user whose chosen
// delivery day + hour (in their timezone) matches the current hour. ISO-week
// idempotency means at most one digest per user per week. Schedule-only — no
// public HTTP surface. Gated by a default-off DIGEST_ENABLED kill switch.
const { schedule } = require('@netlify/functions');
const { initAdmin } = require('./lib/notify-core');
const { runWeeklyDigestSweep } = require('./lib/digest-core');

exports.handler = schedule('0 * * * *', async () => {
    if (process.env.DIGEST_ENABLED !== 'true') {
        console.log('weekly-digest skipped: DIGEST_ENABLED !== "true"');
        return { statusCode: 200, body: 'disabled' };
    }
    const db = initAdmin();
    const result = await runWeeklyDigestSweep(db, { now: new Date(), logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
