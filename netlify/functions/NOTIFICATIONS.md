# Email notifications — Netlify (no-Blaze) path

This is the **no-Blaze alternative** to the Firebase Cloud Functions in
`functions/`. Same emails, same Resend templates (`functions/lib` is reused
verbatim), but it runs on **Netlify Scheduled Functions** so it needs **no
Firebase Blaze plan** — only a Firebase **service-account key**.

Use this OR the Cloud Functions path, not both (running both double-sends).

## What runs

| File | Schedule | Sends |
|---|---|---|
| `notify-sweep.js` | every 5 min (`*/5 * * * *`) | Welcome + KYC (approved/needs-revision/rejected) + payment (verified/rejected), reconciled from `internal_users` |
| `trial-reminders.js` | daily 02:00 UTC (`0 2 * * *`) | Trial ending within 24h, from `billing_subscription/current` |

Both are **schedule-only** (no public HTTP), so there's no email-relay endpoint
to abuse. The internal console keeps writing status as it already does; the
sweep turns those into emails within ~5 minutes. Logic lives in `lib/notify-core.js`.

- **Idempotency/audit:** identical to the Cloud Functions path — each send
  `.create()`s `users/{uid}/mail_log/{eventKey}` (Admin SDK bypasses rules),
  rolls back on provider failure, and writes a `notification.email_sent` audit row.
- **KYC/payment `eventKey`** includes the review timestamp, so a re-decision
  re-notifies while retries dedupe.
- **Welcome is guarded** so a first deploy never back-emails existing users —
  see `WELCOME_AFTER` below.

## One-time setup

1. **Generate a Firebase service account key** (free, no Blaze):
   Firebase Console → ⚙️ Project settings → **Service accounts** →
   **Generate new private key** → downloads a JSON file.

2. **Verify the Resend domain** (`fluxyos.com`) and SPF/DKIM/DMARC DNS — already done.

3. **Set Netlify environment variables** (Site settings → Environment variables):

   | Variable | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the **entire** service-account JSON, on one line |
   | `RESEND_API_KEY` | your Resend API key |
   | `EMAIL_FROM` | `FluxyOS <notifications@fluxyos.com>` |
   | `EMAIL_REPLY_TO` | `support@fluxyos.com` |
   | `APP_BASE_URL` | `https://dashboard.fluxyos.com` (the app origin — email deep links land on the dashboard site; the code fallback is the apex, which still works via its app-path 301s) |
   | `DEFAULT_LOCALE` | `en` or `id` |
   | `WELCOME_AFTER` | **deploy timestamp**, ISO (e.g. `2026-06-14T12:00:00Z`) — only users created after this get a welcome email. Set it to "now" at first deploy so existing users are never emailed. |
   | `NOTIFY_AFTER` | KYC/payment recency cutoff, ISO. A decision is emailed only if its review timestamp is ≥ this. Defaults to `WELCOME_AFTER` if unset. Set to "now" so pre-existing decisions are never back-emailed. |
   | `NOTIFY_ENABLED` | **kill switch — default off.** Both notification sweeps run **only** when this is exactly `"true"`. Anything else (incl. unset) = paused. |
   | `DIGEST_ENABLED` | **Weekly digest kill switch — default off.** `weekly-digest.js` runs only when this is exactly `"true"`. |
   | `OPENAI_API_KEY` | Used by the Weekly Digest's AI narrator (already set for `api.js`). Without it the digest falls back to a deterministic narrative. |
   | `ANNOUNCE_ID_LANG_ENABLED` | **One-time broadcast kill switch — default off.** Arms `announce-id-language.js` only when exactly `"true"`. Independent of `NOTIFY_ENABLED`/`DIGEST_ENABLED` — arming it does not un-pause the sweeps. |

   These are secrets — set them in Netlify, never commit them.

## ⚠️ Kill switch & first-enable safety

`NOTIFY_ENABLED` must be `"true"` for either sweep to do anything. Flip it to
anything else to **instantly pause** all sending (next scheduled run no-ops).

**Backfill protection (two layers):** the reconcile sweep emails the *current*
KYC/payment status of every `internal_users` row, so without guards it would
back-email every already-approved/rejected user on an empty `mail_log`.

