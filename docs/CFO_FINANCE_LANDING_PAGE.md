# CFO & Finance Teams landing page

Routes: `/use-cases/cfo-finance-teams` and `/id/use-cases/cfo-finance-teams`.
Bilingual source: `scripts/build-cfo-page.js`. Rebuild both pages together.
Styles and interactions are scoped to `.cf-page`; universal navigation, promo,
footer, Inter, buttons and the `.ag-shell` content width remain shared.

## Reference inspection — 2026-10-04

https://vercel.com/for/web-apps was visited in Chromium at 1440×900 and 390×900.
The entire page was scrolled; local screenshots are in `.qa/vercel/`.

| Observed structure / behavior | FluxyOS adaptation |
| --- | --- |
| Broad two-column headline/supporting-copy hero; mobile stacked. Four-column customer metric strip. | Same composition at FluxyOS's 1280px shell, with four named financial workflows and new 3D icons rather than unverified results or customer logos. |
| Left section heading sticks below the header while three right-hand visual/caption frames scroll. Computed desktop position is `sticky`; mobile is stacked. | Sticky accounting heading and cleanup / statement matching / posted financial-result frames. Sticky disabled on mobile. |
| Chat visual has moving cursors: observed 3000ms and 3400ms linear loops. | No fake collaboration cursors or implied live team presence. Finance scenes use source records and one-time reveals / chart entrance. |
| Large centered customer quote, followed by a split section heading and a staged product visual. | Centered original product statement, without attribution, followed by a supplier bill → journal → statements walkthrough. |
| Desktop staged walkthrough uses text buttons; mobile uses 32px circular replay controls. Hover/focus transitions observed at 150ms ease-out; one mobile control specifies a 250ms delay. Keyboard Enter changed its `data-active` state. | Desktop vertical text tabs; compact mobile stage cards. 150ms state feedback and an original 280ms panel entrance. Manual tabs with stable panels and no automatic focus movement. |
| Products click sets `aria-expanded=true` and `data-open=true`; desktop hover alone left it false in the observed session. Mobile Open menu exposes Close menu. | Keep FluxyOS's verified universal navigation behavior; do not import Vercel's header. |
| A heading beside three security cards, six benefits in a 3×2 grid, customer logos in a large grid, and a split final CTA. | Three financial-review cards, six supported capabilities, a nine-item linked workflow grid and split final CTA. Add visible FAQ for genuine buying questions and SEO. |

Not verified: exact internal timing of the staged image composition, hero reveal
or parallax, globe animation timing, and scroll reveal timing. These are not claimed
as reproduced reference effects. FluxyOS's shared 600ms one-time reveal is retained.
No Vercel graphics, logos, customer quotes, metrics, infrastructure promises or text
are copied. Navigation/footer are intentional shared-site exceptions to its structure.

## Product accuracy

Reviewed `PROJECT_BACKGROUND.md`, `PRODUCT_STRATEGY.md` §3, `ROADMAP.md` accounting
and reporting sections, `DESIGN_SYSTEM.md`, `LOCALIZATION_PLAN.md`, and SEO conventions.
Code evidence: `DataService.getAccountingReadiness`, `getFinancialStatements`,
`closePeriod`, bank statement reconciliation, budget usage and report export models;
Accounting Center, journals, ledger, trial balance, bills and source-document pages.

Supported claims: reviewed receipt extraction; cleanup for missing receipts/dates;
imported bank statement match review; source-linked posted journals; ledger-based
income statement / balance sheet / cash flow; trial balance; authorized period
close; accounting CSV package; budgets versus assigned spend; recorded bills;
financial Q&A grounded in recorded workspace data. A period-close icon does not
promise autonomous close. A matched amount is not an automatic payment.

Removed or narrowed old positioning and claims: “finance operations operating
layer”, “audit-ready” guarantees, autonomous close/approval implications, automated
vendor drift or concentration detection, and generalized validation promises.
There is no claimed multi-entity consolidation, predictive cash forecasting,
enterprise approval engine, live bank feed, supplier payment execution, customer
metric or testimonial. Specific limits sit in relevant FAQ answers; no visible
product-audit wall or illustrative/dummy-data disclaimer is added.

## New original 3D assets

`assets/images/cfo-finance/` contains four 384×384 transparent WebP objects:

- `reconciliation.webp`: two statements joined by a steel clip.
- `period-close.webp`: calendar with a completed-period checkmark.
- `report-package.webp`: hardbound report folder and paper sheets.
- `finance-review.webp`: financial chart with an inspection magnifier.

Generated with the built-in image tool; original sources and style/size provenance
are in `assets/images/cfo-finance/manifest.json`. These are original product visuals,
not licensed third-party artwork. Palette: navy structure, ivory secondary planes,
steel, restrained orange semantic details. Orthographic three-quarter upper-left
light, transparent padding, readable primary metaphor. All accompany text and use
`alt=""`. Existing navbar icon family is unchanged.

## Interactions and accessibility

- Hero text and workflow-strip entrances, plus restrained background-only grid and atmosphere motion that settles within 4.5 seconds. No added hero cards or animation buttons.
- Shared one-time scroll reveals and finite statement-bar entrance.
- Icon hover lift and tilt; links and cards retain keyboard focus outlines.
- Comparison disclosure highlights the two records and explains what to verify.
- Tabs: click / Arrow keys / Home / End, roving focus, ARIA-selected and labeled panels.
- Manual record flow: select a stage with pointer or keyboard. No autoplay or playback controls.
- All panel heights reserved from current width and font metrics, including ID copy.
- Reduced motion disables every entrance/reveal/lift/transition and decorative motion;
  manual stage selection remains available. Native links/disclosures and all three
  walkthrough panels remain available without JavaScript.

## Verification and shipping

`tests/cfo-finance-teams.spec.js` runs Chromium and WebKit at 1440, 1024, 768,
390 and 320px in both languages. It covers heading/meta/hreflang/schema/visible
FAQ parity, stage clicks and keyboard, panel height, comparison disclosure, links,
assets, console, overflow, explicit animation/pause/focus, reduced motion, no-JS,
shared navigation and asset budgets. The repository QA gate includes generator
parity and the CFO browser lane. Screenshots: `.qa/cfo/`.

OG previews are original code-rendered 1200×630 PNGs for both locales, generated by
`scripts/capture-cfo-og.js` with the local QA server. Canonical routes and language
links are preserved; sitemap dates updated. No product claim or external asset
needs approval. Hosted Google Rich Results validation may require login; report
actual outcome separately from local schema validation.

Pre-commit verification: responsive/locale checks passed in both browsers; explicit
play/pause and keyboard-focus tests passed in Chromium and WebKit. The four new
icons are 384×384 RGBA WebP with actual transparency, each under 32KB. Lighthouse
mobile SEO scored 100 in EN and 100 in ID. Google Rich Results Test code submission
was attempted and returned “Something went wrong — Log in and try again”; screenshot
`.qa/cfo/google-rich-results.png`. Local JSON-LD parsing and visible FAQ parity
passed. This does not claim hosted Google validation succeeded.

## Hero motion revision

The current hero uses only existing background pseudo-elements and a finite 4.5-second entrance, suspended offscreen or when the document is hidden. Reduced motion shows the static background. No Play/Pause/Resume animation controls are present. The CFO hero’s added three-card flow has been removed and its spacing restored. Founder Business review remains readable static product content. CFO walkthrough tabs remain manual; continuous automatic content changes were removed with their playback control. This revision supersedes earlier autoplay/control descriptions above.
