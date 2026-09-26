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
        "Ask about revenue, cash, and documents.": "Tanyakan pendapatan, kas, dan dokumen.",
        "Choose a financial topic. See a sample answer and the records behind it.": "Pilih topik keuangan. Lihat contoh jawaban dan catatan yang mendasarinya.",
        "The old way.": "Cara lama.",
        "The Fluxy AI way.": "Dengan Fluxy AI.",
        "Has this document been checked?": "Dokumen ini sudah diperiksa?",
        "Financial context": "Konteks keuangan",
        "Supporting records": "Catatan pendukung",
        "Workspace services": "Sewa ruang kerja",
        "Total paid": "Total dibayar",
        "Extracted fields": "Hasil ekstraksi",
        "Compare with the receipt before saving.": "Cocokkan dengan struk sebelum menyimpan.",
        "Finance Q&A": "Tanya jawab keuangan",
        "AI-assisted document extraction": "Ekstraksi dokumen dengan bantuan AI",
        "Review before save": "Periksa sebelum menyimpan",
        "Financial data explanations": "Penjelasan data keuangan",
        // Fluxy AI: product-grounded landing narrative
        "Financial records": "Catatan keuangan",
        "Uploaded document": "Dokumen diupload",
        "Ready to review": "Siap diperiksa",
        "Vendor": "Vendor",
        "Amount": "Jumlah",
        "Category": "Kategori",
        "Office expenses": "Biaya kantor",
        "Check the extracted details before saving.": "Periksa hasil ekstraksi sebelum menyimpan.",
        "Why did expenses increase?": "Kenapa pengeluaran naik?",
        "Office expenses increased by Rp2.400.000 in this example. Open the underlying transactions to check what changed.": "Dalam contoh ini, biaya kantor naik Rp2.400.000. Buka transaksi terkait untuk melihat rinciannya.",
        "Expenses": "Pengeluaran",
        "How much revenue did we record?": "Berapa pendapatan yang tercatat?",
        "Recorded revenue is Rp48.000.000 for this example period. Compare it with expenses and review the revenue transactions.": "Pendapatan tercatat Rp48.000.000 pada periode contoh ini. Bandingkan dengan pengeluaran dan periksa transaksi pendapatannya.",
        "Revenue": "Pendapatan",
        "What is our cash position?": "Berapa posisi kas kita?",
        "The example shows Rp32.800.000 in cash. Review the account balances and recorded cash movements before making a decision.": "Contoh ini menunjukkan kas Rp32.800.000. Periksa saldo rekening dan arus kas yang tercatat sebelum mengambil keputusan.",
        "Cash position": "Posisi kas",
        "Based on recorded transactions": "Berdasarkan transaksi yang tercatat",
        "What are FluxyOS AI Agents?": "Apa itu FluxyOS AI Agents?",
        "Fluxy AI brings finance Q&A and document extraction into FluxyOS. It helps you work with recorded financial data, review extracted details, and understand business performance.": "Fluxy AI menghadirkan tanya jawab keuangan dan ekstraksi dokumen di FluxyOS. Anda bisa memakai data keuangan yang tercatat, memeriksa hasil ekstraksi, dan memahami kinerja bisnis.",
        "Can Fluxy AI move money or run finance on its own?": "Apakah Fluxy AI bisa memindahkan uang atau menjalankan keuangan sendiri?",
        "No. Fluxy AI is not an autonomous finance team. Use it to understand information and review document details; your team remains responsible for decisions and saved records.": "Tidak. Fluxy AI bukan tim keuangan otonom. Gunakan untuk memahami informasi dan memeriksa dokumen. Keputusan dan catatan yang disimpan tetap menjadi tanggung jawab tim Anda.",
        "What financial questions can I ask?": "Pertanyaan keuangan apa yang bisa saya ajukan?",
        "Ask about recorded revenue, expenses, cash positions, transactions, and financial performance. The answer depends on the data available in your workspace.": "Tanyakan pendapatan, pengeluaran, posisi kas, transaksi, dan kinerja keuangan yang tercatat. Jawaban bergantung pada data yang tersedia di ruang kerja Anda.",
        "Do I need to review extracted documents?": "Apakah hasil ekstraksi dokumen perlu diperiksa?",
        "Yes. Check amounts, dates, vendors, and categories before saving. AI can make mistakes, and a clear source record makes accounting easier to verify.": "Ya. Periksa jumlah, tanggal, vendor, dan kategori sebelum menyimpan. AI bisa salah. Dokumen sumber yang jelas membantu Anda memeriksa catatan akuntansi.",
        "Does Fluxy AI replace financial reports?": "Apakah Fluxy AI menggantikan laporan keuangan?",
        "No. Financial statements and ledger records remain the source for accounting. Fluxy AI helps explain the information; verify important answers against the relevant records.": "Tidak. Laporan keuangan dan buku besar tetap menjadi sumber catatan akuntansi. Fluxy AI membantu menjelaskan informasi. Cocokkan jawaban penting dengan catatan terkait.",
        "Can I use Bahasa Indonesia?": "Bisakah saya memakai Bahasa Indonesia?",
        "Yes. Fluxy AI supports financial questions in Bahasa Indonesia and English. Keep business names, amounts, and time periods clear in your question.": "Bisa. Fluxy AI mendukung pertanyaan keuangan dalam Bahasa Indonesia dan English. Sebutkan nama bisnis, jumlah, dan periode dengan jelas dalam pertanyaan Anda.",
        "Start free": "Mulai gratis",
        "Talk to sales": "Hubungi sales",
        "Less searching.": "Kurangi waktu mencari.",
        "More understanding.": "Pahami keuangan Anda.",
        "FluxyOS is an Intelligent Finance Operating System. Fluxy AI helps you read documents, ask financial questions, and understand the records behind your numbers.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System). Fluxy AI membantu Anda membaca dokumen, bertanya soal keuangan, dan memahami catatan di balik angka.",
        "Illustrative product data. Select a question to explore.": "Data ilustrasi produk. Pilih pertanyaan untuk melihat contohnya.",
        "Your data has the answers.": "Jawabannya ada di data Anda.",
        "Bring the financial context together before you ask the next question.": "Satukan catatan keuangan sebelum mencari jawaban berikutnya.",
        "Without the context": "Tanpa catatan yang terhubung",
        "Which transaction is this?": "Ini transaksi yang mana?",
        "Where is the receipt?": "Struknya ada di mana?",
        "What changed this month?": "Apa yang berubah bulan ini?",
        "With Fluxy AI": "Dengan Fluxy AI",
        "One financial picture": "Satu gambaran keuangan",
        "Net result": "Hasil bersih",
        "Ask about the numbers. Check the records.": "Tanyakan angkanya. Periksa catatannya.",
        "Useful AI starts with the books.": "AI yang berguna berangkat dari pembukuan.",
        "Not a separate chatbot. A financial assistant inside the system where your records live.": "Bukan chatbot yang berdiri sendiri. Asisten keuangan di dalam sistem tempat catatan Anda tersimpan.",
        "Recorded data": "Data yang tercatat",
        "Answers grounded in your workspace, not a generic business guess.": "Jawaban memakai data ruang kerja Anda, bukan tebakan tentang bisnis.",
        "Reviewable details": "Rincian yang bisa diperiksa",
        "Keep the source document next to the extracted information.": "Lihat dokumen sumber bersama hasil ekstraksinya.",
        "Human judgment": "Keputusan tetap di tangan Anda",
        "Your team checks the information and decides what comes next.": "Tim Anda memeriksa informasi dan menentukan langkah berikutnya.",
        "Less retyping. Better records.": "Kurangi ketik ulang. Rapikan catatan.",
        "Read the source, review the details, and keep your financial data connected.": "Baca dokumen sumber, periksa rinciannya, dan hubungkan catatan keuangan.",
        "Read the document": "Baca dokumennya",
        "Extract details from uploaded financial documents instead of entering every field by hand.": "Ambil rincian dari dokumen keuangan yang diupload tanpa mengetik setiap kolom satu per satu.",
        "Keep the source in view": "Tetap lihat sumbernya",
        "Review the extracted information alongside the document before it becomes a saved record.": "Periksa hasil ekstraksi bersama dokumennya sebelum menjadi catatan yang disimpan.",
        "Document review": "Pemeriksaan dokumen",
        "Document": "Dokumen",
        "Your review comes first": "Periksa dulu sebelum menyimpan",
        "Ask a question. Follow the numbers.": "Tanyakan. Telusuri angkanya.",
        "Move from a broad question to the financial detail that matters.": "Mulai dari pertanyaan, lalu lihat rincian keuangan yang relevan.",
        "Start with your business question": "Mulai dari pertanyaan bisnis Anda",
        "Ask about revenue, expenses, cash, or transactions in everyday language. No query syntax required.": "Tanyakan pendapatan, pengeluaran, kas, atau transaksi dengan bahasa sehari-hari. Tidak perlu menulis query.",
        "Understand the financial picture": "Pahami kondisi keuangan",
        "Use the explanation alongside your statements and KPIs to understand how recorded revenue and expenses affect performance.": "Baca penjelasannya bersama laporan dan KPI untuk memahami pengaruh pendapatan serta pengeluaran terhadap kinerja.",
        "Performance overview": "Ringkasan kinerja",
        "Recorded revenue": "Pendapatan tercatat",
        "Recorded expenses": "Pengeluaran tercatat",
        "Check before you decide": "Periksa sebelum mengambil keputusan",
        "Review the underlying transactions and documents. AI explanations support your judgment; they do not replace the books.": "Periksa transaksi dan dokumen terkait. Penjelasan AI membantu Anda mengambil keputusan, bukan menggantikan pembukuan.",
        "Transaction detail": "Rincian transaksi",
        "Source document": "Dokumen sumber",
        "Source records stay part of the workflow.": "Dokumen sumber tetap menjadi bagian dari alur kerja.",
        "A clearer view, from every angle.": "Lihat keuangan dari berbagai sisi.",
        "Explore how Fluxy AI connects questions with the context behind them.": "Lihat bagaimana Fluxy AI menghubungkan pertanyaan dengan catatan yang relevan.",
        "Revenue and expenses": "Pendapatan dan pengeluaran",
        "Compare recorded income and spend before choosing what to investigate.": "Bandingkan pemasukan dan pengeluaran yang tercatat sebelum menentukan apa yang perlu diperiksa.",
        "Cash and transactions": "Kas dan transaksi",
        "Understand recorded cash movements and trace them to the relevant entries.": "Pahami arus kas yang tercatat dan telusuri entri terkait.",
        "Documents and records": "Dokumen dan catatan",
        "Keep extracted details and the financial document in the same conversation.": "Gunakan hasil ekstraksi dan dokumen keuangan dalam pertanyaan yang sama.",
        "One connected financial context": "Catatan keuangan yang terhubung",
        "Part of your financial operating system.": "Bagian dari sistem keuangan Anda.",
        "Capture, monitor, report, and ask—all within FluxyOS.": "Catat, pantau, baca laporan, dan bertanya—di FluxyOS.",
        "From document to reviewed data.": "Dari dokumen ke data yang sudah diperiksa.",
        "Bring recorded revenue into view.": "Lihat pendapatan yang tercatat.",
        "Track spend against your budget.": "Pantau pengeluaran dibanding anggaran.",
        "Accounting, statements, and insight.": "Akuntansi, laporan, dan pemahaman bisnis.",
        "Explore": "Jelajahi",
        "Frequently asked questions": "Pertanyaan yang sering diajukan",
        "Put your financial data to work.": "Gunakan data keuangan Anda.",
        "Keep the decisions yours.": "Keputusan tetap di tangan Anda.",
        "Ask financial questions, review extracted documents, and understand your recorded business data with Fluxy AI inside FluxyOS.": "Tanyakan keuangan, periksa hasil ekstraksi dokumen, dan pahami data bisnis yang tercatat dengan Fluxy AI di FluxyOS.",
        "Fluxy AI Agents — Understand Your Financial Data | FluxyOS": "Fluxy AI Agents — Pahami Data Keuangan Anda | FluxyOS",
        // Customers: original dummy brands and community-style conversion section
        "Company brand wall": "Deretan merek perusahaan",
        "Northline": "Northline",
        "Ruang": "Ruang",
        "Aruna": "Aruna",
        "Karsa": "Karsa",
        "Illustrative stories for retail, agencies, and finance teams.": "Contoh cerita untuk bisnis retail, agensi, dan tim keuangan.",
        "Explore connected financial workflows for retail, agencies, and finance teams, with illustrative business stories and sample testimonials.": "Lihat alur keuangan untuk bisnis retail, agensi, dan tim keuangan melalui cerita ilustratif dan contoh testimoni.",
        "Alya · Finance lead, Northline Commerce": "Alya · Tim keuangan, Northline Commerce",
        "Dimas · Founder, Studio Ruang": "Dimas · Founder, Studio Ruang",
        "Nadia · Accountant, Ledger & Co.": "Nadia · Akuntan, Ledger & Co.",
        "Rani · Owner, Daily Goods": "Rani · Pemilik, Daily Goods",
        "Bayu · Operations lead, Aruna Works": "Bayu · Tim operasional, Aruna Works",
        "Fira · Studio manager, Karsa Studio": "Fira · Manajer studio, Karsa Studio",
        "Rani Aditya": "Rani Aditya",
        "Owner, Daily Goods": "Pemilik, Daily Goods",
        "Connected finance.": "Keuangan yang terhubung.",
        "For the business you’re building.": "Untuk bisnis yang Anda bangun.",
        // Customers page: explicitly labeled sample stories and testimonials
        "Order · SP-1042": "Pesanan · SP-1042",
        "Platform fee": "Biaya platform",
        "Recorded in the ledger": "Tercatat di buku besar",
        "March allocation": "Alokasi Maret",
        "65 percent of the allocation used": "65 persen alokasi telah digunakan",
        "Bank · Debit": "Bank · Debit",
        "Expenses": "Pengeluaran",
        "Illustrative financial trend": "Contoh tren keuangan",
        "What makes up our expenses this month?": "Apa saja pengeluaran bulan ini?",
        "Invoice · INV-028": "Invoice · INV-028",
        "Due date": "Jatuh tempo",
        "30 March 2026": "30 Maret 2026",
        "Payment status": "Status pembayaran",
        "Invoices": "Invoice",
        "Document": "Dokumen",
        "Extracted amount": "Jumlah yang terbaca",
        "Review before posting": "Periksa sebelum dibukukan",
        "Reviewed": "Sudah diperiksa",
        "Northline Commerce": "Northline Commerce",
        "E-commerce": "E-commerce",
        "Fictional example": "Contoh fiktif",
        "Every sale, down to the settlement.": "Dari pesanan sampai pencairan dana.",
        "A marketplace workflow with the books in view.": "Catatan marketplace terhubung ke pembukuan.",
        "Follow orders, refunds, and platform fees from TikTok Shop and Shopee into the ledger.": "Telusuri pesanan, pengembalian dana, dan biaya TikTok Shop serta Shopee hingga ke buku besar.",
        "Explore Revenue Sync": "Lihat Revenue Sync",
        "Sample testimonial": "Contoh testimoni",
        "“We want to trace a payout back to the order, without checking three separate sheets.”": "“Kami ingin bisa menelusuri pencairan dana ke pesanan asal, tanpa membuka tiga spreadsheet.”",
        "Alya · Finance lead, Northline Commerce (fictional)": "Alya · Tim keuangan, Northline Commerce (fiktif)",
        "Studio Ruang": "Studio Ruang",
        "Agency": "Agensi",
        "A spending plan you can follow.": "Anggaran yang bisa dipantau.",
        "From allocation to actual spend.": "Dari alokasi sampai realisasi.",
        "Give expenses a budget allocation and see what is left before the next purchase.": "Kaitkan pengeluaran ke alokasi anggaran dan periksa sisanya sebelum membeli lagi.",
        "Explore Dynamic Budgeting": "Lihat Dynamic Budgeting",
        "“The plan and the actual spend should be next to each other, not in different files.”": "“Anggaran dan realisasinya harus bisa dilihat bersama, bukan tersimpan di file yang berbeda.”",
        "Dimas · Founder, Studio Ruang (fictional)": "Dimas · Founder, Studio Ruang (fiktif)",
        "Ledger & Co.": "Ledger & Co.",
        "Finance team": "Tim keuangan",
        "A close you can trace.": "Tutup buku dengan catatan yang jelas.",
        "Every balance has a source.": "Setiap saldo punya rincian.",
        "Review the journals and account balances behind financial statements, all in one workspace.": "Periksa jurnal dan saldo akun yang mendasari laporan keuangan dalam satu ruang kerja.",
        "Explore ERP Intelligence": "Lihat ERP Intelligence",
        "“A financial report is only useful when we can explain the entries behind it.”": "“Laporan keuangan baru berguna kalau kami bisa menjelaskan catatan yang mendasarinya.”",
        "Nadia · Accountant, Ledger & Co. (fictional)": "Nadia · Akuntan, Ledger & Co. (fiktif)",
        "Daily Goods": "Daily Goods",
        "The numbers, with their context.": "Angka yang bisa dipahami.",
        "A clearer view of revenue and expenses.": "Pendapatan dan pengeluaran terlihat jelas.",
        "Bring financial statements and Fluxy AI questions into the same business conversation.": "Gunakan laporan keuangan dan Fluxy AI untuk membahas kondisi bisnis dari data yang sama.",
        "Explore financial reporting": "Lihat laporan keuangan",
        "“We need more than a total. We need to know what changed and which records explain it.”": "“Kami butuh lebih dari total. Kami ingin tahu apa yang berubah dan transaksi mana yang menjelaskannya.”",
        "Rani · Owner, Daily Goods (fictional)": "Rani · Pemilik, Daily Goods (fiktif)",
        "Aruna Works": "Aruna Works",
        "Professional services": "Jasa profesional",
        "Keep receivables in view.": "Pantau piutang yang belum dibayar.",
        "From invoice to payment status.": "Dari invoice sampai status pembayaran.",
        "Keep invoice amounts, due dates, and payment status together for your finance team.": "Satukan nilai invoice, tanggal jatuh tempo, dan status pembayaran untuk tim keuangan Anda.",
        "Explore finance workflows": "Lihat alur kerja keuangan",
        "“Invoice details and payment status should be easy to find when a client asks.”": "“Rincian invoice dan status pembayaran harus mudah ditemukan saat klien bertanya.”",
        "Bayu · Operations lead, Aruna Works (fictional)": "Bayu · Tim operasional, Aruna Works (fiktif)",
        "Karsa Studio": "Karsa Studio",
        "Creative studio": "Studio kreatif",
        "A receipt becomes a record.": "Struk menjadi catatan keuangan.",
        "Capture, review, then account for it.": "Upload, periksa, lalu bukukan.",
        "Extract document details, check the result, and connect expenses to accounting.": "Baca rincian dokumen, periksa hasilnya, lalu hubungkan pengeluaran ke pembukuan.",
        "Explore Receipt Capture": "Lihat Receipt Capture",
        "“We want the receipt and its transaction to stay together when it is time to review.”": "“Saat diperiksa nanti, struk dan transaksinya harus tetap terhubung.”",
        "Fira · Studio manager, Karsa Studio (fictional)": "Fira · Manajer studio, Karsa Studio (fiktif)",
        "Different businesses.": "Bisnis yang berbeda.",
        "One connected financial picture.": "Satu gambaran keuangan yang utuh.",
        "FluxyOS is an Intelligent Finance Operating System that connects financial operations, accounting, and business insights.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) yang menghubungkan operasional keuangan, akuntansi, dan wawasan bisnis.",
        "Explore the stories": "Lihat contoh cerita",
        "Preview content disclosure": "Keterangan konten contoh",
        "Preview content.": "Konten contoh.",
        "Company logos are layout placeholders. The stories, people, and testimonials below are fictional examples, not customer endorsements.": "Logo perusahaan hanya untuk contoh tata letak. Cerita, tokoh, dan testimoni di bawah bersifat fiktif, bukan dukungan dari pelanggan.",
        "Example company logos": "Contoh logo perusahaan",
        "Example brands for this layout — not FluxyOS customers.": "Contoh merek untuk tata letak ini — bukan pelanggan FluxyOS.",
        "Linear": "Linear",
        "Notion": "Notion",
        "Vercel": "Vercel",
        "Shopify": "Shopify",
        "GitHub": "GitHub",
        "Figma": "Figma",
        "The work behind a clearer financial picture.": "Alur kerja untuk keuangan yang lebih jelas.",
        "Six sample stories. Real FluxyOS workflows. Ready for your future customer stories.": "Enam contoh cerita dengan alur kerja FluxyOS yang sudah tersedia. Nantinya, isi bagian ini dengan cerita pelanggan Anda.",
        "Filter sample stories": "Filter contoh cerita",
        "All stories": "Semua cerita",
        "Retail & e-commerce": "Retail & e-commerce",
        "Agencies & services": "Agensi & jasa",
        "Finance teams": "Tim keuangan",
        "Sample testimonial · fictional company and person": "Contoh testimoni · perusahaan dan tokoh fiktif",
        "“I want to understand the business without asking the team to rebuild the numbers in a spreadsheet.”": "“Saya ingin memahami kondisi bisnis tanpa meminta tim menyusun ulang angkanya di spreadsheet.”",
        "Rani Aditya (fictional)": "Rani Aditya (fiktif)",
        "Owner, Daily Goods · sample content": "Pemilik, Daily Goods · konten contoh",
        "Bring your business into focus.": "Lihat kondisi bisnis Anda dengan jelas.",
        "Connect daily financial work to the books, the reports, and the decisions that follow.": "Hubungkan pekerjaan keuangan sehari-hari ke pembukuan, laporan, dan keputusan bisnis.",
        "Customers & Business Workflows | FluxyOS": "Pelanggan & Alur Kerja Bisnis | FluxyOS",
        "Explore FluxyOS financial workflows for owners and finance teams. This preview uses clearly labeled sample stories and testimonials.": "Lihat alur kerja keuangan FluxyOS untuk pemilik bisnis dan tim keuangan. Halaman ini memakai cerita dan testimoni contoh yang ditandai dengan jelas.",
        // Budgeting and Revenue Sync editorial product pages
        "Dynamic Budgeting product preview": "Pratinjau Dynamic Budgeting",
        "Annual plan": "Anggaran tahunan",
        "Budget periods": "Periode anggaran",
        "Allocations": "Alokasi",
        "Actual spend": "Realisasi pengeluaran",
        "Your plan, in motion.": "Rencana dan realisasi Anda.",
        "Connected to the ledger": "Terhubung ke buku besar",
        "Planned budget": "Anggaran",
        "Available budget": "Sisa anggaran",
        "Spend by allocation": "Pengeluaran per alokasi",
        "This period": "Periode ini",
        "Operations": "Operasional",
        "Budget": "Anggaran",
        "Marketing": "Pemasaran",
        "Software": "Perangkat lunak",
        "How much have we spent on software?": "Berapa pengeluaran untuk perangkat lunak?",
        "Software expenses for March. Review the linked transactions before your next purchase.": "Pengeluaran perangkat lunak di bulan Maret. Periksa transaksi terkait sebelum membeli lagi.",
        "Illustrative product data": "Contoh data produk",
        "Plan → allocation → actual spend": "Rencana → alokasi → realisasi",
        "Set the plan. Track actual spend. Know what is left before your next spending decision.": "Tentukan anggaran, pantau pengeluaran, dan cek sisanya sebelum mengambil keputusan berikutnya.",
        "FluxyOS is an Intelligent Finance Operating System that connects financial operations, accounting, business operations, enterprise workflows, and intelligence into one continuously connected system. Dynamic Budgeting connects your spending plan to the expenses recorded in that system.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) yang menghubungkan operasional keuangan, akuntansi, operasional bisnis, alur kerja perusahaan, dan kecerdasan dalam satu sistem yang terus terhubung. Dynamic Budgeting mengaitkan anggaran dengan pengeluaran yang dicatat di sistem tersebut.",
        "One plan.": "Satu rencana.",
        "A clear place for every expense.": "Setiap pengeluaran punya alokasi.",
        "Start with the year, break it into periods, then give each spending category a budget.": "Mulai dari anggaran tahunan, bagi per periode, lalu tentukan jatah untuk setiap kategori pengeluaran.",
        "Start with the annual plan": "Susun anggaran tahunan",
        "Set the total you want to work within.": "Tentukan total anggaran yang menjadi acuan.",
        "Choose your budget periods": "Bagi menjadi beberapa periode",
        "Organize the plan around how your business operates.": "Sesuaikan periode dengan kebutuhan operasional bisnis.",
        "Allocate, then track": "Alokasikan, lalu pantau",
        "Connect expenses to allocations and review the actual spend.": "Kaitkan pengeluaran ke alokasi dan lihat realisasinya.",
        "2026 annual plan": "Anggaran tahunan 2026",
        "March budget period": "Periode anggaran Maret",
        "The plan and the spending.": "Anggaran dan pengeluaran.",
        "Finally in the same view.": "Kini bisa dilihat bersama.",
        "Less time matching spreadsheets. More time understanding where your money goes.": "Kurangi waktu mencocokkan spreadsheet. Fokus melihat ke mana uang bisnis Anda digunakan.",
        "Software subscription": "Langganan perangkat lunak",
        "Assigned allocation": "Alokasi terkait",
        "Give expenses a budget home.": "Hubungkan pengeluaran ke anggarannya.",
        "Assign an expense to its allocation so actual spend has a traceable source.": "Kaitkan pengeluaran ke alokasi yang sesuai agar realisasi bisa ditelusuri.",
        "Planned": "Anggaran",
        "See the gap, not just the total.": "Lihat selisihnya, bukan hanya totalnya.",
        "Compare your plan with actual spend and see the remaining room in each allocation.": "Bandingkan anggaran dengan realisasi dan cek sisa dana di tiap alokasi.",
        "What makes up our software expenses?": "Apa saja pengeluaran perangkat lunak kita?",
        "Start with the recorded transactions. Review subscriptions and other software expenses together.": "Mulai dari transaksi yang tercatat. Tinjau biaya langganan dan pengeluaran perangkat lunak lainnya.",
        "Ask about the spend behind the numbers.": "Tanyakan rincian di balik pengeluaran.",
        "Use Fluxy AI to explore your financial data, then check the records behind the answer.": "Gunakan Fluxy AI untuk menelusuri data keuangan, lalu periksa catatan yang mendasari jawabannya.",
        "Financial KPIs": "KPI keuangan",
        "Keep the budget connected to the books.": "Anggaran tetap terhubung ke pembukuan.",
        "Budget tracking works with recorded expenses, not a separate set of financial data.": "Pemantauan anggaran memakai pengeluaran yang sudah dicatat, bukan data keuangan yang terpisah.",
        "A few things to know.": "Yang perlu Anda ketahui.",
        "What can I track with Dynamic Budgeting?": "Apa yang bisa dipantau lewat Dynamic Budgeting?",
        "Create an annual plan, divide it into budget periods, and allocate amounts to spending categories. Track assigned expenses against those allocations.": "Susun anggaran tahunan, bagi per periode, lalu tentukan alokasi tiap kategori. Pengeluaran yang sudah dikaitkan ke anggaran akan tampil sebagai realisasi.",
        "How does actual spend update?": "Bagaimana realisasi pengeluaran diperbarui?",
        "Actual spend comes from expenses assigned to a budget allocation. You can review the linked transactions to understand what makes up each total.": "Realisasi dihitung dari pengeluaran yang dikaitkan ke alokasi anggaran. Buka transaksi terkait untuk melihat rincian di balik setiap total.",
        "Can I adjust my budget?": "Apakah anggaran bisa diubah?",
        "Yes. Review and update your plans, periods, and allocations as your spending priorities change.": "Bisa. Sesuaikan rencana, periode, dan alokasi anggaran saat prioritas pengeluaran berubah.",
        "Does a budget stop a payment?": "Apakah anggaran membatasi pembayaran?",
        "No. Dynamic Budgeting gives you visibility into planned and actual spend. It is not a payment approval or spending-blocking system.": "Tidak. Dynamic Budgeting membantu Anda melihat rencana dan realisasi pengeluaran, bukan menyetujui atau memblokir pembayaran.",
        "How does Fluxy AI help?": "Apa peran Fluxy AI?",
        "Ask questions about your financial data to understand expenses and business performance. Review the underlying records before making a spending decision.": "Tanyakan pengeluaran dan kinerja bisnis dari data keuangan Anda. Periksa catatan yang mendasarinya sebelum mengambil keputusan.",
        "Make the next spending decision with the numbers in view.": "Ambil keputusan pengeluaran dengan angka yang jelas.",
        "Bring your plan and actual spend into the same workspace with Dynamic Budgeting.": "Satukan anggaran dan realisasi pengeluaran dalam satu ruang kerja dengan Dynamic Budgeting.",
        "Example marketplace records": "Contoh catatan marketplace",
        "Source": "Sumber",
        "Record": "Catatan",
        "Status": "Status",
        "Posted": "Dibukukan",
        "Refund": "Pengembalian dana",
        "Recorded": "Tercatat",
        "Settlement": "Pencairan dana",
        "Settled": "Dicairkan",
        "TikTok Shop and Shopee connected to FluxyOS": "TikTok Shop dan Shopee terhubung ke FluxyOS",
        "Revenue Sync product preview": "Pratinjau Revenue Sync",
        "Orders": "Pesanan",
        "Refunds": "Pengembalian dana",
        "Settlements": "Pencairan dana",
        "Marketplace activity": "Aktivitas marketplace",
        "Gross sales": "Penjualan bruto",
        "Net settlements": "Pencairan bersih",
        "Orders → refunds & fees → settlements": "Pesanan → pengembalian & biaya → pencairan",
        "Marketplace": "Marketplace",
        "Order value": "Nilai pesanan",
        "The order value stays tied to its marketplace reference.": "Nilai pesanan tetap terkait dengan referensi marketplace asal.",
        "Original order": "Pesanan asal",
        "Refund amount": "Jumlah pengembalian",
        "Follow the adjustment back to the original sale.": "Telusuri penyesuaian hingga ke penjualan asal.",
        "Platform fees": "Biaya platform",
        "Net payout": "Dana bersih diterima",
        "See how the sale becomes the amount paid out.": "Lihat rincian dari nilai penjualan hingga dana yang dicairkan.",
        "Marketplace record types": "Jenis catatan marketplace",
        "Order recorded": "Pesanan tercatat",
        "Refund recorded": "Pengembalian dana tercatat",
        "Settlement recorded": "Pencairan dana tercatat",
        "Marketplace revenue.": "Pendapatan marketplace.",
        "Connect TikTok Shop and Shopee. Bring orders, refunds, and settlements into your double-entry ledger.": "Hubungkan TikTok Shop dan Shopee. Catat pesanan, pengembalian dana, dan pencairan dana ke buku besar berpasangan Anda.",
        "Explore integrations": "Lihat integrasi",
        "FluxyOS is an Intelligent Finance Operating System that connects financial operations, accounting, business operations, enterprise workflows, and intelligence into one continuously connected system. Revenue Sync brings marketplace records into that connected financial workflow.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) yang menghubungkan operasional keuangan, akuntansi, operasional bisnis, alur kerja perusahaan, dan kecerdasan dalam satu sistem yang terus terhubung. Revenue Sync membawa catatan marketplace ke alur keuangan tersebut.",
        "From marketplace to ledger.": "Dari marketplace ke buku besar.",
        "Every step stays connected.": "Setiap catatan tetap terhubung.",
        "An order is not the same as a payout. Keep the sale, its adjustments, and its settlement in view.": "Nilai pesanan tidak selalu sama dengan dana yang diterima. Lihat penjualan, penyesuaian, dan pencairannya secara terpisah.",
        "Record the order": "Catat pesanan",
        "Keep the marketplace reference with the sale.": "Simpan referensi marketplace pada catatan penjualan.",
        "Follow the adjustments": "Telusuri penyesuaian",
        "Account for refunds and platform fees.": "Catat pengembalian dana dan biaya platform.",
        "Understand the settlement": "Periksa pencairan dana",
        "See the net amount after those deductions.": "Lihat dana bersih setelah seluruh potongan.",
        "More than a sales total.": "Bukan sekadar total penjualan.",
        "The records behind your revenue.": "Lihat catatan di balik pendapatan.",
        "Give finance teams the context they need to reconcile marketplace activity and understand performance.": "Bantu tim keuangan mencocokkan aktivitas marketplace dan memahami kinerja bisnis dari catatan yang lengkap.",
        "Illustrative revenue trend": "Contoh tren pendapatan",
        "See revenue across your connected stores.": "Lihat pendapatan dari toko yang terhubung.",
        "Bring marketplace records together for financial reporting and revenue analysis.": "Satukan catatan marketplace untuk laporan keuangan dan analisis pendapatan.",
        "Refunds keep their context.": "Pengembalian dana punya catatan asal.",
        "Trace a refund to its source rather than treating it as an unexplained deduction.": "Telusuri pengembalian dana ke sumbernya, bukan sekadar melihat potongan tanpa rincian.",
        "Refunds and fees": "Pengembalian dan biaya",
        "Explain the payout difference.": "Pahami selisih dana yang diterima.",
        "Review the fees and refunds between gross sales and the net settlement.": "Periksa biaya dan pengembalian dana yang membuat pencairan berbeda dari penjualan bruto.",
        "Journal preview": "Pratinjau jurnal",
        "Bank + adjustments · Debit": "Bank + penyesuaian · Debit",
        "Sales · Credit": "Penjualan · Kredit",
        "Revenue belongs in the ledger.": "Pendapatan masuk ke buku besar.",
        "Marketplace source workflows generate balanced journals for accounting and reporting.": "Alur data marketplace menghasilkan jurnal seimbang untuk pembukuan dan laporan.",
        "Start with the stores you run.": "Mulai dari toko yang Anda kelola.",
        "Connect the marketplace accounts your business already uses.": "Hubungkan akun marketplace yang sudah digunakan bisnis Anda.",
        "Marketplace connector": "Konektor marketplace",
        "Bring TikTok Shop orders, refunds, and settlements into your financial records.": "Bawa pesanan, pengembalian dana, dan pencairan TikTok Shop ke catatan keuangan Anda.",
        "Keep Shopee sales and settlement records connected to your accounting workflow.": "Hubungkan catatan penjualan dan pencairan Shopee ke alur pembukuan Anda.",
        "What does Revenue Sync connect?": "Apa yang dihubungkan oleh Revenue Sync?",
        "Revenue Sync brings marketplace orders, refunds, and settlements into the FluxyOS double-entry ledger. TikTok Shop and Shopee are the current marketplace connectors.": "Revenue Sync membawa pesanan, pengembalian dana, dan pencairan dana marketplace ke buku besar berpasangan FluxyOS. Konektor yang tersedia saat ini adalah TikTok Shop dan Shopee.",
        "Which marketplaces are supported?": "Marketplace apa saja yang didukung?",
        "TikTok Shop and Shopee. Connect the relevant marketplace account to start bringing its financial records into FluxyOS.": "TikTok Shop dan Shopee. Hubungkan akun marketplace Anda untuk mulai membawa catatan keuangannya ke FluxyOS.",
        "Why are sales and settlements different?": "Mengapa penjualan berbeda dari pencairan dana?",
        "A sale records the order value. A settlement records the payout after refunds and platform fees. Keeping both records helps explain the amount that reaches your business.": "Penjualan mencatat nilai pesanan. Pencairan dana mencatat pembayaran setelah pengembalian dana dan biaya platform. Dengan keduanya, Anda bisa melihat rincian dana yang diterima bisnis.",
        "How are refunds handled?": "Bagaimana pengembalian dana dicatat?",
        "Refund records stay connected to their source marketplace and order reference, so you can follow the adjustment back to the sale.": "Catatan pengembalian dana tetap terhubung ke marketplace dan referensi pesanan asal. Anda bisa menelusuri penyesuaiannya hingga ke transaksi penjualan.",
        "How quickly does data sync?": "Seberapa cepat data disinkronkan?",
        "Timing depends on when the marketplace makes its records available and the connector sync cycle. Orders and settlements may arrive at different times.": "Waktunya bergantung pada ketersediaan data dari marketplace dan siklus sinkronisasi konektor. Pesanan dan pencairan dana bisa masuk pada waktu yang berbeda.",
        "Does this replace my marketplace dashboard?": "Apakah ini menggantikan dashboard marketplace?",
        "No. Keep using your marketplace for selling and managing orders. Revenue Sync connects its financial records to accounting and reporting in FluxyOS.": "Tidak. Tetap gunakan marketplace untuk berjualan dan mengelola pesanan. Revenue Sync menghubungkan catatan keuangannya ke akuntansi dan laporan di FluxyOS.",
        "Your marketplace revenue. Without the spreadsheet relay.": "Pendapatan marketplace, tanpa bolak-balik spreadsheet.",
        "Connect your stores and bring their financial records into FluxyOS.": "Hubungkan toko Anda dan bawa catatan keuangannya ke FluxyOS.",
        // ERP Intelligence landing page
        "Accounting, reports, and Fluxy AI": "Akuntansi, laporan, dan Fluxy AI",
        "Accounting, from entry to report.": "Dari pencatatan sampai laporan.",
        "One set of books for every financial view.": "Semuanya memakai pembukuan yang sama.",
        "Check the accounts behind each balance.": "Periksa akun dan rincian saldonya.",
        "Review posted transactions, account balances, and the journals behind them.": "Lihat transaksi yang sudah dibukukan, saldo akun, dan jurnal terkait.",
        "Ask about revenue, costs, and cash.": "Tanya soal pendapatan, biaya, dan kas.",
        "Track your business in one view.": "Pantau keuangan dalam satu tampilan.",
        "View journal entry": "Lihat entri jurnal",
        "View expense breakdown": "Lihat rincian kenaikan biaya",
        "Other expenses": "Biaya lainnya",
        "General Ledger": "Buku Besar",
        "Account": "Akun",
        "Debit": "Debit",
        "Credit": "Kredit",
        "Finance data that": "Lihat angkanya.",
        "Your finances, connected.": "Keuangan bisnis dalam satu tempat.",
        "From the first record to the next decision.": "Dari pencatatan hingga pengambilan keputusan.",
        "Accounting, reporting, and Fluxy AI.": "Akuntansi, laporan keuangan, dan Fluxy AI.",
        "Understand the numbers behind your business.": "Lihat perubahan angkanya. Telusuri penyebabnya.",
        "explains itself.": "Tahu sebabnya.",
        "Start free": "Mulai gratis",
        "Business performance": "Kondisi keuangan bisnis",
        "Documents to review": "Dokumen untuk diperiksa",
        "3 documents": "3 dokumen",
        "+12,4% vs prior period": "+12,4% dari periode sebelumnya",
        "Accounting foundation": "Dasar akuntansi",
        "Budget remaining": "Sisa anggaran",
        "Budget tracking illustration": "Ilustrasi pemantauan anggaran",
        "Budgets": "Anggaran",
        "Cash Flow Statement": "Laporan Arus Kas",
        "Cash position": "Posisi kas",
        "FINANCE OVERVIEW": "RINGKASAN KEUANGAN",
        "Finance context": "Konteks keuangan",
        "Finance context active": "Memakai data keuangan Anda",
        "Financial intelligence": "Analisis keuangan",
        "Financial statements": "Laporan keuangan",
        "Financing activities": "Aktivitas pendanaan",
        "Fluxy AI explanation": "Catatan dari Fluxy AI",
        "Investing activities": "Aktivitas investasi",
        "Jan": "Jan",
        "Feb": "Feb",
        "Mar": "Mar",
        "Jan — Mar": "Jan — Mar",
        "January — March 2026": "Januari — Maret 2026",
        "Journals": "Jurnal",
        "Marketing services": "Layanan marketing",
        "Net profit": "Laba bersih",
        "OpEx vs budget": "Biaya operasional vs anggaran",
        "Operating activities": "Aktivitas operasi",
        "Operating expenses": "Biaya operasional",
        "Operational records": "Catatan operasional",
        "Overview": "Ringkasan",
        "Reports": "Laporan",
        "Rp8.430.000 remaining": "Sisa Rp8.430.000",
        "Software & tools": "Software & tools",
        "Software spend rose Rp1.240.000.": "Biaya software naik Rp1.240.000.",
        "Document uploaded": "Dokumen diunggah",
        "Review transaction": "Periksa transaksi",
        "Extracted": "Diekstrak",
        "Ready for review": "Siap diperiksa",
        "Journal entry": "Entri jurnal",
        "Balanced": "Seimbang",
        "Software expense": "Biaya software",
        "Bank account": "Rekening bank",
        "Linked to General Ledger": "Terhubung ke Buku Besar",
        "Budget tracking": "Pemakaian anggaran",
        "78% used": "78% terpakai",
        "Rp38.000.000 budget": "Anggaran Rp38.000.000",
        "March 2026": "Maret 2026",
        "Vendor": "Vendor",
        "ERP Intelligence for Finance Teams | FluxyOS": "ERP Intelligence untuk Tim Keuangan | FluxyOS",
        "What is FluxyOS ERP Intelligence?": "Apa yang bisa dilakukan ERP Intelligence?",
        "As of 31 March 2026": "Per 31 Maret 2026",
        "+12,4% from prior period": "+12,4% dari periode sebelumnya",
        "Cost of sales": "Harga pokok penjualan",
        "Total assets": "Total aset",
        "Total liabilities": "Total liabilitas",
        "Total equity": "Total ekuitas",
        "Operating expenses increased Rp1.240.000 from February.": "Biaya operasional naik Rp1.240.000 dari Februari.",
        "Review next": "Tinjau selanjutnya",
        "Open accounting →": "Buka akuntansi →",
        "Live books": "Pembukuan terbaru",
        "Revenue and expenses": "Pendapatan dan pengeluaran",
        "Ask Fluxy AI": "Tanya Fluxy AI",
        "Accounting automation": "Otomatisasi akuntansi",
        "Capture the source": "Unggah dokumennya",
        "Review extracted data": "Periksa hasilnya",
        "Financial reporting": "Laporan keuangan",
        "Income Statement": "Laporan Laba Rugi",
        "Balance Sheet": "Neraca",
        "Cash Flow": "Arus Kas",
        "Business insights": "Pantau kinerja bisnis",
        "Questions, answered": "Tanya jawab",
        "ERP-class finance depth. Not an ERP replacement.": "Untuk kebutuhan keuangan yang makin kompleks. Bukan pengganti ERP.",
        "Across bank and cash accounts": "Di semua rekening bank dan kas",
        "What changed in expenses this month?": "Kenapa pengeluaran bulan ini naik?",
        "Three renewal transactions explain most of the movement.": "Sebagian besar kenaikan berasal dari tiga transaksi perpanjangan.",
        "See the records behind it": "Buka transaksinya",
        "Fluxy AI in the workflow": "Tanya Fluxy AI",
        "Ask the business behind the number.": "Ada angka yang berubah? Tanyakan sebabnya.",
        "Fluxy AI works with the finance data your team already manages. Ask a direct question, see the measure, and keep the underlying transactions close to the answer.": "Tanya Fluxy AI soal pendapatan, biaya, arus kas, atau anggaran. Jawabannya memakai data keuangan di workspace Anda. Transaksi terkait bisa langsung dibuka untuk diperiksa.",
        "Revenue, expenses, cash movement, and budget questions": "Tanya soal pendapatan, biaya, arus kas, atau anggaran",
        "Finance answers grounded in workspace data": "Jawaban memakai catatan keuangan di workspace Anda",
        "Clear links from a result to the related records": "Buka transaksi yang mendasari jawabannya",
        "Why did operating expenses increase in March?": "Kenapa biaya operasional naik pada Maret?",
        "The largest movement was Software & tools, followed by marketing services.": "Kenaikan terbesar ada pada biaya software, disusul jasa pemasaran.",
        "View 8 related transactions": "Buka 8 transaksi terkait",
        "Ask about your finance data": "Tanya soal keuangan bisnis Anda",
        "Bring the document, transaction, and journal together.": "Dari dokumen ke jurnal, tanpa ketik ulang.",
        "Reduce repetitive work without separating the business event from its accounting record.": "Unggah dokumen, periksa datanya, lalu catat transaksi. Jurnalnya tetap terhubung ke sumber.",
        "Upload a document or bring in a bank statement so the finance workflow starts with the record itself.": "Unggah invoice atau rekening koran. Data awalnya diambil dari dokumen tersebut.",
        "Use assisted extraction and categorization, then review the details before they become part of the books.": "Periksa tanggal, jumlah, vendor, dan kategori yang disarankan sebelum transaksi masuk pembukuan.",
        "Keep the journal connected": "Jurnal tetap terhubung",
        "Source workflows create balanced, traceable journals that carry the context into the General Ledger.": "Jurnal yang terbentuk dari transaksi tetap bisa ditelusuri ke dokumen asal dan Buku Besar.",
        "Open the statement. Keep the story.": "Buka laporan. Telusuri angkanya.",
        "Income Statement, Balance Sheet, and Cash Flow all read from the same accounting foundation.": "Laba Rugi, Neraca, dan Arus Kas berasal dari pembukuan yang sama.",
        "Profit held despite higher software spend.": "Laba tetap terjaga meski biaya software naik.",
        "Revenue increased more than operating expenses over the selected period.": "Pada periode ini, kenaikan pendapatan lebih besar daripada kenaikan biaya operasional.",
        "Ask a follow-up →": "Tanya lebih lanjut →",
        "See the accounts behind each balance.": "Lihat akun di balik setiap saldo.",
        "Move from a summary to the General Ledger when a number needs review.": "Jika ada saldo yang perlu dicek, buka akun terkait di Buku Besar.",
        "Net movement in cash": "Perubahan bersih kas",
        "Understand where cash moved.": "Pahami ke mana kas bergerak.",
        "Review cash movement alongside bills, invoices, bank accounts, and transactions.": "Periksa arus kas bersama tagihan, invoice, rekening bank, dan transaksi terkait.",
        "View cash position →": "Lihat posisi kas →",
        "See performance in time to act on it.": "Pantau angka yang perlu ditindaklanjuti.",
        "Use connected KPIs to monitor money coming in, money going out, and the budget that keeps each decision in context.": "Lihat pendapatan, pengeluaran, dan pemakaian anggaran dalam satu tampilan. Dokumen yang belum diperiksa juga terlihat di sini.",
        "Explore the finance overview": "Buka ringkasan keuangan",
        "Keep spend in context": "Lihat sisa anggaran sebelum menambah biaya",
        "3 documents need a decision": "3 dokumen menunggu pemeriksaan",
        "Review captured documents →": "Periksa dokumen →",
        "One connected finance system": "Satu pembukuan, banyak kegunaan",
        "Every financial view starts from the same records.": "Catat sekali. Gunakan di seluruh laporan.",
        "Transactions, revenue, bills, invoices, bank activity, and documents.": "Transaksi, pendapatan, tagihan, invoice, rekening bank, dan dokumen sumber.",
        "Journal entries, Chart of Accounts, General Ledger, and period-close controls.": "Entri jurnal, daftar akun, Buku Besar, dan proses tutup buku.",
        "Statements, KPIs, reporting, and Fluxy AI answers with finance context.": "Laporan keuangan, KPI, dan jawaban Fluxy AI memakai catatan yang sama.",
        "Built for clarity, not another layer of reporting.": "Hal yang sering ditanyakan.",
        "FluxyOS ERP Intelligence connects accounting, financial reporting, finance operations, and Fluxy AI around the same underlying finance records.": "FluxyOS ERP Intelligence menyatukan akuntansi, laporan keuangan, dan Fluxy AI. Semuanya memakai catatan keuangan yang sama.",
        "Does FluxyOS replace an ERP?": "Apakah FluxyOS menggantikan ERP?",
        "No. FluxyOS is an Intelligent Finance Operating System, not an ERP replacement. It brings ERP-class finance depth and intelligence to the connected finance workflow.": "Tidak. FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) untuk mengelola pekerjaan keuangan dan akuntansi. ERP yang sudah Anda gunakan tidak perlu diganti.",
        "What can Fluxy AI help a team understand?": "Apa yang bisa ditanyakan ke Fluxy AI?",
        "Fluxy AI can help users ask questions about revenue, expenses, cash movement, transactions, budgets, and the records behind a reported number.": "Anda bisa bertanya soal pendapatan, pengeluaran, arus kas, transaksi, dan anggaran. Fluxy AI membantu menunjukkan catatan di balik jawabannya.",
        "Which financial reports are available?": "Laporan apa saja yang tersedia?",
        "FluxyOS includes an Income Statement, Balance Sheet, Cash Flow Statement, trial balance, General Ledger, and supporting finance reports.": "FluxyOS menyediakan Laporan Laba Rugi, Neraca, Laporan Arus Kas, neraca saldo, Buku Besar, dan laporan pendukung lainnya.",
        "Put finance to work": "Pahami angka bisnis.",
        "for the next decision.": "Tentukan langkah berikutnya.",
        "Connect the records. Understand the movement. Keep the business moving.": "Catatan keuangan rapi. Perubahan mudah dilihat. Keputusan jadi lebih terarah.",
        "Illustrated FluxyOS financial overview": "Ilustrasi ringkasan keuangan FluxyOS",
        "Connect orders, payments, and books": "Hubungkan pesanan, pembayaran, dan pembukuan",
        "Pause slideshow": "Jeda tayangan",
        "Play slideshow": "Putar tayangan",
        "Daily breakdown": "Rincian harian",
        "Amounts in Rp thousands \u00b7 Same scale in every view": "Nilai dalam ribuan Rp · Skala sama di setiap tampilan",
        "Weekly gross profit calculation": "Perhitungan laba kotor mingguan",
        "60% gross margin": "Margin kotor 60%",
        "Mon": "Sen",
        "Tue": "Sel",
        "Wed": "Rab",
        "Thu": "Kam",
        "Fri": "Jum",
        "Sat": "Sab",
        "Sun": "Min",
        "14\u201320 Sep 2026": "14\u201320 Sep 2026",

        "2 × Es teh": "2 × Es teh",
        "1 × Mie goreng": "1 × Mie goreng",
        "1 × Kopi susu": "1 × Kopi susu",
        "2 × Nasi ayam": "2 × Nasi ayam",
        "Explore FluxyOS plans →": "Lihat paket FluxyOS →",
        // Real customer QR ordering showcase
        "Open this ordering-app screenshot at full size": "Buka tangkapan layar aplikasi pemesanan ini dalam ukuran penuh",
        "Actual FluxyOS QR ordering app showing the Senopati demo menu and recommended dishes.": "Aplikasi pemesanan QR FluxyOS asli yang menampilkan menu demo Senopati dan rekomendasi hidangan.",
        "Actual FluxyOS QR ordering app showing item options before adding a drink to the order.": "Aplikasi pemesanan QR FluxyOS asli yang menampilkan pilihan item sebelum menambahkan minuman ke pesanan.",
        "Actual FluxyOS QR ordering app showing the order review, item prices, and total before sending.": "Aplikasi pemesanan QR FluxyOS asli yang menampilkan ringkasan pesanan, harga item, dan total sebelum dikirim.",
        "Actual ordering app · Demo menu": "Aplikasi pemesanan asli · Menu demo",
        "Tap the screen to view full size.": "Ketuk layar untuk melihat ukuran penuh.",
        "Explore QR ordering": "Jelajahi pemesanan QR",
        "Browse the menu": "Jelajahi menu",
        "See photos, categories, and prices.": "Lihat foto, kategori, dan harga.",
        "Make it yours": "Sesuaikan pesanan",
        "Choose options and add a note.": "Pilih opsi dan tambahkan catatan.",
        "Review your order": "Periksa pesanan",
        "Check items and totals before sending.": "Periksa item dan total sebelum dikirim.",
        // Point of Sale landing page
        "Every order.": "Setiap pesanan.",
        "Connected to your books.": "Terhubung ke pembukuan Anda.",
        "FluxyOS is an Intelligent Finance Operating System. Its POS intelligence connects your tables, kitchen orders, payments, and books.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System). POS intelligence-nya menghubungkan meja, pesanan dapur, pembayaran, dan pembukuan Anda.",
        "Talk to sales": "Hubungi sales",
        "Explore Point of Sale": "Jelajahi Point of Sale",
        "From order to financial records": "Dari pesanan ke catatan keuangan",
        "Table": "Meja",
        "Table 08 · Dine-in": "Meja 08 · Makan di tempat",
        "2 guests": "2 tamu",
        "Order": "Pesanan",
        "2 × Nasi goreng": "2 × Nasi goreng",
        "Sent to kitchen": "Dikirim ke dapur",
        "Payment": "Pembayaran",
        "Recorded at the till": "Dicatat di kasir",
        "Inventory": "Persediaan",
        "Recipe ingredients": "Bahan dalam resep",
        "Stock movement": "Pergerakan stok",
        "Ledger": "Buku besar",
        "Revenue + cost": "Pendapatan + biaya",
        "Attributed to your outlet": "Dicatat untuk outlet Anda",
        "A connected service, from the first order.": "Layanan terhubung, sejak pesanan pertama.",
        "Illustrative product view": "Ilustrasi tampilan produk",
        "Senopati outlet": "Outlet Senopati",
        "Shift open": "Shift dibuka",
        "Your floor, at a glance.": "Pantau semua meja Anda.",
        "Main floor": "Ruang utama",
        "Available": "Tersedia",
        "Dining": "Sedang makan",
        "Reserved": "Direservasi",
        "Selected": "Dipilih",
        "Current order": "Pesanan saat ini",
        "Table 08": "Meja 08",
        "Dine-in": "Makan di tempat",
        "2 guests · Order #024": "2 tamu · Pesanan #024",
        "Less spicy · No ice": "Tidak terlalu pedas · Tanpa es",
        "Subtotal": "Subtotal",
        "Every ticket has its place.": "Setiap pesanan jelas statusnya.",
        "Kitchen orders": "Pesanan dapur",
        "Preparing": "Sedang disiapkan",
        "Order notes stay with the ticket.": "Catatan tetap terhubung ke pesanan.",
        "Ready": "Siap disajikan",
        "Table 02": "Meja 02",
        "Served": "Sudah disajikan",
        "Table 05": "Meja 05",
        "At checkout": "Saat pembayaran",
        "One table. A clear bill.": "Satu meja. Tagihan yang jelas.",
        "Review the table bill, split by item or share, and record each payment at the till.": "Periksa tagihan meja, bagi per item atau rata, lalu catat setiap pembayaran di kasir.",
        "Cash": "Tunai",
        "Card": "Kartu",
        "Payment methods are recorded manually. Provider processing is not included.": "Metode pembayaran dicatat manual. Pemrosesan oleh penyedia pembayaran belum tersedia.",
        "Table 08 · Order #024": "Meja 08 · Pesanan #024",
        "Payment recorded": "Pembayaran dicatat",
        "Explore the POS": "Jelajahi POS",
        "Table service": "Layanan meja",
        "Payment recording": "Pencatatan pembayaran",
        "FluxyOS is an Intelligent Finance Operating System that connects financial operations, accounting, business operations, enterprise workflows, and intelligence into one continuously connected system.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) yang menghubungkan operasional keuangan, akuntansi, operasional bisnis, alur kerja perusahaan, dan intelligence dalam satu sistem yang terus terhubung.",
        "Built around your service.": "Mengikuti cara Anda melayani.",
        "From a quick coffee to a full table.": "Dari secangkir kopi hingga satu meja penuh.",
        "Dine-in → Table → Order": "Makan di tempat → Meja → Pesanan",
        "Make room for every guest.": "Siapkan meja untuk setiap tamu.",
        "See available tables, keep track of reservations, and open dine-in or takeaway orders from the same till.": "Lihat meja tersedia, pantau reservasi, dan buka pesanan makan di tempat atau bawa pulang dari kasir yang sama.",
        "Less sugar · Extra shot": "Kurangi gula · Extra shot",
        "Take the order their way.": "Catat pesanan sesuai keinginan tamu.",
        "Capture sizes, add-ons, notes, and discounts alongside each order, so the details travel with the ticket.": "Catat ukuran, tambahan, catatan, dan diskon pada setiap pesanan agar detailnya ikut sampai ke dapur.",
        "Keep checkout clear.": "Selesaikan pembayaran dengan jelas.",
        "Bring table orders into one bill, split payments, and print a receipt with the details your guest needs.": "Satukan pesanan meja dalam satu tagihan, bagi pembayaran, dan cetak struk dengan detail yang dibutuhkan tamu.",
        "Expected cash = Counted cash + Difference": "Kas seharusnya = Kas terhitung + Selisih",
        "Close the shift with confidence.": "Tutup shift dengan yakin.",
        "Count the drawer against expected cash. Keep cash movements and any difference visible at shift close.": "Cocokkan uang di laci dengan kas yang seharusnya. Lihat pergerakan kas dan selisih saat menutup shift.",
        "A little less waiting.": "Kurangi waktu menunggu.",
        "A closer connection to your guests.": "Lebih dekat dengan tamu Anda.",
        "Let guests scan the table QR, browse your menu, and send an order from their phone. Your team sees it in the same service workflow.": "Tamu cukup scan QR meja, lihat menu, dan kirim pesanan dari ponsel. Tim Anda menerima pesanan dalam alur layanan yang sama.",
        "QR ordering": "Pemesanan QR",
        "Their phone. Your menu.": "Ponsel tamu. Menu Anda.",
        "Menu photos, item options, and order status help guests order with less back-and-forth.": "Foto menu, pilihan item, dan status pesanan membantu tamu memesan dengan lebih mudah.",
        "Scan the table QR": "Scan QR meja",
        "Choose dishes and options": "Pilih menu dan opsi",
        "Send the order to your team": "Kirim pesanan ke tim Anda",
        "Made fresh.": "Dibuat segar.",
        "Served with care.": "Disajikan sepenuh hati.",
        "Your favourites": "Menu favorit Anda",
        "Your order · 4 items": "Pesanan Anda · 4 item",
        "Order received": "Pesanan diterima",
        "Table 08 · Sent to kitchen": "Meja 08 · Dikirim ke dapur",
        "The sale is only the beginning.": "Penjualan baru permulaan.",
        "Keep the financial story connected.": "Hubungkan seluruh cerita keuangannya.",
        "From the till to the ledger": "Dari kasir ke buku besar",
        "Every dish has a cost. Make it count.": "Setiap hidangan punya biaya. Catat dengan tepat.",
        "Configured recipes connect sold dishes to ingredient stock and cost of goods sold. POS sales feed the same accounting foundation as the rest of your business.": "Resep yang sudah diatur menghubungkan hidangan terjual dengan stok bahan dan harga pokok penjualan. Penjualan POS masuk ke fondasi akuntansi yang sama dengan bisnis Anda.",
        "Revenue and costs carry the outlet, so you can follow the result through to your outlet profit and loss.": "Pendapatan dan biaya menyertakan outlet, sehingga Anda bisa menelusuri hasilnya hingga laporan laba rugi outlet.",
        "Recipe": "Resep",
        "Rice": "Nasi",
        "Egg": "Telur",
        "1 piece": "1 butir",
        "Seasoning": "Bumbu",
        "Cost of goods sold": "Harga pokok penjualan",
        "Linked by the sale. Recorded for the outlet.": "Terhubung lewat penjualan. Dicatat untuk outlet.",
        "From service to a clearer picture.": "Dari layanan ke gambaran yang lebih jelas.",
        "Read revenue, cost, and gross profit together. The same sale tells the same story across your financial reports.": "Baca pendapatan, biaya, dan laba kotor bersama. Penjualan yang sama menghasilkan catatan yang selaras di laporan keuangan Anda.",
        "Financial views": "Tampilan keuangan",
        "Revenue": "Pendapatan",
        "Gross profit": "Laba kotor",
        "Senopati outlet · Example week": "Outlet Senopati · Contoh mingguan",
        "Sales posted to the selected outlet.": "Penjualan yang dibukukan untuk outlet terpilih.",
        "Illustrative data": "Data ilustrasi",
        "Revenue illustration; values are sample data.": "Ilustrasi pendapatan; menggunakan data contoh.",
        "Ingredient costs from configured recipes and stock movements.": "Biaya bahan dari resep yang sudah diatur dan pergerakan stok.",
        "Cost of goods sold illustration; values are sample data.": "Ilustrasi harga pokok penjualan; menggunakan data contoh.",
        "Revenue less cost of goods sold, before operating expenses.": "Pendapatan dikurangi harga pokok penjualan, sebelum biaya operasional.",
        "Gross profit illustration; values are sample data.": "Ilustrasi laba kotor; menggunakan data contoh.",
        "A few things worth knowing.": "Beberapa hal yang perlu Anda tahu.",
        "What is FluxyOS Point of Sale?": "Apa itu FluxyOS Point of Sale?",
        "What is POS intelligence?": "Apa itu POS intelligence?",
        "POS intelligence connects orders, payments, and configured item costs to your financial records so your team can review sales and cost information in context. FluxyOS Point of Sale records the operational activity; your accounting records remain the source of truth.": "POS intelligence menghubungkan pesanan, pembayaran, dan biaya item yang sudah diatur ke catatan keuangan Anda, sehingga tim dapat meninjau informasi penjualan dan biaya dalam konteksnya. FluxyOS Point of Sale mencatat aktivitas operasional; catatan akuntansi Anda tetap menjadi sumber kebenaran.",
        "FluxyOS POS intelligence connects table orders, QR menus, kitchen service, and recorded payments to inventory and accounting.": "POS intelligence FluxyOS menghubungkan pesanan meja, menu QR, layanan dapur, dan catatan pembayaran ke persediaan serta akuntansi.",
        "Point of Sale is the FluxyOS workspace for taking orders, managing table service, and recording payments. Sales connect to accounting and, with configured items and recipes, inventory and cost of goods sold.": "Point of Sale adalah ruang kerja FluxyOS untuk menerima pesanan, mengelola layanan meja, dan mencatat pembayaran. Penjualan terhubung ke akuntansi serta, dengan item dan resep yang sudah diatur, persediaan dan harga pokok penjualan.",
        "Can guests order from a table QR?": "Apakah tamu bisa memesan lewat QR meja?",
        "Yes. Guests scan the table QR to open the menu, choose items and options, submit an order, and follow its status. Orders enter the outlet’s service workflow.": "Ya. Tamu scan QR meja untuk membuka menu, memilih item dan opsi, mengirim pesanan, serta memantau statusnya. Pesanan masuk ke alur layanan outlet.",
        "Does the POS process card or QRIS payments?": "Apakah POS memproses pembayaran kartu atau QRIS?",
        "Staff can record cash, card, and QRIS payments at the till. Integrated payment-provider processing is not available yet; your team confirms payment through its existing payment service.": "Staf bisa mencatat pembayaran tunai, kartu, dan QRIS di kasir. Pemrosesan terintegrasi dengan penyedia pembayaran belum tersedia; tim Anda mengonfirmasi pembayaran melalui layanan pembayaran yang digunakan.",
        "Does it work without an internet connection?": "Apakah POS bisa digunakan tanpa koneksi internet?",
        "An internet connection is required. Offline order taking and queued offline payments are not supported.": "Koneksi internet diperlukan. Penerimaan pesanan dan antrean pembayaran saat offline belum didukung.",
        "How can I get access?": "Bagaimana cara mendapatkan akses?",
        "Talk to our team about your outlet and service workflow. Point of Sale access is enabled for eligible workspaces, and we can help you review the setup for your business.": "Hubungi tim kami untuk membahas outlet dan alur layanan Anda. Akses Point of Sale diaktifkan untuk workspace yang memenuhi syarat, dan kami dapat membantu meninjau pengaturan untuk bisnis Anda.",
        "Great service.": "Layanan yang baik.",
        "A connected business.": "Bisnis yang terhubung.",
        "Bring your next order into the bigger picture.": "Jadikan pesanan berikutnya bagian dari gambaran bisnis Anda.",
        "Explore FluxyOS plans": "Lihat paket FluxyOS",
        "Point of Sale for Restaurants & Cafés | FluxyOS": "Point of Sale untuk Restoran & Kafe | FluxyOS",
        "Connect table orders, QR menus, kitchen service, and recorded payments to inventory and accounting with FluxyOS Point of Sale.": "Hubungkan pesanan meja, menu QR, layanan dapur, dan catatan pembayaran dengan persediaan serta akuntansi melalui FluxyOS Point of Sale.",
        "Skip to content": "Langsung ke konten",

        // ── Page titles ──────────────────────────────────────────────────────
        "FluxyOS | Intelligent Finance Operating System": "FluxyOS | Sistem Operasi Keuangan Cerdas",
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
        "Multi-Currency": "Siap Global",
        "Invoice in IDR, USD, and SGD": "Invoice dalam IDR, USD, dan SGD",
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
        "The Intelligent Finance Operating System for businesses at every stage.": "Sistem Operasi Keuangan Cerdas untuk bisnis di setiap tahap pertumbuhan.",
        "Connect your sales channels, digital ad platforms, and vendor invoices into one Intelligent Finance Operating System. Stop piecing together spreadsheets and start scaling with crystal-clear visibility.":
            "Hubungkan saluran penjualan, platform iklan digital, dan invoice vendor dalam satu Sistem Operasi Keuangan. Berhenti merangkai spreadsheet — mulai scale-up dengan visibilitas penuh.",
        "Track live operational costs against daily revenue.": "Pantau biaya operasional live terhadap pendapatan harian.",
        "Automate manual receipt matching and reconciliation.": "Otomatiskan pencocokan struk dan rekonsiliasi.",
        "Control your operations today.": "Kendalikan operasi bisnis Anda hari ini.",
        "Stop waiting for month-end reports. Get a live, unified view of your client revenue, budgets, and operational expenses.":
            "Berhenti menunggu laporan akhir bulan. Dapatkan pandangan live yang terpadu atas pendapatan klien, budget, dan biaya operasional.",
        "currencies supported for automated vendor reconciliation": "mata uang didukung untuk rekonsiliasi vendor otomatis",
        "operational spend processed and categorized annually": "biaya operasional diproses dan dikategorikan setiap tahun",
        "countries from which you can track localized expenses": "negara untuk pantau biaya lokal",

        // ── Homepage / feature labels + bare review bodies (JSON-LD) ────────
        "I used to only find out whether we made money at the end of the month, and even then only after the receipts were collected. Now ingredient purchases and sales land in one place, so I can see where we stand that same day.":
            "Dulu saya baru tahu untung atau rugi pas akhir bulan, itu pun setelah nota-nota dikumpulin dulu. Sekarang belanja bahan dan penjualan masuk ke satu tempat, jadi saya bisa lihat posisinya hari itu juga.",
        "Bank reconciliation used to be the longest part of every close. Now the transactions are already matched and I only review the exceptions. The journals are clean and I can defend them.":
            "Rekonsiliasi rekening koran dulu makan waktu paling lama tiap tutup buku. Sekarang transaksinya sudah kepasang duluan, saya tinggal cek yang tidak cocok. Jurnalnya rapi dan bisa saya pertanggungjawabkan.",
        "Running several outlets means the numbers get buried into one total. What I needed was to see which outlet is working and which isn't, without asking my team for a manual report.":
            "Punya beberapa outlet artinya angkanya gampang ketimbun jadi satu. Yang saya butuh itu lihat per outlet mana yang jalan dan mana yang nggak, tanpa harus minta laporan manual ke tim.",
        "Indonesian books, ready for when you sell abroad":
            "Pembukuan Indonesia, siap saat Anda jualan ke luar",
        "Your ledger stays in Rupiah and stays SAK-aligned, so your accountant can defend it at close. Selling or paying across the border doesn't break that: foreign-currency invoices convert at the live rate on the day they're paid, and the journal behind them posts in IDR like everything else.":
            "Buku besar Anda tetap dalam Rupiah dan tetap mengikuti SAK, jadi akuntan Anda bisa mempertanggungjawabkannya saat tutup buku. Transaksi lintas negara tidak merusak itu: invoice mata uang asing dikonversi dengan kurs live di hari pembayaran, dan jurnal di baliknya tetap diposting dalam IDR.",
        "invoice currencies, stored as minor units so rounding never drifts":
            "mata uang invoice, disimpan sebagai satuan terkecil supaya pembulatan tidak melenceng",
        "Live FX":
            "Kurs live",
        "foreign invoices convert to IDR at the rate on the payment date":
            "invoice mata uang asing dikonversi ke IDR dengan kurs di tanggal pembayaran",
        "statement import and reconciliation for Indonesian banks":
            "import rekening koran dan rekonsiliasi untuk bank Indonesia",
        "SAK-aligned":
            "Sesuai SAK",
        "chart of accounts, trial balance, and period close out of the box":
            "chart of accounts, neraca saldo, dan tutup buku sejak awal",
        "Live connectors":
            "Konektor aktif",
        "Orders, refunds, settlements":
            "Pesanan, refund, settlement",
        "Synced to your ledger":
            "Masuk ke buku besar Anda",
        "3 ways":
            "3 cara",
        "to send a receipt":
            "kirim struk",
        "Reads photos and PDFs":
            "Baca foto dan PDF",
        "Per outlet":
            "Per outlet",
        "Moka POS Outlet A":
            "Moka POS Outlet A",

        // ── Pricing page — customer reviews ─────────────────────────────────
        // Real named customers (published 2026-08-12). The quotes are their own
        // words; the Bahasa side is the original and the English is the
        // translation. Both live here so build-id-mirrors.js cannot regenerate
        // the mirror in English again.
        "What finance teams say": "Kata tim keuangan",
        "Every quote below is from a named customer who agreed to be published.":
            "Semua kutipan di bawah berasal dari pelanggan bernama yang sudah setuju dipublikasikan.",
        "\"I used to only find out whether we made money at the end of the month, and even then only after the receipts were collected. Now ingredient purchases and sales land in one place, so I can see where we stand that same day.\"":
            "\"Dulu saya baru tahu untung atau rugi pas akhir bulan, itu pun setelah nota-nota dikumpulin dulu. Sekarang belanja bahan dan penjualan masuk ke satu tempat, jadi saya bisa lihat posisinya hari itu juga.\"",
        "\"Bank reconciliation used to be the longest part of every close. Now the transactions are already matched and I only review the exceptions. The journals are clean and I can defend them.\"":
            "\"Rekonsiliasi rekening koran dulu makan waktu paling lama tiap tutup buku. Sekarang transaksinya sudah kepasang duluan, saya tinggal cek yang tidak cocok. Jurnalnya rapi dan bisa saya pertanggungjawabkan.\"",
        "\"Running several outlets means the numbers get buried into one total. What I needed was to see which outlet is working and which isn\'t, without asking my team for a manual report.\"":
            "\"Punya beberapa outlet artinya angkanya gampang ketimbun jadi satu. Yang saya butuh itu lihat per outlet mana yang jalan dan mana yang nggak, tanpa harus minta laporan manual ke tim.\"",
        "Owner, Bakkery Bread": "Owner, Bakkery Bread",
        "Accounting, Kelapa Merdeka": "Accounting, Kelapa Merdeka",
        "CEO, Pujasera Group": "CEO, Pujasera Group",

        // ── Revenue Sync page ───────────────────────────────────────────────
        "Sync revenue from every channel, instantly": "Sinkronkan pendapatan dari semua saluran, instan",
        "Connect TikTok Shop and Shopee. Orders, refunds, and settlements post straight to your double-entry ledger, so marketplace revenue reconciles itself.":
            "Hubungkan TikTok Shop dan Shopee. Pesanan, refund, dan settlement langsung masuk ke buku besar double-entry Anda, jadi omzet marketplace rekonsiliasi sendiri.",
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
        "Low-confidence fields are flagged for a quick human review. No silent mistakes in your books.":
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
        "All six together take the repetitive work off your team.": "Keenamnya mengambil alih pekerjaan berulang dari tim Anda.",
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
        "Yes. FluxyOS imports statements from BCA, Mandiri, BNI, BRI, and other Indonesian banks for reconciliation. If you also pay international vendors, invoices support IDR, USD, and SGD, and a foreign-currency invoice is converted at the live rate when it is paid.":
            "Ya. FluxyOS mengimpor rekening koran dari BCA, Mandiri, BNI, BRI, dan bank Indonesia lain untuk rekonsiliasi. Kalau Anda juga bayar vendor luar negeri, invoice mendukung IDR, USD, dan SGD, dan invoice mata uang asing dikonversi dengan kurs live saat dibayar.",
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
        "The AI learns your chart of accounts from the corrections you make, so its suggestions sharpen over the first weeks of use. Anything it isn't confident about is flagged for review instead of posted, so silent mistakes don't end up in your books.":
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
        "Every extracted field — vendor name, amount, date — carries its own confidence score. Anything the model is unsure about is flagged for a quick human review instead of posted, so silent mistakes never reach your books.":
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
        "FluxyOS — Intelligent Finance Operating System": "FluxyOS — Sistem Operasi Keuangan Cerdas",
        "Run your entire finance": "Jalankan seluruh operasional",
        "operation": "keuangan Anda",
        "in one place": "di satu tempat",
        "Track revenue, control expenses, manage bills, and ask Fluxy AI what needs attention before month-end.": "Pantau pendapatan, kendalikan pengeluaran, kelola tagihan, dan tanya Fluxy AI apa yang perlu diperhatikan sebelum tutup bulan.",
        "FluxyOS is an Intelligent Finance Operating System that connects financial operations, accounting, business operations, and intelligence into one continuously connected system.": "FluxyOS adalah Sistem Operasi Keuangan Cerdas (Intelligent Finance Operating System) yang menghubungkan operasional keuangan, akuntansi, operasional bisnis, dan intelligence dalam satu sistem yang terus terhubung.",
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
        "ERP Intelligence": "ERP Intelligence",
        "What is ERP intelligence?": "Apa itu ERP intelligence?",
        "ERP intelligence connects clean, categorized finance records from FluxyOS to an existing ERP, so teams can keep their established ERP while improving the operational context and quality of data that reaches it. FluxyOS does not replace your ERP.": "ERP intelligence menghubungkan catatan keuangan dari FluxyOS yang rapi dan terkategori ke ERP yang sudah digunakan, sehingga tim tetap memakai ERP yang ada sambil meningkatkan konteks operasional dan kualitas data yang masuk. FluxyOS tidak menggantikan ERP Anda.",
        "ERP intelligence keeps FluxyOS as your modern operation layer while pushing clean, categorized journal entries to your existing ERP.": "ERP Intelligence menjaga FluxyOS sebagai lapisan operasional modern sambil mengirim entri jurnal yang rapi dan terkategori ke ERP yang sudah Anda gunakan.",
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
        "FluxyOS is built for businesses at every growth stage, including owners, founders, operators, CFOs, finance managers, and teams managing multiple channels, vendors, projects, or entities. Indonesia is our home market.": "FluxyOS dibuat untuk bisnis di setiap tahap pertumbuhan, termasuk pemilik, founder, operator, CFO, manajer keuangan, dan tim yang mengelola banyak kanal, vendor, proyek, atau entitas.",
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
        "FluxyOS Pricing — Plans for Every Growth Stage": "Harga FluxyOS — Paket untuk Setiap Tahap Bisnis",
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
        "Vendor Spend Management for Indonesian Businesses | FluxyOS": "Manajemen Vendor Spend untuk Bisnis Indonesia | FluxyOS",
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
        "Revenue Sync — TikTok Shop & Shopee in Your Ledger | FluxyOS": "Revenue Sync — Hubungkan Stripe, Tokopedia, Shopify | FluxyOS",
        "What is Revenue Sync?": "Apa itu Revenue Sync?",
        "Revenue Sync is a FluxyOS feature that connects sales channels, payment processors, POS systems, and marketplaces into one live ledger. It gives Indonesian businesses a real-time view of revenue without waiting for manual CSV exports or end-of-month reconciliation.": "Revenue Sync adalah fitur FluxyOS yang menghubungkan kanal penjualan, pemroses pembayaran, sistem POS, dan marketplace ke satu buku besar live. Bisnis Indonesia bisa melihat pendapatan real-time tanpa menunggu ekspor CSV manual atau rekonsiliasi akhir bulan.",
        "Which platforms does Revenue Sync connect to?": "Platform apa saja yang terhubung dengan Revenue Sync?",
        "Revenue Sync brings marketplace orders, refunds, and settlements into your double-entry ledger. Marketplace connectors are rolling out — TikTok Shop and Shopee first — on a connector pattern built so further platforms are additive. Bank activity comes in through statement import today.": "Revenue Sync memasukkan order, refund, dan settlement marketplace ke buku besar double-entry Anda. Konektor marketplace sedang bertahap dirilis — TikTok Shop dan Shopee lebih dulu — dengan pola konektor yang dirancang supaya platform berikutnya tinggal ditambahkan. Aktivitas bank masuk lewat import rekening koran.",
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
        "Marketplace & bank sources": "Sumber marketplace & bank",
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
        "Budgets that move": "Anggaran yang mengikuti",
        "as fast as you scale.": "perkembangan bisnis Anda.",
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
        "How does Dynamic Budgeting help Indonesian businesses?": "Bagaimana Dynamic Budgeting membantu bisnis Indonesia?",
        "Dynamic Budgeting helps Indonesian businesses control spending by connecting budgets to live vendor, receipt, and ledger data. Owners can see when marketing, operations, SaaS, or project budgets are moving off plan before month end.": "Dynamic Budgeting membantu bisnis Indonesia mengendalikan pengeluaran dengan menghubungkan anggaran ke data vendor, struk, dan buku besar yang live. Pemilik bisa melihat kapan anggaran marketing, operasional, SaaS, atau proyek mulai keluar jalur sebelum akhir bulan.",
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
        "The Intelligent Finance Operating System. Unify budgets, operational expenses, and revenue for businesses at every growth stage.": "Sistem Operasi Keuangan Cerdas. Satukan anggaran, biaya operasional, dan pendapatan untuk bisnis di setiap tahap pertumbuhan.",
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

    // Static /id/ mirror pages are already Indonesian: never client-translate
    // them, lock the switcher UI to ID, and let the English row NAVIGATE back
    // to the root page (storing the choice first, so the root page doesn't
    // immediately re-translate itself from an old stored 'id').
    function isMirrorPage() {
        return window.location.pathname.indexOf('/id/') === 0;
    }

    function setupClickHandlers() {
        var links = document.querySelectorAll('a');
        links.forEach(function (a) {
            var t = a.textContent.trim();
            if (t.indexOf('English (EN)') === 0) {
                a.addEventListener('click', function (e) {
                    if (isMirrorPage()) {
                        // Follow the link to the root page; persist the choice.
                        try { localStorage.setItem(STORAGE_KEY, 'en'); } catch (err) {}
                        return;
                    }
                    e.preventDefault();
                    if (getLang() !== 'en') setLang('en');
                });
            } else if (t.indexOf('Bahasa (ID)') === 0) {
                a.addEventListener('click', function (e) {
                    if (isMirrorPage()) {
                        e.preventDefault(); // already on the Bahasa page
                        try { localStorage.setItem(STORAGE_KEY, 'id'); } catch (err) {}
                        return;
                    }
                    e.preventDefault();
                    if (getLang() !== 'id') setLang('id');
                });
            }
        });
    }

    function init() {
        if (isMirrorPage()) {
            updateSwitcherUI('id');
            setupClickHandlers();
            return;
        }
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
        if (hasNewNodes && isMirrorPage()) {
            // Mirror pages are statically Indonesian; just wire any late links.
            setupClickHandlers();
            return;
        }
        if (hasNewNodes && getLang() === 'id') {
            translatePage();
            setupClickHandlers();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