1. **`NOTIFY_AFTER` cutoff (structural).** The internal console stamps
   `kyc_reviewed_at` / `payment_reviewed_at` on **every** KYC/payment decision,
   and the sweep only emails a decision whose review timestamp is ≥ `NOTIFY_AFTER`.
   Set `NOTIFY_AFTER` to "now" and pre-existing decisions can never be emailed —
   even if `mail_log` is empty.
2. **`mail_log` idempotency.** Each send is recorded so it never repeats.

`WELCOME_AFTER` is the equivalent cutoff for welcome (by `created_at`). With both
cutoffs set to deploy time, re-enabling on populated data is safe by construction.

4. **Deploy** by pushing to `main` (Netlify auto-deploys). The scheduled
   functions register automatically from the `schedule()` wrapper; confirm them
   under **Netlify → Functions** (they show a "Scheduled" badge).

## Local smoke test (sends nothing)

```bash
npm run smoke:notify
```

Mocks Firestore/Auth/Resend and asserts: welcome/KYC/payment reconcile, welcome
age-gating, EN/ID locale, idempotent re-runs, trial-window filtering, and
failure rollback + retry.

## Trade-offs vs the Cloud Functions path

- **Latency:** KYC/payment/welcome arrive within ~5 min (sweep interval) instead
  of instantly.
- **Cost/scale:** each sweep scans `internal_users` (capped at 500/run). Fine for
  MVP; for large user bases, switch to Blaze + the event-driven Cloud Functions.

---

## Weekly Financial Digest (`weekly-digest.js`)

A per-user AI-narrated weekly summary, separate from the notification sweeps.

- **Schedule:** hourly (`0 * * * *`). For each roster user it reads
  `users/{uid}/settings/email_preferences` (missing doc = enabled defaults:
  Monday / 09:00 / all metrics) and sends only when the user's **local** weekday
  + hour match `delivery_day` / `delivery_hour` in their `timezone`.
- **Idempotency:** `users/{uid}/mail_log/weekly_digest_{ISOyear}_W{week}` — one
  digest per user per ISO week.
- **Data:** reuses the deterministic finance engine + AI narrator from
  `api.js` (`exports.digest`). Every number is computed deterministically; OpenAI
  only narrates. Reads transactions/bills/subscriptions/budgets via Admin SDK.
- **Content:** dynamic sections per the user's `metrics`; AI Insights +
  Recommended Actions always render. Low-activity weeks send **summary-only**
  (AI summary + actions); accounts with zero finance records are skipped.
- **Audit:** `weekly_digest.generated` / `.sent` / `.failed`.
- **Enable:** set `DIGEST_ENABLED=true`. Code lives in `lib/digest-core.js`;
  the email builder is `functions/lib/digest-template.js`. Local test:
  `npm run smoke:digest` (mocked, sends nothing).

---

## One-time broadcasts (`announce-id-language.js`)

An ad-hoc product-update blast to the **whole** `internal_users` roster, used to
announce the Bahasa Indonesia release. The bilingual email (English first,
Bahasa Indonesia below) is the `announce_id_language` template in
`functions/lib/templates.js`.

- **Schedule:** `*/5 * * * *`, but **no-ops unless armed** by
  `ANNOUNCE_ID_LANG_ENABLED=true` (its own switch — does not touch the sweeps).
- **Exactly-once / no backfill:** each send keys
  `users/{uid}/mail_log/announce_id_language_v1` via `.create()`. A re-run or two
  overlapping runs can never double-send, and a user is emailed once *ever*,
  independent of signup date — so there's no backfill vector even on an empty log.
- **Run it:**
  1. Send yourself a test first (set your own row, or temporarily point the
     roster query at a test uid) and eyeball the email.
  2. Set `ANNOUNCE_ID_LANG_ENABLED=true`.
  3. Watch the function log for `{ scanned, sent, skipped, failed }`. When a run
     reports `sent: 0`, everyone has it — the broadcast is done.
  4. Set `ANNOUNCE_ID_LANG_ENABLED=false` (or unset) to disarm.
- **Re-announce (rare):** bump the `EVENT_KEY` version suffix in the function to
  intentionally send to everyone again.
- **Local logic test:** `node scripts/announce-smoke.js` (mocked, sends nothing).
