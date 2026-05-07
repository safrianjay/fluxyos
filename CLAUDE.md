# FluxyOS — Claude Working Rules

## QA Enforcement (MANDATORY)

Every change — UI, new page, new feature, bug fix, or logic update — must follow this workflow before being marked complete:

```
Plan → Build → QA → Fix (if needed) → Push
```

The full QA checklist lives at:
`/Users/slumdogmacbookair/.claude/plans/fix-the-error-on-nifty-crescent.md`

### Minimum checks after every change:
1. Run **Smoke Tests** (Section 1 of QA plan) — always, no exceptions
2. Run the **Change Type** checklist that matches what was modified
3. Run **Section F (Database & Logic)** if any data write, read, or calculation was touched
4. Run **Cross-Page Regression** (Section 3) if shared files were modified
5. Pass the **Final Gate** (Section 4) before pushing to main

**A task is not done until QA passes. Do not push to main with failing checks.**

---

## Project Background (Read Before Every Task)

Full architecture, database schema, field names, function signatures, and conventions are in:
**`PROJECT_BACKGROUND.md`** — read this before implementing any new feature, page, or logic.

Key things it covers that prevent mistakes:
- Exact Firestore field names (`vendor_name` not `vendor`, `type` is lowercase `"revenue"`/`"expense"`)
- Amount must be stored as raw integer — never formatted string
- Exact function signatures for `showAddTransactionModal`, `showToast`, `renderEmptyState`
- Which HTML element IDs JS depends on (never rename these)
- Features that already exist as stubs (search, export, edit/delete) — don't rebuild from scratch
- Git workflow for merging worktree to main and pushing

---

## Project Stack

- Static HTML + Tailwind CSS + Vanilla JS (no build step)
- Firebase Auth + Firestore (user-scoped collections)
- Netlify hosting (auto-deploys from `main` branch)
- Shared JS: `sidebar-loader.js`, `footer-loader.js`, `shared-dashboard.js`, `universe-canvas.js`
- Shared CSS: `shared-dashboard.css`, `footer.css`

## Key Conventions

- Footer loads on all **landing pages** only — never on dashboard app pages (`dashboard.html`, `bill.html`, `subscription.html`)
- Amount formatting: Indonesian Rupiah with `.` as thousands separator (e.g. `1.234.567`)
- Amount stored in Firestore as raw integer (dots stripped before save)
- Brand colors: Orange `#EA580C` (CTA/accent), Dark Navy `#0B0F19` (footer/login bg), Purple glow for canvas animation
- Favicon: black F-logo SVG at `assets/images/favicon.svg`
- Git: commit on worktree branch → merge to `main` in `/Users/slumdogmacbookair/Desktop/fluxionos` → push origin main
