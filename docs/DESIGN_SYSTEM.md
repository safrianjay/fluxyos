# FluxyOS Design System

This document defines the visual and functional standards for FluxyOS. Follow these guidelines to ensure consistency when building new features or pages.

## 🎨 Color Palette

### Primary Colors
- **Fluxy Orange**: `#EA580C` (Tailwind `orange-600`) - Used for primary actions, logos, and active states.
- **Deep Navy**: `#0B0F19` - Used for sidebars and primary backgrounds.
- **Action Red**: `#EF4444` (Tailwind `red-500`) - Used for destructive actions and critical alerts.

### Supporting Colors
- **Success Green**: `#16A34A` - For positive trends and "Cleared" statuses.
- **Info Blue**: `#3B82F6` - For secondary highlights and progress bars.
- **Neutral Grays**:
    - `gray-50`: Backgrounds
    - `gray-200`: Borders
    - `gray-500`: Secondary text
    - `gray-900`: Headings and primary text

---

## 🔡 Typography

- **Primary Font**: `Inter` (Sans-serif) - Used for all UI elements.
- **Monospace Font**: `Fira Code` - Used for financial amounts and transaction IDs.
- **Premium Direction**: Typography should feel clean, confident, spacious, and easy to scan. Prefer restraint and strong hierarchy over decorative effects.
- **Large Heading Weight**: Display, H1, H2, and large editorial headings should use lighter weights (`300–400`) when the font supports it. Avoid making every heading heavy.
- **Letter Spacing**: Body, small text, captions, buttons, and navigation use `letter-spacing: 0`. Negative letter spacing is allowed only on large headings.

### Font Sizes

Marketing / landing pages use the editorial display scale below.
**Authenticated dashboard / app pages** use the strict 6-step product
scale (10 / 12 / 14 / 16 / 20 / 24 px) defined under "Dashboard type
scale" so KPI strips, tables, and forms stay on the 4/8-px rhythm.

#### Marketing pages
- **Display / Hero**: `56px` desktop, `48px` tablet, `36px` mobile; weight `300`, line-height `1.08–1.12`.
- **H1**: `48px` desktop, `40px` tablet, `32px` mobile; weight `300`, line-height `1.1–1.15`.
- **H2**: `36px` desktop, `32px` tablet, `28px` mobile; weight `300`, line-height `1.15–1.2`.
- **H3**: `26px` desktop, `24px` tablet, `22px` mobile; weight `300–400`, line-height `1.2–1.25`.
- **H4**: `18px` desktop/tablet, `16px` mobile; weight `400–500`, line-height `1.3`.
- **Body Text**: `16px` desktop/tablet, `15–16px` mobile, line-height `1.5–1.6`.
- **Body Small / Metadata**: `14px`, line-height `1.45–1.55`.

#### Dashboard type scale (authenticated app pages)

Strict 6 steps. **No other sizes are permitted on app pages.**
Tokens + utility classes live in `assets/css/shared-dashboard.css`
(`--fluxy-text-*`, `.fluxy-*`).

| Token | px | Role |
|---|---:|---|
| `xs`  | 10 | Caps labels, micro badges, sparkline axis, kbd |
| `sm`  | 12 | Meta lines, sub-text, pills, captions, table sub-rows, buttons |
| `md`  | 14 | Body default — nav items, table cell names, form inputs, line-item names |
| `lg`  | 16 | Reserved — use only if 14 isn't loud enough between body and KPI |
| `xl`  | 20 | KPI value, modal title |
| `2xl` | 24 | Page title (only) |

