# FluxyOS — SEO Strategy & Execution Plan

**Goal:** Get FluxyOS visible to Indonesian SMB owners searching for finance,
bookkeeping, and AI accounting tools — both in classic Google search results
AND in Google's AI Overview / SGE results, plus AI search engines (Perplexity,
ChatGPT search, Claude search).

**Audience:** Indonesian finance teams, restaurant owners, e-commerce sellers,
agency operators, founders. Search behavior splits between English (tech-savvy
founders, finance professionals) and Bahasa Indonesia (broader SMB market).

**Domain assumption:** `fluxyos.com` (adjust paths if domain differs).

---

## 1. Current State Assessment

### What's good
- ✅ Clean URL structure (`/vendorspend` not `?id=4`)
- ✅ HTTPS via Netlify
- ✅ Mobile-responsive (Tailwind)
- ✅ Already-localized currency (Rp formatting)
- ✅ Live JS language switcher (EN/ID)

### What's missing (the big gaps)
- ❌ No `<meta name="description">` on any page
- ❌ No Open Graph or Twitter Card tags (link previews look generic)
- ❌ No Schema.org structured data anywhere — **critical** for AI Overviews
- ❌ No `sitemap.xml`
- ❌ No `robots.txt`
- ❌ No canonical URL tags
- ❌ No FAQ sections on feature pages (huge AI Overview opportunity)
- ❌ No `llms.txt` for AI search engines
- ❌ Tailwind CDN — kills Largest Contentful Paint scores
- ❌ Title tags are generic ("FluxyOS | Vendor Spend") — no keyword targeting
- ❌ Most SVG icons missing `aria-label` / `<title>` for accessibility (also a search signal)
- ❌ No analytics / Search Console wired

---

## 2. KPIs & Success Metrics

Define these BEFORE running tactics, so we can measure impact:

| Metric | Tool | Baseline (today) | 90-day target |
|--------|------|------------------|---------------|
| Organic clicks | Google Search Console | 0 | 500 / month |
| Indexed pages | Google Search Console | <10 | 30+ |
| Avg. position for "vendor management indonesia" | GSC | unranked | top 20 |
| Avg. position for "AI accounting software indonesia" | GSC | unranked | top 30 |
| AI Overview appearances | Manual SERP checks | 0 | feature on 3+ queries |
| Lighthouse Performance score | PageSpeed Insights | unknown | ≥90 mobile |
| Core Web Vitals — LCP | PSI | unknown | <2.5s |
| Core Web Vitals — INP | PSI | unknown | <200ms |
| Core Web Vitals — CLS | PSI | unknown | <0.1 |

---

## 3. Strategy Pillars

### Pillar A — Technical Foundation
The non-negotiables: meta tags, sitemap, schema, performance. Must be in place
before any other tactic returns value.

### Pillar B — AI Overview Optimization
Google's AI Overview pulls authoritative, structured content. Optimizing for it
ALSO optimizes for classic featured snippets and AI search engines (Perplexity,
ChatGPT). Tactics: Schema.org, FAQ blocks, clear definitions, Q&A structure.

### Pillar C — Keyword-Targeted Content
Target high-intent Indonesian and English keywords. Existing pages get
re-titled and described against these keywords; new pages (comparison,
glossary, blog) cover gaps.

### Pillar D — Indonesian Localization (links to LOCALIZATION_PLAN.md)
Real `/id/*.html` pages indexed separately from English ones, with proper
hreflang. This is **separate from the JS switcher** — for SEO we need real
Indonesian URLs.

### Pillar E — Authority & Off-Page
Backlinks, brand mentions, directory listings. Long-tail tactic — month 2+.

---

## 4. Phase 0 — Foundations (Week 1, MUST-DO)

### 4.1 Meta tags on every page

In every `<head>` (replace placeholders):

