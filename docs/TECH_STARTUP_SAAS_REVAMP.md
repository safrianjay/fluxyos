# Tech Startup & SaaS landing page revamp

Routes preserved: `/use-cases/tech-startups-saas` and
`/id/use-cases/tech-startups-saas`. The existing `#how-it-works` anchor is retained.

## Audit and reuse

Read PROJECT_BACKGROUND.md, PRODUCT_STRATEGY.md, ROADMAP.md, DESIGN_SYSTEM.md,
LOCALIZATION_PLAN.md, and SEO_STRATEGY.md. Product Strategy §3 governs claims;
older roadmap stubs and the original landing page do not override that audit.
The original page centred on a runway cockpit, cloud-spend spike detection, and
AI burn explanations without evidence of forecasting or cloud-usage connectors.
Those promises and visuals have been replaced with supported recorded workflows.

Reuse the homepage's canonical universal navigation via `sync-marketing-nav`,
its promotion from the exact `fluxyos.js` template, the universal localized
footer loader, Inter, existing CTA routes, and the agency page's editorial
CSS/interaction module. `ag-*` names are historical shared styling hooks; the
startup-specific visual adjustments live in `tech-startups-saas.css`.

A static promotion reserves space before scripts load. Its copy is extracted
from the canonical shared JS template, not maintained as a separate promotion.
The shared page module measures its height for sticky navigation and mobile
menu bounds. The agency page keeps its existing promotion initialization.

## Reference observation and section map

Benchmark: https://stripe.com/industries/media-entertainment.
Revisited at 1440px and 390px, scrolling the entire page. Desktop dropdown,
carousel advancement, capability-card hover, and mobile menu open/close were
observed. The settled hero photos had `transform: none` and `animation: none`
in both viewports; no canvas was present. The capability card's shadow and
transform did not change on hover. Original inspection in
MARKETING_AGENCY_REVAMP.md records link/control transitions and reference limits.
Exact initial reveal, parallax, looping background, and carousel travel timing
remain unverified; the FluxyOS hero effect is an original adaptation.

| Reference composition | Startup adaptation |
|---|---|
| Spacious split hero, layered media, diagonal pale surface | Founder message plus subscription records, cloud bill, and recorded cash; original finite animated bands |
| Opportunity/challenge progression | Infrastructure costs, recurring software commitments, decision context |
| Approach/proof | Record → Review & connect → Understand; supported source-to-accounting workflow |
| Capabilities with product visuals | Subscription records, customer invoices, budgets, business financial statements |
| Customer-story carousel | Step selector with a larger cloud bill → software renewals → budget review canvas; no fabricated customer proof |
| Closing conversion section | Visible FAQ and plan/sales CTA, followed by universal footer |

## Product evidence and boundaries

| Workflow | Evidence |
|---|---|
| Software costs, billing cycle, renewal date | `subscription.html` detail/list, `renewal_date`, `billing_cycle`, `DataService.getSubscriptions`; Product Strategy §3 |
| Vendor/cloud bill records and documents | `bill.html`, `documents`, `document-attachment.js`; general bill workflow, no cloud connector claim |
| Customer invoices and payment recording | `invoices.html`, invoice data-model contract, `createInvoiceDraft`, `markInvoicePaid` |
| Budgets and recorded spending | `budget.html`, `budget-period.html`, `budget-allocation.html`; Product Strategy §3 |
| Recorded cash and business statements | Cash position, Accounting Center, Reports & Exports MVP; Product Strategy §3 |
| Financial Q&A | `ai-chat.js`; responses depend on recorded workspace data |

Subscription tracking refers to the software/services the business purchases,
not recurring customer billing. No promise of automated SaaS billing, MRR/ARR
or churn analytics, cloud-usage integrations, predictive runway, scenario
planning, multi-entity accounting, autonomous payments, or shipped approvals.
Specific availability questions are answered in the visible FAQ and matching schema. No verified customer proof was found in the supplied
strategy; the product walkthrough provides proof of workflow instead.

Original HTML/CSS visuals use the FluxyOS favicon and IDR amounts. The two
1200×630 OG images are original typography compositions. The existing licensed
Inter font is reused. No customer-result claims or third-party assets await
approval. No sample-data disclaimers are added, per DESIGN_SYSTEM.md.

## Implemented interactions

- Staggered 700ms hero entrance, 4.8-second neutral-band/grid background movement
  that settles, and 600ms scroll reveals. Background is decorative, behind the
  content, pointer-transparent, and hidden from assistive technology.
- Link arrow movement and card/border feedback reuse the established surface.
- Walkthrough tabs with click, arrow keys, Home/End, selected-state announcements,
  and focusable panels; no auto-advance.
