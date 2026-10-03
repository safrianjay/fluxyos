# Marketing Agency landing page revamp

Audit and implementation: 3 October 2026. Existing routes retained:
`/use-cases/marketing-agencies` and `/id/use-cases/marketing-agencies`.

## Audit and reuse

Read the project background, product strategy (especially the §3 reality audit),
roadmap, design system, localization plan, and SEO strategy. Some older roadmap
rows contradict newer implementation and data-model documentation. Use the
strategy baseline plus current code evidence, not the old Marketing Agency copy.

Reuse the canonical EN/ID homepage nav through `sync-marketing-nav.js`, the
compiled Tailwind stylesheet, shared Inter typography, 1280px shell, shared button
base, `fluxyos.js` promo banner and mobile toggle, the i18n language switcher,
footer loader, page transition, and footer assets. Page-specific CSS provides
keyboard dropdown access and removes decorative orange promo fills on this page.
No route, shared component source, auth flow, or backend was changed.

The old page and its structured data promised client profitability, campaign
budget pacing, forecasting, and approval flows without supporting product
evidence. Replaced those claims in both languages and the FAQ schema. No verified,
consented customer proof was found; `SEO_STRATEGY.md` also explicitly records the
absence of real customer reviews. The proof section is a labeled product walkthrough.

## Reference inspection: verified vs unverified

Reference: https://stripe.com/industries/media-entertainment
Inspected in Chromium at 1440px and 390px, including scrolling from hero to footer
at each width, screenshot sequences, computed styles, actual desktop hover and
carousel clicks, and opening/closing mobile navigation.

| Element | Observation | Adaptation |
|---|---|---|
| Hero | Split composition; three staggered photo rectangles; pale surface with diagonal lower edge; mobile stacks copy before imagery | Original agency UI illustrations, lighter FluxyOS type scale, diagonal pale surface |
| Page rhythm | Opportunity, proof/statistics, modular use cases, customer spotlight, horizontal industry cards, resources, final CTA | Challenges, connected-record approach, capabilities, walkthrough, FAQs, final CTA |
| Desktop navigation | Hover opens large panel; observed 300ms link transition and 500ms overlay animation | Retain shared FluxyOS 200ms dropdown treatment; add keyboard/click access and Escape |
| Mobile navigation | Menu button opens full-height list; close button dismisses it | Retain FluxyOS mobile panel; add focus containment and Escape focus return |
| Links | Computed color/opacity and arrow feedback at 150ms; easing `cubic-bezier(.215,.61,.355,1)` | 150ms link/arrow feedback; shared button hover |
| Capability card hover | Tested billing card: transform and shadow stayed unchanged | Restrained original border/shadow feedback, not claimed as a Stripe effect |
| Desktop carousel | Clicking right advances the horizontal card strip; inactive state changes at the ends; observed 150ms button transitions | Manual three-step scroll-snap walkthrough with buttons, arrow keys, Home/End, status announcement |
| Mobile carousel | Desktop arrow controls were not visible at 390px; horizontal card composition remains | Touch-scrollable walkthrough; retain accessible buttons on mobile |
| Hero/photo motion | Images had no CSS animation/transform at sampled settled states; exact initial entrance, parallax, or looping image motion could not be verified | No claimed Stripe parallax or loop; original 700ms staggered entrance, no continuous image motion |
| Scroll reveals | Full scrolling inspected, but no reliable reveal duration/easing was captured | Original 600ms one-shot group reveal; not an exact reference timing claim |
| Carousel travel timing | End states verified; exact travel duration/easing not captured | Native smooth horizontal scrolling; immediate with reduced motion |

No Stripe branding, photography, customer logos, copy, testimonials, or statistics
are used in the shipped files. Reference captures are inspection-only in `/tmp`.

## Section and interaction map

1. Hero: audience-specific introduction, plan/sales CTAs, workflow anchor,
   layered client invoice + reviewed receipt + recorded cash illustrations.
