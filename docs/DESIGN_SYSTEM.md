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
- Authenticated app tables use the full **Dashboard Data Table Standard** below.
- Legacy table snippets should migrate to `fluxy-table*` classes instead of
  adding page-local `text-[11px]`, mixed padding, or custom badge colors.

## Dashboard Data Table Standard

Authenticated app tables use the shared `fluxy-table*` classes in
`assets/css/shared-dashboard.css`. The purpose is to make finance data feel like
one FluxyOS product system across Accounting Center, Accounting Records, Ledger,
Bills, Subscriptions, Reports, Budget, Settings, and future dashboard pages.
Use these classes for new app tables unless a documented page-specific exception
is needed.

### When to use

Use the table standard for authenticated dashboard/app tables, financial record
lists, drilldown records, report/export lists, allocation tables, settings
tables, and any table-like source-record inspection surface. Do not apply it to
marketing comparison/pricing tables unless that page is explicitly being
restyled.

### Structure

```html
<section class="fluxy-table-card">
  <div class="fluxy-table-card-header">
    <div>
      <h2 class="fluxy-table-title">Table title</h2>
      <p class="fluxy-table-subtitle">Short helper text.</p>
    </div>
    <div class="fluxy-table-actions">...</div>
  </div>

  <div class="fluxy-table-toolbar">...</div>

  <div class="fluxy-table-scroll">
    <table class="fluxy-table">
      <thead>
        <tr class="fluxy-table-header">
          <th>Vendor</th>
          <th class="fluxy-table-money">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr class="fluxy-table-row fluxy-table-row-clickable">
          <td class="fluxy-table-cell">
            <span class="fluxy-table-cell-primary">AWS</span>
            <span class="fluxy-table-cell-meta">Infrastructure</span>
          </td>
          <td class="fluxy-table-cell fluxy-table-money">Rp 1.250.000</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="fluxy-table-pagination">...</div>
</section>
```

Toolbar and pagination are optional. Do not force them onto small static tables
that do not need filtering or paging.

### Typography

- Table title: `16px`, `600`, slate-950.
- Subtitle/helper: `12px`, `400`, slate-500, `1.4` line-height.
- Header labels: `12px`, `600`, uppercase, `0.06em`, slate-500.
- Primary cell text: `14px`, `600`, slate-950.
- Secondary/meta cell text: `12px`, `400/500`, slate-500.
- Normal cell text: `14px`, `400/500`, slate-700.
- Money: `Fira Code`, `14px`, tabular numbers, right-aligned.
- Status badges: `12px`, `500`.

Do not introduce `text-[11px]`, `text-[13px]`, `text-3xl`, or off-scale font
weights inside app tables.

### Row Density And Alignment

- Header cells: `12px 20px` padding.
- Standard rows: `16px 20px` padding.
- Compact child rows: `12px 20px` padding when rows are secondary.
- Text/date/status columns align left.
- Money and numeric columns align right using `.fluxy-table-money`.
- Actions align right only when they are the last compact column.
- Keep the primary object column first: vendor, line item, report name,
  allocation name, or setting name.

### Visual Rules

- Table cards: white background, `border-slate-200`, 12px radius, subtle shadow.
- Header background: white or `slate-50` only.
- Row hover: subtle `slate-50`.
- Summary rows: `fluxy-table-row-total` (`slate-50`, stronger text).
- Financial final-total rows may use `fluxy-table-row-final` dark navy. Use this
  sparingly; Accounting Center Net Income is the benchmark.
- Avoid orange row backgrounds, decorative gradients, heavy shadows,
  glassmorphism, and dense ERP-style clutter.

### Money And Finite Values

Always display currency as Indonesian Rupiah with dot separators, for example
`Rp 1.000.000`. Financial statement negatives use parentheses, for example
`(Rp 1.000.000)`. Changes may use `+Rp 1.000.000`, `(Rp 1.000.000)`, or the
page's current negative convention. Never render `NaN`, `Infinity`, or
`-Infinity`; unavailable percentages display `N/A`.

