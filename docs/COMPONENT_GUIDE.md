# FluxyOS Component Guide

Step-by-step recipes for the most common extension tasks.
Follow these exactly to keep new code consistent with the existing architecture.
For the system boundaries behind these recipes, read `SYSTEM_DESIGN.md` first.

---

## Recipe 1: Add a New Dashboard App Page

**Example:** Adding a "Reports" page at `/reports`

### Step 1 — Create the HTML file
Copy the structure from `bill.html` (simplest existing page). Must include:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link rel="icon" href="assets/images/favicon.svg" type="image/svg+xml">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FluxyOS | Reports</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/shared-dashboard.css">
</head>
<body class="bg-gray-50 font-[Inter]">

    <!-- Auth guard -->
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
        const app = initializeApp({ apiKey: "AIzaSyCaJqmpEMulLdMvRT7mYf2K-XDw46-dT7A", authDomain: "fluxyos.firebaseapp.com", projectId: "fluxyos", storageBucket: "fluxyos.firebasestorage.app", messagingSenderId: "1084252368929", appId: "1:1084252368929:web:da73dc0db83fe592c7f360" });
        const auth = getAuth(app);
        let redirectTimer = setTimeout(() => window.location.href = '/login', 2000);
        onAuthStateChanged(auth, user => {
            if (user) { clearTimeout(redirectTimer); loadReports(user); }
            else window.location.href = '/login';
        });
    </script>

    <div class="flex h-screen overflow-hidden">
        <!-- Sidebar (injected by sidebar-loader.js) -->
        <div id="sidebar"></div>

        <!-- Main content -->
        <div class="flex-1 flex flex-col overflow-hidden">
            <!-- Header -->
            <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h1 class="text-[18px] font-bold text-gray-900">Reports</h1>
            </header>

            <!-- Page content -->
            <main class="flex-1 overflow-y-auto p-6">
                <!-- Your page content here -->
            </main>
        </div>
    </div>

    <script src="assets/js/sidebar-loader.js"></script>
    <script src="assets/js/shared-dashboard.js"></script>
</body>
</html>
```

### Step 2 — Add to sidebar navigation
In `assets/js/sidebar-loader.js`, add a new nav item in the `sidebarHTML` string:

```javascript
// Add after the last nav item in the Platform section:
<a id="nav-reports" href="/reports" class="nav-item ...">
    <svg><!-- icon --></svg>
    <span class="sidebar-hide">Reports</span>
</a>
```

### Step 3 — Add to the QA Cross-Page Regression table
In `QA_CHECKLIST.md`, add a row to Section 3:
```
| `reports.html` | Table/content renders, sidebar, auth guard |
```

### Step 4 — Update ROADMAP.md
Mark the feature as ✅ Shipped.

### Step 5 — Update CHANGELOG.md
Add an entry under today's date.

---

## Recipe 2: Add a New Firestore Data Type

**Example:** Adding a "Receipts" collection

### Step 1 — Define the schema
Add to `PROJECT_BACKGROUND.md` under Section 4:

```
### 4d. Receipts — `users/{userId}/receipts`
| Field | Type | Notes |
|-------|------|-------|
| `amount` | number | Raw integer, no formatting |
| `vendor_name` | string | |
| `file_url` | string | Firebase Storage URL |
| `timestamp` | Firestore Timestamp | serverTimestamp() |
```

### Step 2 — Add methods to `assets/js/db-service.js`

```javascript
async addReceipt(userId, data) {
    const col = collection(this.db, 'users', userId, 'receipts');
    return await addDoc(col, { ...data, timestamp: serverTimestamp() });
}

