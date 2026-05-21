// Report Builder — pure functions that turn period-scoped FluxyOS records into
// a single normalized `monthlyReportPack` model. Used by:
//   - reports.js (readiness panel + preview drawer)
//   - report-preview.js (full report viewer)
//   - CSV export (download bundle)
//   - report_exports metadata + export.create audit log payload
//
// Calculations are intentionally explainable and never throw on missing data —
// each section reports availability ("available" | "partial" | "unavailable")
// plus the limitations that drove that state. Production rendering must
// respect those states; no invented numbers, no NaN/Infinity surfaced to the
// user.

export const REVENUE_TYPES = new Set(['income', 'revenue', 'refund', 'pending_receivable']);
export const OPEX_TYPES = new Set(['expense', 'fee', 'tax', 'pending_payable']);

export const REPORT_SECTION_KEYS = [
    'executive_summary',
    'profit_loss',
    'period_comparison',
    'finance_predictability',
    'expense_breakdown',
    'bills_subscriptions',
    'report_confidence',
    'data_quality',
    'export_manifest'
];

export const REPORT_SECTION_LABELS = {
    executive_summary: 'Executive Summary',
    profit_loss: 'Profit & Loss Summary',
    period_comparison: 'Period Comparison',
    ytd_pl: 'Year-to-Date Profit & Loss',
    monthly_trend: 'Monthly Trend Breakdown',
    yoy_pl: 'YTD Profit & Loss Comparison',
    monthly_trend_comparison: 'Monthly Trend Comparison',
    finance_predictability: 'Finance Predictability Snapshot',
    expense_breakdown: 'Expense Breakdown',
    bills_subscriptions: 'Bills & Subscription Commitments',
    report_confidence: 'Report Confidence Method',
    data_quality: 'Data Quality & Cleanup',
    export_manifest: 'Export Manifest'
};

export const REPORT_PERIOD_MODES = ['monthly', 'last_month', 'quarter_to_date', 'year_to_date', 'custom'];
export const COMPARISON_MODES = ['none', 'previous_period', 'same_period_last_year', 'previous_year_to_date'];

// ---------- Date helpers ----------

export function dayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

export function parseDay(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function isoFromDayKey(key) {
    const d = parseDay(key);
    return d ? d.toISOString() : null;
}

export function timestampToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function periodLabel(period) {
    const start = parseDay(period?.start);
    const end = parseDay(period?.end);
    if (!start || !end) return '—';
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const sameMonth = start.getDate() === 1 &&
        end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (period.start === period.end) return fmt(start);
    return `${fmt(start)} – ${fmt(end)}`;
}

export function periodFilenameSlug(period) {
    const start = parseDay(period?.start);
    const end = parseDay(period?.end);
    if (!start || !end) return 'period';
    const sameMonth = start.getDate() === 1 &&
        end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) return `${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, '0')}`;
    return `${period.start.replace(/-/g, '_')}_to_${period.end.replace(/-/g, '_')}`;
}

function daysInMonth(year, monthZeroIdx) {
    return new Date(year, monthZeroIdx + 1, 0).getDate();
}

// Returns the same calendar day one year earlier, clamping Feb 29 to Feb 28
// when the previous year is not a leap year.
export function subtractOneYear(key) {
    const d = parseDay(key);
    if (!d) return null;
    const year = d.getFullYear() - 1;
    const month = d.getMonth();
    const day = Math.min(d.getDate(), daysInMonth(year, month));
    return dayKey(new Date(year, month, day));
}

export function sameMonthAndDayLastYear(key) {
    return subtractOneYear(key);
}

function monthStart(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthEnd(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }
function quarterStart(date) {
    const q = Math.floor(date.getMonth() / 3);
    return new Date(date.getFullYear(), q * 3, 1);
}

// Resolve a report scope from UI inputs into concrete current/comparison
// periods plus a generated title. Pure function — safe to call repeatedly.
//
// today defaults to the system clock; pass an explicit Date in tests.
export function resolveReportScope({
    reportPeriodMode = 'monthly',
    comparisonMode = 'none',
    selectedStartDate = null,
    selectedEndDate = null,
    today = new Date(),
    fiscalYearStart = null // reserved for future user fiscal year support
} = {}) {
    const todayDate = today instanceof Date ? today : new Date();
    const currentYear = todayDate.getFullYear();

    let currentStartKey;
    let currentEndKey;

    switch (reportPeriodMode) {
        case 'year_to_date': {
            const fy = fiscalYearStart ? parseDay(fiscalYearStart) : null;
            currentStartKey = fy ? dayKey(fy) : `${currentYear}-01-01`;
            currentEndKey = selectedEndDate || dayKey(todayDate);
            // Guard: end can't be before start.
            if (parseDay(currentEndKey) < parseDay(currentStartKey)) currentEndKey = currentStartKey;
            break;
        }
        case 'quarter_to_date': {
            currentStartKey = dayKey(quarterStart(todayDate));
            currentEndKey = selectedEndDate || dayKey(todayDate);
            break;
        }
        case 'last_month': {
            const ref = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
            currentStartKey = dayKey(monthStart(ref));
            currentEndKey = dayKey(monthEnd(ref));
            break;
        }
        case 'custom': {
            currentStartKey = selectedStartDate || dayKey(monthStart(todayDate));
            currentEndKey = selectedEndDate || dayKey(monthEnd(todayDate));
            break;
        }
        case 'monthly':
        default: {
            currentStartKey = dayKey(monthStart(todayDate));
            currentEndKey = dayKey(monthEnd(todayDate));
        }
    }

    const currentPeriod = {
        start_date: currentStartKey,
        end_date: currentEndKey,
        label: periodLabelForScope(reportPeriodMode, currentStartKey, currentEndKey)
    };

    let comparisonPeriod = null;
    let resolvedComparisonMode = comparisonMode;
    if (comparisonMode !== 'none') {
        comparisonPeriod = resolveComparisonPeriod(comparisonMode, currentStartKey, currentEndKey);
        if (!comparisonPeriod) {
            // If we can't resolve a comparison range, downgrade to none.
            resolvedComparisonMode = 'none';
        }
    }

    return {
        mode: reportPeriodMode,
        comparison_mode: resolvedComparisonMode,
        current_period: currentPeriod,
        comparison_period: comparisonPeriod,
        generated_title: composeReportTitle(reportPeriodMode, resolvedComparisonMode, currentPeriod),
        fiscal_year_basis: fiscalYearStart ? 'user_fiscal_year' : 'calendar_year'
    };
}

function resolveComparisonPeriod(mode, currentStartKey, currentEndKey) {
    const start = parseDay(currentStartKey);
    const end = parseDay(currentEndKey);
    if (!start || !end) return null;
    switch (mode) {
        case 'previous_period': {
            // Full calendar month → previous calendar month (so May 1–31
            // compares against Apr 1–30, not Mar 31–Apr 30).
            const sameMonth = start.getDate() === 1
                && end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()
                && start.getMonth() === end.getMonth()
                && start.getFullYear() === end.getFullYear();
            if (sameMonth) {
                const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
                const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
                return labelledPeriod('previous_period', dayKey(prevStart), dayKey(prevEnd));
            }
            const days = Math.round((end - start) / 86400000) + 1;
            const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
            const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - (days - 1));
            return labelledPeriod('previous_period', dayKey(prevStart), dayKey(prevEnd));
        }
        case 'same_period_last_year': {
            const prevStart = subtractOneYear(currentStartKey);
            const prevEnd = subtractOneYear(currentEndKey);
            if (!prevStart || !prevEnd) return null;
            return labelledPeriod('same_period_last_year', prevStart, prevEnd);
        }
        case 'previous_year_to_date': {
            const prevYear = start.getFullYear() - 1;
            const prevStart = `${prevYear}-01-01`;
            const prevEnd = subtractOneYear(currentEndKey);
            if (!prevEnd) return null;
            return labelledPeriod('previous_year_to_date', prevStart, prevEnd);
        }
        default:
            return null;
    }
}

function labelledPeriod(mode, startKey, endKey) {
    const start = parseDay(startKey);
    return {
        start_date: startKey,
        end_date: endKey,
        label: periodLabelForScope(mode, startKey, endKey)
    };
}

function periodLabelForScope(mode, startKey, endKey) {
    const start = parseDay(startKey);
    if (!start) return periodLabel({ start: startKey, end: endKey });
    if (mode === 'year_to_date' || mode === 'previous_year_to_date') return `${start.getFullYear()} YTD`;
    if (mode === 'quarter_to_date') {
        const q = Math.floor(start.getMonth() / 3) + 1;
        return `${start.getFullYear()} Q${q} to date`;
    }
    return periodLabel({ start: startKey, end: endKey });
}

