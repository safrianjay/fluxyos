# Lunch Rush Test Plan — QR ordering and the till under load

Written 2026-09-11 from the code at `ac83824`. Every `file:line` below points at
that commit. The rates and read counts are **estimates from reading the code**;
the first run (S1) exists to replace them with measurements.

**Scope:** the diner page (`order.html` served at `/t/<token>`), the five public
functions (`qr-menu`, `qr-menu-image`, `qr-order`, `qr-order-status`,
`qr-request-bill`), and the till's live board (`pos.html` / `assets/js/pos.js`).

**What it answers**

| Question | Answered by |
|---|---|
| How much traffic holds? | The load at which p95 latency doubles or errors pass 1%, per endpoint (S9) |
| Do orders stay correct? | Zero lost, duplicated, misrouted or mispriced orders under contention (S4, S5, S6, S10) |
| How fast does it feel? | Menu and first photo on a mid-range phone; time for a new order to reach the till (S1, S2, S11) |
| What does a rush cost? | Firestore reads and writes per order and per busy hour per outlet (S3, S8) |

---

## 1. Ground rules — real diners use this system

- **Never point load at a live table token.** Every run uses the dedicated
  load-test workspace (§2), with its own outlets, tables and tokens.
- **The functions and Firestore are shared with production.** A spike test can
  slow real restaurants down. Run S9 (stress) and S8 (soak) outside meal hours
  in WIB and SGT: 15:00–17:00 or after 22:00 WIB.
- **Set a Firebase budget alert before the first run**, and a **TTL policy on
  `rate_limits.expires_at`** before the soak (a project setting, not a rules
  change). Without it every run leaves one counter document per key per window
  behind forever — see the header of `netlify/functions/lib/rate-limit.js`.
- **Keep the test workspace out of real books and inboxes.** No bills are
  settled against real ledgers; leftover outlets are *archived* afterwards
  (outlets cannot be deleted).

---

## 2. Test accounts — which one to use

Credentials live only in the gitignored `.qa/` files named below. Never copy a
password into this repo, a ticket or a chat (see `docs/QA_TEST_ACCOUNT.md`).

Surveyed from production on 2026-09-11 (read-only):

| Account | Credentials file | Market | Till access | Current POS data | Use for load? |
|---|---|---|---|---|---|
| Main Playwright QA account | `.qa/firebase-test-account.md` | none set (reads as ID) | Yes — email pattern `fluxyos.qa+*@example.com` is allowlisted in `feature-access.js` | 156 outlets (154 archived spec debris), 1 live table with a registered token, 27 POS items (5 with photos), **757 orders** | **No.** Every `npm run qa` writes here, and `globalTeardown` voids leftover orders. Load residue would break the functional suite, and the suite would corrupt the load results. |
| `qa+id@fluxyos.com` | `.qa/firebase-test-account-id.md` | ID / IDR | Yes — `business_category: fnb` | 3 outlets (Kemang, Senopati, Kelapa Gading), **0 tables, 0 POS items, 0 orders** | **Yes — recommended.** KYC and onboarding already cleared by `scripts/seed-qa-account.js`; no spec uses it; three outlets give the 3× setup for free. |
| `qa+ph@fluxyos.com` | `.qa/firebase-test-account-ph.md` | PH / PHP | Yes — `fnb` | Nothing POS | Keep for currency specs (`auth-setup-ph`); not for load. |
| `qa+sg@fluxyos.com` | *(not created yet)* | SG / SGD | Yes once seeded as `fnb` | — | **Optional second market.** `node scripts/seed-qa-account.js --country SG` creates it. Covers GST wording, SGD money and the 8-digit phone gate under load. |

### Seeded 2026-09-11 — the load-test restaurant exists

`qa+id` is the workspace **"Kopi Senja"** (`vCjCMYV0u8WWGfMy8Z7rj0Bxgat1`),
built by `npm run perf:seed -- --commit` and verified afterwards from the
Admin SDK and from the diner's origin:

