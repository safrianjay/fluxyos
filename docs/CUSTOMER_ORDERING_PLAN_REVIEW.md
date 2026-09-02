---
status: review
reviews: FLUXYOS_CUSTOMER_ORDERING_PLAN.md
updated: 2026-09-02
---

# Customer Ordering plan — fit review

The plan is sound in its **product** shape and wrong in several **architectural**
details, because it was written against a description of FluxyOS rather than
against the code. This lists only where it disagrees with what is actually
built. Everything not mentioned here fits.

The corrections are ordered by what they cost to discover later.

---

## 1. Corrections that would cause real damage

### 1.1 Data is WORKSPACE-scoped, not user-scoped

> §27: *"user-owned data must remain under the authenticated user's scope"*

Wrong, and it is the single most-guarded invariant in this codebase. Every
finance and operational collection lives under `workspaces/{workspaceId}/…` and
is shared across team members. Writing `users/{uid}/pos_orders` compiles, runs,
and silently shows invited staff **zero data** while the owner looks fine —
`PROJECT_BACKGROUND.md` §4 documents the incidents. There is a grep guard and a
QA lane check for exactly this string.

Every collection this feature touches — `pos_orders`, `pos_tables`, `items` —
is already workspace-scoped. Route through `ds._scope(userId)`, never a literal.

### 1.2 The backend is Netlify Functions, not FastAPI

> §37/§38: *"FastAPI backend"*, *`main.py`*, *`/api/v1/customer-ordering/*`*

There is no `main.py` in the repository and nothing serves FastAPI in
production. The backend is `netlify/functions/*.js` (35 of them), configured in
`netlify.toml`. `PROJECT_BACKGROUND.md` §2 still names FastAPI; that line is
stale and the plan inherited it.

The plan's *reasoning* is right — price and totals must be server-resolved — it
just names the wrong runtime.

### 1.3 Fira Code for amounts is banned

> §3: *"Fira Code for financial amounts"*. The prototype ships `.mono { font-family: "Fira Code" }` on every price.

`DESIGN_SYSTEM.md` → *Numeric & currency format (strict)*: numbers render in
**Inter** with `tabular-nums`. A monospace face renders a slashed/dotted zero,
which is banned project-wide and pinned with `!important` in
`shared-dashboard.css`. Fira Code is for code snippets only.

### 1.4 `Rp 35.000` has a space; it must not

> §16 and the prototype use `Rp 35.000` throughout.

The rule is `Rp1.234.567` — **no space** — stated in CLAUDE.md, in
`PROJECT_BACKGROUND.md` §5 and in `DESIGN_SYSTEM.md`. The prototype's
`formatIDR` produces the space by replacing `IDR` in an `Intl` result.

Use `window.FluxyMoney.formatBase(minorUnits)`. It is also the only thing that
keeps this correct outside Indonesia: the workspace's `base_currency` may be
PHP, SGD or MYR, where amounts are stored in **cents** and a hardcoded
`id-ID` + `Rp` renders 100× the money with no error
(`MULTI_MARKET_ARCHITECTURE.md`).

### 1.5 The Tailwind CDN is the wrong tool for this surface specifically

> §37: *"Tailwind CSS CDN"*.

Today (2026-09-02) I fixed a **WebKit-only** bug where the Tailwind Play CDN
does not generate utilities in time for DOM injected at runtime. Measured on
`/bill.html`, CDN fully available: Chromium 420px, **WebKit 1440px** — the
dialog rendered as a raw full-width block.

The customer app is *mobile Safari first* and its central interactions are
**injected bottom sheets**. That is precisely the failure combination. Any
component this page injects — the identification sheet, the product detail
sheet, the cart — must get its structure from real CSS, with Tailwind only for
fine detail. See `tests/budget-assignment-drawer.spec.js`.

---

## 2. Things the plan assumes exist, which do not

### 2.1 There is no category entity

> §9/§10 describe categories with `Category ID`, `Name`, `Status`, `Sort order`.

None of that exists. The menu's grouping is **`items.pos_category`** — a free
string, ≤40 chars, which the till derives its chips from (`menuCategories()`).
As of today it is entered through a picker over the groups already in use, so
spellings no longer drift, but it is still a string on the item, not a record.

The plan's instinct is right — **one source of truth, no second taxonomy** — and
the correct reading of it is: *use `items.pos_category`*. Building the
ID/status/sort entity is a separate change with its own collection and rules,
and nothing in V1 needs it. Ordering can be alphabetical or by the existing
`pos_sort` on items.

