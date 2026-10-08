# Cloud Run video processing

Video-byte work can run on a Cloud Run job in `us-central1`, next to a regional bucket. The Railway app stays the portal. Job state stays in Railway Postgres.

`main` deploys to the dev Railway service. The `production` branch deploys to production. Merging this change does not turn the new path on, and it does not reach production until that branch is promoted and the production service gets the same variables.

## What changed from the investigation

`docs/storage-cost-investigation.md` recommended this shape. Three parts of that note are updated by later facts and by reading the worker limits again:

1. The YouTube egress gate is closed. A 10 GiB private upload from a Cloud Run job in `us-central1` billed $0 internet egress. YouTube uploads from this job are treated as $0 egress.
2. The read-once local file is the right Railway strategy (the container has a large disk, and a second copy of a ~90 GB file would not fit). It is the wrong Cloud Run strategy. The job's writable filesystem is memory-backed and capped at 32 GiB, so a 90 GB episode cannot be copied onto local disk. The worker reads the object through a read-only GCS FUSE mount. ffmpeg and the YouTube upload both need a seekable file; FUSE provides that. The mp3 is uploaded with the Storage client, not written back through FUSE (a FUSE write stages the whole object in memory).
3. Autoclass with terminal class ARCHIVE is already on `gs://swm-producer-uploads`. The setup script turns the same setting on for the new bucket only. It does not edit the old bucket.

Still true: do not start work from a GCS finalize event. Analyze and distribute are separate steps, and the title, privacy, and schedule are not known when the upload completes. The portal starts the job with a job id and a mode (`process` or `analyze`).

## Design

`VIDEO_PROCESSING_RUNTIME=railway` is the default. `cloudrun` asks Cloud Run to run the same `processJob` / analysis pipeline. A failed dispatch marks the job failed. It does not fall back to Railway, because that fallback would pull the video out of Google Cloud.

The worker is the same Next.js standalone image. Cloud Run overrides the command to `node server.js` so `scripts/migrate.mjs` does not run on every task. `instrumentation.ts` sees `VIDEO_WORKER=1`, runs the one job, and exits. It does not run the stuck-job sweep.

Status is the same Postgres rows the portal already polls. The worker writes `metadata.workerHeartbeat` every minute. Railway's startup sweep and the analyze poller leave a Cloud Run job alone while that heartbeat is under 20 minutes old. A dead task is marked failed after that. The job task timeout is 24 hours (the platform allows up to 168). The worker stops itself at 23 hours so it can record the failure before the platform kills the container. Task retries are 0, so a lost YouTube response cannot create a second video by itself. A manual retry still skips platforms already marked completed. If YouTube accepted the upload and the row was not updated, a manual retry can still duplicate that video. That race exists on Railway today. This change does not rewrite the YouTube upload to use `Content-Range` resume.

Auth is two service accounts:

- `swm-video-invoker` can run the staging job and the production job with container overrides, and nothing else. Railway holds its JSON key in `CLOUD_RUN_INVOKER_CREDENTIALS_JSON`. The run request contains the distribution job id and the mode. Tokens and the database URL stay in Secret Manager on the job.
- `swm-video-processor` is the runtime identity for both jobs. It has `objectAdmin` on the new bucket, `secretAccessor` on the secrets for the job it is running, and `roles/iam.serviceAccountTokenCreator` on itself. Transcription signs a V4 URL for the mp3. With no JSON key, that calls IAM `signBlob`, which needs the token-creator role. The worker uses Application Default Credentials. Do not set `GCS_CREDENTIALS_JSON` on the job, or the Storage client and the FUSE mount will be different identities. Do not grant this account write access on `gs://swm-producer-uploads`.

New browser uploads still use the existing resumable signed-URL protocol (16 MB chunks). When `GCS_UPLOAD_BUCKET_NAME` is set, the signed URL targets that bucket and the job stores `metadata.gcsBucket`. A stored video hint wins and does not call the API. With no hint, readers check the regional bucket first, then the legacy bucket. `delete` without a hint deletes the key from both.

Derived files (the extracted mp3, a YouTube thumbnail saved by the worker, a square image, a browser thumbnail) are always written to `GCS_UPLOAD_BUCKET_NAME` (`swm-producer-uploads-central1`), including when the source video is still in `gs://swm-producer-uploads`. The job stores `metadata.gcsAudioBucket` next to `metadata.gcsAudioPath`. Readers do not apply the video bucket hint to the audio path. An in-flight job that already has an mp3 only on the legacy bucket is still found, because a missing regional object falls through to the legacy bucket. When both copies exist, the regional one wins. Deleting a job removes the audio key from both buckets.

