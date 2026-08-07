// =============================================================================
// FluxyOS — Financial Statements Engine (pure, ledger-derived)
//
// INTENTIONALLY pure — no Firestore, no DOM. Builds the Income Statement and
// Balance Sheet from Chart-of-Accounts-annotated ledger_balances aggregates —
// the SAME source as the Trial Balance, so the statements can never disagree
// with it (unlike the transactions-only Income Statement PREVIEW). db-service
// fetches and aggregates the balances; the Accounting Center Statements tab
// renders the output.
//
// The balance sheet always balances by construction: for a set of balanced
// journals, total debits == total credits, which rearranges to
//   Assets = Liabilities + Equity + (Revenue − Expense).
// The (Revenue − Expense) term is surfaced as "Current-period earnings" in the
// equity section, so Assets == Liabilities + Equity holds exactly. The tie-out
// check is therefore a real integrity signal: a non-zero delta means the
// ledger_balances snapshot itself drifted (see scripts/reconcile-ledger-balances.js).
// =============================================================================

import { signedBalance } from './accounting-engine.js';

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

// One display line from an aggregated account row. `amount` is signed to the
// account's natural direction (revenue positive when it has net credits,
// expense positive when it has net debits, etc.).
function lineOf(row) {
    return {
        code: row.account_code,
        name: row.account_name || row.account_code,
        name_id: row.account_name_id || null,
        // Carried so the balance sheet can classify current vs non-current. The
        // income statement already groups on it; the balance sheet could not,
        // because lineOf dropped it here.
        sak_category: row.sak_category || null,
        amount: signedBalance(row.account_type, row.debit_total, row.credit_total)
    };
}

function sumLines(lines) {
    return lines.reduce((s, l) => s + l.amount, 0);
}

// Rows carrying no movement are dropped so statements stay readable.
function activeRows(rows, types) {
    return (rows || [])
        .filter((r) => types.includes(r.account_type))
        .filter((r) => toInt(r.debit_total) !== 0 || toInt(r.credit_total) !== 0)
        .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)));
}

// --- Income Statement (period movement) ------------------------------------
// `rows` are period-scoped aggregates (movement within the reporting range).
// Grouped into the standard P&L ladder using sak_category so gross vs operating
// margin are visible: Revenue → COGS → Gross Profit → OpEx → Operating Income
// → Other Income/Expense → Net Income.
export function buildIncomeStatement(rows = []) {
    const revenueRows = activeRows(rows, ['revenue']);
    const expenseRows = activeRows(rows, ['expense']);

    const revenue = revenueRows.filter((r) => r.sak_category === 'revenue').map(lineOf);
    const otherIncome = revenueRows.filter((r) => r.sak_category !== 'revenue').map(lineOf);
    const cogs = expenseRows.filter((r) => r.sak_category === 'cogs').map(lineOf);
    const otherExpense = expenseRows.filter((r) => r.sak_category === 'other_expense').map(lineOf);
    const operatingExpenses = expenseRows
        .filter((r) => r.sak_category !== 'cogs' && r.sak_category !== 'other_expense')
        .map(lineOf);

    const totalRevenue = sumLines(revenue);
    const totalCogs = sumLines(cogs);
    const grossProfit = totalRevenue - totalCogs;
    const totalOpEx = sumLines(operatingExpenses);
    const operatingIncome = grossProfit - totalOpEx;
    const totalOtherIncome = sumLines(otherIncome);
    const totalOtherExpense = sumLines(otherExpense);
    const netIncome = operatingIncome + totalOtherIncome - totalOtherExpense;

    return {
        revenue, cogs, operatingExpenses, otherIncome, otherExpense,
        totalRevenue, totalCogs, grossProfit, totalOpEx, operatingIncome,
        totalOtherIncome, totalOtherExpense, netIncome,
        // NOTE: these are FRACTIONS (0.42 = 42%), not percentages, and null when
        // there is no revenue to divide by. Callers must ×100 and handle null.
        grossMarginPct: totalRevenue > 0 ? grossProfit / totalRevenue : null,
        netMarginPct: totalRevenue > 0 ? netIncome / totalRevenue : null,
        hasData: revenue.length + cogs.length + operatingExpenses.length + otherIncome.length + otherExpense.length > 0
    };
}

