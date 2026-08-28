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
- **Monospace Font**: `Fira Code` — available for code snippets only. **Numbers and financial amounts do NOT use a monospace face** (see the strict numeric rule below): a monospace zero renders with a slash/dot, which is banned. Amounts use `Inter` with `tabular-nums`.
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
4. **Numbers always use `Inter` with `tabular-nums` (plain zero).** Never put
   numbers in a monospace face (`Fira Code`, or Tailwind `font-mono` → OS mono):
   those render a slashed/dotted zero, which is banned. Inter's `tabular-nums`
   still aligns digit columns. See "Numeric & currency format (strict)" below.
5. Marketing pages keep the display scale above. Don't apply the
   dashboard scale to landing pages.

Pre-existing `text-[11px]` / `text-[13px]` instances in the codebase
are being migrated to `text-[12px]` / `text-[14px]` in scoped sweeps;
new code must already be on-scale. **The KPI drill-down family
(`revenue-overview`, `cash-position`, `cash-pressure`, `opex-budget`,
`net-profit`, and `kpi-detail-shared.js`) completed that migration** — it is
fully on-scale and must stay there.

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
- **Fluxy AI launcher (documented gradient exception)**: the one intentional
  gradient affordance in the app — a white **pill** (`rounded-full`) with a
  purple→blue gradient border, a gradient sparkle icon, and a gradient label.
  Single source of truth: `.fluxy-ai-btn*` in `assets/css/shared-dashboard.css`,
  applied automatically by the enhancer in `assets/js/shared-dashboard.js` to
  every `button[onclick*="toggleFluxyAI"]` / `button[id$="ask-ai"]` launcher.
  This is an **approved exception** to the orange-accent brand and the anti-slop
  "no purple gradient" ban (logged under Exception Protocol): the gradient marks
  the AI assistant and keeps it visually distinct from orange primary actions.
  Do not restyle these launchers back to orange, and do not extend this gradient
  to non-AI buttons. The sidebar `Fluxy AI` nav item keeps the sidebar theme.

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
          <td class="fluxy-table-cell fluxy-table-money">Rp1.250.000</td>
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
- Money: `Inter`, `14px`, `tabular-nums` (plain zero), right-aligned. Never a monospace face.
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

Always display currency as Indonesian Rupiah with dot separators and **no space
after `Rp`**, for example `Rp1.000.000` (never `Rp 1.000.000`). Financial
statement negatives use parentheses, for example `(Rp1.000.000)`. Changes may
use `+Rp1.000.000`, `(Rp1.000.000)`, or the page's current negative convention.
Never render `NaN`, `Infinity`, or `-Infinity`; unavailable percentages display
`N/A`.

### Numeric & currency format (strict)

These two rules are mandatory for every amount, KPI, and numeric value on an
authenticated app page:

1. **Plain zero.** Numbers render in `Inter` with `font-variant-numeric:
   tabular-nums` (and/or `font-feature-settings: "tnum"`). A monospace face
   (`Fira Code`, or Tailwind `font-mono` which resolves to the OS monospace)
   renders a **slashed/dotted zero** and is banned for numbers — Fira Code's
   zero keeps its dot even with the `zero` OpenType feature toggled, so the only
   way to a clean zero is the sans face. `tabular-nums` keeps digit columns
   aligned. This is enforced centrally in `assets/css/shared-dashboard.css`
   (`.font-mono`, `.fluxy-table-money`, `.fluxy-kpi-value`, `.acct-mono`,
   `.acct-kpi-value` are pinned to Inter `tabular-nums` with `!important`).
2. **No space after `Rp`.** Currency is `Rp1.000`, never `Rp 1.000`. Format
   helpers must emit `"Rp" + value.toLocaleString('id-ID')` (no space), and no
   hardcoded `Rp 0` / `Rp ${…}` strings may reintroduce the space.

Do not reintroduce a monospace face for amounts and do not add a space after
`Rp` anywhere (helpers, templates, or static HTML).

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

