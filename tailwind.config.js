/**
 * Tailwind build for FluxyOS marketing/landing pages.
 *
 * Replaces the runtime Play CDN (cdn.tailwindcss.com), which is render-blocking
 * and bad for LCP. The content globs below cover the PUBLIC landing surface and
 * the shared footer include only — app/dashboard pages are intentionally not
 * scanned here so the compiled file stays small. When app pages are migrated off
 * the CDN later, extend `content` accordingly.
 *
 * Pinned to Tailwind v3 to match the v3 Play CDN the pages were built against.
 */
module.exports = {
  content: [
    './fluxyos.html',
    './pricing.html',
    './aiagents.html',
    './vendorspend.html',
    './revenuesync.html',
    './receiptcapture.html',
    './budgetlanding.html',
    './contact-sales.html',
    './privacy.html',
    './terms.html',
    './use-cases/*.html',
    './id/*.html',
    './id/use-cases/*.html',
    './includes/*.html',
    // Landing-page JS that injects Tailwind classes at runtime (active-tab
    // gradient, language-switcher nav states). Listed explicitly so the static
    // scan generates those classes without pulling in app/dashboard JS.
    './assets/js/fluxyos.js',
    './assets/js/pricing.js',
    './assets/js/i18n.js',
    './assets/js/footer-loader.js',
    './assets/js/universe-canvas.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
