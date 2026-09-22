# POS landing page — implementation notes

Created 2026-09-22. Public routes: `/point-of-sale` and `/id/point-of-sale`.

## Reference and adaptation

Reference: https://attio.com/platform/data (inspected 2026-09-22).

The content follows its centered hero, dotted background, connected object cards,
large product preview with view selectors, numbered feature grid, spacious feature
sections, financial view selector, and closing call to action. FluxyOS's universal
navigation, promotional banner, language switcher and loaded footer are reused.
The existing Inter font, restrained display type, neutral surfaces, and purple
illustration accents are retained. No Attio assets or source code are copied.

The reference's CRM objects become table, order, payment, inventory and ledger.
The product preview switches between illustrated table service, kitchen orders
and payment recording; a second tab group switches the financial illustration.
The customer phone showcase uses actual captures of the deployed QR ordering app
(menu, item customization and order review), in English and Indonesian. Its images
are labeled as the actual app with a demo menu, and open at full size when tapped.
The table illustration stays as originally designed. No live financial data is
fetched by this public landing page.
Testimonials and customer logos are omitted because there is no approved POS
customer evidence to substitute. CTAs use the existing contact-sales flow.

Desktop uses a five-card connection diagram and paired content columns. Tablet
compresses the preview while retaining its order detail. Mobile rearranges the
connection cards, stacks the order detail, feature grid and kitchen columns,
and presents the QR phone illustration below its explanatory copy. Tabs have
keyboard navigation (arrows, Home, End), focus styles and accessible selection
states. FAQs use native disclosure elements; default content and FAQs remain
readable without JavaScript. Motion respects the reduced-motion preference.

## Capability boundaries

Reviewed the POS service graph, current POS data-model documentation, order page,
and QR deployment history. Updated the specific stale POS row in
`PRODUCT_STRATEGY.md` §3. The copy includes manual payment recording, table bills,
shifts, recipes/stock costing and QR ordering. It explicitly states that offline
ordering and integrated payment-provider processing are not supported. POS access
is eligibility-gated; the CTA asks users to contact sales rather than promising
unrestricted access.

## Files and maintenance

- `point-of-sale.html`: English content and universal navigation.
- `assets/css/pos-landing.css`: scoped page layout and product illustrations.
- `assets/js/pos-landing.js`: independent accessible tab groups and screenshot
  locale synchronization with the shared language switcher.
- `assets/images/pos-qr-{menu,customize,basket}-{en,id}.jpg`: six 2× captures of
  the real customer app, lazy-loaded in the phone showcase.
- `scripts/capture-qr-marketing.js`: repeatable capture from the existing
  Senopati table-8 QA fixture; no orders are submitted.
- `assets/js/i18n.js`: translations used by both the runtime and mirror generator.
- `id/point-of-sale.html`: generated Indonesian mirror; do not edit directly.
- `assets/images/og-point-of-sale.png`: 1200×630 branded social card.
- `scripts/prepare-deploy.js`, `tailwind.config.js`, `sitemap.xml`: marketing
  classification, compiled CSS inclusion, and both public URLs.

Regenerate after English edits:

```sh
node scripts/build-id-mirrors.js
npm run seo:sync-org
npm run build:css
```

Keep head meta/link tags on a single line: the existing mirror generator matches
these attributes with literal spacing. The new mirror's FAQ and product schema
are translated with the same dictionary as the visible content.

## Validation

```sh
npx playwright test --config=tests/pos-landing.config.js
npm run check:structure
npm run seo:check-id
npm run seo:check-org
npm run check:deploy
```

- 16 browser checks passed: Chromium and WebKit, EN and ID, 390/768/1440px;
  preview switching, keyboard tabs, disclosure, mobile navigation, no horizontal
  overflow, localized metadata, FAQ/schema text agreement, no page errors, and
  content without JavaScript, real QR image loading, vertical showcase tabs,
  and in-place image locale switching.
- Desktop full-page, tablet, mobile Indonesian, payment preview and social-card
  screenshots were visually inspected. Review screenshots are in
  `/tmp/fluxyos-pos-review/` (temporary local artifacts).
- Structure, translation coverage, Organization schema and four-origin deployment
  checks passed. `git diff --check` passed.
- Lighthouse 13.5 SEO: **100/100 for both EN and ID** against the local server.
  Reports: `/tmp/fluxyos-pos-review/lighthouse-en.json` and `lighthouse-id.json`.
  The initial dependency download timed out; a retry succeeded.
- Google Rich Results validation remains a pre-publication check. No production
  deployment or full shipping QA is claimed.

The existing uncommitted Integration Center and QR welcome-image changes were
preserved and are outside this landing-page work.

## Customer QR showcase capture

User clarification: keep the illustrated table view; use the real product only
for the phone experience customers reach after scanning a table QR.

The six JPEGs were captured on 2026-09-22 from the deployed ordering site using
the existing ID QA workspace's Senopati menu. The application UI was not rebuilt,
restyled, or image-edited. Menu items, options, prices, and demo food artwork come
from the existing demo setup. The sample guest details belong to the local capture
session. A real order was not submitted; the capture additionally blocks POSTs to
order-submission and bill-request endpoints.

Refresh them with `node scripts/capture-qr-marketing.js` while the demo outlet is
open, using the existing gitignored `perf/.fixtures.json`. Do not commit fixtures,
auth state, or a live table token. The script changes only local language/cart
state and image assets. Captures are 780×1688 pixels (390×844 at 2×) and roughly
90–155 KB each. Hidden steps load when selected. Regenerate the Indonesian mirror
after source markup edits, following the generator order above.

### Service illustrations, phone playback, and financial samples

The four service cards use custom SVG scenes (seating, coffee options, split
payment, and cash drawer) with navy outlines and orange accents. The QR showcase
cycles its real app screenshots every six seconds while visible, pauses on
hover/focus or manual selection, and includes a pause/play control. Reduced-motion
preferences disable automatic playback by default.

Reports show 14–20 September 2026 sample daily values on a shared Rp 1.200.000
maximum scale. Labels use thousands of Rupiah. Revenue totals Rp 4.800.000, COGS
Rp 1.920.000, and gross profit Rp 2.880.000 (60% margin). Every day's costs and
profit reconcile to revenue. Orange revenue, navy cost, and striped orange profit
replace the purple bars; values remain readable without hover. EN and ID match.