```html
<title>Vendor Spend Management Software for Indonesian SMBs | FluxyOS</title>
<meta name="description" content="Centralize vendor invoices, automate approvals, and pay on time. FluxyOS Vendor Spend helps Indonesian businesses control SaaS, contractor, and supplier payments — saving 12+ hours every month.">
<meta name="keywords" content="vendor management indonesia, manajemen vendor, software keuangan UKM, vendor spend">
<link rel="canonical" href="https://fluxyos.com/vendorspend">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="Vendor Spend Management for Indonesian SMBs | FluxyOS">
<meta property="og:description" content="Centralize vendor invoices and automate approvals. Save 12+ hours every month on vendor management.">
<meta property="og:image" content="https://fluxyos.com/assets/images/og-vendorspend.png">
<meta property="og:url" content="https://fluxyos.com/vendorspend">
<meta property="og:site_name" content="FluxyOS">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="id_ID">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Vendor Spend Management for Indonesian SMBs">
<meta name="twitter:description" content="Centralize vendor invoices and automate approvals.">
<meta name="twitter:image" content="https://fluxyos.com/assets/images/og-vendorspend.png">
```

**Action items:**
- [ ] Write title + description for each of the 7 landing pages (template below in §5)
- [ ] Create 7 OG images (1200×630px) — one per page, with the page's headline
  on a branded background. Save as `assets/images/og-{page}.png`.
- [ ] Add canonical URL to each page using its absolute URL.

### 4.2 robots.txt at repo root

```
User-agent: *
Allow: /

# Block app pages from indexing — they're behind auth
Disallow: /dashboard
Disallow: /bill
Disallow: /subscription
Disallow: /ledger

# Block any test files
Disallow: /test
Disallow: /assets/_temp/

Sitemap: https://fluxyos.com/sitemap.xml
```

### 4.3 sitemap.xml at repo root

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <url>
    <loc>https://fluxyos.com/</loc>
    <lastmod>2026-05-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="https://fluxyos.com/"/>
    <xhtml:link rel="alternate" hreflang="id" href="https://fluxyos.com/id/"/>
  </url>

  <url>
    <loc>https://fluxyos.com/pricing</loc>
    <lastmod>2026-05-09</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>

  <url><loc>https://fluxyos.com/budgetlanding</loc><lastmod>2026-05-09</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://fluxyos.com/revenuesync</loc><lastmod>2026-05-09</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://fluxyos.com/vendorspend</loc><lastmod>2026-05-09</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://fluxyos.com/receiptcapture</loc><lastmod>2026-05-09</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://fluxyos.com/aiagents</loc><lastmod>2026-05-09</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>
</urlset>
```

When `/id/` pages ship, add their entries with hreflang alternates.

### 4.4 Google Search Console

- [ ] Verify domain via Netlify DNS TXT record
- [ ] Submit sitemap.xml
- [ ] Confirm coverage (no errors)
- [ ] Set target country: Indonesia (Search Console → Settings → International Targeting)

### 4.5 Plausible or Google Analytics

Pick one (Plausible recommended — privacy-friendly, cookieless, fast). Add the
script to all pages. Track: organic search traffic, top landing pages, sign-up
conversions.

---

## 5. Phase 0 — Title & Description Library

Use as the canonical source for SEO copy. Indonesian variants belong in
LOCALIZATION_PLAN.md §2 glossary.

| Page | Title (≤60 chars) | Description (≤160 chars) |
|------|-------------------|--------------------------|
| `/` (homepage) | FluxyOS — AI Finance Operations for Indonesian SMBs | Connect your bank, vendors, and sales channels. AI agents handle reconciliation, categorization, and reporting — saving 32+ hours every month. |
| `/pricing` | FluxyOS Pricing — Plans for Indonesian Businesses | Simple, transparent pricing. Start free. Plans for solo founders, growing teams, and finance departments. |
| `/aiagents` | AI Finance Agents — 6 Specialists for Your Books \| FluxyOS | Six AI agents handle bank reconciliation, transaction tagging, invoice chasing, and monthly reports — automatically. |
| `/vendorspend` | Vendor Spend Management for Indonesian SMBs \| FluxyOS | Centralize vendor invoices, automate approvals, catch duplicate payments. Save 12+ hours every month. |
| `/receiptcapture` | AI Receipt Capture — Snap, WhatsApp, or Email \| FluxyOS | Send receipts via WhatsApp, email, or upload. AI extracts vendor, amount, tax, and category in seconds. |
| `/revenuesync` | Revenue Sync — Connect Stripe, Tokopedia, Shopify \| FluxyOS | Sync revenue from 250+ payment platforms in real-time. Every transaction lands in your unified ledger. |
| `/budgetlanding` | Dynamic Budgeting for Modern Businesses \| FluxyOS | Allocate, track, and adjust budgets in real-time. Live spend visibility against every budget category. |

Write Indonesian variants for `/id/` pages (later phase). Keep titles under 60
characters or Google truncates them.

---

## 6. Phase 1 — Schema.org Structured Data (Week 1–2)

Schema.org JSON-LD is **the single biggest lever for AI Overview eligibility**.
Add to every page's `<head>` or before `</body>`.

### 6.1 Organization schema (every page)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "FluxyOS",
  "url": "https://fluxyos.com",
  "logo": "https://fluxyos.com/assets/images/logo.png",
  "description": "AI-powered Finance Operations System for Indonesian small and medium businesses.",
  "foundingDate": "2024",
  "areaServed": {
    "@type": "Country",
    "name": "Indonesia"
  },
  "sameAs": [
    "https://www.linkedin.com/company/fluxyos",
    "https://twitter.com/fluxyos",
    "https://www.instagram.com/fluxyos"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer support",
    "email": "support@fluxyos.com",
    "availableLanguage": ["English", "Indonesian"]
  }
}
</script>
```

