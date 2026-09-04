// =============================================================================
// FluxyOS — Accounting Engine (pure double-entry posting rules)
//
// This module is the heart of the accounting kernel. It is INTENTIONALLY pure:
// no Firestore, no DOM, no `window`. Given a business document it returns a
// balanced journal (Σdebit === Σcredit) or `null` when the document does not
// post. `db-service.js` wraps these outputs with server context (entity_id,
// posted_by, serverTimestamp) and writes them atomically alongside the document.
//
// Keeping posting logic here means it is deterministic, idempotent at the call
// site, and unit-testable in isolation (see tests/accounting-engine.spec.js).
//
// Money is ALWAYS a raw integer Rupiah (never a formatted string). Debits and
// credits are non-negative integers; every line carries exactly one non-zero
// side. See docs/PROJECT_BACKGROUND.md §4 for field conventions.
// =============================================================================

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// Normal balance side per account type. Drives trial-balance/GL signed display
// and the closing roll-forward. Assets/expenses increase on debit; the rest on
// credit.
export const NORMAL_BALANCE = {
    asset: 'debit',
    expense: 'debit',
    liability: 'credit',
    equity: 'credit',
    revenue: 'credit'
};

// SAK-aligned account classification (Jurnal-by-Mekari-style categories, kebab
// enum values). Drives statement grouping and validation; inventory/fixed-asset
// values are reserved for Phase 2 accounts so the enum never churns.
// See docs/data-model/chart-of-accounts.md.
export const SAK_CATEGORIES = [
    'cash_bank', 'accounts_receivable', 'other_current_asset', 'inventory',
    'fixed_asset', 'accumulated_depreciation', 'other_asset',
    'accounts_payable', 'other_current_liability', 'long_term_liability',
    'equity', 'revenue', 'other_income', 'cogs', 'operating_expense', 'other_expense'
];