### Status Badges

Use `.fluxy-table-status` plus one semantic class:

- `.fluxy-status-success`: ready, mapped, completed, paid, healthy.
- `.fluxy-status-warning`: review, missing info, almost ready, at risk.
- `.fluxy-status-danger`: missing receipt, overdue, exceeded, failed.
- `.fluxy-status-neutral`: no records, draft, pending, preview.
- `.fluxy-status-info`: synced, imported, informational.

Do not invent page-local status colors when one of these semantic states fits.

### Row Interaction

There are three row types:

- Non-clickable data row: default `.fluxy-table-row`.
- Clickable inspection row: `.fluxy-table-row fluxy-table-row-clickable`, visible
  row affordance, `cursor:pointer`, and `focus-visible` ring when keyboard
  focus is supported.
- Summary/total row: `.fluxy-table-row-total` or `.fluxy-table-row-final`.
  Totals are not clickable unless there is a clear source-record list.

### Empty, Loading, Pagination, Mobile

Empty states use `.fluxy-table-empty`, `.fluxy-table-empty-title`, and
`.fluxy-table-empty-description`; never show fake rows or fake money. Loading
states should use `window.renderShimmer` where possible or a stable
`.fluxy-table-loading-cell` fallback. Data-heavy tables default to 10 rows per
page and use `.fluxy-table-pagination` with Previous/Next controls and a
"Showing 1-10 of 58 records" summary.

At `375px`, the page itself must not create horizontal overflow. The table may
scroll inside `.fluxy-table-scroll`, toolbars wrap vertically, pagination wraps,
and primary actions remain visible.

Do: reuse `fluxy-table-card`, `fluxy-table-scroll`, `fluxy-table-money`, and
semantic status classes. Do not: rename JavaScript-dependent IDs, rebuild table
logic for styling, or move Firestore/data calculations into presentation code.

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

### 6. Select / Dropdown (Custom — never the native control)

Authenticated app pages must **never** show the raw browser `<select>` arrow or
the OS-native option list — they look different on every OS/browser and break
the design system. There is one custom dropdown look (`.fluxy-select*` in
`assets/css/shared-dashboard.css`): a white pill trigger with a single
down-chevron that rotates 180° when open, and a floating menu with the selected
row tinted orange (`#FFF7ED` / `#EA580C`) and a check glyph.

**How to get it:** just write a normal native `<select>`. The shared
`assets/js/fluxy-select.js` (loaded on every app page) **progressively
enhances** every `<select>` into the custom dropdown on load — including
selects added later in modals/drawers (via a `MutationObserver`). The native
`<select>` stays in the DOM as the value source, so `select.value`, the
`change`/`input` events, form submission, and `required` validation keep
working unchanged.

Contract / rules:
- The chevron is a 16px Lucide-style `m6 9 6 6 6-6` stroke icon, `#9CA3AF`,
  rotating on open. Do not hand-roll a different arrow.
- The open menu is **portaled to `<body>`** with `position: fixed`, so it is
  never clipped or mis-placed by a transformed ancestor (slide-in drawers).
- Positioning is viewport-aware: it opens below, **flips above** when there
  isn't room below, clamps horizontally to the viewport, follows the trigger on
  scroll, and closes on outside-click / Escape / resize.
- Keyboard: Enter/Space/↓ open; ↑/↓/Home/End move; Enter/Space pick; Escape
  closes; Tab closes.
- Opt out with `data-no-fluxy-select` on the `<select>`; `multiple` and
  `size > 1` are skipped automatically.
- The programmatic builder variant (`<div class="fluxy-select">` filled by a
  page controller, e.g. the Ledger status/type/visibility filters) uses the
  same classes and look.
- `onboarding.html` keeps its own `onboarding-custom-select` enhancer and does
  **not** load `fluxy-select.js` (avoids double-enhancing).

