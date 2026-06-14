'use strict';

// Scheduled every 5 minutes. Sends welcome + KYC + payment notification emails
// by reconciling the internal index. No public HTTP surface — schedule only.
const { schedule } = require('@netlify/functions');
const { initAdmin, reconcileInternalUsers } = require('./_notify-core');

exports.handler = schedule('*/5 * * * *', async () => {
    const db = initAdmin();
    const result = await reconcileInternalUsers(db, { logger: console });
    return { statusCode: 200, body: JSON.stringify(result) };
});