- Navbar dropdown keyboard/click/Escape access, mobile menu focus management,
  native FAQ keyboard interaction, visible focus, and skip link.
- Reduced motion disables entrance/background/reveal effects and transitions,
  makes panel changes immediate, and hides the animated footer canvas.
- Static English and Indonesian content and no-JS readable page; language links
  and saved language preference navigate to the correct full mirror.

## Files and maintenance

- `use-cases/tech-startups-saas.html`
- `id/use-cases/tech-startups-saas.html`
- `scripts/build-startup-page.js`
- `assets/css/tech-startups-saas.css`
- `assets/js/startup-walkthrough.js`
- `assets/js/marketing-agencies.js` — shared static-promotion sizing and locale path
- `assets/images/og-tech-startups-saas.png`
- `assets/images/og-tech-startups-saas-id.png`
- `tests/tech-startups-saas.config.js`
- `tests/tech-startups-saas.spec.js`
- `scripts/qa-run.js` — selects both use-case browser suites and generator checks
- `sitemap.xml` — updated both startup lastmod values
- `docs/LOCALIZATION_PLAN.md` — glossary and paired-generator maintenance
- `docs/TECH_STARTUP_SAAS_REVAMP.md`

Edit paired copy in `scripts/build-startup-page.js`, then run
`node scripts/build-startup-page.js`; `--check` verifies generated-page parity.
This preserves canonical Organization, full reciprocal language metadata,
SoftwareApplication, BreadcrumbList, and visible FAQ/FAQPage parity.

## Validation

40 Chromium/WebKit browser checks passed for the startup and agency pages,
covering EN/ID at 1440, 768, 390, and 320px. Tests verify routes, no document
overflow or console errors, schema/visible FAQ parity, keyboard navigation,
carousel controls, static-promotion uniqueness, no-JS content, saved language,
and finite background motion plus reduced motion. Screenshots of both full
pages, hero, capabilities, and walkthrough were visually reviewed.

Both generator checks, navigation parity, Organization parity, Indonesian SEO
mirror check, design lint, structural drift, JS syntax, and diff checks passed.
`npm run qa -- --lane=product` passed localization pairing and SEO essentials;
this is a **partial** run, not shipping authorization. Full BE/FE QA is not
claimed for this revision. Local review evidence lives in
`.qa/tech-startups-saas/` and is excluded from shipping.

The initial mobile Lighthouse run exposed promotion insertion layout shift.
Prerendering the canonical banner removed that shift; final lab scores are
recorded below. Google Rich Results Test against a published revision has not
been run; local JSON-LD parsing and visible FAQ parity passed. No commit, push,
or deployment was performed.

| Final Lighthouse lab run | Performance | Accessibility | SEO | CLS |
|---|---:|---:|---:|---:|
| EN, mobile | 85 | 100 | 100 | 0 |
| EN, desktop | 99 | 100 | 100 | 0 |
| ID, mobile | 85 | 100 | 100 | 0 |
| ID, desktop | 96 | 100 | 100 | 0 |

These are local lab measurements, not deployed field metrics. Card hover
shadow/border, link-arrow movement, and live reduced-motion switching were also
verified in the browser; evidence is in `interaction-review.json`.

## Marketing-copy follow-up — 2026-10-03

Removed the standalone Available / Partial / Planned capability-summary paragraph
from both language versions, following the new DESIGN_SYSTEM.md marketing-copy
rule. Internal product audits stay in documentation. Relevant FAQ answers remain
accurate. Removed the unused summary style and its wrapper/margin; capability
section bottom padding is now 80px desktop, 64px tablet, and 48px mobile.

## Walkthrough layout update — 2026-10-03

Replaced the startup carousel with an editorial step selector and larger product
workspace. Desktop uses a vertical selector beside a canvas; tablet/mobile use
a compact three-column selector above it. Each selection pairs its actual product
visual with an explanatory heading and paragraph. Canvas imagery remains original
HTML/CSS, with no new product claims. The agency walkthrough retains its carousel.

`assets/js/startup-walkthrough.js` progressively enhances the three panels into an
ARIA tablist/tab/tabpanel pattern, with click, arrow, Home/End, and roving focus.
All steps remain visible without JavaScript. Overlapping grid tracks reserve the
tallest panel, avoiding selection-driven height jumps. The 280ms fade/rise obeys
the shared reduced-motion rule. The shared interaction module now allows pages
without a carousel so navigation continues to initialize correctly.

Updated startup browser checks cover selected-panel visibility, keyboard focus,
stable panel height, reduced motion, and no-JS readability. QA automatically
selects both use-case suites when the new walkthrough module changes.
