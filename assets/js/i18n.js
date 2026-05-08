/**
 * FluxyOS Language Switcher (EN/ID)
 *
 * - Walks text nodes and replaces English with Indonesian using a dictionary
 * - Persists preference in localStorage so the choice carries across pages
 * - Hooks the existing EN/ID dropdown in the navbar (and the pricing-page variant)
 * - Runs on every landing page (script tag added to each HTML file)
 *
 * Adding a missing translation: just add a key to the ID object below.
 * Keys must match the EXACT English text as it appears between HTML tags
 * (after JS .trim()). Multi-node phrases must be split per text node.
 *
 * See LOCALIZATION_PLAN.md for tone rules and term glossary.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'fluxyos-lang';

    // ─────────────────────────────────────────────────────────────────────────
    //  TRANSLATION DICTIONARY  —  English  →  Indonesian
    // ─────────────────────────────────────────────────────────────────────────
    var ID = {
        // ── Page titles ──────────────────────────────────────────────────────
        "FluxyOS | Unified Business Economics": "FluxyOS | Sistem Operasi Keuangan Bisnis Anda",
        "Vendor Spend | FluxyOS": "Vendor Spend | FluxyOS",
        "Revenue Sync | FluxyOS": "Revenue Sync | FluxyOS",
        "Receipt Capture | FluxyOS": "Receipt Capture | FluxyOS",
        "FluxyOS AI Agents | FluxyOS": "FluxyOS AI Agents | FluxyOS",
        "Dynamic Budgeting | FluxyOS": "Dynamic Budgeting | FluxyOS",
        "Pricing | FluxyOS": "Harga | FluxyOS",

        // ── Navbar — top level ──────────────────────────────────────────────
        "Platform": "Platform",
        "Use Cases": "Studi Kasus",
        "Customers": "Pelanggan",
        "Pricing": "Harga",
        "Sign in": "Masuk",
        "Try FluxyOS": "Coba FluxyOS",
        "Integrations": "Integrasi",

        // ── Navbar — Features column ────────────────────────────────────────
        "Features": "Fitur",
        "Dynamic Budgeting": "Dynamic Budgeting",
        "Allocate and track funds live": "Atur dan pantau dana secara real-time",
        "Vendor Spend": "Vendor Spend",
        "Manage SaaS & contract payouts": "Kelola pembayaran SaaS & vendor",
        "Revenue Sync": "Revenue Sync",
        "Ingest client retainers & POS": "Tarik data retainer & POS otomatis",
        "Receipt Capture": "Receipt Capture",
        "Automate manual paper chasing": "Otomatiskan urusan struk",

        // ── Navbar — Platform column ────────────────────────────────────────
        "FluxyOS AI Agents": "FluxyOS AI Agents",
        "Multiply finance efficiency instantly": "Lipat-gandakan efisiensi keuangan",
        "Global Ready": "Siap Global",
        "Reconcile 120+ currencies globally": "Cocokkan 120+ mata uang dunia",
        "Native Integrations": "Integrasi Bawaan",
        "Connect ERPs, HRIS & Productivity": "Hubungkan ERP, HRIS & tools",

        // ── Navbar — New Release sidebar ────────────────────────────────────
        "New Release": "Rilis Terbaru",
        "WhatsApp AI Agents →": "WhatsApp AI Agents →",
        "Chat directly with your ledger to resolve missing receipts, sync vendors, and check live budgets on the go.":
            "Chat langsung dengan ledger Anda untuk menyelesaikan struk hilang, sync vendor, dan cek budget di mana saja.",

        // ── Navbar — Use Cases ──────────────────────────────────────────────
        "By Industry": "Berdasarkan Industri",
        "By Role": "Berdasarkan Peran",
        "E-Commerce Brands": "Brand E-Commerce",
        "Reconcile thousands of POS & gateway transactions.": "Cocokkan ribuan transaksi POS & payment gateway.",
        "Tech Startups & SaaS": "Tech Startup & SaaS",
        "Manage burn rates, runway, and software subscriptions.": "Kelola burn rate, runway, dan langganan software.",
        "Marketing Agencies": "Agensi Marketing",
        "Map digital ad spend to specific client budgets seamlessly.": "Petakan biaya iklan digital ke budget klien dengan mulus.",
        "Retail & Franchises": "Ritel & Franchise",
        "Consolidate P&L records across multiple physical locations.": "Konsolidasi laporan P&L dari banyak lokasi sekaligus.",
        "Dropshippers & Digital Ads": "Dropshipper & Iklan Digital",
        "Scale your active stores by tracking live ad ROI against supplier costs to pinpoint true net margins.":
            "Skalakan toko Anda dengan pantau ROI iklan dan biaya supplier — temukan margin bersih yang sebenarnya.",
        "Manufacturing": "Manufaktur",
        "Track live unit economics and manufacturer costs as you scale up operations.":
            "Pantau unit economics dan biaya pabrikan saat Anda scale up.",

        "CFOs & Finance Teams": "CFO & Tim Keuangan",
        "Automate reconciliation and month-end closes.": "Otomatiskan rekonsiliasi dan tutup buku bulanan.",
        "Founders & CEOs": "Founder & CEO",
        "Real-time visibility into overall business economics.": "Visibilitas real-time atas ekonomi bisnis secara keseluruhan.",
        "Department Heads": "Kepala Departemen",
        "Track live spend against allocated internal budgets.": "Pantau pengeluaran live terhadap budget internal.",

        "Featured Story": "Cerita Pilihan",
        "Case Study": "Studi Kasus",
        "Scaling an Omnichannel Fashion Brand": "Scale-up Brand Fashion Omnichannel",
        "Read the story →": "Baca selengkapnya →",
        "See how a growing modest fashion label unified their retail POS and e-commerce channels to track live unit economics.":
            "Lihat bagaimana brand fashion modest menyatukan POS ritel dan e-commerce untuk pantau unit economics live.",

        // ── Mobile menu ─────────────────────────────────────────────────────
        "Reconcile POS & gateway transactions.": "Cocokkan transaksi POS & gateway.",
        "Manage burn, runway, and subscriptions.": "Kelola burn, runway, dan langganan.",
        "Map ad spend to client budgets.": "Petakan biaya iklan ke budget klien.",
        "Track unit economics and costs.": "Pantau unit economics dan biaya.",

        // ── Language dropdown ───────────────────────────────────────────────
        "English (EN)": "English (EN)",
        "Bahasa (ID)": "Bahasa (ID)",
        "EN": "EN",
        "ID": "ID",

        // ── Common CTAs ─────────────────────────────────────────────────────
        "Get started free": "Coba Gratis",
        "Get Started Free": "Coba Gratis",
        "Start free trial": "Mulai Gratis",
        "Start Free Trial": "Mulai Gratis",
        "See pricing": "Lihat Harga",
        "Book a demo": "Pesan Demo",
        "Learn more": "Pelajari lebih lanjut",
        "Try it free": "Coba Gratis",
        "Get started": "Mulai sekarang",
        "Connect": "Hubungkan",
        "Disconnect": "Putuskan",
        "Linked": "Terhubung",
        "Coming soon": "Segera hadir",

        // ── Generic UI ──────────────────────────────────────────────────────
        "Today": "Hari ini",
        "today": "hari ini",
        "This week": "Minggu ini",
        "this week": "minggu ini",
        "This month": "Bulan ini",
        "this month": "bulan ini",
        "Last month": "Bulan lalu",
        "Last quarter": "Kuartal lalu",
        "Saves you": "Hemat",
        "Brings back": "Mengembalikan",
        "Live": "Live",
        "LIVE": "LIVE",
        "Active": "Aktif",
        "ACTIVE": "AKTIF",
        "Watching": "Memantau",
        "WATCHING": "MEMANTAU",
        "Drafting": "Menyusun",
        "DRAFTING": "MENYUSUN",
        "Standing by": "Siap siaga",
        "STANDING BY": "SIAP SIAGA",
        "Done": "Beres",
        "Approved": "Disetujui",
        "Paid": "Lunas",
        "Pending": "Menunggu",
        "Needs approval": "Perlu persetujuan",
        "Needs you": "Perlu Anda",
        "Review": "Tinjau",
        "Working": "Berjalan",
        "Reconciled": "Tercocokkan",
        "Captured": "Terambil",

        // ── Homepage hero (fluxyos.html) ────────────────────────────────────
        "The Finance Operation System for modern scale-ups.": "Sistem Operasi Keuangan untuk bisnis yang sedang scale-up.",
        "Connect your sales channels, digital ad platforms, and vendor invoices into one central Finance Operation System. Stop piecing together spreadsheets and start scaling with crystal-clear visibility.":
            "Hubungkan saluran penjualan, platform iklan digital, dan invoice vendor dalam satu Sistem Operasi Keuangan. Berhenti merangkai spreadsheet — mulai scale-up dengan visibilitas penuh.",
        "Track live operational costs against daily revenue.": "Pantau biaya operasional live terhadap pendapatan harian.",
        "Automate manual receipt matching and reconciliation.": "Otomatiskan pencocokan struk dan rekonsiliasi.",
        "Control your operations today.": "Kendalikan operasi bisnis Anda hari ini.",
        "Stop waiting for month-end reports. Get a live, unified view of your client revenue, budgets, and operational expenses.":
            "Berhenti menunggu laporan akhir bulan. Dapatkan pandangan live yang terpadu atas pendapatan klien, budget, dan biaya operasional.",
        "currencies supported for automated vendor reconciliation": "mata uang didukung untuk rekonsiliasi vendor otomatis",
        "operational spend processed and categorized annually": "biaya operasional diproses dan dikategorikan setiap tahun",
        "countries from which you can track localized expenses": "negara untuk pantau biaya lokal",

        // ── Revenue Sync page ───────────────────────────────────────────────
        "Sync revenue from every channel, instantly": "Sinkronkan pendapatan dari semua saluran, instan",
        "Connect Stripe, Shopify, Tokopedia, TikTok Shop, Gumroad, and 250+ platforms. Every transaction syncs to your ledger in under 30 seconds. No manual work. Pure automation.":
            "Hubungkan Stripe, Shopify, Tokopedia, TikTok Shop, dan 250+ platform. Setiap transaksi masuk ke ledger Anda dalam 30 detik. Tanpa kerjaan manual.",
        "Start Syncing Now": "Mulai Sinkronisasi",
        "Explore Integrations": "Jelajahi Integrasi",
        "Integrations": "Integrasi",
        "TPV Synced": "Total Volume Sync",
        "Sync Latency": "Kecepatan Sync",
        "Watch transactions sync in real-time": "Lihat transaksi sync secara real-time",
        "Every payment, invoice, and refund from any channel flows directly into your unified ledger — no middleware, no delays, no headaches.":
            "Setiap pembayaran, invoice, dan refund dari semua saluran langsung masuk ke ledger Anda — tanpa middleware, tanpa delay, tanpa pusing.",
        "Inbound Revenue": "Pendapatan Masuk",
        "Stripe, Shopify, Tokopedia—payments stream in from every source, all channels, all currencies unified automatically.":
            "Stripe, Shopify, Tokopedia — pembayaran masuk dari semua sumber, semua saluran, semua mata uang otomatis tergabung.",
        "Smart Processing": "Pemrosesan Cerdas",
        "AI auto-classifies by channel, strips out duplicates, handles refunds—everything categorized and ready for your ledger.":
            "AI klasifikasi otomatis per saluran, hapus duplikat, tangani refund — semua dikategorikan dan siap masuk ledger.",
        "Live Ledger Update": "Update Ledger Live",
        "Your dashboard refreshes instantly. See exactly how much revenue is flowing in, from which channels, right now.":
            "Dashboard Anda update instan. Lihat persis berapa pendapatan masuk, dari saluran mana, sekarang.",
        "Why businesses choose Revenue Sync": "Kenapa bisnis memilih Revenue Sync",
        "Stop losing money to manual reconciliation. Get real-time visibility across all your revenue streams.":
            "Berhenti rugi karena rekonsiliasi manual. Dapatkan visibilitas real-time atas semua pendapatan Anda.",
        "Instant Reconciliation": "Rekonsiliasi Instan",
        "Every transaction syncs in under 30 seconds. No more waiting for settlement windows or manual CSV uploads.":
            "Setiap transaksi sync dalam 30 detik. Tidak perlu menunggu settlement window atau upload CSV manual.",
        "Multi-Channel View": "Tampilan Multi-Saluran",
        "Consolidate revenue from POS, e-commerce, marketplaces, and payment gateways in one unified dashboard.":
            "Konsolidasi pendapatan dari POS, e-commerce, marketplace, dan payment gateway dalam satu dashboard.",
        "Zero Manual Work": "Tanpa Kerja Manual",
        "API-powered syncing means no copy-paste, no errors, no Friday night reconciliation sessions.":
            "Sync via API artinya tanpa copy-paste, tanpa error, tanpa rekonsiliasi malam Jumat.",
        "Accurate Cash Flow": "Cash Flow Akurat",
        "Know exactly how much revenue flows from each channel. Spot discrepancies instantly before they become problems.":
            "Tahu persis berapa pendapatan dari setiap saluran. Temukan kejanggalan sebelum jadi masalah.",
        "Bank-Level Security": "Keamanan Tingkat Bank",
        "Encrypted connections to all providers. Read-only API access means your transactions are safe and auditable.":
            "Koneksi terenkripsi ke semua provider. Akses API read-only menjaga transaksi Anda aman dan auditable.",
        "AI-Powered Insights": "Insight Bertenaga AI",
        "Ask Fluxy AI to identify trends, spot anomalies, and uncover hidden revenue leaks across all channels.":
            "Tanya Fluxy AI untuk identifikasi tren, deteksi anomali, dan temukan kebocoran pendapatan tersembunyi.",
        "Connect your favorite platforms": "Hubungkan platform favorit Anda",
        "Revenue Sync works with all major payment processors, POS systems, marketplaces, and product platforms.":
            "Revenue Sync bekerja dengan semua payment processor utama, POS, marketplace, dan platform produk.",
        "Stop losing revenue to manual work": "Berhenti kehilangan pendapatan karena kerja manual",
        "Set up Revenue Sync in minutes. Sync transactions in real-time. Make smarter business decisions backed by accurate, live data.":
            "Setup Revenue Sync dalam hitungan menit. Sync transaksi real-time. Ambil keputusan bisnis lebih baik dengan data live yang akurat.",
        "View Integrations": "Lihat Integrasi",
        "Multi-Channel Revenue Intelligence": "Multi-Channel Revenue Intelligence",
        "Live Ledger": "Ledger Live",

        // ── Vendor Spend page ───────────────────────────────────────────────
        "Every vendor invoice.": "Setiap invoice vendor.",
        "One place to control them.": "Satu tempat untuk kendalikan semua.",
        "Stop chasing vendor invoices in email threads and Slack messages. Centralize every contract, subscription, and one-off payment so finance always knows what's going out — and why.":
            "Berhenti mengejar invoice vendor di tumpukan email dan Slack. Pusatkan setiap kontrak, langganan, dan pembayaran sekali jalan — supaya tim keuangan selalu tahu apa yang keluar, dan kenapa.",
        "See how it works": "Lihat cara kerjanya",
        "Saved per month": "Dihemat per bulan",
        "Fewer late payments": "Pembayaran telat berkurang",
        "Avg. approval time": "Rata-rata waktu approval",
        "Total": "Total",
        "From invoice to payment, all in one flow": "Dari invoice ke pembayaran, satu alur",
        "Three simple steps. No spreadsheets, no email back-and-forth, no missed renewals.":
            "Tiga langkah sederhana. Tanpa spreadsheet, tanpa balasan email bolak-balik, tanpa renewal terlewat.",
        "Capture every invoice": "Tangkap setiap invoice",
        "Forward bills to your FluxyOS inbox or upload them in bulk. Vendor name, amount, and due date get pulled automatically — no manual entry.":
            "Forward tagihan ke inbox FluxyOS Anda atau upload sekaligus. Nama vendor, jumlah, dan jatuh tempo diambil otomatis — tanpa input manual.",
        "Route for approval": "Atur alur approval",
        "Set rules once: who approves what, by amount, by category, by team. Approvers get a Slack ping and one-click approve.":
            "Atur aturan sekali: siapa setuju apa, berdasarkan jumlah, kategori, atau tim. Approver dapat notif Slack dan tinggal klik setuju.",
        "Pay on schedule": "Bayar sesuai jadwal",
        "Approved invoices queue for payment. Pay through your linked bank, or batch payments by due date. Every transaction lands in your ledger.":
            "Invoice yang disetujui masuk antrian. Bayar via bank yang terhubung, atau batch berdasarkan jatuh tempo. Setiap transaksi masuk ledger.",
        "Built for finance teams who hate surprises": "Dibuat untuk tim keuangan yang benci kejutan",
        "The unglamorous work of vendor management — done properly, so you can spend time on the real numbers.":
            "Pekerjaan vendor management yang ribet — beres dengan rapi, supaya Anda bisa fokus ke angka yang penting.",
        "Catch duplicate payments": "Tangkap pembayaran ganda",
        "Same invoice forwarded twice? Same vendor charging the same amount in the same month? You'll see it before you pay.":
            "Invoice sama di-forward dua kali? Vendor sama menagih jumlah sama di bulan yang sama? Anda lihat sebelum bayar.",
        "Approve before money leaves": "Setujui sebelum uang keluar",
        "Set who signs off on what. Anything above Rp 5M needs a director. Anything from a new vendor needs procurement. Your call.":
            "Atur siapa setuju apa. Di atas Rp 5 juta perlu direktur. Vendor baru perlu procurement. Anda yang putuskan.",
        "Spot forgotten subscriptions": "Temukan langganan yang terlupa",
        "That tool the marketing team stopped using six months ago? It's still charging Rp 2.4M a month. We'll flag the renewal before it hits.":
            "Tools yang tim marketing sudah tidak pakai 6 bulan lalu? Masih nagih Rp 2,4 juta sebulan. Kami flag sebelum diperpanjang.",
        "See recurring vs. one-off": "Pisahkan rutin vs sekali bayar",
        "Separate the bills you'll pay forever from the bills you paid once. Understand your true monthly run rate at a glance.":
            "Pisahkan tagihan rutin dari tagihan sekali jalan. Pahami run rate bulanan Anda yang sebenarnya.",
        "Multi-currency, no math": "Multi-mata uang, tanpa hitung",
        "Pay AWS in USD, your local agency in IDR, your team in Vietnam in VND. Everything reconciles to your reporting currency automatically.":
            "Bayar AWS dalam USD, agensi lokal dalam IDR, tim di Vietnam dalam VND. Semua terkonversi otomatis ke mata uang laporan Anda.",
        "Audit-ready, every quarter": "Siap audit, setiap kuartal",
        "Every approval, every payment, every receipt — logged and exportable. When auditors ask, you have the answer in two clicks.":
            "Setiap approval, pembayaran, dan struk — tercatat dan bisa di-export. Saat auditor tanya, jawabannya tinggal dua klik.",
        "Track the vendors you actually use": "Pantau vendor yang Anda pakai",
        "Connect your stack — every charge lands in the right category, automatically.":
            "Hubungkan stack Anda — setiap tagihan masuk kategori yang benar, otomatis.",
        "Connect your stack": "Hubungkan stack Anda",
        "From scattered to centralized": "Dari berserak ke terpusat",
        "Most finance teams cobble together vendor management with five tools and a shared spreadsheet. Here's what changes.":
            "Kebanyakan tim keuangan mengandalkan 5 tools dan spreadsheet bersama. Inilah yang berubah.",
        "Before": "Sebelum",
        "With FluxyOS": "Dengan FluxyOS",
        "The usual setup": "Setup biasa",
        "One source of truth": "Satu sumber kebenaran",
        "Take control of your vendor spend": "Kendalikan pengeluaran vendor Anda",
        "See every contract, every renewal, every payment. No more chasing invoices, no more surprise charges, no more manual reconciliation.":
            "Lihat setiap kontrak, perpanjangan, dan pembayaran. Tidak perlu mengejar invoice, tidak ada biaya kejutan, tidak ada rekonsiliasi manual.",
        "Finance teams who got their evenings back": "Tim keuangan yang dapat malamnya kembali",
        "Real teams running real numbers. Here's what changed when they moved their vendor spend onto FluxyOS.":
            "Tim sungguhan dengan angka sungguhan. Inilah yang berubah saat mereka pindahkan vendor spend ke FluxyOS.",
        "Vendor spend tracked monthly": "Vendor spend dipantau per bulan",
        "Invoices processed": "Invoice diproses",
        "Faster month-end close": "Tutup buku lebih cepat",
        "Reconciliation accuracy": "Akurasi rekonsiliasi",

        // ── Receipt Capture page ────────────────────────────────────────────
        "Snap a receipt.": "Foto struknya.",
        "We'll do the rest.": "Sisanya biar kami.",
        "Upload, email, or send through WhatsApp — Fluxy AI reads every receipt, pulls the numbers, picks the right category, and files it in your books. No data entry. No shoebox.":
            "Upload, email, atau kirim via WhatsApp — Fluxy AI baca setiap struk, ambil angkanya, pilih kategori yang tepat, dan simpan di buku Anda. Tanpa input manual. Tanpa kotak struk.",
        "Try it free": "Coba Gratis",
        "See WhatsApp demo": "Lihat demo WhatsApp",
        "to capture": "untuk tangkap",
        "extraction accuracy": "akurasi ekstraksi",
        "manual entry": "input manual",
        "Zero": "Nol",
        "Four ways to send a receipt.": "Empat cara kirim struk.",
        "All of them painless.": "Semuanya gampang.",
        "Capture wherever the receipt lives — your phone camera, your email inbox, your WhatsApp chat, or your laptop. Fluxy AI does the work after that.":
            "Tangkap di mana saja struknya — kamera HP, inbox email, chat WhatsApp, atau laptop. Fluxy AI yang kerjakan sisanya.",
        "📱 From your phone": "📱 Dari HP Anda",
        "Open the FluxyOS app, tap the camera, point at any receipt. Done before you finish your coffee.":
            "Buka app FluxyOS, tap kamera, arahkan ke struk. Beres sebelum kopi Anda habis.",
        "✉️ Forward via email": "✉️ Forward via email",
        "Got an e-receipt in your inbox? Forward it to your unique FluxyOS email. Auto-filed in seconds.":
            "Dapat e-struk di inbox? Forward ke email FluxyOS Anda. Tersimpan otomatis dalam detik.",
        "💬 Send via WhatsApp": "💬 Kirim via WhatsApp",
        "Snap and send to Fluxy AI on WhatsApp. Reply with category. Done before the bill arrives at your table.":
            "Foto lalu kirim ke Fluxy AI di WhatsApp. Balas kategorinya. Beres sebelum tagihan tiba di meja Anda.",
        "🖥️ Drag and drop": "🖥️ Seret & lepas",
        "Got a folder of PDFs from last quarter? Drop them all in. Bulk processing handles 100+ at once.":
            "Punya folder PDF dari kuartal lalu? Drop semua. Bisa proses 100+ sekaligus.",
        "Most loved": "Paling disukai",
        "Up to 100 files at once": "Sampai 100 file sekaligus",
        "Just send a photo to": "Cukup kirim foto ke",
        "WhatsApp Native": "Native WhatsApp",
        "No new app to install. No login. No remembering yet another password. Open the chat you already use a hundred times a day, send the receipt, and you're done.":
            "Tidak perlu install app baru. Tidak perlu login. Tidak perlu hafal password lagi. Buka chat yang Anda pakai ratusan kali sehari, kirim struk, beres.",
        "Bot replies in under 5 seconds": "Bot balas dalam 5 detik",
        "Confirms vendor, amount, and suggested category — you tap to confirm or correct.":
            "Konfirmasi vendor, jumlah, dan saran kategori — tap untuk setujui atau perbaiki.",
        "Connects straight to your dashboard": "Langsung tersambung ke dashboard",
        "Every photo lands in your FluxyOS ledger automatically. Visible to your finance team in real time.":
            "Setiap foto otomatis masuk ke ledger FluxyOS. Terlihat oleh tim keuangan secara real-time.",
        "Works for the whole team": "Untuk seluruh tim",
        "Sales reps, ops staff, founders — anyone with a company number can submit. Tagged to the sender automatically.":
            "Sales, staf ops, founder — siapa saja dengan nomor perusahaan bisa submit. Otomatis tertagging ke pengirim.",
        "What Fluxy AI pulls from every receipt.": "Yang Fluxy AI ambil dari setiap struk.",
        "Not just totals — vendor names, line items, tax breakdowns, payment methods. Everything your books actually need.":
            "Bukan cuma total — nama vendor, item per item, rincian pajak, metode pembayaran. Semua yang dibutuhkan pembukuan Anda.",
        "Vendor name": "Nama vendor",
        "Matched against your existing vendor list, or added new.": "Dicocokkan dengan daftar vendor, atau ditambahkan baru.",
        "Total amount": "Jumlah total",
        "In any currency, converted automatically.": "Mata uang apa saja, otomatis terkonversi.",
        "Date & time": "Tanggal & jam",
        "Cross-checked against the upload date for sanity.": "Dicek silang dengan tanggal upload untuk akurasi.",
        "Tax breakdown": "Rincian pajak",
        "PPN, service charge, discount — line by line.": "PPN, service charge, diskon — per baris.",
        "Line items": "Item per item",
        "Each item, qty, and unit price — exportable.": "Setiap item, qty, dan harga satuan — bisa di-export.",
        "Payment method": "Metode pembayaran",
        "Cash, card, GoPay, OVO — matched to source.": "Tunai, kartu, GoPay, OVO — dicocokkan dengan sumber.",
        "Confidence scores on every field": "Skor confidence di setiap kolom",
        "Below 90%? Fluxy AI flags it for a quick human review. No silent mistakes in your books.":
            "Di bawah 90%? Fluxy AI flag untuk Anda cek cepat. Tidak ada kesalahan diam-diam di pembukuan.",
        "From shoebox to dashboard —": "Dari kotak struk ke dashboard —",
        "automatically.": "otomatis.",
        "Receipts don't pile up anymore. They sort themselves into categories, totals roll up by month, and exports come out ready for your accountant — or your tax filing.":
            "Struk tidak menumpuk lagi. Otomatis tersusun per kategori, total dijumlahkan per bulan, dan ekspor siap untuk akuntan — atau pelaporan pajak.",
        "Reporting": "Pelaporan",
        "Stop typing receipt data into spreadsheets.": "Berhenti ketik data struk ke spreadsheet.",
        "Try Receipt Capture free. Snap, send through WhatsApp, or forward an email — see your books update in real time.":
            "Coba Receipt Capture gratis. Foto, kirim WhatsApp, atau forward email — lihat pembukuan update real-time.",

        // ── AI Agents page ──────────────────────────────────────────────────
        "Your finance team,": "Tim keuangan Anda,",
        "doubled overnight.": "jadi dua kali lipat dalam semalam.",
        "Six AI agents handle the work that keeps your team up late — categorizing transactions, reconciling bank feeds, chasing unpaid invoices, drafting reports. They read every line, show their reasoning, and ask before anything moves.":
            "Enam AI agent menangani pekerjaan yang membuat tim Anda lembur — kelompokkan transaksi, cocokkan rekening bank, kejar invoice belum dibayar, susun laporan. Mereka baca setiap baris, tunjukkan alasannya, dan tanya sebelum bertindak.",
        "Meet the team": "Kenalan dengan tim",
        "Always running": "Selalu berjalan",
        "Specialist agents": "Agent spesialis",
        "Decision accuracy": "Akurasi keputusan",
        "AI is analyzing": "AI sedang menganalisis",
        "Decision ready in 1.2 seconds": "Keputusan siap dalam 1,2 detik",
        "A new charge just hit your bank": "Tagihan baru baru saja masuk ke bank Anda",
        "What the AI checked": "Apa yang AI periksa",
        "It's your usual supplier — Nusantara": "Ini supplier langganan Anda — Nusantara",
        "You've paid them 11 times before (avg Rp 6.4M)": "Anda sudah bayar 11 kali sebelumnya (rata-rata Rp 6,4 juta)",
        "Amount looks normal (within 6%)": "Jumlahnya normal (selisih 6%)",
        "Not a duplicate": "Bukan duplikat",
        "Filed under": "Disimpan di",
        "94% confident": "94% yakin",
        "Filed for you. Done.": "Sudah dicatat. Beres.",
        "0.4 seconds total": "0,4 detik total",
        "Matching bank lines": "Mencocokkan baris bank",
        "In progress": "Sedang berjalan",
        "Possible duplicate": "Kemungkinan duplikat",
        "Same supplier billed you twice this week. Want to confirm?": "Supplier sama menagih dua kali minggu ini. Konfirmasi?",
        "Six finance jobs.": "Enam pekerjaan keuangan.",
        "Done automatically.": "Beres otomatis.",
        "Here's exactly what your AI team takes off your plate every day. Each one runs on its own — you only step in when something needs your call.":
            "Inilah yang tim AI Anda kerjakan setiap hari. Masing-masing jalan sendiri — Anda hanya turun tangan saat ada yang perlu keputusan.",
        "Sort every transaction": "Kelompokkan setiap transaksi",
        "Every purchase gets put in the right category — supplies, rent, marketing, payroll. Asks before guessing on anything unusual.":
            "Setiap pengeluaran masuk kategori yang benar — bahan, sewa, marketing, gaji. Tanya dulu kalau ada yang tidak biasa.",
        "~12 hrs / month": "~12 jam / bulan",
        "Match your bank to your books": "Cocokkan bank dengan pembukuan",
        "Every charge in your bank account gets paired with the right invoice or expense. If something doesn't match, it's flagged for you.":
            "Setiap tagihan di rekening bank dipasangkan dengan invoice atau pengeluaran yang benar. Kalau ada yang tidak cocok, langsung di-flag.",
        "~8 hrs / month": "~8 jam / bulan",
        "Chase the customers who haven't paid": "Kejar pelanggan yang belum bayar",
        "Sends polite reminders for every overdue invoice, in your tone. Knows to stop the moment a customer pays.":
            "Kirim pengingat sopan untuk setiap invoice telat, sesuai gaya Anda. Tahu kapan harus berhenti saat pelanggan bayar.",
        "avg Rp 87M / week": "rata-rata Rp 87 juta / minggu",
        "Catch the costly mistakes": "Tangkap kesalahan yang mahal",
        "Spots double payments, oddly large charges, and bills that don't fit your usual pattern — before any money leaves.":
            "Temukan pembayaran ganda, tagihan besar yang aneh, dan biaya yang tidak biasa — sebelum uang keluar.",
        "avg Rp 47M / quarter": "rata-rata Rp 47 juta / kuartal",
        "Write your monthly report": "Tulis laporan bulanan",
        "Your profit and loss, cash position, and where your money went last month — written in plain English, ready by 8am on the 1st.":
            "Laba rugi, posisi kas, dan ke mana uang Anda pergi bulan lalu — ditulis dengan bahasa sederhana, siap jam 8 pagi tanggal 1.",
        "~4 days / month-end": "~4 hari / tutup bulan",
        "Get you ready for tax season": "Persiapan musim pajak",
        "PPN summaries, tax-ready exports, and a clean record of every receipt — so when your accountant asks, the answer is two clicks away.":
            "Rangkuman PPN, ekspor siap pajak, dan catatan rapi setiap struk — supaya saat akuntan tanya, jawabannya dua klik saja.",
        "~2 days / quarter": "~2 hari / kuartal",
        "All six together: about 32 hours back every month.": "Keenamnya: sekitar 32 jam kembali setiap bulan.",
        "That's 4 working days you spend on running your business instead of bookkeeping.": "Itu 4 hari kerja untuk fokus jalankan bisnis, bukan pembukuan.",
        "A Tuesday in November.": "Selasa di bulan November.",
        "Here's what your team gets done while you're in meetings, on Slack, or asleep. Real timestamps, real actions.":
            "Inilah yang dikerjakan tim Anda saat Anda meeting, di Slack, atau tidur. Timestamp asli, aksi asli.",
        "Today at a glance": "Hari ini sekilas",
        "Actions completed": "Aksi selesai",
        "Hours saved": "Jam dihemat",
        "Mismatches caught": "Ketidakcocokan ditemukan",
        "Items needing you": "Perlu perhatian Anda",
        "24-hour activity": "Aktivitas 24 jam",
        "Currently active": "Sedang berjalan",
        "Drafting payment reminder": "Menyusun pengingat pembayaran",
        "Watching for unusual charges": "Memantau tagihan tidak biasa",
        "All quiet so far today": "Semua tenang hari ini",
        "Saved you today": "Hemat hari ini",
        "vs. doing this work manually. Roughly your full afternoon back.": "vs. kerja manual. Sekitar satu sore Anda kembali.",
        "End of day: 1,284 actions completed": "Akhir hari: 1.284 aksi selesai",
        "Your input needed on 2 items — about 4 minutes of your time": "Perlu input Anda di 2 hal — sekitar 4 menit waktu Anda",
        "One charge. One smooth flow.": "Satu tagihan. Satu alur mulus.",
        "No clicks from you.": "Tanpa Anda klik.",
        "A new bill lands at 10:48. By 10:51 it's sorted, checked, matched to your bank, and on your books — without you touching a thing.":
            "Tagihan baru masuk jam 10:48. Jam 10:51 sudah dikelompokkan, dicek, dicocokkan dengan bank, dan masuk pembukuan — tanpa Anda sentuh apa pun.",
        "Receipt arrives": "Struk masuk",
        "Forwarded by ops via email. Office Mart Jakarta, Rp 555.000.": "Di-forward tim ops via email. Office Mart Jakarta, Rp 555.000.",
        "It gets sorted": "Dikelompokkan",
        "Tags it Cost of Sales → Inventory. 99% sure.": "Ditandai Cost of Sales → Inventory. 99% yakin.",
        "Then verified": "Lalu diverifikasi",
        "Checks supplier history. No duplicates, amount looks normal.": "Cek riwayat supplier. Tidak ada duplikat, jumlahnya normal.",
        "Then matched": "Lalu dicocokkan",
        "Pairs it with the BCA debit at 10:32. Your books are up to date.": "Dipasangkan dengan debit BCA jam 10:32. Pembukuan Anda update.",
        "Then logged": "Lalu dicatat",
        "Added to this month's report.": "Ditambahkan ke laporan bulan ini.",
        "From inbox to ledger in 3 minutes. You did nothing.": "Dari inbox ke ledger dalam 3 menit. Anda tidak melakukan apa-apa.",
        "What you get back.": "Yang Anda dapat kembali.",
        "Real numbers from real teams running FluxyOS for six months or more.": "Angka asli dari tim yang sudah pakai FluxyOS 6 bulan atau lebih.",
        "saved per month": "dihemat per bulan",
        "vs. manual data entry and reconciliation": "vs. input dan rekonsiliasi manual",
        "categorization accuracy": "akurasi pengelompokan",
        "after one week of learning your books": "setelah seminggu belajar pembukuan Anda",
        "faster month-end close": "tutup buku lebih cepat",
        "because the books are always current": "karena pembukuan selalu update",
        "avg. recovered per quarter": "rata-rata terselamatkan per kuartal",
        "duplicates caught + faster collections": "duplikat tertangkap + collection lebih cepat",
        "Hire your first six agents": "Sewa enam agent pertama Anda",
        "before lunch tomorrow.": "sebelum makan siang besok.",
        "No training, no onboarding, no payroll. Connect your bank, point them at your chart of accounts, and watch them get to work.":
            "Tanpa training, tanpa onboarding, tanpa gaji. Hubungkan bank Anda, arahkan ke daftar akun, dan lihat mereka bekerja.",

        // ── Footer common ───────────────────────────────────────────────────
        "Product": "Produk",
        "Company": "Perusahaan",
        "Resources": "Sumber Daya",
        "Legal": "Legal",
        "About": "Tentang",
        "Careers": "Karier",
        "Contact": "Kontak",
        "Blog": "Blog",
        "Help Center": "Pusat Bantuan",
        "Documentation": "Dokumentasi",
        "Privacy Policy": "Kebijakan Privasi",
        "Terms of Service": "Ketentuan Layanan",
        "All rights reserved.": "Hak cipta dilindungi.",
    };
    // ─────────────────────────────────────────────────────────────────────────

    function getLang() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'en';
        } catch (e) {
            return 'en';
        }
    }

    function setLang(lang) {
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        if (lang === 'id') {
            translatePage();
        } else {
            // To revert, reload (simpler than tracking original text)
            window.location.reload();
        }
        updateSwitcherUI(lang);
    }

    var SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'];

    function translatePage() {
        // Walk all text nodes in the body
        var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                    if (SKIP_TAGS.indexOf(node.parentElement.tagName) !== -1) return NodeFilter.FILTER_REJECT;
                    if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
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
            if (Object.prototype.hasOwnProperty.call(ID, trimmed)) {
                var lead = original.match(/^\s*/)[0];
                var trail = original.match(/\s*$/)[0];
                node.nodeValue = lead + ID[trimmed] + trail;
            }
        });

        // Translate <title> if present
        if (document.title && Object.prototype.hasOwnProperty.call(ID, document.title)) {
            document.title = ID[document.title];
        }

        // Mark <html lang>
        document.documentElement.setAttribute('lang', 'id');
    }

    function updateSwitcherUI(lang) {
        // Update the EN/ID label in the dropdown trigger button
        var langButtons = document.querySelectorAll('button');
        langButtons.forEach(function (btn) {
            // The trigger has a globe SVG and an EN/ID text node
            var hasGlobe = btn.querySelector('svg path[d^="M3.055"]');
            if (!hasGlobe) return;
            // Find its EN/ID text node
            var textNodes = Array.prototype.filter.call(btn.childNodes, function (n) {
                return n.nodeType === 3 && n.nodeValue.trim().match(/^(EN|ID)$/);
            });
            textNodes.forEach(function (tn) {
                tn.nodeValue = tn.nodeValue.replace(/(EN|ID)/, lang.toUpperCase());
            });
        });

        // Update the active-row highlight in the dropdown items
        var dropdownLinks = document.querySelectorAll('a');
        dropdownLinks.forEach(function (a) {
            var t = a.textContent.trim();
            if (t.indexOf('English (EN)') === 0) {
                if (lang === 'en') {
                    a.classList.add('bg-gray-50');
                    a.classList.remove('text-gray-600');
                    a.classList.add('text-gray-900');
                } else {
                    a.classList.remove('bg-gray-50');
                }
            }
            if (t.indexOf('Bahasa (ID)') === 0) {
                if (lang === 'id') {
                    a.classList.add('bg-gray-50');
                    a.classList.remove('text-gray-600');
                    a.classList.add('text-gray-900');
                } else {
                    a.classList.remove('bg-gray-50');
                }
            }
        });
    }

    function setupClickHandlers() {
        var links = document.querySelectorAll('a');
        links.forEach(function (a) {
            var t = a.textContent.trim();
            if (t.indexOf('English (EN)') === 0) {
                a.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (getLang() !== 'en') setLang('en');
                });
            } else if (t.indexOf('Bahasa (ID)') === 0) {
                a.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (getLang() !== 'id') setLang('id');
                });
            }
        });
    }

    function init() {
        var lang = getLang();
        if (lang === 'id') {
            translatePage();
        }
        updateSwitcherUI(lang);
        setupClickHandlers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-run translation after dynamic content (e.g., footer) is appended
    // The footer-loader fetches and appends a footer element after init
    var observer = new MutationObserver(function (mutations) {
        var hasNewNodes = mutations.some(function (m) {
            return m.addedNodes && m.addedNodes.length > 0;
        });
        if (hasNewNodes && getLang() === 'id') {
            translatePage();
            setupClickHandlers();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
