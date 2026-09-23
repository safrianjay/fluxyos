'use strict';
const assert = require('node:assert/strict');
const crypto = require('crypto');
const registry = require('../netlify/functions/lib/payments/registry');

assert.deepEqual(registry.list(), ['manual', 'midtrans', 'xendit']);
assert.equal(registry.isConfigured('manual'), true);
assert.equal(registry.isConfigured('midtrans'), false);
assert.equal(registry.get('manual').normalizeStatus('anything'), 'settled');

process.env.MIDTRANS_SERVER_KEY = 'test-key';
const midtrans = registry.get('midtrans');
const body = { order_id: 'o1', status_code: '200', gross_amount: '25000', transaction_id: 't1', transaction_status: 'settlement' };
body.signature_key = crypto.createHash('sha512').update('o120025000test-key').digest('hex');
assert.equal(midtrans.verifyWebhook({ rawBody: Buffer.from(JSON.stringify(body)) }).ok, true);
assert.equal(midtrans.parseWebhookEvent(Buffer.from(JSON.stringify(body))).status, 'settled');

process.env.XENDIT_CALLBACK_TOKEN = 'callback-token';
const xendit = registry.get('xendit');
assert.equal(xendit.verifyWebhook({ headers: { 'x-callback-token': 'callback-token' } }).ok, true);
assert.equal(xendit.normalizeStatus('EXPIRED'), 'expired');
console.log('payment provider registry: clean');
