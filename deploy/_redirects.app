# GENERATED SOURCE — installed as _redirects by scripts/prepare-deploy.js when
# SITE_ROLE=app (the dashboard.fluxyos.com site). Never ships as-is.
#
# _redirects rules are processed by Netlify BEFORE netlify.toml [[redirects]],
# so the rules below shadow the monolith rules that would misbehave here
# (most importantly netlify.toml's forced "/" -> /fluxyos.html rewrite).

# --- Host canonicalization: never serve the raw netlify.app subdomain ---
# NOTE: update the hostname below to the actual Netlify site name chosen when
# the app site is created (plan assumes fluxyos-dashboard).
https://fluxyos-dashboard.netlify.app/*   https://dashboard.fluxyos.com/:splat   301!

# --- API function routes (background extractor MUST precede the catch-all) ---
/api/v1/bank-statements/extract   /.netlify/functions/bank-statement-extract-background   200
/api/v1/*                         /.netlify/functions/api/:splat                           200

# --- Deep-link rewrites ---
/budget-period/:periodId          /budget-period.html       200
/budget-allocation/:allocationId  /budget-allocation.html   200

# --- Marketing split: marketing paths go back to the apex ---
/use-cases/*                https://fluxyos.com/use-cases/:splat                     301!
/id/*                       https://fluxyos.com/id/:splat                            301!
/sitemap.xml                https://fluxyos.com/sitemap.xml                          301!
/llms.txt                   https://fluxyos.com/llms.txt                             301!
/ecommerce-brands           https://fluxyos.com/use-cases/ecommerce-brands           301!
/marketing-agencies         https://fluxyos.com/use-cases/marketing-agencies         301!
/dropshippers-digital-ads   https://fluxyos.com/use-cases/dropshippers-digital-ads   301!
/manufacturing              https://fluxyos.com/use-cases/manufacturing              301!
/retail-franchises          https://fluxyos.com/use-cases/retail-franchises          301!
# {{MARKETING_PAGE_REDIRECTS}}

# --- Root: the app origin's front door is login ---
# login.html bounces already-signed-in users to /dashboard itself.
# 302 (not 301) so the front-door behavior isn't cached forever.
/   /login   302!
