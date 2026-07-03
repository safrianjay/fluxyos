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


        // ── FAQ section (visible Q&As on feature pages) ─────────────────────
        "Frequently asked questions": "Pertanyaan yang sering ditanyakan",
        "Quick answers to what people usually ask before signing up.": "Jawaban singkat untuk pertanyaan yang sering muncul sebelum daftar.",

        // FAQ — Vendor Spend
        "What is vendor spend management?":
            "Apa itu vendor spend management?",
        "Vendor spend management is the process of tracking, approving, and paying every supplier and SaaS bill in one centralized system instead of email threads and spreadsheets. It lets finance teams catch duplicate payments, enforce approval limits, and maintain a clean audit trail of who paid whom.":
            "Vendor spend management adalah proses melacak, menyetujui, dan membayar setiap tagihan supplier dan SaaS dalam satu sistem terpusat — bukan di tumpukan email dan spreadsheet. Ini bantu tim keuangan menangkap pembayaran ganda, terapkan batas approval, dan jaga jejak audit siapa bayar siapa.",
        "How is FluxyOS Vendor Spend different from a regular accounting tool?":
            "Apa beda FluxyOS Vendor Spend dengan tools akuntansi biasa?",
        "Accounting tools like Xero, QuickBooks, and Jurnal record what already happened. FluxyOS Vendor Spend automates the work that produces those records — it captures invoices, routes them for approval, schedules payment, and posts the entry. You can use FluxyOS alongside your existing accounting tool; we push cleaned data into it.":
            "Tools akuntansi seperti Xero, QuickBooks, dan Jurnal mencatat apa yang sudah terjadi. FluxyOS Vendor Spend mengotomasi pekerjaan yang menghasilkan catatan itu — tangkap invoice, atur alur approval, jadwalkan pembayaran, dan posting ke ledger. Anda bisa pakai FluxyOS bersama tools akuntansi yang ada; kami push data yang sudah rapi ke sana.",
        "Does FluxyOS support Indonesian banks?":
            "Apakah FluxyOS mendukung bank Indonesia?",
        "Yes. FluxyOS connects to BCA, Mandiri, BNI, BRI, and 10+ other Indonesian banks for automated reconciliation. Multi-currency support handles USD, SGD, and 120+ other currencies if you also pay international vendors.":
            "Ya. FluxyOS terhubung ke BCA, Mandiri, BNI, BRI, dan 10+ bank Indonesia lain untuk rekonsiliasi otomatis. Dukungan multi-mata uang menangani USD, SGD, dan 120+ mata uang lain kalau Anda juga bayar vendor internasional.",
        "Can I set custom approval rules for vendor payments?":
            "Bisa atur aturan approval custom untuk pembayaran vendor?",
        "Yes. You can set rules by amount (e.g., anything over Rp 5M needs a director), by category (new vendors require procurement review), or by team (marketing budget is approved by the marketing lead). Approvers get a Slack notification and approve in one click.":
            "Bisa. Anda bisa atur aturan berdasarkan jumlah (misal di atas Rp 5 juta perlu direktur), kategori (vendor baru perlu review procurement), atau tim (budget marketing disetujui kepala marketing). Approver dapat notif Slack dan setujui dengan satu klik.",
        "How does FluxyOS catch duplicate vendor payments?":
            "Bagaimana FluxyOS menangkap pembayaran vendor ganda?",
        "Every incoming invoice is checked against your vendor history — same supplier, same amount, same period. FluxyOS flags it for review before any money moves, so duplicates never become surprise charges on next month's bank statement.":
            "Setiap invoice masuk dicek terhadap riwayat vendor Anda — supplier sama, jumlah sama, periode sama. FluxyOS flag untuk review sebelum uang keluar, jadi duplikat tidak pernah jadi tagihan kejutan di rekening koran bulan depan.",
        "What does it cost?": "Berapa biayanya?",
        "FluxyOS has a free tier for solo founders and small teams, with paid plans starting from Rp 490.000/month. See the pricing page for full breakdown.":
            "FluxyOS punya tier gratis untuk founder solo dan tim kecil, dengan paket berbayar mulai Rp 490.000/bulan. Lihat halaman harga untuk rincian lengkap.",

        // FAQ — AI Agents
        "What are FluxyOS AI Agents?": "Apa itu FluxyOS AI Agents?",
        "FluxyOS AI Agents are six specialized AI workers that automate the most time-consuming finance tasks — bank reconciliation, transaction categorization, invoice collection, anomaly detection, monthly report drafting, and tax-ready exports. They run 24/7 and ask before any money moves.":
            "FluxyOS AI Agents adalah enam pekerja AI khusus yang mengotomasi tugas keuangan paling memakan waktu — rekonsiliasi bank, kategorisasi transaksi, penagihan invoice, deteksi anomali, penyusunan laporan bulanan, dan ekspor siap pajak. Mereka jalan 24/7 dan tanya sebelum uang keluar.",
        "Do the AI agents replace my finance team?": "Apakah AI agent menggantikan tim keuangan saya?",
        "No — they hand off the routine work so your finance team can focus on judgment calls and strategy. Most teams need 4 minutes per day to review what the agents flagged. Hiring two more accountants would cost roughly Rp 480M/year; the agents do the same routine work without payroll.":
            "Tidak — mereka mengambil pekerjaan rutin supaya tim keuangan Anda bisa fokus ke keputusan dan strategi. Kebanyakan tim butuh 4 menit per hari untuk review hal yang di-flag agent. Tambah dua akuntan akan habis sekitar Rp 480 juta/tahun; agent kerjakan pekerjaan rutin yang sama tanpa gaji.",
        "How accurate is the AI?": "Seberapa akurat AI-nya?",
        "After one week of learning your chart of accounts, the AI achieves 99.2% transaction categorization accuracy. Anything below 90% confidence is automatically flagged for human review, so silent mistakes don't end up in your books.":
            "Setelah seminggu belajar chart of accounts Anda, AI mencapai akurasi kategorisasi transaksi 99,2%. Apapun di bawah 90% confidence otomatis di-flag untuk review manusia, supaya kesalahan diam-diam tidak masuk pembukuan Anda.",
        "Will it work with my Indonesian chart of accounts?": "Apakah jalan dengan chart of accounts Indonesia saya?",
        "Yes. The AI learns from your existing chart of accounts — including custom categories like 'Biaya Bahan Baku' or 'Operasional Outlet'. It adapts when you correct its tags, getting better over time.":
            "Ya. AI belajar dari chart of accounts yang sudah ada — termasuk kategori custom seperti 'Biaya Bahan Baku' atau 'Operasional Outlet'. Adaptif saat Anda koreksi tag-nya, makin baik seiring waktu.",
        "Is my financial data safe?": "Apakah data keuangan saya aman?",
        "FluxyOS uses bank-level encryption for all connections. Bank feed access is read-only, meaning the AI can see transactions but cannot move money without your explicit approval. All data is stored in compliance with Indonesian data protection requirements.":
            "FluxyOS pakai enkripsi tingkat bank untuk semua koneksi. Akses bank feed read-only — AI bisa lihat transaksi tapi tidak bisa pindah uang tanpa approval eksplisit Anda. Semua data disimpan sesuai aturan perlindungan data Indonesia.",
        "What languages does the AI support?": "AI mendukung bahasa apa saja?",
        "The AI works in both English and Bahasa Indonesia, including local vendor names and Indonesian business terms. Reports can be drafted in either language depending on your team's preference.":
            "AI jalan dalam Bahasa Indonesia dan English, termasuk nama vendor lokal dan istilah bisnis Indonesia. Laporan bisa disusun dalam bahasa mana saja sesuai preferensi tim Anda.",

        // FAQ — Receipt Capture
        "How does FluxyOS Receipt Capture work?": "Bagaimana cara kerja FluxyOS Receipt Capture?",
        "FluxyOS Receipt Capture is an AI-powered tool that reads any receipt — phone photos, PDF invoices, or e-receipts — and extracts the vendor name, amount, date, tax breakdown, and line items. The data lands in your FluxyOS dashboard automatically, ready for categorization.":
            "FluxyOS Receipt Capture adalah tools bertenaga AI yang membaca struk apa saja — foto HP, PDF invoice, atau e-struk — dan mengambil nama vendor, jumlah, tanggal, rincian pajak, dan item per item. Datanya otomatis masuk ke dashboard FluxyOS, siap dikategorikan.",
        "Can I send receipts via WhatsApp?": "Bisa kirim struk via WhatsApp?",
        "Yes. Send a photo of any receipt to FluxyOS AI on WhatsApp and the bot replies within 5 seconds with the extracted data. Tap to confirm the suggested category, and the receipt is filed in your dashboard. No app install needed — works on the WhatsApp account you already use.":
            "Bisa. Kirim foto struk ke FluxyOS AI di WhatsApp dan bot balas dalam 5 detik dengan data yang sudah diekstrak. Tap untuk konfirmasi kategori yang disarankan, struk masuk ke dashboard. Tidak perlu install app — jalan di akun WhatsApp yang Anda pakai sehari-hari.",
        "What file formats and sources are supported?": "Format file dan sumber apa saja yang didukung?",
        "FluxyOS accepts JPG/PNG photos from phone cameras, PDF invoices forwarded by email, e-receipts from online checkouts, and bulk uploads of up to 100 files at once. The AI reads handwritten receipts and printed thermal-paper struk equally well.":
            "FluxyOS terima foto JPG/PNG dari kamera HP, PDF invoice via email, e-struk dari checkout online, dan upload bulk sampai 100 file sekaligus. AI baca struk tulisan tangan dan struk thermal printer dengan baik.",
        "How accurate is the data extraction?": "Seberapa akurat ekstraksi datanya?",
        "Average extraction accuracy is 98.4% across vendor name, amount, and date. Individual fields are scored — anything below 90% confidence is flagged for a quick human review so silent mistakes never reach your books.":
            "Akurasi ekstraksi rata-rata 98,4% untuk nama vendor, jumlah, dan tanggal. Setiap kolom punya skor — apapun di bawah 90% confidence di-flag untuk review cepat supaya kesalahan diam-diam tidak masuk pembukuan.",
        "Does it handle Indonesian PPN tax correctly?": "Apakah menangani PPN Indonesia dengan benar?",
        "Yes. The AI extracts PPN 11% as a separate line item, distinguishes it from service charges and discounts, and includes it in your tax-ready exports. PPN summaries by month are available with one click for your accountant.":
            "Ya. AI ekstrak PPN 11% sebagai baris terpisah, bedakan dari service charge dan diskon, dan masukkan ke ekspor siap pajak Anda. Rangkuman PPN per bulan tersedia dengan satu klik untuk akuntan Anda.",
        "Will my receipts be saved for audits?": "Apakah struk saya disimpan untuk audit?",
        "Every receipt — photo, PDF, or e-receipt — is archived for 7 years and indexed by vendor, date, and amount. When auditors ask, you can pull any specific receipt in seconds.":
            "Setiap struk — foto, PDF, atau e-struk — diarsipkan 7 tahun dan diindeks berdasarkan vendor, tanggal, dan jumlah. Saat auditor tanya, Anda bisa tarik struk spesifik dalam hitungan detik.",

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

        // ── Homepage backfill (July 2026 redesign — hero, sections, FAQ) ────
        "FluxyOS — Finance Operations Visibility": "FluxyOS — Visibilitas Operasional Keuangan",
        "Run your entire finance": "Jalankan seluruh operasional",
        "operation": "keuangan Anda",
        "in one place": "di satu tempat",
        "Track revenue, control expenses, manage bills, and ask Fluxy AI what needs attention before month-end.": "Pantau pendapatan, kendalikan pengeluaran, kelola tagihan, dan tanya Fluxy AI apa yang perlu diperhatikan sebelum tutup bulan.",
        "FluxyOS is a finance operations platform for business owners, operators, and finance teams that need real-time visibility across revenue, expenses, budgets, and cash movement.": "FluxyOS adalah platform operasional keuangan untuk pemilik bisnis, operator, dan tim keuangan yang butuh visibilitas real-time atas pendapatan, pengeluaran, anggaran, dan pergerakan kas.",
        "FluxyOS brings sales, expenses, receipts, vendor payments, budgets, and payouts into one operating view so teams can compare money coming in with money going out.": "FluxyOS menyatukan penjualan, pengeluaran, struk, pembayaran vendor, anggaran, dan pencairan dalam satu tampilan kerja, jadi tim bisa membandingkan uang masuk dengan uang keluar.",
        "A quick overview of what FluxyOS is, who it helps, and how it fits into finance operations.": "Gambaran singkat tentang apa itu FluxyOS, siapa yang terbantu, dan bagaimana perannya dalam operasional keuangan.",
        "Revenue, expenses, and budgets in one working view": "Pendapatan, pengeluaran, dan anggaran dalam satu tampilan kerja",
        "See revenue, budgets, and operating expenses in one FluxyOS view before month-end reports arrive.": "Lihat pendapatan, anggaran, dan biaya operasional dalam satu tampilan FluxyOS sebelum laporan akhir bulan datang.",
        "See revenue, spending, and budgets together": "Lihat pendapatan, pengeluaran, dan anggaran sekaligus",
        "See revenue beside the costs that created it": "Lihat pendapatan berdampingan dengan biaya yang menghasilkannya",
        "Bring marketplace, payment, and POS revenue into the same view as fees, refunds, and operating spend.": "Satukan pendapatan marketplace, payment, dan POS dalam tampilan yang sama dengan biaya, refund, dan pengeluaran operasional.",
        "Track collected revenue, pending receivables, and monthly performance without jumping between sheets.": "Pantau pendapatan yang sudah masuk, piutang tertunda, dan performa bulanan tanpa pindah-pindah sheet.",
        "See where cash is going across vendors, subscriptions, fees, taxes, and operating expenses.": "Lihat ke mana kas mengalir — vendor, langganan, biaya, pajak, dan pengeluaran operasional.",
        "Track money movement across channels, vendors, teams, and business units without rebuilding spreadsheets.": "Pantau pergerakan uang lintas kanal, vendor, tim, dan unit bisnis tanpa menyusun ulang spreadsheet.",
        "Track SaaS, contractors, suppliers, and renewals in one place so duplicate or forgotten spend is easier to catch.": "Pantau SaaS, kontraktor, supplier, dan perpanjangan di satu tempat, jadi pengeluaran ganda atau terlupa lebih mudah ketahuan.",
        "Track budget movement before it becomes a problem": "Pantau pergerakan anggaran sebelum jadi masalah",
        "Compare planned budgets against live spend for teams, projects, vendors, and operating categories.": "Bandingkan anggaran rencana dengan pengeluaran live untuk tim, proyek, vendor, dan kategori operasional.",
        "Compare actual and committed spend against your operating budget before costs get out of control.": "Bandingkan pengeluaran aktual dan terikat dengan anggaran operasional Anda sebelum biaya lepas kendali.",
        "Set alerts when a team, project, or vendor spend line is moving off plan.": "Pasang peringatan saat pengeluaran tim, proyek, atau vendor mulai keluar jalur.",
        "Alert managers when project burn rates start moving off plan.": "Beri tahu manajer saat burn rate proyek mulai keluar jalur.",
        "Stop chasing receipts after the money has moved": "Berhenti mengejar struk setelah uangnya berpindah",
        "Classify expenses as they arrive, not after the month closes.": "Kelompokkan pengeluaran begitu datang, bukan setelah tutup bulan.",
        "Keep receipts, line items, and payment status attached to the transaction record.": "Simpan struk, rincian item, dan status pembayaran menempel pada catatan transaksinya.",
        "Remind teams to upload missing receipts before close.": "Ingatkan tim mengunggah struk yang hilang sebelum tutup buku.",
        "Know where the money moved today.": "Tahu ke mana uang bergerak hari ini.",
        "Ask what changed, what needs attention, and which records may affect your month-end numbers.": "Tanyakan apa yang berubah, apa yang perlu diperhatikan, dan catatan mana yang bisa memengaruhi angka akhir bulan Anda.",
        "Ask Fluxy AI on WhatsApp about current expenses, remaining budgets, or transaction status.": "Tanya Fluxy AI lewat WhatsApp soal pengeluaran berjalan, sisa anggaran, atau status transaksi.",
        "Search transaction records, receipts, and categories from one place.": "Cari catatan transaksi, struk, dan kategori dari satu tempat.",
        "AI supports the workflow by helping classify expenses, flag missing receipts, surface reconciliation gaps, and answer finance questions. The business problem stays the focus: understanding money movement earlier.": "AI mendukung alur kerja dengan membantu mengelompokkan pengeluaran, menandai struk yang hilang, memunculkan celah rekonsiliasi, dan menjawab pertanyaan keuangan. Fokusnya tetap masalah bisnis: memahami pergerakan uang lebih awal.",
        "FluxyOS helps classify expenses, spot missing categories, and surface budget issues so your team can review the exceptions instead of rebuilding reports.": "FluxyOS membantu mengelompokkan pengeluaran, menemukan kategori yang hilang, dan memunculkan masalah anggaran, jadi tim Anda cukup meninjau pengecualian, bukan menyusun ulang laporan.",
        "FluxyOS helps teams see revenue, expenses, budget usage, and reconciliation gaps across business units, client accounts, and operating locations.": "FluxyOS membantu tim melihat pendapatan, pengeluaran, pemakaian anggaran, dan celah rekonsiliasi lintas unit bisnis, akun klien, dan lokasi operasional.",
        "FluxyOS flags the work": "FluxyOS yang menandai pekerjaannya",
        "your team should review.": "yang perlu ditinjau tim Anda.",
        "Sync reviewed transactions into your accounting workflow without copy-paste.": "Sinkronkan transaksi yang sudah ditinjau ke alur akuntansi Anda tanpa copy-paste.",
        "Move finance operations data where your team needs it": "Pindahkan data operasional keuangan ke tempat tim Anda membutuhkannya",
        "Keep FluxyOS as your modern operation layer while pushing clean, categorized journal entries directly to legacy ERPs.": "Jadikan FluxyOS lapisan operasional modern Anda sambil mengirim entri jurnal yang rapi dan terkategori langsung ke ERP lama.",
        "Use FluxyOS APIs and webhooks to send clean budget, transaction, and vendor data into internal tools.": "Gunakan API dan webhook FluxyOS untuk mengirim data anggaran, transaksi, dan vendor yang rapi ke tools internal.",
        "Subscribe to webhooks to trigger actions in your own apps the moment a transaction clears or a budget is exceeded.": "Berlangganan webhook untuk memicu aksi di aplikasi Anda begitu transaksi selesai atau anggaran terlampaui.",
        "Generate scoped API keys for different departments. Control exactly what financial data can be read or written via the API.": "Buat API key terpisah per departemen. Kendalikan persis data keuangan mana yang bisa dibaca atau ditulis lewat API.",
        "Give your external marketing agencies scoped access to upload invoices or view remaining monthly ad budgets securely.": "Beri agensi marketing eksternal akses terbatas untuk mengunggah invoice atau melihat sisa anggaran iklan bulanan dengan aman.",
        "Issue single-use or vendor-specific virtual cards to employees. Cap spending limits per vendor and kill subscriptions with one click.": "Terbitkan kartu virtual sekali pakai atau khusus vendor untuk karyawan. Batasi limit per vendor dan hentikan langganan dengan satu klik.",
        "Never get caught off guard by auto-renewals. Get notified well before large SaaS contracts lock in.": "Jangan kaget lagi karena perpanjangan otomatis. Dapatkan notifikasi jauh sebelum kontrak SaaS besar terkunci.",
        "Automatically flag duplicate charges or orphaned SaaS accounts from former employees.": "Tandai otomatis tagihan ganda atau akun SaaS yatim milik mantan karyawan.",
        "Consolidate SaaS subscriptions, web hosting, and external contractor payouts into a unified dashboard. Instantly detect duplicate charges.": "Satukan langganan SaaS, hosting, dan pembayaran kontraktor eksternal dalam satu dashboard. Deteksi tagihan ganda seketika.",
        "Automatically match bulk payouts from gateways to the individual sales receipts in your ledger.": "Cocokkan otomatis pencairan massal dari gateway dengan struk penjualan satuan di buku Anda.",
        "See exactly which sales channels (Shopify, Amazon, Retail) are driving the most revenue vs the associated cost of goods.": "Lihat persis kanal penjualan mana (Shopify, Amazon, Ritel) yang paling mendorong pendapatan dibanding harga pokoknya.",
        "Bring ad spend and finalized revenue together to see the true profitability of your marketing dollars.": "Satukan biaya iklan dan pendapatan final untuk melihat profitabilitas sebenarnya dari dana marketing Anda.",
        "Match ad spend to budget and revenue": "Cocokkan biaya iklan dengan anggaran dan pendapatan",
        "Pull ad deductions and invoices into FluxyOS so marketing spend can be reviewed against budget and sales.": "Tarik potongan iklan dan invoice ke FluxyOS supaya biaya marketing bisa ditinjau terhadap anggaran dan penjualan.",
        "FluxyOS connects to ad platforms to pull invoice PDFs automatically and matches them to bank feeds.": "FluxyOS terhubung ke platform iklan untuk menarik PDF invoice otomatis dan mencocokkannya dengan mutasi bank.",
        "FluxyOS maps expenses and ad spend to the right budget center for review.": "FluxyOS memetakan pengeluaran dan biaya iklan ke pusat anggaran yang tepat untuk ditinjau.",
        "Global operations made simple. View all incoming international revenue consolidated into your base currency.": "Operasi global jadi sederhana. Lihat semua pendapatan internasional terkonsolidasi dalam mata uang dasar Anda.",
        "Tap into a unified global financial network": "Manfaatkan jaringan keuangan global yang terpadu",
        "FluxyOS's proprietary data mapping network offers you a faster, more cost-effective, and transparent alternative to manual financial reporting. Operate like a localized business from anywhere—sync budgets with multi-currency accounts, accept international vendor invoices without costly conversion miscalculations, hold ledger records across borders, and make high-speed budget adjustments around the world in a few clicks.": "Jaringan pemetaan data milik FluxyOS menawarkan alternatif yang lebih cepat, hemat, dan transparan dibanding pelaporan keuangan manual. Beroperasilah seperti bisnis lokal dari mana saja — sinkronkan anggaran dengan akun multi-mata-uang, terima invoice vendor internasional tanpa salah hitung konversi yang mahal, simpan catatan buku besar lintas negara, dan sesuaikan anggaran secepat kilat di seluruh dunia dalam beberapa klik.",
        "software integrations with global accounting and ad platforms": "integrasi software dengan platform akuntansi dan iklan global",
        // Homepage FAQ
        "What is FluxyOS?": "Apa itu FluxyOS?",
        "Who is FluxyOS built for?": "FluxyOS dibuat untuk siapa?",
        "FluxyOS is built for Indonesian businesses today, including owners, founders, operators, CFOs, finance managers, and teams managing multiple channels, vendors, projects, or entities.": "FluxyOS dibuat untuk bisnis Indonesia, termasuk pemilik, founder, operator, CFO, manajer keuangan, dan tim yang mengelola banyak kanal, vendor, proyek, atau entitas.",
        "What does FluxyOS help teams see?": "Apa yang bisa dilihat tim lewat FluxyOS?",
        "How does FluxyOS use AI?": "Bagaimana FluxyOS memakai AI?",
        "Does FluxyOS only work for one industry?": "Apakah FluxyOS hanya untuk satu industri?",
        "No. FluxyOS is industry-agnostic. It can support e-commerce, retail, F&B, agencies, services, multi-location operators, and other teams that need clearer finance operations visibility.": "Tidak. FluxyOS lintas industri — mendukung e-commerce, ritel, F&B, agensi, jasa, operator multi-lokasi, dan tim lain yang butuh visibilitas operasional keuangan yang lebih jelas.",
        "Is FluxyOS focused on Indonesia?": "Apakah FluxyOS fokus ke Indonesia?",
        "Yes. FluxyOS is built around Indonesian business realities today, including IDR reporting and local operating workflows, while the platform is designed to support broader APAC needs over time.": "Ya. FluxyOS dibangun berdasarkan realitas bisnis Indonesia, termasuk pelaporan IDR dan alur kerja lokal, sambil dirancang untuk mendukung kebutuhan APAC yang lebih luas ke depannya.",
        "FluxyOS questions, answered": "Pertanyaan tentang FluxyOS, terjawab",
        // Homepage product-mock labels & badges
        "FluxyOS dashboard product highlight showing finance operations overview": "Sorotan produk dashboard FluxyOS yang menampilkan ringkasan operasional keuangan",
        "Open navigation menu": "Buka menu navigasi",
        "Live Income (Today)": "Pemasukan Live (Hari Ini)",
        "Total Ad Spend (7d)": "Total Biaya Iklan (7 hari)",
        "Total: Rp 75.000": "Total: Rp 75.000",
        "Matched to:": "Dicocokkan ke:",
        "Reconciled to Bank": "Terekonsiliasi ke Bank",
        "Reviewed for sync": "Ditinjau untuk sinkronisasi",
        "On Track": "Sesuai Rencana",
        "In 14 days": "Dalam 14 hari",
        "In 21 days": "Dalam 21 hari",
        "From TikTok Ads Platform": "Dari Platform TikTok Ads",
        "Orders synced from Tokopedia": "Pesanan tersinkron dari Tokopedia",
        "Please upload a receipt for your purchase (Transaction": "Mohon unggah struk untuk pembelian Anda (Transaksi",
        "from 'TIKTOK ADS' detected without matching PDF receipt.": "dari 'TIKTOK ADS' terdeteksi tanpa struk PDF yang cocok.",
        "You've spent": "Anda sudah membelanjakan",
        "on TikTok Ads this week.": "di TikTok Ads minggu ini.",
        "What were our marketing expenses this week?": "Berapa pengeluaran marketing kita minggu ini?",
        "Finance command center": "Pusat komando keuangan",
        "Budget awareness": "Anggaran selalu terpantau",
        "Revenue clarity": "Pendapatan jadi jelas",
        "Spending control": "Kendali pengeluaran",
        "Budget guardrails": "Pagar pengaman anggaran",
        "Reconciliation checks": "Pemeriksaan rekonsiliasi",
        "Connect money movement": "Hubungkan pergerakan uang",
        "Keep accounting exports cleaner": "Ekspor akuntansi lebih rapi",
        "Keep vendor payments readable": "Pembayaran vendor tetap terbaca jelas",
        "Real-time business economics visibility.": "Visibilitas ekonomi bisnis secara real-time.",
        "Budget Allocation": "Alokasi Anggaran",
        "Budget Center": "Pusat Anggaran",
        "Budget Control": "Kendali Anggaran",
        "Budget Remaining": "Sisa Anggaran",
        "Remaining Budget": "Sisa Anggaran",
        "Remaining Q3 Budget:": "Sisa Anggaran Q3:",
        "Budget Status": "Status Anggaran",
        "Budget deduction": "Potongan anggaran",
        "Burn Rate Alert": "Peringatan Burn Rate",
        "Campaign ROI Mapping": "Pemetaan ROI Kampanye",
        "Channel Profitability": "Profitabilitas Kanal",
        "Auto-Categorization": "Kategorisasi Otomatis",
        "Auto-Matched": "Tercocokkan Otomatis",
        "Automated Fetching": "Pengambilan Otomatis",
        "Duplicate Detected": "Duplikat Terdeteksi",
        "Missing receipt": "Struk hilang",
        "Missing Invoice Alert": "Peringatan Invoice Hilang",
        "Missing GL Codes": "Kode GL Hilang",
        "Expected Payout": "Perkiraan Pencairan",
        "Payout Reconciliation": "Rekonsiliasi Pencairan",
        "Payment scheduled": "Pembayaran terjadwal",
        "Payroll Run": "Proses Gaji",
        "Upcoming Renewals": "Perpanjangan Mendatang",
        "Renewal Intelligence": "Deteksi Perpanjangan",
        "Uncategorized Spend": "Pengeluaran Tanpa Kategori",
        "Recent Vendors": "Vendor Terbaru",
        "Marketing Expense": "Biaya Marketing",
        "Marketing Team Card": "Kartu Tim Marketing",
        "Hosting Fees": "Biaya Hosting",
        "Hosting Provider": "Penyedia Hosting",
        "Server Costs": "Biaya Server",
        "Software Subs.": "Langganan Software",
        "Platform Fees": "Biaya Platform",
        "Raw Materials": "Bahan Baku",
        "Bank charge": "Biaya bank",
        "Gateway Volume": "Volume Gateway",
        "Manual Sync Delayed": "Sinkronisasi Manual Tertunda",
        "Resolving Errors...": "Menyelesaikan Kesalahan...",
        "Identify Waste": "Temukan Pemborosan",
        "True ROI Tracking": "Lacak ROI Sebenarnya",
        "Virtual Cards & Controls": "Kartu Virtual & Kontrol",
        "Granular Permissions": "Izin Terperinci",
        "Agency Access": "Akses Agensi",
        "Invite Agency Seat": "Undang Kursi Agensi",
        "ERP Synchronization": "Sinkronisasi ERP",
        "Multi-Currency Sync": "Sinkronisasi Multi-Mata-Uang",
        "Live FX Conversion": "Konversi Valas Live",
        "Real-time Webhooks": "Webhook Real-time",
        "Event-Driven Finance": "Keuangan Berbasis Peristiwa",
        "Platform APIs": "API Platform",
        "Enterprise Ready": "Siap Enterprise",
        "Ad Integrations": "Integrasi Iklan",
        "Expense Source": "Sumber Pengeluaran",
        "Digital Storefront": "Etalase Digital",
        "Digital Marketing": "Marketing Digital",
        "Manufacturing Unit": "Unit Manufaktur",
        "Consulting Arm": "Lini Konsultasi",
        "R&D Department": "Departemen R&D",
        "Claim details": "Detail klaim",
        "Fluxy AI insight": "Wawasan Fluxy AI",
        "across every business unit.": "di semua unit bisnis.",
        "Attributed Rev": "Pendapatan Teratribusi",
        "Ad Spend (TikTok)": "Biaya Iklan (TikTok)",
        "85% Used": "85% Terpakai",

        // ── Pricing page backfill ────────────────────────────────────────────
        "FluxyOS Pricing — Plans for Indonesian Businesses": "Harga FluxyOS — Paket untuk Bisnis Indonesia",
        "Choose Starter": "Pilih Starter",
        "Choose Core Ops": "Pilih Core Ops",
        "Choose Growth Engine": "Pilih Growth Engine",
        "Everything in Starter, plus:": "Semua di Starter, plus:",
        "Everything in Core Ops, plus:": "Semua di Core Ops, plus:",
        "For founders, freelancers, and small teams running finance in one place.": "Untuk founder, freelancer, dan tim kecil yang mengelola keuangan di satu tempat.",
        "For growing operational teams with dedicated finance and admin.": "Untuk tim operasional berkembang dengan staf keuangan dan admin khusus.",
        "For scaling companies that need forecasting and AI financial analysis.": "Untuk perusahaan yang sedang scale-up dan butuh proyeksi serta analisis keuangan AI.",
        "Built for unlimited scale.": "Dibangun untuk skala tanpa batas.",
        "Unlimited AI and processing with SSO, dedicated support, and custom limits.": "AI dan pemrosesan tanpa batas dengan SSO, dukungan khusus, dan limit kustom.",
        "Scale from a single marketplace connection to a full enterprise financial nervous system. Leverage predictive AI modeling with zero hidden API fees.": "Berkembang dari satu koneksi marketplace sampai sistem saraf keuangan enterprise penuh. Manfaatkan pemodelan AI prediktif tanpa biaya API tersembunyi.",
        "Save up to 20%": "Hemat hingga 20%",
        "Starting from Rp15.000.000": "Mulai dari Rp15.000.000",
        "Trusted by finance teams across Southeast Asia": "Dipercaya tim keuangan di seluruh Asia Tenggara",
        "from 126 reviews": "dari 126 ulasan",
        "with approval workflow": "dengan alur persetujuan",
        "Scale stores by tracking live ad ROI against costs.": "Kembangkan toko dengan melacak ROI iklan live terhadap biaya.",
        "See how a fashion label unified retail and e-commerce to track unit economics.": "Lihat bagaimana brand fashion menyatukan ritel dan e-commerce untuk memantau unit economics.",
        "Track live unit economics and manufacturer costs.": "Pantau unit economics live dan biaya manufaktur.",
        "Compare outlet P&L and settlement.": "Bandingkan P&L dan settlement antar-outlet.",
        "Spot ad waste and product margin.": "Temukan pemborosan iklan dan margin produk.",
        "Monthly": "Bulanan",
        "Annually": "Tahunan",
        "Most Popular": "Paling Populer",
        "Custom Pricing": "Harga Khusus",
        "1 user": "1 pengguna",
        "Multi-user": "Multi-pengguna",
        "Basic reporting": "Laporan dasar",
        "Advanced reports": "Laporan lanjutan",
        "& forecasting": "& proyeksi",
        "& gateway integrations": "& integrasi gateway",
        "& processing": "& pemrosesan",
        "API access": "Akses API",
        "AI Finance Analyst": "Analis Keuangan AI",
        "AI-driven financial ops.": "Operasional keuangan berbasis AI.",
        "Unlimited AI usage": "Pemakaian AI tanpa batas",
        "Limited AI usage & document processing": "Pemakaian AI & pemrosesan dokumen terbatas",
        "Higher AI usage & document processing limits": "Limit pemakaian AI & pemrosesan dokumen lebih tinggi",
        "Custom integrations & limits": "Integrasi & limit kustom",
        "Dedicated onboarding & priority support": "Onboarding khusus & dukungan prioritas",
        "Department budgeting & advanced insights": "Anggaran per departemen & wawasan lanjutan",
        "SSO & WhatsApp AI Assistant": "SSO & Asisten AI WhatsApp",
        "Transactions, Bills & Budgeting": "Transaksi, Tagihan & Anggaran",
        "Track spend against allocated budgets.": "Pantau pengeluaran terhadap anggaran yang dialokasikan.",
        "Real-time visibility into overall economics.": "Visibilitas real-time atas ekonomi bisnis menyeluruh.",

        // ── Vendor Spend page backfill ───────────────────────────────────────
        "Vendor Spend Management for Indonesian SMBs | FluxyOS": "Manajemen Vendor Spend untuk UKM Indonesia | FluxyOS",
        "A spreadsheet that's always out of date": "Spreadsheet yang selalu ketinggalan",
        "\"Vendors_Master_v7_FINAL_FINAL.xlsx\" — updated by hand, never matches reality.": "\"Vendors_Master_v7_FINAL_FINAL.xlsx\" — diperbarui manual, tidak pernah cocok dengan kenyataan.",
        "Invoices in three inboxes": "Invoice tercecer di tiga inbox",
        "Sales emails, founders' personal accounts, and that one shared mailbox nobody checks.": "Email sales, akun pribadi founder, dan satu mailbox bersama yang tidak pernah dicek.",
        "\"Hey, can you approve this?\" — no record, no audit trail, no sense of urgency.": "\"Eh, bisa approve ini?\" — tanpa catatan, tanpa jejak audit, tanpa rasa mendesak.",
        "Paid twice. Discovered next quarter.": "Terbayar dua kali. Baru ketahuan kuartal depan.",
        "Someone forwards an invoice that ops already paid. By the time it surfaces, the money's gone.": "Seseorang meneruskan invoice yang sudah dibayar tim ops. Saat ketahuan, uangnya sudah pergi.",
        "Audits take a week": "Audit makan waktu seminggu",
        "Hunting through Drive folders and bank statements to reconstruct who paid whom.": "Mengubek folder Drive dan rekening koran untuk merekonstruksi siapa membayar siapa.",
        "Every invoice, one inbox": "Semua invoice, satu inbox",
        "Forward to billing@yourco.fluxyos.com or upload in bulk. Vendor and amount auto-extracted.": "Teruskan ke billing@perusahaanmu.fluxyos.com atau unggah massal. Vendor dan jumlah terekstrak otomatis.",
        "Live vendor list, always current": "Daftar vendor live, selalu terkini",
        "No more spreadsheets. Filter by category, status, or renewal date in one click.": "Tanpa spreadsheet lagi. Filter per kategori, status, atau tanggal perpanjangan dalam satu klik.",
        "Approval rules, set once": "Aturan persetujuan, cukup diatur sekali",
        "Above Rp 5M? Director signs off. New vendor? Procurement reviews. Logged automatically.": "Di atas Rp 5M? Direktur yang tanda tangan. Vendor baru? Procurement meninjau. Tercatat otomatis.",
        "Duplicate caught, before payment": "Duplikat tertangkap, sebelum dibayar",
        "Same invoice, same amount, same vendor — flagged at intake, not three months later.": "Invoice sama, jumlah sama, vendor sama — ditandai sejak masuk, bukan tiga bulan kemudian.",
        "Audit trail in two clicks": "Jejak audit dalam dua klik",
        "Every approval, payment, and document — exported as CSV or shared with auditors directly.": "Setiap persetujuan, pembayaran, dan dokumen — diekspor sebagai CSV atau dibagikan langsung ke auditor.",
        "Slack invoice already processed last week": "Invoice Slack sudah diproses minggu lalu",
        "We used to lose half a day every Friday reconciling vendor invoices against our bank feed. Now it's done by lunch on Monday — and we actually know what we owe.": "Dulu kami kehilangan setengah hari tiap Jumat untuk mencocokkan invoice vendor dengan mutasi bank. Sekarang selesai sebelum makan siang hari Senin — dan kami benar-benar tahu utang kami.",
        "We caught Rp 47M in duplicate SaaS subscriptions in our first month. Two teams paying for the same project tool — nobody knew. That alone paid for the year.": "Kami menemukan Rp 47M langganan SaaS ganda di bulan pertama. Dua tim membayar tool proyek yang sama — tidak ada yang tahu. Itu saja sudah menutup biaya setahun.",
        "Our auditor asked for vendor payment history last quarter. Used to take a week of digging. Took me about ten minutes — exported the whole thing as CSV and we were done.": "Auditor kami minta riwayat pembayaran vendor kuartal lalu. Biasanya seminggu menggali. Kemarin cuma sepuluh menit — ekspor semuanya sebagai CSV, selesai.",
        "Head of Finance, Tanaman Coffee Co.": "Head of Finance, Tanaman Coffee Co.",
        "+ 23 more vendors": "+ 23 vendor lainnya",
        "Plus 240+ more — local agencies, contractors, one-offs": "Plus 240+ lainnya — agensi lokal, kontraktor, pembayaran sekali jalan",
        "8 vendors • Auto-paid Friday": "8 vendor • Terbayar otomatis Jumat",
        "Scheduled this week": "Terjadwal minggu ini",
        "Total tracked across 16 vendors": "Total terpantau dari 16 vendor",
        "Total:": "Total:",
        "View all →": "Lihat semua →",
        "per month": "per bulan",
        "monthly run rate": "laju bulanan",
        "4.2 days": "4,2 hari",
        "Approvals over WhatsApp": "Persetujuan lewat WhatsApp",
        "Duplicate detected": "Duplikat terdeteksi",
        "From: billing@figma.com": "Dari: billing@figma.com",

        // ── Revenue Sync page backfill ───────────────────────────────────────
        "Revenue Sync — Connect Stripe, Tokopedia, Shopify | FluxyOS": "Revenue Sync — Hubungkan Stripe, Tokopedia, Shopify | FluxyOS",
        "What is Revenue Sync?": "Apa itu Revenue Sync?",
        "Revenue Sync is a FluxyOS feature that connects sales channels, payment processors, POS systems, and marketplaces into one live ledger. It gives Indonesian businesses a real-time view of revenue without waiting for manual CSV exports or end-of-month reconciliation.": "Revenue Sync adalah fitur FluxyOS yang menghubungkan kanal penjualan, pemroses pembayaran, sistem POS, dan marketplace ke satu buku besar live. Bisnis Indonesia bisa melihat pendapatan real-time tanpa menunggu ekspor CSV manual atau rekonsiliasi akhir bulan.",
        "Which platforms does Revenue Sync connect to?": "Platform apa saja yang terhubung dengan Revenue Sync?",
        "Revenue Sync connects to Stripe, Shopify, Tokopedia, TikTok Shop, Alibaba, Moka, Xendit, Midtrans, WooCommerce, and 240+ other payment, marketplace, and POS platforms. The goal is to consolidate every revenue stream your business depends on.": "Revenue Sync terhubung ke Stripe, Shopify, Tokopedia, TikTok Shop, Alibaba, Moka, Xendit, Midtrans, WooCommerce, dan 240+ platform pembayaran, marketplace, dan POS lainnya. Tujuannya menyatukan setiap aliran pendapatan yang diandalkan bisnis Anda.",
        "How fast do transactions appear in FluxyOS?": "Seberapa cepat transaksi muncul di FluxyOS?",
        "Most connected transactions appear in FluxyOS in under 30 seconds after the source platform makes them available. This helps finance teams spot channel performance, refunds, fees, and revenue gaps while the day is still in motion.": "Sebagian besar transaksi muncul di FluxyOS dalam waktu kurang dari 30 detik setelah tersedia di platform sumber. Tim keuangan bisa memantau performa kanal, refund, biaya, dan selisih pendapatan selagi hari masih berjalan.",
        "Does Revenue Sync handle refunds and duplicate transactions?": "Apakah Revenue Sync menangani refund dan transaksi ganda?",
        "Yes. Revenue Sync is designed to detect duplicate imports, flag refunds, and keep settlement records tied to their original sales channel. That reduces double counting and gives teams a cleaner revenue ledger.": "Ya. Revenue Sync dirancang untuk mendeteksi impor ganda, menandai refund, dan menjaga catatan settlement tetap terhubung ke kanal penjualan asalnya. Hitungan ganda berkurang dan buku pendapatan lebih bersih.",
        "Can Revenue Sync support Indonesian teams using IDR?": "Apakah Revenue Sync mendukung tim Indonesia yang memakai IDR?",
        "Yes. Revenue Sync supports Indonesian Rupiah reporting and multi-currency reconciliation for businesses selling across local and international platforms. Finance teams can review revenue in one operating view while preserving source-platform detail.": "Ya. Revenue Sync mendukung pelaporan Rupiah dan rekonsiliasi multi-mata-uang untuk bisnis yang berjualan di platform lokal maupun internasional. Tim keuangan meninjau pendapatan dalam satu tampilan tanpa kehilangan detail platform sumber.",
        "Is Revenue Sync useful for small businesses?": "Apakah Revenue Sync berguna untuk bisnis kecil?",
        "Yes. Revenue Sync is useful for small businesses that sell across more than one channel because it removes manual reconciliation work and makes cash flow easier to trust. Even a simple Shopify plus marketplace setup can become difficult to track in spreadsheets.": "Ya. Revenue Sync berguna untuk bisnis kecil yang berjualan di lebih dari satu kanal karena menghapus pekerjaan rekonsiliasi manual dan membuat arus kas lebih bisa dipercaya. Setup sederhana Shopify plus marketplace saja sudah sulit dilacak di spreadsheet.",
        "Revenue Sync questions, answered": "Pertanyaan tentang Revenue Sync, terjawab",
        "Unified in real-time": "Menyatu secara real-time",
        "Total synced this month": "Total tersinkron bulan ini",
        "+ 247 More": "+ 247 Lainnya",
        "More": "Lainnya",
        "✓ All categories reconciled": "✓ Semua kategori terekonsiliasi",
        "12 channels detected": "12 kanal terdeteksi",
        "240+ integrations": "240+ integrasi",
        "Duplicates removed": "Duplikat dihapus",
        "Processing time": "Waktu pemrosesan",
        "Updated 2s ago": "Diperbarui 2 detik lalu",
        "Rp 247.5M syncing right now": "Rp 247.5M sedang tersinkron",

        // ── Receipt Capture page backfill ────────────────────────────────────
        "AI Receipt Capture via WhatsApp, Email, or Upload | FluxyOS": "Receipt Capture AI via WhatsApp, Email, atau Upload | FluxyOS",
        "Got it! 📥 Here's what I found:": "Sip! 📥 Ini yang saya temukan:",
        "Looks like an office supply restock 📦 — confirm or change the category:": "Sepertinya belanja perlengkapan kantor 📦 — konfirmasi atau ganti kategorinya:",
        "Done ✅ Filed under": "Beres ✅ Tersimpan di",
        "Filed in 4.2 sec": "Tersimpan dalam 4,2 detik",
        "Confirm Operations": "Konfirmasi Operasional",
        "Confirm Operations 👍": "Konfirmasi Operasional 👍",
        "online • typically replies in seconds": "online • biasanya membalas dalam hitungan detik",
        "Spend by category": "Pengeluaran per kategori",
        "Total this month": "Total bulan ini",
        "Tax-ready export": "Ekspor siap pajak",
        "— every photo and PDF stored, searchable for 7 years.": "— setiap foto dan PDF tersimpan, bisa dicari selama 7 tahun.",
        "— formatted for Indonesian PPN reporting and ready for your accountant.": "— terformat untuk pelaporan PPN Indonesia dan siap untuk akuntan Anda.",
        "— push to Xero, QuickBooks, or your existing ledger. No more copy-paste.": "— kirim ke Xero, QuickBooks, atau buku besar Anda. Tanpa copy-paste lagi.",
        "— see spend by category, vendor, or team in one chart.": "— lihat pengeluaran per kategori, vendor, atau tim dalam satu grafik.",
        "📊 View in your dashboard →": "📊 Lihat di dashboard Anda →",
        "— Thank you —": "— Terima kasih —",
        "A4 Paper (5 reams)": "Kertas A4 (5 rim)",
        "A4 Paper x5": "Kertas A4 x5",
        "Sticky Notes Set": "Set Sticky Notes",
        "Amount": "Jumlah",
        "Date": "Tanggal",
        "Category": "Kategori",
        "Subtotal": "Subtotal",
        "Suggested": "Disarankan",
        "Office Supplies": "Perlengkapan Kantor",
        "Team Meals": "Makan Tim",
        "Travel": "Perjalanan",
        "Equipment": "Peralatan",
        "Other": "Lainnya",
        "Monthly summaries": "Ringkasan bulanan",
        "Original receipts archived": "Struk asli terarsip",
        "Tax-ready CSV exports": "Ekspor CSV siap pajak",
        "Direct sync": "Sinkronisasi langsung",
        "Snap → AI reads → Filed": "Foto → AI membaca → Tersimpan",
        "128 receipts processed": "128 struk diproses",
        "98.4% avg accuracy": "Akurasi rata-rata 98,4%",
        "✓ 99% match": "✓ 99% cocok",

        // ── AI Agents page backfill ──────────────────────────────────────────
        "AI Finance Agents — 6 Specialists for Your Books | FluxyOS": "AI Finance Agents — 6 Spesialis untuk Pembukuan Anda | FluxyOS",
        "247 lines matched — 3 mismatches queued for your review": "247 baris cocok — 3 selisih menunggu tinjauan Anda",
        "247 of 250 matched": "247 dari 250 cocok",
        "3 polite nudges out the door — Sembrani Group, Pelangi Studio, Cikal Apparel": "3 pengingat sopan sudah terkirim — Sembrani Group, Pelangi Studio, Cikal Apparel",
        "5 receipts came in via WhatsApp — filed under Client Meetings": "5 struk masuk via WhatsApp — tersimpan di Meeting Klien",
        "68 entries from BCA, Mandiri, Stripe — auto-tagged in 4 minutes": "68 entri dari BCA, Mandiri, Stripe — tertandai otomatis dalam 4 menit",
        "68 invoices, 23 receipts, 14 bank statements — saved for 7 years if your accountant asks": "68 invoice, 23 struk, 14 rekening koran — tersimpan 7 tahun kalau akuntan Anda bertanya",
        "Cash on hand, top 5 suppliers paid, where money went — ready in your inbox": "Kas di tangan, 5 supplier teratas yang dibayar, ke mana uang pergi — siap di inbox Anda",
        "Cost of Sales → Inventory & Supplies": "Harga Pokok Penjualan → Persediaan & Perlengkapan",
        "Done.": "Beres.",
        "For Indra Catering · 17 days overdue": "Untuk Indra Catering · lewat 17 hari",
        "Indra Catering — 17 days overdue, Rp 24M. Wrote a firmer follow-up for you to review": "Indra Catering — lewat 17 hari, Rp 24M. Follow-up yang lebih tegas sudah disiapkan untuk Anda tinjau",
        "It's your usual supplier —": "Ini supplier langganan Anda —",
        "a possible duplicate payment": "kemungkinan pembayaran ganda",
        "Same supplier billed twice this week — sent you a quick note to confirm": "Supplier yang sama menagih dua kali minggu ini — sudah dikirimkan catatan singkat untuk Anda konfirmasi",
        "That's 4 working days you spend on running your business instead of manual finance admin.": "Itu 4 hari kerja yang bisa Anda pakai menjalankan bisnis, bukan admin keuangan manual.",
        "Hiring two more accountants would have cost us Rp 480M a year. The agents do the same work, and they don't quit when payroll runs late. Honestly, our finance team is finally getting home before 8pm.": "Merekrut dua akuntan lagi akan menghabiskan Rp 480M setahun. Para agent mengerjakan hal yang sama, dan mereka tidak resign saat gajian telat. Jujur, tim keuangan kami akhirnya bisa pulang sebelum jam 8 malam.",
        "Drafted": "Disusun",
        "Escalated": "Dieskalasi",
        "Filed": "Tersimpan",
        "Flagged": "Ditandai",
        "Matched": "Tercocokkan",
        "Sent": "Terkirim",
        "Sorted": "Terurut",
        "overnight transactions": "transaksi semalam",
        "polite payment reminders": "pengingat pembayaran yang sopan",
        "team lunch receipts": "struk makan siang tim",
        "6 hours": "6 jam",
        "32 hrs": "32 jam",
        "12 hrs": "12 jam",
        "3 min": "3 menit",
        "5 sec": "5 detik",

        // ── Dynamic Budgeting page backfill ──────────────────────────────────
        "Dynamic Budgeting for Modern Businesses | FluxyOS": "Dynamic Budgeting untuk Bisnis Modern | FluxyOS",
        "ACCELERATE YOUR GROWTH": "PERCEPAT PERTUMBUHAN ANDA",
        "TRUSTED BY FOUNDERS": "DIPERCAYA PARA FOUNDER",
        "Budgets that move": "Anggaran yang bergerak",
        "as fast as you scale.": "secepat bisnis Anda tumbuh.",
        "Stop waiting for month-end reports to know your burn rate. FluxyOS Dynamic Budgeting syncs with your ledger in real-time, monitoring unit economics and vendor spend so you can scale operations with total confidence.": "Berhenti menunggu laporan akhir bulan untuk tahu burn rate Anda. Dynamic Budgeting FluxyOS tersinkron dengan buku besar secara real-time, memantau unit economics dan pengeluaran vendor supaya Anda bisa scale-up dengan percaya diri penuh.",
        "Start your free trial": "Mulai uji coba gratis",
        "Built for business owners": "Dibuat untuk pemilik bisnis",
        "CEOs and business owners scaling their operations with total visibility.": "CEO dan pemilik bisnis yang mengembangkan operasinya dengan visibilitas penuh.",
        "Giving founders and CEOs the financial clarity they need to scale confidently, without getting bogged down in manual spreadsheets.": "Memberi founder dan CEO kejelasan keuangan untuk scale-up dengan percaya diri, tanpa terjebak spreadsheet manual.",
        "Every invoice processed and card swiped updates your budgets instantly. Watch your progress bars move in real-time, completely eliminating end-of-month surprises.": "Setiap invoice yang diproses dan kartu yang digesek langsung memperbarui anggaran Anda. Lihat progress bar bergerak real-time — kejutan akhir bulan hilang total.",
        "Manual spreadsheets kill momentum. FluxyOS brings your transaction data, department budgets, and multi-entity ledgers into one breathing ecosystem.": "Spreadsheet manual membunuh momentum. FluxyOS menyatukan data transaksi, anggaran departemen, dan buku besar multi-entitas dalam satu ekosistem yang hidup.",
        "Perfect for B2B structures. Map distinct budgets across regional branches, specific product lines, or different currency accounts from one centralized command center.": "Pas untuk struktur B2B. Petakan anggaran terpisah untuk cabang regional, lini produk tertentu, atau akun mata uang berbeda dari satu pusat komando.",
        "Scaling operations? Tie strict budgets to manufacturer limits, SaaS tools, and marketing spend to ensure your unit economics stay profitable as volume grows.": "Sedang scale-up? Ikat anggaran ketat ke limit manufaktur, tools SaaS, dan biaya marketing supaya unit economics tetap untung saat volume naik.",
        "Customize every aspect of the dashboard to suit your startup's specific departmental structures.": "Sesuaikan setiap aspek dashboard dengan struktur departemen startup Anda.",
        "Leverage real-time analytics to make informed decisions that drive your business's unit economics forward.": "Manfaatkan analitik real-time untuk mengambil keputusan yang mendorong unit economics bisnis Anda.",
        "Streamline your financial processes and save time with our seamless, automated ledger sync features.": "Sederhanakan proses keuangan dan hemat waktu dengan fitur sinkronisasi buku besar otomatis kami.",
        "Safeguard your multi-entity data and operations with top-tier security, built to ensure peace of mind.": "Lindungi data dan operasi multi-entitas Anda dengan keamanan kelas atas, dibangun agar Anda tenang.",
        "See how FluxyOS enhances your financial operations and opens doors to new scaling opportunities.": "Lihat bagaimana FluxyOS meningkatkan operasional keuangan dan membuka peluang scaling baru.",
        "Supercharge your business potential": "Lejitkan potensi bisnis Anda",
        "Total financial visibility, automatically.": "Visibilitas keuangan total, otomatis.",
        "Average time founders get back by eliminating manual spreadsheet updates.": "Rata-rata waktu yang kembali ke founder setelah menghapus update spreadsheet manual.",
        "Total business budgets optimized and tracked in real-time on our platform.": "Total anggaran bisnis yang dioptimalkan dan dipantau real-time di platform kami.",
        "Rated top-tier by business leaders for immediate ROI and financial clarity.": "Dinilai kelas atas oleh para pemimpin bisnis untuk ROI instan dan kejelasan keuangan.",
        "Ops budget depleting faster than projected. Re-allocate surplus funds to avoid freeze.": "Anggaran ops terkuras lebih cepat dari proyeksi. Alokasikan ulang dana surplus agar tidak dibekukan.",
        "Based on current cash flow": "Berdasarkan arus kas saat ini",
        "vs last year": "vs tahun lalu",
        "What is Dynamic Budgeting?": "Apa itu Dynamic Budgeting?",
        "Dynamic Budgeting is a FluxyOS feature that lets businesses allocate, track, and adjust budgets in real time as spend changes. Instead of waiting for spreadsheet updates, teams can see available budget, burn rate, and variance as transactions arrive.": "Dynamic Budgeting adalah fitur FluxyOS untuk mengalokasikan, memantau, dan menyesuaikan anggaran secara real-time saat pengeluaran berubah. Tanpa menunggu update spreadsheet, tim bisa melihat sisa anggaran, burn rate, dan selisih begitu transaksi masuk.",
        "How does Dynamic Budgeting help Indonesian SMBs?": "Bagaimana Dynamic Budgeting membantu UKM Indonesia?",
        "Dynamic Budgeting helps Indonesian SMBs control spending by connecting budgets to live vendor, receipt, and ledger data. Owners can see when marketing, operations, SaaS, or project budgets are moving off plan before month end.": "Dynamic Budgeting membantu UKM Indonesia mengendalikan pengeluaran dengan menghubungkan anggaran ke data vendor, struk, dan buku besar yang live. Pemilik bisa melihat kapan anggaran marketing, operasional, SaaS, atau proyek mulai keluar jalur sebelum akhir bulan.",
        "Can FluxyOS track budgets by department or project?": "Bisakah FluxyOS memantau anggaran per departemen atau proyek?",
        "Yes. FluxyOS can organize budgets by department, project, entity, or operating category so teams can compare planned spend against actual spend. This is useful for agencies, e-commerce teams, restaurants, and multi-location operators.": "Bisa. FluxyOS dapat menata anggaran per departemen, proyek, entitas, atau kategori operasional, jadi tim bisa membandingkan rencana dengan pengeluaran aktual. Berguna untuk agensi, tim e-commerce, restoran, dan operator multi-lokasi.",
        "Is Dynamic Budgeting different from a spreadsheet budget?": "Apa bedanya Dynamic Budgeting dengan anggaran spreadsheet?",
        "Yes. A spreadsheet budget is usually static and updated manually, while Dynamic Budgeting updates from live finance operations data. That makes it easier to monitor runway, category spend, and budget variance without rebuilding reports each week.": "Beda. Anggaran spreadsheet biasanya statis dan diperbarui manual, sedangkan Dynamic Budgeting terbarui dari data operasional keuangan yang live. Runway, pengeluaran per kategori, dan selisih anggaran jadi lebih mudah dipantau tanpa menyusun ulang laporan tiap minggu.",
        "Does Dynamic Budgeting send alerts?": "Apakah Dynamic Budgeting mengirim peringatan?",
        "Yes. Dynamic Budgeting can surface variance and burn-rate alerts when a budget is being used faster than expected. The goal is to help teams reallocate funds or pause spend before a budget problem becomes urgent.": "Ya. Dynamic Budgeting memunculkan peringatan selisih dan burn rate saat anggaran terpakai lebih cepat dari perkiraan. Tujuannya membantu tim mengalokasikan ulang dana atau menahan pengeluaran sebelum masalah anggaran jadi mendesak.",
        "Can Dynamic Budgeting work with multi-currency spend?": "Bisakah Dynamic Budgeting bekerja dengan pengeluaran multi-mata-uang?",
        "Yes. Dynamic Budgeting is designed for IDR-first reporting while supporting multi-currency spend across vendors, cards, and international platforms. This helps teams manage local budgets even when some tools bill in USD or SGD.": "Bisa. Dynamic Budgeting dirancang IDR-first sambil mendukung pengeluaran multi-mata-uang lintas vendor, kartu, dan platform internasional. Anggaran lokal tetap terkelola meski sebagian tools menagih dalam USD atau SGD.",
        "Dynamic Budgeting questions, answered": "Pertanyaan tentang Dynamic Budgeting, terjawab",
        "Active Budgets": "Anggaran Aktif",
        "Budget Alert": "Peringatan Anggaran",
        "Projected Runway": "Proyeksi Runway",
        "Real-Time Burn Tracking": "Pelacakan Burn Real-Time",
        "Multi-Entity Mapping": "Pemetaan Multi-Entitas",
        "Unit Economics Scale": "Skala Unit Economics",
        "Marketing & Growth": "Marketing & Pertumbuhan",
        "Q3 Ops & Manufacturing": "Ops & Manufaktur Q3",
        "TikTok Ads Budget": "Anggaran TikTok Ads",
        "75% Consumed": "75% Terpakai",
        "92% Consumed": "92% Terpakai",
        "Limit: Rp 160.0M": "Limit: Rp 160.0M",
        "Limit: Rp 300.0M": "Limit: Rp 300.0M",
        "CAPITAL MANAGED": "MODAL TERKELOLA",
        "FOUNDERS EMPOWERED": "FOUNDER TERBANTU",
        "HOURS SAVED MONTHLY": "JAM DIHEMAT PER BULAN",
        "OWNER SATISFACTION": "KEPUASAN PEMILIK",
        "Customization": "Kustomisasi",
        "Efficiency": "Efisiensi",
        "Insights": "Wawasan",
        "Security": "Keamanan",
        "Spent": "Terpakai",
        "Balance": "Saldo",
        "IDR Account": "Akun IDR",
        "Contact Sales": "Hubungi Sales",
        "Retail": "Ritel",
        "an overdue invoice": "invoice yang lewat jatuh tempo",
        "The intelligent financial operating system. Unify internal budgets, operational expenses, and revenue for agencies, manufacturers, and modern businesses.": "Sistem operasi keuangan yang cerdas. Satukan anggaran internal, biaya operasional, dan pendapatan untuk agensi, manufaktur, dan bisnis modern.",
        "bank statements to invoices": "rekening koran dengan invoice",
        "today's receipts and bills": "struk dan tagihan hari ini",
        "tomorrow's daily summary": "ringkasan harian besok",
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

        // Update the active-row highlight AND move the ✓ check into the active
        // row (the static markup ships with the check inside the EN row only).
        var CHECK_SVG = '<svg class="w-4 h-4 text-[#EA580C]" data-lang-check fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';
        var dropdownLinks = document.querySelectorAll('a');
        dropdownLinks.forEach(function (a) {
            var t = a.textContent.trim();
            var isEnRow = t.indexOf('English (EN)') === 0;
            var isIdRow = t.indexOf('Bahasa (ID)') === 0;
            if (!isEnRow && !isIdRow) return;
            var active = (isEnRow && lang === 'en') || (isIdRow && lang === 'id');

            // Row highlight
            a.classList.toggle('bg-gray-50', active);
            a.classList.toggle('text-gray-900', active);
            a.classList.toggle('text-gray-600', !active);

            // Check glyph: exactly one, on the active row. Rows are styled with
            // flex + justify-between when they carry the check.
            var check = a.querySelector('svg[data-lang-check]') ||
                Array.prototype.find.call(a.querySelectorAll('svg'), function (s) {
                    var p = s.querySelector('path');
                    return p && /^M5 13l4/.test(p.getAttribute('d') || '');
                });
            if (active && !check) {
                a.classList.add('flex', 'items-center', 'justify-between');
                a.classList.remove('block');
                a.insertAdjacentHTML('beforeend', CHECK_SVG);
            } else if (!active && check) {
                check.remove();
                a.classList.remove('flex', 'items-center', 'justify-between');
                a.classList.add('block');
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