// --- Cash Flow (period movement, indirect method) --------------------------
// Built on the double-entry identity rather than on hand-picked adjustments:
// across every account Σ(debit − credit) == 0, so
//     Δcash == Σ(credit − debit) over all NON-cash accounts.
// Each non-cash account therefore contributes exactly its cash effect, and the
// three sections are a partition of those accounts — the statement ties to the
// actual movement in cash accounts by construction, exactly like the Balance
// Sheet. A non-zero tieOutDelta means the ledger_balances snapshot drifted.
//
// This also survives a CLOSED period. The closing journal moves the P&L into
// Retained Earnings, which would otherwise double-count net income; because RE
// is grouped with the P&L accounts in Operating, the closing entry nets to zero
// and "Net income" reads the same whether the period is open or closed.
const CASH_CATEGORY = 'cash_bank';
const CURRENT_ASSET_CATEGORIES = ['accounts_receivable', 'other_current_asset'];
const CURRENT_LIABILITY_CATEGORIES = ['accounts_payable', 'other_current_liability'];
const RETAINED_EARNINGS_CODE = '3000';

// Cash effect of a non-cash account's period movement (see identity above).
function cashEffectOf(row) {
    return toInt(row.credit_total) - toInt(row.debit_total);
}

function cashLineOf(row) {
    return {
        code: row.account_code,
        name: row.account_name || row.account_code,
        name_id: row.account_name_id || null,
        amount: cashEffectOf(row)
    };
}

function isCashAccount(row) {
    return row.sak_category === CASH_CATEGORY;
}

// Partition every non-cash account with movement into one of the three sections.
// Unknown/custom categories fall back on account type so a user-created account
// can never silently drop out of the statement and break the tie-out.
function cashSectionOf(row) {
    const cat = row.sak_category || null;
    const type = row.account_type;
    if (type === 'revenue' || type === 'expense') return 'operating';
    if (row.account_code === RETAINED_EARNINGS_CODE) return 'operating';
    if (type === 'asset') return CURRENT_ASSET_CATEGORIES.includes(cat) ? 'operating' : 'investing';
    if (type === 'liability') return CURRENT_LIABILITY_CATEGORIES.includes(cat) ? 'operating' : 'financing';
    if (type === 'equity') return 'financing';
    return 'operating';
}

export function buildCashFlow(rows = []) {
    const moved = (rows || []).filter(
        (r) => toInt(r.debit_total) !== 0 || toInt(r.credit_total) !== 0
    );
    const cashRows = moved.filter(isCashAccount);
    const nonCash = moved.filter((r) => !isCashAccount(r));

    const bySection = { operating: [], investing: [], financing: [] };
    nonCash
        .slice()
        .sort((a, b) => String(a.account_code).localeCompare(String(b.account_code)))
        .forEach((r) => { bySection[cashSectionOf(r)].push(cashLineOf(r)); });

    // Net income = P&L movement plus the closing entry's move into Retained
    // Earnings, so it reads identically for an open and a closed period.
    const netIncome = nonCash
        .filter((r) => r.account_type === 'revenue' || r.account_type === 'expense'
            || r.account_code === RETAINED_EARNINGS_CODE)
        .reduce((s, r) => s + cashEffectOf(r), 0);

    // Operating lines minus the earnings block = the working-capital adjustments.
    const workingCapital = bySection.operating.filter(
        (l) => !nonCash.some((r) => r.account_code === l.code
            && (r.account_type === 'revenue' || r.account_type === 'expense'
                || r.account_code === RETAINED_EARNINGS_CODE))
    );

    const totalOperating = sumLines(bySection.operating);
    const totalInvesting = sumLines(bySection.investing);
    const totalFinancing = sumLines(bySection.financing);
    const netChangeInCash = totalOperating + totalInvesting + totalFinancing;

    // What the cash accounts actually moved, independent of the sections above.
    const cashMovement = cashRows.reduce(
        (s, r) => s + (toInt(r.debit_total) - toInt(r.credit_total)), 0
    );

    return {
        operating: bySection.operating,
        workingCapital,
        investing: bySection.investing,
        financing: bySection.financing,
        netIncome,
        totalOperating,
        totalInvesting,
        totalFinancing,
        netChangeInCash,
        cashMovement,
        tieOutDelta: netChangeInCash - cashMovement,
        balanced: netChangeInCash - cashMovement === 0,
        hasData: moved.length > 0
    };
}