Do not restyle native `<select>` with one-off CSS arrows, and do not call
`window.alert`-style native pickers.

---

## 📐 Layout & Spacing
- **Dashboard/App Sidebar Width**: `220px` fixed. There is no collapsed sidebar state.
- **Dashboard/App Sidebar Theme**: `bg-white`, `border-slate-200`, dark navy text `#1E2F4A`, active item text/icon `#EA580C` with no orange background.
- **Dashboard/App Sidebar Header**: `64px` tall to align with the main app topbar divider. Logo mark is `36px`, logo text is `18px`, vertically centered.
- **Dashboard/App Sidebar Menu Type**: Menu text is `14px` max, icon size is `16px` max, Lucide-style stroke icons only. Do not enlarge sidebar nav text or icons.
- **Dashboard/App Sidebar Density**: Menu rows are compact: `32px` min-height, `6px 8px` item padding, and `2px` vertical gap between entries.
- **Dashboard/App Sidebar Group Rhythm**: Group labels use `20px` top spacing and `8px` bottom spacing after the first group, so dense navigation still has readable section breaks.
- **Dashboard/App Page Background**: Authenticated app pages use `bg-gray-50` behind the white topbar, sidebar, and cards.
- **App Page Topbar (Header Bar)**: Every authenticated app page has exactly one
  sticky `64px` (`h-16`) white topbar (`.dashboard-main-topbar`, `border-b
  border-gray-200`, `shadow-sm`) — page identity on the left, page actions on the
  right. The page title + description live **here**, wrapped in
  `.dashboard-topbar-copy` (flex column, `min-width:0`):
  - `.dashboard-topbar-title` — the page name. `18px / 700`, color `#0B0F19`,
    letter-spacing `-0.015em`, line-height `1.15`. This is the persistent **chrome
    title** and is distinct from the `24px` in-page/print "page title" step in the
    Dashboard type scale.
  - `.dashboard-topbar-subtitle` — **one short descriptive sentence** about what the
    page is (not a terse fragment like "Point-in-time financial position"). `13px /
    500`, color `#6B7280`, letter-spacing `-0.005em`, line-height `1.35`, `3px` top
    margin. May carry `hidden sm:block` to drop on mobile.
  - **Canonical implementation:** `accounting.html` + `assets/css/accounting.css`.
    Pages that don't load `dashboard.css` (e.g. `balance-sheet.html`) **must define
    these three classes page-scoped**, copying the Accounting Center block verbatim —
    otherwise the title/subtitle render as unstyled default text.
  - **Single source of the title (anti-redundancy):** the topbar is the only place
    the page name appears as a heading on screen. Do **not** also render a large
    in-page `<h1>` that repeats the page name (and especially do not repeat the
    subtitle copy) below it — that is the duplicated-header AI-slop pattern (§6 under
    Anti-AI-Slop). A small breadcrumb crumb is allowed.
  - **Print/PDF exception:** report pages that print (the topbar is hidden on print)
    may keep an in-page document header — `<h1>` (24px page-title step) + one-line
    description + generated date — scoped to print only via `bs-print-only`. See
    `balance-sheet.html`.
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

### Authenticated App Page Shell Standard

Every authenticated dashboard/app page (Money Movement and Reporting) uses the
same content shell so finance pages feel like one product system. The shared
classes live in `assets/css/shared-dashboard.css`: `.fluxy-app-main`,
`.fluxy-page-shell`, `.fluxy-page-canvas`, `.fluxy-section-stack`,
`.fluxy-page-header`, `.fluxy-page-header-main`, `.fluxy-page-actions`, and
`.fluxy-content-grid`. New pages must reuse these instead of inventing
page-level padding/max-width.

1. **Accounting Center (`accounting.html`) is the benchmark** for authenticated
   page spacing, density, and grid rhythm. Match it, don't diverge from it.
2. **One app shell grid.** Money Movement (`ledger.html`, `revenue-sync.html`,
   `bill.html`, `subscription.html`) and Reporting pages use the same shell:
   `.fluxy-page-shell` scroll region + `.fluxy-page-canvas` inner wrapper.
