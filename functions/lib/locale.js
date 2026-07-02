'use strict';

// Default language when we can't resolve a user preference. Override with the
// DEFAULT_LOCALE env var (functions/.env) — "id" or "en". Bahasa Indonesia is
// the product default (matches the dashboard's Bahasa-first flip).
const DEFAULT_LOCALE = String(process.env.DEFAULT_LOCALE || 'id').toLowerCase() === 'en' ? 'en' : 'id';

// Resolve "en" | "id" from the user's saved finance settings (locale like
// "id-ID"). Falls back to DEFAULT_LOCALE. Never throws.
async function resolveUserLocale(db, uid) {
    try {
        const snap = await db.doc(`users/${uid}/settings/finance`).get();
        const loc = snap.exists ? String(snap.data().locale || '') : '';
        if (loc.toLowerCase().startsWith('id')) return 'id';
        if (loc.toLowerCase().startsWith('en')) return 'en';
    } catch (_e) {
        // ignore — fall back to default
    }
    return DEFAULT_LOCALE;
}

module.exports = { resolveUserLocale, DEFAULT_LOCALE };