Weight scale (four weights — don't load more):
- `400` body, descriptions, meta
- `500` buttons, pills, form labels, table cell names
- `600` section titles, KPI values, card titles, active nav
- `700` page title only

Letter spacing:
- `-0.025em` 24 px page title
- `-0.02em`  20 px KPI value
- `-0.01em`  section titles, stack labels
- `-0.005em` body / 14 px
- `0.06em`   caps labels (10–12 px)
- `0.08em`   eyebrow / sidebar caps

Line height: `1.25` tight stacks · `1.4` pills + descriptions · `1.45`
default body · `1.5` long-form prose. KPI numbers themselves use `1`.

**Rules:**
1. Never invent intermediate sizes (`text-[11px]`, `text-[13px]`,
   `text-3xl`, etc. on app pages). If you'd reach for one, snap to the
   nearest scale step.
2. Pair size with weight, not just size. Louder element → +1 size AND
   +1 weight. Don't make `14/700` your hierarchy hammer.
3. Caps text always pairs with letter-spacing ≥ `0.06em`.
4. Numbers always use the mono face (`Fira Code`) with
   `font-feature-settings: "tnum"`.
5. Marketing pages keep the display scale above. Don't apply the
   dashboard scale to landing pages.

Pre-existing `text-[11px]` / `text-[13px]` instances in the codebase
are being migrated to `text-[12px]` / `text-[14px]` in scoped sweeps;
new code must already be on-scale.

---

## 🍱 Components

### 1. Cards
- **Background**: `bg-white`
- **Border**: `border border-gray-200`
- **Radius**: `rounded-xl` (12px)
- **Shadow**: `shadow-sm`

### 2. Buttons
- **Primary**: `bg-gray-900 text-white`, `rounded-lg`, `hover:bg-gray-800`.
- **Secondary**: `bg-white text-gray-700`, `border border-gray-200`, `hover:bg-gray-50`.
- **Accent**: `text-[#EA580C] font-bold`.

### 3. Tables
- **Header**: `bg-gray-50`, `text-[11px]`, `uppercase`, `tracking-wider`.
- **Row Hover**: `hover:bg-gray-50/50`.
- **Border**: `border-b border-gray-50`.

### 4. Charts (Amplitude-Style Hover)

Every bar/column chart in the app uses the shared `window.attachChartHover(container, options)` helper from `assets/js/shared-dashboard.js` for hover behavior. Do **not** use the native `title` attribute, page-local `group-hover` Tailwind tooltips, or any custom hover code on chart bars.

Hover contract:

- **Crosshair**: a vertical 1px guide follows the cursor on vertical charts (`orientation: 'vertical'`).
- **Active bar**: the bar nearest the cursor X gets a `chart-bar-active` brightness lift.
- **Tooltip card**: dark navy (`#0B0F19`), white text, uppercase 10px header (date or label), one row per series with a color swatch + label + tabular-nums value. Styled via `.chart-tooltip*` classes in `shared-dashboard.css`.
- **Edge handling**: the tooltip horizontally clamps to the container. It **never flips below a bar** — axes, date captions, and count labels live below bars in nearly every chart design, and flipping would overlap them. When there isn't room above, the helper clamps to the container top (overlapping the bar's top portion slightly, which is acceptable).
- **Re-render safe**: the helper is idempotent — call it after every `innerHTML` write of the chart container.

Mobile/touch: hover is desktop-only. Charts that would hide their data values on small screens must show the value somewhere else (caption, table below, or stacked label like the Ledger Volume chart).

Reference implementations: Revenue Sync Volume (`revenue-sync.html` `renderVolumeChart`) and Ledger Volume (`ledger.html` `renderVolumeChart`). See [docs/COMPONENT_GUIDE.md](COMPONENT_GUIDE.md) Recipe 7 for the build steps and [docs/PROJECT_BACKGROUND.md §6](PROJECT_BACKGROUND.md) for the helper API.

#### 4a. Time-series bucketing & horizontal scroll (Overview charts)

The Overview **Performance Trend** and **Cash Flow** charts plot one bucket per
period across the selected range. They follow these rules (see
`assets/js/dashboard.js` `buildCashflowBuckets` / `renderCashflowChart` /
`renderCashFlowChart`, styled in `assets/css/dashboard.css`):

