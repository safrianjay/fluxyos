#!/usr/bin/env bash
# =============================================================================
# Deploy the five QR diner functions to Cloud Run (services/qr, asia-southeast1).
#
# Diners are served by Cloud Run, NOT by the Netlify copies of these handlers,
# so any change to netlify/functions/qr-*.js, their ./lib helpers or
# assets/js/pos-pricing.js must be deployed here too. `check:deploy-stamp`
# blocks the push until it is (artifact `qr-service`).
#
#   bash scripts/deploy-qr-service.sh
#   QR_BASE_URL=https://qr-diner-1084252368929.asia-southeast1.run.app node perf/qr-contract.js
#   node scripts/stamp-deploy.js qr-service   # only after the contract passes
#
# WHO DEPLOYS (2026-09-11). The service account `qr-deployer@`, from the key in
# .qa/gcp-qr-deployer.json (gitignored, mode 600) — NOT a person's login. It can
# deploy new revisions of `qr-diner` and nothing else: run.developer on that
# one service, act-as on the two accounts it launches (qr-diner@ runs the
# service, qr-builder@ runs the build), create builds, write to the one source
# bucket. It cannot change who may call the service, touch Firestore, or
# deploy anything else. The key is passed per command
# (CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE), so the active gcloud account is
# left alone.
#
# BUILDS run as `qr-builder@` (logs, the one registry, the source bucket), not
# the default compute account, which holds Editor: letting a deployer start
# builds as THAT account would hand it Editor by the side door.
#
# `--allow-unauthenticated` is deliberately absent: the public-invoker binding
# was set once and persists across revisions, and the deployer is not allowed
# to change it. DEPLOY_AS_OWNER=1 deploys with the Application Default
# Credentials login instead — for repairing this setup, not for routine use.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

URL="https://qr-diner-1084252368929.asia-southeast1.run.app"
KEY="${QR_DEPLOYER_KEY:-.qa/gcp-qr-deployer.json}"
node scripts/build-qr-service.js

AUTH=()
if [ "${DEPLOY_AS_OWNER:-0}" = "1" ]; then
  echo "⚠️  deploying with the ADC login (DEPLOY_AS_OWNER=1)"
  TOKF="$(mktemp)"; trap 'rm -f "$TOKF"' EXIT
  gcloud auth application-default print-access-token > "$TOKF"
  AUTH=(--access-token-file="$TOKF")
else
  if [ ! -f "$KEY" ]; then
    echo "✗ no deployer key at $KEY — see docs/data-model/pos.md §5c" >&2
    exit 1
  fi
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$(cd "$(dirname "$KEY")" && pwd)/$(basename "$KEY")"
fi

# One instance always up (no cold start), many requests per instance (a menu's
# photo burst does not start new instances), beside Firestore in Singapore.
gcloud ${AUTH[@]+"${AUTH[@]}"} --project=fluxyos --quiet run deploy qr-diner \
  --source .qr-service --region asia-southeast1 \
  --service-account qr-diner@fluxyos.iam.gserviceaccount.com \
  --build-service-account projects/fluxyos/serviceAccounts/qr-builder@fluxyos.iam.gserviceaccount.com \
  --min-instances 1 --max-instances 10 \
  --memory 512Mi --cpu 1 --concurrency 80 --cpu-boost --timeout 30 \
  --set-env-vars FIREBASE_STORAGE_BUCKET=fluxyos.firebasestorage.app \
  --labels app=fluxyos,surface=qr-diner

curl -fsS "$URL/health" > /dev/null && echo "health: ok"
echo
echo "Deployed. Now verify, then stamp:"
echo "  QR_BASE_URL=$URL node perf/qr-contract.js"
echo "  node scripts/stamp-deploy.js qr-service && git add deploy/deployed-stamps.json"
