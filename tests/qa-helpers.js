// @ts-check
/**
 * Shared QA helpers.
 *
 * The shared QA Firebase account runs on a short (3-day) trial that
 * periodically lapses to `expired`. When it does, `assets/js/trial-access.js`
 * renders a full-screen, non-dismissable billing paywall over every
 * authenticated app page, which intercepts all pointer events and breaks any
 * interaction-based spec (filters, drawers, etc.). The paywall is UX-only
 * enforcement and is orthogonal to the feature behavior these specs verify, so
 * tests neutralize it in the browser context. Resetting the trial properly
 * requires Admin SDK access the local harness does not have.
 *
 * Call `installTrialPaywallBypass(page)` in a beforeEach (before the first
 * goto). It runs at document-start on every navigation and continuously strips
 * the paywall overlay + scroll-lock as soon as the guard injects them.
 */
async function installTrialPaywallBypass(page) {
    await page.addInitScript(() => {
        const strip = () => {
            document.querySelectorAll('[data-fluxy-paywall]').forEach((el) => el.remove());
            document.documentElement.classList.remove('fluxy-paywall-lock');
        };
        try {
            const observer = new MutationObserver(strip);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) { /* documentElement always exists at document-start, but stay safe */ }
        document.addEventListener('DOMContentLoaded', strip);
    });
}

module.exports = { installTrialPaywallBypass };
