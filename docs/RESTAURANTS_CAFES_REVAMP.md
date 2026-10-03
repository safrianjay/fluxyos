# Restaurants & Cafés finance page

Implemented 2026-10-03. Routes: `/use-cases/restaurants-cafes` and `/id/use-cases/restaurants-cafes`. Local preview: `http://127.0.0.1:8765/use-cases/restaurants-cafes`.

## Reference observation and adaptation

Reference inspected live: https://stripe.com/billing/usage-based-billing at 1440 and 390 pixels. Scrolled the entire page at both widths; screenshots and observed browser animation timings are in `.qa/restaurants-cafes/`.

| Verified observation | FluxyOS adaptation |
| --- | --- |
| Centered introductory message and CTAs above a large layered UI | Centered restaurant finance hero with a five-stage map |
| Invoice/notification and chart plot hero animations report 2100 ms, one iteration | Finite 2100 ms layered map entrance; no continuous decorative motion |
| Four anchor links; “Launch quickly” navigates to `#launch` | Four sticky section anchors with current-section indication |
| Link hover reports 300 ms cubic-bezier(.25,1,.5,1); no observed link translation | Restrained 300 ms hover feedback; transition curve reused |
| Desktop “Next slide” control was operated; control feedback reports 300 ms | Explicit previous/next planning scenarios; original 500 ms content entrance, not an asserted match to Stripe's slide timing |
| Eight native details elements. Mobile first accordion toggles closed; desktop first accordion remains open after selection | Native keyboard-operable recipe explanations and FAQ; multiple open sections allowed |
| Wide editorial sections, alternating pale/white backgrounds and large visuals | Separate accounting, ingredients, budget, decisions, and owner-view layouts |

Not verified: exact slide-content transition timing, mobile carousel operation (its controls were hidden in the inspected layout), pointer-driven parallax, 3D rotation, continuous background movement, or exact scroll-reveal timing. Those are not represented as reproduced effects. Scroll reveals and selectable stage controls are original FluxyOS adaptations. No Stripe text, logos, statistics, illustrations, or customer proof were copied.

## Section and interaction map

1. Centered hero: restaurant-specific message and pricing/contact CTAs; interactive map with order, sale/books, ingredients, budget, owner-decision stages. Roving ARIA tabs support Left/Right/Home/End, panels reserve the tallest layout, inactive content is inert. Connection line reflects selected progress. No APIs, record writes, or persistent demo state.
2. Challenges: earning, spending, and next commitments each introduce a distinct owner question.
3. Connected flow: paid order → revenue → configured stock cost → posted books → owner review.
4. Accounting: source-linked balanced journal illustration; accounting feature link.
5. Ingredients: recipe/receipt/cost explanations in keyboard-operable details.
6. Budgets: recorded assigned spending versus allocation; real Dynamic Budgeting link.
7. Decisions: manually controlled equipment/second-location discussions, no return forecast or financing advice.
8. Owner view: business-level income statement and recorded cash; Fluxy AI feature link.
9. FAQ and final pricing/contact CTA. Short Point of Sale link keeps detailed operating content on its existing feature page.

Motion: coordinated copy entrance, finite 2100 ms initial product layers, 600/700 ms stage layer transitions, 600 ms connection progress, 500 ms scenario entrance, shared scroll reveals, restrained hover/focus. CSS and shared reveal logic honor reduced motion, including live preference changes. All panels and scenarios remain readable without JavaScript.

## Product evidence and excluded claims

Read PROJECT_BACKGROUND, PRODUCT_STRATEGY, ROADMAP, DESIGN_SYSTEM, LOCALIZATION_PLAN and SEO_STRATEGY. Audited current code through the codebase-memory graph, then checked the stock and POS data-model docs.

- `assets/js/pos-service.js::_emitPosSale`: paid orders create workspace revenue transactions, eligible journal posting, recipe consumption and costed stock movements. Missing cost/mapping does not block a sale; finance must review gaps.
- `assets/js/inventory-engine.js::explodeRecipe`: configured recursive recipes resolve base ingredients, batch quantities and shared ingredients. `tests/modifier-cogs.check.js` verifies merged ingredient quantities and weighted-average costs.
- `assets/js/db-service.js::getOutletPnL`: outlet-tagged posted ledger balances generate outlet P&L, with unassigned entries retained. This does not create multi-entity consolidation or an all-outlet POS dashboard.
- `docs/data-model/stock.md`: receipts, stock movements, linked bills and GRNI accounting. `docs/data-model/pos.md`: first-party POS, table orders, manual payment recording, overview boundaries, recipe COGS.
- `assets/js/db-service.js::_allocationMatchesRecord`: assignments match explicit allocation IDs or safe category mappings. The illustration does not imply arbitrary supplier costs are automatically allocated.
- The outdated August inventory status in PRODUCT_STRATEGY §3 was updated for this audited subset, with the older §4 rationale marked historical. No blanket certification of the entire inventory roadmap.

