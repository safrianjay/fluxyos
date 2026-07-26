# Chart of Accounts Execution Strategy for FluxyOS: Product & UX Analysis of Jurnal by Mekari and Accurate Online

> Provenance: external research report supplied 2026-07-26 as the input for CoA
> Phase 1. Preserved verbatim below (encoding artifacts from the source file —
> e.g. "â" sequences — left as received). Implementation decisions that adapt
> this report to the shipped FluxyOS kernel live in
> `docs/data-model/chart-of-accounts.md` and `docs/CHART_OF_ACCOUNTS_STRATEGY.md`.

## TL;DR
- **Both Jurnal by Mekari and Accurate Online build the Chart of Accounts (CoA) as the mandatory accounting spine of the product, then hide most of its complexity behind module-level "default account mapping" so end users rarely touch raw account codes** â FluxyOS should adopt exactly this pattern: a full double-entry CoA engine underneath, with founders interacting only in business language (Transactions, Bills, Invoices, Vendors, Budgets).
- The single most important design decision is the **two-layer model**: every financial record in FluxyOS should carry BOTH a founder-friendly **Business Category** (what the user sees and picks) AND a **Chart of Account reference** (the accounting truth), with the mapping resolved automatically via rules + AI and overridable by finance staff. Jurnal and Accurate effectively do this via master-data mapping and per-module default accounts.
- FluxyOS can differentiate not by having a "better CoA screen" but by making the CoA **invisible-by-default, auditable-on-demand, and self-learning**: rule-based defaults + AI suggestions from bank feeds/bill capture, confidence scoring, a role-gated "accountant view," and append-only audit logs on every account-affecting write â turning correctness into a background guarantee rather than a data-entry burden.

## Key Findings

1. **CoA is universal and standards-driven, but exposure differs.** Both products base their CoA on Indonesian SAK (Standar Akuntansi Keuangan) with the five/six-element structure (Aset, Kewajiban, Ekuitas/Modal, Pendapatan, Beban/HPP). Jurnal organizes accounts into **17 categories**; Accurate Online organizes them into **16 account types (Tipe Akun)**.
2. **Numbering.** Jurnal auto-assigns account numbers driven by the chosen category (format like `1-10001`); users can override. Accurate uses a leading-digit-by-group convention (1=Aset, 2=Kewajiban, 3=Modal, 4=Pendapatan, 5=HPP, 6=Beban), most often rendered as 4-digit codes (e.g., `1101` = Kas) with `-NNN` sub-accounts.
3. **Templates by industry.** Both seed a default CoA at signup based on the selected industry (jasa/service, dagang/trade, manufaktur/manufacturing). Jurnal ties the CoA language and template to the industry and language chosen during registration; Accurate offers to auto-generate a standard CoA when creating a new company database.
4. **System accounts are locked.** Jurnal uses a "padlock" (gembok) and "padlock+" (gembok+) system: padlock+ = default system accounts that cannot be edited (category) or deleted; padlock = accounts used in transactions or as master-data mapping. Per Mekari Jurnal's Help Center ("FAQs - Daftar Akun"), a padlock account "bisa dihapus/diedit kategori akunnya jika semua transaksi yang berhubungan dengan akun tersebut sudah dihapus terlebih dahulu" (can only be deleted/re-categorized once all related transactions are deleted first). Accurate similarly forbids deleting accounts already used in transactions, offering "non-aktif" (archive) instead.
5. **CoA integrates everywhere through "default account mapping," not manual per-transaction coding.** Accurate's Preferensi > Akun tab pre-defines which accounts each module posts to. Per Accurate's official help, in this tab "kamu bisa lihat semua daftar akun yang perlu kamu isi. Nantinya, akun-akun ini akan digunakan secara otomatis saat kamu melakukan transaksi di modul yang bersangkutan" (the accounts you fill in here are then used automatically when you transact in the relevant module). Jurnal maps accounts onto master data (products, contacts, assets, taxes) so account selection is inherited.
6. **Categorization is fundamentally CoA-based, but abstracted.** Neither Indonesian product exposes a separate consumer-style "Business Category" layer as prominently as QuickBooks; instead they map master data (product/contact) to accounts. QuickBooks and Xero demonstrate the layered "category â account" pattern and rule/AI-based auto-categorization that FluxyOS should emulate.
7. **The modern edge is AI + rules that learn.** Best-practice bank-feed categorization uses deterministic rules first, ML/AI for the "long tail," confidence scoring, human review, and feedback loops from corrections â exactly the Phase 4 opportunity for FluxyOS.