### 2.2 Menu items have no description

> §12 puts a short description on every product card.

`items` has `name`, `notes` (internal, ≤500) and no customer-facing
description. Either add a field or drop the line from the card. Do not render
`notes` — it says things like "Supplier, grade, anything worth remembering".

### 2.3 There is no dining session

> §19 makes Dining Session and Order separate entities.

Correct product thinking, and it does not exist. Today one open `pos_orders`
document per table **is** the session: the floor plan derives occupancy from it,
and reservations hold the table around it. Multiple customer orders per sitting
would need a new parent entity, new rules, and a decision about which one the
bill aggregates.

**V1 can ship without it.** A QR order can append lines to the table's open
order — which is what `channel: 'qr'` was built for — and "add more items" then
works with no new schema. Introduce the session when a real requirement forces
it, not before.

### 2.4 There is no fourth site role

`scripts/prepare-deploy.js` has `ROLES = ['marketing', 'app', 'till']` and
**every root `*.html` must be classified in `PAGE_ROLES` or all three builds
fail**. A customer surface means adding an `order` role, its `_redirects`, its
origin in `lib/allowed-origins.js`, `cors.json` and the `netlify.toml` CSP —
three mirrors, because three different systems enforce them.

---

## 3. What already exists and should be used

The plan reads as though this is greenfield. Much of it is not:

| Plan asks for | Already in the product |
|---|---|
| Table QR → table context | `pos_tables.qr_token` (256-bit CSPRNG) + `pos_table_directory` (token → workspace + table, deny-all, Admin-SDK only) |
| Customer order reaching POS | `pos_orders.channel: 'qr'`; the till already counts and toasts `newQrOrders` |
| Customer name / WhatsApp | `pos_orders.customer_name` / `customer_phone`, validated in rules |
| Modifiers with price deltas | `items.pos_modifier_groups` → `pos_orders.lines[].modifiers` |
| Customer status ladder | `open → sent → ready → served → awaiting_payment` already maps to *Order received → Preparing → Ready → Served* |
| Request bill ≠ payment | `awaiting_payment` is exactly that status, and `recordPosPayment` is separate |
| Product images | `items.image_path` (shipped today) |
| Price integrity | `addPosOrderLine` already takes the item and resolves price server-side of the browser's claim |

**`pos_table_directory` is empty.** It has rules and a design and nothing writes
it. Whoever builds the QR entry point populates it.

---

## 4. Where the plan contradicts what was just shipped

> §11: *"Use `object-fit: cover`"*

The till renders menu photos with **`contain`** in a fixed 4:3 tile, decided
deliberately today: `cover` preserves the ratio by *cropping*, and on a menu the
part it cuts is often what identifies the product.

The same photo appears on both surfaces. Using `cover` here and `contain` on the
till means one image looks right in one place and wrong in the other, and
whoever uploaded it cannot tell which is authoritative. Keep `contain`.

---

## 5. Sequencing correction

The plan's Phase 1 is "visual foundation" and its Phase 3 is POS integration.
Built in that order, the customer app is a mock for two phases and every
assumption in it is unverified.

The **blocking** piece is neither: it is that a customer is **not
authenticated**, and the whole product — menu, photos, prices, order creation —
has to be reachable without a Firebase session. Nothing in the plan's phasing
surfaces that, and it invalidates the "static HTML talks to Firestore" pattern
every other page here uses.

Prove one authenticated-free read end to end first. Photos are the smallest
such read and the one already blocked, which is why they are being built first.

---

## 6. What was built from this review (2026-09-02)

**`netlify/functions/qr-menu-image.js`** — the first authenticated-free read,
and the piece §5 says had to come first.

```
GET /.netlify/functions/qr-menu-image?token=<tableToken>&item=<itemId>
  → 302 to a signed URL that expires in 15 minutes
  → 404, identically, for every other outcome
```

Why not the two obvious alternatives:

- **`getDownloadURL()`** serves over public HTTPS with Security Rules
  BYPASSED, and the token is stamped at upload and cannot be removed by the
  client. One leaked link exposes that object forever. `check:qr-image` fails
  the build if the call ever reappears.
- **A public-read prefix in `storage.rules`** would make every menu photo in
  every workspace on the platform world-readable by URL, including businesses
  that have not launched. A Storage rule also cannot express per-table scoping.

