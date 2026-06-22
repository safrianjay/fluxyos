# FluxyOS — Trial Length & Special Trial Extensions (Policy)

> Read before changing trial duration or granting any customer a longer trial.

## Default trial — 3 days, for everyone

The standard free trial is **3 days for ALL users**. It is created by
`DataService.ensureBillingSubscription` from the constant
**`TRIAL_DURATION_DAYS = 3`** in [`assets/js/db-service.js`](../assets/js/db-service.js).

**Do NOT change `TRIAL_DURATION_DAYS` to give one customer a longer trial.** That
constant is global — editing it changes the trial for **every** new user. Leave it
at 3 unless the product genuinely changes the default for everybody.

## Special extensions — per-account, by agreement only

A longer trial (e.g. Grace's 1-month extension, agreed 2026-06-22) is a
**per-account exception**, granted because of a specific sales/support agreement
with that customer. It is applied as a **single-account data write**, never a
global change:

- Tool: [`scripts/extend-grace-trial.js`](../scripts/extend-grace-trial.js) — an
  Admin-SDK one-shot. Despite the name it is generic:
  - `--email <addr>` — which account to extend (resolved via `getUserByEmail`).
  - `--months <n>` — how long (default 1).
  - `extend` writes only that user's `users/{uid}/billing_subscription/current`
    (`status: trialing`, `trial_started_at: today`, `trial_ends_at: +N months`),
    plus an audit log. `email` sends the confirmation via Resend.
- Run it once per customer, **only after an agreement exists**. It touches exactly
  one account; all other users keep the 3-day default.

So if another customer negotiates an extension later, use the same script with
their `--email` (and `--months`) — that is the supported path. Record the
agreement (who, how long, when) in the audit log reason / your CRM.

## How extensions interact with workspaces

Trial state is **owner-scoped** and, via the workspace-shared-trial feature
(`docs/WORKSPACE_SHARED_TRIAL_PLAN.md`), **members inherit the owner's trial**.
So extending a workspace **owner** automatically extends the trial for that
**workspace's members** too — that is intended (the team shares one trial). It
does **not** affect any other workspace; each workspace mirrors only its own
owner's real trial dates. There is one trial state per workspace, and no global
duration change.

## Summary

| | Value / mechanism |
|---|---|
| Default trial (all/new users) | 3 days (`TRIAL_DURATION_DAYS`, do not edit per-customer) |
| Special extension | Per-account, by agreement, via `scripts/extend-grace-trial.js --email --months` |
| Scope of an extension | The one account written (+ that owner's workspace members) |
| Currently extended | grace@get-pipeline.com — 1 month from 2026-06-22 |
