'use strict';

// Default language when we can't resolve a user preference. Override with the
// DEFAULT_LOCALE env var (functions/.env) — "id" or "en".
const DEFAULT_LOCALE = String(process.env.DEFAULT_LOCALE || 'en').toLowerCase() === 'id' ? 'id' : 'en';

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
