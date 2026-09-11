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
# Uses the Application Default Credentials login (a person with deploy rights)
# through an access token, so the active gcloud account can stay the Firebase
# service account. USE_ADC_TOKEN=0 uses the active gcloud account instead.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

URL="https://qr-diner-1084252368929.asia-southeast1.run.app"
node scripts/build-qr-service.js

AUTH=()
if [ "${USE_ADC_TOKEN:-1}" = "1" ]; then
  TOKF="$(mktemp)"; trap 'rm -f "$TOKF"' EXIT
  gcloud auth application-default print-access-token > "$TOKF"
  AUTH=(--access-token-file="$TOKF")
fi

# One instance always up (no cold start), many requests per instance (a menu's
# photo burst does not start new instances), beside Firestore in Singapore.
gcloud "${AUTH[@]}" --project=fluxyos --quiet run deploy qr-diner \
  --source .qr-service --region asia-southeast1 \
  --service-account qr-diner@fluxyos.iam.gserviceaccount.com \
  --allow-unauthenticated --min-instances 1 --max-instances 10 \
  --memory 512Mi --cpu 1 --concurrency 80 --cpu-boost --timeout 30 \
  --set-env-vars FIREBASE_STORAGE_BUCKET=fluxyos.firebasestorage.app \
  --labels app=fluxyos,surface=qr-diner

curl -fsS "$URL/health" > /dev/null && echo "health: ok"
echo
echo "Deployed. Now verify, then stamp:"
echo "  QR_BASE_URL=$URL node perf/qr-contract.js"
echo "  node scripts/stamp-deploy.js qr-service && git add deploy/deployed-stamps.json"
