// FluxyOS — shared Firestore initializer.
//
// Ad/privacy blockers (Brave Shields, uBlock, AdGuard) and some corporate
// proxies break Firestore's streaming WebChannel transport — they block the
// `/channel` stream and the `cleardot.gif` keep-alive pixel — which silently
// kills realtime reads/writes and leaves the app showing "0 data". Long polling
// uses ordinary short HTTP requests instead, so it survives those blockers.
//
// `initializeFirestore(...)` MUST be the FIRST Firestore access for an app and
// can run only once. The app touches Firestore from several entry points
// (db-service, workspace-service, onboarding-gate, sidebar-loader) in an order
// that varies per page, so EVERY one of them must route through this helper.
// Whichever runs first applies the long-polling setting; the rest hit the
// "already initialized" throw and fall through to the same configured instance.
import {
    initializeFirestore,
    getFirestore
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function resolveDb(app) {
    try {
        return initializeFirestore(app, { experimentalForceLongPolling: true });
    } catch (_) {
        // Already initialized (another entry point won the race) — return the
        // existing instance, which already carries the long-polling setting.
        return getFirestore(app);
    }
}