function composeReportTitle(mode, comparisonMode, currentPeriod) {
    const start = parseDay(currentPeriod.start_date);
    const year = start ? start.getFullYear() : '';
    if (mode === 'year_to_date') {
        if (comparisonMode === 'previous_year_to_date') return `${year} YTD Year-on-Year Financial Report`;
        if (comparisonMode === 'same_period_last_year') return `${year} YTD Year-on-Year Financial Report`;
        return `${year} Year-to-Date Financial Report`;
    }
    if (mode === 'quarter_to_date') {
        const q = Math.floor(start.getMonth() / 3) + 1;
        if (comparisonMode !== 'none') return `${year} Q${q} Year-on-Year Financial Report`;
        return `${year} Q${q} Quarter-to-Date Financial Report`;
    }
    if (mode === 'custom') {
        if (comparisonMode === 'same_period_last_year') return 'Custom Year-on-Year Financial Report';
        if (comparisonMode === 'previous_period') return 'Custom Period Financial Report';
        return 'Custom Period Financial Report';
    }
    // monthly + last_month
    const periodHuman = periodLabel({ start: currentPeriod.start_date, end: currentPeriod.end_date });
    if (comparisonMode === 'previous_period') return `${periodHuman} Financial Report (vs Previous Period)`;
    if (comparisonMode === 'same_period_last_year') return `${periodHuman} Year-on-Year Financial Report`;
    return `${periodHuman} Financial Report`;
}

export function formatRupiah(n) {
    const value = Number(n || 0);
    return `Rp ${Math.abs(value).toLocaleString('id-ID')}`;
}