- **Adaptive granularity by range length:** `≤14d → day`, `≤93d → week`,
  `≤366d → month`, `> 366d → quarter` (label `Q# YYYY`). This keeps **All Time**
  (which the backend resolves to *earliest record → today*) from exploding into
  30+ monthly columns.
- **Anchor to real activity:** for month/quarter ranges, trim empty **leading and
  trailing** buckets so the chart starts at the first period with data and ends at
  the last — it must not pad empty quarters out to today.
- **Never cram. Scroll instead.** Each bucket gets a minimum width
  (`CASHFLOW_MIN_BUCKET_PX = 64`). When the track is wider than the panel, the
  plot **and** its labels scroll horizontally inside the card while the Y-axis
  stays pinned. The plot and label rows are two scrollers kept in sync via
  `linkHorizontalScroll`.

**Bug class — page-level horizontal scroll (regression guard).** The app content
wrapper is `<div class="flex-1 overflow-y-auto …">`. Per CSS, `overflow-y: auto`
with the default `overflow-x: visible` **computes `overflow-x` to `auto`**, so
*any* descendant wider than the viewport produces a horizontal scrollbar on the
whole page (sidebar appears to overlap content). A wide chart track (e.g. All
Time = ~100 monthly Cash Flow bars in a non-scrolling `1fr` grid) triggers this.
**Every wide/variable-width chart track must be contained by its own
`overflow-x: auto` scroller** so it never reaches the page wrapper. When adding or
changing an Overview chart, QA at **All Time** and confirm
`document.documentElement.scrollWidth === clientWidth`.

**Line charts:** the SVG `viewBox` width must equal its rendered pixel width.
With `preserveAspectRatio="none"` a narrow viewBox stretched to a wide panel
distorts the line and turns point markers into ovals (visible on short ranges
like *This/Last Month*). Compute the plot width from the real container width.

### 5. Dialog (Confirmation & Alert Popups)

There is one canonical popup component in FluxyOS. **Never call `window.confirm()` or `window.alert()` directly** — they break the design system and produce unstyled OS dialogs.

Use the helpers in `assets/js/shared-dashboard.js`:

```js
const ok = await window.showConfirmDialog({
    title: 'Change business name?',
    body: '<strong>Old</strong> → <strong>New</strong> will appear in the sidebar, exports, audit logs, and AI summaries.',
    confirmLabel: 'Change name',
    cancelLabel: 'Cancel',
    tone: 'default'  // or 'danger' for destructive actions
});
if (!ok) return;
```

```js
await window.showAlertDialog({
    title: 'Could not save your progress',
    body: 'Check your connection and try again — your previous answers are still here.',
    confirmLabel: 'OK',
    tone: 'danger'
});
```

**Component contract:**

- White card, `gray-200` border, `rounded-xl` (16px), `0 24px 48px rgba(11,15,25,0.18)` shadow.
- Backdrop: `rgba(11,15,25,0.5)` with 6px backdrop-blur.
- Icon: 44px rounded square with a soft tinted gradient (`#FFF7ED → #FFEDD5`) + 1px inset ring in `rgba(234,88,12,0.18)`. Inner SVG at 22px, 1.75 stroke, Lucide-style. Red palette (`#FEF2F2 → #FEE2E2` + red ring) for `tone: 'danger'`. Pass `icon: 'pencil' | 'info' | 'alert' | 'warn' | 'trash' | 'check' | 'building'` to pick a contextual glyph, `icon: 'none'` to suppress, or a raw SVG path string for a one-off. Defaults: `info` for default tone, `warn` for danger.
- Title: 18px, weight 700, deep-navy (`#0B0F19`), -0.01em tracking.
- Body: 14px, `gray-600`, line-height 1.55, max 56ch. Inline HTML allowed (`<strong>` etc.). Caller must escape any user-supplied substring before interpolating.
- Actions bottom-right: ghost `Cancel` then primary `Confirm`. `Confirm` is deep-navy by default, red for `tone: 'danger'`. For `showAlertDialog`, no cancel button — single OK.
- Behavior: **Enter** confirms, **Escape** cancels, overlay click cancels, primary button auto-focused, background scroll locked.
- Fade + 12px-rise entrance (220ms ease-out), fade + 8px-drop exit (140ms). Respects `prefers-reduced-motion`.
- Returns `Promise<boolean>` from `showConfirmDialog`, `Promise<void>` from `showAlertDialog`.