| What | State |
|---|---|
| Outlets | Kelapa Gading, Kemang, Senopati — **40 tables each (120)**, zones Indoor / Teras / Bar |
| QR tokens | **120 of 120 registered** in `pos_table_directory` through `pos-table-qr`, none revoked, each pointing at the right table and outlet |
| Menu | **60 dishes**, POS-visible, 6 categories, 30 with modifiers, 6 recommended |
| Photos | **60 of 60**, right-sized on upload, **~75 KB average** WebP at 1280px |
| Pricing | PPN 11% + service 5% on every outlet, taken from the market profile (never hardcoded), open 00:00–23:59 every day so a night-time run is never shown the closed screen |
| End to end | `qr-menu` from `order.fluxyos.com` → HTTP 200, 60 dishes; a photo → 302 → 200 `image/webp`; a real table link renders the menu on a Pixel 7 profile with no page errors |

Re-running the seed creates nothing (proved: every count "0 to create") and
only refreshes the exports:

- `perf/.fixtures.json` — every outlet, table, token, URL and dish (gitignored)
- `perf/out/qr-cards.html` — the 120 printable cards; open it and scan one with
  a phone to walk the diner journey by hand (gitignored)

**First data point (one cold run, not a measurement):** on the Kemang table 12
link, the menu data arrived **4.4 s** after navigation and the first photo at
**6.2 s** — already past the 2.5 s budget. S1 is where this gets measured
properly (warm vs cold, throttled, five runs).

### Making the tables and QR codes

Scannable QR codes are produced by the real product path. **Printing is what
registers a token:** `pos_tables.qr_token` is minted when a table is created,
but `qr-menu` only resolves tokens present in `pos_table_directory`, and that
collection is deny-all to every client. The only writer is the authenticated
function `netlify/functions/pos-table-qr.js`.

By hand (fine for S1 and the correctness runs):

1. Sign in to the till as `qa+id@fluxyos.com`.
2. Make 60 menu items POS-visible, with photos uploaded through the app (so
   they are right-sized to 1280px WebP).
3. On the floor plan, add 40 tables to **Kemang** (and to the other two outlets
   for the 3× runs).
4. Open **Table QR codes** (`#pos-qr-btn`, handler `openTableQrSheet` at
   `assets/js/pos.js:6825`). This calls `pos-table-qr` for every table in the
   outlet and registers all their tokens.
5. Export the tokens (`perf/seed.js --export`, below) into
   `perf/.fixtures.json`.

Scripted (`perf/seed.js`, to build, §7): the same steps in the browser through
`DataService`, like `scripts/seed-fnb-demo.js` does, so every write passes the
real rules. Then one `POST /.netlify/functions/pos-table-qr`
`{ workspaceId }` with the account's ID token registers every table at once.
**Do not write `pos_table_directory` directly with the Admin SDK:** that skips
the path the product depends on, and a token registered that way proves
nothing.

The printed cards point at `ORDER_BASE_URL` (production `order.fluxyos.com`)
even when printed from a preview. The load generator calls the functions on
the production site directly with those tokens.

---

## 3. The request path and its budgets

Budgets are p95 at 1× peak, measured at the load generator.

| Step | Who | Request | Budget |
|---|---|---|---|
| Scan & load page | Diner | `GET /t/<token>` | LCP ≤ 2.5 s on Slow 4G |
| Load menu | Diner | `qr-menu` | ≤ 800 ms warm |
| Photos | Diner | `qr-menu-image` → 302 → Cloud Storage | first photo ≤ 2.5 s |
| Place order | Diner | `qr-order` | ≤ 1.5 s, zero lost |
| Check order | Diner | `qr-order-status` | ≤ 600 ms |
| Request bill | Diner | `qr-request-bill` | ≤ 1 s |
| New order appears | Till | `onSnapshot` → `refresh()` | on screen ≤ 3 s |

The diner page **does not poll**. Status is fetched when the orders sheet
opens, after an order is placed, and on page load, so status traffic grows with
diner actions, not with time.

### Rate limits that shape the test (from the top of each `qr-*.js`)

| Endpoint | Per IP | Per token |
|---|---|---|
| `qr-menu` | 60 / min | 2,000 / day |
| `qr-menu-image` | 300 / min (non-transactional `consumeApprox`) | 5,000 / day |
| `qr-order` | 20 / min | 120 / hour |
| `qr-order-status` | 90 / min | 600 / hour |
| `qr-request-bill` | 20 / min | 60 / hour |

