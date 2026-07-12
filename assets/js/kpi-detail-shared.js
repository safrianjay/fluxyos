// ── KPI Drill-down — shared scaffold ────────────────────────────────
// One reusable toolkit behind the three dashboard KPI detail pages
// (Revenue Overview, Cash Position, OpEx & Budget). It owns the pieces the
// three pages share so they read as one system and don't drift:
//   • period parsing/persistence via the URL query string
//   • the period-strip + FluxyDateRangePicker control
//   • the data-driven KPI summary strip
//   • the trend chart (area/line, optional zero-baseline pos/neg fill,
//     today marker) wired to the shared attachChartHover tooltip
//   • the breakdown contribution list
//   • the supporting records table (search + sort + paginate + CSV export
//     gated by FluxyAccessGuard, rows deep-link into the Ledger)
//
// It is framework-free and leans on the existing window globals
// (attachChartHover, createTablePaginator, FluxyDateRangePicker,
// FluxyAccessGuard). See docs/DESIGN_SYSTEM.md §4 and docs/SYSTEM_DESIGN.md.

// ── Formatting ──────────────────────────────────────────────────────
export function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatRp(amount) {
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return 'Rp' + Math.abs(Math.round(value)).toLocaleString('id-ID');
}

// Signed money — financial-statement negatives use parentheses.
export function formatSignedRp(amount) {
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    if (value < 0) return '(' + formatRp(value) + ')';
    return formatRp(value);
}

// Compact Rp for chart axis labels (Indonesian magnitudes rb/jt/M).
export function formatRpCompact(amount) {
    const raw = Number(amount) || 0;
    const sign = raw < 0 ? '-' : '';
    const n = Math.abs(raw);
    if (n >= 1e9) return sign + 'Rp' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'M';
    if (n >= 1e6) return sign + 'Rp' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'jt';
    if (n >= 1e3) return sign + 'Rp' + Math.round(n / 1e3) + 'rb';
    return sign + 'Rp' + Math.round(n);
}

export function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'N/A';
    return num.toFixed(Math.abs(num) >= 10 ? 0 : 1) + '%';
}

export function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
        try { const d = value.toDate(); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; }
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
    const date = toDate(value);
    if (!date) return 'No date';
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// First present date on a record, trying common field names.
export function recordDate(record, fields = ['timestamp', 'date', 'created_at']) {
    for (const f of fields) {
        const d = toDate(record?.[f]);
        if (d) return d;
    }
    return null;
}

// ── Day-key helpers (YYYY-MM-DD) ────────────────────────────────────
export function parseKey(key) {
    if (!key || typeof key !== 'string') return null;
    const [y, m, d] = key.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}
