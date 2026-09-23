'use strict';

// Payment providers follow the commerce connector pattern: callers only know
// the normalized contract. Enabling Midtrans or Xendit is credentials plus a
// deploy, never a new accounting path.

const LOADERS = {
    manual: () => require('./providers/manual'),
    midtrans: () => require('./providers/midtrans'),
    xendit: () => require('./providers/xendit'),
};

function get(provider) {
    const loader = LOADERS[String(provider || '').toLowerCase()];
    return loader ? loader() : null;
}

function list() { return Object.keys(LOADERS); }

function isConfigured(provider) {
    const gateway = get(provider);
    return !!gateway && (gateway.requiredEnv || []).every((key) => !!process.env[key]);
}

module.exports = { get, list, isConfigured };