### 6.2 SoftwareApplication schema (homepage + each feature page)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "FluxyOS Vendor Spend",
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Accounting Software",
  "operatingSystem": "Web, iOS, Android",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "IDR",
    "availability": "https://schema.org/InStock"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "127",
    "bestRating": "5"
  },
  "description": "Centralized vendor spend management for Indonesian SMBs.",
  "featureList": [
    "Vendor invoice centralization",
    "Approval workflow automation",
    "Duplicate payment detection",
    "Multi-currency reconciliation",
    "PPN tax-ready exports"
  ]
}
</script>
```

⚠ Only include `aggregateRating` if you actually have customer reviews. Fake
ratings will get the schema rejected and can trigger manual penalties.

### 6.3 FAQPage schema (each feature page)

This is the **biggest AI Overview win**. Google's AI Overview frequently pulls
direct answers from FAQPage schema.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is vendor spend management?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Vendor spend management is the process of tracking, approving, and paying every supplier and SaaS bill in one centralized system instead of email threads and spreadsheets. It lets finance teams catch duplicates, enforce approval limits, and audit who paid whom."
      }
    },
    {
      "@type": "Question",
      "name": "How does FluxyOS Vendor Spend work?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Forward bills to your FluxyOS inbox, set approval rules once (e.g. anything over Rp 5M needs a director), and FluxyOS routes each invoice for sign-off, schedules payment, and posts the entry to your ledger automatically."
      }
    },
    {
      "@type": "Question",
      "name": "Is vendor spend management worth it for small businesses?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes — even a 10-person team typically pays 30+ vendors monthly. Manual tracking misses duplicates and renewal creep. FluxyOS users save an average of 12 hours per month and recover Rp 47M per quarter in catches alone."
      }
    },
    {
      "@type": "Question",
      "name": "Does FluxyOS support Indonesian banks?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. FluxyOS integrates with BCA, Mandiri, BNI, BRI, and 10+ Indonesian banks for automated reconciliation. Multi-currency reconciliation handles USD, SGD, and 120+ other currencies."
      }
    },
    {
      "@type": "Question",
      "name": "How is FluxyOS different from Xero or QuickBooks?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Xero and QuickBooks are accounting ledgers — they record what already happened. FluxyOS is a finance operations system: it captures invoices, automates approvals, chases unpaid bills, and pushes the cleaned data into Xero or QuickBooks if you want to keep using them."
      }
    }
  ]
}
</script>
```

**Action items:**
- [ ] Write 5–8 Q&As per feature page using real user questions (mine from
  customer support, sales calls, or "People also ask" boxes on Google).
- [ ] Add the corresponding visible FAQ section in the page body so the schema
  matches what users see (Google penalizes hidden-content schema).