IP is taken from `x-nf-client-connection-ip` (`lib/rate-limit.js:73`) and cannot
be spoofed, so a single load generator is a single IP — see the perf allowance
in §7.

---

## 4. Findings so far, and the original hypotheses

**S1 ran on 2026-09-11 — results in [`docs/perf/S1_BASELINE_2026-09-11.md`](perf/S1_BASELINE_2026-09-11.md).**
It found two problems the hypotheses below did not predict, and both outrank them:

| | Finding | Evidence |
|---|---|---|
| **F1 · Critical** | All five endpoints share ONE per-IP counter but apply their own limits, so photo traffic spends the order allowance: a single diner who scrolls the menu is refused their first order (429) | 4 of 4 S1 runs; 3 of 3 in the k6 smoke; 8 IP-minutes over the limit in production, 7–9 Sep |
| **F2 · High** | Functions run in `us-east-2` (Ohio); Firestore is `asia-southeast1` | `qr-menu` 2.9 s, `qr-order` 4–7.6 s at zero load, vs 113–136 ms for the till's direct writes |
| **F3 · High** | Card and hero photos are sent at 1280 px | first photo 8.2 s on mobile 4G, 5.0 s of it the download; 4.5 MB to scroll the menu |
| **F4 · High** | Four phones at one table: `qr-order` p95 8.2 s | k6 S4 smoke, all orders correct |
| **F5 · Medium** | H2 confirmed at small scale: 425 reads per till refresh here, ~1,660 on a mature outlet | till probe |

### The original hypotheses

Ranked by what happens to a diner or the business if true. Each maps to the
scenario that confirms or rules it out.

### H1 — Critical: a table's order falls out of view once 50 newer orders exist

`qr-order` and `qr-order-status` read the **workspace's** 50 newest orders and
look for the table's order among them. On a busy day, or in a workspace with
several outlets, a table that sat down early drops out of that window partway
through the meal. Then:

- its next round is refused `sitting_ended`, and the page resends it as a new
  sitting;
- the diner's earlier order disappears from their screen;
- the "bill already requested" guard can miss, so a new ticket can open behind
  a bill the cashier is bringing over.

The till has the same pattern: its live listener takes the workspace's 120
newest orders and filters by outlet on the device.

- Where: `netlify/functions/qr-order.js:308`, `qr-order-status.js:219`,
  `assets/js/pos-service.js:2584`
- Scale: at 1×, about 80 new tickets an hour, the window covers roughly the
  last 37 minutes of trading, so **this may already happen at busy outlets**.
- Proved by: **S6**

### H2 — High: every order change makes every open till re-read the whole outlet

Any change to one of the workspace's newest orders fires the listener on every
till. Each till then runs a full `refresh()`: up to 300 orders, 1,000 stock
movements, tables, reservations, the shift, and the menu (read twice, once in
`getPosOverview` and again in `refresh`). There is no debounce, so a burst of
changes starts overlapping refreshes. Firestore offline caching is off
(`firestore-db.js` uses long polling, no persistent cache), so these are all
server reads.

- Where: `assets/js/pos.js:6338` (refresh), `:6513` (watch),
  `pos-service.js:2600` (getPosOverview)
- Estimate: ~1,400 document reads per refresh per till. At 1×, 600 order
  changes/h × 2 tills × 1,400 ≈ **1.7M reads per hour per outlet**.
- Proved by: **S3, S11**

### H3 — High: restaurant wifi can hit the per-IP limits with real diners

Everyone at one venue shares a public IP. A diner scrolling a 60-item menu
makes 60 or more photo requests, so about five diners browsing in the same
minute can use up the 300-per-minute photo allowance, and the next diner sees
blank photos. The menu allows 60 loads per minute per IP; orders allow 20.

- Where: `lib/rate-limit.js:73`, limits at the top of each `qr-*.js`
- Proved by: **S7** (runs from one IP with no allowance, on purpose)

### H4 — Medium: one counter document numbers every new ticket for the day

