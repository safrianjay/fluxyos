# Public lead intake protections

Contact Sales and event signup share `submit-contact-sales`. Both must pass the
same checks; a client-supplied source never exempts a request from protection.

## Current rollout: Turnstile pending (owner approved)

The initial deployment enables validation, the honeypot, signed-session timing,
durable rate limits and content screening **without claiming CAPTCHA verification**.
Cloudflare authorization is unavailable, so Turnstile remains pending by explicit
owner approval. This is not equivalent to a verified-human submission; bots can
obtain sessions too. Configure these **production function-scoped** Netlify vars:

- `CONTACT_FORM_BOT_MODE=pending`
- `CONTACT_FORM_SESSION_SECRET`: a cryptographically random secret of at least
  32 characters, generated server-side and never committed or returned to clients.

The fallback is never selected by a client request or provider outage. Without
explicit pending mode and a strong signing secret, missing configuration fails
closed. Partial/invalid Turnstile configuration also fails closed. Once both valid
Turnstile keys are configured and redeployed, verification is automatically
mandatory even if the pending flag remains. Accepted pre-activation leads record
`bot_verification: "pending"`; verified leads record `"turnstile"`.

## Activate Turnstile later

In the **marketing site's Netlify environment**, configure:

- `TURNSTILE_SITE_KEY`: the public key of a Cloudflare **Managed** widget.
- `TURNSTILE_SECRET_KEY`: its matching server-only secret. Never put this in
  HTML, browser code, git, or chat.

Configure the widget hostnames as `fluxyos.com` and `www.fluxyos.com`. Use
production keys, not Cloudflare testing keys. The browser fetches only the public
key and a short-lived signed session from `contact-form-config`; no build-time
secret injection is required. Netlify functions must be redeployed after changing
environment variables. In required mode, missing keys or unavailable verification
fail closed and the form offers `sales@fluxyos.com` as a fallback. Keep the
independent session secret stable when enabling Turnstile; it also keys email
quotas. Rotating it invalidates open form sessions and resets those email buckets.

For deliberately enabled preview domains, register the exact hostname in
Cloudflare and set `TURNSTILE_ALLOWED_HOSTNAMES` to a comma-separated list that
also includes the production hosts. Do not use wildcard hostnames. Local browser
tests mock the provider and API; they never write leads or send alerts.

## Checks and operating limits

Inputs are bounded, normalized, trimmed and validated as plain text before any
lead write. HTML, encoded markup, script schemes and control characters are
rejected. Internal `fluxyos.com` addresses (including subdomains), malformed
addresses and a conservative list of disposable domains are rejected. Permanent
personal addresses such as Gmail are allowed. Messages are limited to 100 UTF-16
characters, matching the browser's `maxlength` and counter.

A filled honeypot receives an indistinguishable success acknowledgement but is
discarded without storage or alerts. Verified-looking requests consume durable
Firestore transaction quotas: **10 per IP per 10-minute fixed window**, and
**3 per email per hour**, shared across both forms. Netlify's trusted client-IP
header takes precedence. Limiter outages fail closed. `CONTACT_FORM_IP_LIMIT`
can raise the IP allowance (integer 1–1000) for events sharing a network; the
email quota stays enforced. Fixed windows can allow twice the quota around a
boundary. Existing `rate_limits.expires_at` TTL cleans up buckets.

When enabled, Turnstile tokens are verified server-side with hostname, action and signed-session
nonce binding. Cloudflare enforces token expiry and single use. A tampered or
expired session is rejected. The signed issue time provides a server-trusted
completion duration; client completion time is supplemental only.

Three or more explicit URLs or strongly repeated content are rejected. Spam
phrases and opaque mixed-case tokens are scored, not blocked on their own.
Completion under two seconds is a weak signal only: autofill alone passes.
Combined signals reaching a score of three are rejected. Accepted flagged leads
retain `spam_flags` and `spam_score`, with review signals in sales notifications.
The limiter stores hashed identifiers; leads never store raw IPs, tokens or
signed sessions. Unknown body fields are not forwarded or stored.

## Verification and rollout

Run `npm run check:contact-sales` and `npm run qa:contact-sales`. Before shipping,
run the repository QA gate against the final commit. After configuring live keys,
check the managed widget on both production hostnames with a real browser; verify
one legitimate enquiry arrives in Sales Leads and alerts, blocked internal emails
stay client-side, and token failures do not create leads. Monitor Cloudflare
verification errors and flagged leads; adjust heuristics conservatively. Mocked
tests do not certify production credentials or hostname configuration.

References: [server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
and [interaction-only widget configuration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).