So the customer never receives a URL to Storage. They receive one to the
function, and the server decides: token → workspace (via the deny-all
`pos_table_directory`), item in that workspace, `pos_visible === true`, and an
`image_path` inside that item's own tree. A token for one restaurant cannot
fetch another's photo, and an item not on the menu has no image even for the
right table.

It redirects rather than proxying the bytes: streaming every tile would put a
serverless invocation on the critical path of a menu scroll and pay for the
bytes twice.

~~⚠️ `pos_table_directory` is still empty~~ — **resolved 2026-09-02.**
`scripts/sync-pos-table-directory.js` reconciles it from `pos_tables` (Admin
SDK; the collection is deny-all to every client). Production run: 11 entries,
0 minted, 0 revoked.

## 6a. Unchanged and correct

Worth stating so it is not re-litigated: §28 (never trust the browser), §29
(price integrity), §24/§25 (request bill is not payment), §40 Decisions 1, 2, 5,
6 and 7, the empty/error states in §31, and the responsive targets in §32 are
all right and consistent with how this codebase already works.


---

## 7. What was built from this review (2026-09-03)

The page itself, its two remaining endpoints, and a fourth site role.

| Piece | Where |
|---|---|
| The diner's page | `order.html` — one page, no Tailwind, no Firebase SDK |
| What to render | `netlify/functions/qr-menu.js` |
| Placing the order | `netlify/functions/qr-order.js` |
| The fourth role | `ROLES`/`PAGE_ROLES` in `scripts/prepare-deploy.js`, `deploy/_redirects.order` |
| Proof | `tests/qr-order.check.js`, `tests/customer-ordering.spec.js` (Chromium **and** WebKit) |

### 7.1 The WebKit prediction in §1.5 was correct, and specifically so

§1.5 argued the Tailwind Play CDN was the wrong tool for a mobile-Safari-first
page whose central interactions are injected bottom sheets. The page therefore
ships real CSS and no Tailwind, and its spec runs on WebKit.

That immediately caught a *different* Safari-only defect in the same family:
**typing a note and tapping "Tambah" did nothing.** The tap blurs the textarea,
the blur fires `change`, and mutating the button's contents inside that handler
made WebKit drop the click. Chromium dispatches it either way, so a
Chromium-only pass is green while a diner taps a dead button.

Fixed by writing to the DOM only when the value actually changed (`setText` /
`setDisabled` in `order.html`). Reproduced first, in a four-case probe — no
note fill passed, note fill failed, blur-first passed, direct dispatch passed —
so the fix is known to address the cause rather than to have moved the symptom.
The spec now types the note immediately before the tap for that reason.

### 7.2 The document shape is the sharpest edge

`wsPosOrderKeys` is a `hasOnly`, and the cashier's **next** update sends the
whole document back. A key `qr-order` writes that the rules refuse succeeds when
written — the Admin SDK bypasses rules — and then fails **every later till
write** to that order. That is the exact shape of the 2026-08-31 incident where
a day of till sales never reached the ledger.

`check:qr-order` diffs the written keys against the rules **in both
directions** (an extra key and a missing one are different defects), and both
negative controls were verified to fire before the check was trusted.

### 7.3 What is deliberately absent from the order origin

Each of these is an assertion in `tests/prepare-deploy.check.js`, not an
oversight:

- **No `/__/auth/*` proxy.** Every other role has one because a user signs in
  there. Nobody signs in here, so it must not host a working auth surface.
- **No `/api/v1/*` catch-all.** Only the three public QR endpoints are routed.
- **Not in `cors.json`** — asserted *out* of it by `tests/allowed-origins.check.js`.
  Listing it would hand an anonymous origin direct browser access to the Storage
  bucket, which is the precise thing `qr-menu-image` exists to avoid.
- **No scheduled functions.** A fourth site keeping them registers every cron a
  fourth time — invisible until it has already mailed customers.
- **`/t/*` is a 200 rewrite, never a 301.** A redirect drops the token, and a
  diner who reloads lands at a menu that has forgotten their table.

### 7.4 Still manual — the domain half

Code cannot do these; they need Netlify and Cloudflare access. Values below were
read from the live account on 2026-09-03, not assumed.

| | |
|---|---|
| Netlify account | `safrian` / `5c780d713be94a71b66ac2eb` |
| Repo | `https://github.com/safrianjay/fluxyos`, branch `main` |
| Build command | `npm run build:css && node scripts/prepare-deploy.js` |
| Publish directory | `.` |
| Assumed site name | `fluxyos-order` — if it differs, update the host-canonicalization line in `deploy/_redirects.order` |