async getReceipts(userId, limitCount = 50) {
    const col = collection(this.db, 'users', userId, 'receipts');
    const q = query(col, orderBy('timestamp', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
```

### Step 3 — Add modal context (if using the shared modal)
In `assets/js/shared-dashboard.js`, add a new context case in the submit handler:

```javascript
} else if (options.context === 'receipt') {
    await ds.addReceipt(user.uid, data);
    window.showToast('Receipt successfully uploaded!', 'success');
    if (typeof loadReceipts === 'function') loadReceipts();
}
```

### Step 4 — Add a trigger button on the page
```javascript
window.showAddTransactionModal({
    title: 'Upload Receipt',
    submitLabel: 'Save Receipt',
    defaultCategory: 'Operations',
    context: 'receipt'
});
```

---

## Recipe 3: Implement a Stub Button

**Example:** Making the "Export CSV" button on `bill.html` work

### Step 1 — Find the button in the HTML
```html
<!-- bill.html -->
<button class="...">Export CSV</button>
```

### Step 2 — Add an id and onclick
```html
<button id="export-csv-btn" onclick="exportBillsCSV()" class="...">Export CSV</button>
```

### Step 3 — Write the handler in the page's script block (or a new JS file)
```javascript
async function exportBillsCSV() {
    const user = auth.currentUser;
    if (!user) return;
    const bills = await ds.getBills(user.uid);

    const rows = [['Vendor', 'Amount', 'Due Date', 'Status']];
    bills.forEach(b => {
        rows.push([
            b.vendor_name,
            b.amount,
            b.due_date ? b.due_date.toDate().toLocaleDateString() : '',
            b.status
        ]);
    });

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluxyos-bills.csv';
    a.click();
    URL.revokeObjectURL(url);
}
```

### Step 4 — QA
Run Section E (modal/data) and Section F3 (data display) from `QA_CHECKLIST.md`.

### Step 5 — Update ROADMAP.md
Change the stub from 🔧 to ✅.

---

## Recipe 4: Add a New Landing Page Section

**Example:** Adding a "Testimonials" section to `fluxyos.html`

### Step 1 — Find the correct insertion point
Sections in `fluxyos.html` are numbered in comments (e.g. `<!-- 1. Navigation -->`, `<!-- 2. Hero -->`). Insert your section between the relevant numbered blocks.

### Step 2 — Use the standard section wrapper
```html
<!-- X. Testimonials -->
<section class="py-24 px-6 bg-white" data-animate="section">
    <div class="max-w-[1280px] mx-auto">
        <h2 class="text-[36px] font-bold text-gray-900 tracking-tight mb-4">
            Trusted by finance teams
        </h2>
        <!-- content -->
    </div>
</section>
```

### Step 3 — Add scroll-reveal if needed
Add `class="scroll-reveal"` to any element you want to animate in on scroll. `fluxyos.js` handles this automatically via `IntersectionObserver`.

### Step 4 — QA
Run Section A (Landing Page) from `QA_CHECKLIST.md`. Test at 375px, 768px, 1280px.

---

## Recipe 5: Add a Toast Notification

Use the global `showToast` function anywhere on dashboard pages:

```javascript
window.showToast('Your message here', 'success');  // green
window.showToast('Something went wrong', 'error');  // red
window.showToast('FYI: something happened', 'info'); // blue
```

- Auto-dismisses after 4 seconds
- Do NOT create custom toast UI — always use this function
- `shared-dashboard.js` must be loaded on the page

---

## Recipe 6: Add a New Nav Link to the Marketing Header

The marketing nav is in `fluxyos.html` (desktop nav + mobile menu). Both must be updated together.
Many landing pages contain copied versions of this nav. When adding a new page or use case, update every copied desktop mega-menu entry and every mobile menu entry in the affected EN/ID pages. Do not leave a visible, live entry with `href="#"`.

### Desktop nav — find and add after existing links:
```html
<!-- In the desktop <nav> links area -->
<a href="/new-page" class="text-[14px] font-medium text-gray-700 hover:text-gray-900 transition-colors">
    New Page
</a>
```

### Mobile menu — find `id="mobile-menu"` and add:
```html
<a href="/new-page" class="block px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
    New Page
</a>
```

### Required entry-point check
After adding or changing a marketing nav item:
1. Search for the visible label across all `.html` files.
2. Confirm every desktop mega-menu copy and mobile menu copy points to the real route.
3. Check localized pages use the localized route, e.g. `/id/use-cases/...`.
4. Run a browser check that clicks or reads the desktop and mobile nav hrefs.

---

## Common Mistakes to Avoid

| Mistake | Correct Approach |
|---------|-----------------|
| Storing formatted amount (`"1.234.567"`) in Firestore | Strip dots first: `parseFloat(value.replace(/\./g, ''))` |
| Using `new Date()` for Firestore timestamp | Always use `serverTimestamp()` from Firebase |
| Renaming any HTML element ID that JS references | Check `PROJECT_BACKGROUND.md` Section 7 before renaming |
| Adding a visible nav/use-case entry that still points to `#` | Search every copied nav block and verify the desktop and mobile hrefs load the intended route |
| Adding footer to a dashboard app page | Footer auto-skips `/dashboard`, `/bill`, `/subscription` — don't add it manually |
| Creating a new modal from scratch for data entry | Use `window.showAddTransactionModal()` with a custom context instead |
| Using `document.addEventListener('DOMContentLoaded', fn)` | Use `readyState` guard pattern (see `fluxyos.js`) |
| Pushing before QA passes | Run `QA_CHECKLIST.md` Smoke Tests first — always |

---

## Recipe 7: Add Amplitude-Style Hover to a Bar Chart

Every new bar/column chart MUST use the shared `window.attachChartHover` helper. See [DESIGN_SYSTEM.md §4 Charts](DESIGN_SYSTEM.md) for the contract.

### Step 1 — Render bars with data attributes

Mark every bar element with `data-chart-bar` and any data the tooltip needs as `data-*` attributes.

```js
container.innerHTML = items.map(item => `
    <div data-chart-bar data-label="${item.label}" data-value="${item.value}" class="...">
        <div class="bg-[#EA580C] ..." style="height: ${pct}%"></div>
    </div>
`).join('');
```

### Step 2 — Attach the shared helper after every render

```js
window.attachChartHover(container, {
    bars: '[data-chart-bar]',
    orientation: 'vertical',           // 'vertical' | 'horizontal' (no crosshair when horizontal)
    buildTooltip: (barEl) => `
        <div class="chart-tooltip-header">${barEl.dataset.label}</div>
        <div class="chart-tooltip-row">
            <span class="chart-tooltip-swatch" style="background:#EA580C"></span>
            <span class="chart-tooltip-label">Revenue</span>
            <span class="chart-tooltip-value">${formatCurrencyIDR(barEl.dataset.value)}</span>
        </div>
    `
});
```

The helper is idempotent — safe to call after every re-render.

### Step 3 — Do NOT

- Do not use the native `title` attribute on bars.
- Do not use Tailwind `group-hover` tooltip spans inside bars.
- Do not write page-local mousemove or positioning code.
- Do not invent new tooltip colors or shapes — use the shared `.chart-tooltip*` classes from `shared-dashboard.css`.
- Do not work around the helper's clamp-to-top behavior with custom flip-below logic. The tooltip never flips below a bar because axes/captions/footers live there. If the tooltip overlaps a tall bar's top, give the chart more headroom (taller container or shorter bars row) instead of fighting the helper.

### Step 4 — QA

Hover several bars, including the leftmost and rightmost. The tooltip flips so it never clips the chart container. The crosshair follows. The active bar brightens. Moving off the chart hides everything.

Reference implementations: Revenue Sync Volume in `revenue-sync.html`, Ledger Volume in `ledger.html`.