No automated ad ROI, campaign profitability, automatic investment allocation, predicted returns, financing, autonomous purchasing, customer performance metrics, payment processing, multi-entity consolidation, or automatic complete food costing was added. Copy explains configuration dependencies in the relevant workflow and FAQ, not a standalone readiness inventory.

## Migration and integration

The canonical EN/ID homepage navigation replaces Dropshippers & Digital Ads with Restaurants & Cafés. `sync-marketing-nav.js` propagates that same desktop/mobile header across all 47 marketing pages. The i18n dictionary includes matching restaurant navigation labels and summaries.

Accurate supplier bill, courier-charge, and recorded advertising-expense content was moved into E-Commerce Brands in both languages via its existing generator. Unsupported campaign metrics were discarded. Eight legacy pretty/HTML/shortcut routes redirect directly to the corresponding E-Commerce page in marketing/app redirect templates and netlify.toml. HTML redirect stubs provide a static fallback. Netlify 301 responses require deployment; locally the fallback navigation and configuration were checked.

Metadata: paired titles/descriptions, canonical and en/id/x-default links, localized Open Graph/Twitter metadata and original branded 1200×630 images, Organization/SoftwareApplication/BreadcrumbList/visible FAQPage. Sitemap replaces the retired URLs and updates restaurant/e-commerce dates. Shared footer headings changed from h4 to h2 while preserving styles.

## Assets

Six original assets were generated with the built-in imagegen tool (no CLI, external stock assets, or Stripe artwork). Reviewed all six outputs for palette, materials, perspective and silhouette. Transparent alpha retained during size/format optimization; 512×512 WebP files total about 166 KB. Original PNGs remain in `/Users/jay/.codex/generated_images/01a1006a-bab9-7663-98da-0eb1af448ea9/`.

Shared prompt:

> Create one original realistic 3D editorial object for a premium restaurant finance website. Orthographic isometric perspective, viewed from above at 30 degrees, soft studio lighting from upper left, subtle contact shadow, refined off-white ceramic, brushed steel and deep navy #0B0F19 details; extremely small burnt-orange #EA580C accents only. Transparent background with genuine alpha. Single centered object occupying 75% of a square composition, generous clear margins. Realistic materials and gentle rounded edges, cohesive art direction, no text, no letters, no logos, no extra props, no gradient backdrop. Secondary supporting asset, not an interface screenshot. Subject:

| Asset under assets/images/restaurant-finance/ | Subject appended to prompt | Original PNG filename |
| --- | --- | --- |
| table.webp | a small round restaurant dining table with two neat contemporary chairs and a single white place setting | exec-b20391b5-5fbb-414e-b3f5-79c281556f2e.png |
| ticket.webp | an upright white restaurant order ticket on a small brushed-steel ticket holder, a few abstract navy line marks but no readable text | exec-8a9cb1fe-e7c6-496e-b273-f204eb34db28.png |
| ledger.webp | a closed navy accounting ledger book with off-white page edges and a narrow subtle orange bookmark | exec-fcc84d64-8797-4eb5-aec1-9f3265a693b7.png |
| ingredients.webp | a translucent food-safe ingredient storage container filled with coffee beans, neat brushed-steel lid | exec-11b4c75e-f59e-4330-9f89-1563180978bc.png |
| budget.webp | three stacked navy and ivory allocation blocks of different heights on a thin brushed-steel base, one small orange indicator | exec-047b73a8-018c-44fe-a82c-c8c11eb22159.png |
| oven.webp | a compact realistic commercial countertop convection oven with brushed-steel body, dark glass door and one tiny orange control light | exec-54519e53-f4c3-45f3-9b7e-0ccebb32cbe9.png |

## Checks and review

- Restaurant browser suite: 24 checks (22 workflow/responsiveness checks plus 2 language/navigation checks), Chromium and WebKit, EN/ID at 1440/768/390/320; map stages, stable height, arrows/Home/End, scenarios, accordion keyboard operation, no-JS fallback, reduced motion/live preference, language/navigation, internal links, metadata/schema, no overflow, no page exceptions, no financial writes.
- Agency/startup regression: 40 browser checks passed. E-commerce regression: 38 passed.
- Paired restaurant/e-commerce/agency/startup generators, global nav parity, ID mirror parity, Organization schema parity, structural drift, design lint, JavaScript syntax, whitespace checks, modifier COGS and prepare-deploy checks passed.
- Desktop/tablet/mobile EN/ID screenshots reviewed after scrolling every section. Corrected excessive hero wrapping and padding, panel-height movement, and footer heading order.
- Local mobile Lighthouse: EN performance 78 / accessibility 100 / best practices 100 / SEO 100; ID performance 79 / accessibility 100 / best practices 100 / SEO 100. Performance remains limited by the shared CSS/script loading under the local mobile simulation; no deployed performance target is asserted. Final scores are stored in `.qa/restaurants-cafes/lighthouse-{en,id}.json`. These are local laboratory measurements, not deployed performance evidence.
- No full shipping QA artifact, commit, push, or deployment was performed. Google Rich Results Test on the deployed URL remains a pre-push check; local JSON parsing, required entities, and visible FAQ pairing were checked.
- No unsupported product claim or external asset approval is pending. Generated visuals are ready for normal design review.