export function dayKey(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
export function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
function monthStartKey(dt = new Date()) { return dayKey(new Date(dt.getFullYear(), dt.getMonth(), 1)); }
function monthEndKey(dt = new Date()) { return dayKey(new Date(dt.getFullYear(), dt.getMonth() + 1, 0)); }

// ── Period model (mirrors dashboard.js resolveDashboardPeriod) ──────
export function resolvePeriod(mode, start, end) {
    const today = new Date();
    if (mode === 'last_month') {
        const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { mode, label: 'Last month', start: monthStartKey(lm), end: monthEndKey(lm) };
    }
    if (mode === 'year_to_date') {
        return { mode, label: 'Year to date', start: dayKey(new Date(today.getFullYear(), 0, 1)), end: dayKey(today) };
    }
    if (mode === 'all_time') {
        return { mode, label: 'All time', start: '1970-01-01', end: dayKey(today) };
    }
    if (mode === 'custom' && start && end) {
        return { mode, label: rangeLabel(start, end), start, end };
    }
    return { mode: 'this_month', label: 'This month', start: monthStartKey(today), end: monthEndKey(today) };
}

export function rangeLabel(startKey, endKey) {
    const s = parseKey(startKey), e = parseKey(endKey);
    if (!s || !e) return 'Selected range';
    const fmt = (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt(s)} – ${fmt(e)}`;
}

// Preceding window of equal length, for period-over-period comparison.
export function previousPeriod(startKey, endKey) {
    const s = parseKey(startKey), e = parseKey(endKey);
    if (!s || !e) return { start: startKey, end: endKey };
    const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
    const prevEnd = addDays(s, -1);
    const prevStart = addDays(prevEnd, -(days - 1));
    return { start: dayKey(prevStart), end: dayKey(prevEnd) };
}

// Read the range the dashboard passed via ?period&start&end. Falls back to
// this-month when absent so a directly-opened detail page still works.
export function resolvePeriodFromUrl() {
    const p = new URLSearchParams(window.location.search);
    const mode = p.get('period') || 'this_month';
    return resolvePeriod(mode, p.get('start'), p.get('end'));
}

// Persist the active range on the URL (replaceState) so a reload keeps it and
// the link is shareable, without adding a history entry per period change.
export function writePeriodToUrl(period) {
    if (!window.history?.replaceState) return;
    const p = new URLSearchParams(window.location.search);
    p.set('period', period.mode);
    if (period.mode === 'all_time') { p.delete('start'); p.delete('end'); }
    else { p.set('start', period.start); p.set('end', period.end); }
    window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
}

// Wire the period-strip buttons ([data-kpi-period]) + the range picker.
// `onChange(period)` fires with the resolved period; the caller reloads data.
export function mountPeriodControls({ period, pickerSelector, onChange }) {
    let current = period;
    const buttons = Array.from(document.querySelectorAll('[data-kpi-period]'));
    const pickerHost = pickerSelector ? document.querySelector(pickerSelector) : null;

    const picker = window.FluxyDateRangePicker?.mount(pickerSelector, {
        start: current.start === '1970-01-01' ? monthStartKey() : current.start,
        end: current.end,
        onChange: ({ start, end }) => {
            current = resolvePeriod('custom', start, end);
            syncState();
            emit();
        }
    });

    function syncState() {
        buttons.forEach(b => b.classList.toggle('is-active', b.dataset.kpiPeriod === current.mode));
        if (pickerHost) pickerHost.style.display = current.mode === 'custom' ? '' : 'none';
    }
    function emit() {
        writePeriodToUrl(current);
        onChange?.(current);
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.kpiPeriod || 'this_month';
            if (mode === 'custom') {
                // Switch to custom mode and reveal the range picker seeded with
                // the current range. Don't reload yet — the reload happens when
                // the user Applies a range (picker onChange). Resolving 'custom'
                // with no dates would silently fall back to this_month.
                const seedStart = current.start === '1970-01-01' ? monthStartKey() : current.start;
                current = { mode: 'custom', label: rangeLabel(seedStart, current.end), start: seedStart, end: current.end };
                picker?.setRange(seedStart, current.end);
                syncState();
                writePeriodToUrl(current);
                return;
            }
            current = resolvePeriod(mode);
            if (current.mode !== 'all_time') picker?.setRange(current.start, current.end);
            syncState();
            emit();
        });
    });

    syncState();
    return { getPeriod: () => current };
}

// ── KPI summary strip ───────────────────────────────────────────────
// items: [{ label, value, sub, negative?, tone?, progress?, barCls? }]
export function renderKpiStrip(containerId, items) {
    const host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = items.map(item => `
        <article class="kpi-detail-cell">
            <div class="flex items-center gap-1.5">
                <p class="kpi-detail-cell-label">${escapeHtml(item.label)}</p>
                ${item.info ? `<button type="button" class="metric-info" tabindex="0" aria-label="${escapeHtml(item.info)}" data-tooltip="${escapeHtml(item.info)}">?</button>` : ''}
            </div>
            <p class="kpi-detail-cell-value ${item.negative ? 'text-red-600' : (item.tone === 'positive' ? 'text-emerald-600' : 'text-gray-900')}">${escapeHtml(item.value)}</p>
            <p class="kpi-detail-cell-sub">${item.subHtml || escapeHtml(item.sub || '')}</p>
            ${item.progress != null ? `
                <div class="mt-3 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div class="h-full rounded-full ${item.barCls || 'bg-[#EA580C]'}" style="width: ${Math.max(0, Math.min(100, item.progress))}%"></div>
                </div>` : ''}
        </article>
    `).join('');
}

// A comparison line for the header: arrow + delta text vs previous period.
export function trendDelta(current, previous, { invert = false } = {}) {
    const cur = Number(current) || 0;
    const prev = Number(previous) || 0;
    const diff = cur - prev;
    const up = diff > 0;
    const flat = Math.abs(diff) < 1;
    // invert = true → "up is bad" (spend). Colour accordingly.
    const good = invert ? diff < 0 : diff > 0;
    const tone = flat ? 'neutral' : (good ? 'positive' : 'negative');
    const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur !== 0 ? 100 : 0);
    return {
        diff,
        up,
        flat,
        tone,
        arrow: flat ? '' : (up ? '▲' : '▼'),
        text: flat
            ? 'No change vs previous period'
            : `${up ? '+' : '−'}${formatRp(diff)} (${formatPercent(Math.abs(pct))}) vs previous period`,
        colorClass: tone === 'positive' ? 'text-emerald-600' : (tone === 'negative' ? 'text-red-600' : 'text-gray-500')
    };
}

// ── Time-series bucketing ───────────────────────────────────────────
// Adaptive granularity by range length (matches Overview charts):
//   ≤14d → day · ≤93d → week · ≤366d → month · else → quarter.
// Returns { points: [{label, value, startKey, endKey}], todayIndex }.
export function bucketSeries(records, startKey, endKey, { dateOf, valueOf }) {
    let s = parseKey(startKey);
    let e = parseKey(endKey);
    if (!s || !e) return { points: [], todayIndex: -1 };

    // For very old "all time" starts, clamp to the earliest record so the axis
    // doesn't stretch back to 1970.
    if (startKey === '1970-01-01') {
        let earliest = null;
        records.forEach(r => { const d = dateOf(r); if (d && (!earliest || d < earliest)) earliest = d; });
        s = earliest ? new Date(earliest.getFullYear(), earliest.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth(), 1);
    }

    const spanDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
    const gran = spanDays <= 14 ? 'day' : spanDays <= 93 ? 'week' : spanDays <= 366 ? 'month' : 'quarter';

    let buckets = [];
    const label = (d, g) => {
        if (g === 'day') return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        if (g === 'week') return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        if (g === 'month') return d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
        return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    };
    let cursor = new Date(s);
    if (gran === 'month') cursor = new Date(s.getFullYear(), s.getMonth(), 1);
    if (gran === 'quarter') cursor = new Date(s.getFullYear(), Math.floor(s.getMonth() / 3) * 3, 1);
    let guard = 0;
    while (cursor <= e && guard++ < 800) {
        let next;
        if (gran === 'day') next = addDays(cursor, 1);
        else if (gran === 'week') next = addDays(cursor, 7);
        else if (gran === 'month') next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        else next = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
        buckets.push({ start: new Date(cursor), end: addDays(next, -1), label: label(cursor, gran), value: 0 });
        cursor = next;
    }
    if (!buckets.length) return { points: [], todayIndex: -1 };

    records.forEach(r => {
        const d = dateOf(r);
        if (!d) return;
        // find bucket
        for (let i = 0; i < buckets.length; i++) {
            if (d >= buckets[i].start && d <= new Date(buckets[i].end.getFullYear(), buckets[i].end.getMonth(), buckets[i].end.getDate(), 23, 59, 59)) {
                buckets[i].value += Number(valueOf(r)) || 0;
                break;
            }
        }
    });

    // Anchor month/quarter ranges to real activity: trim leading and trailing
    // empty buckets so a long range (esp. All Time) isn't padded out with a flat
    // zero tail — which also made the line dive to Rp0 at the right edge.
    if ((gran === 'month' || gran === 'quarter') && buckets.length > 2) {
        let lo = 0, hi = buckets.length - 1;
        while (lo < hi && buckets[lo].value === 0) lo++;
        while (hi > lo && buckets[hi].value === 0) hi--;
        if (hi - lo + 1 >= 2) buckets = buckets.slice(lo, hi + 1);
    }

    const now = new Date();
    let todayIndex = buckets.findIndex(b => now >= b.start && now <= new Date(b.end.getFullYear(), b.end.getMonth(), b.end.getDate(), 23, 59, 59));

    return {
        points: buckets.map(b => ({ label: b.label, value: b.value, startKey: dayKey(b.start), endKey: dayKey(b.end) })),
        todayIndex
    };
}

// Running-balance transform: turn per-bucket flows into a cumulative series
// starting from `opening`.
export function toCumulative(points, opening = 0) {
    let acc = Number(opening) || 0;
    return points.map(p => { acc += Number(p.value) || 0; return { ...p, flow: p.value, value: acc }; });
}

// ── Trend chart ─────────────────────────────────────────────────────
// opts: {
//   points: [{label, value, sub?}], color, allowNegative, todayIndex,
//   valueName, formatValue(v), emptyText
// }
export function renderTrendChart(containerId, opts = {}) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const points = opts.points || [];
    const fmt = opts.formatValue || formatRp;
    const valueName = opts.valueName || 'Value';
    const color = opts.color || '#3B82F6';
    const negColor = opts.negColor || '#EF4444';
    const allowNegative = !!opts.allowNegative;

    const hasValues = points.some(p => Number(p.value) !== 0);
    if (!points.length || !hasValues) {
        host.innerHTML = `
            <div class="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 text-center">
                <p class="text-[13px] text-gray-500">${escapeHtml(opts.emptyText || 'No trend data yet for this period.')}</p>
            </div>`;
        return;
    }

    const height = 240;
    const padTop = 16;
    const padBottom = 10;
    const innerH = height - padTop - padBottom;
    const n = points.length;
    const measured = Math.max(320, Math.round(host.clientWidth || 680));
    const width = measured;

    const values = points.map(p => Number(p.value) || 0);
    let yMax = Math.max(...values, 0);
    let yMin = allowNegative ? Math.min(...values, 0) : 0;
    if (yMax === yMin) yMax = yMin + 1; // avoid /0 on flat series
    const yOf = (v) => padTop + ((yMax - v) / (yMax - yMin)) * innerH;
    const zeroY = yOf(0);

    const pts = points.map((p, i) => {
        const x = n === 1 ? width / 2 : (i / (n - 1)) * (width - 24) + 12;
        return { ...p, v: Number(p.value) || 0, x, y: yOf(Number(p.value) || 0) };
    });
    const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${pts[0].x.toFixed(1)},${zeroY.toFixed(1)} ${line} ${pts[n - 1].x.toFixed(1)},${zeroY.toFixed(1)}`;

    // Gradient fill split at the zero line so above-zero fills one colour and
    // below-zero the negative colour (only matters when allowNegative).
    const zeroOffset = Math.max(0, Math.min(1, (yMax - 0) / (yMax - yMin)));
    const gid = `kpiTrendFill-${containerId}`;
    const gradientStops = allowNegative
        ? `
            <stop offset="0%" stop-color="${color}" stop-opacity="0.20"></stop>
            <stop offset="${(zeroOffset * 100).toFixed(2)}%" stop-color="${color}" stop-opacity="0.03"></stop>
            <stop offset="${(zeroOffset * 100).toFixed(2)}%" stop-color="${negColor}" stop-opacity="0.03"></stop>
            <stop offset="100%" stop-color="${negColor}" stop-opacity="0.20"></stop>`
        : `
            <stop offset="0%" stop-color="${color}" stop-opacity="0.20"></stop>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>`;

    const yTicks = [1, 2 / 3, 1 / 3, 0].map(f => yMin + (yMax - yMin) * f);

    const todayIndex = Number.isInteger(opts.todayIndex) ? opts.todayIndex : -1;
    const todayX = todayIndex >= 0 && todayIndex < n ? pts[todayIndex].x : null;

    host.innerHTML = `
        <div class="flex gap-2">
            <div class="flex flex-col justify-between items-end flex-shrink-0 w-16 text-[10px] text-gray-400 tabular-nums" style="height: ${height}px; padding-top: ${padTop}px; padding-bottom: ${padBottom}px;">
                ${yTicks.map(t => `<span class="leading-none">${escapeHtml(formatRpCompact(t))}</span>`).join('')}
            </div>
            <div id="${containerId}-plot" class="relative flex-1 min-w-0" style="height: ${height}px;">
                <svg class="block overflow-visible" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(valueName)} trend">
                    <defs>
                        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">${gradientStops}</linearGradient>
                    </defs>
                    ${[0, 1, 2, 3].map(i => { const y = padTop + i * (innerH / 3); return `<line x1="0" x2="${width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#F1F5F9" stroke-width="1"></line>`; }).join('')}
                    ${allowNegative ? `<line x1="0" x2="${width}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 4"></line>` : ''}
                    ${todayX != null ? `<line x1="${todayX.toFixed(1)}" x2="${todayX.toFixed(1)}" y1="0" y2="${height}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"></line>` : ''}
                    <polygon points="${area}" fill="url(#${gid})"></polygon>
                    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
                    ${n <= 16 ? pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#fff" stroke="${p.v < 0 ? negColor : color}" stroke-width="2"></circle>`).join('') : ''}
                </svg>
                ${todayX != null ? `<span class="absolute -translate-x-1/2 rounded bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" style="left:${todayX.toFixed(1)}px; top:2px;">Today</span>` : ''}
                <div class="absolute inset-0 flex">
                    ${pts.map(p => `<div class="flex-1" data-chart-bar data-label="${escapeHtml(p.label)}" data-value="${p.v}" data-sub="${escapeHtml(p.sub || '')}"></div>`).join('')}
                </div>
            </div>
        </div>
        <div class="mt-1.5 flex gap-2">
            <div class="w-16 flex-shrink-0"></div>
            <div class="flex-1 flex">
                ${(() => {
                    // Thin x-axis labels so a long range (many weeks/months/quarters)
                    // doesn't overlap into an unreadable smear. Show ~10 evenly, plus
                    // always the last. Empty slots keep the spacing aligned to points.
                    const stride = Math.max(1, Math.ceil(n / 10));
                    return pts.map((p, i) => {
                        const show = (i % stride === 0) || i === n - 1;
                        return `<span class="flex-1 text-center text-[10px] text-gray-400 truncate">${show ? escapeHtml(p.label) : ''}</span>`;
                    }).join('');
                })()}
            </div>
        </div>`;

    const plot = document.getElementById(`${containerId}-plot`);
    if (plot && typeof window.attachChartHover === 'function') {
        window.attachChartHover(plot, {
            bars: '[data-chart-bar]',
            orientation: 'vertical',
            buildTooltip: (barEl) => {
                const v = Number(barEl.dataset.value) || 0;
                const sub = barEl.dataset.sub;
                return `
                    <div class="chart-tooltip-header">${escapeHtml(barEl.dataset.label || '')}</div>
                    <div class="chart-tooltip-row">
                        <span class="chart-tooltip-swatch" style="background:${v < 0 ? negColor : color}"></span>
                        <span class="chart-tooltip-label">${escapeHtml(valueName)}</span>
                        <span class="chart-tooltip-value">${escapeHtml(fmt(v))}</span>
                    </div>
                    ${sub ? `<div class="chart-tooltip-row"><span class="chart-tooltip-label">${escapeHtml(sub)}</span></div>` : ''}`;
            }
        });
    }
}

// ── Breakdown contribution list ─────────────────────────────────────
// rows: [{ name, amount, count?, meta? }] — sorted + bar widths relative to
// the largest. onSelect(name|null) toggles a filter on the table.
export function renderBreakdownList(containerId, { rows, total, selected, color = '#EA580C', valueFormat = formatRp, emptyText } = {}) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const list = (rows || []).filter(r => Math.abs(Number(r.amount) || 0) > 0);
    if (!list.length) {
        host.innerHTML = `<div class="px-2 py-8 text-center text-[13px] text-gray-500">${escapeHtml(emptyText || 'No breakdown data yet.')}</div>`;
        return;
    }
    const max = Math.max(...list.map(r => Math.abs(Number(r.amount) || 0)), 1);
    const grand = Number(total) || list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    host.innerHTML = list.map(r => {
        const amt = Number(r.amount) || 0;
        const pctOfMax = Math.max(2, Math.min(100, Math.abs(amt) / max * 100));
        const share = grand > 0 ? (amt / grand) * 100 : 0;
        const isSel = selected && selected === r.name;
        return `
            <div class="kpi-detail-breakdown-row ${isSel ? 'is-selected' : ''}" data-breakdown-name="${escapeHtml(r.name)}">
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <p class="font-semibold text-[13px] text-gray-900 truncate">${escapeHtml(r.name)}</p>
                        <p class="mt-0.5 text-[11px] text-gray-400">${r.count != null ? `${r.count} record${r.count === 1 ? '' : 's'}` : ''}${r.meta ? `${r.count != null ? ' · ' : ''}${escapeHtml(r.meta)}` : ''}</p>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-[13px] font-bold text-gray-900 tabular-nums">${escapeHtml(valueFormat(amt))}</p>
                        <p class="mt-0.5 text-[11px] text-gray-400 tabular-nums">${formatPercent(share)}</p>
                    </div>
                </div>
                <div class="mt-2 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div class="h-full rounded-full" style="width:${pctOfMax}%;background:${amt < 0 ? '#EF4444' : color}"></div>
                </div>
            </div>`;
    }).join('');
}

// ── Supporting records table ────────────────────────────────────────
function escapeCsv(value) {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8;') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Deep-link into the Ledger, opening the record's detail drawer (ledger.html
// already handles ?record=<id>).
export function ledgerRecordUrl(id) {
    return `/ledger?record=${encodeURIComponent(id)}`;
}

// config: {
//   tbodyId, searchInputId, exportBtnId, csvFilename, label, pageSize,
//   paginationId, summaryId, indicatorId, prevBtnId, nextBtnId,
//   columns: [{ key, label, align, render(row)->html, sortValue?(row), csv?(row) }],
//   searchText(row)->string, rowLink?(row)->url, emptyTitle, emptyDesc,
//   defaultSortKey, defaultSortDir
// }
export function createSupportingTable(config) {
    const columns = config.columns || [];
    let allRows = [];
    let sortKey = config.defaultSortKey || null;
    let sortDir = config.defaultSortDir || 'desc';
    let searchTerm = '';

    const paginator = window.createTablePaginator({
        pageSize: config.pageSize || 10,
        label: config.label || 'records',
        paginationId: config.paginationId,
        summaryId: config.summaryId,
        indicatorId: config.indicatorId,
        prevBtnId: config.prevBtnId,
        nextBtnId: config.nextBtnId
    });

    function computed() {
        let rows = allRows;
        if (searchTerm && typeof config.searchText === 'function') {
            const t = searchTerm.toLowerCase();
            rows = rows.filter(r => (config.searchText(r) || '').toLowerCase().includes(t));
        }
        if (sortKey) {
            const col = columns.find(c => c.key === sortKey);
            if (col?.sortValue) {
                rows = [...rows].sort((a, b) => {
                    const av = col.sortValue(a), bv = col.sortValue(b);
                    if (av < bv) return sortDir === 'asc' ? -1 : 1;
                    if (av > bv) return sortDir === 'asc' ? 1 : -1;
                    return 0;
                });
            }
        }
        return rows;
    }

    function renderSlice(visible) {
        const tbody = document.getElementById(config.tbodyId);
        if (!tbody) return;
        if (!visible.length) {
            tbody.innerHTML = `
                <tr><td colspan="${columns.length}" class="px-6 py-12 text-center">
                    <p class="text-[14px] font-semibold text-gray-900">${escapeHtml(config.emptyTitle || 'No records')}</p>
                    <p class="mt-1 text-[13px] text-gray-500">${escapeHtml(config.emptyDesc || 'Nothing to show for this period.')}</p>
                </td></tr>`;
            return;
        }
        tbody.innerHTML = visible.map(row => {
            const href = config.rowLink ? config.rowLink(row) : null;
            const cells = columns.map(c => `<td class="fluxy-table-cell ${c.align === 'right' ? 'fluxy-table-money' : ''}">${c.render(row)}</td>`).join('');
            return `<tr class="fluxy-table-row ${href ? 'fluxy-table-row-clickable' : ''}" ${href ? `data-row-href="${escapeHtml(href)}" role="link" tabindex="0"` : ''}>${cells}</tr>`;
        }).join('');
    }

    function updateSortHeaders() {
        document.querySelectorAll('[data-kpi-sort]').forEach(btn => {
            const active = btn.dataset.kpiSort === sortKey;
            btn.classList.toggle('is-sort-active', active);
            const icon = btn.querySelector('[data-sort-icon]');
            if (icon) icon.textContent = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
        });
    }

    function apply() {
        paginator.setRows(computed(), renderSlice);
        updateSortHeaders();
    }

    // Search
    const searchEl = config.searchInputId ? document.getElementById(config.searchInputId) : null;
    searchEl?.addEventListener('input', () => { searchTerm = searchEl.value.trim(); apply(); });

    // Sort headers
    document.querySelectorAll('[data-kpi-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.kpiSort;
            if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortKey = key; sortDir = 'desc'; }
            apply();
        });
    });

    // Row click / keyboard → deep link
    const tbody = document.getElementById(config.tbodyId);
    tbody?.addEventListener('click', (e) => {
        const row = e.target.closest('[data-row-href]');
        if (row) window.location.href = row.dataset.rowHref;
    });
    tbody?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('[data-row-href]');
        if (row) { e.preventDefault(); window.location.href = row.dataset.rowHref; }
    });

    // CSV export (access-gated)
    const exportBtn = config.exportBtnId ? document.getElementById(config.exportBtnId) : null;
    exportBtn?.addEventListener('click', () => {
        if (window.FluxyAccessGuard && !window.FluxyAccessGuard.requireExportAccess()) return;
        const rows = computed();
        if (!rows.length) return;
        const headers = columns.map(c => c.label);
        const body = rows.map(r => columns.map(c => escapeCsv(c.csv ? c.csv(r) : '')).join(','));
        const csv = [headers.map(escapeCsv).join(','), ...body].join('\n');
        const stamp = new Date().toISOString().slice(0, 10);
        downloadTextFile(`${config.csvFilename || 'records'}-${stamp}.csv`, csv);
        // brief success flash
        const original = exportBtn.textContent;
        exportBtn.textContent = 'Exported ✓';
        exportBtn.disabled = true;
        setTimeout(() => { exportBtn.textContent = original; exportBtn.disabled = false; }, 1400);
    });

    return {
        setRows(rows) { allRows = rows || []; apply(); },
        refresh: apply,
        getRows: () => allRows
    };
}