## What Bret runs

From a machine with `gcloud`, as `bret@bwkdigitalsolutions.com`:

```bash
./infra/cloudrun/setup.sh \
  --portal-origins "https://portal.stolenwatermedia.com,http://localhost:3000,https://YOUR_DEV_ORIGIN" \
  --nextauth-url "https://YOUR_DEV_ORIGIN" \
  --signer-sa "THE_CLIENT_EMAIL_INSIDE_GCS_CREDENTIALS_JSON"
```

`--signer-sa` is the `client_email` of the key Railway already uses to sign uploads. The script grants that account `objectAdmin` on the new bucket only. Without it, the browser PUT returns 403.

Then add secret versions (the script creates the secrets empty and never reads these values). Append `?sslmode=no-verify` to `DATABASE_URL`. Railway Postgres presents a self-signed certificate, and the worker will not connect without that query parameter. Staging already uses it.

```bash
printf '%s' "$DATABASE_URL" | gcloud secrets versions add swm-video-database-url --data-file=- --project=swm-producer-portal
```

Repeat for `swm-video-google-client-id`, `swm-video-google-client-secret`, `swm-video-deepgram-api-key`, `swm-video-anthropic-api-key`, `swm-video-resend-api-key`, `swm-video-wp-api-url`, `swm-video-wp-app-user`, and `swm-video-wp-app-password`. Add `swm-video-youtube-cookies` only if yt-dlp needs it.

Build and push the image after this commit is on `main` (or from the commit you intend to run). The script does not build.

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
docker build -t us-central1-docker.pkg.dev/swm-producer-portal/swm-portal/portal:YYYYMMDD .
docker push us-central1-docker.pkg.dev/swm-producer-portal/swm-portal/portal:YYYYMMDD
```

Create the job once the secrets have versions:

```bash
./infra/cloudrun/setup.sh \
  --portal-origins "https://portal.stolenwatermedia.com,http://localhost:3000,https://YOUR_DEV_ORIGIN" \
  --nextauth-url "https://YOUR_DEV_ORIGIN" \
  --signer-sa "THE_CLIENT_EMAIL_INSIDE_GCS_CREDENTIALS_JSON" \
  --image us-central1-docker.pkg.dev/swm-producer-portal/swm-portal/portal:YYYYMMDD \
  --create-invoker-key /tmp/swm-video-invoker-key.json
```

Re-running does not modify an existing job. Pass `--update-job` after you push a new image. A re-run also grants `roles/iam.serviceAccountTokenCreator` to `swm-video-processor` on itself if that binding is missing. That grant was added by hand on staging; the script is idempotent, so running it again does not duplicate the role.

`--grant-legacy-read` is optional. It adds `objectViewer` on `gs://swm-producer-uploads` for the processor account and mounts that bucket read-only, so older objects can be read without copying them onto the 32 GiB filesystem. It does not grant write. Those reads are still within-GCP egress (about $0.02/GiB). They are not free: a region is not the same location as a multi-region bucket.

`--env` defaults to `staging` and keeps the job name `swm-video-processor` and the secret names `swm-video-*`. Production is a separate invocation, below.

Copy existing objects only when you want them on the regional bucket. This is separate, dry-run by default, and it does not delete the source:

```bash
./infra/cloudrun/copy-legacy.sh           # prints the plan
./infra/cloudrun/copy-legacy.sh --confirm # Storage Transfer Service, one shot
```

The confirm step adds `objectViewer` for the transfer agent on the old bucket and `objectAdmin` on the new one. It does not change the old bucket's location, CORS, Autoclass, or lifecycle.

## Railway variables

Set these on the **dev** service first. Leave `GCS_BUCKET_NAME=swm-producer-uploads`.

| Variable | Value |
| --- | --- |
| `GCS_UPLOAD_BUCKET_NAME` | `swm-producer-uploads-central1` |
| `VIDEO_PROCESSING_RUNTIME` | `railway` until the job runs, then `cloudrun` |
| `CLOUD_RUN_JOB` | `projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor` |
| `CLOUD_RUN_INVOKER_CREDENTIALS_JSON` | Contents of the invoker key file. Delete the file after. |

