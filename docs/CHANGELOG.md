# FluxyOS Changelog

All notable changes to FluxyOS are recorded here, newest first.

---

## [Unreleased]
> Changes in progress — not yet pushed to main

---

## 2026-05-08

### Added
- `QA_CHECKLIST.md` — full QA workflow with smoke tests, 9 change-type sections, DB & logic verification, cross-page regression, and final gate
- `PROJECT_BACKGROUND.md` — architecture reference: Firestore schema, field names, function signatures, business logic rules, brand conventions, git workflow
- `CLAUDE.md` — Claude session rules: QA enforcement, project conventions, pointers to background and QA docs
- SVG favicon (`assets/images/favicon.svg`) — black F-logo from navbar, added to all 10 HTML pages

### Changed
- Login page left panel: canvas z-index raised to 2 (above Unsplash image) to remove teal/green tones
- Login "Trusted by 1,200+" section: replaced colored company letter badges with dark gray avatar icons
- `fluxyos.html` bottom CTA section: restored to original `bg-gray-50` light background after dark version rejected

### Fixed
- Login page left panel showing teal/green tones from Unsplash background image bleeding through canvas

---

## 2026-05-07

### Added
- Reusable footer component (`includes/footer.html`) — loaded dynamically on all landing pages via `footer-loader.js`
- `assets/js/universe-canvas.js` — shared starfield canvas animation (220 particles, dark navy + purple glow, no teal)
- `assets/js/footer-loader.js` — dynamically injects footer on landing pages, skips dashboard app pages
- `assets/css/footer.css` — footer dark navy base, purple border, z-index stacking for canvas
- Universe starfield background on login page left panel (`login-universe-canvas`)
- Animated starfield background on footer (same shared canvas utility)

### Changed
- Footer logo updated to match navbar (orange `#EA580C` on dark background)
- Canvas animation colors changed from teal/cyan to dark purple only (`rgba(88,28,135)`, `rgba(109,40,217)`)
- Hamburger menu in `fluxyos.js` fixed with `readyState` guard (replaced fragile `DOMContentLoaded` listener)
- `fluxyos.html` bottom CTA: experimental dark version with purple glow and frosted glass button

### Fixed
- Stray `</a>` closing tag at line 1749 in `fluxyos.html` (should have been `</div>`)
- Hamburger menu not appearing on click due to `DOMContentLoaded` firing before script ran
- Footer not loading on some pages due to timing issue

### Removed
- Inline footer markup from `fluxyos.html` and `budgetlanding.html` (replaced by shared component)
- "Careers" link from footer Company section

---

## 2026-05-06

### Added
- Dynamic budgeting landing page (`budgetlanding.html`) integrated with platform header and footer

### Changed
- Clean URLs enabled: removed `.html` extensions from all internal links
- Netlify `pretty_urls` enabled in `netlify.toml`

---

## Earlier Commits

### Fixes & Stability
- Bills and Subscriptions tables now update correctly — newly added items lacked `dueDate`/`amount` fields for sorting; now sorting by `timestamp`
- `DataService` returns raw numbers to permanently resolve Double Rp bug on Dashboard KPIs
- Safe Firebase init in `dashboard.js`, context-aware modal submit label, full modal removal on close
- Removed duplicate `loadDashboard` call (caused double Rp prefix); fixed stale modal reuse (wrong context on Bills/Subs)
- Resolved Null innerHTML and Firebase initialization errors across platform
- Resolved DataService import path errors on Netlify (absolute root path fix)
- Fixed Firebase initialization timing; updated button labels to "Add Transaction"

### Features
- Real-time Firestore sync activated: Dashboard, Ledger, Bills, Subscriptions
- Context-aware transaction modals: Bills page defaults to "Operations", Subscriptions to "SaaS"
- Toast notification system: top-right slide-in, 4s auto-dismiss, success/error/info types
- Shimmer skeleton loaders while data fetches
- Real-time thousand-separator formatting for amount input (Indonesian Rupiah)
- Premium micro-animations, glassmorphism effects on dashboard

### Brand
- Sidebar logo: restored official FluxyOS Engine geometric F logo
- Sidebar: collapse/expand toggle (260px ↔ 80px)
