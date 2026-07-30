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

// --- Balance Sheet (cumulative, as-of) -------------------------------------
// `rows` are cumulative aggregates through the as-of period (every posting up
// to and including it). Current-period earnings (cumulative Revenue − Expense
// not yet closed to Retained Earnings) is computed here and added to equity so
// the sheet ties out.
export function buildBalanceSheet(rows = []) {
    const assets = activeRows(rows, ['asset']).map(lineOf);
    const liabilities = activeRows(rows, ['liability']).map(lineOf);
    const equityAccounts = activeRows(rows, ['equity']).map(lineOf);

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
        assets, liabilities, equity,
        totalAssets, totalLiabilities, totalEquity, liabilitiesPlusEquity,
        currentEarnings,
        tieOutDelta: totalAssets - liabilitiesPlusEquity,
        balanced: totalAssets - liabilitiesPlusEquity === 0,
        hasData: assets.length + liabilities.length + equity.length > 0
    };
}