**⚠️ DO NOT USE `netlify env:set` FROM THIS DIRECTORY.** The linked project here
is `fluxyos` — the **apex marketing site**. `env:set --site` ignores its flag and
writes to the LINKED site, which has already nearly turned fluxyos.com into the
till once. Set the variables in the Netlify UI during the import flow, or use
`netlify api createEnvVars` with an explicit `account_id` + `site_id`, and read
them back with `netlify api getEnvVars` before trusting either.

1. Create the site from the repo with the settings above. **Set the environment
   variables before the first build completes** — a build with no `SITE_ROLE`
   produces the full monolith, which serves every app page and an allow-all
   `robots.txt` on the `*.netlify.app` subdomain.
2. `SITE_ROLE=order`, **Production context only**.
3. `FIREBASE_SERVICE_ACCOUNT`, all contexts. Copy the value already on
   `fluxyos-dashboard`. ⚠️ It is **per-site** and account-level env is empty:
   `fluxyos-pos` does not have it, which is exactly why `qr-menu-image` returns
   404 on `pos.fluxyos.com` and 200 on the dashboard.
4. Cloudflare CNAME `order` → the site's `*.netlify.app`, **DNS only (grey
   cloud)**. Then add `order.fluxyos.com` as the custom domain in Netlify.
5. Verify: `curl -sI https://order.fluxyos.com/t/<a real token>` → 200, then
   open it on a phone and place an order.

**This makes four sites building from one repo.** Every push now costs four
builds, not three — worth knowing against the 306-of-300 build minutes spent in
August 2026. `npm run ship` reports the live quota before you push.

### 7.4a Verified in production, 2026-09-03

After pushing, with all three existing sites deployed at `54bcc06`:

- `qr-menu` with a live token → **200**, real menu (27 items, 4 categories, IDR,
  5 with photos). An unknown token → **404**, identical shape.
- `qr-menu-image` → **302** to `storage.googleapis.com` → **200 image/png**.
- `order.html` served locally against the **production** endpoints and real
  data: every photo loaded, no console errors, no failed requests, prices
  rendering `Rp18.000` with no space.

One trap worth recording, because it cost a wrong conclusion: proxying the
image request with a `Content-Type: application/json` header returns **403**.
The signed Storage URL's signature covers the request headers, so an unsolicited
Content-Type on a GET breaks it — and it looks exactly like a broken endpoint.

### 7.5 ~~The gap this does not close~~ — closed 2026-09-03

**The till prints the cards.** Floor plan → *Table QR codes* → a sheet of cards,
one per table in the outlet, laid out for A4 with cut lines. Gated on
`pos.manage`: a cashier operates the till, they do not mint table cards.

`netlify/functions/pos-table-qr.js` renders the symbols server-side. The CSP
allows scripts only from `'self'` plus four Google hosts, so a client-side
encoder would mean vendoring a QR library into `assets/` and owning its
correctness forever; `qrcode` was already a dependency here.

**A QR is the one artefact whose failure is total and invisible** — it looks
exactly like a working one, and it is discovered by a customer holding a
laminated card that does nothing. So `check:pos-table-qr` encodes a card,
rasterises it in a real browser, and decodes it back with **Apple's Vision
framework** — the decoder an iPhone camera actually uses, and a different
implementation from the one that wrote it. Round-tripping through `qrcode` would
prove only that it agrees with itself.

Two things this taught, both worth keeping:

1. **`scripts/verify-qr.sh` never existed.** `scripts/make-qr.js` has claimed
   since it was written that its output is "verified by decoding it back with
   macOS Vision (scripts/verify-qr.sh)". Someone verified it once, by hand, and
   nothing re-checked it after. `scripts/qr/decode-qr.swift` now does.
2. **The decode leg must compare against an independently built URL.** Anchored
   to `cardUrl()`'s own output, it agreed with any bug in `cardUrl` — a token
   truncated by one character encoded, rasterised and decoded perfectly, and the
   card resolved to nothing. Confirmed by re-running the negative control.

Error correction is **Q, not the H** used for the event poster: H is there to
survive a logo over the centre, a table card has no logo, and H's redundancy
would be paid for in module density. On a real 43-char token at a 40mm card, H
gives 0.70mm modules and Q gives 0.82mm. The 40mm box is asserted in the browser
— shrinking it silently makes every printed card harder to scan.

Verified against production: all 11 live tokens in `pos_table_directory`, across
3 workspaces, decode back to the exact URL.