Each new ticket, whether from QR or the till, runs a transaction on
`counters/pos-<outlet>-<day>`. Firestore handles roughly one sustained write
per second on a single document. A wave of tables ordering together turns into
transaction retries and slow responses, and at worst failures near the 10 s
function timeout. Appends skip the counter but contend on the order document.

- Where: `qr-order.js:488`, `pos-service.js:939`
- Proved by: **S5, S4**. Numbers must come out unique and gap-free.

### H5 — Medium: each photo costs a function call and two round trips

Every photo is a function call (two limiter increments, two Firestore reads,
URL signing) that returns a 302, which the browser follows to Cloud Storage.
Browsers cache for 30 minutes, but a cold function adds start-up time to every
hero photo, and the signed URL differs on each call, so nothing downstream can
share a cached copy.

- Where: `qr-menu-image.js:74` (cache), `:175` (limiter)
- Proved by: **S2**, with time to first photo split into the function hop and
  the storage hop.

### H6 — Low: slow growth

`rate_limits` has no TTL; `qr-menu` returns the whole visible menu with no
paging; `order.html` is 285 KB uncompressed (mostly comments) and all of it
downloads before first render.

- Proved by: **S8** (document count), **S1** (payload for a 200-item menu,
  transferred page size).

---

## 5. Load model

**1× peak** = one outlet, 40 tables, ~2.5 diners per table, 45-minute sitting,
60% of diners ordering by QR. **3×** = three outlets in one workspace (a food
court or small chain — `qa+id` already has three). **10×** = the stress
ceiling.

| Traffic at 1× (estimated) | Rate |
|---|---|
| Menu opens | ~200 / hour per outlet |
| Photo requests | ~100 / minute |
| Order POSTs (new tickets + rounds) | ~110 / hour |
| Order document changes, incl. staff steps | ~600 / hour |
| Bill requests | ~50 / hour |

**The lunch rush profile (S3), 90 minutes:** ramp 0 → 100 active diners over
20 minutes; hold at 100 until minute 60, with a coach party (+30 diners in
2 minutes) at minute 33–40; taper to 0 by minute 80; 10 minutes idle so late
requests and till refreshes finish.

S1 replaces these estimated rates with measured per-journey counts before S3
runs.

---

## 6. Metrics and budgets

Rows marked **hard** fail the run at any load. The rest are starting points to
confirm or adjust after S1.

| Area | Metric | Budget at 1× | Source |
|---|---|---|---|
| Correctness | Accepted orders missing, duplicated, on the wrong table, or priced differently from the server | **0 — hard** | `perf/verify.js` vs the generator's log |
| Correctness | Order numbers unique and gap-free per outlet per day | **0 gaps — hard** | `perf/verify.js` |
| Correctness | Retried POSTs with the same `client_ref` produce exactly one order | **100% — hard** | S10 |
| Endpoints | p50 / p95 / p99 latency per `qr-*` function | see §3 | k6 `http_req_duration` by tag |
| Endpoints | 5xx and timeouts (10 s function limit) | < 0.1% | k6, Netlify function logs |
| Endpoints | 429s served to legitimate diners | 0 at 1× | k6 status counts |
| Endpoints | 409s by reason (`sitting_ended`, `bill_requested`, …) | only where scripted | k6 response-body tag |
| Endpoints | Cold-start share and duration | record | Lambda `Init Duration` in logs |
| Endpoints | Time split: limiter / Firestore / signing | record | `Server-Timing` header (to add) |
| Diner page | LCP / INP / CLS / TBT (mid-range Android, Slow 4G) | 2.5 s / 200 ms / 0.1 / 300 ms | Lighthouse mobile, median of 5 |
| Diner page | Time to first hero photo; bytes before the first screen is usable | ≤ 2.5 s; ≤ 1 MB | Playwright + resource timing |
| Diner page | Repeat visit: photos served from cache | ≥ 90% | resource timing `transferSize` |
| Till | QR order placed → visible on the board | ≤ 3 s | till probe |
| Till | Refreshes per order change, overlapping refreshes, reads per refresh | record | till probe wraps `ds.*` |
| Till | Cashier tap → response (INP), long tasks > 50 ms | ≤ 200 ms | PerformanceObserver |
| Till | Heap after 2 h open | < +30% vs 10 min | heap snapshot (S8) |
| Cost | Firestore reads and writes per order placed, per busy hour | record | Cloud Monitoring `document/read_count` |
| Cost | Function invocations per diner journey | record | Netlify usage |
| Capacity | Load where p95 doubles or errors pass 1% | > 3× | S9 |

