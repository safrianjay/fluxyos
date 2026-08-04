// Overview financial charts.
//
// Owns the Overview page's chart primitives: adaptive time bucketing, the
// shared "headline + prior + delta + trend" metric card, and the part-to-whole
// donut. dashboard.js imports these and supplies the data; every figure comes
// from calculations that already exist in db-service.js / report-builder.js.
//
// Contracts enforced here (docs/DESIGN_SYSTEM.md §4 / §4a):
//   - hover is always window.attachChartHover, re-attached after every innerHTML write
//   - wide tracks scroll inside their own overflow-x:auto scroller, Y-axis pinned
//   - a line chart's SVG viewBox width equals its rendered pixel width
//   - money is Inter tabular-nums, "Rp" with no space, never NaN/Infinity

// ---------------------------------------------------------------------------
// Date keys and bucket frames
// ---------------------------------------------------------------------------

export function getDayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

export function parseDayKey(dayKey) {
    const [year, month, day] = String(dayKey).split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function addDays(dayKey, delta) {
    const date = parseDayKey(dayKey);
    date.setDate(date.getDate() + delta);
    return getDayKey(date);
}

export function getMonthStartKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function getMonthEndKey(date = new Date()) {
    return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function getQuarterStartKey(date = new Date()) {
    const q = Math.floor(date.getMonth() / 3);
    return getDayKey(new Date(date.getFullYear(), q * 3, 1));
}

export function getQuarterEndKey(date = new Date()) {
    const q = Math.floor(date.getMonth() / 3);
    return getDayKey(new Date(date.getFullYear(), q * 3 + 3, 0));
}

export function getRangeDays(startKey, endKey) {
    return Math.max(1, Math.round((parseDayKey(endKey) - parseDayKey(startKey)) / 86400000) + 1);
}

// Bucket labels follow the app language. The Cash Flow chart's server-side twin
// (_formatCashFlowLabel) already localizes; this keeps the two charts from
// printing different month names on the same page.
function chartLocale() {
    try {
        return window.FluxyI18n?.locale?.() || 'en-US';
    } catch (_) {
        return 'en-US';
    }
}

export function formatBucketLabel(startKey, endKey, bucketType) {
    const start = parseDayKey(startKey);
    const end = parseDayKey(endKey);
    const locale = chartLocale();
    if (bucketType === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
    if (bucketType === 'month') return start.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
    if (startKey === endKey) return start.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${start.toLocaleDateString(locale, { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
    }
    return `${start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}-${end.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
}

// Adaptive granularity, per DESIGN_SYSTEM §4a: ≤14d day, ≤93d week, ≤366d
// month, beyond that quarter. Keeps All Time from exploding into 30+ columns.
export function resolveBucketType(startKey, endKey) {
    const rangeDays = getRangeDays(startKey, endKey);
    if (rangeDays <= 14) return 'day';
    if (rangeDays <= 93) return 'week';
    if (rangeDays <= 366) return 'month';
    return 'quarter';
}

// The empty bucket skeleton for a range. Extracted from the retired
// buildCashflowBuckets so §4a bucketing survives Performance Trend's removal.
export function buildBucketFrames(startKey, endKey) {
    const bucketType = resolveBucketType(startKey, endKey);
    const frames = [];

    if (bucketType === 'month' || bucketType === 'quarter') {
        const stepMonths = bucketType === 'quarter' ? 3 : 1;
        const periodStartKey = date => bucketType === 'quarter' ? getQuarterStartKey(date) : getMonthStartKey(date);
        const periodEndKey = date => bucketType === 'quarter' ? getQuarterEndKey(date) : getMonthEndKey(date);
        let cursor = periodStartKey(parseDayKey(startKey));
        while (cursor <= endKey) {
            const periodEnd = periodEndKey(parseDayKey(cursor));
            const bucketStart = cursor < startKey ? startKey : cursor;
            const bucketEnd = periodEnd > endKey ? endKey : periodEnd;
            frames.push({ start: bucketStart, end: bucketEnd, label: formatBucketLabel(bucketStart, bucketEnd, bucketType) });
            const next = parseDayKey(cursor);
            next.setMonth(next.getMonth() + stepMonths);
            cursor = periodStartKey(next);
        }
    } else {
        const bucketStep = bucketType === 'day' ? 1 : 7;
        let cursor = startKey;
        while (cursor <= endKey) {
            const bucketEnd = addDays(cursor, bucketStep - 1) > endKey ? endKey : addDays(cursor, bucketStep - 1);
            frames.push({ start: cursor, end: bucketEnd, label: formatBucketLabel(cursor, bucketEnd, bucketType) });
            cursor = addDays(bucketEnd, 1);
        }
    }

    if (!frames.length) {
        frames.push({ start: startKey, end: endKey, label: formatBucketLabel(startKey, endKey, 'day') });
    }
    frames.bucketType = bucketType;
    return frames;
}

// ---------------------------------------------------------------------------
// Transaction classification (mirrors _calculateOverviewPerformance)
// ---------------------------------------------------------------------------

export function isRevenueType(type) {
    return ['revenue', 'income', 'refund', 'pending_receivable'].includes(String(type || '').toLowerCase());
}

export function isSpendType(type) {
    return ['expense', 'fee', 'tax', 'pending_payable'].includes(String(type || '').toLowerCase());
}

export function getRecordDate(record, fieldName) {
    const value = record?.[fieldName];
    if (value && typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

/**
 * Fill bucket frames with revenue / expense / COGS totals for a transaction set.
 *
 * `isCogs` is optional; when omitted (no cost-of-revenue account mapped) the
 * grossMarginPct stays null rather than reporting a 100% margin off zero COGS.
 * That mirrors calculateProfitLoss in report-builder.js, which returns null for
 * the same reason.
 */
export function buildMetricSeries(transactions = [], frames = [], isCogs = null) {
    const buckets = frames.map(frame => ({
        start: frame.start,
        end: frame.end,
        label: frame.label,
        revenue: 0,
        expense: 0,
        cogs: 0,
        netIncome: 0,
        grossProfit: 0,
        grossMarginPct: null
    }));
    if (!buckets.length) return buckets;

    const rangeStart = buckets[0].start;
    const rangeEnd = buckets[buckets.length - 1].end;

    transactions.forEach(tx => {
        const date = getRecordDate(tx, 'timestamp');
        if (!date) return;
        const dayKey = getDayKey(date);
        if (dayKey < rangeStart || dayKey > rangeEnd) return;
        const bucket = buckets.find(item => dayKey >= item.start && dayKey <= item.end);
        if (!bucket) return;
        const amount = Math.abs(Number(tx.amount) || 0);
        if (!amount) return;
        if (isRevenueType(tx.type)) {
            bucket.revenue += amount;
        } else if (isSpendType(tx.type)) {
            bucket.expense += amount;
            if (isCogs && isCogs(tx)) bucket.cogs += amount;
        }
    });

    buckets.forEach(bucket => {
        bucket.netIncome = bucket.revenue - bucket.expense;
        bucket.grossProfit = bucket.revenue - bucket.cogs;
        // Margin is undefined without revenue — a gap in the line, not a zero and
        // never NaN/Infinity.
        bucket.grossMarginPct = (isCogs && bucket.revenue > 0)
            ? (bucket.grossProfit / bucket.revenue) * 100
            : null;
    });

    return buckets;
}

// Trim empty leading and trailing month/quarter buckets so a long range starts
// at the first period with real activity instead of padding out to today.
// Trims by the union of both series so current and prior stay index-aligned.
export function trimToActivity(current = [], prior = [], bucketType) {
    if (bucketType !== 'month' && bucketType !== 'quarter') return { current, prior };
    if (current.length <= 1) return { current, prior };
    const active = index => {
        const c = current[index];
        const p = prior[index];
        return (c && (c.revenue > 0 || c.expense > 0)) || (p && (p.revenue > 0 || p.expense > 0));
    };
    let lo = 0;
    let hi = current.length - 1;
    while (lo < hi && !active(lo)) lo++;
    while (hi > lo && !active(hi)) hi--;
    return {
        current: current.slice(lo, hi + 1),
        prior: prior.length ? prior.slice(lo, hi + 1) : []
    };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function formatIDR(value) {
    return `Rp${Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID')}`;
}

// Overview convention: a level renders -Rp… (red), never parentheses and never
// a leading +. See PROJECT_BACKGROUND §3a.
export function formatLevelIDR(value) {
    const n = Number(value) || 0;
    return n < 0 ? `-${formatIDR(n)}` : formatIDR(n);
}

export function formatSignedIDR(value) {
    const n = Number(value) || 0;
    if (n === 0) return 'Rp0';
    return `${n < 0 ? '-' : '+'}${formatIDR(n)}`;
}

// Axis money. B = miliar (10^9), M = juta (10^6) — matches formatRupiahCompact
// in report-builder.js. Deliberately NOT formatRpCompact from
// kpi-detail-shared.js, whose "M" means miliar and would mislabel by 1000x.
export function formatCompactIDR(value) {
    const n = Math.abs(Number(value) || 0);
    if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}K`;
    return `Rp${Math.round(n)}`;
}

export function formatPercentValue(value, digits = 1) {
    if (!Number.isFinite(Number(value))) return 'N/A';
    const n = Number(value);
    return `${n.toFixed(Math.abs(n) >= 10 ? 0 : digits)}%`;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

// Chart-scoped empty state on the shared .fluxy-table-empty classes.
//
// Deliberately not window.renderEmptyState: that helper is sized for a full
// table (py-20 + an 80px icon would blow out a 3-up card) and, more importantly,
// it hardcodes id="empty-state-action" and wires it with a global
// getElementById — two charts empty at once (no expenses AND no bank accounts)
// would collide on that id and bind the wrong handler. This binds the button
// directly on the element it just created, so cards stay independent.
export function renderChartEmptyState(container, config = {}) {
    if (!container) return;
    const hasAction = Boolean(config.buttonText && typeof config.onAction === 'function');
    container.innerHTML = `
        <div class="fluxy-table-empty chart-empty">
            <p class="fluxy-table-empty-title">${escapeHtml(config.title || 'No data yet')}</p>
            <p class="fluxy-table-empty-description">${escapeHtml(config.description || '')}</p>
            ${hasAction ? `<button type="button" class="chart-empty-action">${escapeHtml(config.buttonText)}</button>` : ''}
        </div>
    `;
    if (hasAction) {
        container.querySelector('.chart-empty-action')?.addEventListener('click', config.onAction);
    }
}

// ---------------------------------------------------------------------------
// Card head: headline value, prior value, delta
// ---------------------------------------------------------------------------

// Delta tone. `invert` flips good/bad for spend metrics (down is good).
// Flat threshold matches renderKpiComparison in dashboard.js.
function deltaTone(change, invert = false) {
    if (change === null || change === undefined || !Number.isFinite(Number(change))) {
        return { arrow: '', cls: 'is-neutral', text: '' };
    }
    const n = Number(change);
    if (Math.abs(n) < 0.1) return { arrow: '', cls: 'is-neutral', text: 'No change' };
    const up = n > 0;
    const good = invert ? !up : up;
    return {
        arrow: up ? '↑' : '↓',
        cls: good ? 'is-good' : 'is-bad',
        text: ''
    };
}

function buildMetricHead(config) {
    const {
        value, valueLabel, priorValue, priorLabel,
        change, changeUnit = 'percent', invert = false, negative = false
    } = config;

    const tone = deltaTone(change, invert);
    const hasChange = change !== null && change !== undefined && Number.isFinite(Number(change));
    const changeText = hasChange
        ? (Math.abs(Number(change)) < 0.1
            ? 'No change'
            : `${Number(change) > 0 ? 'Up' : 'Down'} ${changeUnit === 'points'
                ? `${Math.abs(Number(change)).toFixed(1)} pts`
                : formatPercentValue(Math.abs(Number(change)), 2)}`)
        : 'No prior period';

    const priorBlock = priorValue !== null && priorValue !== undefined
        ? `<div class="chart-metric-prior">
               <span class="chart-metric-prior-value">${escapeHtml(priorValue)}</span>
               <span class="chart-metric-prior-label">${escapeHtml(priorLabel || 'Prior period')}</span>
           </div>`
        : '';

    return `
        <div class="chart-metric-head">
            <div class="chart-metric-current">
                <span class="chart-metric-value tabular-nums${negative ? ' is-negative' : ''}">${escapeHtml(value)}</span>
                <span class="chart-metric-value-label">${escapeHtml(valueLabel || '')}</span>
            </div>
            ${priorBlock}
            <p class="chart-metric-delta ${tone.cls}">
                ${tone.arrow ? `<span class="chart-metric-arrow" aria-hidden="true">${tone.arrow}</span>` : ''}
                <span>${escapeHtml(changeText)}</span>
            </p>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Trend plots
// ---------------------------------------------------------------------------

// Minimum horizontal space per bucket. Half-width cards get a tighter step so a
// 2-up card doesn't scroll on a short range. Below this the plot scrolls inside
// its own scroller rather than cramming (DESIGN_SYSTEM §4a).
const MIN_BUCKET_PX = 64;
const MIN_BUCKET_PX_COMPACT = 34;
const AXIS_GUTTER_PX = 76;
const PLOT_HEIGHT = 220;

// The plot area and the labels row are two separate horizontal scrollers (so the
// Y-axis can stay pinned). Mirror scrollLeft so they move as one.
export function linkHorizontalScroll(a, b) {
    if (!a || !b) return;
    let lock = false;
    const mirror = (from, to) => {
        if (lock) return;
        lock = true;
        to.scrollLeft = from.scrollLeft;
        lock = false;
    };
    a.addEventListener('scroll', () => mirror(a, b));
    b.addEventListener('scroll', () => mirror(b, a));
}

function syncScrollers(root) {
    linkHorizontalScroll(
        root.querySelector('[data-chart-scroll]'),
        root.querySelector('[data-chart-labels-scroll]')
    );
}

function trackWidth(bucketCount, plotEl, compact) {
    const step = compact ? MIN_BUCKET_PX_COMPACT : MIN_BUCKET_PX;
    const minTrack = bucketCount * step;
    const available = Math.max(0, Math.round((plotEl?.clientWidth || 0) - AXIS_GUTTER_PX));
    return Math.max(minTrack, available || minTrack);
}

function buildLinePoints(values, min, max, width, height, paddingX, paddingY) {
    const span = (max - min) || 1;
    const yFor = value => height - paddingY - (((value - min) / span) * (height - paddingY * 2));
    if (values.length === 1) return [{ x: width / 2, y: yFor(values[0] ?? min) }];
    return values.map((value, index) => ({
        x: paddingX + (index / Math.max(values.length - 1, 1)) * (width - paddingX * 2),
        y: yFor(value ?? min)
    }));
}

// Polyline points, skipping null gaps (an undefined margin is a gap, not a zero).
function toPolyline(points, values) {
    return points
        .map((point, index) => (values[index] === null || values[index] === undefined)
            ? null
            : `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .filter(Boolean)
        .join(' ');
}

function axisTicks(min, max, formatValue) {
    const mid = min + (max - min) / 2;
    return [max, mid, min].map(value => `<div><span>${escapeHtml(formatValue(value))}</span></div>`).join('');
}

function labelsRow(buckets, width) {
    // Thin to ~10 labels on long ranges so they never smear together.
    const stride = Math.max(1, Math.ceil(buckets.length / 10));
    return `
        <div class="chart-labels-scroll" data-chart-labels-scroll>
            <div class="chart-labels" style="width: ${width}px">
                ${buckets.map((bucket, index) => `<span>${index % stride === 0 ? escapeHtml(bucket.label) : ''}</span>`).join('')}
            </div>
        </div>
    `;
}

function attachHover(stage, buckets, config) {
    if (!stage || !window.attachChartHover) return;
    window.attachChartHover(stage, {
        bars: '[data-chart-bar]',
        orientation: 'vertical',
        buildTooltip: barEl => {
            const index = Number(barEl.dataset.index);
            const bucket = buckets[index];
            if (!bucket) return '';
            return config.buildTooltip(bucket, index);
        }
    });
}

function tooltipRow(color, label, value, dashed = false) {
    const swatch = dashed
        ? `<span class="chart-tooltip-swatch is-prior" style="border-color:${color}"></span>`
        : `<span class="chart-tooltip-swatch" style="background:${color}"></span>`;
    return `
        <div class="chart-tooltip-row">
            ${swatch}
            <span class="chart-tooltip-label">${escapeHtml(label)}</span>
            <span class="chart-tooltip-value">${escapeHtml(value)}</span>
        </div>
    `;
}

/**
 * Diverging column plot around a real zero baseline (Net income).
 *
 * Per DESIGN_SYSTEM §4b: one pixels-per-rupiah for both sides, zero placed where
 * zero actually falls rather than at 50%, and a floor under the smaller side so a
 * far-smaller side can't collapse to sub-pixel.
 */
function renderDivergingPlot(plotEl, buckets, priorBuckets, config) {
    const values = buckets.map(b => safeNumber(config.valueOf(b)));
    const priorValues = priorBuckets.map(b => safeNumber(config.valueOf(b)));
    const all = values.concat(priorValues);
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const span = (max - min) || 1;

    // Zero sits where zero falls in the value range.
    const MINOR_RESERVE_PCT = 6;
    let posShare = (max / span) * 100;
    if (max > 0 && posShare < MINOR_RESERVE_PCT) posShare = MINOR_RESERVE_PCT;
    if (min < 0 && posShare > 100 - MINOR_RESERVE_PCT) posShare = 100 - MINOR_RESERVE_PCT;
    if (max <= 0) posShare = min < 0 ? MINOR_RESERVE_PCT : 100;
    const negShare = 100 - posShare;

    const width = trackWidth(buckets.length, plotEl, config.compact);
    const heightFor = value => {
        const share = value >= 0
            ? (max > 0 ? (value / max) * posShare : 0)
            : (min < 0 ? (Math.abs(value) / Math.abs(min)) * negShare : 0);
        return Math.max(share, Math.abs(value) > 0 ? 1.5 : 0);
    };

    plotEl.innerHTML = `
        <div class="chart-plot-stage" data-chart-stage>
            <div class="chart-axis chart-axis-diverging">
                <div><span>${escapeHtml(config.formatAxis(max))}</span></div>
                <div class="chart-axis-zero" style="top:${posShare}%"><span>Rp0</span></div>
                <div><span>${min < 0 ? escapeHtml(config.formatAxis(min)) : ''}</span></div>
            </div>
            <div class="chart-scroll" data-chart-scroll>
                <div class="chart-diverging-track" style="width:${width}px">
                    <div class="chart-zero-line" style="top:${posShare}%"></div>
                    ${buckets.map((bucket, index) => {
                        const value = values[index];
                        const prior = priorValues[index];
                        const hasPrior = priorBuckets.length > 0;
                        const column = (v, cls) => {
                            if (!v) return '';
                            const h = heightFor(v);
                            const style = v >= 0
                                ? `height:${h}%; bottom:${negShare}%`
                                : `height:${h}%; top:${posShare}%`;
                            return `<span class="${cls} ${v >= 0 ? 'is-positive' : 'is-negative'}" style="${style}"></span>`;
                        };
                        return `
                            <div class="chart-diverging-group" data-chart-bar data-index="${index}">
                                ${hasPrior ? column(prior, 'chart-column chart-column-prior') : ''}
                                ${column(value, 'chart-column chart-column-current')}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
        ${labelsRow(buckets, width)}
    `;
    attachHover(plotEl.querySelector('[data-chart-stage]'), buckets, config);
    syncScrollers(plotEl);
}

/** Area-line plot (Total income / Total expenses / Gross profit margin). */
function renderLinePlot(plotEl, buckets, priorBuckets, config) {
    const values = buckets.map(b => {
        const v = config.valueOf(b);
        return (v === null || v === undefined) ? null : Number(v);
    });
    const priorValues = priorBuckets.map(b => {
        const v = config.valueOf(b);
        return (v === null || v === undefined) ? null : Number(v);
    });
    const real = values.concat(priorValues).filter(v => v !== null && Number.isFinite(v));

    const rawMax = real.length ? Math.max(...real) : 0;
    const rawMin = real.length ? Math.min(...real) : 0;
    const max = config.allowNegative ? Math.max(rawMax, 0) : Math.max(rawMax, 1);
    const min = config.allowNegative ? Math.min(rawMin, 0) : 0;

    // viewBox width must equal rendered pixel width, or preserveAspectRatio="none"
    // stretches the line and turns markers into ovals on short ranges.
    const width = trackWidth(buckets.length, plotEl, config.compact);
    const height = PLOT_HEIGHT;
    const paddingX = 16;
    const paddingY = 18;

    const points = buildLinePoints(values, min, max, width, height, paddingX, paddingY);
    const priorPoints = priorValues.length
        ? buildLinePoints(priorValues, min, max, width, height, paddingX, paddingY)
        : [];

    const currentLine = toPolyline(points, values);
    const priorLine = priorPoints.length ? toPolyline(priorPoints, priorValues) : '';
    const areaId = `chart-area-${Math.random().toString(36).slice(2, 9)}`;
    const baselineY = height - paddingY;
    const area = currentLine
        ? `<polygon class="chart-area" points="${points[0].x.toFixed(1)},${baselineY} ${currentLine} ${points[points.length - 1].x.toFixed(1)},${baselineY}" fill="url(#${areaId})"></polygon>`
        : '';
    const showMarkers = buckets.length <= 16;

    plotEl.innerHTML = `
        <div class="chart-plot-stage" data-chart-stage>
            <div class="chart-axis">${axisTicks(min, max, config.formatAxis)}</div>
            <div class="chart-scroll" data-chart-scroll>
                <div class="chart-line-track" style="width:${width}px">
                    <svg class="chart-line-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(config.ariaLabel || 'Trend chart')}">
                        <defs>
                            <linearGradient id="${areaId}" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stop-color="${config.color}" stop-opacity="0.18"></stop>
                                <stop offset="100%" stop-color="${config.color}" stop-opacity="0"></stop>
                            </linearGradient>
                        </defs>
                        ${area}
                        ${priorLine ? `<polyline class="chart-line chart-line-prior" points="${priorLine}" stroke="${config.priorColor}"></polyline>` : ''}
                        ${currentLine ? `<polyline class="chart-line chart-line-current" points="${currentLine}" stroke="${config.color}"></polyline>` : ''}
                        ${showMarkers ? points.map((point, index) => (values[index] === null || values[index] === undefined)
                            ? ''
                            : `<circle class="chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" fill="${config.color}"></circle>`).join('') : ''}
                    </svg>
                    <div class="chart-hover-zones">
                        ${buckets.map((bucket, index) => `<div class="chart-hover-zone" data-chart-bar data-index="${index}"></div>`).join('')}
                    </div>
                </div>
            </div>
        </div>
        ${labelsRow(buckets, width)}
    `;
    attachHover(plotEl.querySelector('[data-chart-stage]'), buckets, config);
    syncScrollers(plotEl);
}

/**
 * Render one "headline + prior + delta + trend" chart card.
 *
 * @param {HTMLElement} cardEl  the .chart-card section
 * @param {Object} config
 *   shape        'diverging' | 'line'
 *   buckets      current-period series
 *   priorBuckets prior-period series (index-aligned, may be empty)
 *   valueOf      bucket => number | null
 *   head         { value, valueLabel, priorValue, priorLabel, change, changeUnit, invert, negative }
 *   formatAxis   value => string
 *   buildTooltip (bucket, index) => html
 *   color, priorColor, compact, allowNegative, emptyState
 */
export function renderTrendMetricCard(cardEl, config) {
    if (!cardEl) return;
    const headEl = cardEl.querySelector('[data-chart-head]');
    const plotEl = cardEl.querySelector('[data-chart-plot]');
    if (!headEl || !plotEl) return;

    if (config.emptyState) {
        headEl.innerHTML = '';
        renderChartEmptyState(plotEl, config.emptyState);
        return;
    }

    headEl.innerHTML = buildMetricHead(config.head || {});
    if (config.shape === 'diverging') {
        renderDivergingPlot(plotEl, config.buckets || [], config.priorBuckets || [], config);
    } else {
        renderLinePlot(plotEl, config.buckets || [], config.priorBuckets || [], config);
    }
}

export { tooltipRow };

// ---------------------------------------------------------------------------
// Donut (part-to-whole)
// ---------------------------------------------------------------------------

// Donut slice palette: a monotonic lightness ramp in the info-blue family.
//
// A multi-hue categorical set was tried first and failed hard — blue, indigo and
// violet collapse to ΔE 0.3 under deuteranopia, i.e. literally the same colour.
// Dichromacy destroys hue but preserves lightness, so stepping lightness in one
// hue is what actually stays separable. Verified end to end:
//   node scripts/validate_palette.js "#172554,#1D4ED8,#3B82F6,#7DAEFB,#B3D2FE,#94A3B8"
//   → worst pair ΔE 10.5 across normal / deuteranopia / protanopia / tritanopia.
//
// Semantic hues are deliberately excluded: green and red mean cleared/critical
// everywhere else in FluxyOS, and orange backgrounds are banned project-wide.
// Every slice also carries a text label + value in the legend, so identity is
// never colour-alone regardless.
export const DONUT_PALETTE = [
    '#172554',
    '#1D4ED8',
    '#3B82F6',
    '#7DAEFB',
    '#B3D2FE'
];

const DONUT_OTHER_COLOR = '#94A3B8'; // slate — always the "Other" arc
const DONUT_MIN_SLICE_PCT = 2;
// Never draw more arcs than the palette has validated steps. Beyond this the
// remainder folds into "Other" — which also keeps the ring readable, since a
// twelve-slice donut is a legend with decoration attached.
const DONUT_MAX_SLICES = DONUT_PALETTE.length;

/**
 * Part-to-whole donut with a labelled legend.
 *
 * Guards this encodes:
 *  - non-positive values are excluded from the ring (a ring cannot draw a
 *    negative slice) but still surface in the legend, so nothing goes missing
 *  - slices under 2% fold into "Other" so the ring never draws sub-pixel arcs,
 *    while each folded row keeps its own legend line
 *  - a zero total renders the shared empty state, never a placeholder ring
 *
 * @param {HTMLElement} cardEl
 * @param {Object} config  { rows: [{label, value, meta}], totalLabel, formatValue, emptyState }
 */
export function renderDonutCard(cardEl, config) {
    if (!cardEl) return;
    const bodyEl = cardEl.querySelector('[data-chart-donut]');
    if (!bodyEl) return;

    const formatValue = config.formatValue || formatIDR;
    // The ring's inner hole is ~86px wide; a full "Rp147.971.356" needs well over
    // that and was being clipped. The centre shows the compact form and carries
    // the exact figure in its title, while the legend keeps full precision.
    const formatCenter = config.formatCenter || formatCompactIDR;
    const rows = (config.rows || [])
        .map(row => ({ ...row, value: safeNumber(row.value) }))
        .sort((a, b) => b.value - a.value);
    const positive = rows.filter(row => row.value > 0);
    const excluded = rows.filter(row => row.value <= 0);
    const total = positive.reduce((sum, row) => sum + row.value, 0);

    if (!total) {
        renderChartEmptyState(bodyEl, config.emptyState || {});
        return;
    }

    // Fold sub-2% slices, and anything past the validated palette length, into a
    // single "Other" arc. Their legend rows survive intact, so folding changes
    // what the ring draws, never what the user can read.
    const major = [];
    const minor = [];
    positive.forEach(row => {
        const tooSmall = ((row.value / total) * 100) < DONUT_MIN_SLICE_PCT;
        (tooSmall || major.length >= DONUT_MAX_SLICES ? minor : major).push(row);
    });
    const minorTotal = minor.reduce((sum, row) => sum + row.value, 0);

    const arcs = major.map((row, index) => ({
        value: row.value,
        color: DONUT_PALETTE[index % DONUT_PALETTE.length]
    }));
    if (minorTotal > 0) arcs.push({ value: minorTotal, color: DONUT_OTHER_COLOR });

    // Geometry: r=52 in a 140-box, stroke 20 → a ring, not a pie. A 2px surface
    // gap between segments keeps adjacent slices distinguishable.
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const gap = 2;
    let offset = 0;
    const segments = arcs.map(arc => {
        const length = Math.max((arc.value / total) * circumference - gap, 0.5);
        const dash = `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`;
        const seg = `<circle class="chart-donut-segment" cx="70" cy="70" r="${radius}"
            stroke="${arc.color}" stroke-dasharray="${dash}"
            stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
        offset += (arc.value / total) * circumference;
        return seg;
    }).join('');

    const legendRow = (label, color, value, pct, isExcluded = false) => `
        <li class="chart-donut-legend-row${isExcluded ? ' is-excluded' : ''}">
            <span class="chart-donut-swatch" style="background:${color}"></span>
            <span class="chart-donut-legend-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <span class="chart-donut-legend-pct tabular-nums">${pct === null ? '—' : formatPercentValue(pct)}</span>
            <span class="chart-donut-legend-value tabular-nums">${escapeHtml(formatValue(value))}</span>
        </li>
    `;

    // The legend summarises the tail rather than enumerating it. A workspace with
    // seventeen bank accounts was producing a seventeen-row legend that stretched
    // the card to twice the height of its row-mates; the folded rows were also
    // all sub-1%, so listing them individually bought nothing.
    const legendRows = major.map((row, index) =>
        legendRow(row.label, DONUT_PALETTE[index % DONUT_PALETTE.length], row.value, (row.value / total) * 100));

    if (minor.length === 1) {
        legendRows.push(legendRow(minor[0].label, DONUT_OTHER_COLOR, minor[0].value, (minor[0].value / total) * 100));
    } else if (minor.length > 1) {
        legendRows.push(legendRow(
            `Other (${minor.length})`, DONUT_OTHER_COLOR, minorTotal, (minorTotal / total) * 100));
    }

    // Non-positive entries can't be drawn as an arc, but silently dropping them
    // would hide, say, an overdrawn account. Surface them as one counted row.
    if (excluded.length) {
        const excludedTotal = excluded.reduce((sum, row) => sum + row.value, 0);
        legendRows.push(legendRow(
            excluded.length === 1 ? excluded[0].label : `Zero or negative (${excluded.length})`,
            DONUT_OTHER_COLOR, excludedTotal, null, true));
    }

    const legend = legendRows.join('');

    bodyEl.innerHTML = `
        <div class="chart-donut-body">
            <div class="chart-donut-ring">
                <svg viewBox="0 0 140 140" role="img" aria-label="${escapeHtml(config.ariaLabel || 'Distribution donut chart')}">
                    <circle class="chart-donut-track" cx="70" cy="70" r="${radius}"></circle>
                    <g transform="rotate(-90 70 70)">${segments}</g>
                </svg>
                <div class="chart-donut-center">
                    <span class="chart-donut-total tabular-nums" title="${escapeHtml(formatValue(total))}">${escapeHtml(formatCenter(total))}</span>
                    <span class="chart-donut-total-label">${escapeHtml(config.totalLabel || 'Total')}</span>
                </div>
            </div>
            <ul class="chart-donut-legend">${legend}</ul>
        </div>
    `;
}
