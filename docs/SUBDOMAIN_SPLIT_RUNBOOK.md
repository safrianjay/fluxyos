# Runbook — Splitting the App to dashboard.fluxyos.com

Owner checklist for cutting the logged-in app over from `fluxyos.com/<app>` to
`dashboard.fluxyos.com` (Stripe model: apex = marketing, subdomain = app incl.
`/login`). The repo-side mechanism is documented in `CLAUDE.md` → "Two-Site
Deploy Model"; this file is the one-time console/DNS procedure and the
verification gates.

**User impact when done:** every signed-in user is logged out ONCE (Firebase
sessions are per-origin) and the language preference resets to the Bahasa
default (localStorage is per-origin). No Firestore data is touched. Announce
"we moved the app — please sign in again at dashboard.fluxyos.com" before the
flip, and pick a low-traffic window.

---

## Phase A — Land the code (safe, zero user impact)

1. Merge/push the split changeset (prepare-deploy.js, deploy/_redirects.*,
   netlify.toml, CORS edits) to `main` with `QA_PASS=1` after browser QA.
2. The existing site has no `SITE_ROLE`, so `prepare-deploy` no-ops — confirm in
   the Netlify deploy log: `[prepare-deploy] SITE_ROLE not set — monolith
   deploy, nothing to do.` Production is byte-identical.

## Phase B — Bring up the app site in parallel

3. **Netlify → Add new site → Import from the same GitHub repo.**
   Suggested site name: `fluxyos-dashboard`. If you pick a different name,
   update the one host line at the top of `deploy/_redirects.app` to match
   (`https://<name>.netlify.app/*`) and also the netlify.app entry in
   `cors.json`.
4. **Env vars on the NEW site** — copy the existing site's env wholesale
   (`netlify env:list --plain` on the old site), then:
   - `SITE_ROLE=app` — **scope: Production context ONLY** (deploy previews must
     stay monolith).
   - `APP_BASE_URL=https://dashboard.fluxyos.com`
   - `NOTIFY_ENABLED` / `DIGEST_ENABLED` / `ANNOUNCE_ID_LANG_ENABLED`: leave
     **unset/false** for now. This site is the future (only) home of the
     scheduled senders.
5. **Env vars on the EXISTING site:**
   - Add `APP_BASE_URL=https://dashboard.fluxyos.com` (email links point at the
     app origin from now on).
   - Confirm `NOTIFY_ENABLED`/`DIGEST_ENABLED`/`ANNOUNCE_ID_LANG_ENABLED` are
     unset/false — **permanently** (the marketing build also prunes the
     scheduled function files, so this is belt + braces).
   - Do **NOT** set `SITE_ROLE` yet.
6. **Firebase Console → Authentication → Settings → Authorized domains:** add
   `dashboard.fluxyos.com`, plus temporarily `fluxyos-dashboard.netlify.app`
   for pre-DNS testing (remove the netlify.app one after cutover).
7. **Storage CORS:** `gsutil cors set cors.json gs://fluxyos.firebasestorage.app`
   (the cors.json edit does nothing until this runs).
8. **DNS:** CNAME `dashboard` → `fluxyos-dashboard.netlify.app`; add
   `dashboard.fluxyos.com` as the new site's custom domain; wait for the
   Let's Encrypt cert (HSTS `includeSubDomains; preload` already ships on the
   apex, so the subdomain must be HTTPS from its very first request — it is,
   once the cert exists).
9. **Firebase Functions env:** set `APP_BASE_URL=https://dashboard.fluxyos.com`
   in `functions/.env`, then `firebase deploy --only functions`.

## Phase C — Verification gate (all on dashboard.fluxyos.com, BEFORE the flip)

Nothing user-facing has changed yet; stop at any failure.

- [ ] `/` → 302 → `/login` (this also proves `_redirects` wins over the
      netlify.toml `/` → `/fluxyos.html` rule — if you see a 404 or the landing
      page here, STOP).
- [ ] **Google `signInWithPopup` completes.** DevTools: no CSP violations;
      Elements panel shows the `https://fluxyos.com/__/auth/iframe` helper
      iframe loaded (the CSP `frame-src` fix). **Repeat in Safari** — cross-
      origin authDomain + storage partitioning is the known Firebase footgun.
- [ ] Email/password login + password reset email round-trip.
- [ ] Signed-in visit to `/` bounces to `/dashboard` with live Firestore data.
- [ ] Receipt/document upload works (proves the gsutil CORS apply took).
- [ ] An `/api/v1/*` call (e.g. Fluxy AI chat) returns 200 with
      `Access-Control-Allow-Origin: https://dashboard.fluxyos.com`.
- [ ] `settings-team` invite → email arrives with a
      `https://dashboard.fluxyos.com/login?invite=...&ws=...` link → accepting
      works.
- [ ] Deep links render: `/budget-period/<id>`, `/budget-allocation/<id>`,
      `/invoices?record=<id>`.
- [ ] `/pricing` → 301 → `https://fluxyos.com/pricing`.
- [ ] `curl -I https://dashboard.fluxyos.com/dashboard` shows
      `X-Robots-Tag: noindex, nofollow`; `/robots.txt` is disallow-all.
- [ ] `https://fluxyos-dashboard.netlify.app/login` → 301 → the custom domain.

## Phase D — Cutover (the flip)

10. Set `SITE_ROLE=marketing` (Production context only) on the EXISTING site →
    trigger deploy (~1 min). From that moment: apex app paths 301 to the
    dashboard; `/api/v1/*` is still served locally on the apex so open stale
    tabs keep working; every user re-logs-in once on the new origin.

## Phase E — Post-cutover checks (apex)

- [ ] `/` serves the landing page; `/pricing`, `/use-cases/*`, `/id/*` fine.
- [ ] `curl -I https://fluxyos.com/{dashboard,login,checkout,settings-team}` →
      301 with correct `Location`; query strings preserved
      (`curl -I "https://fluxyos.com/login?invite=a&ws=b"`).
- [ ] `curl -sI https://fluxyos.com/__/auth/iframe` → 200 (the dashboard's login
      popup depends on this proxy staying on the apex).
- [ ] A fresh login popup from dashboard.fluxyos.com still completes.
- [ ] Contact-sales form on the apex submits (marketing-origin function).
- [ ] Trigger one email flow → links point at the dashboard origin.
- [ ] Google Search Console over the following days: no dashboard.* pages
      indexed; apex sitemap re-crawls clean.
- [ ] Remove `fluxyos-dashboard.netlify.app` from Firebase Authorized domains.

## Rollback (any time, ~1 build)

Delete `SITE_ROLE` from the apex site → redeploy → the untouched netlify.toml
rules restore the full monolith. Optionally unset `APP_BASE_URL` to point email
links back at the apex. The dashboard site can stay up harmlessly meanwhile.

## When re-enabling notifications later

`NOTIFY_ENABLED=true` (and friends) go on the **app site only**. The marketing
build prunes the scheduled function files, so even a mistaken flag there cannot
double-send — but don't set it anyway.
