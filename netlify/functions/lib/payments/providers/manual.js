'use strict';

module.exports = {
    id: 'manual',
    displayName: 'Manual',
    requiredEnv: [],
    async createCharge({ idempotencyKey }) {
        return { providerRef: `manual_${idempotencyKey}`, status: 'settled' };
    },
    verifyWebhook() { return { ok: false }; },
    parseWebhookEvent() { throw new Error('Manual payments have no webhook.'); },
    normalizeStatus() { return 'settled'; },
    async refund({ providerRef }) { return { providerRef, status: 'refunded' }; }
};