## Details

### SECTION 1 â Chart of Accounts Foundation

**How users access the CoA.**
- *Jurnal by Mekari:* via the **Daftar Akun** ("Chart of Account") menu. Account creation is `Daftar Akun > +Buat Akun Baru`.
- *Accurate Online:* via **Buku Besar (General Ledger) > Akun Perkiraan**. This is the add/edit/delete home for all accounts.

Both treat the CoA as a dedicated back-office ledger screen â deliberately separated from day-to-day transaction entry. This separation is the key UX signal: the CoA is infrastructure, not a daily-use surface.

**Default account structure & standards (SAK localization).**
Both follow Indonesian SAK. Accounts roll up to the accounting equation (Aset = Kewajiban + Modal) for the Neraca (Balance Sheet) and Pendapatan â Beban for Laba/Rugi (P&L). Indonesian-specific accounts are seeded: PPN Masukan/Keluaran (input/output VAT), Utang PPh 21 (employee income tax payable), Prive (owner's drawings), Ekuitas Saldo Awal / Laba Ditahan (opening-balance equity / retained earnings). Localization also covers language: Jurnal locks the CoA display language (Indonesian vs English) at signup and it cannot be auto-switched later.

**Account hierarchy (parent/child).**
- *Jurnal:* "Akun Multi Level." When creating an account, the **Details** field offers `None` (standalone), `sub akun dari` (child account), or `akun header dari` (parent/header account). Header accounts aggregate children so statements can show only the parent. An account already used in transactions cannot become a header.
- *Accurate:* Sub-akun via a "Sub Akun" checkbox that lets you pick an induk (parent). Produces Induk & Sub Akun structures (e.g., parent Bank â children Bank BCA, Bank Mandiri).

**Account numbering.**
- *Jurnal:* number auto-generated **after** the category is chosen (category determines number range, debit/credit posture, and statement placement); user may override; numbers must be unique. Import format uses a leading quote and hyphen (e.g., `'1-1019`).
- *Accurate:* "Kode Perkiraan" entered manually or auto-sequenced by account type; leading digit denotes group (1â6). Guidance stresses leaving numeric gaps for future accounts.

**Account types / categories / classification.**
- *Jurnal:* **17 categories** (with their import category numbers): Akun Piutang (1), Aktiva Lancar Lainnya (2), Kas & Bank (3), Persediaan (4), Aktiva Tetap (5), Aktiva Lainnya (6), Depresiasi & Amortisasi (7), Akun Hutang (8), Kartu Kredit (9), Kewajiban Lancar Lainnya (10), Kewajiban Jangka Panjang (11), Ekuitas (12), Pendapatan (13), Pendapatan Lainnya (14), Harga Pokok Penjualan (15), Beban (16), Beban Lainnya (17).
- *Accurate:* **16 account types**: Kas & Bank, Piutang Usaha, Persediaan, Aset Lancar Lainnya, Aset Tetap, Akumulasi Penyusutan, Aset Lainnya (assets); Utang Usaha, Liabilitas Jangka Pendek, Liabilitas Jangka Panjang (liabilities); Modal (equity); Pendapatan, Beban Pokok Penjualan, Beban, Beban Lainnya, Pendapatan Lainnya (P&L). The type drives special system behavior â e.g., coding a purchase to a Fixed Asset-type account routes it to the fixed-asset register. Per Accurate's official help ("Membuat dan Mengelola Akun Perkiraan"), opening balances for control-type accounts cannot be typed directly on the account: "untuk saldo awal piutang, utang, persediaan, aset tetap dan penyusutan tidak bisa langsung diisikan sebagai saldo awal" (opening balances for receivables, payables, inventory, fixed assets, and accumulated depreciation cannot be entered directly) â they must come through their respective modules.

**Default templates by business type.** Both seed CoAs per industry (service, trade, manufacturing). Jurnal ties template + language to industry chosen at registration; users can also import their own CoA. Accurate offers an auto-generate-standard-CoA checkbox at company creation.

**Custom account creation & management.** Both allow manual creation, bulk import (CSV/Excel template), edit, archive, and delete-with-restrictions. Jurnal permits editing account info even after use â except the **account category**, which is frozen once the account is used in a transaction or as master-data mapping.

### SECTION 2 â Product & UX Flow

**Creating an account (Jurnal):** Daftar Akun â +Buat Akun Baru â (A) enter Nama Akun (required) â number auto-fills â choose Kategori (required; 17 options) â set Details (None/child/header) â optional default Pajak (tax auto-applies to transactions using this account) â optional Deskripsi â (B) Akses Akun (All users / Some users / Certain roles) â "Buat Akun" or "Buat & Baru." Note the ordering: **category before number** â because category governs numbering and reporting.

**Creating an account (Accurate):** Buku Besar â Akun Perkiraan â new â **Informasi Umum** tab (Tipe Akun, Sub Akun toggle + parent, Kode Perkiraan, Nama, Mata Uang) â **Saldo** tab (opening balance; disabled for the control types above) â **Lain-lain** tab (notes + user access) â Simpan.

**Editing & archiving.** Jurnal: edit via account â Tindakan â Ubah akun; category locked once used; padlock/padlock+ govern deletability; bulk delete via checkboxes for unlocked accounts. Accurate: edit in Akun Perkiraan; if used, cannot delete â instead check "non aktif" in the Lain-lain tab to archive.

**Sub-accounts.** Jurnal via Details=child/header; Accurate via Sub Akun checkbox + parent selection.

**Opening balances.** Jurnal: set a conversion date; balances entered/imported and then "Terbitkan" (publish); any debit/credit imbalance is auto-posted to **Ekuitas Saldo Awal**. Accurate: on the Saldo tab, but control-type accounts must be seeded through their modules.

**Managing codes.** Both enforce uniqueness; both recommend gapped numbering for growth.

**Restricting system accounts.** Jurnal's gembok/gembok+ (mapping-used vs default-system). Accurate blocks deletion of in-use accounts and shows errors like "Tidak dapat menghapus Akun Perkiraan karena telah digunakan di Gaji/Tunjangan."

**Access control.** Both support per-account visibility restrictions by user/role â a strong precedent for FluxyOS role-gating.

**Search/filter/navigation.** List views with search, category/type grouping, lock icons, per-account access columns, and expand/collapse parent-child.

**Validation & error handling.** Uniqueness on name+number; locked category-after-use; import validation pages with "Go To Error" (Jurnal) that flag duplicate names/codes before commit; module errors when a required default account is undefined (Accurate: "Default Akun â¦ Belum Didefinisikan").

**Empty states & onboarding.** The core onboarding move is: **never start empty.** Both pre-populate an industry template at signup, so the user's first CoA experience is a ready-to-use list, not a blank screen. A third-party Jurnal onboarding review notes teams could start inputting transactions within the first two days thanks to per-industry CoA templates.

### SECTION 3 â CoA Integration Across the Product

The governing principle in both products: **accounts are assigned at master-data/preference setup time, then inherited automatically by transactions**, with per-transaction override available.

- **Add Transaction / Kas & Bank:** user picks the cash/bank account ("Bayar Dari") and the offsetting account ("Pembayaran Untuk"); double-entry auto-formed. Manual selection but from constrained lists.
- **Bills / Purchases (Faktur Pembelian):** posts to Utang Usaha + expense/inventory accounts per Preferensi; supplier master-data can carry default mapping; downstream affects AP aging and P&L. In FluxyOS, a Bill is not a ledger transaction until "mark paid," at which point the CoA references (expense account + cash/bank account) must be written.
- **Invoices / Sales (Faktur Penjualan):** auto-debits Piutang/Kas, credits Pendapatan, plus PPN Keluaran; retur/diskon/pembulatan accounts set in Preferensi.
- **Revenue & Expenses:** product/service master data maps to income & COGS/expense accounts; contacts can carry mappings; POS sales sync auto-classify to mapped accounts.
- **Bank & Cash accounts:** each is itself a CoA account (Kas & Bank type); reconciliation flows against these.
- **Journal Entries (Jurnal Umum) & General Ledger:** the raw double-entry surface for accountants; every posting hits CoA accounts and rolls into Buku Besar.
- **Fixed Assets:** asset-type accounts + accumulated depreciation; Accurate routes asset purchases to the fixed-asset register automatically; depreciation auto-posts.
- **Inventory:** Persediaan accounts + COGS. Per Accurate's official Preferensi help, there are exactly nine "Barang & Jasa" accounts to configure: "Terdapat sembilan Akun Perkiraan terkait Barang & Jasa, yaitu: Persediaan, Penjualan, Retur Penjualan, Diskon Penjualanâ¦" (Persediaan, Penjualan, Retur Penjualan, Diskon Penjualan, Barang Terkirim, Beban Pokok Penjualan, Retur Pembelian, Beban, Pembelian Belum Tertagih).
- **Payroll:** salary/allowance mapping to expense + liability accounts (Utang PPh 21, BPJS/premi). Deleting a mapped account is blocked.
- **Taxes:** each account can carry a default tax (Jurnal), auto-applied to transactions; PPN/PPh accounts feed tax reports (Klikpajak integration).
- **Reports & Financial Statements:** account category/type determines Neraca vs Laba/Rugi placement; this is the "downstream impact" of every mapping choice.
- **Budgeting & Cash Flow:** budgets set per account/category; cash-flow statement groups CoA cash movements into Operating/Investing/Financing (Jurnal supports direct & indirect methods, with user-defined cash-flow categories mapping source accounts).
- **AI categorization:** Mekari's ecosystem (Airene / Mekari Expense) maps policy categories to Jurnal accounts during integration, then auto-posts; users can override the mapped Account via dropdown at sync time.

### SECTION 4 â Transaction Categorization Analysis

**What Jurnal & Accurate actually do:** Categorization is **CoA-based**, delivered through **automatic account mapping** attached to master data (products, contacts, assets, taxes) and **module default accounts** (Accurate Preferensi). Rule-based defaults exist implicitly (per-account default tax; per-module default accounts). Neither exposes a prominent separate consumer "Business Category" taxonomy â the account IS the category. Accurate adds an orthogonal "Kategori Keuangan" dimension (city/vehicle/project) for segment P&L, which is a *tagging* layer, not the accounting classification.

**Comparators:** QuickBooks explicitly separates user-facing "categories"/items from the underlying CoA (items map to accounts behind the scenes). Per Intuit's "Introduction to QuickBooks Solopreneur," Solopreneur "automatically categorizes transactions into predefined categories" designed for Schedule C (form 1040) filers, and "there's no option to create new categories or select 'cost of goods sold'" â a deliberately radical simplification for solo founders. Xero resolves the account per line by priority; per Xero Central ("How your default tax rate and account settings work"): "Xero applies your default accounts in the following order of priority: First â The default account for the inventory item used in the transaction line (if an inventory item is being used) Second â The default account for the contact used in the transaction." Modern bank-feed tools layer deterministic rules + ML for the long tail + confidence scoring + human review + learning from corrections.

**Recommendation for FluxyOS â carry BOTH, resolved automatically:**
Every FluxyOS financial record should store:
1. **Business Category** (required, user-facing) â e.g., "Software & Subscriptions," "Marketing," "Payroll." This is what founders see and select.
2. **Chart of Account reference** (required, system-resolved) â the SAK-correct account for the ledger.
3. **AI-generated suggestion** (surfaced when confidence is high) â pre-fills both fields from vendor/description/history.
4. **Rule-based default** (deterministic, highest priority) â e.g., "vendor = AWS â category Software â account 6-xxxx." This mirrors Xero's priority-resolution model above.

**Trade-offs:**
- *Business Category only:* friendly but not audit-grade; can't produce SAK statements. Reject as sole layer.
- *CoA only:* accurate but intimidating; forces founders to think like accountants. This is the incumbents' weakness FluxyOS should exploit.
- *Both:* best correctness + usability, at the cost of maintaining a mapping table. **This is the recommendation.**
- *AI suggestions:* huge time savings but must be advisory, confidence-scored, human-verifiable, and never silently override deterministic rules.
- *Rule-based defaults:* highest precision for known vendors; require maintenance; combine with AI for unknowns.

The mapping table (Business Category â default CoA account) becomes core FluxyOS IP and the substrate for the AI learning loop.

### SECTION 5 â Product Strategy for FluxyOS

Position the CoA as the **accounting engine, not the interface.** Founders interact only with business objects: Transactions, Bills, Invoices, Vendors, Customers, Budgets, Projects. Every such object silently resolves to CoA postings via the Business-CategoryâAccount mapping. Concretely:
- Seed a **FluxyOS default CoA** at onboarding based on industry + entity type, SAK-compliant, Indonesian-labeled, with Rp formatting (store `1234567`, display `Rp 1.234.567`).
- Maintain a curated **Business Category taxonomy** (~20â40 founder-friendly buckets) pre-mapped to accounts.
- Keep a full **accountant surface** (Daftar Akun/CoA manager, Journal Entries, General Ledger, Trial Balance) accessible but tucked into an "Accounting" area, so finance teams and external accountants get everything they need.
- Enforce **append-only audit logs** (`users/{userId}/audit_logs`) before every sensitive write to any account-affecting record (edit, delete, approval, mark-as-paid, export), matching the incumbents' lock/restriction philosophy but with a modern audit trail.
- Given the lightweight stack (Firestore user-scoped collections, vanilla JS, no bundler), model the CoA as a Firestore collection `users/{userId}/accounts/{accountId}` with fields: `code`, `name`, `type`, `category` (SAK class), `parentId`, `isSystem` (lock), `defaultTaxId`, `normalBalance`, `active`, `businessCategories[]` (reverse map), and store a `coaAccountId` reference on every transaction/bill/invoice line.

### SECTION 6 â UX Recommendation by Role

- **Founders / SMB owners:** See only business language â Overview, Transactions, Bills, Invoices, Budgets. CoA hidden entirely; they pick a Business Category (AI-prefilled). Never shown account numbers. This is FluxyOS's core differentiation vs. the account-code-first incumbents (and closest in spirit to QuickBooks Solopreneur's category-only model).
- **Finance staff (internal):** See Business Categories AND the resolved account; can override the account on a record, create Bills/Invoices, run reconciliations, but cannot restructure the CoA or delete system accounts. Get a "review queue" of low-confidence AI categorizations.
- **Accountants (internal, elevated):** Full CoA manager (create/edit/archive/hierarchy/numbering), Journal Entries, opening balances, tax mappings, period close. Governed by role-based account access (mirroring Jurnal's per-role account visibility).
- **External accountants:** Time-boxed, role-scoped access to the Accounting area, reports, and export â with every export/edit written to the audit log. Mirror Accurate's "batasi akses berdasarkan hak dan waktu."

### SECTION 7 â Phased Implementation Roadmap

- **Phase 1 â Research, data model, architecture.** Lock the two-layer model (Business Category + CoA). Define the SAK default CoA (industry variants: service/trade), the Business Category taxonomy, and the mapping table. Design Firestore schema (`accounts`, `category_mappings`, `coaAccountId` on records) and audit-log hooks. Deliverable: data model + seed CoA JSON.
- **Phase 2 â CoA management & CRUD.** Build Daftar Akun manager: create/edit/archive, parent-child hierarchy, numbering with gaps, system-account locking (isSystem), per-role access, opening balances with an Ekuitas Saldo Awal balancing account, CSV import with pre-commit validation ("Go To Error" pattern). Empty state = pre-seeded template.
- **Phase 3 â Integrate CoA into every transaction flow.** Add CoA resolution to Add Transaction, Bills, Invoices, CSV Import, AI Bill Capture, Revenue Sync, Subscriptions. Every record stores `businessCategory` + resolved `coaAccountId` (and offsetting account). Bills write ledger postings only on mark-paid. Keep the UI showing only Business Category to founders; expose account to finance/accountants. Validate double-entry balance in logic before commit.
- **Phase 4 â AI-assisted mapping, rule engine, learning.** Deterministic rule engine (vendor/keyword/amount â category+account) evaluated first; AI suggestions with confidence scores for the long tail; human review queue; corrections feed back into rules/model (per-user vendor-alias learning). Never auto-override deterministic rules.
- **Phase 5 â Advanced accounting & enterprise.** Fixed assets + depreciation schedules, inventory/COGS, payroll mapping, tax reports (PPN/PPh), full financial statements (Neraca, Laba/Rugi, Arus Kas direct+indirect), budgeting per account/category, segment tagging (project/branch Ã  la Kategori Keuangan), period close, multi-currency, multi-entity.

### SECTION 8 â Final Recommendations

**Adopt from Jurnal:** (1) category-drives-number logic and the 17-category simplicity; (2) the gembok/gembok+ system-account locking model; (3) per-account default tax; (4) per-role account access restrictions; (5) opening-balance publishing with an auto-balancing equity account; (6) import-with-validation UX.

**Adopt from Accurate:** (1) the Preferensi > Akun "default account per module" pattern â the single most powerful mechanism for hiding CoA from users; (2) account-type-driven behavior (asset type â fixed-asset register); (3) control accounts whose opening balances flow only through their modules; (4) archive ("non-aktif") instead of delete for used accounts; (5) the orthogonal Kategori Keuangan tagging dimension for segment P&L.

**Avoid:** (1) exposing account codes/categories to founders as a required daily input (both incumbents still lean too accountant-first for a founder audience); (2) locking CoA display language irreversibly (Jurnal's limitation); (3) letting per-module default-account gaps throw cryptic blocking errors to non-accountants; (4) a CoA-only model with no friendly category layer.

**Where FluxyOS differentiates & how CoA becomes a competitive advantage:** Make the CoA an **invisible, self-maintaining correctness engine.** The founder never learns accounting; the AI + rule engine keep the ledger SAK-correct in the background; the accountant gets a pristine, fully-auditable book on demand. The Business-CategoryâAccount mapping plus the correction-learning loop is a proprietary data asset that compounds: the more FluxyOS is used, the more accurate and automatic categorization becomes â a moat that a static CoA feature (Jurnal/Accurate) cannot match.

## Recommendations
1. **Commit to the two-layer model now (Phase 1).** Every transaction stores Business Category + resolved CoA account. This is the foundational decision; changing it later is expensive. Benchmark to change course: if user testing shows founders want raw account control, expose an optional "advanced" account field â but keep category primary.
2. **Ship the default seeded CoA + Business Category taxonomy before any transaction flow.** Never show an empty CoA. Start with service + trade industry templates (Indonesia/SAK, Rp formatting).
3. **Build default-account mapping (Accurate's Preferensi pattern) in Phase 3** so founders never pick accounts. This is the highest-leverage UX borrow.
4. **Gate the CoA manager and Journal Entries behind finance/accountant roles**, with per-account access controls and mandatory audit-log writes on sensitive actions.
5. **Sequence AI after rules (Phase 4).** Deterministic rules first (Xero-style priority resolution); AI for the long tail with confidence scores and a human review queue; learn from corrections. Threshold to auto-apply AI: only above a high confidence bar, and never overriding a matched rule.
6. **Treat the categoryâaccount mapping table + correction log as core IP** and instrument it from day one for the learning loop.

## Caveats
- Exact literal default account codes and the total count of default accounts in Accurate Online are **not officially published**; representative examples (e.g., `1101` = Kas, with `-NNN` sub-accounts) come from Accurate training partners and course materials, not an official spec. The "1-10001"-style format is a Jurnal-style illustration; Accurate more commonly uses 4-digit codes. Treat specific codes as representative, not authoritative.
- Jurnal is documented as having **17 account categories**; Accurate as having **16 account types** â these are different taxonomies (category vs type) and should not be conflated.
- Much of the product-flow detail derives from each vendor's own help center and Indonesian training-partner sites; screenshots referenced in those help articles could not be reproduced here, only described. Some third-party claims (e.g., onboarding speed, ROI) are anecdotal.
- QuickBooks/Xero behaviors are included as modern comparators, not as Indonesian-market equivalents; SAK/PPN specifics still govern FluxyOS.
- This is a strategy/research document; the FluxyOS data-model and phasing suggestions are design recommendations grounded in the research, not validated implementations.