### 6.4 BreadcrumbList schema

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://fluxyos.com/" },
    { "@type": "ListItem", "position": 2, "name": "Platform", "item": "https://fluxyos.com/#platform" },
    { "@type": "ListItem", "position": 3, "name": "Vendor Spend", "item": "https://fluxyos.com/vendorspend" }
  ]
}
</script>
```

### 6.5 Product schema (pricing page)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "FluxyOS Pro",
  "description": "Full Finance Operations System with all 6 AI agents.",
  "brand": { "@type": "Brand", "name": "FluxyOS" },
  "offers": {
    "@type": "AggregateOffer",
    "lowPrice": "490000",
    "highPrice": "9900000",
    "priceCurrency": "IDR",
    "offerCount": "3"
  }
}
</script>
```

### 6.6 HowTo schema (great for "how do I" queries)

For pages explaining a process — e.g., "How to capture receipts via WhatsApp":

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "How to capture business receipts with FluxyOS",
  "step": [
    {
      "@type": "HowToStep",
      "name": "Open WhatsApp",
      "text": "Open WhatsApp on your phone and find your FluxyOS AI contact (+62 812 FLUXY-AI)."
    },
    {
      "@type": "HowToStep",
      "name": "Send a photo of the receipt",
      "text": "Take a photo of the receipt and send it. Within 5 seconds, the AI replies with extracted vendor, amount, and category."
    },
    {
      "@type": "HowToStep",
      "name": "Confirm the category",
      "text": "Tap the suggested category to confirm, or pick a different one. The receipt is filed in your dashboard automatically."
    }
  ]
}
</script>
```

---

## 7. Phase 2 — AI Overview & AI Search Optimization

### 7.1 Content structure for AI Overview eligibility

Google's AI Overview pulls from content that:
1. **Answers the query directly** in the first paragraph
2. **Uses scannable structure** — H2/H3, bullets, tables
3. **Cites authoritative sources** with links
4. **Has structured data** (FAQPage, HowTo)
5. **Shows freshness** (recent `lastmod`, dated content)

**Pattern to use on every feature page:**

```html
<section id="faq" class="py-16 px-6 border-t border-gray-200">
  <h2 class="text-[32px] font-bold mb-8">Frequently asked questions</h2>

  <details class="border-b border-gray-200 py-5">
    <summary class="flex items-center justify-between cursor-pointer">
      <h3 class="text-[18px] font-bold">What is vendor spend management?</h3>
      <svg class="w-5 h-5">…</svg>
    </summary>
    <p class="mt-3 text-gray-700">
      Vendor spend management is the process of tracking, approving, and paying
      every supplier and SaaS bill in one centralized system instead of email
      threads and spreadsheets. <strong>It lets finance teams catch duplicates,
      enforce approval limits, and audit who paid whom.</strong>
    </p>
  </details>
  <!-- 4–7 more Q&As -->
</section>
```

The bolded sentence is what AI Overview tends to extract. Lead with the direct
answer, then expand.

### 7.2 The "What is X" hero pattern

Add a one-paragraph definition near the top of each feature page (right after
the hero CTA section):

```html
<section class="py-12 px-6 max-w-3xl mx-auto">
  <p class="text-[18px] text-gray-700 leading-relaxed">
    <strong>FluxyOS Vendor Spend</strong> is an AI-powered tool that
    centralizes every vendor invoice, contractor payment, and SaaS subscription
    your business pays. Instead of chasing PDFs across email and Slack, every
    bill lands in one inbox, gets routed for approval based on rules you set,
    and posts to your accounting ledger automatically. Built for Indonesian
    SMBs, with support for IDR, multi-currency, and PPN.
  </p>
</section>
```

Why: AI Overview treats short, factual definitions as primary sources. The
"<strong>Product Name</strong> is a [category] that [does X]" pattern is the
exact format AI engines parse cleanly.

### 7.3 llms.txt at repo root

Emerging standard (Anthropic + others) for telling AI search engines what your
site is and which pages matter. Place at `/llms.txt`:

```markdown
# FluxyOS

> AI-powered Finance Operations System for Indonesian small and medium businesses.
> Connects bank feeds, vendors, sales channels, and tax filing in one place.
> Six specialized AI agents handle reconciliation, transaction categorization,
> invoice chasing, and monthly reporting automatically.

## Core pages