export function formatRupiahCompact(n) {
    const value = Math.abs(Number(n || 0));
    if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(1)}K`;
    return `Rp ${value.toLocaleString('id-ID')}`;
}

export function formatPercent(value, digits = 1) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return `${Number(value).toFixed(digits)}%`;
}

// ---------- Section calculations ----------

export function calculateProfitLoss(transactions = []) {
    let revenue = 0;
    let opex = 0;
    let revenueRecords = 0;
    let opexRecords = 0;
    transactions.forEach(tx => {
        const type = String(tx.type || '').toLowerCase();
        const amount = Number(tx.amount || 0);
        if (REVENUE_TYPES.has(type)) {
            revenue += amount;
            revenueRecords += 1;
        } else if (OPEX_TYPES.has(type)) {
            opex += Math.abs(amount);
            opexRecords += 1;
        }
    });

    const grossMargin = revenue > 0 ? ((revenue - opex) / revenue) * 100 : 0;
    const netResult = revenue - opex;

    return {
        revenue,
        opex,
        grossMargin,
        netResult,
        rows: [
            { metric: 'Revenue', amount: revenue, basis: 'Income + selected receivable records', source_records: `${revenueRecords} records` },
            { metric: 'OpEx', amount: opex, basis: 'Expense + fee + tax + selected payable records', source_records: `${opexRecords} records` },
            { metric: 'Gross Margin', amount: grossMargin, basis: '(Revenue - OpEx) / Revenue', source_records: 'Calculated', is_percent: true },
            { metric: 'Net Result', amount: netResult, basis: 'Revenue - OpEx', source_records: 'Calculated' }
        ],
        chart: [
            { name: 'Revenue', value: revenue, color: 'navy' },
            { name: 'OpEx', value: opex, color: 'orange' },
            { name: 'Net Result', value: netResult, color: 'green' }
        ],
        calculation_note: 'Gross Margin = (Revenue - OpEx) / Revenue. If revenue is zero, FluxyOS shows 0% — never NaN or Infinity.',
        interpretation: revenue === 0
            ? 'No revenue recorded in this period. Add income transactions to enable margin analysis.'
            : (netResult >= 0
                ? 'Period is profitable based on FluxyOS records. External handoff should still reconcile against bank/payment provider data.'
                : 'Period closed at a loss based on FluxyOS records. Review the largest expense categories before external handoff.')
    };
}

export function calculatePeriodComparison(currentPL, previousPL) {
    if (!previousPL || (previousPL.revenue === 0 && previousPL.opex === 0)) {
        return {
            status: 'unavailable',
            previous_period: null,
            current_period: currentPL,
            rows: [],
            limitations: ['Previous period records not found.']
        };
    }

    const delta = (curr, prev) => {
        if (prev === 0) return curr === 0 ? 0 : null; // null = not comparable
        return ((curr - prev) / prev) * 100;
    };

    const marginDelta = currentPL.grossMargin - previousPL.grossMargin;

    return {
        status: 'available',
        previous_period: previousPL,
        current_period: currentPL,
        rows: [
            { metric: 'Revenue', previous: previousPL.revenue, current: currentPL.revenue, change: delta(currentPL.revenue, previousPL.revenue), interpretation: deltaInterpretation(delta(currentPL.revenue, previousPL.revenue), 'Revenue') },
            { metric: 'OpEx', previous: previousPL.opex, current: currentPL.opex, change: delta(currentPL.opex, previousPL.opex), inverse: true, interpretation: deltaInterpretation(delta(currentPL.opex, previousPL.opex), 'OpEx', true) },
            { metric: 'Net Result', previous: previousPL.netResult, current: currentPL.netResult, change: delta(currentPL.netResult, previousPL.netResult), interpretation: deltaInterpretation(delta(currentPL.netResult, previousPL.netResult), 'Net Result') },
            { metric: 'Gross Margin', previous: previousPL.grossMargin, current: currentPL.grossMargin, change_points: marginDelta, is_percent: true, interpretation: marginDelta > 0 ? 'Margin expanded' : (marginDelta < 0 ? 'Margin compressed' : 'Margin held') }
        ],
        limitations: []
    };
}

function deltaInterpretation(delta, label, inverseGood = false) {
    if (delta === null) return `Previous period had no ${label.toLowerCase()} to compare.`;
    if (Math.abs(delta) < 0.1) return `${label} held flat`;
    const grew = delta > 0;
    if (inverseGood) return grew ? `${label} grew` : `${label} fell`;
    return grew ? `${label} improved` : `${label} declined`;
}

export function previousPeriodRange(period) {
    const start = parseDay(period.start);
    const end = parseDay(period.end);
    if (!start || !end) return null;
    const days = Math.round((end - start) / 86400000) + 1;
    // If the current period is a full calendar month, compare to the previous
    // calendar month exactly. Otherwise compare to the same-length window
    // ending the day before the current start.
    const sameMonth = start.getDate() === 1 &&
        end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate() &&
        start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
        const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
        const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
        return { start: dayKey(prevStart), end: dayKey(prevEnd) };
    }
    const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - (days - 1));
    return { start: dayKey(prevStart), end: dayKey(prevEnd) };
}

export function calculateFinancePredictability(currentPL, recurringRevenue) {
    const monthlyRunRate = currentPL.revenue;
    const annualizedRunRate = monthlyRunRate * 12;

    // ARR requires explicit recurring revenue classification. FluxyOS does not
    // yet tag transactions as recurring vs one-time, so ARR is unavailable
    // unless a positive recurring revenue value is supplied.
    let arr;
    if (recurringRevenue === undefined || recurringRevenue === null) {
        arr = { status: 'unavailable', value: null, basis: 'recurring_revenue_only', limitation: 'No recurring revenue classification detected in FluxyOS records.' };
    } else if (recurringRevenue === 0) {
        arr = { status: 'unavailable', value: 0, basis: 'recurring_revenue_only', limitation: 'Recurring revenue is currently 0 — classify recurring contracts/subscriptions to enable ARR.' };
    } else {
        arr = { status: 'partial', value: recurringRevenue * 12, basis: 'recurring_revenue_only', limitation: 'Recurring revenue classification is not yet enforced — value is a directional estimate.' };
    }

    const conservative = Math.round(monthlyRunRate * 11);          // skip a month for conservatism
    const currentRunRateOutlook = Math.round(monthlyRunRate * 12);
    const growthCase = Math.round(monthlyRunRate * 12 * 1.04);

    const yearEndOpExOutlook = Math.round(currentPL.opex * 12);
    const yearEndNetLow = conservative - yearEndOpExOutlook;
    const yearEndNetHigh = growthCase - yearEndOpExOutlook;

    const limitations = [];
    if (monthlyRunRate === 0) limitations.push('Current month revenue is zero — run-rate projections are not meaningful.');
    if (recurringRevenue === undefined || recurringRevenue === null) limitations.push('ARR unavailable until recurring revenue is classified.');

    const status = monthlyRunRate === 0 ? 'unavailable' : (limitations.length ? 'partial' : 'available');

    return {
        status,
        monthly_revenue_run_rate: monthlyRunRate,
        annualized_revenue_run_rate: annualizedRunRate,
        arr,
        year_end_revenue_outlook: {
            conservative,
            current_run_rate: currentRunRateOutlook,
            growth_case: growthCase
        },
        year_end_net_result_outlook: {
            low: yearEndNetLow,
            high: yearEndNetHigh
        },
        assumptions: [
            { metric: 'Revenue run rate', basis: 'Current period revenue × 12', limitation: 'Sensitive to one-time revenue spikes' },
            { metric: 'ARR', basis: 'Active recurring revenue × 12', limitation: 'Only valid when recurring revenue is classified' },
            { metric: 'Year-end revenue', basis: 'Current run-rate + scenario range', limitation: 'Not guaranteed' },
            { metric: 'Year-end net result', basis: 'Projected revenue − projected OpEx', limitation: 'Excludes tax and accounting adjustments' }
        ],
        limitations
    };
}

// ---------- YTD / monthly trend / YoY comparison ----------

function monthBucketKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthBucketLabel(year, monthZeroIdx) {
    return new Date(year, monthZeroIdx, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Returns the count of calendar months covered by the period, inclusive on
// both ends. e.g. Jan 1 → May 21 = 5.
function elapsedMonthsInPeriod(period) {
    const start = parseDay(period?.start_date || period?.start);
    const end = parseDay(period?.end_date || period?.end);
    if (!start || !end) return 0;
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
}

function isCurrentMonthPartial(period, today = new Date()) {
    const end = parseDay(period?.end_date || period?.end);
    if (!end) return false;
    const endOfEndMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    return end.getFullYear() === today.getFullYear()
        && end.getMonth() === today.getMonth()
        && end.getDate() < endOfEndMonth.getDate();
}

// Build a month-by-month trend across the period. transactions drive revenue/
// opex/record-count; bills + subscriptions only contribute to record counts.
export function calculateMonthlyTrend(transactions = [], bills = [], subscriptions = [], scope) {
    const period = scope?.current_period || scope; // accept either shape
    const startKey = period?.start_date || period?.start;
    const endKey = period?.end_date || period?.end;
    const start = parseDay(startKey);
    const end = parseDay(endKey);
    if (!start || !end) return [];

    const buckets = new Map();
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const stop = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= stop) {
        const key = monthBucketKey(cur);
        buckets.set(key, {
            month: key,
            monthLabel: monthBucketLabel(cur.getFullYear(), cur.getMonth()),
            revenue: 0,
            opex: 0,
            recordCount: 0,
            missingReceipts: 0,
            billCount: 0,
            subCount: 0
        });
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    transactions.forEach(tx => {
        const d = timestampToDate(tx.timestamp);
        if (!d) return;
        const bucket = buckets.get(monthBucketKey(d));
        if (!bucket) return;
        const type = String(tx.type || '').toLowerCase();
        const amount = Number(tx.amount || 0);
        if (REVENUE_TYPES.has(type)) bucket.revenue += amount;
        else if (OPEX_TYPES.has(type)) bucket.opex += Math.abs(amount);
        bucket.recordCount += 1;
        if (tx.status === 'Missing Receipt') bucket.missingReceipts += 1;
    });
    bills.forEach(b => {
        const d = timestampToDate(b.timestamp);
        if (!d) return;
        const bucket = buckets.get(monthBucketKey(d));
        if (bucket) bucket.billCount += 1;
    });
    subscriptions.forEach(s => {
        const d = timestampToDate(s.timestamp);
        if (!d) return;
        const bucket = buckets.get(monthBucketKey(d));
        if (bucket) bucket.subCount += 1;
    });

    return Array.from(buckets.values()).map(m => ({
        ...m,
        netResult: m.revenue - m.opex,
        grossMargin: m.revenue > 0 ? ((m.revenue - m.opex) / m.revenue) * 100 : 0,
        warnings: m.missingReceipts
    }));
}

// YTD aggregate metrics — extends profit_loss with averages, best/worst,
// and partial-month flag. trend can be passed in to avoid recomputation.
export function calculateYtdSummary(transactions = [], scope, trend = null) {
    const pl = calculateProfitLoss(transactions);
    const monthlyTrend = trend || calculateMonthlyTrend(transactions, [], [], scope);
    const elapsed = Math.max(1, elapsedMonthsInPeriod(scope?.current_period || scope));
    const monthsWithRevenue = monthlyTrend.filter(m => m.revenue > 0);

    let bestRevenueMonth = null;
    let worstNetMonth = null;
    monthlyTrend.forEach(m => {
        if (!bestRevenueMonth || m.revenue > bestRevenueMonth.revenue) bestRevenueMonth = m;
        if (!worstNetMonth || m.netResult < worstNetMonth.netResult) worstNetMonth = m;
    });

    return {
        ...pl,
        elapsedMonths: elapsed,
        avgMonthlyRevenue: pl.revenue / elapsed,
        avgMonthlyOpex: pl.opex / elapsed,
        avgMonthlyNetResult: pl.netResult / elapsed,
        bestRevenueMonth: bestRevenueMonth && bestRevenueMonth.revenue > 0 ? bestRevenueMonth : null,
        worstNetMonth: worstNetMonth && monthsWithRevenue.length > 0 ? worstNetMonth : null,
        isPartialCurrentMonth: isCurrentMonthPartial(scope?.current_period || scope)
    };
}

function pctChange(current, previous) {
    if (previous === 0 || previous === null || previous === undefined) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function pctChangeInterpretation(metric, pct, { inverseGood = false } = {}) {
    if (pct === null || pct === undefined) return previousZeroInterpretation(metric);
    if (Math.abs(pct) < 0.1) return `${metric} held flat`;
    const grew = pct > 0;
    if (inverseGood) return grew ? `${metric} grew` : `${metric} fell`;
    return grew ? `${metric} improved` : `${metric} declined`;
}

function previousZeroInterpretation(metric) {
    return `Previous period had no ${metric.toLowerCase()} to compare.`;
}

// YoY comparison between two precomputed P&L summaries. Status:
//   available  → previous-year records exist and produce meaningful values
//   partial    → some metrics comparable, others use N/A
//   unavailable → no previous-year records at all
export function calculateYoYComparison(currentSummary, previousSummary) {
    if (!previousSummary) {
        return { status: 'unavailable', rows: [], limitations: ['Previous-year records not found.'] };
    }
    const totalPrev = (previousSummary.revenue || 0) + (previousSummary.opex || 0);
    if (totalPrev === 0) {
        return { status: 'unavailable', rows: [], limitations: ['Previous-year records not found.'] };
    }

    const marginPointChange = (currentSummary.grossMargin || 0) - (previousSummary.grossMargin || 0);
    const limitations = [];
    let anyNa = false;

    const rows = [
        ytdComparisonRow('Revenue', currentSummary.revenue, previousSummary.revenue),
        ytdComparisonRow('OpEx', currentSummary.opex, previousSummary.opex, { inverseGood: true }),
        ytdComparisonRow('Net Result', currentSummary.netResult, previousSummary.netResult),
        {
            metric: 'Gross Margin',
            current: currentSummary.grossMargin,
            previous: previousSummary.grossMargin,
            change_points: marginPointChange,
            is_percent: true,
            interpretation: marginPointChange > 0 ? 'Margin expanded' : (marginPointChange < 0 ? 'Margin compressed' : 'Margin held')
        }
    ];

    if (typeof currentSummary.avgMonthlyRevenue === 'number' && typeof previousSummary.avgMonthlyRevenue === 'number') {
        rows.push(ytdComparisonRow('Average Monthly Revenue', currentSummary.avgMonthlyRevenue, previousSummary.avgMonthlyRevenue));
        rows.push(ytdComparisonRow('Average Monthly OpEx', currentSummary.avgMonthlyOpex, previousSummary.avgMonthlyOpex, { inverseGood: true }));
    }

    rows.forEach(r => { if (r.change_pct === null && !r.is_percent) anyNa = true; });
    if (anyNa) limitations.push('Some metrics show N/A because the previous-year value is zero.');

    return {
        status: limitations.length ? 'partial' : 'available',
        rows,
        limitations
    };
}

function ytdComparisonRow(metric, current, previous, { inverseGood = false } = {}) {
    const change = (current || 0) - (previous || 0);
    const change_pct = pctChange(current || 0, previous || 0);
    return {
        metric,
        current: current || 0,
        previous: previous || 0,
        change,
        change_pct,
        is_percent: false,
        interpretation: pctChangeInterpretation(metric, change_pct, { inverseGood })
    };
}

// Aligns two monthly trends by index (so month N of current period aligns
// with month N of comparison period). Useful for YoY YTD comparison.
export function calculateMonthlyTrendComparison(currentTrend = [], previousTrend = []) {
    const limitations = [];
    if (!previousTrend.length) return { status: 'unavailable', months: [], limitations: ['No previous-year monthly trend data found.'] };

    const length = Math.max(currentTrend.length, previousTrend.length);
    const months = [];
    for (let i = 0; i < length; i++) {
        const cur = currentTrend[i] || null;
        const prev = previousTrend[i] || null;
        months.push({
            index: i,
            currentLabel: cur?.monthLabel || null,
            previousLabel: prev?.monthLabel || null,
            current: cur,
            previous: prev,
            revenue_change_pct: cur && prev ? pctChange(cur.revenue, prev.revenue) : null
        });
        if (!cur || !prev) limitations.push(`Month ${i + 1} comparison is partial — missing one side.`);
    }
    const dedupedLimitations = Array.from(new Set(limitations));
    return {
        status: dedupedLimitations.length ? 'partial' : 'available',
        months,
        limitations: dedupedLimitations
    };
}

export function calculateExpenseBreakdown(transactions = [], subscriptions = []) {
    const opexTxs = transactions.filter(t => OPEX_TYPES.has(String(t.type || '').toLowerCase()));
    const all = [
        ...opexTxs.map(t => ({ ...t, _source: 'transactions' })),
        ...subscriptions.map(s => ({ ...s, _source: 'subscriptions' }))
    ];

    const totalSpend = all.reduce((sum, r) => sum + Math.abs(Number(r.amount || 0)), 0);

    const categoryMap = new Map();
    all.forEach(r => {
        const cat = r.category || 'Uncategorized';
        const entry = categoryMap.get(cat) || { category: cat, amount: 0, count: 0, missing_receipts: 0 };
        entry.amount += Math.abs(Number(r.amount || 0));
        entry.count += 1;
        if (r._source === 'transactions' && r.status === 'Missing Receipt') entry.missing_receipts += 1;
        categoryMap.set(cat, entry);
    });
    const categories = Array.from(categoryMap.values())
        .map(c => ({ ...c, pct: totalSpend > 0 ? Math.round((c.amount / totalSpend) * 100) : 0 }))
        .sort((a, b) => b.amount - a.amount);

    const vendorMap = new Map();
    all.forEach(r => {
        const vendor = r.vendor_name || 'Unknown vendor';
        const entry = vendorMap.get(vendor) || { vendor, amount: 0, category: r.category || 'Uncategorized', count: 0, missing_receipts: 0 };
        entry.amount += Math.abs(Number(r.amount || 0));
        entry.count += 1;
        if (r._source === 'transactions' && r.status === 'Missing Receipt') entry.missing_receipts += 1;
        vendorMap.set(vendor, entry);
    });
    const top_vendors = Array.from(vendorMap.values())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6);

    const topCategory = categories[0];
    const interpretation = topCategory
        ? `${topCategory.category} is the largest OpEx driver. Review usage and missing receipts before external handoff.`
        : 'No expense records in the selected period.';

    return {
        categories,
        top_vendors,
        total_spend: totalSpend,
        interpretation,
        csv_columns: ['Category', 'Vendor', 'Amount', 'Record Count']
    };
}

export function calculateBillsSubscriptions(bills = [], subscriptions = [], periodEndKey) {
    const periodEnd = parseDay(periodEndKey) || new Date();

    const upcomingBills = bills.filter(b => {
        const due = timestampToDate(b.due_date);
        return due && due >= new Date();
    }).length;

    const overdueBills = bills.filter(b => {
        const due = timestampToDate(b.due_date);
        return due && due < new Date() && b.status !== 'Completed';
    }).length;

    const activeSubs = subscriptions.length;

    const pendingPayableTotal = bills.reduce((sum, b) => sum + Math.abs(Number(b.amount || 0)), 0)
        + subscriptions.reduce((sum, s) => sum + Math.abs(Number(s.amount || 0)), 0);

    const now = new Date();
    const inWindow = (b, days) => {
        const due = timestampToDate(b.due_date);
        if (!due) return false;
        const diff = (due - now) / 86400000;
        return diff >= 0 && diff <= days;
    };
    const sumInWindow = (days) => bills.reduce((sum, b) => sum + (inWindow(b, days) ? Math.abs(Number(b.amount || 0)) : 0), 0);

    return {
        upcoming_bills_count: upcomingBills,
        overdue_bills_count: overdueBills,
        active_subscriptions_count: activeSubs,
        pending_payable_total: pendingPayableTotal,
        obligation_windows: [
            { window: 'Next 7 days', amount: sumInWindow(7), meaning: 'Near-term pressure' },
            { window: 'Next 14 days', amount: sumInWindow(14), meaning: 'Short-term payable view' },
            { window: 'Next 30 days', amount: sumInWindow(30), meaning: 'Total payable proxy' }
        ],
        interpretation: pendingPayableTotal > 0
            ? 'Upcoming obligations should be reviewed before committing to new spend. This is a cash pressure proxy, not a real bank-balance forecast.'
            : 'No outstanding bill or subscription obligations recorded for this period.',
        csv_columns: ['Vendor', 'Category', 'Amount', 'Status', 'Due Date', 'Record ID']
    };
}

export function calculateDataQuality(transactions = [], bills = [], subscriptions = []) {
    const missingReceipts = transactions.filter(t => t.status === 'Missing Receipt').length;
    const billsWithoutDueDate = bills.filter(b => !b.due_date).length;
    const subsWithoutRenewal = subscriptions.filter(s => !s.renewal_date).length;

    const warnings = [];
    if (missingReceipts) warnings.push({ issue: 'Missing receipts', count: missingReceipts, severity: 'High', impact: 'Expense verification is incomplete', recommended_action: 'Upload or attach receipts' });
    if (billsWithoutDueDate) warnings.push({ issue: 'Bills without due date', count: billsWithoutDueDate, severity: 'Medium', impact: 'Payable timing may be incomplete', recommended_action: 'Add due dates' });
    if (subsWithoutRenewal) warnings.push({ issue: 'Subscriptions without renewal date', count: subsWithoutRenewal, severity: 'Medium', impact: 'Recurring forecast may be incomplete', recommended_action: 'Add renewal date' });

    return {
        warnings,
        warning_counts: {
            missing_receipts: missingReceipts,
            bills_without_due_date: billsWithoutDueDate,
            subscriptions_without_renewal: subsWithoutRenewal
        },
        recommended_cleanup: warnings.length
            ? 'Resolve missing receipts first, then review bills without due dates before sending the report externally.'
            : 'No data quality warnings for the selected period.'
    };
}

export function calculateReportConfidence(sourceData, dataQuality) {
    const transactions = sourceData.transactions || [];
    const bills = sourceData.bills || [];
    const subscriptions = sourceData.subscriptions || [];

    const receiptCoverage = transactions.length === 0
        ? null
        : Math.round(((transactions.length - dataQuality.warning_counts.missing_receipts) / transactions.length) * 100);

    const dueDateCompleteness = bills.length === 0
        ? null
        : Math.round(((bills.length - dataQuality.warning_counts.bills_without_due_date) / bills.length) * 100);

    const renewalDateCompleteness = subscriptions.length === 0
        ? null
        : Math.round(((subscriptions.length - dataQuality.warning_counts.subscriptions_without_renewal) / subscriptions.length) * 100);

    // Ledger completeness uses receipt coverage as a proxy until we have a
    // richer notion of "ledger completeness" (e.g., reconciled vs unreconciled).
    const ledgerCompleteness = receiptCoverage;

    // Connected source coverage: Revenue Sync is not connected in MVP, so we
    // cap source coverage at 80% until that integration ships.
    const sourceCoverage = 80;

    const breakdown = [
        { area: 'Receipt coverage', value: receiptCoverage, finding: receiptCoverage === null ? 'No transactions in period' : `${dataQuality.warning_counts.missing_receipts} transactions missing receipts`, read: receiptCoverage === null ? 'No data' : (receiptCoverage >= 90 ? 'Good' : (receiptCoverage >= 70 ? 'Caution' : 'Needs cleanup')) },
        { area: 'Due-date completeness', value: dueDateCompleteness, finding: dueDateCompleteness === null ? 'No bills in period' : `${dataQuality.warning_counts.bills_without_due_date} bills missing due date`, read: dueDateCompleteness === null ? 'No data' : (dueDateCompleteness >= 90 ? 'Good' : 'Caution') },
        { area: 'Subscription renewal completeness', value: renewalDateCompleteness, finding: renewalDateCompleteness === null ? 'No subscriptions in period' : `${dataQuality.warning_counts.subscriptions_without_renewal} subscriptions missing renewal date`, read: renewalDateCompleteness === null ? 'No data' : (renewalDateCompleteness >= 90 ? 'Good' : 'Caution') },
        { area: 'Connected source coverage', value: sourceCoverage, finding: 'Revenue Sync not connected', read: 'Limitation' },
        { area: 'Audit trail', value: 100, finding: 'export.create is logged on every confirmed export', read: 'Good' }
    ];

    const present = breakdown.filter(b => typeof b.value === 'number');
    const weights = { 'Receipt coverage': 0.30, 'Due-date completeness': 0.20, 'Subscription renewal completeness': 0.15, 'Connected source coverage': 0.15, 'Audit trail': 0.20 };
    let totalWeight = 0;
    let weighted = 0;
    present.forEach(b => {
        const w = weights[b.area] || 0;
        totalWeight += w;
        weighted += (b.value || 0) * w;
    });
    const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

    let label;
    if (transactions.length + bills.length + subscriptions.length === 0) label = 'No data';
    else if (score >= 90) label = 'Ready';
    else if (score >= 70) label = 'Usable with warnings';
    else label = 'Needs cleanup';

    return {
        score,
        label,
        explanation: 'Report Confidence is based on source coverage and cleanup completeness, not financial performance.',
        breakdown,
        formula_note: 'Confidence score is a product-readiness indicator. It is not an accounting assurance opinion.',
        receiptCoverage,
        dueDateCompleteness,
        renewalDateCompleteness,
        ledgerCompleteness
    };
}

export function buildExportManifest(reportData) {
    const sources = reportData.export_manifest_inputs || {};
    return {
        included_sources: [
            `${sources.transactionsCount || 0} transactions`,
            `${sources.billsCount || 0} bills`,
            `${sources.subscriptionsCount || 0} subscriptions`
        ],
        excluded_or_limited: [
            'Revenue Sync not connected',
            'No bank balance source',
            'Cash pressure is proxy only',
            ...(sources.warningTotal ? [`${sources.warningTotal} data quality warnings`] : [])
        ],
        source_files: sources.fileSlugs || [],
        audit: {
            action: 'export.create',
            audit_ref: sources.audit_ref || '',
            generated_by: sources.generated_by || '',
            generated_at: sources.generated_at || ''
        }
    };
}

// ---------- Top-level builder ----------

export function buildMonthlyReportPack({
    userId,
    userDisplayName,
    businessName,
    period,
    scope = null,
    transactions = [],
    bills = [],
    subscriptions = [],
    previousPeriodTransactions = null,
    previousPeriodBills = null,
    previousPeriodSubscriptions = null,
    recurringRevenue = null
}) {
    // Back-compat: callers may pass `period` only. Derive a monthly scope if
    // `scope` is not supplied so existing flows keep working.
    const reportScope = scope || resolveReportScope({
        reportPeriodMode: 'monthly',
        comparisonMode: previousPeriodTransactions ? 'previous_period' : 'none',
        selectedStartDate: period?.start,
        selectedEndDate: period?.end
    });
    const currentPeriodForBuilder = period || { start: reportScope.current_period.start_date, end: reportScope.current_period.end_date };
    const isYtdMode = reportScope.mode === 'year_to_date' || reportScope.mode === 'quarter_to_date';
    const isYoYComparison = reportScope.comparison_mode === 'previous_year_to_date' || reportScope.comparison_mode === 'same_period_last_year';

    const profit_loss = calculateProfitLoss(transactions);
    const previousPL = Array.isArray(previousPeriodTransactions)
        ? calculateProfitLoss(previousPeriodTransactions)
        : null;

    // Monthly trend + YTD summary apply to YTD/QTD modes.
    const monthly_trend = isYtdMode
        ? calculateMonthlyTrend(transactions, bills, subscriptions, reportScope)
        : null;
    const ytd_summary = isYtdMode
        ? calculateYtdSummary(transactions, reportScope, monthly_trend)
        : null;

    // YoY comparison reuses YTD summaries on both sides.
    let yoy_comparison = null;
    let monthly_trend_comparison = null;
    if (isYoYComparison && previousPeriodTransactions !== null) {
        const previousScope = { current_period: reportScope.comparison_period };
        const previousMonthlyTrend = calculateMonthlyTrend(previousPeriodTransactions || [], previousPeriodBills || [], previousPeriodSubscriptions || [], previousScope);
        const previousYtdSummary = calculateYtdSummary(previousPeriodTransactions || [], previousScope, previousMonthlyTrend);
        const currentSummaryForCompare = isYtdMode
            ? ytd_summary
            : { ...profit_loss, avgMonthlyRevenue: profit_loss.revenue, avgMonthlyOpex: profit_loss.opex };
        yoy_comparison = calculateYoYComparison(currentSummaryForCompare, previousYtdSummary);
        monthly_trend_comparison = calculateMonthlyTrendComparison(monthly_trend || calculateMonthlyTrend(transactions, [], [], reportScope), previousMonthlyTrend);
    }

    const period_comparison = (!isYoYComparison && previousPL)
        ? calculatePeriodComparison(profit_loss, previousPL)
        : { status: 'unavailable', previous_period: null, current_period: profit_loss, rows: [], limitations: previousPL === null ? ['No comparison data fetched.'] : [] };

    const finance_predictability = calculateFinancePredictability(
        isYtdMode && ytd_summary
            ? { ...profit_loss, revenue: ytd_summary.avgMonthlyRevenue, opex: ytd_summary.avgMonthlyOpex, grossMargin: profit_loss.grossMargin, netResult: profit_loss.netResult }
            : profit_loss,
        recurringRevenue
    );
    // Attach a previous-year reference on Finance Predictability when we have
    // comparison data. Lets the renderer show a "Last year actual" callout
    // for context.
    if (previousPL && reportScope.comparison_mode !== 'none') {
        finance_predictability.previous_reference = {
            label: reportScope.comparison_period?.label || 'Previous period',
            annualized_revenue: previousPL.revenue * (reportScope.comparison_period
                ? (12 / Math.max(1, elapsedMonthsInPeriod(reportScope.comparison_period)))
                : 1),
            actual_revenue: previousPL.revenue,
            actual_opex: previousPL.opex,
            actual_net_result: previousPL.netResult
        };
    }

    const expense_breakdown = calculateExpenseBreakdown(transactions, subscriptions);
    // When comparison data is available, enrich each category and vendor row
    // with a previous-period value + change%. Renderers gate on
    // expense_breakdown.has_comparison.
    if (reportScope.comparison_mode !== 'none' && Array.isArray(previousPeriodTransactions)) {
        const previousBreakdown = calculateExpenseBreakdown(
            previousPeriodTransactions || [],
            Array.isArray(previousPeriodSubscriptions) ? previousPeriodSubscriptions : []
        );
        expense_breakdown.has_comparison = true;
        expense_breakdown.comparison_label = reportScope.comparison_period?.label || 'Previous';
        expense_breakdown.categories = expense_breakdown.categories.map(cur => {
            const prev = previousBreakdown.categories.find(p => p.category === cur.category);
            const previousAmount = prev ? prev.amount : 0;
            return {
                ...cur,
                previous_amount: previousAmount,
                change_pct: previousAmount === 0 ? null : ((cur.amount - previousAmount) / Math.abs(previousAmount)) * 100
            };
        });
        expense_breakdown.top_vendors = expense_breakdown.top_vendors.map(cur => {
            const prev = previousBreakdown.top_vendors.find(p => p.vendor === cur.vendor);
            const previousAmount = prev ? prev.amount : 0;
            return {
                ...cur,
                previous_amount: previousAmount,
                change_pct: previousAmount === 0 ? null : ((cur.amount - previousAmount) / Math.abs(previousAmount)) * 100
            };
        });
    }
    const bills_subscriptions = calculateBillsSubscriptions(bills, subscriptions, reportScope.current_period.end_date);
    const data_quality = calculateDataQuality(transactions, bills, subscriptions);
    const report_confidence_method = calculateReportConfidence(
        { transactions, bills, subscriptions },
        data_quality
    );

    const totalRecords = transactions.length + bills.length + subscriptions.length;
    const generatedAtIso = new Date().toISOString();

    const sourceFiles = sourceFilesForScope(reportScope);

    const warningTotal = data_quality.warning_counts.missing_receipts +
        data_quality.warning_counts.bills_without_due_date +
        data_quality.warning_counts.subscriptions_without_renewal;

    const export_manifest = buildExportManifest({
        export_manifest_inputs: {
            transactionsCount: transactions.length,
            billsCount: bills.length,
            subscriptionsCount: subscriptions.length,
            warningTotal,
            fileSlugs: sourceFiles,
            generated_by: userDisplayName || '',
            generated_at: generatedAtIso
        }
    });

    const periodHumanLabel = reportScope.current_period.label || periodLabel(currentPeriodForBuilder);
    const summaryText = composeExecutiveSummary({
        scope: reportScope,
        totalRecords,
        profit_loss,
        ytd_summary,
        yoy_comparison,
        expense_breakdown,
        warningTotal,
        periodHumanLabel
    });

    const key_takeaways = isYoYComparison && yoy_comparison?.status !== 'unavailable'
        ? buildYoyKeyTakeaways({ yoy_comparison, monthly_trend, monthly_trend_comparison, warningTotal })
        : (isYtdMode
            ? buildYtdKeyTakeaways({ ytd_summary, expense_breakdown, monthly_trend, warningTotal })
            : buildKeyTakeaways({ profit_loss, expense_breakdown, bills_subscriptions, data_quality, warningTotal }));

    const sectionsAvailability = computeSectionsAvailability({
        scope: reportScope,
        totalRecords,
        period_comparison,
        yoy_comparison,
        monthly_trend_comparison,
        monthly_trend,
        finance_predictability,
        data_quality,
        report_confidence_method
    });

    return {
        report_identity: {
            report_type: 'monthly_report_pack',
            report_title: reportScope.generated_title,
            business_name: businessName || '',
            period_start: reportScope.current_period.start_date,
            period_end: reportScope.current_period.end_date,
            period_label: periodHumanLabel,
            generated_by_uid: userId,
            generated_by_name: userDisplayName || '',
            generated_at: generatedAtIso,
            status: 'draft_management_report',
            disclaimer: 'Management report generated from FluxyOS operational records. Not audited financial statements.'
        },
        report_scope: reportScope,
        executive_summary: {
            revenue: (isYtdMode && ytd_summary) ? ytd_summary.revenue : profit_loss.revenue,
            opex: (isYtdMode && ytd_summary) ? ytd_summary.opex : profit_loss.opex,
            net_result: (isYtdMode && ytd_summary) ? ytd_summary.netResult : profit_loss.netResult,
            gross_margin: profit_loss.grossMargin,
            report_confidence: report_confidence_method.score,
            summary_text: summaryText,
            record_counts_revenue_side: profit_loss.rows[0].source_records,
            record_counts_opex_side: profit_loss.rows[1].source_records,
            // Delta chips render only when comparison data is available.
            comparison: previousPL && reportScope.comparison_mode !== 'none' ? {
                period_label: reportScope.comparison_period?.label || 'Previous',
                previous_revenue: previousPL.revenue,
                previous_opex: previousPL.opex,
                previous_net_result: previousPL.netResult,
                previous_gross_margin: previousPL.grossMargin,
                delta_revenue_pct: previousPL.revenue === 0 ? null : ((profit_loss.revenue - previousPL.revenue) / Math.abs(previousPL.revenue)) * 100,
                delta_opex_pct: previousPL.opex === 0 ? null : ((profit_loss.opex - previousPL.opex) / Math.abs(previousPL.opex)) * 100,
                delta_net_result_pct: previousPL.netResult === 0 ? null : ((profit_loss.netResult - previousPL.netResult) / Math.abs(previousPL.netResult)) * 100,
                delta_margin_points: profit_loss.grossMargin - previousPL.grossMargin
            } : null
        },
        key_takeaways,
        profit_loss,
        ytd_summary,
        monthly_trend,
        period_comparison,
        yoy_comparison,
        monthly_trend_comparison,
        finance_predictability,
        expense_breakdown,
        bills_subscriptions,
        report_confidence_method,
        data_quality,
        export_manifest,
        sections_availability: sectionsAvailability,
        record_counts: {
            transactions: transactions.length,
            bills: bills.length,
            subscriptions: subscriptions.length,
            current_period_transactions: transactions.length,
            comparison_period_transactions: Array.isArray(previousPeriodTransactions) ? previousPeriodTransactions.length : 0
        },
        warning_counts: data_quality.warning_counts,
        warning_total: warningTotal,
        source_files: sourceFiles,
        period: currentPeriodForBuilder
    };
}

// File list adapts to the scope so CSV filenames make sense for the report
// the user actually requested.
function sourceFilesForScope(scope) {
    const slug = periodFilenameSlug({ start: scope.current_period.start_date, end: scope.current_period.end_date });
    const currentYear = parseDay(scope.current_period.start_date)?.getFullYear();
    const previousYear = scope.comparison_period ? parseDay(scope.comparison_period.start_date)?.getFullYear() : null;
    const ytdSlug = currentYear ? `${currentYear}_ytd` : slug;
    const yoySlug = (currentYear && previousYear) ? `${currentYear}_vs_${previousYear}_ytd` : ytdSlug;

    if (scope.mode === 'year_to_date' || scope.mode === 'quarter_to_date') {
        if (scope.comparison_mode === 'previous_year_to_date' || scope.comparison_mode === 'same_period_last_year') {
            return [
                `yoy_profit_loss_${yoySlug}.csv`,
                `monthly_trend_yoy_${currentYear}_vs_${previousYear}.csv`,
                `expense_breakdown_${ytdSlug}.csv`,
                `ledger_export_${ytdSlug}.csv`,
                `data_quality_${ytdSlug}.csv`
            ];
        }
        return [
            `ytd_profit_loss_${currentYear || slug}.csv`,
            `monthly_trend_${ytdSlug}.csv`,
            `expense_breakdown_${ytdSlug}.csv`,
            `bills_payables_${ytdSlug}.csv`,
            `ledger_export_${ytdSlug}.csv`,
            `data_quality_${ytdSlug}.csv`
        ];
    }
    return [
        `profit_loss_${slug}.csv`,
        `expense_breakdown_${slug}.csv`,
        `bills_payables_${slug}.csv`,
        `subscriptions_${slug}.csv`,
        `ledger_export_${slug}.csv`,
        `data_quality_${slug}.csv`
    ];
}

function composeExecutiveSummary({ scope, totalRecords, profit_loss, ytd_summary, yoy_comparison, expense_breakdown, warningTotal, periodHumanLabel }) {
    if (totalRecords === 0) {
        return `${periodHumanLabel} has no FluxyOS records yet. Add transactions, bills, or subscriptions to populate this report.`;
    }

    if (yoy_comparison && yoy_comparison.status !== 'unavailable') {
        const rev = yoy_comparison.rows.find(r => r.metric === 'Revenue');
        const opex = yoy_comparison.rows.find(r => r.metric === 'OpEx');
        const net = yoy_comparison.rows.find(r => r.metric === 'Net Result');
        const margin = yoy_comparison.rows.find(r => r.metric === 'Gross Margin');
        const fmtPct = (r) => r?.change_pct === null ? 'N/A' : (r.change_pct >= 0 ? '+' : '') + r.change_pct.toFixed(1) + '%';
        const marginPart = margin ? `Margin ${margin.change_points >= 0 ? 'expanded' : 'compressed'} by ${Math.abs(margin.change_points).toFixed(1)} pts.` : '';
        return `Revenue ${rev?.change_pct === null ? 'is new this year' : (rev.change_pct >= 0 ? 'grew' : 'declined') + ' by ' + fmtPct(rev)} compared with the same period last year. OpEx changed by ${fmtPct(opex)} while net result changed by ${fmtPct(net)}. ${marginPart}`;
    }

    if (ytd_summary) {
        const best = ytd_summary.bestRevenueMonth;
        const top = expense_breakdown.categories[0];
        return `${periodHumanLabel} generated ${formatRupiah(ytd_summary.revenue)} revenue, ${formatRupiah(ytd_summary.opex)} OpEx, and ${formatRupiah(ytd_summary.netResult)} net result.${best ? ' The strongest month was ' + best.monthLabel + '.' : ''}${top ? ' ' + top.category + ' was the largest cost driver at ' + formatRupiah(top.amount) + '.' : ''}${warningTotal ? ' ' + warningTotal + ' data warning' + (warningTotal === 1 ? '' : 's') + ' should be resolved before external handoff.' : ''}`;
    }

    return profit_loss.netResult >= 0
        ? `${periodHumanLabel} closed with ${formatRupiah(profit_loss.netResult)} net result and ${formatPercent(profit_loss.grossMargin)} gross margin. ${expense_breakdown.top_vendors[0] ? expense_breakdown.categories[0]?.category + ' was the largest OpEx driver at ' + formatRupiah(expense_breakdown.categories[0].amount) + '. ' : ''}${warningTotal ? warningTotal + ' data warning' + (warningTotal === 1 ? '' : 's') + ' should be resolved before external handoff.' : 'Data quality is clean for this period.'}`
        : `${periodHumanLabel} closed at a loss of ${formatRupiah(Math.abs(profit_loss.netResult))} with ${formatPercent(profit_loss.grossMargin)} gross margin. Review the largest expense categories${warningTotal ? ' and ' + warningTotal + ' data warning' + (warningTotal === 1 ? '' : 's') : ''} before handoff.`;
}

function buildYtdKeyTakeaways({ ytd_summary, expense_breakdown, monthly_trend, warningTotal }) {
    const out = [];
    if (!ytd_summary || ytd_summary.revenue + ytd_summary.opex === 0) {
        out.push({ no: 1, title: 'No year-to-date activity yet', body: 'Add transactions to populate the YTD report.' });
        return out;
    }
    out.push({ no: 1, title: `${formatRupiah(ytd_summary.revenue)} YTD revenue`, body: `${ytd_summary.elapsedMonths} month${ytd_summary.elapsedMonths === 1 ? '' : 's'} so far. Average ${formatRupiah(ytd_summary.avgMonthlyRevenue)} per month.${ytd_summary.isPartialCurrentMonth ? ' Includes partial current month.' : ''}` });
    if (ytd_summary.bestRevenueMonth) {
        out.push({ no: 2, title: `Strongest month: ${ytd_summary.bestRevenueMonth.monthLabel}`, body: `${formatRupiah(ytd_summary.bestRevenueMonth.revenue)} revenue.` });
    }
    if (expense_breakdown.categories[0]) {
        const c = expense_breakdown.categories[0];
        out.push({ no: out.length + 1, title: `${c.category} led OpEx`, body: `${formatRupiah(c.amount)}, equal to ${c.pct}% of YTD OpEx.` });
    }
    if (warningTotal > 0) {
        out.push({ no: out.length + 1, title: 'Usable, not fully clean', body: `${warningTotal} data warning${warningTotal === 1 ? '' : 's'} need review.` });
    }
    return out.slice(0, 4);
}

function buildYoyKeyTakeaways({ yoy_comparison, warningTotal }) {
    const out = [];
    const rev = yoy_comparison.rows.find(r => r.metric === 'Revenue');
    const opex = yoy_comparison.rows.find(r => r.metric === 'OpEx');
    const net = yoy_comparison.rows.find(r => r.metric === 'Net Result');
    const margin = yoy_comparison.rows.find(r => r.metric === 'Gross Margin');
    if (rev) out.push({ no: 1, title: `Revenue ${rev.change_pct === null ? 'is new this year' : (rev.change_pct >= 0 ? 'grew' : 'declined')}`, body: rev.change_pct === null ? 'No previous-year revenue to compare against.' : `${rev.change_pct >= 0 ? '+' : ''}${rev.change_pct.toFixed(1)}% vs the same YTD range last year.` });
    if (opex) out.push({ no: 2, title: `OpEx ${opex.change_pct === null ? 'is new this year' : (opex.change_pct >= 0 ? 'grew' : 'fell')}`, body: opex.change_pct === null ? 'No previous-year OpEx to compare.' : `${opex.change_pct >= 0 ? '+' : ''}${opex.change_pct.toFixed(1)}% vs the same YTD range last year.` });
    if (net) out.push({ no: 3, title: `Net result ${net.change_pct === null ? 'is new this year' : (net.change_pct >= 0 ? 'improved' : 'declined')}`, body: net.change_pct === null ? 'No previous-year net result to compare.' : `${net.change_pct >= 0 ? '+' : ''}${net.change_pct.toFixed(1)}% vs the same YTD range last year.` });
    if (margin) out.push({ no: 4, title: `Margin ${margin.change_points >= 0 ? 'expanded' : 'compressed'}`, body: `${margin.change_points >= 0 ? '+' : ''}${margin.change_points.toFixed(1)} pts vs the same YTD range last year.` });
    if (warningTotal > 0 && out.length < 4) {
        out.push({ no: out.length + 1, title: 'Data warnings exist', body: `${warningTotal} item${warningTotal === 1 ? '' : 's'} need review before external handoff.` });
    }
    return out.slice(0, 4);
}

function buildKeyTakeaways({ profit_loss, expense_breakdown, bills_subscriptions, data_quality, warningTotal }) {
    const takeaways = [];
    if (profit_loss.revenue + profit_loss.opex === 0) {
        takeaways.push({ no: 1, title: 'No financial activity yet', body: 'No revenue or expense records found for this period. Add transactions to populate this report.' });
        return takeaways;
    }
    if (profit_loss.netResult >= 0) {
        takeaways.push({ no: 1, title: 'Period closed profitably', body: `${formatRupiah(profit_loss.netResult)} net result at ${formatPercent(profit_loss.grossMargin)} gross margin.` });
    } else {
        takeaways.push({ no: 1, title: 'Period closed at a loss', body: `${formatRupiah(Math.abs(profit_loss.netResult))} loss. Review the largest expense categories.` });
    }
    if (expense_breakdown.categories[0]) {
        const c = expense_breakdown.categories[0];
        takeaways.push({ no: 2, title: `${c.category} led OpEx`, body: `${formatRupiah(c.amount)}, equal to ${c.pct}% of total OpEx.` });
    }
    if (bills_subscriptions.pending_payable_total > 0) {
        takeaways.push({ no: takeaways.length + 1, title: 'Payables need attention', body: `${formatRupiah(bills_subscriptions.pending_payable_total)} pending payable pressure from bills and subscriptions.` });
    }
    if (warningTotal > 0) {
        takeaways.push({ no: takeaways.length + 1, title: 'Usable, not fully clean', body: `${warningTotal} data warning${warningTotal === 1 ? '' : 's'} need review (missing receipts, due dates, renewal dates).` });
    } else if (takeaways.length < 4) {
        takeaways.push({ no: takeaways.length + 1, title: 'Data quality is clean', body: 'No missing receipts, due dates, or renewal dates in the selected period.' });
    }
    return takeaways.slice(0, 4);
}

function computeSectionsAvailability({ scope, totalRecords, period_comparison, yoy_comparison, monthly_trend_comparison, monthly_trend, finance_predictability, data_quality, report_confidence_method }) {
    const empty = totalRecords === 0;
    const isYtdMode = scope && (scope.mode === 'year_to_date' || scope.mode === 'quarter_to_date');
    const isYoY = scope && (scope.comparison_mode === 'previous_year_to_date' || scope.comparison_mode === 'same_period_last_year');

    // Build the section list dynamically based on the scope.
    let keys = ['executive_summary'];
    if (isYoY) {
        keys.push('yoy_pl', 'monthly_trend_comparison');
    } else if (isYtdMode) {
        keys.push('ytd_pl', 'monthly_trend');
    } else {
        keys.push('profit_loss');
        if (period_comparison?.status === 'available' || scope?.comparison_mode === 'previous_period') {
            keys.push('period_comparison');
        }
    }
    keys.push(
        'finance_predictability',
        'expense_breakdown',
        'bills_subscriptions',
        'report_confidence',
        'data_quality',
        'export_manifest'
    );

    return keys.map(key => {
        let status = 'available';
        let limitation = '';
        if (empty) {
            status = 'unavailable';
            limitation = 'No records in selected period';
        } else if (key === 'period_comparison' && period_comparison?.status === 'unavailable') {
            status = 'unavailable';
            limitation = 'Previous period records not found';
        } else if (key === 'yoy_pl' && yoy_comparison?.status === 'unavailable') {
            status = 'unavailable';
            limitation = 'Previous-year records not found';
        } else if (key === 'yoy_pl' && yoy_comparison?.status === 'partial') {
            status = 'partial';
            limitation = yoy_comparison.limitations.join(' · ');
        } else if (key === 'monthly_trend_comparison' && monthly_trend_comparison?.status !== 'available') {
            status = monthly_trend_comparison?.status || 'unavailable';
            limitation = monthly_trend_comparison?.limitations?.[0] || 'Previous-year monthly data not found';
        } else if (key === 'monthly_trend' && (!monthly_trend || monthly_trend.length === 0)) {
            status = 'unavailable';
            limitation = 'Not enough months in the selected range';
        } else if (key === 'finance_predictability') {
            status = finance_predictability.status;
            limitation = finance_predictability.limitations.join(' · ');
        } else if (key === 'data_quality' && data_quality.warnings.length === 0) {
            limitation = 'No warnings — clean state';
        } else if (key === 'report_confidence' && report_confidence_method.score < 70) {
            status = 'partial';
            limitation = 'Confidence below 70% — see breakdown';
        }
        return { key, label: REPORT_SECTION_LABELS[key] || key, status, limitation };
    });
}

// ---------- CSV builders (shared between drawer export and full viewer) ----------

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
}

function csvRow(cells) {
    return cells.map(csvCell).join(',');
}

function dayFromTimestamp(value) {
    const d = timestampToDate(value);
    return d ? dayKey(d) : '';
}

export function buildCsvFile(fileKey, pack, sourceData = {}) {
    const period = pack.period;
    switch (fileKey) {
        case 'profit_loss': {
            const rows = [];
            rows.push(csvRow(['Report', 'Profit & Loss']));
            rows.push(csvRow(['Period Start', period.start]));
            rows.push(csvRow(['Period End', period.end]));
            rows.push(csvRow(['Generated At', pack.report_identity.generated_at]));
            rows.push('');
            rows.push(csvRow(['Metric', 'Amount']));
            rows.push(csvRow(['Revenue', pack.profit_loss.revenue]));
            rows.push(csvRow(['OpEx', pack.profit_loss.opex]));
            const margin = pack.profit_loss.revenue > 0 ? pack.profit_loss.grossMargin.toFixed(1) : 0;
            rows.push(csvRow(['Gross Margin %', margin]));
            rows.push(csvRow(['Net Result', pack.profit_loss.netResult]));
            return rows.join('\n');
        }
        case 'expense_breakdown': {
            const rows = [csvRow(['Category', 'Vendor', 'Amount', 'Record Count', 'Missing Receipt Count'])];
            const txs = sourceData.transactions || [];
            const subs = sourceData.subscriptions || [];
            const all = [
                ...txs.filter(t => OPEX_TYPES.has(String(t.type || '').toLowerCase())).map(t => ({ ...t, _source: 'transactions' })),
                ...subs.map(s => ({ ...s, _source: 'subscriptions' }))
            ];
            const grouped = new Map();
            all.forEach(r => {
                const key = `${r.category || 'Uncategorized'}||${r.vendor_name || 'Unknown vendor'}`;
                const entry = grouped.get(key) || { category: r.category || 'Uncategorized', vendor: r.vendor_name || 'Unknown vendor', amount: 0, count: 0, missing: 0 };
                entry.amount += Math.abs(Number(r.amount || 0));
                entry.count += 1;
                if (r._source === 'transactions' && r.status === 'Missing Receipt') entry.missing += 1;
                grouped.set(key, entry);
            });
            Array.from(grouped.values())
                .sort((a, b) => b.amount - a.amount)
                .forEach(e => rows.push(csvRow([e.category, e.vendor, e.amount, e.count, e.missing])));
            return rows.join('\n');
        }
        case 'bills_payables': {
            const rows = [csvRow(['Vendor', 'Category', 'Amount', 'Type', 'Status', 'Due Date', 'Record ID'])];
            (sourceData.bills || []).forEach(b => {
                rows.push(csvRow([
                    b.vendor_name || '',
                    b.category || '',
                    Number(b.amount || 0),
                    b.type || '',
                    b.status || '',
                    dayFromTimestamp(b.due_date),
                    b.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'subscriptions': {
            const rows = [csvRow(['Vendor', 'Category', 'Amount', 'Status', 'Renewal Date', 'Record ID'])];
            (sourceData.subscriptions || []).forEach(s => {
                rows.push(csvRow([
                    s.vendor_name || s.name || '',
                    s.category || '',
                    Number(s.amount || 0),
                    s.status || 'Active',
                    dayFromTimestamp(s.renewal_date),
                    s.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'ledger_export': {
            const rows = [csvRow(['Date', 'Source', 'Vendor', 'Category', 'Type', 'Amount', 'Status', 'Record ID'])];
            (sourceData.transactions || []).forEach(t => {
                rows.push(csvRow([
                    dayFromTimestamp(t.timestamp),
                    'transactions',
                    t.vendor_name || '',
                    t.category || '',
                    t.type || '',
                    Number(t.amount || 0),
                    t.status || '',
                    t.id || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'data_quality': {
            const rows = [csvRow(['Source', 'Record ID', 'Vendor', 'Issue Type', 'Field', 'Severity'])];
            (sourceData.transactions || [])
                .filter(t => t.status === 'Missing Receipt')
                .forEach(t => rows.push(csvRow(['transactions', t.id || '', t.vendor_name || '', 'Missing Receipt', 'receipt_url', 'warning'])));
            (sourceData.bills || [])
                .filter(b => !b.due_date)
                .forEach(b => rows.push(csvRow(['bills', b.id || '', b.vendor_name || '', 'Missing Due Date', 'due_date', 'warning'])));
            (sourceData.subscriptions || [])
                .filter(s => !s.renewal_date)
                .forEach(s => rows.push(csvRow(['subscriptions', s.id || '', s.vendor_name || s.name || '', 'Missing Renewal Date', 'renewal_date', 'warning'])));
            return rows.join('\n');
        }
        case 'ytd_profit_loss': {
            const rows = [];
            const summary = pack.ytd_summary || pack.profit_loss;
            rows.push(csvRow(['Report', 'Year-to-Date Profit & Loss']));
            rows.push(csvRow(['Period Start', period.start]));
            rows.push(csvRow(['Period End', period.end]));
            rows.push(csvRow(['Generated At', pack.report_identity.generated_at]));
            rows.push('');
            rows.push(csvRow(['Metric', 'Amount']));
            rows.push(csvRow(['YTD Revenue', summary.revenue]));
            rows.push(csvRow(['YTD OpEx', summary.opex]));
            const margin = summary.revenue > 0 ? summary.grossMargin.toFixed(1) : 0;
            rows.push(csvRow(['YTD Gross Margin %', margin]));
            rows.push(csvRow(['YTD Net Result', summary.netResult]));
            if (pack.ytd_summary) {
                rows.push(csvRow(['Average Monthly Revenue', Math.round(pack.ytd_summary.avgMonthlyRevenue)]));
                rows.push(csvRow(['Average Monthly OpEx', Math.round(pack.ytd_summary.avgMonthlyOpex)]));
                rows.push(csvRow(['Elapsed Months', pack.ytd_summary.elapsedMonths]));
                rows.push(csvRow(['Best Revenue Month', pack.ytd_summary.bestRevenueMonth?.monthLabel || 'N/A']));
                rows.push(csvRow(['Worst Net Result Month', pack.ytd_summary.worstNetMonth?.monthLabel || 'N/A']));
                rows.push(csvRow(['Includes Partial Current Month', pack.ytd_summary.isPartialCurrentMonth ? 'Yes' : 'No']));
            }
            return rows.join('\n');
        }
        case 'monthly_trend': {
            const rows = [csvRow(['Month', 'Revenue', 'OpEx', 'Net Result', 'Gross Margin %', 'Record Count', 'Warnings'])];
            (pack.monthly_trend || []).forEach(m => {
                rows.push(csvRow([
                    m.month,
                    m.revenue,
                    m.opex,
                    m.netResult,
                    m.revenue > 0 ? m.grossMargin.toFixed(1) : 0,
                    m.recordCount,
                    m.warnings
                ]));
            });
            return rows.join('\n');
        }
        case 'yoy_profit_loss': {
            const rows = [];
            rows.push(csvRow(['Report', 'YTD Year-on-Year Profit & Loss']));
            rows.push(csvRow(['Current Period', `${pack.report_scope?.current_period?.start_date} to ${pack.report_scope?.current_period?.end_date}`]));
            rows.push(csvRow(['Comparison Period', `${pack.report_scope?.comparison_period?.start_date || ''} to ${pack.report_scope?.comparison_period?.end_date || ''}`]));
            rows.push(csvRow(['Generated At', pack.report_identity.generated_at]));
            rows.push('');
            const yoy = pack.yoy_comparison;
            if (!yoy || yoy.status === 'unavailable') {
                rows.push(csvRow(['Note', 'Previous-year records not found. No comparison rows.']));
                return rows.join('\n');
            }
            rows.push(csvRow(['Metric', 'Current YTD', 'Previous YTD', 'Change', 'Change %', 'Margin pts', 'Interpretation']));
            yoy.rows.forEach(r => {
                rows.push(csvRow([
                    r.metric,
                    r.is_percent ? r.current.toFixed(1) : r.current,
                    r.is_percent ? r.previous.toFixed(1) : r.previous,
                    r.is_percent ? '' : (r.change ?? ''),
                    r.is_percent ? '' : (r.change_pct === null ? 'N/A' : r.change_pct.toFixed(1)),
                    r.is_percent && typeof r.change_points === 'number' ? r.change_points.toFixed(1) : '',
                    r.interpretation || ''
                ]));
            });
            return rows.join('\n');
        }
        case 'monthly_trend_yoy': {
            const rows = [csvRow(['Index', 'Current Month', 'Current Revenue', 'Current OpEx', 'Current Net Result', 'Previous Month', 'Previous Revenue', 'Previous OpEx', 'Previous Net Result', 'Revenue Change %'])];
            const comp = pack.monthly_trend_comparison;
            if (!comp || comp.status === 'unavailable' || !comp.months?.length) {
                rows.push(csvRow(['', '', '', '', '', '', '', '', '', 'No previous-year monthly trend data']));
                return rows.join('\n');
            }
            comp.months.forEach((m, i) => {
                const c = m.current || {};
                const p = m.previous || {};
                rows.push(csvRow([
                    i + 1,
                    m.currentLabel || '',
                    c.revenue ?? '',
                    c.opex ?? '',
                    c.netResult ?? '',
                    m.previousLabel || '',
                    p.revenue ?? '',
                    p.opex ?? '',
                    p.netResult ?? '',
                    m.revenue_change_pct === null || m.revenue_change_pct === undefined ? 'N/A' : m.revenue_change_pct.toFixed(1)
                ]));
            });
            return rows.join('\n');
        }
        default:
            return '';
    }
}

// Map source-file names → file key suffix. The pack's `source_files` array
// holds final filenames; we look up the canonical key by prefix.
function fileKeyFromFilename(filename) {
    if (filename.startsWith('yoy_profit_loss_')) return 'yoy_profit_loss';
    if (filename.startsWith('monthly_trend_yoy_')) return 'monthly_trend_yoy';
    if (filename.startsWith('monthly_trend_')) return 'monthly_trend';
    if (filename.startsWith('ytd_profit_loss_')) return 'ytd_profit_loss';
    if (filename.startsWith('profit_loss_')) return 'profit_loss';
    if (filename.startsWith('expense_breakdown_')) return 'expense_breakdown';
    if (filename.startsWith('bills_payables_')) return 'bills_payables';
    if (filename.startsWith('subscriptions_')) return 'subscriptions';
    if (filename.startsWith('ledger_export_')) return 'ledger_export';
    if (filename.startsWith('data_quality_')) return 'data_quality';
    return null;
}

export function buildCsvBundle(pack, sourceData = {}) {
    const files = pack.source_files || [];
    if (!files.length) {
        // Legacy fallback for callers without a scope-aware source_files list.
        const slug = periodFilenameSlug(pack.period);
        const keys = ['profit_loss', 'expense_breakdown', 'bills_payables', 'subscriptions', 'ledger_export', 'data_quality'];
        return keys.map(k => ({ filename: `${k}_${slug}.csv`, content: buildCsvFile(k, pack, sourceData) }));
    }
    return files
        .map(filename => {
            const key = fileKeyFromFilename(filename);
            if (!key) return null;
            return { filename, content: buildCsvFile(key, pack, sourceData) };
        })
        .filter(Boolean);
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8;') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
