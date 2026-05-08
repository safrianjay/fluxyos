# FluxyOS — Localization Plan (Bahasa Indonesia)

**Goal:** Translate every public landing page to Indonesian with a casual-professional
tone aimed at SMB owners (warung owners, café managers, e-commerce founders, agency
operators). The English version stays in place; Indonesian becomes the second
fully-supported locale, switchable from the existing `EN ▾` dropdown in the navbar.

---

## 1. Strategy Decision

### Recommended approach: **duplicate translated files in `/id/` directory**

| | Option A — Duplicate `/id/*.html` (PICKED) | Option B — JS i18n switcher |
|--|--|--|
| Build step needed | None | None |
| SEO | Real Indonesian URLs indexed | One URL per page, harder to rank |
| Page weight | Same as current | +1 dictionary file (~30 KB) |
| Maintenance | Edit copy in 2 places | Edit dictionary + add `data-i18n` attrs |
| Crash blast radius | Per-locale (one page fails, other still works) | Whole page can fail if JS errors |
| Right for our stack | ✅ static HTML, no bundler | ❌ needs JS to render base text |

We pick **Option A**. Reason: the site is static HTML served by Netlify with no
build step. Having real `/id/fluxyos.html`, `/id/pricing.html` etc. lets Google
index Indonesian content properly, lets us share URLs in Indonesian-first
contexts (WhatsApp, IG ads), and avoids a JS-rendering layer that would slow
first paint.

### Folder structure (final)

```
/                          ← English (default)
  fluxyos.html
  pricing.html
  budgetlanding.html
  revenuesync.html
  vendorspend.html
  receiptcapture.html
  aiagents.html
  login.html
  includes/footer.html

/id/                       ← Indonesian
  fluxyos.html
  pricing.html
  budgetlanding.html
  revenuesync.html
  vendorspend.html
  receiptcapture.html
  aiagents.html
  login.html
  includes/footer.html     ← OR shared via data-attr trick (see §6)

/assets/                   ← shared, no duplication
```

### URL routing (Netlify `_redirects` or `netlify.toml`)

```
# Pretty paths
/id              /id/fluxyos.html       200
/id/pricing      /id/pricing.html       200
/id/budgetlanding /id/budgetlanding.html 200
/id/revenuesync   /id/revenuesync.html   200
/id/vendorspend   /id/vendorspend.html   200
/id/receiptcapture /id/receiptcapture.html 200
/id/aiagents      /id/aiagents.html      200
```

---

## 2. Tone Guidelines — "Casual Professional for Business Owners"

The audience is an Indonesian SMB owner — restaurant manager, online seller,
agency founder. They are smart, practical, and time-poor. They speak Bahasa
Indonesia mixed with everyday English (Slack, dashboard, invoice, online shop).

### Voice rules

| Rule | Do | Don't |
|------|----|-------|
| Pronoun | **Anda** (formal, but conversational) | "Kamu" (too casual for B2B), "Saudara" (too stiff) |
| Sentence length | Short. Pendek. Direct. | Multi-clause government-doc style |
| Verbs | Active, concrete (`hubungkan`, `tarik`, `pantau`) | Bureaucratic (`mengintegrasikan`, `mengakuisisi`, `mengoptimalkan`) |
| Loan words | Keep ones already common (`invoice`, `dashboard`, `email`, `WhatsApp`, `online`) | Force-translate them (`papan instrumen`, `surat tagihan elektronik`) |
| Brand & product names | Keep as-is | Translate (`AWS`, `Stripe`, `FluxyOS` stay) |
| Numbers & money | `Rp 1.234.567` (already standard) | `Rp1,234,567` or `IDR 1234567` |
| Tone | Helpful peer, not a salesperson | Aggressive marketing copy, hype |

### Sample translations (set the bar)

