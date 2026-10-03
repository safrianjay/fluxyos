# Retail & Franchises revamp

Routes: `/use-cases/retail-franchises` and `/id/use-cases/retail-franchises`.
Read PROJECT_BACKGROUND, PRODUCT_STRATEGY, ROADMAP, DESIGN_SYSTEM,
LOCALIZATION_PLAN and SEO_STRATEGY before implementation.

## Audit and reuse

The old page advertised WhatsApp/email capture, automatic duplicate detection,
external POS links and franchise comparison without dependable evidence, while
its FAQ incorrectly said outlet reporting did not exist. Replace those claims
with supported financial records, uploaded documents, budgets, bank matching,
configured stock costs and outlet-attributed posted income statements.

Use canonical EN/ID navbar through `sync-marketing-nav`, original 3D icon family,
shared Inter, agency editorial spacing/buttons/reveals, native multi-card retail carousel, shared static
promotion and localized footer. App navigation remains unchanged.

## Reference observations before implementation

Reference: https://stripe.com/billing/subscriptions, inspected in Chromium at
1440×900 and 390×900, scrolling through the full desktop and mobile pages.
Viewport screenshots and measured observations: `.qa/retail/stripe-*`.

- Split hero: copy/CTAs left, layered financial UI on a vivid surface right;
  mobile stacks copy before a full-width visual. Stripe gradients are not reused.
- Live CSS: hero section-card fades are 300ms; success-card reveal is 750ms.
  Settled cards stayed still during a five-second sample. A repeating sequence,
  initial entrance orchestration and hero image parallax were not verified.
- CTA hover changes background over 300ms, cubic-bezier(.25,1,.5,1), with no
  button transform. Navigation dropdown hover and mobile menu opening inspected.
- Long page alternates pale/white surfaces and text/product visuals, followed by
  proof, related products, FAQ and final CTA. Billing subnavigation persists
  during scroll; FluxyOS keeps its established sticky universal navbar instead.
- Customer-story Next slide moved its horizontal scroller from 0 to 396px;
  screenshots before/after verify one-card advance. Exact travel duration and
  swipe inertia were not measured. FluxyOS uses native scrolling with a bounds-aware controller for its multi-card viewport.
- Revenue graphic exposes 500ms bar growth, 750ms line drawing and 300ms markers.
  Generic section reveal timing, background-image motion and initial gradient
  movement remain unverified; FluxyOS's finite background entrance is original.

## Section and interaction map

| Reference | FluxyOS adaptation |
| --- | --- |
| Split hero and layered subscription UI | Retail message, 3D storefront, bill → journal → outlet report tour |
| Four benefit links | Sales, supplier costs, outlet reporting, budget review anchors with 3D icons |
| Intro and launch capabilities | Retail questions and source records that finance can act on |
| Alternating feature/product sections | Recorded sales, goods receipts/supplier bills, outlet-attributed P&L |
| Customer stories | Four-step source-to-review walkthrough with carousel controls |
| Related capabilities | Receipt Capture, Dynamic Budgeting, Accounting Automation, Fluxy AI |
| FAQ and final CTA | Buying-context answers, pricing/contact-sales routes and shared footer |

Automatic hero tour is an original adaptation: 8.5s reading intervals with
pause/resume, stops on hover/focus/manual selection/hidden page/offscreen and
does not advance with reduced motion. It never moves focus or document scroll.
Each panel has concise decision context; values are not customer proof.

## Product evidence