// Canonical Chart of Accounts seed — the single source of truth shared by the
// seeder, db-service catalogs, and the mapping UI so they can never drift.
//
// FOUR independent flags per entry — do not conflate them, they gate different
// things (docs/ACCOUNTING_SPEC_REVIEW.md §7):
//   `is_system`               rename/archive is locked (the engines hardcode it)
//   `mappable: false`         not an auto-mapping / categorization TARGET
//   `allow_manual_journal`    a human may NOT name it on a manual journal line
//   `allow_direct_transaction` a human may NOT pick it on a transaction/bill line
// The last two are the control layer: subledger accounts (A/R, A/P), cash,
// equity, and the tax control accounts must be moved by the posting engine only,
// or the aging report stops tying to the balance sheet. All four DEFAULT TO
// PERMISSIVE when absent — fail-open is deliberate, since a user-created account
// carries none of them and must stay pickable.
//
// `normal_balance` is only stated on contra accounts (3200, 4900) — everything
// else derives from type. `name_id` is the Bahasa display name (data for
// reports/AI; UI localization still flows through dashboard-i18n.js).
export const CHART_OF_ACCOUNTS_SEED = [
    // --- Assets
    { code: '1000', name: 'Cash & Bank', name_id: 'Kas & Bank', type: 'asset', sak_category: 'cash_bank', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '1100', name: 'Accounts Receivable', name_id: 'Piutang Usaha', type: 'asset', sak_category: 'accounts_receivable', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    // Marketplace / payment-gateway settlement float: money a customer has paid
    // that the platform has NOT yet deposited. Deliberately NOT sak_category
    // 'cash_bank' — it is not spendable, and grouping it with cash would overstate
    // the cash position and make the bank reconciliation untieable by design.
    // Hand-codeable (a settlement row gets coded here) but closed to manual
    // journals: it clears by matching gross settlement to net deposit, and a manual
    // entry leaves residue nothing can ever match off.
    // ⚠️ Seeded but NOT yet wired — see docs/ACCOUNTING_SPEC_REVIEW.md §7.4b.
    { code: '1030', name: 'Payment Gateway Clearing', name_id: 'Dana Mengendap Gateway', type: 'asset', sak_category: 'other_current_asset', is_system: true, mappable: false, allow_manual_journal: false },
    // Stock held for sale, at cost. Closed to BOTH human surfaces for the same
    // reason 1100 A/R and 2000 A/P are: the balance must equal Σ(quantity × unit
    // cost) held in the inventory subledger, and it can only stay true if stock
    // moves exclusively through that subledger. A category mapped straight to
    // 1200 would build an asset balance no stock count can ever reconcile to.
    // Opening balances are still reachable — assertManualJournalPolicy exempts
    // subtype 'opening', which is how an existing shopkeeper records what is
    // already on the shelf.
    // WIRED 2026-08-16: GR-RECEIPT debits this on goods receipt. The subledger
    // that must tie to it is `stock_movements` (docs/data-model/stock.md).
    { code: '1200', name: 'Inventory', name_id: 'Persediaan', type: 'asset', sak_category: 'inventory', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    // Fixed assets. `fixed_asset`, `accumulated_depreciation`, `other_asset` and
    // `long_term_liability` were ALLOWED sak_categories with no seeded account
    // behind any of them, so a general Indonesian UMKM had nowhere to record the
    // motorbike, the oven or the bank loan, and the balance sheet's non-current
    // sections were structurally unreachable. statements-engine already
    // classified all four (NON_CURRENT_ASSET_CATEGORIES /
    // NON_CURRENT_LIABILITY_CATEGORIES) — the plumbing was there, the accounts
    // were not. Added 2026-08-29.
    //
    // NOT is_system: a business renames and archives these freely, unlike the
    // control accounts above, which the posting engine addresses by code.
    { code: '1500', name: 'Equipment & Machinery', name_id: 'Peralatan & Mesin', type: 'asset', sak_category: 'fixed_asset' },
    { code: '1510', name: 'Vehicles', name_id: 'Kendaraan', type: 'asset', sak_category: 'fixed_asset' },
    { code: '1520', name: 'Buildings', name_id: 'Bangunan', type: 'asset', sak_category: 'fixed_asset' },
    // Contra-asset: it sits in the asset block and reduces it, so its normal
    // balance is a CREDIT — the same treatment 3200 and 4900 get. Depreciation
    // credits this rather than the asset, so cost and wear stay separately
    // visible, which is what a fixed-asset register will need when it exists.
    { code: '1590', name: 'Accumulated Depreciation', name_id: 'Akumulasi Penyusutan', type: 'asset', sak_category: 'accumulated_depreciation', normal_balance: 'credit' },
    { code: '1800', name: 'Intangible & Other Assets', name_id: 'Aset Tidak Berwujud & Lainnya', type: 'asset', sak_category: 'other_asset' },
    // --- Liabilities
    // Goods Received Not Invoiced: stock physically received whose supplier bill
    // has not arrived. Without it, receiving stock has to either wait for the
    // bill (understating inventory) or fake an A/P entry against a vendor who has
    // not billed yet (overstating payables and breaking the A/P aging tie-out).
    // Clears by matching the receipt to the bill, so — like 1030 — a manual entry
    // leaves residue nothing can ever match off.
    // WIRED 2026-08-16: GR-RECEIPT credits it, BILL-GRNI debits it back out.
    { code: '2050', name: 'Goods Received Not Invoiced', name_id: 'Barang Diterima Belum Ditagih', type: 'liability', sak_category: 'other_current_liability', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '2000', name: 'Accounts Payable', name_id: 'Utang Usaha', type: 'liability', sak_category: 'accounts_payable', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '2500', name: 'Deferred Revenue', name_id: 'Pendapatan Diterima di Muka', type: 'liability', sak_category: 'other_current_liability' },
    { code: '2700', name: 'Long-term Bank Loan', name_id: 'Utang Bank Jangka Panjang', type: 'liability', sak_category: 'long_term_liability' },
    // Suspense — where money that arrived but cannot yet be identified parks,
    // instead of guessing an account. A LIABILITY on purpose: 6999 Other Expense
    // is the fallback for "an expense we couldn't classify further", which is a
    // different thing, and parking an unidentified RECEIPT there would understate
    // net income. Seeded dormant (nothing posts here yet), the way the tax accounts
    // were seeded ahead of tax-engine.js. Hand-codeable so a bank row can be parked
    // here, and clearable by manual journal — that is the entire workflow.
    { code: '2800', name: 'Suspense', name_id: 'Akun Sementara', type: 'liability', sak_category: 'other_current_liability', is_system: true, mappable: false },
    // --- Equity
    { code: '3000', name: 'Retained Earnings', name_id: 'Laba Ditahan', type: 'equity', sak_category: 'equity', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '3100', name: 'Owner Capital', name_id: 'Modal Pemilik', type: 'equity', sak_category: 'equity' },
    { code: '3200', name: 'Owner Drawings (Prive)', name_id: 'Prive', type: 'equity', sak_category: 'equity', normal_balance: 'debit' },
    // 3900 blocks manual journals EXCEPT the `opening` subtype — see
    // assertManualJournalPolicy: opening balances are the one legitimate human
    // path into cash/equity, and the Manual Journal editor is the only in-app way
    // to record them (buildOpeningJournal has no caller).
    { code: '3900', name: 'Opening Balance Equity', name_id: 'Ekuitas Saldo Awal', type: 'equity', sak_category: 'equity', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    // --- Revenue
    { code: '4000', name: 'Revenue', name_id: 'Pendapatan', type: 'revenue', sak_category: 'revenue', is_system: true },
    // Service charge collected on a till bill. REVENUE, and its own account
    // rather than folded into 4000, for the reason 5150 is kept out of COGS: a
    // service charge is not what the menu earned, and a gross-margin figure that
    // absorbs it is one an owner cannot act on. Separating it is also what makes
    // "are we distributing what we collected" answerable later.
    //
    // ⚠️ THE OTHER TREATMENT IS A LIABILITY, and it is the right one wherever the
    // charge is passed to staff rather than kept. That is a payroll arrangement
    // this product does not model, so the default is the one that is true for a
    // business that keeps it. If a workspace distributes it, the distribution is
    // an expense against this account, not a reason to book the collection as a
    // payable it has no subledger for.
    //
    // is_system: the posting engine addresses it by literal code, so it must not
    // be archived out from under POS-SALE.
    { code: '4100', name: 'Service Charge', name_id: 'Biaya Layanan', type: 'revenue', sak_category: 'revenue', parent_code: '4000', is_system: true },
    { code: '4900', name: 'Sales Discounts & Returns', name_id: 'Diskon & Retur Penjualan', type: 'revenue', sak_category: 'revenue', parent_code: '4000', normal_balance: 'debit' },
    // --- Cost of Goods Sold
    { code: '5100', name: 'Cost of Goods Sold', name_id: 'Harga Pokok Penjualan', type: 'expense', sak_category: 'cogs' },
    // Shrinkage, spoilage, wastage, and stock-count differences. Deliberately
    // `operating_expense` and NOT `cogs`: COGS is the cost of stock a customer
    // actually bought, and folding spoiled inventory into it makes gross margin
    // read as though the loss were a cost of selling. For F&B — where wastage is
    // routine and material — that is the difference between a margin figure an
    // owner can act on and one that quietly absorbs the problem it should expose
    // (PRODUCT_STRATEGY.md §7). Left open on every surface: writing stock off is
    // a human judgement, and a category mapped here is a reasonable stopgap
    // before the subledger ships.
    { code: '5150', name: 'Inventory Adjustment & Shrinkage', name_id: 'Penyesuaian & Susut Persediaan', type: 'expense', sak_category: 'operating_expense' },
    // --- Operating expenses. 61xx-66xx system entries are default resolution
    // targets (CATEGORY_DEFAULTS / TYPE_EXPENSE_DEFAULTS below).
    { code: '6100', name: 'Marketing Expense', name_id: 'Beban Pemasaran', type: 'expense', sak_category: 'operating_expense', is_system: true },
    { code: '6200', name: 'Software / SaaS Expense', name_id: 'Beban Software / SaaS', type: 'expense', sak_category: 'operating_expense', is_system: true },
    { code: '6300', name: 'Infrastructure Expense', name_id: 'Beban Infrastruktur', type: 'expense', sak_category: 'operating_expense', is_system: true },
    { code: '6400', name: 'Operations Expense', name_id: 'Beban Operasional', type: 'expense', sak_category: 'operating_expense', is_system: true },
    { code: '6410', name: 'Salaries & Wages', name_id: 'Beban Gaji', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6420', name: 'Rent Expense', name_id: 'Beban Sewa', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6430', name: 'Utilities', name_id: 'Beban Utilitas', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6440', name: 'Office Supplies', name_id: 'Perlengkapan Kantor', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6450', name: 'Travel & Entertainment', name_id: 'Perjalanan & Entertain', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6460', name: 'Professional Services', name_id: 'Jasa Profesional', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6470', name: 'Depreciation & Amortisation', name_id: 'Beban Penyusutan & Amortisasi', type: 'expense', sak_category: 'operating_expense', parent_code: '6400' },
    { code: '6500', name: 'Tax Expense', name_id: 'Beban Pajak', type: 'expense', sak_category: 'operating_expense', is_system: true },
    // Cash Over & Short. The drawer never counts to the penny, and the gap is a
    // real operating cost the moment it is systematic. A SINGLE account that
    // swings both ways is the standard treatment: a credit balance means the
    // tills ran over, which is as much a control signal as running short.
    //
    // Deliberately NOT netted into sales. Folding a short into revenue hides the
    // exact thing a shift close exists to expose, the same way waste is kept out
    // of COGS (5150) so spoilage cannot hide inside gross margin.
    { code: '6700', name: 'Cash Over & Short', name_id: 'Selisih Kas', type: 'expense', sak_category: 'operating_expense', is_system: true, mappable: false, allow_direct_transaction: false },
    { code: '6600', name: 'Bank Fees', name_id: 'Biaya Bank', type: 'expense', sak_category: 'operating_expense', is_system: true },
    { code: '6999', name: 'Other Expense', name_id: 'Beban Lainnya', type: 'expense', sak_category: 'other_expense', is_system: true },
    // --- Other income
    { code: '7100', name: 'Interest Income', name_id: 'Pendapatan Bunga', type: 'revenue', sak_category: 'other_income' },
    { code: '7200', name: 'FX Gain/Loss', name_id: 'Laba/Rugi Selisih Kurs', type: 'revenue', sak_category: 'other_income' },
    // --- Indonesia Tax Center accounts (see docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md
    // §5). Inactive for posting until tax-engine.js emits lines against them; seeded so
    // the chart is complete and tax journals resolve account names without a lookup.
    // The tax control accounts are fed by tax-engine.js and the Tax Center's own
    // posting paths (recordCorporateTaxPayment / postAnnualCorporateTax), which
    // call buildManualJournal directly and are NOT subject to the human policy
    // gate — that gate lives in postManualJournal only.
    { code: '1130', name: 'PPN Masukan (Input VAT)', name_id: 'PPN Masukan', type: 'asset', sak_category: 'other_current_asset', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '1140', name: 'Prepaid PPh 25', name_id: 'PPh 25 Dibayar di Muka', type: 'asset', sak_category: 'other_current_asset', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '1150', name: 'PPh Dipotong Pihak Lain', name_id: 'PPh Dipotong Pihak Lain', type: 'asset', sak_category: 'other_current_asset', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '2100', name: 'PPN Keluaran (Output VAT)', name_id: 'PPN Keluaran', type: 'liability', sak_category: 'other_current_liability', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '2110', name: 'PPh Payable', name_id: 'Utang PPh', type: 'liability', sak_category: 'other_current_liability', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false },
    { code: '2200', name: 'PPh 29 Payable', name_id: 'Utang PPh 29', type: 'liability', sak_category: 'other_current_liability', is_system: true, mappable: false, allow_manual_journal: false, allow_direct_transaction: false }
];

/*
 * Per-market names for the six TAX accounts.
 *
 * The tax SLOTS are universal — input tax, output tax, prepaid income tax,
 * creditable withholding, withholding payable, income tax payable — so the CODES
 * stay identical across markets. That is deliberate and load-bearing: posting
 * rules in this file, tax-engine.js and db-service.js resolve these accounts by
 * literal code, so re-numbering per country would silently break every posting
 * that references one. Only the NAMES differ.
 *
 * What changes is the instrument a business actually recognises. "PPN Masukan"
 * and "PPh 29" are Indonesian tax law; a Philippine owner has neither, and being
 * shown them in their own chart of accounts reads as somebody else's books.
 *
 * ID is the baseline and MUST stay byte-identical to CHART_OF_ACCOUNTS_SEED —
 * every existing workspace was seeded from it, and the seeder never renames an
 * account that already exists.
 */
const TAX_ACCOUNT_NAMES = {
    ID: {},   // baseline — the seed's own names
    PH: {
        '1130': { name: 'Input VAT', name_id: 'Input VAT' },
        '1140': { name: 'Prepaid Income Tax', name_id: 'Prepaid Income Tax' },
        '1150': { name: 'Creditable Withholding Tax (BIR 2307)', name_id: 'Creditable Withholding Tax (BIR 2307)' },
        '2100': { name: 'Output VAT', name_id: 'Output VAT' },
        '2110': { name: 'Withholding Tax Payable', name_id: 'Withholding Tax Payable' },
        '2200': { name: 'Income Tax Payable', name_id: 'Income Tax Payable' },
    },
    SG: {
        '1130': { name: 'Input GST', name_id: 'Input GST' },
        '1140': { name: 'Prepaid Income Tax', name_id: 'Prepaid Income Tax' },
        '1150': { name: 'Withholding Tax Receivable', name_id: 'Withholding Tax Receivable' },
        '2100': { name: 'Output GST', name_id: 'Output GST' },
        '2110': { name: 'Withholding Tax Payable', name_id: 'Withholding Tax Payable' },
        '2200': { name: 'Income Tax Payable', name_id: 'Income Tax Payable' },
    },
    MY: {
        '1130': { name: 'Input Tax (SST)', name_id: 'Input Tax (SST)' },
        '1140': { name: 'Prepaid Income Tax', name_id: 'Prepaid Income Tax' },
        '1150': { name: 'Withholding Tax Receivable', name_id: 'Withholding Tax Receivable' },
        '2100': { name: 'Output Tax (SST)', name_id: 'Output Tax (SST)' },
        '2110': { name: 'Withholding Tax Payable', name_id: 'Withholding Tax Payable' },
        '2200': { name: 'Income Tax Payable', name_id: 'Income Tax Payable' },
    },
};

/**
 * The chart to seed for a market. Same 38 accounts and the same codes in the same
 * order — only the six tax names are localised. An unknown or absent country
 * returns the Indonesian baseline unchanged, so nothing existing can shift.
 */
export function chartForCountry(country) {
    const overrides = TAX_ACCOUNT_NAMES[String(country || '').toUpperCase()];
    if (!overrides || !Object.keys(overrides).length) return CHART_OF_ACCOUNTS_SEED;
    return CHART_OF_ACCOUNTS_SEED.map((a) => (overrides[a.code] ? { ...a, ...overrides[a.code] } : a));
}

export { TAX_ACCOUNT_NAMES };

// Bumped whenever CHART_OF_ACCOUNTS_SEED gains fields the seeder must backfill
// onto already-seeded workspaces. seedChartOfAccounts heals any doc whose stored
// seed_version is lower, so the next change is a one-line bump rather than a new
// ad-hoc "is this field missing?" predicate.
//   1 → implicit (pre-versioning, healed off `!sak_category`)
//   2 → allow_manual_journal / allow_direct_transaction / mappable persisted
//   3 → 1200 Inventory, 2050 GRNI, 5150 Inventory Adjustment seeded dormant
//
// ⚠️ The heal branch rewrites `is_system` and the policy flags on any doc below
// the current version, and it cannot tell a stale seeded doc from a user-created
// one that happens to share a code (saveAccount stamps seed_version too). A
// workspace that hand-made its own `1200` would have it converted to the locked
// system account by this bump. The account drawer hands out 13xx for
// sak_category 'inventory', so a collision is unlikely rather than impossible —
// query production for existing 1200/2050/5150 before the subledger ships.
export const CHART_SEED_VERSION = 3;

// Resolve the posting policy of an account row from EITHER the seed or a live
// Firestore doc. Every flag defaults to permissive when absent: a user-created
// account carries none of them, and fail-closed would make the entry drawer
// unusable. Structural accounts are locked down explicitly in the seed instead.
export function accountPolicy(account) {
    const a = account || {};
    return {
        mappable: a.mappable !== false,
        allow_manual_journal: a.allow_manual_journal !== false,
        allow_direct_transaction: a.allow_direct_transaction !== false
    };
}

// Codes whose rename/archive is locked: the posting/tax engines hardcode them
// or default resolution can post to them. Derived so guards/tests share one list.
export const SYSTEM_ACCOUNT_CODES = CHART_OF_ACCOUNTS_SEED
    .filter((a) => a.is_system)
    .map((a) => a.code);

// Fast lookup: code -> { name, name_id, type, sak_category }.
const ACCOUNT_INDEX = CHART_OF_ACCOUNTS_SEED.reduce((acc, a) => {
    acc[a.code] = { name: a.name, name_id: a.name_id || a.name, type: a.type, sak_category: a.sak_category || null };
    return acc;
}, {});

// Whole seed entries by code, INCLUDING the policy flags — ACCOUNT_INDEX above
// deliberately carries display fields only, so policy checks must use this.
const CHART_SEED_INDEX = CHART_OF_ACCOUNTS_SEED.reduce((acc, a) => { acc[a.code] = a; return acc; }, {});

// Fixed account codes used by the posting rules.
const CASH = '1000';
const CLEARING = '1030';   // marketplace/gateway settlement float
const AR = '1100';
const AP = '2000';
// Goods received, supplier invoice not yet arrived. Clears when the bill is
// matched to the receipt — see BILL-GRNI.
const GRNI = '2050';
// Stock at cost. A control account: its balance must equal the sum of
// quantity x unit cost held in stock_movements, which is why it is closed to
// both human posting surfaces (docs/data-model/chart-of-accounts.md §4b).
const INVENTORY = '1200';
const RETAINED_EARNINGS = '3000';
const OPENING_EQUITY = '3900';
// Depreciation: the expense it lands in, and the contra-asset it credits.
// Cost and accumulated wear stay separately visible on the balance sheet,
// which is why the credit is 1590 rather than the asset account itself.
const DEPRECIATION_EXPENSE = '6470';
const ACCUMULATED_DEPRECIATION = '1590';
const REVENUE = '4000';
const SERVICE_CHARGE = '4100'; // service charge collected on a till bill
const SALES_RETURNS = '4900';  // contra-revenue (debit normal) — refunds/returns
// Output VAT. Seeded dormant with the rest of the Tax Center accounts and woken
// up by the till: tax on a bill is money collected FOR the government, so it is
// a liability from the moment the customer pays it, never revenue.
const OUTPUT_TAX = '2100';
const FEE_EXPENSE = '6600';
const TAX_EXPENSE = '6500';
const UNMAPPED_EXPENSE = '6999';
// Cost of stock a customer actually bought.
const COGS = '5100';
// Spoilage, breakage, shrinkage. Deliberately NOT 5100: folding waste into COGS
// makes gross margin absorb the loss it should expose, which for F&B is the
// difference between a margin an owner can act on and one that hides the
// problem (PRODUCT_STRATEGY.md §7).
const WASTE = '5150';
// The drawer's counted-versus-expected gap at shift close.
const CASH_VARIANCE = '6700';

// Category/type → expense (or revenue) account. Mirrors ACCOUNTING_CATEGORY_DEFAULTS
// and ACCOUNTING_TYPE_DEFAULTS in db-service.js. Kept here so the engine resolves
// accounts without a Firestore round-trip.
const CATEGORY_DEFAULTS = {
    Revenue: REVENUE,
    Marketing: '6100',
    SaaS: '6200',
    Infrastructure: '6300',
    Operations: '6400'
};
const TYPE_EXPENSE_DEFAULTS = {
    fee: FEE_EXPENSE,
    tax: TAX_EXPENSE
};

// --- small pure helpers ---------------------------------------------------

// Live per-build overlay of the workspace's Chart of Accounts (code → {type,name,…})
// so posting can honor USER-CREATED accounts, which are absent from the static seed
// ACCOUNT_INDEX. Set by buildJournal for the duration of one build (see setLiveAccounts).
let _liveAccounts = null;
function acctInfo(code) {
    return (_liveAccounts && _liveAccounts[code]) || ACCOUNT_INDEX[code] || null;
}

export function accountByCode(code) {
    return acctInfo(code);
}

export function normalBalanceOf(type) {
    return NORMAL_BALANCE[type] || 'debit';
}

// Signed running balance for GL/trial-balance display: positive in the account's
// natural direction. An asset with more debits than credits shows positive; a
// liability with more credits than debits shows positive.
export function signedBalance(type, debitTotal, creditTotal) {
    const d = toInt(debitTotal);
    const c = toInt(creditTotal);
    return normalBalanceOf(type) === 'debit' ? d - c : c - d;
}

// --- Chart of Accounts validation (pure; Firestore I/O stays in db-service) ---

// Account codes are 4 digits, first digit 1-9 (thousand-block numbering, §A of
// docs/CHART_OF_ACCOUNTS_STRATEGY.md). Codes are append-only and never renumbered.
export function isValidAccountCode(code) {
    return /^[1-9][0-9]{3}$/.test(String(code || ''));
}

// Expected account type per thousand-range. 5xxx (COGS), 6xxx (opex), and 8xxx
// are all `expense` at the type layer — sak_category carries the finer split.
export function accountTypeForCode(code) {
    const block = String(code || '').charAt(0);
    return {
        1: 'asset', 2: 'liability', 3: 'equity', 4: 'revenue',
        5: 'expense', 6: 'expense', 7: 'revenue', 8: 'expense'
    }[block] || null;
}

export function isValidSakCategory(value) {
    return SAK_CATEGORIES.includes(value);
}

// Validate a create/update draft. `parent` is the resolved parent account doc
// when draft.parent_code is set (the caller fetches it — this stays pure).
// Returns { ok, errors } so the UI can surface every problem at once.
export function validateAccountDraft(draft = {}, { parent = null } = {}) {
    const errors = [];
    const code = String(draft.code || '').trim();
    if (!isValidAccountCode(code)) errors.push('Account code must be 4 digits (1000-9999).');
    const expectedType = accountTypeForCode(code);
    if (!ACCOUNT_TYPES.includes(draft.type)) errors.push('Account type is invalid.');
    else if (expectedType && draft.type !== expectedType) errors.push(`Code ${code} must be a ${expectedType} account.`);
    const name = String(draft.name || '').trim();
    if (!name || name.length > 120) errors.push('Account name is required (max 120 characters).');
    if (draft.name_id != null && String(draft.name_id).length > 120) errors.push('Indonesian name is too long (max 120 characters).');
    if (draft.sak_category != null && !isValidSakCategory(draft.sak_category)) errors.push('SAK category is invalid.');
    if (draft.parent_code) {
        const parentCode = String(draft.parent_code).trim();
        if (parentCode === code) errors.push('An account cannot be its own parent.');
        else if (!parent) errors.push('Parent account does not exist.');
        else {
            if (parent.type !== draft.type) errors.push('Parent account must have the same type.');
            if (String(parent.code || '').charAt(0) !== code.charAt(0)) errors.push('Parent account must share the same code range.');
        }
    }
    return { ok: errors.length === 0, errors };
}

// Deterministic period key 'YYYY-MM' in Asia/Jakarta (Indonesian business
// reporting timezone) so a transaction near midnight lands in the right month
// regardless of the server's UTC clock. Accepts a JS Date, ms number, or a
// Firestore-Timestamp-like { toDate() } / { seconds }.
export function periodKey(dateInput) {
    const date = coerceDate(dateInput);
    // en-CA gives ISO-style YYYY-MM-DD; slice to YYYY-MM.
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
}

function coerceDate(input) {
    if (!input) return new Date();
    if (input instanceof Date) return input;
    if (typeof input === 'number') return new Date(input);
    if (typeof input?.toDate === 'function') return input.toDate();
    if (typeof input?.seconds === 'number') return new Date(input.seconds * 1000);
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

// --- structured errors ----------------------------------------------------

// Stable codes for every way posting can be refused. Callers discriminate on
// `err.code`, never on the English message: before this existed, the scan drawer
// decided whether to show a real reason by regex-matching the message text, so
// translating a string would silently have changed control flow.
//
// Codes follow the GL_* taxonomy in docs/ACCOUNTING_SPEC_REVIEW.md §7 so the
// finance spec and the implementation share one vocabulary.
export const GL = {
    UNBALANCED: 'GL_001',        // Σdebit ≠ Σcredit
    TOO_FEW_LINES: 'GL_002',     // fewer than two posting lines (incl. all-blank)
    ZERO_AMOUNT: 'GL_003',       // a rule produced a non-positive amount
    MANUAL_BLOCKED: 'GL_010',    // allow_manual_journal === false
    DIRECT_BLOCKED: 'GL_011',    // allow_direct_transaction === false
    ARCHIVED: 'GL_012',          // account is archived
    PERIOD_LOCKED: 'GL_020',     // period status 'locked'
    PERIOD_CLOSED: 'GL_021',     // period status 'closed'
    // GL_070+ is the FluxyOS-local extension range — deliberately clear of the
    // spec's own 001–060 so adopting more of its codes later cannot collide.
    REVERSAL_OF_REVERSAL: 'GL_070'
};

// Build an Error carrying a GL code plus the values that were interpolated into
// the message. `details` is what makes the message translatable at the render
// site (FluxyI18n.t('gl.GL_020', details)) without parsing English back out.
// A factory rather than a subclass: keeps `instanceof Error`, stays structured-
// cloneable-ish for tests, and adds no dependency to this file.
export function glError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    err.domain = 'accounting';
    err.details = details || {};
    return err;
}

// Positive integer amount or throw — posting must never silently drop a value.
function requireAmount(value, context) {
    const n = toInt(value);
    if (n <= 0) {
        throw glError(GL.ZERO_AMOUNT, `accounting-engine: non-positive amount for ${context} (${value})`,
            { context, value: String(value) });
    }
    return n;
}

function line(accountCode, debit, credit, memo) {
    const account = accountByCode(accountCode);
    return {
        account_code: accountCode,
        account_type: account ? account.type : 'expense',
        account_name: account ? account.name : accountCode,
        debit: toInt(debit),
        credit: toInt(credit),
        currency: (typeof window !== 'undefined' && window.FluxyMoney ? window.FluxyMoney.baseCurrency() : 'IDR'),
        fx_rate: 1,
        functional_amount: toInt(debit) || toInt(credit),
        memo: memo || '',
        // Outlet / branch / warehouse this line belongs to. Always present and
        // null by default — see stampDimension below for why the shape is fixed
        // here rather than added by whoever first needs it.
        dimension_id: null
    };
}

// --- Dimension seam --------------------------------------------------------
// A dimension is an outlet, branch, or warehouse: the "where" of a posting, as
// opposed to the "what" the account already answers. Nothing sets one yet, so
// every line ships `dimension_id: null` and every existing behaviour is
// unchanged.
//
// It lives on the LINE, not the journal, because that is the only placement that
// survives contact with reality: a bill covering two outlets has to split, and a
// journal-level field would force a second journal per outlet and break the
// one-document-one-journal relationship the source drill-down depends on.
//
// It is stamped here, after the rule builder returns, rather than threaded
// through `line()`'s positional arguments — that would mean editing all fourteen
// rule builders for a value none of them reason about. A line that already
// carries a dimension keeps it, so a future line-level picker overrides the
// document-level default without this function changing.
//
// Why the field exists before the feature: `entity_id` on journals, accounts and
// balances is stamped as the workspace id and nothing else (`_resolvedScopeId`),
// so it is a constant, not a dimension. Adding a real one AFTER stock movements
// and per-outlet postings exist means backfilling posted journals — which are
// immutable by rule. Cutting the seam first costs a null field.
// Full design: docs/DIMENSION_SEAM_DESIGN.md.
export function stampDimension(lines, dimensionId) {
    const dim = String(dimensionId || '').trim() || null;
    if (!dim) return lines || [];
    return (lines || []).map((l) => (l.dimension_id ? l : { ...l, dimension_id: dim }));
}

// An explicit account chosen in the entry drawer (document.account_code) wins over
// automatic resolution when it names a real account. `requiredType` (optional)
// rejects a code of the wrong account type — so an income posting can't be pinned
// to an expense account, and vice versa — falling back to normal resolution.
export function explicitAccount(document, requiredType) {
    const code = String(document?.account_code || '').trim();
    if (!code) return null;
    const acct = acctInfo(code);
    if (!acct) return null;
    // GL_011: a structural account the posting engine owns (A/R, A/P, cash,
    // equity, tax control) may never be hand-picked onto a document line. The
    // picker already hides these, so reaching here means a crafted payload or a
    // stale cached chart. THROW rather than return null: falling through to the
    // default resolution chain would silently post to a different account than the
    // user chose, which is worse than a refusal.
    const seed = CHART_SEED_INDEX[code];
    if (seed && seed.allow_direct_transaction === false) {
        throw glError(GL.DIRECT_BLOCKED,
            `${code} ${seed.name} is maintained by the posting engine and cannot be selected on a transaction.`,
            { account_code: code, account_name: seed.name });
    }
    if (requiredType && acct.type !== requiredType) return null;
    return code;
}

// Resolve the income/expense account for a document, honoring (in priority):
// an explicit account_code, then a saved accounting_mapping for the category,
// then the type, then category defaults, then type defaults, then the
// unmapped-expense fallback.
function resolveExpenseAccount(document, mappings) {
    // Honor the account the user explicitly picked in the drawer — any real account
    // in the live chart, not just expense-typed (the picker controls what's offered).
    const explicit = explicitAccount(document);
    if (explicit) return explicit;
    const category = String(document?.category || '').trim();
    const type = String(document?.type || '').trim().toLowerCase();
    const map = mappings || {};
    if (category && map[`category:${category}`]) return map[`category:${category}`];
    if (type && map[`type:${type}`]) return map[`type:${type}`];
    if (category && CATEGORY_DEFAULTS[category]) return CATEGORY_DEFAULTS[category];
    if (TYPE_EXPENSE_DEFAULTS[type]) return TYPE_EXPENSE_DEFAULTS[type];
    return UNMAPPED_EXPENSE;
}

// The account the posting engine would use for the categorizing (non-cash) line
// of a transaction, given only its type + category (no amount needed). Powers the
// entry drawer's smart default so the pre-filled Account matches what will post.
// Income posts to Revenue (4000) unless the category resolves to a revenue
// account; everything else runs the standard expense resolution chain.
export function suggestCategorizingAccount(document, mappings) {
    const type = String(document?.type || '').trim().toLowerCase();
    const incomeLike = type === 'income' || type === 'revenue' || type === 'refund' || type === 'pending_receivable';
    if (incomeLike) {
        const cat = String(document?.category || '').trim();
        const mapped = cat && (mappings || {})[`category:${cat}`];
        if (mapped && ACCOUNT_INDEX[mapped] && ACCOUNT_INDEX[mapped].type === 'revenue') return mapped;
        const def = cat && CATEGORY_DEFAULTS[cat];
        if (def && ACCOUNT_INDEX[def] && ACCOUNT_INDEX[def].type === 'revenue') return def;
        return REVENUE;
    }
    return resolveExpenseAccount(document, mappings);
}

// --- rule selection -------------------------------------------------------

// Decide which posting rule a (collection, document) pair triggers, or null to
// skip posting (e.g. transfers, adjustments, free-text "Others" types, or an
// invoice still in draft). Payment transactions that carry a linked_bill_id /
// linked_invoice_id post the *settlement* rule (Dr A/P or Cr A/R) so the accrual
// they settle is not double-counted as a fresh expense/revenue.
// A row the commerce integration wrote (netlify/functions/lib/commerce — the
// `source: 'commerce'` marker). These settle through the marketplace, never
// directly through a bank account, so they post against 1030 Clearing.
function isCommerceSourced(doc) {
    return String(doc && doc.source || '').trim().toLowerCase() === 'commerce';
}

// A row the point of sale wrote. POS is commerce that happens in the room rather
// than on a marketplace (PRODUCT_STRATEGY.md §6) — same shape: an order document,
// a posting rule, and the kernel does the rest.
//
// It gets its own rule rather than reusing TXN-INC-CASH for one reason: a POS sale
// carries a DISCOUNT, and a discount folded into the price is gone forever — no
// menu price integrity, no discount analytics, no anomaly detection. POS-SALE
// posts it as contra-revenue so the gross price survives into the ledger.
function isPosSourced(doc) {
    return String(doc && doc.source || '').trim().toLowerCase() === 'pos';
}

// Cash reaches the drawer immediately; QRIS / card / e-wallet sit with the
// acquirer until payout. Routing non-cash to 1030 rather than 1000 is what keeps
// the bank reconciliation tieable and makes 1030's balance the unsettled float —
// the same reason CM-ORDER-REV does it, and the payout clears through CM-SETTLE.
function posSettlementAccount(doc) {
    return String(doc && doc.pos_settlement || '').trim().toLowerCase() === 'clearing' ? CLEARING : CASH;
}

// How a till sale's money splits between 1000 Cash and 1030 Clearing.
//
// A split bill is the normal case, not an edge case: half cash, half QRIS is
// what an Indonesian F&B customer actually does. Until 2026-08-30 the whole sale
// was routed to whichever method was LARGEST, so a Rp200.000 bill paid
// Rp120.000 cash + Rp80.000 QRIS booked all Rp200.000 to cash. The bank
// reconciliation was then wrong by the minority tender and 1030 — whose balance
// is supposed to BE the unsettled float — was wrong by the same amount. Silent
// in both directions, which is the failure mode this project cares about most.
//
// The apportionment rule: NON-CASH TENDER IS EXACT, CASH ABSORBS THE REMAINDER.
// Nobody overpays a QRIS or a card, and change is only ever given in cash — so
// scaling both sides proportionally would mis-split any sale where the customer
// tendered more than the bill. Clearing takes its exact total (capped at the
// amount), cash takes what is left, and the two therefore always sum to the
// amount with no rounding drift and no possibility of an unbalanced journal.
//
// LEGACY ROWS HAVE NO SPLIT. Every transaction posted before this shipped
// carries only `pos_settlement`, and `postPendingJournals` may still re-post one.
// Those fall back to the old single-account behaviour, so historical journals
// stay reproducible — a re-post must never produce a different journal than the
// one already on the books.
function posSettlementSplit(doc, amount) {
    const total = toInt(amount);
    const d = doc || {};
    if (d.pos_cash_amount != null || d.pos_clearing_amount != null) {
        const cash = Math.max(0, toInt(d.pos_cash_amount));
        const clearing = Math.max(0, toInt(d.pos_clearing_amount));
        // Only trust the split when it is internally consistent. The DAL
        // guarantees this (cash is DERIVED as total − clearing), so the fallback
        // below is unreachable in practice — but an unbalanced journal is not a
        // thing worth risking on that assurance.
        if (cash + clearing === total) return { cash, clearing };
    }
    return posSettlementAccount(d) === CLEARING
        ? { cash: 0, clearing: total }
        : { cash: total, clearing: 0 };
}

export function selectRule(collection, document) {
    const doc = document || {};
    if (collection === 'transactions') {
        if (doc.linked_bill_id) return 'BILL-PAY';
        if (doc.linked_invoice_id) return 'INV-PAY';
        const type = String(doc.type || '').trim().toLowerCase();
        // Commerce settles through the platform, not the bank. Posting an order to
        // Cash on the order date overstates cash by the whole unsettled balance and
        // makes the bank reconciliation untieable — the money is still with the
        // marketplace until payout. Route the whole cycle through 1030 instead, so
        // its balance IS the unsettled float and the payout clears it.
        if (isCommerceSourced(doc)) {
            switch (type) {
                case 'income':
                case 'revenue':
                    return 'CM-ORDER-REV';
                case 'fee':
                    return 'CM-ORDER-FEE';
                case 'refund':
                    return 'CM-ORDER-REFUND';
                case 'transfer':
                    return 'CM-SETTLE';
                default:
                    break; // anything else falls through to the standard rules
            }
        }
        // A till sale. Cash and non-cash both post POS-SALE; the settlement side
        // differs inside the rule. A non-cash payout later clears 1030 through
        // CM-SETTLE, which is a `transfer` and already routed above.
        if (isPosSourced(doc)) {
            switch (type) {
                case 'income':
                case 'revenue':
                    return 'POS-SALE';
                case 'refund':
                    return 'POS-REFUND';
                case 'transfer':
                    return 'CM-SETTLE';
                default:
                    break;
            }
        }
        switch (type) {
            case 'income':
            case 'revenue':
            case 'refund':
                return 'TXN-INC-CASH';
            case 'expense':
                return 'TXN-EXP-CASH';
            case 'fee':
            case 'tax':
                return 'TXN-OPEX-CASH';
            case 'pending_receivable':
                return 'TXN-ACCRUE-AR';
            case 'pending_payable':
                return 'TXN-ACCRUE-AP';
            default:
                return null; // transfer / adjustment / custom — no posting
        }
    }
    if (collection === 'bills') {
        // A bill that settles a goods receipt must clear GRNI, not book a second
        // expense: the cost already entered the books as inventory when the
        // goods arrived. Posting BILL-ACCRUE here would double-count it and
        // leave GRNI open forever.
        if (doc.goods_receipt_id) return 'BILL-GRNI';
        return 'BILL-ACCRUE';
    }
    // A closed shift whose drawer did not match. Only a NON-ZERO variance posts —
    // a drawer that counted exactly right has nothing to say to the ledger.
    if (collection === 'pos_shifts') {
        return toInt(document && document.variance) !== 0 ? 'POS-SHIFT-VARIANCE' : null;
    }
    if (collection === 'goods_receipts') return 'GR-RECEIPT';
    if (collection === 'stock_adjustments') {
        // A marketplace sale relieving what it consumed. Lives in
        // stock_adjustments because it IS one — a stock movement with a journal —
        // and a separate collection would cost a rules block for no new shape.
        if (doc.adjustment_type === 'sale') return 'CM-ORDER-COGS';
        if (doc.adjustment_type === 'waste') return 'STOCK-WASTE';
        // A count that found MORE than the books expected reverses into stock
        // rather than crediting COGS with a negative, so the ledger reads as
        // what happened: an asset was understated.
        return toInt(doc.total_amount) >= 0 ? 'STOCK-COUNT-GAIN' : 'STOCK-COUNT-COGS';
    }
    if (collection === 'subscriptions') return 'SUB-ACCRUE';
    if (collection === 'invoices') {
        const status = String(doc.status || '').trim().toLowerCase();
        return status && status !== 'draft' ? 'INV-ISSUE' : null;
    }
    return null;
}

// --- the rule table: rule -> balanced lines -------------------------------

const RULES = {
    'TXN-INC-CASH': (doc) => {
        const amt = requireAmount(doc.amount, 'income');
        const acct = explicitAccount(doc) || REVENUE;
        return [line(CASH, amt, 0, 'Cash received'), line(acct, 0, amt, doc.category || 'Revenue')];
    },
    'TXN-EXP-CASH': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'expense');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Expense'), line(CASH, 0, amt, 'Cash paid')];
    },
    'TXN-OPEX-CASH': (doc) => {
        const amt = requireAmount(doc.amount, 'opex');
        const acct = explicitAccount(doc)
            || TYPE_EXPENSE_DEFAULTS[String(doc.type || '').toLowerCase()] || UNMAPPED_EXPENSE;
        return [line(acct, amt, 0, doc.type), line(CASH, 0, amt, 'Cash paid')];
    },
    // --- Commerce settlement cycle (1030 Payment Gateway Clearing) ------------
    // Order:      Dr 1030 / Cr Revenue      — earned, not yet in the bank
    // Fee:        Dr Fee expense / Cr 1030  — the platform nets it out of the payout
    // Refund:     Dr 4900 / Cr 1030         — reduces revenue AND the float
    // Settlement: Dr 1000 / Cr 1030         — the payout finally lands
    // 1030 therefore nets to exactly the unsettled balance, and the settlement
    // clears it. Cash only moves when money actually reaches a bank account.
    'CM-ORDER-REV': (doc) => {
        const amt = requireAmount(doc.amount, 'commerce order revenue');
        const acct = explicitAccount(doc) || REVENUE;
        return [line(CLEARING, amt, 0, 'Marketplace receivable'), line(acct, 0, amt, doc.category || 'Revenue')];
    },
    'CM-ORDER-FEE': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'commerce fee');
        // Honour a mapping if one exists (a seller may route platform fees to a
        // COGS account — they sit above the gross-margin line), else bank fees.
        const acct = explicitAccount(doc) || (ctx && ctx.mappings && ctx.mappings[`category:${doc.category}`]) || FEE_EXPENSE;
        return [line(acct, amt, 0, doc.category || 'Marketplace fee'), line(CLEARING, 0, amt, 'Netted from payout')];
    },
    'CM-ORDER-REFUND': (doc) => {
        const amt = requireAmount(doc.amount, 'commerce refund');
        // Contra-revenue, not negative income: a refund reduces net revenue and the
        // amount the platform will pay out. Posting it as income (what the generic
        // `refund` type does — it means "a refund RECEIVED" elsewhere in the app)
        // inflated both revenue and cash on every marketplace return.
        return [line(SALES_RETURNS, amt, 0, 'Marketplace refund'), line(CLEARING, 0, amt, 'Deducted from payout')];
    },
    'CM-SETTLE': (doc) => {
        const amt = requireAmount(doc.amount, 'settlement payout');
        return [line(CASH, amt, 0, 'Payout received'), line(CLEARING, 0, amt, 'Float cleared')];
    },
    // A till sale. `amount` is NET revenue (gross − discount), which is what every
    // existing revenue surface counts — the dashboard KPI, the income statement,
    // /outlet-pnl. The gross price and the discount are recovered from
    // `pos_discount_amount` so the journal can state both:
    //
    //   Dr 1000 Cash  or  1030 Clearing   (net — what the customer actually paid)
    //   Dr 4900 Sales Discounts           (discount given, when there is one)
    //       Cr 4000 Revenue               (GROSS, the menu price)
    //
    // With no discount this degrades to the ordinary two-line cash sale.
    //
    // Tax is deliberately absent. Indonesian F&B is generally liable for a
    // REGIONAL tax (PB1 / PBJT), not PPN, and it is a liability collected on the
    // government's behalf rather than revenue — so booking it here would overstate
    // revenue. The rate and liability vary by regency; the number needs an
    // Indonesian tax practitioner before it reaches a journal, and the account does
    // not exist in the seed yet. See docs/POS_IMPLEMENTATION_PLAN.md §18.7.
    //
    // ⚠️ `amount` IS NET REVENUE, AND TAX AND SERVICE RIDE BESIDE IT. The customer
    // hands over the whole bill, so the CASH side is net + service + tax, while
    // the revenue credit stays the menu's own gross. Getting that wrong is silent
    // in the direction that matters: booking the tax as revenue overstates income
    // by the whole PPN and hands the owner a margin they never earned, and
    // debiting cash for the net alone leaves every drawer short by the tax the
    // till actually took.
    'POS-SALE': (doc) => {
        const net = requireAmount(doc.amount, 'POS sale');
        const discount = Math.max(0, toInt(doc.pos_discount_amount));
        const tax = Math.max(0, toInt(doc.pos_tax_amount));
        const service = Math.max(0, toInt(doc.pos_service_amount));
        const acct = explicitAccount(doc, 'revenue') || REVENUE;
        // What actually crossed the counter, which is what the drawer must
        // reconcile to — not the revenue share of it.
        const collected = net + tax + service;
        // One debit line per settlement destination. A single-tender sale still
        // produces exactly one, so nothing about the common case changes shape.
        const { cash, clearing } = posSettlementSplit(doc, collected);
        const lines = [];
        if (cash > 0) lines.push(line(CASH, cash, 0, 'Cash received'));
        if (clearing > 0) lines.push(line(CLEARING, clearing, 0, 'Awaiting payout'));
        if (discount > 0) lines.push(line(SALES_RETURNS, discount, 0, doc.pos_discount_reason || 'Discount given'));
        lines.push(line(acct, 0, net + discount, doc.category || 'Sales'));
        if (service > 0) lines.push(line(SERVICE_CHARGE, 0, service, 'Service charge'));
        // A LIABILITY, never revenue: this is the government's money, held until
        // it is remitted.
        if (tax > 0) lines.push(line(OUTPUT_TAX, 0, tax, 'Tax collected'));
        return lines;
    },
    // Money handed back for a till sale. Contra-revenue rather than negative
    // income, for the same reason CM-ORDER-REFUND is: posting it as `refund`
    // income (which elsewhere in the app means a refund RECEIVED) would inflate
    // both revenue and cash on every return.
    // Drawer short  →  Dr 6700 / Cr 1000   (cash that should be there is not)
    // Drawer over   →  Dr 1000 / Cr 6700   (more cash than the sales explain)
    //
    // `variance` is SIGNED: counted − expected. Negative is short, which is the
    // common case and the one that matters.
    'POS-SHIFT-VARIANCE': (doc) => {
        const v = toInt(doc.variance);
        const amt = requireAmount(Math.abs(v), 'shift cash variance');
        const memo = doc.reference || 'Shift cash count';
        return v < 0
            ? [line(CASH_VARIANCE, amt, 0, memo), line(CASH, 0, amt, 'Cash short in drawer')]
            : [line(CASH, amt, 0, 'Cash over in drawer'), line(CASH_VARIANCE, 0, amt, memo)];
    },
    // Money goes back the way it came in. Refunding a QRIS sale out of 1000 Cash
    // credits money that was never in the drawer and strands the float in 1030
    // permanently — which is what happened for every non-cash refund until
    // 2026-08-30, because refundPosOrder hardcoded `pos_settlement: 'cash'`.
    // Unconditional, not just on split bills.
    //
    // Tax and service go back the same way they came in. A refund that returns
    // the whole bill to the customer but only reverses the revenue share leaves
    // the workspace holding a PPN liability for a sale that no longer exists —
    // and it would be remitted to the government out of the owner's pocket.
    'POS-REFUND': (doc) => {
        const amt = requireAmount(doc.amount, 'POS refund');
        const tax = Math.max(0, toInt(doc.pos_tax_amount));
        const service = Math.max(0, toInt(doc.pos_service_amount));
        const collected = amt + tax + service;
        const { cash, clearing } = posSettlementSplit(doc, collected);
        const lines = [line(SALES_RETURNS, amt, 0, doc.pos_refund_reason || 'Sale refunded')];
        if (service > 0) lines.push(line(SERVICE_CHARGE, service, 0, 'Service charge returned'));
        if (tax > 0) lines.push(line(OUTPUT_TAX, tax, 0, 'Tax returned'));
        if (cash > 0) lines.push(line(CASH, 0, cash, 'Cash refunded'));
        if (clearing > 0) lines.push(line(CLEARING, 0, clearing, 'Deducted from payout'));
        return lines;
    },
    'TXN-ACCRUE-AR': (doc) => {
        const amt = requireAmount(doc.amount, 'pending receivable');
        const acct = explicitAccount(doc) || REVENUE;
        return [line(AR, amt, 0, 'Accrued receivable'), line(acct, 0, amt, doc.category || 'Revenue')];
    },
    'TXN-ACCRUE-AP': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'pending payable');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Expense'), line(AP, 0, amt, 'Accrued payable')];
    },
    'BILL-ACCRUE': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'bill');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Bill'), line(AP, 0, amt, doc.vendor_name || 'Payable')];
    },
    // Goods arrive: stock goes up at cost, and a liability is recognised even
    // though no invoice exists yet. Amount is the receipt total, which is the sum
    // of its line amounts — the per-item detail lives in stock_movements, exactly
    // as invoice lines live outside the A/R posting.
    'GR-RECEIPT': (doc) => {
        const amt = requireAmount(doc.total_amount, 'goods receipt');
        return [
            line(INVENTORY, amt, 0, doc.reference || 'Goods received'),
            line(GRNI, 0, amt, doc.vendor_name || 'Goods received not invoiced')
        ];
    },
    // The supplier invoice arrives for goods already received: move the liability
    // from GRNI to A/P. No expense, no inventory movement — both already happened.
    'BILL-GRNI': (doc) => {
        const amt = requireAmount(doc.amount, 'bill against goods receipt');
        return [
            line(GRNI, amt, 0, doc.vendor_name || 'GRNI cleared'),
            line(AP, 0, amt, doc.vendor_name || 'Payable')
        ];
    },
    // Physical count short of the books: the stock left without a recorded
    // movement, which for F&B is consumption. Waste already recorded reduced the
    // system quantity, so it is not counted twice here.
    'STOCK-COUNT-COGS': (doc) => {
        const amt = requireAmount(Math.abs(toInt(doc.total_amount)), 'stock count');
        return [
            line(COGS, amt, 0, doc.reference || 'Stock consumed'),
            line(INVENTORY, 0, amt, doc.reference || 'Stock count')
        ];
    },
    // Count found more than the books held — an understated asset, corrected.
    'STOCK-COUNT-GAIN': (doc) => {
        const amt = requireAmount(toInt(doc.total_amount), 'stock count gain');
        return [
            line(INVENTORY, amt, 0, doc.reference || 'Stock count gain'),
            line(COGS, 0, amt, doc.reference || 'Stock count gain')
        ];
    },
    // A marketplace sale relieving the stock it consumed. Same journal as a
    // count's consumption — the difference is that this one is caused by a
    // specific order rather than discovered by counting.
    //
    // Until this existed, commerce_orders posted revenue (CM-ORDER-REV) and never
    // touched inventory, so every marketplace sale booked at full margin.
    'CM-ORDER-COGS': (doc) => {
        const amt = requireAmount(Math.abs(toInt(doc.total_amount)), 'commerce order cost of goods');
        return [
            line(COGS, amt, 0, doc.reference || 'Cost of goods sold'),
            line(INVENTORY, 0, amt, doc.reference || 'Stock relieved by sale')
        ];
    },
    'STOCK-WASTE': (doc) => {
        const amt = requireAmount(Math.abs(toInt(doc.total_amount)), 'stock waste');
        return [
            line(WASTE, amt, 0, doc.reference || 'Spoilage / waste'),
            line(INVENTORY, 0, amt, doc.reference || 'Spoilage / waste')
        ];
    },
    'BILL-PAY': (doc) => {
        const amt = requireAmount(doc.amount, 'bill payment');
        return [line(AP, amt, 0, doc.vendor_name || 'Payable settled'), line(CASH, 0, amt, 'Cash paid')];
    },
    'SUB-ACCRUE': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'subscription');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Subscription'), line(AP, 0, amt, doc.vendor_name || 'Payable')];
    },
    'INV-ISSUE': (doc) => {
        const amt = requireAmount(doc.amount ?? doc.total_amount, 'invoice');
        return [line(AR, amt, 0, doc.customer_name || 'Receivable'), line(REVENUE, 0, amt, 'Invoiced revenue')];
    },
    'INV-PAY': (doc) => {
        const amt = requireAmount(doc.amount, 'invoice payment');
        return [line(CASH, amt, 0, 'Cash received'), line(AR, 0, amt, 'Receivable settled')];
    }
};

