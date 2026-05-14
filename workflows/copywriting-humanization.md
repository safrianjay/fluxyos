# FluxyOS Copywriting Humanization Workflow

## Purpose

Use this workflow when improving FluxyOS website copy so it feels more human, specific, product-led, and less AI-generated.

This workflow is for copy changes only.

It must respect:
- CLAUDE.md
- AGENTS.md
- PROJECT_BACKGROUND.md
- SYSTEM_DESIGN.md
- SEO_STRATEGY.md
- QA_CHECKLIST.md
- LOCALIZATION_PLAN.md if present

## Priority Order

When instructions conflict, follow this order:

1. Do not break product behavior, routing, auth, Firestore, shared JS, or layout.
2. Preserve existing page structure and component structure.
3. Improve copy clarity, specificity, and human tone.
4. Preserve SEO intent and metadata quality.
5. Preserve bilingual consistency between English and Indonesian.
6. Run the required QA checklist before marking complete.

## Hard Constraints

Do not change:
- layout
- spacing
- Tailwind classes
- CSS
- component structure
- routes
- links unless the link text itself is being improved
- images
- icons
- animations
- Firestore logic
- Firebase logic
- JS behavior
- shared function names
- DOM IDs
- schema claims unless explicitly asked

You may change:
- visible headlines
- subheadlines
- body copy
- CTA text
- feature card copy
- FAQ copy
- footer copy
- nav labels only if unclear
- meta title and meta description only when the task includes SEO copy
- OG/Twitter text only when the task includes SEO/social preview copy
- Indonesian copy in /id/ counterparts

## Product Positioning

FluxyOS is a finance operations platform for business owners, operators, and finance teams who need real-time visibility across revenue, expenses, budgets, and cash movement.

FluxyOS is industry-agnostic. It can support businesses across different sectors, including but not limited to e-commerce, retail, F&B, agencies, services, and multi-entity operators.

The current market focus is Indonesia. Copy should feel grounded in Indonesian business operations, currency, local workflows, and local business realities.

The long-term direction is APAC. Do not write copy that traps FluxyOS as only an Indonesian SMB tool forever.

Avoid positioning FluxyOS as:
- only for SMBs
- only for finance teams
- only for e-commerce
- only for startups
- only for accounting teams
- only for Indonesia forever

Better positioning:
“Finance operations visibility for businesses that need clearer control over revenue, expenses, budgets, and cash movement.”

Sharper homepage positioning:
“See where your business money moves before the month ends.”

Alternative positioning:
- “Real-time finance operations visibility for growing businesses.”
- “Connect revenue, expenses, budgets, and cash movement in one operational finance view.”
- “Built for Indonesian businesses today. Designed to scale across APAC.”
- “For business owners and finance teams who need clearer control over money movement.”
- “From daily expenses to multi-entity finance operations, FluxyOS helps teams understand what is really happening with their money.”

Primary buyer:
- business owners
- founders
- operators
- CFOs
- finance managers
- finance teams

Company scale:
- small businesses
- growing SMEs
- mid-market teams
- larger multi-entity companies

Industry scope:
- industry-agnostic
- strongest examples may include e-commerce, retail, F&B, agencies, services, and multi-location businesses

Market scope:
- Indonesia-first
- APAC-ready

Copy rule:
The copy may mention Indonesia as the current focus, but should not make FluxyOS sound permanently limited to Indonesian SMBs.

Do not use:
“for Indonesian SMBs only”
“for small businesses only”
“for finance teams only”
“for every business, every industry, every scale”

Use:
“for Indonesian businesses”
“for growing businesses”
“for business owners and finance teams”
“for teams managing revenue, expenses, budgets, and cash movement”

## Voice Direction

The copy should feel:
- clear
- human
- specific
- operational
- credible
- practical
- founder-led
- useful to Indonesian businesses

The copy should not feel:
- overly futuristic
- too generic
- too SaaS-template
- too AI-generated
- too corporate
- too abstract
- too buzzword-heavy

## Avoid These Phrases

Avoid or reduce:
- revolutionary
- seamless
- cutting-edge
- unlock
- leverage
- supercharge
- transform your business
- central nervous system
- complete visibility
- centralize your control
- everything you need
- smarter finance
- modern businesses
- future of finance
- AI-powered unless AI is actually the mechanism being explained

## Better Copy Principles

Use operational truth instead of abstract claims.