The Overview financial charts — **Net profit**, **Total income**, **Total
expenses**, **Gross profit margin** and **Cash Flow** — plot one bucket per
period across the selected range. They follow these rules (see
`assets/js/overview-charts.js` `buildBucketFrames` / `buildMetricSeries` /
`trimToActivity` / `renderTrendMetricCard`, and `assets/js/dashboard.js`
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

**Line charts:** the SVG `viewBox` must equal its rendered pixel size on **both
axes**. With `preserveAspectRatio="none"` a narrow viewBox stretched to a wide
panel distorts the line, and a fixed viewBox *height* stretched into a taller
stage scales y independently of x — either one turns round point markers into
ovals. Compute both from the real container: width from its width, height from
its height minus the pinned labels row. This matters as soon as one chart type
renders at more than one size (Overview cards render full-width, 2-up and 3-up).
Because the width is measured at render time, a width change (window resize,
sidebar collapse, breakpoint) has to trigger a repaint — `dashboard.js` keeps the
last chart inputs in `overviewChartState` and redraws from cache on a debounced
resize rather than refetching.

**Prior-period overlays:** a "vs prior period" ghost series must be bucketed
against the **previous** window's own frames, then paired to the current series
by index. Bucketing prior records against the current frames drops every one of
them as out-of-range and silently draws an empty ghost — the chart looks fine and
says nothing. The two windows are equal length (`_getPreviousOverviewPeriod`), so
index *i* is "day 1 vs day 1 of last month". Guard:
`tests/overview-charts.spec.js` → "prior-period series is bucketed against the
prior window".

### 4b. KPI drill-down detail pages

The Overview Revenue / Cash position / OpEx / Net profit cards drill into dedicated
detail pages (`/revenue-overview`, `/cash-position`, `/opex-budget`,
`/net-profit`). These follow the
`budget-allocation.html` structural template — sticky topbar (back link +
period strip + Fluxy AI) → `.fluxy-page-shell` → `.fluxy-page-canvas` → header →
KPI strip → trend + breakdown → records table — and reuse shared classes so they
read as one system with the rest of the app. Do not invent a new look for them.

- **Clickable KPI affordance:** a card that drills into a detail page uses
  `.metric-cell-clickable` (dashboard.css): `cursor:pointer`, a subtle border/shadow
  lift and a `.metric-drill-chevron` that fades in on hover/focus, plus a
  `focus-visible` ring. It is `role="link"` + `tabindex="0"` and keyboard-activatable.
  **No orange background** — orange stays an accent (chevron tint only).
- **Shared detail classes (shared-dashboard.css):** `.kpi-detail-cell` /
  `-label` / `-value` / `-sub` (KPI strip), `.kpi-detail-breakdown-row` (contribution
  list), `.kpi-detail-record-row`, `.kpi-period-controls` / `.kpi-period-btn` (the
  self-contained period strip), and `.kpi-dim-btn` (breakdown dimension toggle). Build
  new drill-downs on these instead of copying page-local styles.
- **Trend chart:** use `renderTrendChart` from `assets/js/kpi-detail-shared.js` — an
  SVG area/line chart with an optional zero-baseline positive/negative fill (Cash
  position / Cash pressure), a dashed "Today" marker, and the shared `attachChartHover`
  tooltip. Money stays `Inter` `tabular-nums`, Rp with no space. For long ranges it
  self-manages density: `bucketSeries` trims empty leading/trailing month/quarter
  buckets (anchor to real activity — matches §4a) and the axis thins to ~10 labels
  (markers hidden past 16 buckets) so All Time never overlaps into an unreadable smear.
- **Not every KPI needs a bespoke page.** Route each card to the most relevant surface:
  a dedicated drill-down only when the KPI has its *own* records to explore *and* its own
  analysis to offer; otherwise link to its primary driver (Gross margin → Revenue).
  Cloning the full drill-down for a derived ratio or a metric another page already covers
  is the banned "repetitive cloned pages" pattern. Net Profit earns a page because
  the drill-down answers *why* the number moved — a bridge from the previous period, a
  Month/Quarter/Year comparison, and a contributors breakdown — none of which the Revenue
  or OpEx pages provide.
- **A detail page must add analysis, not just re-present the KPI.** Beyond the shared
  scaffold, a drill-down should answer the question the card raises. Net Profit is the
  reference: composition (revenue vs expenses) → bridge (what moved it) → period
  comparison → source records.
- **No in-page AI panel on a drill-down.** The Fluxy AI drawer in the topbar is the
  assistant surface on every app page; a second AI block inside the page duplicates it,
  spends the user's AI credit for a narration of numbers already on screen, and pushes
  the source records below the fold. Register the page's live figures with
  `FluxyAIContext.register()` instead, so the drawer opens already oriented on the page.

#### Ratio panels: meter, not donut

A two-slice donut is banned for a revenue-vs-expenses style panel. Two reasons, and
both generalize:

1. **A donut asserts part-to-whole.** Expenses regularly exceed revenue, and no ring can
   render a slice at 710% of itself — the chart breaks on exactly the loss-making
   periods a user most needs to read.
2. **A single ratio against a limit is a meter**, and a 2-slice pie is the documented
   wrong form for it (the number itself is the chart; the meter is its context).

The pattern to copy is `renderComposition` in `assets/js/net-profit.js`: a horizontal
track = the base (revenue = 100%), a fill = the share consumed, the remainder = what is
left, and anything past the limit rendered as a **separate hatched over-run bar** with
its own label — never as a longer fill, which would imply it still fits.

#### When a donut *is* the right form

The ban above is about **ratio** panels, and both of its reasons are premises, not
decoration: the parts must actually sum to the whole, and the whole must actually
bound the parts. Where those premises hold — the parts are all positive and they
genuinely compose the total — a donut is the correct form and is used:
**Expense breakdown** (categories summing to total spend) and **Bank accounts**
(balances summing to total cash), both via `renderDonutCard` in
`assets/js/overview-charts.js`.

A donut ships only with all four guards, which is what keeps the premises true:

1. **Non-positive values never become an arc.** A ring cannot draw a negative
   slice. They are excluded from the geometry and surfaced as a counted legend
   row instead, so an overdrawn account is visible rather than silently dropped.
2. **Sub-2% slices fold into one "Other" arc**, so the ring never renders
   sub-pixel wedges that read as rendering noise.
3. **The legend summarises its tail, it does not enumerate it.** Cap the named
   rows at the palette length and collapse the rest into a single counted row
   (`Other (12)`). A workspace with seventeen bank accounts produced a
   seventeen-row legend that stretched its card to twice the height of its
   row-mates — and every folded row was under 1%, so listing them bought nothing.
4. **The centre shows the compact total** (`Rp280.4M`), with the exact figure on
   `title` and full precision in the legend. The ring's inner hole is ~86px; a
   full `Rp280.400.000` is clipped.

**Slice colour is a lightness ramp, not a hue wheel.** A multi-hue categorical
palette was tried first and failed hard: blue, indigo and violet collapse to
**ΔE 0.3** under deuteranopia — literally the same colour. Dichromacy destroys
hue but preserves lightness, so stepping lightness within one hue is what stays
separable. Semantic hues stay out of categorical palettes entirely (green and red
mean cleared/critical everywhere else; orange backgrounds are banned
project-wide). Every slice still carries a text label, percentage and amount in
the legend, so identity is never colour-alone regardless.

#### Comparing a measure across periods

Use `renderComparisonColumns` (`assets/js/kpi-detail-shared.js`) — a diverging column
chart, one column per period around a shared zero baseline. Not a donut (that asserts
part-to-whole and cannot draw a negative period) and not a line (that implies
continuity between discrete buckets).

Three rules the implementation encodes, all of which were wrong in a first pass:

1. **One pixels-per-rupiah for both sides.** Scaling each side to its own maximum uses
   the canvas better but makes a Rp30jt loss draw the same height as a Rp4.5B profit —
   it destroys the single comparison the chart exists to make.
2. **Place zero where zero falls**, not at 50%, so an absent or small side doesn't
   reserve dead canvas — but floor the smaller side (`MINOR_RESERVE_PX`) or a
   900×-smaller side collapses to sub-pixel and vanishes.
3. **Only tick an axis side that is actually scaled to its data.** A side holding just
   the reserve would print a value no bar comes near, and collide with the zero tick.

Direct-label every column when the chart replaces a table — the figures must be
readable without hover, or the chart is a downgrade.

**Status green vs red collapses under deuteranopia** — `#16A34A` vs `#EF4444`
measures ΔE2000 **5.4** simulated, against ~72 in normal vision. Wherever the two
sit adjacent (this meter, stacked segments, paired bars), every segment must carry
a text label and a 2px surface gap so identity is never colour-alone.

Run `node scripts/validate_palette.js "<hex,hex,…>"` before shipping any new
multi-colour chart rather than eyeballing it. It simulates deuteranopia,
protanopia and tritanopia (Viénot–Brettel–Mollon) and reports the closest pair by
CIEDE2000, exiting non-zero when any pair falls below the threshold (default
ΔE 10, override with `--min`). Note the earlier figure recorded here was ΔE 3.7;
the measured value depends on the difference formula, so treat the script's output
as the reference rather than a number quoted in prose.

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

**Budget allocation picker.** When a record-entry flow needs to let the user pin
a transaction to a budget allocation, reuse `window.FluxyBudgetPicker`
(`assets/js/shared-dashboard.js`) rather than hand-rolling the dropdown:
`loadForDate(ds, uid, date)` fetches the covering budget + allocations,
`buildOptionsHtml(allocations, selectedId)` renders the `<option>`s ("Auto-match
by category" → each allocation with `Rp…left` → "Don't track against budget"),
and `buildAssignmentFields({ budget, allocationId })` returns the `budget_*`
fields to merge onto the create payload. Already used by the Add Transaction
drawer, CSV bulk apply-to-all, and AI receipt capture.

**Cash-impact control.** Likewise, never hand-roll the cash-impact segmented
control — reuse `window.FluxyCashImpact` (`assets/js/shared-dashboard.js`):
`buildHtml({ impact, direction, accountId, bankAccounts })` renders the
Actual / Pending / No-impact segmented control + direction (in/out) + optional
bank-account link, `wire(root, { impact, direction, onChange })` returns a
controller (`getState` / `setImpact` / `setDirection`), `stateFromRecord(row)`
reads the editable state from an existing record, and `derive(state, timestamp)`
returns the `cash_*` fields. Shared by the Add Transaction drawer and the Ledger
transaction editor so the two stay identical.

---

## 📐 Layout & Spacing
- **Dashboard/App Sidebar Width**: `248px` fixed. There is no collapsed
  (mini-rail) state on desktop — do not add one. Widened from `220px`
  (2026-08-28) because the longest real labels — "Accounting Center", "Reports &
  Exports" — sat one character from truncating, and the group labels had no room
  to be set apart from the items under them. The width is declared **once**, in
  `#sidebar.app-sidebar-light` in `shared-dashboard.css`; every page's
  `w-[220px]` utility on the `<aside>` is overridden by it, so do not chase the
  literal through the HTML.
- **Dashboard/App Sidebar below 640px**: the sidebar leaves the flow and becomes
  an **off-canvas drawer**, opened by the `md:hidden` hamburger every app topbar
  already renders. Wired centrally in `sidebar-loader.js`; styles are
  `#sidebar` / `.sidebar-mobile-open` / `.sidebar-mobile-backdrop` in
  `shared-dashboard.css`. Closes on backdrop click, Escape, following a nav
  link, and on crossing back above 640px (which must also release the body
  scroll lock).
  **Why it exists:** a fixed 220px column leaves 155px of content on a 375px
  screen, which is not enough for a topbar title plus its actions — page titles
  were being squeezed to zero width. The hamburger shipped on every page from
  the start with nothing listening to it. Guard:
  `tests/inventory-ui.spec.js` → "below 640px the sidebar is a dismissable
  drawer, on every app page".
- **Dashboard/App Sidebar Theme**: `bg-white`, `border-slate-200`, dark navy text `#1E2F4A`, active item text/icon `#EA580C` with no orange background. The
  active row also carries a neutral `#F1F5F9` fill and `600` weight: orange text
  alone is a weak target to find at a glance and is precisely what a colour-blind
  user cannot fall back on, so the active item needs a shape as well as a hue.
  The fill is neutral — the project-wide ban on orange backgrounds stands.
- **Dashboard/App Sidebar Header**: `64px` tall to align with the main app topbar divider. Logo mark is `36px`, logo text is `18px`, vertically centered.
- **Dashboard/App Sidebar Menu Type**: Menu text is `14px` max, icon size is `16px` max, Lucide-style stroke icons only. Do not enlarge sidebar nav text or icons.
- **Dashboard/App Sidebar Density**: Menu rows are `36px` min-height, `8px 10px` item padding, and `2px` vertical gap between entries. Text stays at `14px` and icons at `16px` — a wider sidebar is not licence to enlarge either.
- **Dashboard/App Sidebar Group Rhythm**: Group labels are `11px / 600`,
  UPPERCASE, `0.08em` tracking, in slate `#94A3B8`, with `22px` top and `6px`
  bottom spacing. They were previously `13px / 600` in the same `#1E2F4A` as the
  nav items — two information levels rendered nearly identically, which is the
  typography hard rule below, and which made the nav read as one long list
  instead of five groups. The caps treatment is what this document's letter-
  spacing table already specified for "eyebrow / sidebar caps"; the
  implementation simply never matched it.
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
    Pages that don't load `dashboard.css` **must define
    these three classes page-scoped**, copying the Accounting Center block verbatim —
    otherwise the title/subtitle render as unstyled default text.
  - **Single source of the title (anti-redundancy):** the topbar is the only place
    the page name appears as a heading on screen. Do **not** also render a large
    in-page `<h1>` that repeats the page name (and especially do not repeat the
    subtitle copy) below it — that is the duplicated-header AI-slop pattern (§6 under
    Anti-AI-Slop). A small breadcrumb crumb is allowed.
  - **Print/PDF exception:** report pages that print (the topbar is hidden on print)
    may keep an in-page document header — `<h1>` (24px page-title step) + one-line
    description + generated date — scoped to print only. See `report-preview.html`.
- **Back navigation lives in the topbar (top-left).** Any "Back to X" navigation
  on an authenticated app page is a **text link in the sticky 64px topbar**,
  pinned top-left immediately after the mobile menu button: a left-chevron
  (`h-4 w-4`, `M15 19l-7-7 7-7`) + label, `14px / 600`, `text-gray-500
  hover:text-gray-900`. **Canonical implementation:** the "Back to Main Budget"
  link in `budget-period.html`. Never place a back affordance as an in-content
  button, and never nest it inside a card/panel header. On multi-view pages
  (an editor/detail sub-view inside one page, e.g. `invoices.html`) toggle this
  single topbar link per view — show it on the sub-views, hide it on the list —
  rather than rendering separate per-view back buttons.
- **Page-action (CTA) rows have no card/background of their own.** The primary/
  secondary page actions for a screen or sub-view live either in the topbar
  right (preferred) or on a **transparent** in-content header row alongside the
  in-page `<h1>` title (`.fluxy-page-header` pattern — title left, actions
  right). Do **not** wrap a page-header/CTA row in its own white card, bordered
  bar, or sticky panel (`bg-white border ... shadow`); that reads as an extra
  floating component. Cards are for content grouping, not for holding the page's
  own action buttons. (Reference: the `invoices.html` create/edit header — title
  + Save/Review actions on the bare page, back link in the topbar.)
- **Dashboard/App Sidebar IA**: All dashboard/app pages use the centralized `sidebar-loader.js` grouped menu:
  - `Command`: Overview, Fluxy AI.
  - `Money Movement`: Transactions, Revenue Sync, Bills, Subscriptions.
  - `Operations`: Vendor Spend, Receipt Capture, Budgets, Approvals.
  - `Reporting`: Reports & Exports, Audit Log.
  - `Workspace`: Integrations, Settings.
- **Dashboard/App Future Features**: Future dashboard features may appear only as disabled `Soon` entries until a real authenticated app page exists. Do not link sidebar entries to marketing/landing pages.
- **Dashboard/App Ineligible Features**: A shipped module that does not apply to
  the user's business is **absent from the nav entirely** — never a disabled
  `Soon` entry. The two states say different things: `Soon` advertises something
  coming, while an ineligible module is simply not part of that business's
  workflow, and showing it as "coming" would be a false promise. Mechanism:
  `assets/js/feature-access.js` (Inventory and Outlet P&L are the first two).
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
9. **New pages reuse the shell.** Build new dashboard/app pages on the shared
    shell classes above rather than copying one-off Tailwind padding/max-width
    into the page.
10. **Breadcrumb placement (hard rule).** When a detail/records page shows a
    breadcrumb (`.acct-breadcrumb`), it renders at the **top of the page content —
    above any filter/search/toolbar section and above the primary card.** The
    reading order is always: breadcrumb → (title/summary) → filters → data. Never
    place a filter card above the breadcrumb, and never bury the breadcrumb inside
    a JS-rendered body that follows the filters. `accounting-records.html` is the reference (breadcrumb in the
    `.acct-records-hero` before the filter card); `accounting-account.html` renders
    its breadcrumb into `#account-breadcrumb` above the filter section for the
    same reason.

#### Dashboard Content Width Standard (hard rule)

Any operational dashboard page that contains one or more of — KPI cards,
financial summaries, tables, data grids, operational lists, reports, analytics,
reconciliation/accounting views, budget management views, invoices, or financial
statements — **must** use the shared dashboard content container:
`.fluxy-page-shell` (scroll region, `16/24/32px` responsive padding) →
`.fluxy-page-canvas` (`max-width: 1540px; margin-inline: auto`). This guarantees
one shared content width, horizontal spacing, grid alignment, and table
proportion across the platform.

- **Baseline reference implementations: Transactions (`ledger.html`),
  Revenue Sync (`revenue-sync.html`), Bills (`bill.html`).** Match them.
- Now compliant on this standard: Budgets (`budget.html`, `budget-period.html`,
  `budget-allocation.html`) and Invoices (`invoices.html`). They previously used a
  narrow `max-w-7xl` (1280px) container — that is **banned** for data-heavy pages.
- **Do not introduce a page-specific content width** (`max-w-7xl`, `max-w-6xl`,
  one-off `max-w-[…]`, or custom padding wrappers) without a documented product
  requirement logged as an exception. There are currently **no** documented
  exceptions — the former `balance-sheet.html` exception was retired with the page
  (docs/ACCOUNTING_CENTER_IA.md Phase 3).
- Data-heavy pages prioritize information density, scanability, and operational
  efficiency over decorative spacing. Marketing/landing pages keep their own
  wider editorial containers and are **not** governed by this rule.
- Users should feel they operate inside one cohesive financial system, not move
  between different page layouts.

#### In-Page Section Navigation (tabs) — standard

Applies to any app page that splits content into sibling views on one route
(Accounting Center, Tax Center, Settings). Reference implementation: `.acct-tabs` /
`.acct-tab` (primary group row) over `.acct-subtabs` / `.acct-subtab` (child view
row) in `assets/css/accounting.css`, driven by `data-acct-group` / `data-acct-tab` /
`data-acct-parent` / `data-acct-panel` with `setTab()` and `setGroup()` in
`assets/js/accounting.js`.

1. **Single-level nav caps at 7 items.** Past that, scanning collapses and the row
   stops communicating structure. A page needing more views must go two-level.
2. **Tabs are peers or they are not tabs.** Every item in one row must be the same
   *class of object* — all reports, or all settings sections. Mixing reports,
   records, configuration, and workflow in one row is an IA failure, not a styling
   one. This is the flat-hierarchy case of the anti-slop rule below ("no clear
   prioritization").
3. **Two-level nav**: a primary group row (`role="tablist"`) plus a secondary child
   row that swaps per group. The primary row carries semantic groups, never a single
   report. Selecting a group activates its first child.
4. **Name the destination, not the container.** Child items carry real report/section
   names. Abstract bin labels ("Statements", "Other", "More") are prohibited as leaf
   navigation — a user must know what they will get before clicking.
5. **One active path is always visible** at both levels; never leave a group
   highlighted with no active child.
6. **State lives in the URL** (`?tab=` / `?section=`) so views are linkable and
   deep-links from other pages survive. Cross-page drill-downs must activate both
   the group and the child.
7. **Lazy-load per view, cache per period.** Fetch a view's data on first activation,
   not on page load; invalidate on period change. See `KERNEL_TABS` in
   `accounting.js`.
8. **Counts belong on the tab that owns the work** (e.g. a cleanup badge on the
   section where the work is done). One numeric badge per row maximum.
9. **375px behaviour is part of the spec.** The nav scrolls horizontally inside its
   own container — the page body never scrolls horizontally, and the active item
   scrolls into view on load.
10. **Accessibility**: `role="tablist"` / `role="tab"` with `aria-selected`, arrow-key
    traversal, and a visible focus ring. Panels toggle via a hidden class, not by
    unmounting, so scroll position and form state survive switching.

**Full worked example of a two-level restructure**, including why grouping follows a
domain's real workflow: `docs/ACCOUNTING_CENTER_IA.md`.

---

## ✨ Animations & Micro-interactions
- **Transitions**: Use `transition-all duration-200 ease-in-out` for hovers.
- **Dashboard/App Sidebar Hover**: Use only subtle `#F8FAFC` hover backgrounds. Do not add collapse/expand interactions.
- **Dashboard/App Export Buttons**: Export/download actions should show a brief disabled loading state, a clear success state, and a subtle `active:scale-95` press interaction. Use CSV for ledger/transaction exports unless a PDF report is explicitly requested.
- **Dashboard/App Date Picker**: Use the shared `FluxyDateRangePicker` from `assets/js/date-range-picker.js` for every dashboard calendar or date picker, including filters and entry drawers. Do not use native `input[type="date"]` or page-local calendar widgets. It should default to the current month when used for ledger-style data, default to today for single-entry dates, avoid separate Day/Month tabs and native calendar picker UI, support single-day and range selection inside the calendar, include tertiary Reset + Cancel + Apply actions for range mode, disable future date clicks, and keep scoped cards, charts, tables, pagination, and exports aligned to the selected period. Outer previous/next arrows must preserve full-month scope when the active filter is monthly, including when returning to the current partial month; only an explicit calendar day/range selection or single-date mode should use day-level navigation.
- **Ledger Filters**: Visibility, Status, Type, and Cash movement are consolidated behind a single **Filters** entry point in the ledger's in-page controls row (alongside the CSV / scan / Add Transaction actions), not as separate selects or standalone breakdown panels. Clicking it opens a two-pane **master-detail** popover below the trigger: a left rail of filter categories (each with a Lucide-style icon and an orange dot when a non-default value is applied) and a right pane that shows the selected category's options under a "Show only · <Category>" header. **Status and Type are multi-select** (checkbox rows, OR within the field; the "All …" row clears the group, empty = no filter), while **Visibility and Cash are single-select** (radio rows). A multi-select group still counts as one applied filter and renders one chip ("Status: 2 selected"). Selections are **staged** — they update a live "N applied" badge and a "Results: N" preview but only take effect on **Apply filters**; Reset, Cancel/✕, Escape, and outside-click revert uncommitted changes. (The date filter itself lives in the sticky topbar beside Fluxy AI — see the Authenticated App Page Shell Standard.) Once applied, the Filters trigger shows an active count badge with the orange accent, active filters render removable chips above the table, and clearing a chip syncs the panel back. Filters intersect with the date range, search, and vendor filter, scope the CSV export and summary cards, and reset pagination to page 1 on change. Orange stays an accent only (active rail/radio states use orange icon/text/fill-dot on white — never an orange surface fill).
- **Dashboard/App Entry Drawer**: Use the shared `showAddTransactionModal` drawer for transaction, bill, and subscription entry. It opens from the right side, locks page scroll, uses a black translucent overlay, and closes via X, overlay click, Escape, or successful submit.
- **Dashboard/App Entry Dates**: Entry drawers that write finance records mount `FluxyDateRangePicker` in single-date mode. Single-date mode uses one month only, no outer previous/next period arrows, no footer range labels or action buttons, and auto-selects/closes when the user clicks a day. It defaults to today, allows today or previous days only, and shows an inline info warning above the sticky submit button when the selected date or CSV row dates are not today.
- **Dashboard/App CSV Uploads**: CSV upload controls should show selected filename, disabled/ready/uploading/success/error states, and inline structure guidance before the user uploads. If a modal supports single and bulk entry, separate them with tabs and reuse the modal's primary submit button for the active tab instead of adding a second upload button.
- **Dashboard/App Form Buttons**: Primary submit buttons start disabled and become active only after the required fields for the current mode are present.
- **Dashboard/App Tables**: Transaction tables default to 10 rows per page. Sortable headers use compact text buttons with up/down SVG icons and no layout shift.
- **Shadows**: Elevate cards on hover using `hover:shadow-md`.

---

## 🛠 Usage Checklist
1. [ ] Does it use `Inter` for text **and** for money (`tabular-nums`, plain zero — never a monospace face), with `Rp1.000` (no space)?
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
  context. Generic labels such as "`Finance ops, ledger, bills, and AI in one
  system`" or "`X, Y, and AI in one system`" are banned. A redundant badge plus
  extra top whitespace is treated as AI slop because it delays the real message
  without adding user value.
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

### 3b) Numbers Must Be Legible On Their Own (Hard Rules)

A number the reader has to decode is a design defect, not a data problem.

- **Never render two numbers adjacent without a label between them.** The Stock
  Count sheet shipped `System: 2.394 1000` — a quantity and a unit concatenated.
  It reads as two numbers because nothing says which is which. Every figure gets
  a label (`EXPECTED 1.000 g`), and a value plus its unit gets visible
  separation.
- **A sequence like `100 | 87 | -13` is banned.** Label each figure, and state
  the relationship the reader is meant to draw: `Short 150 g`, `to reach 40.000 g`.
- **State the meaning in words before the magnitude.** `Short 13` survives being
  skimmed, printed in greyscale, or read by someone who does not distinguish red
  from green. `-13` does not.
- **Blank is not zero.** An uncounted, unset, or unknown figure says so
  (`Not counted`, `—`, `No cost yet`). A blank cell reads as "we looked and found
  none", which is a different and often costly claim.
- **The layout must stay legible when the data is wrong.** Bad input is normal:
  someone types the conversion factor into the unit field, a name runs to sixty
  characters, a cost is missing. A layout that only reads correctly with clean
  data is not finished. Labels, separation, and explicit empty states are what
  make it degrade rather than collapse.

**When someone says a screen is confusing, that is a design bug.** Do not answer
it by explaining that the underlying values are technically correct, or that the
data was entered wrong — both can be true while the screen is still at fault.
Fix the presentation first; the data quality issue is a separate, additional
finding.

### 3c) A Control Must Do What Its Label Says (Hard Rules)

A button that performs something other than what it reads is worse than no
button, because the user trusts it once and then stops trusting the screen.

- **No shared component may default to an action.** `renderEmptyState` defaulted
  to an orange **Add Record** wired to `showAddTransactionModal()`, so any caller
  that passed only a title and description silently shipped a primary button
  aimed at the generic income/expense drawer. On the Restock tab it offered to
  log a transaction, which is not what restocking means; on the Tax Center it sat
  under copy that already said to go to Bills. A caller now names **both** the
  label and the action, or gets no button. Defaults are for appearance, never for
  behaviour.
- **An empty state with no action is a correct outcome, not an omission.** A
  search that matched nothing needs *Clear search*, not *Add*. A healthy list
  with nothing to do — "Nothing needs reordering" — needs no button at all.
  Manufacturing one to fill the space sends the user somewhere unrelated.
- **Never offer an action the page cannot perform.** Restocking is not logged on
  the Restock tab; it happens when goods arrive, through *Receive stock*. If no
  honest action exists on this surface, say what the state means and stop.
- **Icons are part of the label.** A `+` glyph in front of *Go to Inventory* or
  *Clear filters* describes an action the button does not perform. The plus is
  reserved for controls that genuinely create something.
- **Match the icon to the mood of the state.** A plus-in-a-circle above
  "Nothing needs reordering" reads as "something is missing" when the state is
  actually the good one. Use a check for healthy, a magnifier for no-match.

The general form: every affordance is a promise. Before shipping one, read its
label aloud and confirm the click does exactly that — this is the same failure
class as 3b, where the screen said something other than what was true.

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
- Form-control and compact action icons must stay between 16px and 20px.
  Use generated Tailwind classes (`h-4 w-4` or `h-5 w-5`) or explicit CSS;
  never rely on unsupported fractional utility classes such as `h-4.5 w-4.5`
  because the raw SVG can render oversized.
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