| Claim | Evidence and boundary |
| --- | --- |
| Retail POS records | `feature-access.js` retail eligibility; `pos-service.js`, `POS_BUSINESS_TYPE_STRATEGY.md`; recorded payment, not promised payment-provider processing |
| Stock receipts and costs | `data-model/stock.md`, `createGoodsReceipt`, item-driven stock relief; depends on item mappings and recorded costs |
| Supplier bills and documents | `bill.html`, `document-attachment.js`, `documents`; uploaded documents reviewed before recording |
| Bank reconciliation | Product Strategy §3, bank-statement import/reconciliation workflow; not a promised live bank feed |
| Outlet comparison | `DataService.getOutletPnL`, `ledger_balances_by_dim`, `data-model/dimensions.md`; posted records attributed within one workspace, Unassigned kept visible, invoices lack dimensions |
| Eligibility | `feature-access.js` outlet_pnl minDimensions outlet/branch count 2; one legal entity per workspace, no franchisee consolidation |
| Budgets, statements, Q&A | Product Strategy §3; recorded amounts, existing financial reports, AI answers grounded in recorded data |

No fabricated customer proof, savings metrics, royalty billing, automatic
approvals, external POS connectors, autonomous vendor payments, forecasting,
multi-entity consolidation or franchise-specific integrations. No standalone
availability audit or sample-data labels on the public page. Specific limits
appear only in the relevant feature description or buying-context FAQ.

## Assets

Original imagegen family from the Public Navbar 3D Icon Standard is reused.
Higher-density exports of the original transparent PNGs live in
`assets/images/retail-finance/`: storefront 640px, stock-parcel/ledger/calculator
384px WebP. They retain alpha and originals; source PNG provenance and common
prompt are documented in `PUBLIC_NAVBAR_3D_ICONS.md`. This task performs format
and size optimization only, without a new generation call or creative editing.
Smaller section icons reference existing 192px navbar assets directly.

## Implementation and validation

- EN/ID page templates: `scripts/build-retail-page.js`; generated route files
  `use-cases/retail-franchises.html`, `id/use-cases/retail-franchises.html`.
- Page styles/controller: `assets/css/retail-franchises.css`,
  `assets/js/retail-finance.js`. Canonical navbar renderer is exported by
  `scripts/sync-marketing-nav.js` for the paired generator.
- Original 3D exports: `assets/images/retail-finance/{storefront,stock-parcel,ledger,calculator}.webp`
  (33.5, 15.5, 10.7, 17.0KB respectively). Shared 192px 3D section icons remain
  under `assets/images/navbar-3d/`. No external assets or customer proof used.
- Localized 1200×630 social cards:
  `assets/images/og-retail-franchises.png`, `assets/images/og-retail-franchises-id.png`.
  Original HTML typography + reused storefront; no Stripe assets.
- Product evidence correction: `docs/PRODUCT_STRATEGY.md`; glossary/generator
  convention: `docs/LOCALIZATION_PLAN.md`; material-change dates: `sitemap.xml`.
- **28 browser tests passed** (1.1 minutes), log `.qa/retail/browser-verified.log`.
  Browser suite: `tests/retail-franchises.spec.js` and configuration, integrated
  into `scripts/qa-run.js`. Covers Chromium/WebKit, EN/ID at 1440, 1024, 768, 390,
  320px; all hero panels, carousel buttons/keyboard, FAQs, local CTAs, missing
  assets, console errors, overflow, no-JS, saved language, automatic tour and
  reduced motion. Pointer pause/resume and keyboard resume are both verified.
  Playback labels update only when changed, preserving WebKit pointer targets.
  Responsive routes pass without document overflow or errors.
- Passing checks: bilingual generator parity; canonical nav across 47 pages;
  Organization schema; ID dictionary parity; structural drift; 199 client-module
  parses; design lint; deployment pruning/route checks; `git diff --check`.
- Lighthouse SEO: EN **100**, ID **100**, reports in `.qa/retail/lighthouse-{en,id}.json`.
  JSON-LD parses locally and FAQ answers match visible content. Google's hosted
  Rich Results Test has not been run; it remains a publication check.
- Visual review: complete desktop/mobile scroll and settled hero, outlet and
  walkthrough captures in `.qa/retail/`. Reference timing observations are
  recorded above; unverified effects are not claimed as replicated.
- No new claims/assets require approval. No commit, push or deployment performed
  for this revamp; the full shipping QA gate remains required before pushing.