---

## 7. The harness

**Built 2026-09-11** except `collect.js` (below). Everything
runs from the repo root; the local app server starts itself when needed.

| Command | What it does |
|---|---|
| `npm run perf:seed -- --commit` | Build / refresh the restaurant and `perf/.fixtures.json` |
| `npm run perf:s1` | S1: page loads, journey, till probe → `perf/out/s1-*/report.md` |
| `npm run perf:reset` | Void every live order in the load workspace (till path) |
| `npm run perf:cashier -- --run s3 --minutes 90` | The scripted cashier and kitchen, alongside S3/S4 |
| `k6 run -e RUN=s3-1x --console-output perf/out/s3-1x/orders.log --summary-export perf/out/s3-1x/summary.json --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" perf/k6/s3-lunch-rush.js` | Any k6 scenario (S2–S10); `-e TIME=0.05` compresses a run for a smoke test. Without `--summary-trend-stats` the summary has no p99 |
| `node perf/till-watch.js --run s3-1x --minutes 105 --tabs 2 --outlet "Kelapa Gading"` | Instrumented till tabs through the run (H2) |
| `npm run perf:verify -- --log perf/out/s3-1x/orders.log` | The hard budgets: lost, doubled, misrouted, mispriced orders, number gaps |
| `node perf/report.js --run s3-1x --reads-per-refresh 433` | One markdown report for the run folder |
| `node perf/qr-contract.js` | Before any change to a `qr-*` function ships: the five real handlers against the load workspace, 38 assertions |

⚠️ **Keep the load machine awake: prefix every long-running command with
`caffeinate -i`.** The first S3 run (2026-09-11) was invalidated because the
Mac went to idle sleep three minutes in — see `docs/perf/LOAD_2026-09-11.md`.

F1 is fixed (`327e2df`), so photo browsing no longer spends the order
allowance. From ONE machine each endpoint is still capped per IP (orders
20/min, menu 60, photos 300): S2, S5, S7 and S9 above those rates need the perf
allowance or several machines; S3 at 1× stays under them.

### Originally planned (≈ 1 day)

Everything lives under `perf/` and stays out of `npm run qa`. The two server
changes are small, stay off unless their env vars are set, and ship before
testing starts.

| Piece | What it does | Why |
|---|---|---|
| `perf/seed.js` — **built** | In the browser as `qa+id`: creates 40 tables per outlet and 60 POS-visible items with photos through `DataService`, then calls `pos-table-qr` to register every token. Writes `perf/.fixtures.json` and `perf/out/qr-cards.html` (both gitignored). `npm run perf:seed` (dry run) / `-- --commit` / `-- --export`. | Real product path. 120 tokens also spread the per-token limits. |
| `Server-Timing` on `qr-*` | Adds limiter / Firestore / pricing / signing milliseconds to every response. | Otherwise a slow p95 can't be traced to its cause. |
| Perf allowance | Skips **only the IP limit** when a secret header matches **and** the token's workspace is listed in `PERF_WORKSPACES`. Off unless the env var is set; removed after testing. | One generator is one IP. Token limits still apply, and S7 runs without it on purpose. Mind the Netlify env gotcha in memory: `env:set --site` writes to the *linked* site — verify with `netlify api getEnvVars`. |
| `perf/k6/*.js` | Shared `journey.js` (menu → photos → order → status → bill) plus one file per scenario, thresholds matching §6. Logs every accepted order to NDJSON. | Open-model arrival rates behave like real diners; closed loops hide queueing. |
| `perf/till-probe.spec.js` | Opens the till, wraps `ds.getPosOverview` and friends to count calls and documents, timestamps each order's arrival on the board, records long tasks and heap. | The till's cost and speed are invisible to k6. |
| `perf/cashier.js` | Moves tickets sent → ready → served → awaiting payment at a realistic pace. | Most order changes, and so most till refreshes, come from staff. |
| `perf/verify.js` | Compares every order in the workspace with the generator's log: missing, duplicated, wrong table, wrong total, number gaps. | This checks the hard budgets. |
| `perf/collect.js` | Pulls Firestore read/write/latency from Cloud Monitoring (gcloud ADC) and function durations and cold starts from Netlify logs for the run window. | Cost and server-side time per run. |
| `perf/report.js` | Merges everything into one HTML report (§9). | One comparable report per run. |