2. Category: verbatim EN positioning and localized ID counterpart; capability
   anchors in place of an unsupported customer-logo row.
3. Challenges: invoice timing, distributed vendor/production/software costs,
   and source evidence for reporting; three editorial columns, stacked on mobile.
4. Approach: Record → Review & connect → Understand; source records through books.
5. Available capabilities: two-column illustration grid, single column on mobile,
   linked to Invoice, Receipt Capture, Dynamic Budgeting and ERP Intelligence.
   Supported-workflow copy; specific availability questions answered in the FAQ.
6. Proof: three-step product walkthrough; no automatic advancement, no business
   writes, no claim of project profitability; keyboard/buttons/touch scrolling.
7. FAQ: native keyboard-accessible details; exact same Q&A in JSON-LD.
8. Final CTA: plan and sales routes, existing universal footer.

All custom animation and transitions stop with `prefers-reduced-motion`, including
hero/reveal effects; carousel becomes immediate and the animated footer canvas is
hidden. Content remains readable without JavaScript and the walkthrough can be
scrolled without its enhanced controls.

## Product evidence and limits

| Claim used | Evidence |
|---|---|
| Invoice creation and receivables | `invoices.html`, `DataService.createInvoiceDraft/getInvoices`; `docs/data-model/invoices.md` |
| Explicit payment recording | `DataService.markInvoicePaid`; invoice data-model contract (not a gateway payment) |
| Expense/bill records and reviewed receipt extraction | Strategy §3, `document-attachment.js`, reviewed scan workflows |
| Recorded cash balances and budget tracking | Strategy §3, cash position and budgeting pages |
| Business-level financial statements | Strategy §3, Reports & Exports MVP and accounting kernel |
| Financial Q&A | Strategy §3; answers limited by available workspace data |

The page explicitly says approvals and predictive forecasts are planned, and
that automated client/project profitability, advertising-tool integrations, and
multi-entity accounting are unavailable. No promise of recurring invoice
automation, money movement, autonomous finance, or verified customer outcomes.

Visuals are original HTML/CSS using the existing FluxyOS logo. Amounts are IDR
with dot separators. The two 1200×630 OG images are original typography compositions,
not third-party assets. No product claims or licensed assets await approval.

## Maintenance

Edit paired copy in `scripts/build-agency-page.js`, then run:

```sh
node scripts/build-agency-page.js
node scripts/build-agency-page.js --check
```

The generator takes the canonical EN/ID nav from the existing shared nav tooling
and preserves each page's canonical Organization block. Root mirror generation
does not overwrite use-case pages. Canonical, reciprocal hreflang, OG/Twitter,
localized SoftwareApplication/BreadcrumbList/FAQPage, and sitemap lastmod are kept
at the existing routes. No ratings or free-tier pricing are invented.

## Verification

Results recorded after completing the browser, repository QA, and Lighthouse
checks below. Google Rich Results Test is an external publishing check, not a
substitute for the local JSON-LD parse and visible FAQ parity checks.

