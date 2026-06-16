/**
 * FluxyOS Dashboard Language Engine (EN/ID) — formal finance register
 *
 * Self-contained sibling of assets/js/i18n.js (which handles the marketing
 * landing pages with a casual tone). This file localizes the AUTHENTICATED
 * dashboard with the formal Bahasa Indonesia a finance/business owner expects
 * ("Anda", "Transaksi", "Saldo", "Rekonsiliasi", "Jatuh tempo").
 *
 * How it works:
 *  - Walks text nodes and swaps English → Indonesian using the ID dictionary.
 *  - A small PATTERNS list handles interpolated strings ("3 transaksi",
 *    "Menampilkan 1–10 dari 58 catatan") that an exact-match key can't catch.
 *  - A MutationObserver re-translates async-injected DOM: the sidebar
 *    (sidebar-loader.js), entry drawers, dialogs, toasts, and re-rendered
 *    table rows — the same mechanism the landing footer relies on.
 *  - The choice is persisted in localStorage('fluxyos-lang'), the SAME key the
 *    landing engine uses, so a user's language carries across the whole product
 *    (marketing site + app). It is the single source of truth for rendering.
 *
 * Entry point: the dedicated Language settings page (settings-language.html)
 * calls window.FluxyI18n.setLang('id' | 'en').
 *
 * Adding a missing translation: add a key to the ID object below. Keys must
 * match the EXACT English text between tags (after JS .trim()). Brand/product
 * names (FluxyOS, Fluxy AI, Revenue Sync, Vendor Spend, Receipt Capture,
 * Dynamic Budgeting) and common loanwords (dashboard, invoice, email, CSV,
 * upload, WhatsApp) stay English — do not add keys that translate them.
 *
 * See docs/LOCALIZATION_PLAN.md → "App / Dashboard (formal register)".
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'fluxyos-lang';
    var SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA'];

    // ─────────────────────────────────────────────────────────────────────────
    //  TRANSLATION DICTIONARY  —  English → Indonesian (formal finance register)
    // ─────────────────────────────────────────────────────────────────────────
    var ID = {
        // ── Sidebar: section labels ──────────────────────────────────────────
        "Command": "Pusat Kendali",
        "Money Movement": "Pergerakan Uang",
        "Operations": "Operasional",
        "Reporting": "Pelaporan",
        "Workspace": "Ruang Kerja",

        // ── Sidebar: nav items (product names stay English) ──────────────────
        "Overview": "Ringkasan",
        "Transactions": "Transaksi",
        "Bills": "Tagihan",
        "Subscriptions": "Langganan",
        "Budgets": "Anggaran",
        "Invoices": "Invoice",
        "Approvals": "Persetujuan",
        "Accounting Center": "Pusat Akuntansi",
        "Reports & Exports": "Laporan & Ekspor",
        "Balance Sheet": "Neraca",
        "Audit Log": "Log Audit",
        "Integrations": "Integrasi",
        "Settings": "Pengaturan",
        "Soon": "Segera",
        "Add entity": "Tambah entitas",
        "Account Owner": "Pemilik Akun",
        "Sign Out": "Keluar",
        "Consolidated": "Konsolidasi",

        // ── Common chrome / states ───────────────────────────────────────────
        "Loading...": "Memuat...",
        "Loading…": "Memuat…",
        "Loading": "Memuat",
        "Loading categories…": "Memuat kategori…",
        "Saving...": "Menyimpan...",
        "Saving…": "Menyimpan…",
        "Saving changes...": "Menyimpan perubahan...",
        "Save": "Simpan",
        "Cancel": "Batal",
        "Continue": "Lanjutkan",
        "Confirm": "Konfirmasi",
        "Confirm action": "Konfirmasi tindakan",
        "OK": "OK",
        "Close": "Tutup",
        "Done": "Selesai",
        "Edit": "Ubah",
        "Delete": "Hapus",
        "Remove": "Hapus",
        "Archive": "Arsipkan",
        "Restore": "Pulihkan",
        "Apply": "Terapkan",
        "Reset": "Atur ulang",
        "Search": "Cari",
        "Previous": "Sebelumnya",
        "Next": "Berikutnya",
        "Add Record": "Tambah Catatan",
        "No Data Found": "Tidak Ada Data",
        "Refresh": "Muat ulang",
        "Try again": "Coba lagi",
        "View all": "Lihat semua",
        "See all": "Lihat semua",
        "Export": "Ekspor",
        "Import": "Impor",
        "Upload": "Unggah",
        "Download": "Unduh",
        "Download CSV": "Unduh CSV",
        "Settings ready": "Pengaturan siap",
        "Could not load settings": "Tidak dapat memuat pengaturan",
        "Loading settings": "Memuat pengaturan",

        // ── Period / date scope labels ───────────────────────────────────────
        "Today": "Hari ini",
        "Yesterday": "Kemarin",
        "This week": "Minggu ini",
        "Last week": "Minggu lalu",
        "This month": "Bulan ini",
        "Last month": "Bulan lalu",
        "This quarter": "Kuartal ini",
        "Last quarter": "Kuartal lalu",
        "This year": "Tahun ini",
        "Last year": "Tahun lalu",
        "Year to date": "Sejak awal tahun",
        "All time": "Sepanjang waktu",
        "Custom range": "Rentang khusus",
        "Date range": "Rentang tanggal",

        // ── Transaction types (option labels; values stay English) ───────────
        "Income": "Pemasukan",
        "Expense": "Pengeluaran",
        "Transfer": "Transfer",
        "Refund": "Pengembalian Dana",
        "Adjustment": "Penyesuaian",
        "Fee": "Biaya",
        "Tax": "Pajak",
        "Pending receivable": "Piutang tertunda",
        "Pending payable": "Utang tertunda",
        "Others": "Lainnya",

        // ── Finance categories (display only; stored value unchanged) ────────
        "Revenue": "Pendapatan",
        "Marketing": "Marketing",
        "Infrastructure": "Infrastruktur",
        "SaaS": "SaaS",

        // ── Status labels / badges ───────────────────────────────────────────
        "Completed": "Selesai",
        "Reconciled": "Terekonsiliasi",
        "Pending": "Tertunda",
        "Missing Receipt": "Struk Hilang",
        "Cancelled": "Dibatalkan",
        "Paid": "Lunas",
        "Unpaid": "Belum Dibayar",
        "Overdue": "Lewat Jatuh Tempo",
        "Scheduled": "Terjadwal",
        "Active": "Aktif",
        "Archived": "Diarsipkan",
        "Draft": "Draf",
        "Healthy": "Sehat",
        "At risk": "Berisiko",
        "Exceeded": "Terlampaui",
        "Approved": "Disetujui",
        "Rejected": "Ditolak",
        "Synced": "Tersinkronisasi",
        "Connected": "Terhubung",
        "Not connected": "Belum Terhubung",

        // ── Add Transaction drawer (shared-dashboard.js) ─────────────────────
        "Add Transaction": "Tambah Transaksi",
        "Add New Bill": "Tambah Tagihan Baru",
        "Add Subscription": "Tambah Langganan",
        "Finance entry": "Entri keuangan",
        "Single transaction": "Transaksi tunggal",
        "CSV bulk upload": "Unggah massal CSV",
        "Amount (Rp)": "Jumlah (Rp)",
        "Vendor / Description": "Vendor / Deskripsi",
        "Transaction Date": "Tanggal Transaksi",
        "Due Date": "Jatuh Tempo",
        "Category": "Kategori",
        "Type": "Jenis",
        "Status": "Status",
        "Budget allocation": "Alokasi anggaran",
        "Auto-match by category": "Cocokkan otomatis berdasarkan kategori",
        "Don't track against budget": "Jangan lacak terhadap anggaran",
        "Set when this bill is due for payment. Future dates are allowed.":
            "Tetapkan kapan tagihan ini jatuh tempo. Tanggal mendatang diperbolehkan.",
        "Defaults to today. Choose a previous day for backdated records.":
            "Default ke hari ini. Pilih hari sebelumnya untuk catatan yang dimundurkan.",
        "Pin this expense to a budget allocation now, or leave it to match by category.":
            "Sematkan pengeluaran ini ke alokasi anggaran sekarang, atau biarkan tercocokkan berdasarkan kategori.",
        "Choose or drop a CSV file": "Pilih atau jatuhkan file CSV",
        "The file is validated before anything is saved.":
            "File divalidasi sebelum apa pun disimpan.",
        "CSV import preview": "Pratinjau impor CSV",
        "Ready": "Siap",
        "Write the reason": "Tulis alasannya",
        "Why is this record being updated?": "Mengapa catatan ini diperbarui?",
        "Choose a reason before continuing": "Pilih alasan sebelum melanjutkan",
        "Reason": "Alasan",

        // ── Toast / dialog messages (shared + settings) ──────────────────────
        "Session expired. Please log in again.": "Sesi berakhir. Silakan masuk kembali.",
        "Permission Denied": "Akses Ditolak",
        "Could not load finance settings. Please try again.":
            "Tidak dapat memuat pengaturan keuangan. Silakan coba lagi.",
        "Could not save finance settings. Please try again.":
            "Tidak dapat menyimpan pengaturan keuangan. Silakan coba lagi.",
        "Could not load finance settings. Refresh the page or try again in a moment.":
            "Tidak dapat memuat pengaturan keuangan. Muat ulang halaman atau coba lagi sebentar.",
        "Finance preferences saved.": "Preferensi keuangan tersimpan.",
        "Could not save. Check your connection and try again.":
            "Tidak dapat menyimpan. Periksa koneksi Anda dan coba lagi.",

        // ── Page titles + topbar subtitles ───────────────────────────────────
        "Here is your finance workbench for today.":
            "Berikut ruang kerja keuangan Anda hari ini.",
        "Financial Ledger": "Buku Besar Keuangan",
        "Bills & Payments": "Tagihan & Pembayaran",
        "Active Subscriptions": "Langganan Aktif",
        "Create invoice": "Buat invoice",
        "New AI chat": "Chat AI baru",
        "Review, map, reconcile, and prepare your books for close.":
            "Tinjau, petakan, rekonsiliasi, dan siapkan pembukuan Anda untuk tutup buku.",
        "Accounting Records": "Catatan Akuntansi",
        "Inspect source records behind an Income Statement line.":
            "Periksa catatan sumber di balik baris Laporan Laba Rugi.",
        "A point-in-time view of your assets, liabilities, and net position.":
            "Tampilan posisi aset, liabilitas, dan ekuitas bersih Anda pada satu titik waktu.",

        // ── Bills page (representative static text) ──────────────────────────
        "Track upcoming bills, vendor invoices, and payable obligations before they become transactions.":
            "Pantau tagihan mendatang, invoice vendor, dan kewajiban utang sebelum menjadi transaksi.",
        "Scan Bill": "Pindai Tagihan",
        "Bill Details": "Detail Tagihan",
        "Total Bills": "Total Tagihan",
        "Due This Week": "Jatuh Tempo Minggu Ini",
        "Missing Date": "Tanggal Hilang",
        "Vendor": "Vendor",
        "Amount": "Jumlah",
        "Action": "Tindakan",
        "Actions": "Tindakan",

        // ── Settings hub (settings.html) ─────────────────────────────────────
        "Manage workspace, finance rules, AI behavior, and connection settings.":
            "Kelola ruang kerja, aturan keuangan, perilaku AI, dan pengaturan koneksi.",
        "No settings found.": "Tidak ada pengaturan yang ditemukan.",
        "Personal settings": "Pengaturan Pribadi",
        "Workspace settings": "Pengaturan Ruang Kerja",
        "Finance setup": "Penyiapan Keuangan",
        "Product settings": "Pengaturan Produk",
        "Planned": "Direncanakan",
        "Personal details": "Detail Pribadi",
        "Notifications & email": "Notifikasi & Email",
        "Business": "Bisnis",
        "Team and security": "Tim dan Keamanan",
        "Finance preferences": "Preferensi Keuangan",
        "Categories and import rules": "Kategori dan Aturan Impor",
        "AI preferences": "Preferensi AI",
        "WhatsApp connection": "Koneksi WhatsApp",
        "Cash & Bank Accounts": "Kas & Rekening Bank",
        "Budget Settings": "Pengaturan Anggaran",
        "Cash Pressure Rules": "Aturan Tekanan Kas",
        "Categories": "Kategori",
        "Tax & Fees": "Pajak & Biaya",
        "Data export": "Ekspor Data",
        "Billing & plan": "Penagihan & Paket",
        "Language": "Bahasa",
        "Language & Region": "Bahasa & Wilayah",
        "Contact information, password, authentication methods, and active sessions.":
            "Informasi kontak, kata sandi, metode autentikasi, dan sesi aktif.",
        "Weekly financial digest and email preferences.":
            "Ringkasan keuangan mingguan dan preferensi email.",
        "Business profile, entity label, country, timezone, and workspace identity.":
            "Profil bisnis, label entitas, negara, zona waktu, dan identitas ruang kerja.",
        "Roles, account access, security rules, and authorized sessions.":
            "Peran, akses akun, aturan keamanan, dan sesi yang diizinkan.",
        "Currency, locale, date format, reporting period, and finance display rules.":
            "Mata uang, lokal, format tanggal, periode pelaporan, dan aturan tampilan keuangan.",
        "Default categories, CSV behavior, document routing, and review-before-save rules.":
            "Kategori default, perilaku CSV, perutean dokumen, dan aturan tinjau-sebelum-simpan.",
        "AI answer style, data quality warnings, and safe action drafting.":
            "Gaya jawaban AI, peringatan kualitas data, dan penyusunan tindakan yang aman.",
        "WhatsApp number mapping, connection status, upload routing, and pending confirmations.":
            "Pemetaan nomor WhatsApp, status koneksi, perutean unggahan, dan konfirmasi tertunda.",
        "Manage manual balances, update snapshots, archive accounts, and view balance history.":
            "Kelola saldo manual, perbarui snapshot, arsipkan rekening, dan lihat riwayat saldo.",
        "Set the active OpEx budget, edit in place, archive when starting a new period, and view history.":
            "Tetapkan anggaran OpEx aktif, ubah langsung, arsipkan saat memulai periode baru, dan lihat riwayat.",
        "Choose how FluxyOS estimates short-term cash pressure.":
            "Pilih cara FluxyOS memperkirakan tekanan kas jangka pendek.",
        "Manage finance categories used across ledger and reports.":
            "Kelola kategori keuangan yang digunakan di buku besar dan laporan.",
        "Configure default tax codes, fees, and platform deductions.":
            "Konfigurasikan kode pajak default, biaya, dan potongan platform.",
        "Connected finance tools, revenue sources, and data sync.":
            "Tools keuangan terhubung, sumber pendapatan, dan sinkronisasi data.",
        "Export preferences and accountant-ready data settings.":
            "Preferensi ekspor dan pengaturan data siap-akuntan.",
        "Plan, billing status, usage limits, invoices, and subscription changes.":
            "Paket, status penagihan, batas penggunaan, invoice, dan perubahan langganan.",
        "Switch the dashboard between English and Bahasa Indonesia.":
            "Beralih antara dashboard berbahasa English dan Bahasa Indonesia.",

        // ── Finance preferences page (settings-finance.html) ─────────────────
        "Currency, locale, date format, and finance display rules.":
            "Mata uang, lokal, format tanggal, dan aturan tampilan keuangan.",
        "Currency": "Mata uang",
        "Locale": "Lokal",
        "Timezone": "Zona waktu",
        "Date format": "Format tanggal",
        "IDR is locked for MVP.": "IDR dikunci untuk MVP.",
        "Bahasa Indonesia formatting rules.": "Aturan format Bahasa Indonesia.",
        "Finance display rules apply across dashboard, reports, and AI.":
            "Aturan tampilan keuangan berlaku di dashboard, laporan, dan AI.",
        "Recurring revenue categories": "Kategori pendapatan berulang",
        "Used by Reports & Exports for Estimated ARR.":
            "Digunakan oleh Laporan & Ekspor untuk Estimasi ARR.",

        // ── Language & Region page (settings-language.html) ──────────────────
        "Choose the language FluxyOS uses across the dashboard, reports, and Fluxy AI.":
            "Pilih bahasa yang digunakan FluxyOS di seluruh dashboard, laporan, dan Fluxy AI.",
        "Display language": "Bahasa tampilan",
        "English": "English",
        "Bahasa Indonesia": "Bahasa Indonesia",
        "The interface switches immediately. Amounts always stay in Rupiah (Rp).":
            "Antarmuka langsung berganti. Jumlah uang selalu tetap dalam Rupiah (Rp).",
        "Language preference saved.": "Preferensi bahasa tersimpan."
    };

    // ─────────────────────────────────────────────────────────────────────────
    //  PATTERNS  —  interpolated strings exact-match can't catch.
    //  Applied (in order) only to nodes that miss an exact dictionary key.
    // ─────────────────────────────────────────────────────────────────────────
    var PATTERNS = [
        { re: /^Showing\s+(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)\s+of\s+(\d[\d.,]*)\s+records?$/i,
          id: function (m) { return 'Menampilkan ' + m[1] + '–' + m[2] + ' dari ' + m[3] + ' catatan'; } },
        { re: /^(\d[\d.,]*)\s+revenue records?$/i,
          id: function (m) { return m[1] + ' catatan pendapatan'; } },
        { re: /^(\d[\d.,]*)\s+transactions?$/i,
          id: function (m) { return m[1] + ' transaksi'; } },
        { re: /^(\d[\d.,]*)\s+records?$/i,
          id: function (m) { return m[1] + ' catatan'; } },
        { re: /^(\d[\d.,]*)\s+bills?$/i,
          id: function (m) { return m[1] + ' tagihan'; } },
        { re: /^Rp([\d.,]+)\s+left$/i,
          id: function (m) { return 'Sisa Rp' + m[1]; } },
        { re: /^All-time revenue$/i, id: function () { return 'Pendapatan sepanjang waktu'; } }
    ];
    // ─────────────────────────────────────────────────────────────────────────

    function getLang() {
        try { return localStorage.getItem(STORAGE_KEY) || 'en'; }
        catch (e) { return 'en'; }
    }

    function setLang(lang) {
        lang = lang === 'id' ? 'id' : 'en';
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        if (lang === 'id') {
            translatePage();
        } else {
            // Revert by reloading — simpler and safer than tracking originals.
            window.location.reload();
            return;
        }
        try {
            window.dispatchEvent(new CustomEvent('fluxy:lang-changed', { detail: { lang: lang } }));
        } catch (e) {}
    }

    function translateString(trimmed) {
        if (Object.prototype.hasOwnProperty.call(ID, trimmed)) return ID[trimmed];
        for (var i = 0; i < PATTERNS.length; i++) {
            var m = trimmed.match(PATTERNS[i].re);
            if (m) return PATTERNS[i].id(m);
        }
        return null;
    }

    function translatePage() {
        if (!document.body) return;
        var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                    if (SKIP_TAGS.indexOf(node.parentElement.tagName) !== -1) return NodeFilter.FILTER_REJECT;
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );

        var nodes = [];
        var n;
        while ((n = walker.nextNode())) nodes.push(n);

        nodes.forEach(function (node) {
            var original = node.nodeValue;
            var trimmed = original.trim();
            var translated = translateString(trimmed);
            if (translated !== null) {
                var lead = original.match(/^\s*/)[0];
                var trail = original.match(/\s*$/)[0];
                node.nodeValue = lead + translated + trail;
            }
        });

        // Translate <title> if it has a mapping.
        if (document.title) {
            var t = translateString(document.title.trim());
            if (t !== null) document.title = t;
        }

        document.documentElement.setAttribute('lang', 'id');
    }

    // ── Locale-aware helpers used by date formatters across the app ──────────
    function locale() { return getLang() === 'id' ? 'id-ID' : 'en-GB'; }

    function formatDate(date, options) {
        var d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        var opts = options || { day: 'numeric', month: 'short', year: 'numeric' };
        try { return new Intl.DateTimeFormat(locale(), opts).format(d); }
        catch (e) { return d.toLocaleDateString(); }
    }

    function t(key, vars) {
        var out = (getLang() === 'id' && Object.prototype.hasOwnProperty.call(ID, key)) ? ID[key] : key;
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
            });
        }
        return out;
    }

    window.FluxyI18n = {
        getLang: getLang,
        setLang: setLang,
        t: t,
        locale: locale,
        formatDate: formatDate,
        translate: translatePage
    };

    function init() {
        if (getLang() === 'id') translatePage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-translate async-injected DOM (sidebar, drawers, dialogs, toasts,
    // re-rendered tables). Debounced via rAF so frequent table re-renders don't
    // thrash. We observe childList only (textContent/innerHTML writes replace
    // child text nodes): translatePage edits nodeValue and never adds/removes
    // nodes, so it can never re-trigger this observer — no feedback loop.
    var scheduled = false;
    var observer = new MutationObserver(function (mutations) {
        if (getLang() !== 'id') return;
        var hasNew = mutations.some(function (m) {
            return m.addedNodes && m.addedNodes.length > 0;
        });
        if (!hasNew || scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || window.setTimeout)(function () {
            scheduled = false;
            translatePage();
        });
    });
    function startObserving() {
        observer.observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) {
        startObserving();
    } else {
        document.addEventListener('DOMContentLoaded', startObserving);
    }
})();