| English | Bahasa (recommended) | Why |
|---------|----------------------|-----|
| "Snap a receipt. We'll do the rest." | "Foto struknya. Sisanya biar kami." | Short, conversational, "biar kami" is casual-professional |
| "Stop losing revenue to manual work." | "Berhenti kehilangan pendapatan karena kerjaan manual." | "Kerjaan" is conversational, not "pekerjaan manual" |
| "Get started free" (CTA) | "Coba Gratis" or "Mulai Sekarang" | 2 syllables — fits buttons |
| "See how it works" | "Lihat cara kerjanya" | Direct, no jargon |
| "AI is analyzing" | "AI sedang menganalisis" | Standard, clear |
| "Six finance jobs. Done automatically." | "Enam pekerjaan keuangan. Beres otomatis." | "Beres" is conversational |
| "Stop chasing vendor invoices in email threads" | "Berhenti mengejar invoice vendor di tumpukan email" | "Mengejar" is vivid, "tumpukan email" is relatable |
| "Pay vendors. Track spend. No spreadsheets." | "Bayar vendor. Pantau pengeluaran. Tanpa spreadsheet." | Three-beat rhythm preserved |
| "Categorize transactions" | "Kelompokkan transaksi" | "Kelompokkan" is plain, not "Mengkategorikan" |
| "Reconcile bank lines" | "Cocokkan rekening bank" | "Cocokkan" is everyday, not "Rekonsiliasi" |
| "Catch costly mistakes" | "Tangkap kesalahan mahal" | Direct |
| "Get you ready for tax season" | "Siap-siap musim pajak" | Conversational |
| "It's your usual supplier" | "Ini supplier langganan Anda" | "Langganan" is the natural word |
| "Filed for you. Done." | "Sudah dicatat. Beres." | "Beres" again — ties the voice together |
| "Your finance team, doubled overnight." | "Tim keuangan Anda, jadi dua kali lipat dalam semalam." | Keeps the punchy promise |

### Words that ALWAYS stay in English

- Product surfaces: **FluxyOS, Fluxy AI, Revenue Sync, Vendor Spend,
  Receipt Capture, Dynamic Budgeting**
- 3rd-party brands: AWS, Stripe, Shopify, Tokopedia, TikTok Shop, Alibaba,
  Moka, Xendit, Midtrans, WooCommerce, Slack, Notion, Figma, Adobe, GitHub,
  Vercel, Cloudflare, Discord, Loom, Zoom, Google Workspace, Microsoft 365,
  Asana, Canva, Dribbble, Mandiri, BCA, BNI, BRI, GoPay, OVO
- Common loanwords (already part of Indonesian business vocabulary):
  invoice, email, dashboard, online, e-commerce, WhatsApp, Slack, link, file,
  upload, drag and drop, screenshot, scan
- Currency code: USD, EUR (when comparing). IDR is `Rp`.

### Translation glossary — recurring product/finance terms

| English | Indonesian (canonical) | Notes |
|---------|------------------------|-------|
| Vendor Spend | Vendor Spend (keep) | Product name |
| Revenue Sync | Revenue Sync (keep) | Product name |
| Receipt Capture | Receipt Capture (keep) | Product name |
| Dynamic Budgeting | Dynamic Budgeting (keep) | Product name |
| AI Agents / AI team | AI Agents / Tim AI | "Tim AI" in body copy |
| Finance team | Tim keuangan | |
| Categorize / Tag | Kelompokkan / Tandai | Avoid "kategorisasi" — too stiff |
| Reconcile | Cocokkan | "Rekonsiliasi" only in titles where formality fits |
| Approve | Setujui | |
| Approval flow | Alur persetujuan | |
| Audit trail | Riwayat audit | |
| Bookkeeping | Pembukuan | |
| Bank statement | Rekening koran | |
| Bank feed | Mutasi rekening | "Feed" doesn't translate well |
| Cash flow | Arus kas | |
| Profit & Loss / P&L | Laba Rugi / P&L | Keep "P&L" in business copy |
| Burn rate | Burn rate (keep) | Untranslated standard |
| Runway | Runway (keep) | Untranslated standard |
| Vendor / Supplier | Vendor / Supplier (keep) | Both used in IDN business |
| Invoice | Invoice (keep) | |
| Receipt / Bill | Struk / Tagihan | Struk = retail receipt, Tagihan = bill |
| Tax / PPN | Pajak / PPN | PPN stays as is |
| Tax-ready export | Ekspor siap pajak | |
| Withholding tax | PPh Pasal | |
| Get started free (button) | Coba Gratis | |
| Sign in | Masuk | |
| Try FluxyOS (button) | Coba FluxyOS | |
| Pricing | Harga / Paket | |
| Customers | Pelanggan | |
| Use Cases | Studi Kasus | Or "Untuk Siapa" |
| By Industry | Berdasarkan Industri | |
| By Role | Berdasarkan Peran | |
| Save (verb) | Simpan | |
| Saves you ~12 hrs / month | Hemat ~12 jam / bulan | |
| Hours saved | Jam dihemat | |
| Anomaly / unusual charge | Transaksi mencurigakan | |
| Duplicate payment | Pembayaran ganda | |
| Reminder | Pengingat | |
| Overdue | Lewat jatuh tempo | |
| Currently active | Sedang berjalan | |
| Standing by | Siap siaga | |
| Live | Live (keep) | |
| Dashboard | Dashboard (keep) | |

