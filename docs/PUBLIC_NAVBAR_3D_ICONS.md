# Public navbar icon redesign

Scope: public marketing desktop mega menus and equivalent mobile links. Authenticated sidebar, form/control icons, logo, language controls, and promotional feature artwork retain their established treatment. Navigation labels, descriptions, and routes were inventoried before generation; Restaurants & Cafés had already replaced Dropshippers in the canonical EN/ID header.

## Inventory and source of truth

`assets/images/navbar-3d/manifest.json` maps all 18 stable entry IDs to routes, assets, labels and metaphors. `scripts/public-nav-icons.js` renders the same icon markup for desktop/mobile and both languages; `scripts/sync-marketing-nav.js` reads the canonical header and propagates it to every public marketing page. Asset replacements belong in the manifest, not individual pages.

| Group | Entry IDs |
| --- | --- |
| Platform / Features | point-of-sale, erp-intelligence, budgeting, invoice, revenue-sync, receipt-capture |
| Platform / Platform | ai-agents, multi-currency, accounting |
| Use Cases / By Industry | ecommerce, startups-saas, marketing-agencies, retail-franchises, restaurants-cafes, manufacturing |
| Use Cases / By Role | cfo-finance, founder-ceo, department-heads |

All 18 desktop entries now have mobile counterparts. The pre-existing mobile menu omitted CFOs & Finance Teams and Department Heads; their existing desktop labels, descriptions, and destinations were added in the same mobile section. Desktop and mobile reuse each route's single icon. Two promotional cards link to `/fluxyos` and retain their artwork. Two locale choices retain native current-language indicators. Logo, Customers, Pricing, Sign in and Try FluxyOS are top-level utility links, not business dropdown entries.

Department Heads already links to the homepage `/fluxyos` (ID `/id/fluxyos`); this task preserves that destination. A dedicated role landing page would be a separate product/content decision. No new product capability or financial integration is implied by an icon.

## Asset workflow

Original realistic 3D objects generated using the built-in imagegen skill/tool, no CLI or external icon pack. The common prompt and all subject prompts are recorded below; source filenames are preserved in the provenance table. Final assets: transparent 192×192 WebP, rendered at 48×48 CSS px (4× density), decorative alt="", native lazy loading, asynchronous decode. A small original outline SVG provides a failed-image fallback. Original generated PNGs remain in the imagegen output directory; site references only workspace assets.

Common prompt:

> Use case: stylized-concept. Asset type: public website dropdown icon, legible at 48px. Create one original realistic 3D object, orthographic three-quarter view from above at 30 degrees, consistent upper-left soft studio light, soft contact shadow, matte deep navy #0B0F19, ivory ceramic and brushed steel materials. One tiny burnt-orange #EA580C detail only. Genuine transparent background, square composition, subject centered at 75% canvas width/height, equal clear padding. Strong simple silhouette, refined rounded edges, realistic gentle material highlights. No tile, base plate, border, background, tiny writing, logos, lettering, currency symbols, emojis or additional props. Subject:

Each manifest metaphor is appended to this prompt. The manifest was written before generation.

## Implementation

- Canonical EN/ID headers use identical shared markup for each asset. Navigation information architecture and existing copy remain intact.
- Fixed 48px icon boxes, 16px gaps, flexible copy column, minimum row heights; descriptions can wrap without cropping or shifting the icon box. Small screens use the same icon size.
- Only menu-item images receive a 3px lift and 3-degree tilt over 240 ms. Keyboard focus receives the same feedback and a clear outline. Reduced motion removes image transforms and transitions.
- Shared public navigation handles hover/click, ArrowDown entry, Escape dismissal, outside click, expanded states and mobile focus trapping. It replaces duplicated use-case-only navigation handlers. Legacy generated panel IDs are retained for compatibility.
- Desktop panels scroll vertically within the viewport when space is limited; mobile retains the established full-menu scroll surface.
- No real financial data is loaded or written by these icons. App Lucide assets were not edited.

## Verification

Browser screenshots and inventory: `.qa/public-navbar/`. Final measurements and checks appear below. Full deployment QA and publishing are not part of this request.

## Entry-to-asset mapping

| Entry ID | Label | Route | Asset | Metaphor |
| --- | --- | --- | --- | --- |
| point-of-sale | Point of Sale | /point-of-sale | pos-terminal.webp | Compact countertop payment/order terminal |
| erp-intelligence | ERP Intelligence | /erp-intelligence | connected-records.webp | Three upright financial record binders connected by a steel rail |
| budgeting | Dynamic Budgeting | /budgetlanding | allocation-tray.webp | Three compartment allocation tray with navy and ivory blocks |
| invoice | Invoice | /vendorspend | invoice-envelope.webp | Invoice sheet emerging from a navy envelope |
| revenue-sync | Revenue Sync | /revenuesync | revenue-stream.webp | Two incoming channels joined to one collection vessel |
| receipt-capture | Receipt Capture | /receiptcapture | receipt-scanner.webp | Receipt passing through a small document scanner |
| ai-agents | FluxyOS AI Agents | /aiagents | intelligence-orb.webp | Ivory sphere with precise navy orbital rings |
| multi-currency | Multi-Currency | /multi-currency | currency-globe.webp | Navy globe with ivory meridians and two neutral coins |
| accounting | Accounting Automation | /accounting-automation | accounting-ledger.webp | Closed navy ledger with ivory page edges and orange bookmark |
| ecommerce | E-Commerce Brands | /use-cases/ecommerce-brands | commerce-parcel.webp | Ivory parcel with navy sales tag |
| startups-saas | Tech Startups & SaaS | /use-cases/tech-startups-saas | server-stack.webp | Two compact navy and steel server units |
| marketing-agencies | Marketing Agencies | /use-cases/marketing-agencies | client-brief.webp | Navy clipboard with an ivory client brief and cost sheet |
| retail-franchises | Retail & Franchises | /use-cases/retail-franchises | retail-store.webp | Compact ivory storefront with navy awning |
| restaurants-cafes | Restaurants & Cafés | /use-cases/restaurants-cafes | restaurant-table.webp | Small round dining table with place setting and upright receipt |
| manufacturing | Manufacturing | /use-cases/manufacturing | factory-gear.webp | Steel precision gear with one small navy machined block |
| cfo-finance | CFOs & Finance Teams | /use-cases/cfo-finance-teams | finance-calculator.webp | Navy financial calculator with ivory keys |
| founder-ceo | Founders & CEOs | /use-cases/founder-ceo | decision-compass.webp | Precise steel and navy desk compass |
| department-heads | Department Heads | /fluxyos | department-organizer.webp | Navy desk organizer with three ivory department folders |