// Human-readable description per posting rule. Mirrors the register labels but
// lives here so the description is stamped onto the journal at build time and is
// available on every drill-down surface (register, detail, exports) without a
// lookup. Reversals are derived from their `REVERSAL:<rule>` id.
const RULE_DESCRIPTIONS = {
    'TXN-INC-CASH': 'Income received',
    'TXN-EXP-CASH': 'Expense paid',
    'TXN-OPEX-CASH': 'Fee / tax paid',
    'TXN-ACCRUE-AR': 'Accrued receivable',
    'TXN-ACCRUE-AP': 'Accrued payable',
    'BILL-ACCRUE': 'Bill accrued',
    'GR-RECEIPT': 'Goods received',
    'STOCK-COUNT-COGS': 'Stock count — consumption',
    'STOCK-COUNT-GAIN': 'Stock count — gain',
    'STOCK-WASTE': 'Waste / spoilage',
    'BILL-GRNI': 'Supplier invoice for goods received',
    'BILL-PAY': 'Bill paid',
    'SUB-ACCRUE': 'Subscription accrued',
    'INV-ISSUE': 'Invoice issued',
    'INV-PAY': 'Invoice paid',
    'CM-ORDER-REV': 'Marketplace order',
    // Source-neutral: a till sale relieves stock through the SAME rule, because it
    // is the same journal (Dr 5100 / Cr 1200) caused by the same event — a sale.
    // The rule ID still reads CM-* because it is stamped on immutable posted
    // journals and renaming it would orphan every one of them; the journal's
    // `source.collection` is what says which front end caused it.
    'CM-ORDER-COGS': 'Cost of goods sold',
    'CM-ORDER-FEE': 'Marketplace fee',
    'CM-ORDER-REFUND': 'Marketplace refund',
    'CM-SETTLE': 'Settlement payout',
    'POS-SALE': 'Till sale',
    'POS-REFUND': 'Till refund',
    'POS-SHIFT-VARIANCE': 'Cash drawer count',
    'OPENING': 'Opening balance',
    'DEPRECIATION': 'Depreciation',
    'CLOSE': 'Period close'
};

