'use strict';

/**
 * The origins FluxyOS serves from — one list, for every function's CORS check.
 *
 * WHY THIS EXISTS.
 *
 * Ten functions each carried their own hardcoded array. They had already
 * drifted: some allowed http://localhost:8888, some http://127.0.0.1:8765, some
 * neither, for no reason anyone recorded. Adding a third production origin
 * (pos.fluxyos.com) meant editing ten files by hand, and the failure mode of
 * missing one is a function that works from the dashboard and returns an opaque
 * CORS error from the till — at a checkout counter, mid-service.
 *
 * `tests/allowed-origins.check.js` fails the build on any function that declares
 * its own production-origin list instead of importing this one.
 *
 * WIDENING THIS IS NOT FREE. Every origin here can call every function that uses
 * it with the caller's credentials. Add an origin only when FluxyOS actually
 * serves from it, and never a wildcard — several of these functions send email,
 * mint signed URLs, or move billing state.
 */

// Production. Mirrored in cors.json (Firebase Storage) and in the CSP
// `connect-src` in netlify.toml — three places, because three different systems
// enforce them; there is no shared config layer beneath all three.
const PRODUCTION_ORIGINS = [
    'https://fluxyos.com',
    'https://www.fluxyos.com',
    'https://dashboard.fluxyos.com',
    // The till. Firebase auth is keyed by origin, so a cashier signs in here and
    // every API call they make carries this Origin header.
    'https://pos.fluxyos.com',
];

// Local development and the Playwright static server. Kept in the same list
// deliberately: these functions are also exercised by the test suite, and a
// separate "dev" list is how a dev origin ends up in production by accident.
const DEVELOPMENT_ORIGINS = [
    'http://localhost:8000',
    'http://localhost:8765',
    'http://localhost:8888',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:8765',
];

const ALLOWED_ORIGINS = [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];

/** Is this Origin header one of ours? Unknown or absent fails closed. */
function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.includes(String(origin || ''));
}

/**
 * The value for Access-Control-Allow-Origin.
 *
 * Echoes the caller's origin when we know it, and otherwise falls back to the
 * dashboard rather than to `*` — a wildcard here would let any page on the
 * internet call these functions with the caller's credentials.
 */
function allowOriginHeader(origin) {
    return isAllowedOrigin(origin) ? origin : 'https://dashboard.fluxyos.com';
}

module.exports = {
    ALLOWED_ORIGINS,
    PRODUCTION_ORIGINS,
    DEVELOPMENT_ORIGINS,
    isAllowedOrigin,
    allowOriginHeader,
};