// --- Balance Sheet (cumulative, as-of) -------------------------------------
// `rows` are cumulative aggregates through the as-of period (every posting up
// to and including it). Current-period earnings (cumulative Revenue − Expense
// not yet closed to Retained Earnings) is computed here and added to equity so
// the sheet ties out.
// Current vs non-current, by SAK category.
//
// PSAK 1 (Indonesia's adoption of IAS 1) requires assets and liabilities to be
// presented as current and non-current on the face of the statement, unless a
// liquidity ordering is more relevant — which in practice means financial
// institutions, not the SMBs this serves. It is also what makes working capital,
// current ratio and quick ratio readable, which is the first thing a lender
// computes.
//
// Anything unrecognised is treated as CURRENT rather than dropped: an
// unclassified account is far more likely to be an ordinary payable or
// receivable than a piece of plant, and understating current liabilities
// flatters liquidity. Erring toward current is the conservative direction.
const NON_CURRENT_ASSET_CATEGORIES = new Set(['fixed_asset', 'accumulated_depreciation', 'other_asset']);
const NON_CURRENT_LIABILITY_CATEGORIES = new Set(['long_term_liability']);

const isNonCurrentAsset = (l) => NON_CURRENT_ASSET_CATEGORIES.has(l.sak_category);
const isNonCurrentLiability = (l) => NON_CURRENT_LIABILITY_CATEGORIES.has(l.sak_category);

export function buildBalanceSheet(rows = []) {
    const assets = activeRows(rows, ['asset']).map(lineOf);
    const liabilities = activeRows(rows, ['liability']).map(lineOf);
    const equityAccounts = activeRows(rows, ['equity']).map(lineOf);

    const assetsNonCurrent = assets.filter(isNonCurrentAsset);
    const assetsCurrent = assets.filter((l) => !isNonCurrentAsset(l));
    const liabilitiesNonCurrent = liabilities.filter(isNonCurrentLiability);
    const liabilitiesCurrent = liabilities.filter((l) => !isNonCurrentLiability(l));

    // Cumulative net income sitting in revenue/expense = earnings not yet closed
    // into equity. Surfaced as its own equity line so the identity holds.
    const revenueTotal = sumLines(activeRows(rows, ['revenue']).map(lineOf));
    const expenseTotal = sumLines(activeRows(rows, ['expense']).map(lineOf));
    const currentEarnings = revenueTotal - expenseTotal;

    const equity = equityAccounts.slice();
    if (currentEarnings !== 0 || !equityAccounts.length) {
        equity.push({ code: '3500', name: 'Current-period earnings', name_id: 'Laba periode berjalan', amount: currentEarnings, computed: true });
    }

    const totalAssets = sumLines(assets);
    const totalLiabilities = sumLines(liabilities);
    const totalEquity = sumLines(equity);
    const liabilitiesPlusEquity = totalLiabilities + totalEquity;

    return {
        // Flat arrays stay for callers that predate the classification (CSV
        // export, drill-down, the Overview tie-out); the grouped views are added
        // alongside rather than replacing them.
        assets, liabilities, equity,
        assetsCurrent, assetsNonCurrent, liabilitiesCurrent, liabilitiesNonCurrent,
        totalAssetsCurrent: sumLines(assetsCurrent),
        totalAssetsNonCurrent: sumLines(assetsNonCurrent),
        totalLiabilitiesCurrent: sumLines(liabilitiesCurrent),
        totalLiabilitiesNonCurrent: sumLines(liabilitiesNonCurrent),
        // Working capital is the reason the split is worth presenting at all.
        workingCapital: sumLines(assetsCurrent) - sumLines(liabilitiesCurrent),
        // True once anything non-current exists. The renderer uses this to stay
        // flat for charts that have only current accounts, so existing users do
        // not gain two headings and an empty section for nothing.
        isClassified: assetsNonCurrent.length + liabilitiesNonCurrent.length > 0,
        totalAssets, totalLiabilities, totalEquity, liabilitiesPlusEquity,
        currentEarnings,
        tieOutDelta: totalAssets - liabilitiesPlusEquity,
        balanced: totalAssets - liabilitiesPlusEquity === 0,
        hasData: assets.length + liabilities.length + equity.length > 0
    };
}
