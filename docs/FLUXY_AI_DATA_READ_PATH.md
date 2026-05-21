# Fluxy AI Data Read Path

This note documents how the standalone Fluxy AI Command Center gets finance
data for analysis, and why it must never convert a backend read failure into a
real-looking zero answer.

## What Happened

The standalone AI page calls:

`POST /api/v1/brain/chat`

The backend then tries to read the authenticated user's Firestore data:

- `users/{uid}/transactions`
- `users/{uid}/bills`
- `users/{uid}/subscriptions`

The analyst response is deterministic when no live AI provider is available. It
calculates revenue, OpEx, bills, subscriptions, missing receipts, and related
records from those collections.

The failure mode was:

1. The backend Firestore REST reads failed for the finance collections.
2. The resilience layer returned empty arrays so the request would not crash.
3. The deterministic analyst calculated from empty arrays.
4. The UI showed `Rp 0`, `0 unpaid bills`, and similar values.
5. The limitation text said the collections could not be read, but the visible
   metrics still looked like real business results.

That is dangerous product behavior because `0` means "the data says zero",
while a read failure means "FluxyOS could not access the data."

## Current Design

The AI command center now sends a sanitized, user-scoped finance snapshot from
the authenticated browser session along with every chat request.

The snapshot is built from the same `DataService` reads used by the app pages:

- `ds.getTransactions(uid, 1000)`
- `ds.getBills(uid)`
- `ds.getSubscriptions(uid)`

It also includes metadata for each collection:

- `success`: whether the browser-side Firestore read completed
- `error`: a safe error label such as `permission_denied`, `network_unavailable`,
  `unauthenticated`, `missing_data_service`, or `read_failed`
- `counts`: the number of sanitized records included per collection

Only safe structured fields are sent:

- `id`
- `vendor_name`
- `name`
- `category`
- `type`
- `status`
- `amount`
- `timestamp`
- `due_date`
- `renewal_date`

The snapshot does not include raw uploaded document contents, receipt image
data, API keys, or unrelated user data.

## Overview Dashboard Snapshot

The dashboard AI Business Summary also calls:

`POST /api/v1/brain/chat`

Its `page_context` is `overview_summary`, and the request must include a
`finance_snapshot` built from the already-authenticated dashboard overview data.
This snapshot is scoped to the selected dashboard period and uses:

- period transactions from `overview.chartTransactions`
- period bills plus due-soon or overdue bills from `overview.aiSnapshot.bills`
- period subscriptions plus upcoming renewals from
  `overview.aiSnapshot.subscriptions`

This exists because the backend Firestore REST read and the browser Firestore
read are separate paths. The dashboard can successfully load records through
Firebase Auth while the Netlify function cannot read the same collections through
REST due to environment, token, rules, or transient network issues. If the
dashboard does not send the snapshot and the backend read fails, `/brain/chat`
correctly returns a data-unavailable answer instead of pretending missing data is
zero. That is the failure mode where the AI Business Summary says it cannot
access transactions, bills, or subscriptions even though KPI cards are visible.

Do not remove this snapshot unless the backend read path is proven reliable for
the dashboard request. The snapshot is not persisted and does not introduce any
AI write action.

## Backend Selection Rule

The backend still tries direct Firestore reads first.

For each collection:

1. If the backend read succeeds, use backend data.
2. If the backend read fails and the authenticated page snapshot read succeeded
   for that collection, use the snapshot, even when the snapshot count is `0`.
3. If both backend read and snapshot are unavailable for a collection required
   by the user's question, return a data-unavailable answer with no key-number
   cards and no calculated zero values.
4. If a non-required collection is unavailable, continue with the available data
   and add an explicit limitation.

The response must not silently present zero as a real result when data could not
be read.

## Why Keep Backend Reads?

Backend reads are still useful because they keep the API independently capable
for server-side workflows and future integrations. The browser snapshot is a
fallback for the current static-app architecture, where Firebase Auth and
Firestore are already active on the page.

## Security Boundaries

- All data remains scoped to `users/{uid}/...`.
- The snapshot is created only after Firebase Auth has identified the current
  user.
- No AI write action is introduced by this flow.
- No records are created, edited, deleted, paid, or marked as reconciled.
- Amounts remain raw numbers in payloads and are formatted only for display.
- The backend must continue to reject unauthenticated requests.

## Operational Checks

If Fluxy AI shows zero values unexpectedly, check these in order:

1. Browser console for Firebase permission errors.
2. Netlify function logs for `[brain/chat] {collection} read failed`.
3. Firebase project environment variables:
   - `FIREBASE_API_KEY`
   - `FIREBASE_PROJECT_ID`
4. Firestore rules for user-scoped reads under `users/{uid}`.
5. Whether the frontend snapshot is included in the `/brain/chat` request.

## Product Rule

AI answers must distinguish between:

- `0`: the user's finance data was read and the computed result is zero.
- `Unavailable`: FluxyOS could not read enough data to compute the result.

When in doubt, show a limitation rather than a confident zero.