## Files changed

New: `assets/images/navbar-3d/manifest.json`, 18 mapped WebP assets, `assets/images/navbar-3d/fallback.svg`, `scripts/public-nav-icons.js`, `tests/public-navbar.config.js`, `tests/public-navbar.spec.js`, this report. Shared changes: `assets/css/fluxyos.css`, `assets/js/fluxyos.js`, `assets/css/marketing-agencies.css`, `assets/js/marketing-agencies.js` (remove duplicate dropdown handlers), `scripts/sync-marketing-nav.js`, `scripts/qa-run.js`, `docs/DESIGN_SYSTEM.md`. Canonical headers and synchronized page files:

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

Review of first 12 assets: cohesive navy/ivory/steel palette, upper-left studio highlights and transparent margins. At 48px, terminal, ledger, scanner, binders, globe, orb, tray, server, parcel and clipboard remain distinct. The revenue junction represents source streams joining; it is a financial-flow metaphor, not a payment-provider claim.

## Generated source provenance

Built-in `image_gen.imagegen`, transparent background requested for every asset. Source directory: `/Users/jay/.codex/generated_images/01a1006a-bab9-7663-98da-0eb1af448ea9/`. Original PNGs remain there. Export only resized to 192×192 and converted to WebP with alpha; no creative raster modifications.

| Entry | Original PNG filename | WebP bytes |
| --- | --- | ---: |
| point-of-sale | exec-07730e53-3f9e-49bd-bc34-76128be8cf4e.png | 7648 |
| erp-intelligence | exec-20972870-f1fd-4a18-8373-62d5403f32d7.png | 6860 |
| budgeting | exec-18e560b3-6e27-42f8-a9da-9411a9daf08a.png | 5784 |
| invoice | exec-84df9c39-e336-46d8-880c-3928f0dffc71.png | 5918 |
| revenue-sync | exec-94ca00bf-530c-4aa2-8bc1-4877a8f4a90b.png | 6588 |
| receipt-capture | exec-1078eecd-d80f-485a-aa75-4f9ccfa296c8.png | 8614 |
| ai-agents | exec-02dc77c0-c126-4670-8c69-3da05790afdf.png | 9292 |
| multi-currency | exec-ffe6b26c-6553-4e4e-85f1-69f1cb232dcf.png | 8840 |
| accounting | exec-1527b2ef-740f-4010-9e41-1ce5e0e12ec3.png | 5462 |
| ecommerce | exec-3cc3d868-97f2-48f4-b04b-dc6b4764ff70.png | 7368 |
| startups-saas | exec-75f74cac-f272-4e45-b905-fb2f4df850bd.png | 7074 |
| marketing-agencies | exec-9075753e-b24e-4b12-9ef0-e1a8666d4041.png | 8658 |
| retail-franchises | exec-457cb967-6220-449c-8f54-afc16a07ebc2.png | 7792 |
| restaurants-cafes | exec-ff178ebe-e2b7-4b6f-a5a9-5a73ddfaf1e9.png | 7736 |
| manufacturing | exec-7106c40a-97c1-4662-95b2-e35b4cc154bb.png | 8220 |
| cfo-finance | exec-5adf2fb4-a377-44ae-b237-2b4a59fce84b.png | 8602 |
| founder-ceo | exec-85fb9510-8210-41e2-98dc-417a85d5ad4f.png | 6488 |
| department-heads | exec-296f97d7-eadd-4245-a968-93da160523d5.png | 6282 |

Total: **133,226 bytes** for 18 assets; each below 12 KiB. Full-family visual review at both large and 48px sizes confirmed coherent material, lighting, transparent padding and legible silhouettes. The founder asset is a drawing compass, a decision metaphor rather than a feature claim. The budgeting image uses empty compartments rather than data blocks.

## Final validation

- Navbar browser suite: **26 passed** on Chromium + WebKit, EN/ID, widths 1440/1024/768/390/320; keyboard, Escape, hover, touch, fallback, reduced motion, density, route requests and asset budget.
- Regression suites: agency 20 passed, SaaS 40 passed, restaurant 28 passed (both browsers).
- Shared header parity: 47 pages. Indonesian mirror parity, module parsing (197 files), structural drift (including app Lucide icons), design lint and isolated prepare-deploy checks passed.
- Screenshot review: `.qa/public-navbar/review-en-desktop-0.png`, `review-en-desktop-1.png`, `review-id-desktop-0.png`, `review-id-desktop-1.png`, `review-en-mobile.png`, `review-id-mobile.png`; family contact sheet `all-icons.png`.
- No newly introduced product claims, customer proof or external-license assets. No approval needed for original generated assets. Department Heads retains the existing homepage destination.