**Where the load comes from:** a laptop is fine for S1 and Phase 2. For S2, S3
and S9 use a small VM in **asia-southeast** (Jakarta or Singapore), close to
the diners and to Firestore. Real-phone numbers: Lighthouse and WebPageTest on
a mid-range Android profile, Slow 4G, from Jakarta.

```sh
# once (done 2026-09-11; re-run any time, it only fills gaps)
node tests/qa-static-server.js &
npm run perf:seed -- --commit
# a run
k6 run --out json=perf/out/s3.ndjson -e SCALE=1 perf/k6/s3-lunch-rush.js
npx playwright test perf/till-probe.spec.js
# afterwards
node perf/verify.js  --run s3
node perf/collect.js --run s3
node perf/report.js  --run s3
```

---

## 8. Scenarios — five phases, run in order

The cheap correctness checks come before the expensive load runs, because a
load test on a system that already loses orders only measures how fast it loses
them. Scenario IDs are labels, not an order.

### Phase 1 — Baseline (½ day, no load)

**S1 · One diner, end to end.** A single scripted journey, cold then warm:
scan, menu, scroll every photo, two rounds, check status, request the bill,
with one till tab open. *Measure:* every metric in §6 at zero load; exact
request count and Firestore reads per journey and per till refresh. *Tools:*
Playwright trace, Lighthouse ×5 on `/t/<token>`, Firestore usage for the window.

### Phase 2 — Correctness at scale (½ day, small sharp bursts)

**S6 · The 50-order window.** Table A opens a sitting. Seed 60 newer orders on
other tables, then table A orders a second round, reloads the page and requests
the bill. *Pass:* round two joins A's sitting, A's history stays visible after
the reload, and the bill guard still refuses new tickets. **Expected to fail on
the current code** — record it as a finding, then rerun at 3× to find the
time-to-failure.

**S4 · Four phones, one table.** Four clients at one table submit within 1 s,
20 times, while a scripted cashier sends the ticket to the kitchen mid-burst.
*Pass:* no lost lines, no doubled quantities; lines that arrive after the
kitchen has the ticket start a new ticket rather than disappearing.

**S5 · New-table burst.** 30 tables at one outlet place their first order
within 10 s; repeat while the till creates walk-in orders. *Pass:* 30 unique,
gap-free numbers; p99 < 3 s; no transaction failure surfaced as a 5xx.

**S10 · Flaky network retries.** Drop the response to 30% of order POSTs and
retry with the same `client_ref`; separately, a Playwright diner on 3G with
packet loss. *Pass:* each intended order exists exactly once; the diner sees
the success screen once.

### Phase 3 — Realistic load (½ day, 1× then 3×)

**S2 · Scan stampede.** 200 diners open the menu across 40 tables within
5 minutes and scroll the photos; no ordering. *Measure:* `qr-menu` and image
latency, cold-start share, time to first photo (function hop vs storage hop),
429s.

**S3 · The lunch rush.** The full 90-minute profile (§5). Each diner opens the
menu, browses, orders 1–3 rounds, checks status and requests the bill. Two till
tabs per outlet stay open; a scripted cashier moves tickets through the kitchen
steps. *Measure:* everything, over time. The headline run, at 1× and 3×.

**S7 · One restaurant wifi.** All traffic from one IP, no allowance: 15 diners
open and scroll the menu in one minute, then 25 orders in one minute. *Pass:*
no legitimate diner gets a 429 or a blank photo. **Expected to fail on
photos** — it shows how far the per-IP limit needs to move.