export function describeRule(id) {
    if (!id) return 'Journal';
    if (String(id).startsWith('REVERSAL')) return 'Reversal';
    return RULE_DESCRIPTIONS[id] || id;
}

// --- public builders ------------------------------------------------------

// Assert balance and assemble totals. Throws on imbalance so a bug can never
// post a lopsided journal. An empty or all-zero journal is reported as GL_002
// rather than GL_001 — "unbalanced (Dr 0 / Cr 0)" was the single most confusing
// message in the editor, because the real problem is that nothing was entered.
function finalize(lines, meta) {
    const totalDebit = lines.reduce((s, l) => s + toInt(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + toInt(l.credit), 0);
    if (lines.length < 2 || (totalDebit === 0 && totalCredit === 0)) {
        throw glError(GL.TOO_FEW_LINES,
            `accounting-engine: a journal requires at least two lines with an amount (got ${lines.length}) for ${meta.posting_rule_id}`,
            { line_count: lines.length, rule: meta.posting_rule_id || '' });
    }
    if (totalDebit !== totalCredit || totalDebit <= 0) {
        throw glError(GL.UNBALANCED,
            `accounting-engine: unbalanced journal (Dr ${totalDebit} / Cr ${totalCredit}) for ${meta.posting_rule_id}`,
            { debit: totalDebit, credit: totalCredit, rule: meta.posting_rule_id || '' });
    }
    return {
        ...meta,
        lines,
        total_debit: totalDebit,
        total_credit: totalCredit,
        is_balanced: true,
        currency: (typeof window !== 'undefined' && window.FluxyMoney ? window.FluxyMoney.baseCurrency() : 'IDR')
    };
}

// Main entry: build a journal for a business document, or return null when the
// document does not post. Output omits server-only fields (entity_id, posted_by,
// posted_at) — db-service supplies those.
export function buildJournal({ collection, id, document, mappings, date, accounts } = {}) {
    const ruleId = selectRule(collection, document);
    if (!ruleId) return null;
    const builder = RULES[ruleId];
    if (!builder) return null;
    // Overlay the live chart so a user-created categorizing account (absent from the
    // static seed) resolves to its real type/name in the posted lines.
    _liveAccounts = accounts || null;
    try {
        // Document-level dimension: one source document belongs to one outlet, so
        // every line it produces inherits it. Per-line overrides survive (see
        // stampDimension) for when bills gain line items.
        const lines = stampDimension(
            builder(document || {}, { mappings: mappings || {} }),
            document?.dimension_id
        );
        const when = date || document?.timestamp || document?.due_date || document?.date || new Date();
        return finalize(lines, {
            posting_rule_id: ruleId,
            journal_type: 'system',
            generated_by: 'posting_engine',
            description: describeRule(ruleId),
            source: { collection, id: id || null },
            period_key: periodKey(when),
            status: 'posted',
            memo: document?.vendor_name || document?.customer_name || ''
        });
    } finally {
        _liveAccounts = null;
    }
}

// Opening-balance journal at cutover. `entries` are [{ account_code, debit, credit }]
// for the known asset/liability positions; the engine balances the difference to
// Opening Balance Equity (3900) so the entry always posts evenly.
export function buildOpeningJournal({ entries = [], date } = {}) {
    const lines = entries
        .filter((e) => toInt(e.debit) > 0 || toInt(e.credit) > 0)
        .map((e) => line(e.account_code, e.debit, e.credit, 'Opening balance'));
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    const diff = debit - credit;
    if (diff > 0) lines.push(line(OPENING_EQUITY, 0, diff, 'Opening balance equity'));
    else if (diff < 0) lines.push(line(OPENING_EQUITY, -diff, 0, 'Opening balance equity'));
    return finalize(lines, {
        posting_rule_id: 'OPENING',
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: 'Opening balance',
        source: { collection: null, id: null },
        period_key: periodKey(date || new Date()),
        status: 'posted',
        memo: 'Opening balance'
    });
}

// Depreciation journal for ONE period.
//
//   Dr 6470 Depreciation & Amortisation   (one line per asset)
//   Cr 1590 Accumulated Depreciation      (the total)
//
// A dedicated builder rather than a posting RULE, for the same reason
// buildOpeningJournal and buildClosingJournal are: this is a period-end entry
// somebody runs, not something a source document triggers on create.
//
// One line per asset on the debit side, because "depreciation was Rp4.2 juta"
// is not an answer anybody can check. The credit is a single line — 1590 is a
// contra-asset pool and splitting it per asset would imply a per-asset balance
// the balance sheet does not carry.
//
// PER PERIOD, never a catch-up lump. Six months of arrears posted as one entry
// dated today puts half a year of cost into one month's P&L and breaks every
// month-on-month comparison after it. The caller loops periods; this builds one.
export function buildDepreciationJournal({ lines = [], periodKey: pk, date } = {}) {
    const rows = (lines || []).filter((l) => toInt(l.amount) > 0);
    if (!rows.length) return null;
    const total = rows.reduce((sum, l) => sum + toInt(l.amount), 0);
    const out = rows.map((l) => line(DEPRECIATION_EXPENSE, toInt(l.amount), 0, l.description || 'Depreciation'));
    out.push(line(ACCUMULATED_DEPRECIATION, 0, total, 'Accumulated depreciation'));
    return finalize(out, {
        posting_rule_id: 'DEPRECIATION',
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: 'Depreciation',
        source: { collection: null, id: null },
        period_key: pk || periodKey(date || new Date()),
        status: 'posted',
        memo: `Depreciation for ${rows.length} asset${rows.length === 1 ? '' : 's'}`
    });
}

// Period-close journal: roll net income (revenue − expense) into Retained
// Earnings (3000). Revenue and expense totals are positive integers in their
// natural direction. Returns null when there is nothing to close.
export function buildClosingJournal({ revenueTotal = 0, expenseTotal = 0, date, periodKey: pk } = {}) {
    const rev = toInt(revenueTotal);
    const exp = toInt(expenseTotal);
    const net = rev - exp;
    // Debit revenue to zero it out, credit the aggregate expense-clearing line
    // (6999 "Other Expense" as the aggregate expense contra at close — per-account
    // expense clearing is a Should-Have refinement), and post net income/loss to
    // Retained Earnings so the period's P&L rolls into equity.
    const lines = [];
    if (rev > 0) lines.push(line(REVENUE, rev, 0, 'Close revenue to retained earnings'));
    if (exp > 0) lines.push(line(UNMAPPED_EXPENSE, 0, exp, 'Close expenses to retained earnings'));
    if (net > 0) lines.push(line(RETAINED_EARNINGS, 0, net, 'Net income to retained earnings'));
    else if (net < 0) lines.push(line(RETAINED_EARNINGS, -net, 0, 'Net loss to retained earnings'));
    if (!lines.length) return null;
    return finalize(lines, {
        posting_rule_id: 'CLOSE',
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: 'Period close',
        source: { collection: 'periods', id: pk || null },
        period_key: pk || periodKey(date || new Date()),
        status: 'posted',
        memo: `Close period ${pk || ''}`.trim()
    });
}

// Reversal lines: swap debit/credit so the reversal exactly offsets the original
// in ledger_balances. Used by the correction-in-current-period flow.
export function reverseLines(lines = []) {
    return (lines || []).map((l) => ({
        ...l,
        debit: toInt(l.credit),
        credit: toInt(l.debit),
        functional_amount: toInt(l.credit) || toInt(l.debit),
        memo: l.memo ? `Reversal: ${l.memo}` : 'Reversal'
    }));
}

// Build a reversal journal for a previously-posted journal. `targetPeriodKey`
// lets the caller post the reversal into the current OPEN period when the
// original sits in a closed period (the correction-in-current-period rule).
export function buildReversalJournal(original, { targetPeriodKey } = {}) {
    const lines = reverseLines(original.lines);
    return finalize(lines, {
        posting_rule_id: `REVERSAL:${original.posting_rule_id || ''}`,
        journal_type: original.journal_type || 'system',
        generated_by: 'posting_engine',
        description: original.journal_number
            ? `Reversal of ${original.journal_number}`
            : 'Reversal',
        manual_subtype: original.journal_type === 'manual' ? 'correction' : null,
        source: original.source || { collection: null, id: null },
        source_number: original.source_number || null,
        period_key: targetPeriodKey || original.period_key,
        status: 'reversal',
        reverses_journal_id: original.id || original.journal_id || null,
        memo: original.memo ? `Reversal: ${original.memo}` : 'Reversal'
    });
}

// Refuse a HUMAN-entered journal that names an account the posting engine owns.
//
// Call this from the human path only. buildManualJournal itself must stay
// unguarded: the Tax Center posts through it too (recordCorporateTaxPayment,
// postAnnualCorporateTax) using exactly the accounts blocked here — 1140, 1150,
// 2200, 1000. Gating inside the builder would break monthly tax posting silently.
//
// `accounts` is code → row from the live chart (so user-created accounts resolve
// and archived ones are visible); it falls back to the static seed. `subtype`
// 'opening' is exempt: recording opening balances legitimately debits cash and
// credits opening equity, and the Manual Journal editor is the only in-app path
// to it (buildOpeningJournal has no caller).
export function assertManualJournalPolicy(lines, { accounts, subtype } = {}) {
    if (subtype === 'opening') return;
    const idx = accounts || null;
    (lines || []).forEach((l) => {
        const code = String((l && l.account_code) || '').trim();
        if (!code) return;
        const account = (idx && idx[code]) || CHART_SEED_INDEX[code] || null;
        if (!account) return; // unknown code — finalize()/rules reject it downstream
        if (account.is_active === false) {
            throw glError(GL.ARCHIVED, `${code} ${account.name || ''}`.trim() + ' is archived and cannot be used.',
                { account_code: code, account_name: account.name || code });
        }
        if (account.allow_manual_journal === false) {
            throw glError(GL.MANUAL_BLOCKED,
                `${code} ${account.name || ''}`.trim() + ' is maintained by the posting engine and cannot be used in a manual journal.',
                { account_code: code, account_name: account.name || code });
        }
    });
}

// Build a balanced manual journal from accountant-entered lines. Unlike the rule
// builders this carries no posting rule — the accountant chooses every account.
// `accountIndex` (code -> { name, type }) comes from the workspace chart of
// accounts so custom accounts resolve; it falls back to the seed index. Reuses
// finalize(), so an unbalanced manual entry throws and never posts (the draft
// path stores raw lines without calling this; only POST finalizes).
export function buildManualJournal({ lines = [], date, period_key, description, reference, subtype, accountIndex } = {}) {
    const idx = accountIndex || ACCOUNT_INDEX;
    const built = (lines || [])
        .map((l) => {
            const code = String(l.account_code || '').trim();
            const acct = idx[code] || ACCOUNT_INDEX[code] || null;
            const debit = toInt(l.debit);
            const credit = toInt(l.credit);
            return {
                account_code: code,
                account_type: acct ? acct.type : 'expense',
                account_name: acct ? acct.name : code,
                debit,
                credit,
                currency: (typeof window !== 'undefined' && window.FluxyMoney ? window.FluxyMoney.baseCurrency() : 'IDR'),
                fx_rate: 1,
                functional_amount: debit || credit,
                memo: l.memo || '',
                // Manual journals are the one path where a human may split a
                // single entry across outlets, so the dimension is read per line
                // rather than stamped from a document.
                dimension_id: String(l.dimension_id || '').trim() || null
            };
        })
        .filter((l) => l.account_code && (l.debit > 0 || l.credit > 0));
    const pk = period_key || periodKey(date || new Date());
    return finalize(built, {
        posting_rule_id: 'MANUAL',
        journal_type: 'manual',
        manual_subtype: subtype || null,
        generated_by: null, // db-service stamps the posting uid
        source: { collection: null, id: null },
        source_number: null,
        period_key: pk,
        status: 'posted',
        reference: reference || null,
        description: description || 'Manual journal',
        memo: description || ''
    });
}