**When to use which tone:**
- `default`: anything that affects display, navigation, or non-destructive workspace state (rename, switch entity, change setting).
- `danger`: deletes, irreversible writes, sign-out everywhere, downgrades.

Reference implementations: business-name change confirm in [settings-business.html](../settings-business.html), and the two error-path alerts in [assets/js/onboarding.js](../assets/js/onboarding.js).

---

## 📐 Layout & Spacing
- **Dashboard/App Sidebar Width**: `220px` fixed. There is no collapsed sidebar state.
- **Dashboard/App Sidebar Theme**: `bg-white`, `border-slate-200`, dark navy text `#1E2F4A`, active item text/icon `#EA580C` with no orange background.
- **Dashboard/App Sidebar Header**: `64px` tall to align with the main app topbar divider. Logo mark is `36px`, logo text is `18px`, vertically centered.
- **Dashboard/App Sidebar Menu Type**: Menu text is `14px` max, icon size is `16px` max, Lucide-style stroke icons only. Do not enlarge sidebar nav text or icons.
- **Dashboard/App Sidebar Density**: Menu rows are compact: `32px` min-height, `6px 8px` item padding, and `2px` vertical gap between entries.
- **Dashboard/App Sidebar Group Rhythm**: Group labels use `20px` top spacing and `8px` bottom spacing after the first group, so dense navigation still has readable section breaks.
- **Dashboard/App Page Background**: Authenticated app pages use `bg-gray-50` behind the white topbar, sidebar, and cards.
- **Dashboard/App Sidebar IA**: All dashboard/app pages use the centralized `sidebar-loader.js` grouped menu:
  - `Command`: Overview, Fluxy AI.
  - `Money Movement`: Transactions, Revenue Sync, Bills, Subscriptions.
  - `Operations`: Vendor Spend, Receipt Capture, Budgets, Approvals.
  - `Reporting`: Reports & Exports, Audit Log.
  - `Workspace`: Integrations, Settings.
- **Dashboard/App Future Features**: Future dashboard features may appear only as disabled `Soon` entries until a real authenticated app page exists. Do not link sidebar entries to marketing/landing pages.
- **Main Padding**: `p-6` or `p-8` for desktop.
- **Content Max-Width**: `1280px` for marketing/content containers; app surfaces may use `1400px` when tables or dense dashboards need more width.
- **4px Spacing Scale**: Use `4, 8, 12, 16, 20, 24, 32, 40, 52, 60, 80, 96px`. Avoid custom spacing values unless necessary.
- **Section Spacing**: Desktop sections use `80px`; compact sections `60px`; hero/major sections `96px`.
- **Responsive Section Spacing**: Tablet sections use `60px`, compact `48px`, hero `72px`. Mobile sections use `40px`, compact `32px`, hero `56px`.
- **Container Padding**: Desktop `32px`, tablet `24px`, mobile `20px`, small mobile `16px`.
- **Grid/Card Rhythm**: Grid gaps use `24–32px`; standard cards use `32px` padding desktop and `20–24px` mobile.
- **Text Width**: Keep long-form text under `720px`; hero headings under `760px`; hero paragraphs around `620px`; centered paragraphs around `640px`.

---

