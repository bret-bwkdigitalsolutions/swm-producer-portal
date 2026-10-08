#!/usr/bin/env bash
# Create the Cloud Run video-processing resources. Add-only.
#
# This script creates new resources in project swm-producer-portal. It does
# not change the existing bucket gs://swm-producer-uploads (location, CORS,
# Autoclass, lifecycle, or objects). The one exception is --grant-legacy-read,
# which adds an objectViewer binding on that bucket and nothing else.
#
# Run it yourself, as bret@bwkdigitalsolutions.com:
#   ./infra/cloudrun/setup.sh \
#     --portal-origins https://portal.stolenwatermedia.com,http://localhost:3000,https://YOUR_DEV_ORIGIN \
#     --nextauth-url https://YOUR_DEV_ORIGIN \
#     --signer-sa SIGNER_SA_EMAIL
#
# Production is a second job and a second secret set. The staging names stay:
#   ./infra/cloudrun/setup.sh --env prod \
#     --portal-origins https://portal.stolenwatermedia.com,http://localhost:3000 \
#     --nextauth-url https://portal.stolenwatermedia.com \
#     --signer-sa SIGNER_SA_EMAIL
#
# Read docs/cloudrun-video-processing.md before the first run.
set -euo pipefail

PROJECT="swm-producer-portal"
REGION="us-central1"
EXPECTED_ACCOUNT="bret@bwkdigitalsolutions.com"
LEGACY_BUCKET="swm-producer-uploads"
NEW_BUCKET="swm-producer-uploads-central1"
AR_REPO="swm-portal"
PROCESSOR_SA_NAME="swm-video-processor"
INVOKER_SA_NAME="swm-video-invoker"
REGIONAL_MOUNT="/mnt/gcs-regional"
LEGACY_MOUNT="/mnt/gcs-legacy"

PORTAL_ORIGINS=""
NEXTAUTH_URL=""
SIGNER_SA=""
IMAGE=""
ENV_NAME="staging"
GRANT_LEGACY_READ=0
UPDATE_JOB=0
CREATE_INVOKER_KEY=""
ALLOW_OTHER_ACCOUNT=0

usage() {
  cat <<'EOF'
Usage: infra/cloudrun/setup.sh [flags]

Required:
  --portal-origins LIST   Comma-separated browser origins for the NEW bucket
                          CORS config. Include production, localhost, and the
                          dev Railway origin.
  --nextauth-url URL      Portal origin stored on the job (email links).

Optional:
  --env staging|prod      Which job and secret set to create. Default is
                          staging, which keeps the names already in use:
                          job swm-video-processor and secrets swm-video-*.
                          prod creates job swm-video-processor-prod and
                          secrets swm-video-prod-*. The same two service
                          accounts are used either way. A prod run does not
                          modify the staging job.
  --signer-sa EMAIL       client_email of the existing Railway GCS key.
                          Grants that account objectAdmin on the NEW bucket
                          only, so browser signed uploads succeed.
  --image IMAGE           Artifact Registry image. The Cloud Run job is
                          created only when this is set and every required
                          secret already has an enabled version.
  --update-job            Replace the job spec. Without this flag an existing
                          job is left unchanged.
  --grant-legacy-read     Add objectViewer on gs://swm-producer-uploads for
                          the new processor service account, and mount that
                          bucket read-only. This is the only flag that
                          touches the existing bucket, and it only adds IAM.
  --create-invoker-key PATH
                          Write a JSON key for the invoker service account.
                          The file mode is 600. The script never prints the
                          key. Put the file contents in Railway as
                          CLOUD_RUN_INVOKER_CREDENTIALS_JSON, then delete it.
                          Refuses a path inside this git checkout.
  --allow-other-account   Do not require the active gcloud account to be
                          bret@bwkdigitalsolutions.com.

The script enables APIs, creates the regional bucket, Artifact Registry
repository, two service accounts, and empty Secret Manager secrets. It does
not add secret versions and it does not build or push an image.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --portal-origins) PORTAL_ORIGINS="${2:-}"; shift 2 ;;
    --nextauth-url) NEXTAUTH_URL="${2:-}"; shift 2 ;;
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --signer-sa) SIGNER_SA="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --create-invoker-key) CREATE_INVOKER_KEY="${2:-}"; shift 2 ;;
    --grant-legacy-read) GRANT_LEGACY_READ=1; shift ;;
    --update-job) UPDATE_JOB=1; shift ;;
    --allow-other-account) ALLOW_OTHER_ACCOUNT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$PORTAL_ORIGINS" || -z "$NEXTAUTH_URL" ]]; then
  echo "--portal-origins and --nextauth-url are required." >&2
  usage
  exit 2
