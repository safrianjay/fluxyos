# Manufacturing landing page

Routes: `/use-cases/manufacturing` and `/id/use-cases/manufacturing`.
Source: `scripts/build-manufacturing-page.js`; rebuild both locales together.

## Reference audit — 2026-10-04

Reference: https://www.rho.co/product/business-savings-account
Chromium sessions at 1440×900 and 390×900, with full-page scrolling and screenshots
in `.qa/rho/` (local review artifacts, not production assets).

| Reference pattern | Verified behavior | FluxyOS adaptation |
| --- | --- | --- |
| Split hero | Desktop two-column text + framed phone image; mobile stacks. No hero image animation was found in computed styles or active animations during the observed session. | Framed original finance UI, layered invoice/budget objects. FluxyOS entrance and a four-second background settle are deliberate additions, not claimed Rho matches. |
| Navigation | Products click opens the panel; Escape closes it. Hover alone left `aria-expanded=false`. Mobile Open menu / Close menu was clicked; the Products sub-menu expands on click. | Preserve the universal FluxyOS navbar, including its existing click, hover, keyboard, touch, focus, and reduced-motion behavior. |
| Numbered process | Four steps; small decorative tick animations use discrete `steps(1)` timing, 1.2–1.65s with staggered delays. | Four real financial record steps; use one-time scroll reveals instead of continuous blinking. |
| Benefits | Three image/text benefits following editorial product sections. | Three decision benefits, each tied to a verified feature route and a reused original 3D object. |
| Comparison | Desktop displays the full comparison; mobile uses ARIA tabs to select one account column. Mercury click sets aria-selected=true; ArrowRight selects and focuses Brex. | Record selector on both widths: invoice / supplier bill / budget. Arrow keys, Home, End; 240ms content entrance; no automatic selection or focus movement. |
| FAQ | Click expands an answer and updates `aria-expanded`; reference uses a 520ms grid-row transition with cubic-bezier(.32,0,.24,1). | Semantic native details/summary, keyboard activation and existing FluxyOS plus rotation. Native disclosure is intentionally retained rather than imitating a measured grid transition with inaccessible height hacks. |
| Transitions | Many text/background/border styles specify 620ms cubic-bezier(.32,0,.24,1). | Shared FluxyOS controls keep their established timing; section reveal 600ms, object feedback 240ms. |

Not verified: hero parallax, automatic image cycling, scroll-linked image motion,
or desktop comparison animation. None is described as a reproduced reference effect.
No Rho graphics, logos, banking promises, competitor data, or copy are reused.

## Section map

1. Hero: next production commitment → customer invoice, supplier bill, cash, budget.
2. Four owner questions: receivables, due bills, remaining allocation, recorded cash.
3. Four-step process: invoice → supplier cost → budget/cash review → accounting.
4. Source-linked accounting: supplier bill → balanced operating-expense/payables entry.
5. Interactive walkthrough: choose record → inspect context → decide next review.
6. Three practical benefits and feature routes; product evidence replaces customer proof.
7. Specific FAQ and final pricing/sales CTA.

## Product claim audit

Evidence: `docs/PRODUCT_STRATEGY.md` §3; `assets/js/db-service.js` methods
`getBills`, `getInvoices`, `getBudgetUsage`, accounting readiness/source collection;
`invoices.html`, `bill.html`, budget pages, accounting journal/statements and cash
KPI pages. Bills, invoices, assigned budget usage, recorded cash, posted journals
and financial statements are supported. Correct posting, source completeness and
payment updates still matter. Remaining budget is never labeled available cash.

Removed old page and metadata claims: batch-level materials/labor/overhead costing,
purchase-order tracking, WIP/finished-goods production costing, margin by product
line/run/customer order, and unsupported manufacturing PPN export promises.
Configured F&B inventory/recipe functionality is not evidence of manufacturing
BOM, production runs, yield, WIP, automatic production costing or factory margins.
Manufacturing operations remain direction, not a released production module.
FAQ explains batch-costing and consolidation limits in the relevant buying context;
there is no standalone feature-status inventory.

The attached brief explicitly requested illustrative data identification. The
walkthrough therefore uses the small contextual label “Example workspace · October” /
“Workspace contoh · Oktober”. This is a page-specific user-requested exception to
the no-dummy-label rule; do not propagate it to other pages. No customer metrics,
testimonials, guaranteed savings, bank feeds, funding, automated procurement or
multi-entity claims are made. No new external assets need licensing or approval.

## Assets and accessibility

Reuse the current navy/ivory/steel 3D family with small orange semantic accents:
invoice envelope, financial records, material parcel, segmented budget pie, ledger.
Keep original shape, palette, sizing rules, lighting and metaphors. All icons are
decorative next to descriptive text (`alt=""`). The HTML product illustration is
readable text, not an inaccessible screenshot. No factory machinery illustration
suggests equipment control. Existing Manufacturing navigation icon stays unchanged.

Native links and disclosures work without JavaScript; all three walkthrough panels
are available without scripts. Enhancement adds tab roles, roving focus and panels.
Reduced motion disables entrance, layering, reveals, hover motion and panel animation.
Layout space is reserved for the promo, hero assets and selected content.

## Verification

`tests/manufacturing.spec.js` + config cover Chromium/WebKit, EN/ID, 1440, 1024,
768, 390 and 320px: tab click/Arrow/Home/End, FAQ keyboard activation, heading,
metadata, schema/visible FAQ parity, assets, CTA routes, console errors, no horizontal
overflow, stable tab switching, reduced motion and no-JS fallback. The full
`npm run qa` gate includes generator parity and this browser lane before pushing.
Screenshots are in `.qa/manufacturing/`. Lighthouse SEO and hosted schema validator
results are recorded in the shipping handoff; the hosted validator may require login.

Pre-commit browser run: 22/22 passed. Lighthouse mobile SEO: 100 EN and 100 ID.
Google Rich Results Test code submission was attempted; the hosted service returned
“Something went wrong — Log in and try again.” Screenshot:
`.qa/manufacturing/google-rich-results.png`. Local JSON parsing, required schema
types and exact visible FAQ/question-answer parity passed. This is a hosted
validation limitation, not a claim that Google rich results were certified.

Social previews are original code-rendered 1200×630 PNGs for each language, rebuilt
by `scripts/capture-manufacturing-og.js` (QA static server required). They remove the
old manufacturing production-cost assertions. No external visual license is needed.