Inter is now served locally to remove the Google Fonts stylesheet request from
the critical render path. The Latin variable WOFF2 (300–700) comes from Google
Fonts' Inter distribution; the upstream SIL Open Font License is retained at
`assets/fonts/Inter-LICENSE.txt` (https://github.com/rsms/inter/blob/master/LICENSE.txt).

Files changed:

- `use-cases/marketing-agencies.html`
- `id/use-cases/marketing-agencies.html`
- `assets/css/marketing-agencies.css`
- `assets/js/marketing-agencies.js`
- `assets/images/og-marketing-agencies.png`
- `assets/images/og-marketing-agencies-id.png`
- `assets/fonts/inter-latin-variable.woff2`
- `assets/fonts/Inter-LICENSE.txt`
- `scripts/build-agency-page.js`
- `tests/marketing-agencies.config.js`
- `tests/marketing-agencies.spec.js`
- `sitemap.xml`
- `docs/LOCALIZATION_PLAN.md`
- `docs/MARKETING_AGENCY_REVAMP.md`

Page-specific validation: 18/18 Playwright checks passed in Chromium and WebKit,
covering EN/ID at 1440, 768, 390, and 320px; no page overflow or console errors;
working main-content links; dropdown ArrowDown/Escape focus; mobile menu Escape;
walkthrough buttons/Home/End and disabled ends; FAQ keyboard toggling and schema
parity; reduced motion, saved language routing, and no-JS readable content.
The initial desktop dropdown focus/expanded-state defects were corrected and
verified by the passing final run.

`build-agency-page.js --check`, `nav:check`, `seo:check-org`, `seo:check-id`,
`qa:design`, `check:structure`, syntax checks, and `git diff --check` passed.
Final screenshots, interaction observations, and Lighthouse JSON reports are in
`.qa/marketing-agencies/` (local review evidence, excluded from shipping).

| Lighthouse (local static server) | Performance | Accessibility | SEO | CLS |
|---|---:|---:|---:|---:|
| English, mobile simulation | 86 | 100 | 100 | 0.059 |
| Indonesian, mobile simulation | 86 | 100 | 100 | 0.059 |
| English, desktop | 100 | 100 | 100 | 0 |
| Indonesian, desktop | 100 | 100 | 100 | 0 |

These are local Lighthouse lab measurements, not deployed field performance.
No push or deployment was performed. Google Rich Results Test has not been run
against a published revision; local JSON-LD parses and matches visible FAQ copy.

The complete `npm run qa` run passed all BE, FE, and PRODUCT lanes, including
emulator checks, existing marketing-page browser suites, the core console/currency/
till-board sweep, non-IDR currency checks, localization, and SEO checks. The artifact
is `.qa/qa-run.json`, `passed: true`, `partial: false`. This is a working-tree QA
run; no shipping commit was created. The final agency-specific suite and design,
generator, nav, and Organization parity checks were also run after the page fixes.

Small-screen visual QA additionally corrected the inherited legacy hero padding
that doubled the mobile inset and the narrow navigation CTA wrapping at 320px.
The shared navbar HTML stays canonical; those adjustments are page-scoped CSS.

## Hero visual follow-up — 2026-10-03

Revisited the Stripe reference at 1440px and 390px. No moving hero background was
verified; the browser reported no canvas on either viewport. The new FluxyOS effect
is an original adaptation of the diagonal composition, not a copied Stripe motion.
Three cool-neutral background layers enter behind both copy and product cards
using transform/opacity over 4.8 seconds, then settle. The clipped decorative layer
has no pointer events, is hidden from assistive technology, and is static under
reduced motion. There are no perpetual loops or new asset dependencies.

Removed sample-data captions and disclaimers throughout both agency pages, including
accessible labels and the walkthrough introduction. Workflow descriptions remain.
The project-wide rule is recorded in DESIGN_SYSTEM.md and LOCALIZATION_PLAN.md;
feature availability and actual customer-proof requirements remain unchanged.

Follow-up verification: 20/20 Chromium/WebKit checks passed (both languages at
1440, 768, 390, and 320px), including finite background movement, reduced motion,
keyboard interactions, route/schema checks, overflow and console checks. Desktop
and mobile screenshots were visually reviewed. Generator, design, structure, nav,
EN/ID SEO parity, Organization parity, and diff checks passed. The full QA results
above belong to the initial revamp; this follow-up used the relevant scoped checks.
Also fixed an Escape dismissal race: a pending pointer entry no longer reopens a
keyboard-dismissed navbar dropdown before the pointer leaves.

## Marketing-copy follow-up — 2026-10-03

Removed the standalone Available / Partial / Planned capability-summary paragraph
from both language versions, following the new DESIGN_SYSTEM.md marketing-copy
rule. Internal product audits stay in documentation. Relevant FAQ answers remain
accurate. Removed the unused summary style and its wrapper/margin; capability
section bottom padding is now 80px desktop, 64px tablet, and 48px mobile.