Do not put the invoker key in git. Production gets its own job and its own variables, in the next section. Do not point production at the staging job: that job's database URL, `NEXTAUTH_URL`, and API secrets are the staging values.

`DATABASE_URL` on the job must be reachable from Cloud Run over TLS, and the secret value must include `?sslmode=no-verify` because Railway's Postgres certificate is self-signed. If the Railway Postgres instance rejects public connections, the worker cannot write status. Confirm that before flipping the flag.

## Production rollout

The staging job cannot be reused. Create a second job and a second secret set with the same script. Shared resources (the regional bucket, Artifact Registry, both service accounts, the token-creator binding, and the invoker) are created either way and are left alone when they already exist. A prod run does not change the staging job unless you also pass `--env staging --update-job`.

1. Promote this code to the `production` branch and let Railway deploy it with `VIDEO_PROCESSING_RUNTIME` still `railway` (or unset).
2. Create the prod secrets and job. Use the production portal origin and the production `DATABASE_URL` (with `?sslmode=no-verify`):

```bash
./infra/cloudrun/setup.sh --env prod \
  --portal-origins "https://portal.stolenwatermedia.com,http://localhost:3000" \
  --nextauth-url "https://portal.stolenwatermedia.com" \
  --signer-sa "THE_CLIENT_EMAIL_INSIDE_GCS_CREDENTIALS_JSON"
```

3. Add versions of `swm-video-prod-database-url`, `swm-video-prod-google-client-id`, `swm-video-prod-google-client-secret`, `swm-video-prod-deepgram-api-key`, `swm-video-prod-anthropic-api-key`, `swm-video-prod-resend-api-key`, `swm-video-prod-wp-api-url`, `swm-video-prod-wp-app-user`, and `swm-video-prod-wp-app-password`. Add `swm-video-prod-youtube-cookies` only if yt-dlp needs it. The database URL is the production Railway URL plus `?sslmode=no-verify`.
4. Push the image you intend to run, then create the job. The same invoker key can run both jobs; pass `--create-invoker-key` only if production does not already have `CLOUD_RUN_INVOKER_CREDENTIALS_JSON`.

```bash
./infra/cloudrun/setup.sh --env prod \
  --portal-origins "https://portal.stolenwatermedia.com,http://localhost:3000" \
  --nextauth-url "https://portal.stolenwatermedia.com" \
  --signer-sa "THE_CLIENT_EMAIL_INSIDE_GCS_CREDENTIALS_JSON" \
  --image us-central1-docker.pkg.dev/swm-producer-portal/swm-portal/portal:YYYYMMDD
```

5. On the **production** Railway service, set:

| Variable | Value |
| --- | --- |
| `GCS_BUCKET_NAME` | `swm-producer-uploads` (unchanged) |
| `GCS_UPLOAD_BUCKET_NAME` | `swm-producer-uploads-central1` |
| `VIDEO_PROCESSING_RUNTIME` | `cloudrun` after a small upload looks right |
| `CLOUD_RUN_JOB` | `projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor-prod` |
| `CLOUD_RUN_INVOKER_CREDENTIALS_JSON` | The same invoker key the dev service uses |

6. Upload a small file on production, then set the runtime to `cloudrun` and distribute it. `metadata.processingExecution` should name an execution of `swm-video-processor-prod`. A legacy video's extracted mp3 should land in `gs://swm-producer-uploads-central1`, not in the old bucket.

Re-running `setup.sh --env prod` does not modify an existing prod job. Pass `--update-job` with `--env prod` after you push a new image. That still leaves the staging job unchanged.

There is no schema migration in this change. When a later change has one, deploy Railway (which runs migrations) before you `--update-job` the image.

## Rollout

1. Run `setup.sh` without `--image`. Confirm the new bucket is `us-central1`, uniform access, public access prevention, Autoclass terminal ARCHIVE.
2. Add secret versions. Confirm Cloud Run can open Postgres.
3. Push an image and re-run `setup.sh` with `--image` and `--create-invoker-key`.
4. Merge to `main`. Dev deploys with the flag still `railway`. Behavior matches today.
5. Set `GCS_UPLOAD_BUCKET_NAME` and the signer grant. Upload a small file on dev. The browser protocol is unchanged; CORS on the new bucket is what makes the PUT succeed.
6. Set `VIDEO_PROCESSING_RUNTIME=cloudrun`, `CLOUD_RUN_JOB`, and the invoker JSON. Distribute that small file. The job row should leave `processing`, and `metadata.processingExecution` should name the execution.
7. Repeat with a large upload. Cloud Logging for the job should show `Using GCS FUSE mount` and should not show a full download of that object.
8. Run the copy when you want old objects on the regional bucket. Until then, old objects still play through the legacy bucket.

