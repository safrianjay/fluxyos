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
    finance_predictability: 'Finance Predictability Snapshot',
    expense_breakdown: 'Expense Breakdown',
    bills_subscriptions: 'Bills & Subscription Commitments',
    report_confidence: 'Report Confidence Method',
    data_quality: 'Data Quality & Cleanup',
    export_manifest: 'Export Manifest'
};

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
    transactions = [],
    bills = [],
    subscriptions = [],
    previousPeriodTransactions = null,
    recurringRevenue = null
}) {
    const profit_loss = calculateProfitLoss(transactions);
    const previousPL = Array.isArray(previousPeriodTransactions)
        ? calculateProfitLoss(previousPeriodTransactions)
        : null;
    const period_comparison = calculatePeriodComparison(profit_loss, previousPL);
    const finance_predictability = calculateFinancePredictability(profit_loss, recurringRevenue);
    const expense_breakdown = calculateExpenseBreakdown(transactions, subscriptions);
    const bills_subscriptions = calculateBillsSubscriptions(bills, subscriptions, period.end);
    const data_quality = calculateDataQuality(transactions, bills, subscriptions);
    const report_confidence_method = calculateReportConfidence(
        { transactions, bills, subscriptions },
        data_quality
    );

    const totalRecords = transactions.length + bills.length + subscriptions.length;
    const generatedAtIso = new Date().toISOString();
    const slug = periodFilenameSlug(period);

    const sourceFiles = [
        `profit_loss_${slug}.csv`,
        `expense_breakdown_${slug}.csv`,
        `bills_payables_${slug}.csv`,
        `subscriptions_${slug}.csv`,
        `ledger_export_${slug}.csv`,
        `data_quality_${slug}.csv`
    ];

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

    // Executive summary text — concrete, references real values.
    const periodHuman = periodLabel(period);
    const summaryText = totalRecords === 0
        ? `${periodHuman} has no FluxyOS records yet. Add transactions, bills, or subscriptions to populate this report.`
        : (profit_loss.netResult >= 0
            ? `${periodHuman} closed with ${formatRupiah(profit_loss.netResult)} net result and ${formatPercent(profit_loss.grossMargin)} gross margin. ${expense_breakdown.top_vendors[0] ? expense_breakdown.categories[0]?.category + ' was the largest OpEx driver at ' + formatRupiah(expense_breakdown.categories[0].amount) + '. ' : ''}${warningTotal ? warningTotal + ' data warning' + (warningTotal === 1 ? '' : 's') + ' should be resolved before external handoff.' : 'Data quality is clean for this period.'}`
            : `${periodHuman} closed at a loss of ${formatRupiah(Math.abs(profit_loss.netResult))} with ${formatPercent(profit_loss.grossMargin)} gross margin. Review the largest expense categories${warningTotal ? ' and ' + warningTotal + ' data warning' + (warningTotal === 1 ? '' : 's') : ''} before handoff.`);

    const key_takeaways = buildKeyTakeaways({ profit_loss, expense_breakdown, bills_subscriptions, data_quality, warningTotal });

    const sectionsAvailability = computeSectionsAvailability({
        totalRecords,
        period_comparison,
        finance_predictability,
        data_quality,
        report_confidence_method
    });

    return {
        report_identity: {
            report_type: 'monthly_report_pack',
            report_title: `${periodHuman} Financial Report`,
            business_name: businessName || '',
            period_start: period.start,
            period_end: period.end,
            period_label: periodHuman,
            generated_by_uid: userId,
            generated_by_name: userDisplayName || '',
            generated_at: generatedAtIso,
            status: 'draft_management_report',
            disclaimer: 'Management report generated from FluxyOS operational records. Not audited financial statements.'
        },
        executive_summary: {
            revenue: profit_loss.revenue,
            opex: profit_loss.opex,
            net_result: profit_loss.netResult,
            gross_margin: profit_loss.grossMargin,
            report_confidence: report_confidence_method.score,
            summary_text: summaryText,
            record_counts_revenue_side: profit_loss.rows[0].source_records,
            record_counts_opex_side: profit_loss.rows[1].source_records
        },
        key_takeaways,
        profit_loss,
        period_comparison,
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
            subscriptions: subscriptions.length
        },
        warning_counts: data_quality.warning_counts,
        warning_total: warningTotal,
        source_files: sourceFiles,
        period
    };
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

function computeSectionsAvailability({ totalRecords, period_comparison, finance_predictability, data_quality, report_confidence_method }) {
    const empty = totalRecords === 0;
    return REPORT_SECTION_KEYS.map(key => {
        let status = 'available';
        let limitation = '';
        if (empty) {
            status = 'unavailable';
            limitation = 'No records in selected period';
        } else if (key === 'period_comparison' && period_comparison.status === 'unavailable') {
            status = 'unavailable';
            limitation = 'Previous period records not found';
        } else if (key === 'finance_predictability') {
            status = finance_predictability.status;
            limitation = finance_predictability.limitations.join(' · ');
        } else if (key === 'data_quality' && data_quality.warnings.length === 0) {
            limitation = 'No warnings — clean state';
        } else if (key === 'report_confidence' && report_confidence_method.score < 70) {
            status = 'partial';
            limitation = 'Confidence below 70% — see breakdown';
        }
        return { key, label: REPORT_SECTION_LABELS[key], status, limitation };
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
        default:
            return '';
    }
}

export function buildCsvBundle(pack, sourceData = {}) {
    const slug = periodFilenameSlug(pack.period);
    const keys = ['profit_loss', 'expense_breakdown', 'bills_payables', 'subscriptions', 'ledger_export', 'data_quality'];
    return keys.map(k => ({
        filename: `${k}_${slug}.csv`,
        content: buildCsvFile(k, pack, sourceData)
    }));
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