fi

case "$ENV_NAME" in
  staging)
    JOB_NAME="swm-video-processor"
    SECRET_PREFIX="swm-video"
    ;;
  prod)
    JOB_NAME="swm-video-processor-prod"
    SECRET_PREFIX="swm-video-prod"
    ;;
  *)
    echo "--env must be staging or prod (got '${ENV_NAME}')." >&2
    usage
    exit 2
    ;;
esac

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is not installed." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to write the CORS file." >&2
  exit 1
fi

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
if [[ "$ALLOW_OTHER_ACCOUNT" -eq 0 && "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "Active gcloud account is '${ACCOUNT:-unset}'." >&2
  echo "Sign in as ${EXPECTED_ACCOUNT}, or pass --allow-other-account." >&2
  exit 1
fi

echo "Project:  $PROJECT"
echo "Account:  $ACCOUNT"
echo "Region:   $REGION"
echo "Env:      $ENV_NAME"
echo "Job:      $JOB_NAME"
echo "Secrets:  ${SECRET_PREFIX}-*"
echo "Bucket:   gs://${NEW_BUCKET} (new)"
echo "Legacy:   gs://${LEGACY_BUCKET} (not modified unless --grant-legacy-read)"

gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null

echo "Enabling APIs (no-op if they are already on)..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
PROCESSOR_EMAIL="${PROCESSOR_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
INVOKER_EMAIL="${INVOKER_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
RUN_AGENT="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"

ensure_sa() {
  local name="$1"
  local email="$2"
  local display="$3"
  if gcloud iam service-accounts describe "$email" --project="$PROJECT" >/dev/null 2>&1; then
    echo "Service account exists: $email"
  else
    echo "Creating service account: $email"
    gcloud iam service-accounts create "$name" \
      --project="$PROJECT" \
      --display-name="$display"
  fi
}

ensure_sa "$PROCESSOR_SA_NAME" "$PROCESSOR_EMAIL" "SWM video processor (Cloud Run runtime)"
ensure_sa "$INVOKER_SA_NAME" "$INVOKER_EMAIL" "SWM video invoker (Railway)"

echo "Granting the Cloud Run service agent permission to run as the new processor account..."
gcloud iam service-accounts add-iam-policy-binding "$PROCESSOR_EMAIL" \
  --project="$PROJECT" \
  --member="serviceAccount:${RUN_AGENT}" \
  --role="roles/iam.serviceAccountUser" \
  >/dev/null

# Transcription signs a V4 URL for the mp3. With no JSON key, the Storage
# client calls IAM signBlob, which requires this role on the runtime account
# itself. One binding covers both jobs. Idempotent if it was added by hand.
echo "Granting the processor account permission to sign URLs as itself..."
gcloud iam service-accounts add-iam-policy-binding "$PROCESSOR_EMAIL" \
  --project="$PROJECT" \
  --member="serviceAccount:${PROCESSOR_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  >/dev/null

if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  echo "Artifact Registry repo exists: $AR_REPO"
else
  echo "Creating Artifact Registry repo: $AR_REPO"
  gcloud artifacts repositories create "$AR_REPO" \
    --project="$PROJECT" \
    --location="$REGION" \
    --repository-format=docker \
    --description="SWM producer portal images"
fi

echo "Granting the Cloud Run service agent reader on the new repository..."
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --project="$PROJECT" \
  --location="$REGION" \
  --member="serviceAccount:${RUN_AGENT}" \
  --role="roles/artifactregistry.reader" \
  >/dev/null

bucket_exists() {
  gcloud storage buckets describe "gs://$1" --project="$PROJECT" >/dev/null 2>&1
}

if bucket_exists "$NEW_BUCKET"; then
  location="$(gcloud storage buckets describe "gs://${NEW_BUCKET}" --project="$PROJECT" --format='value(location)')"
  location_lc="$(printf '%s' "$location" | tr '[:upper:]' '[:lower:]')"
  if [[ "$location_lc" != "us-central1" ]]; then
    echo "gs://${NEW_BUCKET} already exists in '${location}', not us-central1." >&2
    echo "Refusing to modify it. Pick a different bucket name." >&2
    exit 1
  fi
  echo "Bucket exists in us-central1: gs://${NEW_BUCKET}"
else
  echo "Creating gs://${NEW_BUCKET}"
  gcloud storage buckets create "gs://${NEW_BUCKET}" \
    --project="$PROJECT" \
    --location="$REGION" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --enable-autoclass \
    --autoclass-terminal-storage-class=ARCHIVE
fi

echo "Ensuring Autoclass terminal class ARCHIVE on the new bucket only..."
gcloud storage buckets update "gs://${NEW_BUCKET}" \
  --project="$PROJECT" \
  --enable-autoclass \
  --autoclass-terminal-storage-class=ARCHIVE

echo "Ensuring public access prevention on the new bucket..."
gcloud storage buckets update "gs://${NEW_BUCKET}" \
  --project="$PROJECT" \
  --public-access-prevention

CORS_FILE="$(mktemp)"
trap 'rm -f "$CORS_FILE"' EXIT
OLD_IFS="$IFS"
IFS=',' read -r -a ORIGIN_ARRAY <<< "$PORTAL_ORIGINS"
IFS="$OLD_IFS"
python3 - "$CORS_FILE" "${ORIGIN_ARRAY[@]}" <<'PY'
import json, sys
path, *origins = sys.argv[1:]
if not origins:
    raise SystemExit("No CORS origins")
doc = [{
    "origin": origins,
    "method": ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
    "responseHeader": [
        "Content-Type",
        "Content-Range",
        "Range",
        "Location",
        "x-goog-resumable",
    ],
    "maxAgeSeconds": 3600,
}]
with open(path, "w", encoding="utf-8") as fh:
    json.dump(doc, fh)
PY
echo "Setting CORS on gs://${NEW_BUCKET} only."
gcloud storage buckets update "gs://${NEW_BUCKET}" \
  --project="$PROJECT" \
  --cors-file="$CORS_FILE"

echo "Granting the processor account objectAdmin on the new bucket..."
gcloud storage buckets add-iam-policy-binding "gs://${NEW_BUCKET}" \
  --project="$PROJECT" \
  --member="serviceAccount:${PROCESSOR_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  >/dev/null

if [[ -n "$SIGNER_SA" ]]; then
  echo "Granting ${SIGNER_SA} objectAdmin on the new bucket (browser signed uploads)..."
  gcloud storage buckets add-iam-policy-binding "gs://${NEW_BUCKET}" \
    --project="$PROJECT" \
    --member="serviceAccount:${SIGNER_SA}" \
    --role="roles/storage.objectAdmin" \
    >/dev/null
else
  echo "No --signer-sa. Browser uploads to the new bucket will 403 until you grant the Railway signer objectAdmin on it."
fi

if [[ "$GRANT_LEGACY_READ" -eq 1 ]]; then
  echo "Adding objectViewer on gs://${LEGACY_BUCKET} for ${PROCESSOR_EMAIL}."
  echo "No other setting on that bucket is changed."
  gcloud storage buckets add-iam-policy-binding "gs://${LEGACY_BUCKET}" \
    --project="$PROJECT" \
    --member="serviceAccount:${PROCESSOR_EMAIL}" \
    --role="roles/storage.objectViewer" \
    >/dev/null
fi

echo "Granting the processor account log writing..."
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROCESSOR_EMAIL}" \
  --role="roles/logging.logWriter" \
  >/dev/null

REQUIRED_SECRETS=(
  "${SECRET_PREFIX}-database-url:DATABASE_URL"
  "${SECRET_PREFIX}-google-client-id:GOOGLE_CLIENT_ID"
  "${SECRET_PREFIX}-google-client-secret:GOOGLE_CLIENT_SECRET"
  "${SECRET_PREFIX}-deepgram-api-key:DEEPGRAM_API_KEY"
  "${SECRET_PREFIX}-anthropic-api-key:ANTHROPIC_API_KEY"
  "${SECRET_PREFIX}-resend-api-key:RESEND_API_KEY"
  "${SECRET_PREFIX}-wp-api-url:WP_API_URL"
  "${SECRET_PREFIX}-wp-app-user:WP_APP_USER"
  "${SECRET_PREFIX}-wp-app-password:WP_APP_PASSWORD"
)
OPTIONAL_SECRET="${SECRET_PREFIX}-youtube-cookies:YOUTUBE_COOKIES"

ensure_secret() {
  local name="$1"
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    echo "Secret exists: $name"
  else
    echo "Creating empty secret: $name"
    gcloud secrets create "$name" \
      --project="$PROJECT" \
      --replication-policy="automatic"
  fi
  gcloud secrets add-iam-policy-binding "$name" \
    --project="$PROJECT" \
    --member="serviceAccount:${PROCESSOR_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null
}

secret_has_version() {
  local name="$1"
  local version
  version="$(gcloud secrets versions list "$name" \
    --project="$PROJECT" \
    --filter="state=ENABLED" \
    --limit=1 \
    --format="value(name)" 2>/dev/null || true)"
  [[ -n "$version" ]]
}

for pair in "${REQUIRED_SECRETS[@]}"; do
  ensure_secret "${pair%%:*}"
done
ensure_secret "${OPTIONAL_SECRET%%:*}"

FUSE="${NEW_BUCKET}=${REGIONAL_MOUNT}"
VOLUME_ARGS=(
  "--add-volume=mount-path=${REGIONAL_MOUNT},type=cloud-storage,bucket=${NEW_BUCKET},readonly=true"
)
if [[ "$GRANT_LEGACY_READ" -eq 1 ]]; then
  FUSE="${FUSE},${LEGACY_BUCKET}=${LEGACY_MOUNT}"
  VOLUME_ARGS+=(
    "--add-volume=mount-path=${LEGACY_MOUNT},type=cloud-storage,bucket=${LEGACY_BUCKET},readonly=true"
  )
fi

job_exists() {
  gcloud run jobs describe "$JOB_NAME" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1
}

missing_versions=()
for pair in "${REQUIRED_SECRETS[@]}"; do
  name="${pair%%:*}"
  if ! secret_has_version "$name"; then
    missing_versions+=("$name")
  fi
done

if [[ -z "$IMAGE" ]]; then
  echo "No --image. Skipping Cloud Run job create."
elif [[ ${#missing_versions[@]} -gt 0 ]]; then
  echo "Skipping Cloud Run job. These secrets have no enabled version:"
  printf '  %s\n' "${missing_versions[@]}"
  echo "Add versions with: printf '%s' \"\$VALUE\" | gcloud secrets versions add SECRET --data-file=- --project=${PROJECT}"
elif job_exists && [[ "$UPDATE_JOB" -eq 0 ]]; then
  echo "Job ${JOB_NAME} already exists. Leaving it unchanged. Pass --update-job to replace the spec."
else
  SECRET_FLAGS=()
  for pair in "${REQUIRED_SECRETS[@]}"; do
    SECRET_FLAGS+=("${pair#*:}=${pair%%:*}:latest")
  done
  if secret_has_version "${OPTIONAL_SECRET%%:*}"; then
    SECRET_FLAGS+=("${OPTIONAL_SECRET#*:}=${OPTIONAL_SECRET%%:*}:latest")
  else
    echo "Optional secret ${OPTIONAL_SECRET%%:*} has no version. YOUTUBE_COOKIES will be unset on the job."
  fi
  SECRET_ARG="$(IFS=','; printf '%s' "${SECRET_FLAGS[*]}")"

  echo "Deploying Cloud Run job ${JOB_NAME} from ${IMAGE}"
  echo "Command override is 'node server.js' so the container does not run migrations."
  # 16Gi matches the live job. An 8Gi limit OOM-killed an 8.5 GiB upload
  # (Oct 7 2026). 4 CPU was already the live setting.
  # ^|^ makes '|' the env delimiter so the FUSE value can contain commas.
  gcloud run jobs deploy "$JOB_NAME" \
    --project="$PROJECT" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$PROCESSOR_EMAIL" \
    --command=node \
    --args=server.js \
    --cpu=4 \
    --memory=16Gi \
    --task-timeout=24h \
    --max-retries=0 \
    --tasks=1 \
    --parallelism=1 \
    --set-env-vars="^|^VIDEO_WORKER=1|GCS_BUCKET_NAME=${LEGACY_BUCKET}|GCS_UPLOAD_BUCKET_NAME=${NEW_BUCKET}|GCS_FUSE_MOUNTS=${FUSE}|NEXTAUTH_URL=${NEXTAUTH_URL}" \
    --set-secrets="$SECRET_ARG" \
    "${VOLUME_ARGS[@]}"
fi

if job_exists; then
  echo "Granting the invoker account run-with-overrides on this job only..."
  # roles/run.jobsExecutorWithOverrides is run.jobs.runWithOverrides on this job.
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --project="$PROJECT" \
    --region="$REGION" \
    --member="serviceAccount:${INVOKER_EMAIL}" \
    --role="roles/run.jobsExecutorWithOverrides" \
    >/dev/null
else
  echo "Invoker binding waits until the job exists."
fi

if [[ -n "$CREATE_INVOKER_KEY" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  key_dir="$(cd "$(dirname "$CREATE_INVOKER_KEY")" && pwd)"
  if [[ -n "$repo_root" && ( "$key_dir" == "$repo_root" || "$key_dir" == "$repo_root"/* ) ]]; then
    echo "Refusing to write the invoker key inside the git checkout ($CREATE_INVOKER_KEY)." >&2
    exit 1
  fi
  echo "Writing invoker key to ${CREATE_INVOKER_KEY} (mode 600). The key is not printed."
  umask 077
  gcloud iam service-accounts keys create "$CREATE_INVOKER_KEY" \
    --project="$PROJECT" \
    --iam-account="$INVOKER_EMAIL"
  chmod 600 "$CREATE_INVOKER_KEY"
  echo "Put that file's contents in Railway as CLOUD_RUN_INVOKER_CREDENTIALS_JSON, then delete the file."
fi

cat <<EOF

Done.
Job resource (set this on the ${ENV_NAME} Railway service when you are ready to dispatch):
  CLOUD_RUN_JOB=projects/${PROJECT}/locations/${REGION}/jobs/${JOB_NAME}
New upload bucket:
  GCS_UPLOAD_BUCKET_NAME=${NEW_BUCKET}
Leave GCS_BUCKET_NAME=${LEGACY_BUCKET}.

DATABASE_URL for this job must include ?sslmode=no-verify. Railway Postgres
uses a self-signed certificate.

Do not set GCS_CREDENTIALS_JSON on the Cloud Run job. The runtime service
account is the identity. Do not commit the invoker key.
Do not grant this account write access on gs://${LEGACY_BUCKET}.
EOF