## ✨ Animations & Micro-interactions
- **Transitions**: Use `transition-all duration-200 ease-in-out` for hovers.
- **Dashboard/App Sidebar Hover**: Use only subtle `#F8FAFC` hover backgrounds. Do not add collapse/expand interactions.
- **Dashboard/App Export Buttons**: Export/download actions should show a brief disabled loading state, a clear success state, and a subtle `active:scale-95` press interaction. Use CSV for ledger/transaction exports unless a PDF report is explicitly requested.
- **Dashboard/App Date Picker**: Use the shared `FluxyDateRangePicker` from `assets/js/date-range-picker.js` for every dashboard calendar or date picker, including filters and entry drawers. Do not use native `input[type="date"]` or page-local calendar widgets. It should default to the current month when used for ledger-style data, default to today for single-entry dates, avoid separate Day/Month tabs and native calendar picker UI, support single-day and range selection inside the calendar, include tertiary Reset + Cancel + Apply actions for range mode, disable future date clicks, and keep scoped cards, charts, tables, pagination, and exports aligned to the selected period. Outer previous/next arrows must preserve full-month scope when the active filter is monthly, including when returning to the current partial month; only an explicit calendar day/range selection or single-date mode should use day-level navigation.
- **Ledger Filters**: Status and transaction Type are exposed as compact `<select>` controls in the ledger's top controls row (beside the date picker), not as standalone breakdown panels. Active filters render removable chips above the table and tint the select with the orange accent border/text. Filters intersect with the date range, search, and vendor filter, scope the CSV export and summary cards, and reset pagination to page 1 on change.
- **Dashboard/App Entry Drawer**: Use the shared `showAddTransactionModal` drawer for transaction, bill, and subscription entry. It opens from the right side, locks page scroll, uses a black translucent overlay, and closes via X, overlay click, Escape, or successful submit.
- **Dashboard/App Entry Dates**: Entry drawers that write finance records mount `FluxyDateRangePicker` in single-date mode. Single-date mode uses one month only, no outer previous/next period arrows, no footer range labels or action buttons, and auto-selects/closes when the user clicks a day. It defaults to today, allows today or previous days only, and shows an inline info warning above the sticky submit button when the selected date or CSV row dates are not today.
- **Dashboard/App CSV Uploads**: CSV upload controls should show selected filename, disabled/ready/uploading/success/error states, and inline structure guidance before the user uploads. If a modal supports single and bulk entry, separate them with tabs and reuse the modal's primary submit button for the active tab instead of adding a second upload button.
- **Dashboard/App Form Buttons**: Primary submit buttons start disabled and become active only after the required fields for the current mode are present.
- **Dashboard/App Tables**: Transaction tables default to 10 rows per page. Sortable headers use compact text buttons with up/down SVG icons and no layout shift.
- **Shadows**: Elevate cards on hover using `hover:shadow-md`.

---

## 🛠 Usage Checklist
1. [ ] Does it use `Inter` for text and `Fira Code` for money?
2. [ ] Is the primary action color `#EA580C`?
3. [ ] Are corners rounded with `rounded-xl` or `rounded-lg`?
4. [ ] Does the page use the centralized `sidebar-loader.js`?
5. [ ] For dashboard/app pages, does the page use the shared `220px` light sidebar without custom page-level sidebar markup?

---

## 🚫 Anti-AI-Slop Visual Standards (Hard Rules)

These rules are mandatory for every new page, feature, and reusable component.
The goal is to prevent generic, template-like output and enforce intentional
visual hierarchy, semantic color logic, and task-first UX clarity.

### Enforcement Contract
- `design_system.md` is the source of truth for anti-slop rules.
- `QA_CHECKLIST.md` is the enforcement gate.
- Any anti-slop QA failure is a blocking failure for final gate/push.

### 1) Layout & Hierarchy (Hard Rules)
- First viewport must communicate this order within 3 seconds:
  - `what this screen is`
  - `what to do next`
  - `what matters most right now`
- Exactly one primary action per viewport zone. Secondary and tertiary actions
  must be visibly lower emphasis.
- Avoid equal-weight CTA clusters: do not render two or more adjacent actions
  with identical weight, fill, size, and contrast unless the user explicitly
  requests parity.
- Section rhythm must follow a deliberate spacing scale. Use repeated spacing
  tokens; avoid ad hoc one-off values that create visual jitter.
