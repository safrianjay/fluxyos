'use strict';

const status = (value) => ({
    PAID: 'settled', SETTLED: 'settled', PENDING: 'pending',
    EXPIRED: 'expired', FAILED: 'failed', REFUNDED: 'refunded'
}[String(value || '').toUpperCase()] || 'failed');

module.exports = {
    id: 'xendit',
    displayName: 'Xendit',
    requiredEnv: ['XENDIT_CALLBACK_TOKEN'],
    async createCharge() { throw new Error('Xendit charge creation is handled by the payment API worker.'); },
    verifyWebhook({ headers }) {
        const provided = headers['x-callback-token'] || headers['X-CALLBACK-TOKEN'] || '';
        const expected = process.env.XENDIT_CALLBACK_TOKEN || '';
        return { ok: !!expected && provided === expected };
    },
    parseWebhookEvent(rawBody) {
        const body = JSON.parse(rawBody.toString('utf8'));
        return { providerRef: String(body.id || body.external_id || ''), orderRef: String(body.external_id || ''),
            status: status(body.status), amount: Math.round(Number(body.amount) || 0),
            occurredAt: body.paid_at || body.updated || null };
    },
    normalizeStatus: status,
    async refund() { throw new Error('Xendit refunds are handled by the payment API worker.'); }
};
