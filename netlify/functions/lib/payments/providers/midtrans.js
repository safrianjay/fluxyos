'use strict';

const crypto = require('crypto');

const status = (value) => ({
    settlement: 'settled', capture: 'settled', pending: 'pending',
    deny: 'failed', cancel: 'failed', expire: 'expired', refund: 'refunded',
    partial_refund: 'refunded'
}[String(value || '').toLowerCase()] || 'failed');

module.exports = {
    id: 'midtrans',
    displayName: 'Midtrans',
    requiredEnv: ['MIDTRANS_SERVER_KEY'],
    async createCharge() { throw new Error('Midtrans charge creation is handled by the payment API worker.'); },
    // Midtrans signs order_id + status_code + gross_amount + server_key using SHA-512.
    verifyWebhook({ rawBody }) {
        let body;
        try { body = JSON.parse(rawBody.toString('utf8')); } catch (_) { return { ok: false }; }
        const signed = `${body.order_id || ''}${body.status_code || ''}${body.gross_amount || ''}${process.env.MIDTRANS_SERVER_KEY || ''}`;
        const expected = crypto.createHash('sha512').update(signed).digest('hex');
        const provided = String(body.signature_key || '');
        return { ok: !!provided && provided.length === expected.length
            && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) };
    },
    parseWebhookEvent(rawBody) {
        const body = JSON.parse(rawBody.toString('utf8'));
        return { providerRef: String(body.transaction_id || ''), orderRef: String(body.order_id || ''),
            status: status(body.transaction_status), amount: Math.round(Number(body.gross_amount) || 0),
            occurredAt: body.transaction_time || null };
    },
    normalizeStatus: status,
    async refund() { throw new Error('Midtrans refunds are handled by the payment API worker.'); }
};
