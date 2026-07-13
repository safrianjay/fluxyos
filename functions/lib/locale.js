'use strict';

// Default language when we can't resolve a user preference. Override with the
// DEFAULT_LOCALE env var (functions/.env) — "id" or "en". Bahasa Indonesia is
// the product default (matches the dashboard's Bahasa-first flip).
const DEFAULT_LOCALE = String(process.env.DEFAULT_LOCALE || 'id').toLowerCase() === 'en' ? 'en' : 'id';

// Resolve "en" | "id" for ALL system-generated emails. Priority:
//   1. Explicit Email Language setting — settings/email_preferences.language
//      (Settings → Notifications & email). Single source of truth once set.
//   2. The user's saved finance settings locale (e.g. "id-ID").
//   3. DEFAULT_LOCALE.
// Never throws.
async function resolveUserLocale(db, uid) {
    try {
        const ep = await db.doc(`users/${uid}/settings/email_preferences`).get();
        const lang = ep.exists ? String(ep.data().language || '').toLowerCase() : '';
        if (lang === 'id' || lang === 'en') return lang;
    } catch (_e) {
        // ignore — fall through
    }
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