**S11 · A cashier working through the rush.** A Playwright cashier opens
orders, adds items and takes payment while one QR order lands every 5 s.
*Measure:* INP, long tasks, board repaint time, refreshes per change,
overlapping refreshes, and whether a refresh ever repaints over a cashier
mid-edit.

### Phase 4 — Limits (½ day, off-peak only)

**S9 · Step to breaking.** S3's mix at a steady rate in 10-minute steps of
1×, 2×, 5×, 10×. Stop when p95 doubles over baseline or errors pass 1%; watch
production error rates throughout. *Measure:* the knee per endpoint and what
gives out first — counter, limiter, function timeout, or Firestore.

**S8 · Two-hour soak.** Steady 1× with two till tabs open throughout.
*Measure:* till heap drift, listener reconnects, reads per hour, `rate_limits`
document count, latency at the end versus the start.

### Phase 5 — Report and retest (½ day)

Generate the report, rank the findings, fix Critical and High, then rerun only
the scenarios that proved them. A finding stays open until its retest passes.

---

## 9. The report

One HTML page per run, built by `perf/report.js` from the saved outputs, so any
two runs compare — including a retest against the run that found the problem.

| Section | Contents |
|---|---|
| Verdict | Pass/fail for every budget, hard failures first, and the capacity knee in one sentence ("holds 3.4× peak; `qr-order` p95 doubles at 4×, from counter contention"). |
| Findings, ranked | Severity, evidence (chart, log line, `Server-Timing` split, document reads), likely cause with `file:line`, proposed fix, and the retest that closes it. |
| Per scenario | Latency percentiles per endpoint over time against active diners; status-code mix; 409s by reason; cold starts. |
| Diner experience | Lighthouse vitals, time to first photo with its two hops, first-screen request waterfall, repeat-visit cache hit rate. |
| Till experience | Time for a new order to appear, refreshes per change, overlapping refreshes, INP and long tasks, heap drift. |
| Cost | Firestore reads and writes per order and per busy hour at 1× and 3×, split into diner / function / till; function invocations per journey. |
| Integrity | Full `verify.js` output: accepted, stored, missing, duplicated and mispriced orders, number gaps. |
| Compared with last run | A delta for every metric, so a fix shows up as a number that moved. |

**Severity scale.** *Critical:* an order or amount is lost, duplicated or wrong.
*High:* a diner is blocked, or a budget fails at 1×. *Medium:* a budget fails
at 3×, or a cost grows faster than orders. *Low:* drift or hygiene.

**Likely fixes, for the report to confirm or reject:** look up a table's
orders with a `table_id + created_at` index instead of the 50-order window
(needs an index deploy); have the till apply the rows the listener already
delivers and batch refreshes together, and drop the duplicate menu read; raise
the photo limit per IP or key it on token + IP; hand out order numbers without
a single hot document; serve photos from a cacheable URL.

---

## 10. Run sheet

- [ ] Firebase budget alert set
- [ ] TTL policy on `rate_limits.expires_at`
- [x] `qa+id` workspace seeded: 120 tables, 60 dishes with photos, 120 tokens registered via `pos-table-qr` (2026-09-11)
- [ ] (optional) `qa+sg` created with `seed-qa-account.js --country SG` and seeded the same way
- [ ] `Server-Timing` and perf allowance deployed, both off by default
- [x] S1 baseline recorded (2026-09-11) — see docs/perf/S1_BASELINE_2026-09-11.md
- [x] S6 — the 50-order window: proven under load in the first S3 run (36 of 39 `sitting_ended` were live sittings) — docs/perf/LOAD_2026-09-11.md
- [x] S4 — four phones, one table (after the fix: p95 5.6 s, integrity ✓; new finding F7)
- [ ] S5 — new-table burst
- [x] S10 — retries on a flaky network (after the fix: 5 of 5 retries answered with the same order)
- [ ] S2 + S7 — scan stampede, one wifi
- [ ] S3 + S11 — lunch rush at 1× and 3×, with the cashier
- [ ] S9 + S8 — step-to-break and soak, off-peak
- [ ] Report generated, findings ranked
- [ ] Clean-up: allowance off, `PERF_WORKSPACES` unset, test outlets archived