---

## 3. Page-Level Scope

7 landing pages + footer + login page need translation.

| Priority | Page | Approx. lines | Notes |
|---|---|---|---|
| **P0** | `fluxyos.html` (homepage) | ~1740 | Highest traffic, most copy. |
| **P1** | `pricing.html` | ~700 | High intent — visitors decide here. |
| **P2** | `budgetlanding.html` | ~640 | First feature page in mega menu. |
| **P2** | `revenuesync.html` | ~830 | |
| **P2** | `vendorspend.html` | ~1245 | |
| **P2** | `receiptcapture.html` | ~1040 | |
| **P2** | `aiagents.html` | ~1245 | Killer feature, big translation. |
| **P3** | `includes/footer.html` | ~60 | Shared across all pages. |
| **P3** | `login.html` | ~150 | Auth flow strings. |

**App pages** (`dashboard.html`, `bill.html`, `subscription.html`, `ledger.html`,
`integration.html`) are out of scope for this plan — they live behind auth and
will be tackled separately when in-app i18n is built.

---

## 4. Hreflang & SEO Setup

Every translated page MUST include hreflang tags so Google serves the right
locale.

In `<head>` of each EN page:
```html
<link rel="alternate" hreflang="en" href="https://fluxyos.com/fluxyos.html" />
<link rel="alternate" hreflang="id" href="https://fluxyos.com/id/fluxyos.html" />
<link rel="alternate" hreflang="x-default" href="https://fluxyos.com/fluxyos.html" />
```

In `<head>` of each ID page:
```html
<link rel="alternate" hreflang="en" href="https://fluxyos.com/fluxyos.html" />
<link rel="alternate" hreflang="id" href="https://fluxyos.com/id/fluxyos.html" />
<link rel="alternate" hreflang="x-default" href="https://fluxyos.com/fluxyos.html" />
<link rel="canonical" href="https://fluxyos.com/id/fluxyos.html" />
```

Also set `<html lang="id">` on Indonesian pages (currently all say `lang="en"`).
Update `<title>` tags too — e.g. `Vendor Spend | FluxyOS` → `Vendor Spend | FluxyOS Indonesia`.

---

## 5. Language Switcher — Wire Up the Existing Dropdown

The navbar already has an EN/ID dropdown (in `fluxyos.html` lines ~308–322 and
mirrored in every page that uses the universal nav). Currently both options
point to `href="#"`. We make them work:

**On English pages:**
```html
<a href="#" class="…">English (EN) ✓</a>           <!-- current -->
<a href="/id{currentPath}" class="…">Bahasa (ID)</a>
```

**On Indonesian pages:**
```html
<a href="{currentPath stripped of /id}" class="…">English (EN)</a>
<a href="#" class="…">Bahasa (ID) ✓</a>             <!-- current -->
```

The `{currentPath}` substitution is page-specific — when generating each
translated file, hardcode the matching switcher target. Keep it simple, no JS
URL manipulation.

Also remember a 5px-tall yellow dot in the navbar's "EN" trigger so users see at
a glance which locale they're on (already styled, just needs the toggle).

---

## 6. Implementation Approach — Per-Page Steps

For each page (in priority order P0 → P3):

1. **Copy** `<page>.html` → `id/<page>.html`
2. **Update `<head>`:**
   - `<html lang="id">`
   - Add hreflang + canonical tags
   - Update `<title>` and `<meta name="description">` if present
3. **Translate visible text** following the glossary + tone guidelines
4. **Update internal links** to point to ID counterparts
   - `/budgetlanding` → `/id/budgetlanding`
   - `/pricing` → `/id/pricing`
   - `fluxyos.html` (logo link) → `/id/fluxyos.html` (or `/id`)
   - But: `/login` stays unprefixed if login isn't translated yet (Phase P3)
5. **Wire language switcher** to point back to EN equivalent
6. **Verify** rendering at the corresponding URL via local server
7. **QA** — read through, check button widths (Indonesian copy is often 20–30%
   longer than English; layout may need tweaks)