## Files

New page/content files: `use-cases/restaurants-cafes.html`, `id/use-cases/restaurants-cafes.html`, `scripts/build-restaurant-page.js`, `assets/css/restaurants-cafes.css`, `assets/js/restaurant-finance.js`, `tests/restaurants-cafes.config.js`, `tests/restaurants-cafes.spec.js`, this document, six WebP assets above, and `assets/images/og-restaurants-cafes.png` / `og-restaurants-cafes-id.png`.

Updated integration/content files: canonical homepage EN/ID, shared i18n dictionary, paired E-Commerce Brands pages and generator, paired dropshipping redirect stubs, marketing/app redirect templates, netlify.toml, sitemap.xml, shared footer EN/ID includes, scripts/qa-run.js, PRODUCT_STRATEGY.md, DESIGN_SYSTEM.md and LOCALIZATION_PLAN.md. Other marketing-page changes in this task are the synchronized shared navigation; prior agency/startup redesign work remains intact.

Synchronized navigation pages:

- `fluxyos.html`
- `pricing.html`
- `point-of-sale.html`
- `erp-intelligence.html`
- `multi-currency.html`
- `accounting-automation.html`
- `customers.html`
- `contact-sales.html`
- `aiagents.html`
- `budgetlanding.html`
- `revenuesync.html`
- `receiptcapture.html`
- `vendorspend.html`
- `privacy.html`
- `terms.html`
- `use-cases/cfo-finance-teams.html`
- `use-cases/ecommerce-brands.html`
- `use-cases/founder-ceo.html`
- `use-cases/manufacturing.html`
- `use-cases/marketing-agencies.html`
- `use-cases/restaurants-cafes.html`
- `use-cases/retail-franchises.html`
- `use-cases/tech-startups-saas.html`
- `guides/erp-intelligence.html`
- `guides/pos-intelligence.html`
- `id/accounting-automation.html`
- `id/aiagents.html`
- `id/budgetlanding.html`
- `id/customers.html`
- `id/erp-intelligence.html`
- `id/fluxyos.html`
- `id/multi-currency.html`
- `id/point-of-sale.html`
- `id/pricing.html`
- `id/receiptcapture.html`
- `id/revenuesync.html`
- `id/vendorspend.html`
- `id/guides/erp-intelligence.html`
- `id/guides/pos-intelligence.html`
- `id/use-cases/cfo-finance-teams.html`
- `id/use-cases/ecommerce-brands.html`
- `id/use-cases/founder-ceo.html`
- `id/use-cases/manufacturing.html`
- `id/use-cases/marketing-agencies.html`
- `id/use-cases/restaurants-cafes.html`
- `id/use-cases/retail-franchises.html`
- `id/use-cases/tech-startups-saas.html`

## Hero tour refinement

The restaurant hero now auto-advances through five stages every 8.5 seconds while visible. A progress bar indicates dwell time. Pause/Play supports user control; hover, focus, manual selection, background tabs, and leaving the viewport suspend progression. Reduced motion disables automatic progression and decorative movement. The tour never moves keyboard focus or the document scroll position. Object entrances, tab hover feedback, product shadow feedback, and connection transitions enhance the visual without introducing financial actions.

Each product card adds a concrete interpretation and next review action: capture the service, trace the revenue, review recipe consumption, check remaining allocation, and distinguish profit from cash before decisions. Layout reserves the tallest panel in each language.

Per the latest user instruction, visible illustrative/dummy-data labels were removed from the hero and planning cards in both languages. The earlier requested-label exception is retired in DESIGN_SYSTEM.md and LOCALIZATION_PLAN.md. Workflow names replace those labels; product accuracy and verified-evidence requirements for real customer claims remain.

Refinement verification: 28 Chromium/WebKit browser checks passed (26 responsive/workflow/autoplay checks plus 2 pointer-resume regressions). Reviewed desktop and narrow mobile cards in both languages, including the order and owner stages. Paired generation, design lint, navigation parity, Organization schema parity, JS syntax, and whitespace checks passed. The Lighthouse numbers above belong to the initial revamp, before this refinement.