3. **Consistent desktop padding.** Content padding is `16px` mobile → `24px`
   ≥640px → `32px` ≥1024px (the benchmark `p-4 sm:p-6 lg:p-8`). Do not add
   extra left padding that detaches content from the sidebar.
4. **One left/right grid edge.** Page title, top controls, KPI cards, tables,
   and empty states all align to `.fluxy-page-canvas` (`max-width: 1540px;
   margin-inline: auto`). The KPI/card grid shares the header's edges.
5. **No dead whitespace.** Do not cap app content at a narrow width (e.g. the
   old `max-w-7xl`/1280px on Money Movement) that floats content in the middle
   of a wide viewport. Dense report pages may use up to `1400px`, but the left
   edge must still read as aligned.
6. **Standard header action row.** The in-page header is
   `.fluxy-page-header` → `.fluxy-page-header-main` (title + one-line subtitle)
   on the left and `.fluxy-page-actions` on the right.
7. **Date filter placement.** When a page has a period/date control, it lives in
   the sticky 64px topbar (the true top of the page), immediately **before** the
   Fluxy AI button — matching Accounting Center. It must use the shared
   `FluxyDateRangePicker` (never `input[type="date"]`). Don't invent a date
   filter on pages that don't already support one (e.g. Subscriptions). Page
   table filters (status/type/visibility selects) stay in the in-page controls
   row; only the period/date scope control moves to the topbar.
8. **Fluxy AI is far-right.** The Fluxy AI / Ask Fluxy AI button is an assistant
   action (not the primary page action) and stays at the far-right of the page
   action group when present. Creation actions (Add Transaction/Bill/Subscription)
   remain the primary action; export/scan/import stay secondary.
9. **Balance Sheet exception.** `balance-sheet.html` may keep its own
   date/period placement and report-tuned shell when the accounting workflow
   requires it; do not force it into the standard date placement if that breaks
   the balance-sheet model.
10. **New pages reuse the shell.** Build new dashboard/app pages on the shared
    shell classes above rather than copying one-off Tailwind padding/max-width
    into the page.

---

## ✨ Animations & Micro-interactions
- **Transitions**: Use `transition-all duration-200 ease-in-out` for hovers.
- **Dashboard/App Sidebar Hover**: Use only subtle `#F8FAFC` hover backgrounds. Do not add collapse/expand interactions.
- **Dashboard/App Export Buttons**: Export/download actions should show a brief disabled loading state, a clear success state, and a subtle `active:scale-95` press interaction. Use CSV for ledger/transaction exports unless a PDF report is explicitly requested.
- **Dashboard/App Date Picker**: Use the shared `FluxyDateRangePicker` from `assets/js/date-range-picker.js` for every dashboard calendar or date picker, including filters and entry drawers. Do not use native `input[type="date"]` or page-local calendar widgets. It should default to the current month when used for ledger-style data, default to today for single-entry dates, avoid separate Day/Month tabs and native calendar picker UI, support single-day and range selection inside the calendar, include tertiary Reset + Cancel + Apply actions for range mode, disable future date clicks, and keep scoped cards, charts, tables, pagination, and exports aligned to the selected period. Outer previous/next arrows must preserve full-month scope when the active filter is monthly, including when returning to the current partial month; only an explicit calendar day/range selection or single-date mode should use day-level navigation.
- **Ledger Filters**: Status and transaction Type are exposed as compact `<select>` controls in the ledger's in-page controls row, alongside the active/voided select and the CSV / scan / Add Transaction actions, not as standalone breakdown panels. (The date filter itself lives in the sticky topbar beside Fluxy AI — see the Authenticated App Page Shell Standard.) Active filters render removable chips above the table and tint the select with the orange accent border/text. Filters intersect with the date range, search, and vendor filter, scope the CSV export and summary cards, and reset pagination to page 1 on change.
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