Weak:
“Scale your operations. Centralize your control.”

Better:
“Know where your money is going before the month ends.”

Weak:
“FluxyOS acts as your central nervous system.”

Better:
“FluxyOS connects sales, expenses, budgets, and payouts so you can see what is really happening in the business.”

Weak:
“Complete internal visibility.”

Better:
“See revenue, spending, and budget movement across every business unit.”

Weak:
“Everything you need to track burn rate, allocate project budgets, and measure true ROI.”

Better:
“Track burn rate, compare spending against revenue, and catch budget issues before they become expensive.”

## AI Copy Rule

Do not make AI the hero unless the section is specifically about AI.

The business problem should be the hero.
AI should be explained as the mechanism.

Weak:
“AI automatically intercepts errors, routes budgets, and reconciles expenses.”

Better:
“FluxyOS flags budget issues, missing categories, and reconciliation gaps before they slow down your finance team.”

Indonesian:
“FluxyOS menandai masalah budget, kategori yang belum lengkap, dan selisih rekonsiliasi sebelum menghambat kerja tim finance.”

## English Rules

- Use simple, direct English.
- Prefer active voice.
- Avoid startup clichés.
- Keep headlines short.
- Keep subheadlines useful.
- Avoid exaggerated claims.
- Do not invent customer proof, metrics, testimonials, or ratings.

## Indonesian Rules

- Use natural Indonesian, not literal translated English.
- Use casual professional tone.
- Use “Anda.”
- Keep sentences short.
- Use active verbs.
- Avoid bureaucratic language.
- Keep brand and product names in English:
  FluxyOS, Fluxy AI, Revenue Sync, Vendor Spend, Receipt Capture, Dynamic Budgeting, AI Agents.
- Common business terms may stay English when more natural:
  cash flow, dashboard, budget, payout, revenue, expense, real-time.

Good Indonesian positioning:
“Untuk business owner dan tim finance yang ingin melihat pergerakan uang bisnis tanpa menunggu laporan akhir bulan.”

Another good version:
“FluxyOS membantu business owner dan tim finance melihat revenue, biaya, budget, dan cash flow dalam satu tempat.”

## SEO Protection Rules

When changing landing page copy:
- Preserve the page’s target keyword intent.
- Keep first paragraph clear and definitional when possible.
- Do not remove FAQ content if schema depends on it.
- Do not create hidden FAQ schema that is not visible on the page.
- If meta title or description changes, keep:
  - title ≤ 60 characters
  - meta description ≤ 160 characters
- Do not add fake reviews, fake ratings, fake customer counts, or unsupported savings claims.
- If content materially changes, remind the user that sitemap lastmod may need an update.

## SEO Positioning Rule

SEO pages may target SMB keywords when the page is specifically intended for SMB search intent.

However, brand-level copy should use broader language:
- Indonesian businesses
- growing businesses
- business owners and finance teams
- multi-entity teams
- companies managing revenue, expenses, and budgets

Use “SMB” only where it supports search intent, not as the whole brand identity.

## Localization Rules

If editing an English user-facing page and an /id/ counterpart exists, update both in the same task.

If /id/ counterpart does not exist, report:
“Indonesian counterpart not found. Copy proposal provided, but no /id/ file was edited.”

Do not ship English-only copy updates when /id/ counterpart exists.

## Recommended Workflow

### Phase 1 — Audit Only

Do not edit files.

Create a copy inventory:
- file path
- page name
- section name
- current copy
- why it feels AI-generated/generic/unnatural
- suggested English rewrite direction
- suggested Indonesian rewrite direction if relevant
- SEO risk
- rewrite priority: High / Medium / Low

### Phase 2 — Rewrite Proposal

Do not edit files.

For selected page only, provide:
- current copy
- revised English copy
- revised Indonesian copy if relevant
- why the new copy is better
- SEO risk if any
- layout length risk if any

### Phase 3 — Apply Copy Only

Edit only approved copy.

Do not touch:
- layout
- styling
- classes
- components
- JS behavior
- routes
- images
- icons
- animation
- Firestore/Firebase logic

### Phase 4 — QA

Run:
- Smoke Tests
- Landing Page/UI checklist for marketing pages
- SEO checks if title/meta/schema/FAQ changed
- Cross-page regression if shared files changed
- Final Gate

Report:
- files changed
- copy blocks changed
- EN/ID pairing status
- SEO risks
- QA completed
- manual QA items not verified