- Do not use card-per-everything composition. Use cards only when they provide
  meaningful grouping, state, or interaction boundaries.
- Avoid decorative hero eyebrow badges when the H1 already states the page
  context. A redundant badge plus extra top whitespace is treated as AI slop
  because it delays the real message without adding user value.
- Information hierarchy must remain stable at both `375px` and `1280px`.
  Primary message/action must not be displaced below decorative elements.

### 2) Color System (Hard Rules)
- Every page must map colors to semantic roles:
  - `primary action`
  - `secondary action`
  - `success`
  - `warning`
  - `error`
  - `disabled`
  - `neutral structure` (bg/surfaces/borders/text)
- Semantic meaning must remain consistent across components on the same page.
  Do not reuse one hue for conflicting meanings.
- Accent colors are for emphasis, not base structure. Avoid accent overuse in
  large backgrounds, repeated chips, or multiple simultaneous focal points.
- Contrast must meet practical readability standards:
  - body text and key labels must be comfortably readable at normal zoom
  - interactive elements must remain legible in hover/focus/disabled states
- Avoid single-hue dominance across full page where all surfaces, accents, and
  states collapse into one color family.

### 3) Typography (Hard Rules)
- Typography must define hierarchy, not decoration:
  - clear delta between headline, section title, body, and metadata text
  - no near-identical sizes/weights for different information levels
- Heading line length and body measure must stay readable:
  - avoid overly long headlines that behave like paragraphs
  - avoid dense body text blocks with no visual pause points
- Decorative typography is allowed only when it does not reduce readability,
  semantic structure, or action clarity.
- Financial and tabular values should stay visually scannable and aligned with
  existing dashboard conventions.

### 4) Component Discipline (Hard Rules)
- Buttons must follow role mapping:
  - one dominant primary style
  - secondary style visibly lower emphasis
  - destructive style clearly differentiated
- Tables/lists must prioritize scanability:
  - clear header contrast
  - stable alignment
  - row separation and hover states that aid reading
- Icon use must be consistent in stroke/fill style and size rhythm.
  Avoid mixed icon systems in one surface unless explicitly required.
- Card boundaries, radii, and shadows must follow system values; avoid stacking
  multiple effect styles that create noise.

### 5) Motion & Effects (Hard Rules)
- Motion must explain state or guide attention; decorative-only motion is
  prohibited when it does not support comprehension or action.
- Limit concurrent animated elements per viewport zone. Use a small number of
  meaningful animations instead of many competing effects.
- Effects (blur, glow, glass, gradients) must never reduce text legibility or
  obscure hierarchy.
- Parallax, shimmer, and pulse effects are opt-in accents; they are not default
  page styling.

### 6) Content Density & Composition (Hard Rules)
- Every section must earn its space with real utility:
  - data, decision context, workflow action, or concrete explanation
- Prohibit filler sections that only restate obvious claims or duplicate nearby
  content with alternate phrasing.
- Avoid template stacking (hero + three cards + testimonial + CTA) unless each
  section serves a distinct product purpose.
- Visual density should match task context:
  - operational screens: higher information density with clean grouping
  - marketing screens: lower density but stronger hierarchy and clear CTA

### Prohibited Patterns (Hard Bans)
- Generic purple-neon SaaS gradient look as default style unless explicitly
  requested by user/product direction.
- Excessive glassmorphism/glow layering that reduces legibility or diffuses
  action hierarchy.
- Hero or section composition where decorative media overpowers primary message
  and primary action.
- Color-only differentiation where status/action meaning is ambiguous without
  text or structure.
- Repetitive cloned card grids with identical visual weight and no clear
  prioritization.

### Exception Protocol
- Exceptions are allowed only when:
  - explicitly requested by the user, or
  - required by documented product constraints.
- Every exception must be logged in QA results with:
  - which anti-slop rule was waived
  - rationale
  - impacted screens/components
  - risk tradeoff accepted