## Rollback

Set `VIDEO_PROCESSING_RUNTIME=railway` (or unset it) on Railway and redeploy. New jobs stay in the web process. An execution that already started keeps running and still writes status.

To send new uploads back to the multi-region bucket, unset `GCS_UPLOAD_BUCKET_NAME`. Objects already stored with `metadata.gcsBucket` keep resolving to the regional bucket. The setup script never deletes the old bucket; retiring it is a separate decision after the copy and a dual-read period.

## Cost (estimates)

Public list prices as of 6 Oct 2026. September's bill was $82.87: $50.22 internet egress (518 GiB), $28.42 storage, $4.23 multi-region replication.

| Piece | Estimate |
| --- | --- |
| Video reads from the regional bucket in `us-central1` | $0 |
| YouTube upload from that job | $0, confirmed by the 10 GiB test |
| Multi-region replication of new writes | $0 once new objects land on the regional bucket |
| Regional Standard storage | $0.020/GiB-month. About 1,260 GiB is **$25/month** if nothing has cooled. Autoclass moves cold objects toward Archive and the bill falls below that. This note does not invent a regional Archive rate. US multi-region Archive at $0.003/GiB-month is only a reference. |
| mp3 fetches (Deepgram, Transistor, a network cross-post) | About **$2/month**. A rough 40 episodes × ~165 MB × a couple of internet GETs. |
| Cloud Run, base | About **$8/month** at the old 8 GiB size. The job is now 4 vCPU / 16 GiB (the live setting, matched by `infra/cloudrun/setup.sh`). 40 jobs × 1 hour × 4 vCPU / 8 GiB, after the 240,000 vCPU-s and 450,000 GiB-s free tier. Rates $0.000018/vCPU-s and $0.000002/GiB-s. Memory at 16 GiB costs more than this row. |
| Cloud Run, pessimistic | About **$45/month**. 40 jobs × 2 hours × 8 vCPU / 16 GiB, same free tier. |
| One-time Storage Transfer Service copy | About **$25** (1,260 GiB × $0.02/GiB within Google Cloud), plus storage on both buckets until the old one is retired. |
| Reading an old object from Cloud Run before the copy | About $0.02/GiB within GCP. A 90 GiB file is about $1.80. Not internet egress. |

Steady state for new uploads is on the order of **$10–$35/month** plus whatever the cooling old bucket still costs, against ~$83 in September. The investigation's "$61 if YouTube is billed" case is retired. The $25 storage figure is a Standard ceiling, not the cooled Autoclass bill. The old bucket already has Autoclass ARCHIVE, so its cold data is cheaper than the $0.026 multi-region Standard rate used in the investigation.

## Risks

- YouTube uploads are fixed-size resumable chunks (8 MiB) over node:http. A dropped connection or a 5xx queries the session and resumes from the last committed byte. Retries on the Cloud Run job are still 0. A manual retry can duplicate a video if YouTube accepted it and the portal did not record `completed`.
- FUSE must mount within Cloud Run's 30 second mount budget. If the processor account cannot read the bucket, the task fails at startup and the portal marks it failed. No Railway fallback.
- A just-downloaded Vimeo file may be absent from the FUSE stat cache, so that path still copies the file locally. A very large Vimeo source can exceed the 32 GiB memory filesystem. Producer uploads, which already exist before processing, use the mount.
- Railway no longer caps Cloud Run executions at two. Overlapping jobs are isolated, and they share one Postgres connection budget.
- The 20 minute heartbeat window covers a normal image pull. A longer queue delay can look failed; the sweep marks the row failed, and the execution may still start and set `processing` again.
- `SIGKILL` / OOM does not run the SIGTERM handler. The heartbeat is the backstop.
- The Cloud Run image is whatever was pushed to Artifact Registry. Railway builds its own image from `main`. Push a new image when this code changes, or dev will dispatch an old worker.
- Postgres must accept Cloud Run's connection. That is an environment check, not something this repo can prove.