### Footer — pick one approach
- **Option a:** Have `includes/footer.html` and `includes/footer-id.html`,
  branch in `footer-loader.js` based on URL path containing `/id`.
- **Option b:** Two separate `<footer>` HTMLs, fully duplicated.

Recommended: **Option a** — it's a small file, branching in JS is one-liner:
```js
const isID = window.location.pathname.startsWith('/id');
fetch(isID ? 'includes/footer-id.html' : 'includes/footer.html')
```

---

## 7. Layout Considerations (Indonesian copy is longer)

Indonesian renders **20–30% longer** than English on average. Specifically check:

- **CTA buttons** — "Get started free" (16 chars) → "Coba Gratis" (11 chars) — ✅ fits.
  But "See how it works" (16) → "Lihat cara kerjanya" (19) — may wrap on mobile.
- **Headlines** — `text-[60px]` headlines that fit one line in EN may break in
  ID. Add `<br>` manually where needed, or rely on responsive font-size.
- **Card titles** — keep verb-first, allow up to 2 lines.
- **Stats labels** — "Sync Latency" → "Kecepatan Sinkronisasi" doesn't fit a
  3-column row. Use shorter alternative ("Kecepatan") or change to 2-column.

Add a CSS utility for ID pages if needed:
```css
[lang="id"] h1 { font-size: clamp(36px, 5vw, 56px); }
```

---

## 8. Rollout Phases

| Phase | What | When | Why first |
|---|---|---|---|
| **P0** | `id/fluxyos.html` + footer + language switcher wired | Week 1 | Highest traffic; proves the pipeline works |
| **P1** | `id/pricing.html` | Week 1 | High-intent traffic right behind homepage |
| **P2** | All 5 feature pages: budget, revenue, vendor, receipt, aiagents | Weeks 2–3 | Bulk of work |
| **P3** | `id/login.html` + any leftover string | Week 4 | Auth flow finalization |
| **P4 (later)** | App pages — separate plan needed (in-app i18n) | TBD | Out of scope here |

For each phase: write → review with a native Indonesian speaker → adjust → push.

---

## 9. Maintenance Rules (Add to CLAUDE.md)

Once both locales exist, **every copy change must update both versions** or you
get drift. Rules:

1. **Pair edits.** Editing a hero headline in `revenuesync.html`? Update
   `id/revenuesync.html` in the same commit. Use the glossary for term consistency.
2. **Nothing English-only.** New page? Ship its `/id/` counterpart in the same PR
   or write a follow-up issue with a 7-day SLA.
3. **Glossary first.** Encountering a new product/finance term not in the
   glossary in §2? Add it there before translating, so future copy stays consistent.
4. **Tone check.** Read the Indonesian translation aloud as if explaining to a
   warung owner. If it sounds like a government letter, rewrite.
5. **Don't translate brand names.** FluxyOS, Fluxy AI, Revenue Sync, Vendor Spend,
   Receipt Capture, Dynamic Budgeting, AI Agents — all stay English everywhere.

---

## 10. Open Questions to Resolve Before Phase P0

- [ ] Confirm canonical product-name translation: do we want **"AI Agents"** or
      **"Agen AI"** in Indonesian body copy? (Recommendation: keep "AI Agents"
      in headers, "Tim AI" in flowing copy.)
- [ ] Pricing currency display — pricing tiers currently shown in USD on
      `pricing.html`? Convert to IDR for the ID page, or show both?
- [ ] Confirm the `/id/` URL structure with the user vs. alternatives like
      `?lang=id` query param or `id.fluxyos.com` subdomain.
- [ ] Sourcing: Will the user write the translations themselves (preferred —
      they own the brand voice) or do we draft and they review?
- [ ] Native-speaker reviewer — who signs off on tone before each phase ships?

---

## 11. Definition of Done

A page is "fully localized" when:

- [ ] `/id/<page>.html` exists at the right path
- [ ] `<html lang="id">` and `<title>` are correct
- [ ] hreflang + canonical tags present
- [ ] All visible English copy is translated using glossary + tone rules
- [ ] All brand/product names kept in English
- [ ] All internal links point to `/id/*` counterparts
- [ ] Language switcher correctly points to the EN equivalent
- [ ] No layout breakage at mobile / tablet / desktop widths
- [ ] Native speaker has read through and approved tone
- [ ] Page loads HTTP 200 at the expected URL