- [Homepage](https://fluxyos.com/): Product overview and key benefits
- [Pricing](https://fluxyos.com/pricing): Plans starting from free tier
- [AI Agents](https://fluxyos.com/aiagents): Six specialist AI agents that handle finance ops
- [Vendor Spend](https://fluxyos.com/vendorspend): Centralized vendor invoice + approval management
- [Revenue Sync](https://fluxyos.com/revenuesync): Sync revenue from 250+ payment platforms
- [Receipt Capture](https://fluxyos.com/receiptcapture): AI receipt scanning via WhatsApp, email, app
- [Dynamic Budgeting](https://fluxyos.com/budgetlanding): Live budget allocation and tracking

## Key facts

- Built specifically for Indonesian SMBs
- Supports BCA, Mandiri, BNI, BRI, and 10+ Indonesian banks
- Pricing in Indonesian Rupiah (IDR)
- Multi-currency support: 120+ currencies
- PPN 11% tax handling built in
- Average customer saves 32 hours per month
- 99.2% AI categorization accuracy after 1 week of learning

## Optional

- [Localization plan](https://fluxyos.com/LOCALIZATION_PLAN.md)
- [SEO strategy](https://fluxyos.com/SEO_STRATEGY.md)
```

Add to robots.txt:
```
# AI search engines
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /
```

### 7.4 Direct-answer optimizations in body copy

Re-write hero subheads to lead with the direct answer pattern AI engines parse:

**Before:**
> "Six AI agents handle the work that keeps your team up late — categorizing
> transactions, reconciling bank feeds, chasing unpaid invoices…"

**After:**
> "FluxyOS AI Agents are six specialized AI workers that automate the most
> time-consuming finance tasks — transaction categorization, bank
> reconciliation, invoice collection, and monthly report drafting. They run
> 24/7 and ask before any money moves."

The "<Product> is/are <category> that <action>" pattern is template-perfect
for AI Overview citations.

---

## 8. Phase 3 — Keyword-Targeted Content (Week 2–4)

### 8.1 Keyword research — prioritize by intent + volume

Use Ahrefs / SEMrush / Google Keyword Planner / Ubersuggest. Target three
groups:

**Group A — High intent, transactional (English)**
- vendor management software
- AI accounting software
- accounts payable automation
- expense management software indonesia
- saas spend management
- receipt scanner app indonesia
- bookkeeping software indonesia

**Group B — High intent, transactional (Bahasa)**
- software keuangan UKM
- aplikasi pembukuan otomatis
- manajemen vendor indonesia
- aplikasi scan struk
- software akuntansi UKM
- aplikasi catat keuangan bisnis
- software invoice indonesia

**Group C — Informational (top-of-funnel — feeds AI Overview)**
- "what is vendor spend management"
- "apa itu manajemen vendor"
- "how to track receipts for taxes indonesia"
- "cara catat pengeluaran usaha"
- "best accounting software for restaurants indonesia"
- "PPN 11% calculator"
- "how to do bank reconciliation"

Output: `KEYWORD_TARGETS.md` with monthly volume, difficulty, current rank,
and target page assignment.

### 8.2 Content gaps — pages to create

Based on keyword targeting:

| New page | URL | Target keyword | Type |
|----------|-----|----------------|------|
| Glossary / wiki | `/glossary/vendor-spend-management` | "what is vendor spend management" | Informational |
| Comparison | `/compare/fluxyos-vs-xero` | "fluxyos vs xero" | Comparison |
| Comparison | `/compare/fluxyos-vs-jurnal` | "jurnal vs fluxyos" | Comparison (Indonesian competitor) |
| Industry | `/industries/restaurants` | "software keuangan restoran" | Industry-targeted |
| Industry | `/industries/ecommerce` | "software keuangan e-commerce indonesia" | |
| Calculator | `/tools/ppn-calculator` | "kalkulator PPN 11%" | Tool / link bait |
| Blog | `/blog` | (varies) | Long-term |

### 8.3 Internal linking strategy

Every feature page should link to:
- The homepage anchor explaining its category
- The pricing page (transactional)
- 2–3 related feature pages with descriptive anchor text
- 1–2 blog posts or comparison pages (after Phase 3)

Anchor text rule: use the **target keyword** of the destination page, not
"click here" or "learn more".

---

## 9. Phase 4 — Performance & Core Web Vitals (Week 3–4)

### 9.1 Replace Tailwind CDN with built CSS

The Tailwind CDN script (`https://cdn.tailwindcss.com`) is the single biggest
LCP killer on the site. Currently it parses your HTML at runtime and generates
CSS in JavaScript — this blocks rendering.

**Action:**
- [ ] Install Tailwind CLI locally (no build step required for production —
  generate CSS once and commit)
- [ ] Run `npx tailwindcss -i src.css -o assets/css/tailwind.min.css --minify`
- [ ] Replace `<script src="https://cdn.tailwindcss.com">` with
  `<link rel="stylesheet" href="assets/css/tailwind.min.css">`
- [ ] Re-run the CSS build whenever new Tailwind classes are introduced

Expected impact: LCP drops by 1–2 seconds on slow connections.

### 9.2 Other performance wins

- [ ] Add `loading="lazy"` to all images below the fold
- [ ] Preload hero image and primary font:
  ```html
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.gstatic.com/s/inter/...woff2" as="font" type="font/woff2" crossorigin>
  ```
- [ ] Defer non-critical JS:
  ```html
  <script src="assets/js/footer-loader.js" defer></script>
  <script src="assets/js/i18n.js" defer></script>
  ```
- [ ] Add explicit `width` and `height` to all `<img>` tags (prevents layout shift)
- [ ] Verify no unused CSS (Tailwind purge handles this if built correctly)
- [ ] Compress images (PNG → WebP/AVIF for OG images)

### 9.3 Lighthouse audit — pre-deploy gate

Add a manual checklist: every commit that touches HTML must score ≥85 on
Lighthouse Performance and ≥95 on SEO. Run via PageSpeed Insights or
`npx lighthouse https://fluxyos.com/<page> --view`.

---

## 10. Phase 5 — Indonesian SEO (links to LOCALIZATION_PLAN.md)

For Bahasa Indonesia rankings, the JS switcher is **insufficient** — Google
indexes one URL per language. We need:

- [ ] Real `/id/*.html` pages per LOCALIZATION_PLAN.md
- [ ] hreflang tags on every page (already specified in LOCALIZATION_PLAN.md §4)
- [ ] `<html lang="id">` on Indonesian pages
- [ ] Indonesian sitemap entries with `xhtml:link` alternates
- [ ] Google Search Console: confirm Indonesian property indexing

This unlocks rankings for Bahasa search queries (largest Indonesian SMB
market).

---

## 11. Phase 6 — Authority Building (Month 2+)

### 11.1 Backlink targets

Indonesian:
- DailySocial.id, TechinAsia ID, KrAsia (tech press)
- Hipwee, IDN Times (broader business)
- Partnership pages: Tokopedia, Mandiri, BCA developer portals
- Indonesian SaaS directory listings

Global:
- Product Hunt launch
- Capterra, G2 Crowd, GetApp listings (with real reviews — not fake)
- BetaList for SaaS launches
- Indie Hackers

### 11.2 Guest content

- 2 guest posts/month on finance + SMB blogs
- Anchor text: branded ("FluxyOS") and topic-related ("vendor spend management")
- Avoid keyword-stuffed exact-match anchors (Google penalty risk)

### 11.3 Brand mentions monitoring

Google Alerts or Mention.com for "FluxyOS" — request unlinked mentions become
links via friendly outreach.

---

## 12. Phase 7 — AI Search Engine Optimization (ongoing)

Beyond Google AI Overview, optimize for AI search engines users actively use:

| Engine | What it cares about |
|--------|---------------------|
| **Perplexity** | Citations, recency, structured content |
| **ChatGPT search** | Authority, freshness, llms.txt |
| **Claude search** | llms.txt, factual structure |
| **Gemini** | Schema.org, E-E-A-T |

**Tactics that help all four:**
- llms.txt (covered in §7.3)
- FAQPage schema (§6.3)
- Clear "X is Y that does Z" sentences in body copy
- Updated lastmod dates in sitemap
- Canonical URLs (no duplicate content)
- Strong external citations (link to BPS, Bank Indonesia, OJK for stats)

### Test queries to monitor monthly

Run these in each AI engine and check if FluxyOS appears:
- "best accounting software for indonesian smbs"
- "AI vendor management indonesia"
- "how to scan receipts with whatsapp"
- "software pembukuan UKM indonesia"
- "alternative to xero in indonesia"

Track in a spreadsheet — month over month presence.

---

## 13. Execution Calendar (12-week roadmap)

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | Foundations | meta tags, robots.txt, sitemap.xml, GSC verified, OG images, canonical URLs, analytics live |
| 2 | Schema rollout | Organization, SoftwareApplication, Product, BreadcrumbList on all pages; FAQ sections written + FAQPage schema on 4 feature pages |
| 3 | AI Overview push | llms.txt, "What is X" hero blocks, FAQ sections complete on remaining pages, HowTo schema on receipt page |
| 4 | Performance | Tailwind CDN → built CSS, lazy-load, preload fonts, defer JS, Lighthouse ≥90 mobile |
| 5–6 | Content gaps | Glossary page, 2 comparison pages (vs Xero, vs Jurnal), industry pages (restaurants, e-commerce) |
| 7–8 | Indonesian launch | First 4 `/id/*.html` pages live (per LOCALIZATION_PLAN.md), hreflang wired, Indonesian sitemap |
| 9–10 | Tools / link bait | PPN calculator tool, free template downloads (vendor list, expense tracker template) |
| 11–12 | Authority | Product Hunt launch, 4 guest posts, directory submissions, first backlink outreach batch |

---

## 14. Maintenance Rules (Add to CLAUDE.md)

Once SEO foundations ship, every change must respect them:

1. **New page?** Must include: title, description, canonical URL, OG tags,
   relevant Schema.org block, sitemap entry. Use templates in §5.
2. **Heading change?** Re-run keyword check — does the new copy still target
   the page's intended keyword?
3. **Content removed?** Check internal links pointing to it — update or
   redirect with a 301.
4. **Performance regression?** Tailwind CDN comes back, large image added
   without optimization, JS unblocked → reject the change. Lighthouse ≥85
   mobile is a deploy gate.
5. **Schema validation:** Use Google's Rich Results Test
   (https://search.google.com/test/rich-results) before pushing schema
   changes. Invalid JSON-LD silently breaks AI Overview eligibility.
6. **Update `lastmod` in sitemap.xml** when a page's content materially changes.

---

## 15. Open Questions — Resolve Before Phase 0

- [ ] **Confirmed domain?** `fluxyos.com` assumed throughout — replace if different.
- [ ] **OG image design?** Need 7 images (1200×630). Who designs?
- [ ] **Real customer testimonials/ratings for SoftwareApplication schema?**
  Don't include `aggregateRating` until real reviews exist.
- [ ] **Pricing in IDR or USD?** SoftwareApplication / Product schema needs
  the right `priceCurrency` — verify pricing page is in IDR for Indonesian SEO.
- [ ] **Analytics choice** — Plausible (~$9/mo, privacy-friendly) vs. GA4 (free,
  cookie banner needed). Recommendation: Plausible for SMB-targeted product.
- [ ] **Customer support email** for `contactPoint` schema?
- [ ] **Social handles** — confirm/create LinkedIn, Twitter, Instagram for
  Organization schema `sameAs` array.
- [ ] **Who owns translation** for Indonesian SEO copy (titles, descriptions,
  body) — same as LOCALIZATION_PLAN.md decision.

---

## 16. Definition of Done — Phase 0 (must-do baseline)

- [ ] All 7 pages have unique title (≤60 chars), description (≤160 chars), canonical URL
- [ ] All 7 pages have OG + Twitter Card tags + branded OG image
- [ ] All 7 pages have Organization + SoftwareApplication JSON-LD
- [ ] `robots.txt` and `sitemap.xml` deployed at root
- [ ] Google Search Console verified, sitemap submitted, country = Indonesia
- [ ] Plausible (or GA4) installed and recording traffic
- [ ] `llms.txt` deployed at root
- [ ] `<html lang="en">` correct, `<title>` tags match table in §5
- [ ] Lighthouse SEO score ≥95 on every page
