#!/usr/bin/env bash
# Copy existing objects from the multi-region bucket into the regional bucket.
#
# Dry-run unless --confirm. Does not delete the source bucket or any object.
# Uses Storage Transfer Service so the bytes stay inside Google Cloud.
#
# A laptop `gcloud storage cp` of this bucket is internet egress at about
# \$0.12/GiB (roughly \$150 for 1,260 GiB). Do not do that.
#
# This script does add IAM on the existing bucket: objectViewer for the
# Google-managed Storage Transfer Service agent, so the agent can read.
# It does not change location, CORS, Autoclass, or lifecycle.
set -euo pipefail

PROJECT="swm-producer-portal"
SOURCE_BUCKET="swm-producer-uploads"
DEST_BUCKET="swm-producer-uploads-central1"
CONFIRM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1; shift ;;
    -h|--help)
      echo "Usage: infra/cloudrun/copy-legacy.sh [--confirm]"
      echo "Without --confirm, prints the plan and does not create a transfer."
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is not installed." >&2
  exit 1
fi

echo "Source:      gs://${SOURCE_BUCKET} (objects are kept)"
echo "Destination: gs://${DEST_BUCKET}"
echo "Project:     ${PROJECT}"
echo
echo "One-time cost is the within-Google-Cloud copy, about \$0.02/GiB."
echo "At the ~1,260 GiB reported in October 2026 that is about \$25, plus"
echo "storage on both buckets until you retire the old one yourself."
echo "The script will not delete gs://${SOURCE_BUCKET}."
echo
echo "IAM this will add when confirmed:"
echo "  roles/storage.objectViewer on gs://${SOURCE_BUCKET}"
echo "  roles/storage.objectAdmin on gs://${DEST_BUCKET}"
echo "  member: the Storage Transfer Service agent for this project"

if [[ "$CONFIRM" -eq 0 ]]; then
  echo
  echo "Dry run. Re-run with --confirm to enable the transfer API, grant that IAM, and create a one-shot job."
  exit 0
fi

gcloud services enable storagetransfer.googleapis.com --project="$PROJECT"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
TRANSFER_SA="project-${PROJECT_NUMBER}@storage-transfer-service.iam.gserviceaccount.com"
echo "Transfer agent: ${TRANSFER_SA}"

gcloud storage buckets add-iam-policy-binding "gs://${SOURCE_BUCKET}" \
  --project="$PROJECT" \
  --member="serviceAccount:${TRANSFER_SA}" \
  --role="roles/storage.objectViewer" \
  >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${DEST_BUCKET}" \
  --project="$PROJECT" \
  --member="serviceAccount:${TRANSFER_SA}" \
  --role="roles/storage.objectAdmin" \
  >/dev/null

echo "Creating a one-shot transfer. overwrite-when=different. Source is not deleted."
gcloud transfer jobs create \
  "gs://${SOURCE_BUCKET}" \
  "gs://${DEST_BUCKET}" \
  --project="$PROJECT" \
  --overwrite-when=different \
  --description="Copy SWM producer uploads into the us-central1 bucket. Source is not deleted."

echo "Track it with: gcloud transfer jobs list --project=${PROJECT}"
echo "New uploads already carry metadata.gcsBucket. This copy is for older objects."
echo "After the copy, Cloud Run can read those objects from the regional mount."
echo "Until then, a read of an old object from us-central1 is within-GCP egress at about \$0.02/GiB, not internet egress."
