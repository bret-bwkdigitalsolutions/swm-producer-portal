# Storage cost investigation

Investigation only. No application code, infrastructure, environment variables, or secrets were changed. Prices below are public list prices as published on 6 October 2026, unless marked as an estimate inferred from the September invoice. This report does not contain credentials.

## Recommendation

Move video-byte work (audio extraction and the YouTube upload) onto a Cloud Run job in `us-central1`, and store the videos in a **regional** `us-central1` bucket. Keep the browser on the existing GCS resumable upload. Do not start with Cloudflare R2.

That is meaningful engineering work in the job runner, and it carries real cutover risk (a second runtime, database access from GCP, and one billing assumption that has to be proved before cutover). It does not change the producer upload path. Processing of very large files should get more reliable, not slower. The billing assumption is: bytes sent from Google Cloud to YouTube are free. That is documented for a VM. It is not repeated on the Cloud Run pricing page. A small paid proof (below) is the gate. If that proof shows YouTube egress billed at internet rates, stop and do not cut over.

If a new runtime is not acceptable yet, the useful smaller step is the in-flight read-once fix plus Autoclass on the current bucket. That needs no upload changes and no new service. It leaves roughly $25/month of video egress in place, and it leaves 90 GB files being copied onto the Railway disk.

R2 is the cheapest steady state on paper (about $22/month versus about $83 in September) and its egress is actually $0. Getting there means rewriting the 90 GB browser upload from the GCS resumable protocol to S3 multipart, and the Railway service would still download every video. That is the option most likely to make uploads fail.

## What the September bill is

Invoice, as given: **$82.87**.

| Line | Amount | Quantity | Implied price |
| --- | ---: | ---: | --- |
| Download egress | $50.22 | 518 GiB | $0.097 / GiB effective |
| Storage | $28.42 | — | — |
| Multi-region replication | $4.23 | — | — |

Published list prices used below ([Cloud Storage pricing](https://cloud.google.com/storage/pricing), fetched 6 October 2026):

- US multi-region Standard storage: $0.000035616 per GiB-hour, which is **$0.026 / GiB-month** at 730 hours.
- `us-central1` regional Standard storage: $0.000027397 per GiB-hour, which is **$0.020 / GiB-month**.
- Inter-region replication, US multi-region, default: **$0.02 / GiB written**.
- Internet egress to worldwide destinations excluding Asia and Australia: **$0.12 / GiB** for the first 10 TiB in a month.
- Data transfer inside Google Cloud, North America to North America, when it is not "the same location": **$0.02 / GiB**.

The replication line reconciles exactly with the stated growth: $4.23 / $0.02 = **211.5 GiB written in September** (227 GB decimal), inside the stated 200–280 GB/month band.

The storage line implies an average of $28.42 / $0.026 = **1,093 GiB** stored during September. The bucket is larger now. This report treats "~1.35 TB" as 1.35 × 10^12 bytes = **about 1,260 GiB**. At list price that is **1,260 × $0.026 = $32.76/month** of multi-region Standard storage today. If the console figure is 1.35 TiB (1,382 GiB), storage is $35.93. The rest of the math uses 1,260 GiB and is labeled as an estimate.

The egress line does not match list price. 518 GiB × $0.12 = $62.16, but the invoice is $50.22, an effective **$0.097 / GiB** (about 81% of list). This report does not know why (billing-account discount, destination mix, or how the 518 GiB was measured). Forward estimates are shown at **list ($0.12)** and, where it matters, at the **September effective rate ($0.097)**.

Planning volume for a steady month: **220 GiB of new video** (midpoint of 200–280 GB, and in line with September's 211.5 GiB of writes).

## What the code actually reads

Producers never send the video through Railway. The browser gets a V4 signed resumable URL and uploads straight to GCS.

- Signed URL: `generateSignedUploadUrl` in `src/lib/gcs.ts` (`action: "resumable"`, 4-hour expiry). The comment above the function still says 1 hour; the code is 4 hours.
- Issued by `src/app/api/upload/signed-url/route.ts`, which writes `DistributionJob.gcsPath` before the bytes have arrived.
- The live uploader is `uploadVideoToGCS` in `src/app/dashboard/distribute/new/distribution-form.tsx`. It POSTs the signed URL with `x-goog-resumable: start`, then PUTs 16 MB chunks with `Content-Range`, 5 retries. `src/components/distribution/video-upload.tsx` implements the same protocol with 5 MB chunks, and nothing imports it.

Processing then pulls the bytes back out over HTTPS signed URLs (`generateSignedDownloadUrl`, default expiry 1 hour). Every one of those GETs is internet egress, because Railway is not a Google Cloud service.

Current video reads, before the in-flight read-once change:

| Path | Where | Video downloads from GCS |
| --- | --- | --- |
| Direct distribute | `processJob` in `src/lib/jobs/processor.ts` | **2.** `extractAudio` downloads the whole file to `/tmp`, then the YouTube block (around lines 291–306) downloads it again to a second temp file. |
| AI assist, which is the primary upload flow (`startAiAnalysis`) | `runAnalysis` in `src/app/api/distribute/analyze/route.ts`, then later `processJob` | **3.** Analyze calls `extractAudio`. The processor does not look at `metadata.gcsAudioPath`, so it calls `extractAudio` again. Then it downloads the video a third time for YouTube. |

`extractAudio` (`src/lib/jobs/audio-extractor.ts`) always materializes `input.mp4` on local disk, runs ffmpeg to a 192 kbps / 44.1 kHz MP3, and uploads the MP3 next to the video. The 30-minute ffmpeg timeout there is separate from the job timeout.

Other reads are not the video, and they are small next to 518 GiB:

- Deepgram is given a signed URL and fetches the MP3 itself (`src/lib/transcription.ts`). That is GCS internet egress of the audio, not a Railway download.
- Transistor: Railway downloads the MP3 and streams it to Transistor's upload URL (`src/lib/platforms/transistor.ts`). Sunset Lounge shows with no per-show Transistor credential are then cross-posted, which downloads the MP3 again (`processor.ts` around the network cross-post).
- Thumbnails (YouTube, Transistor square crop, WordPress) are images. Negligible next to video.
- URL-sourced YouTube/Vimeo jobs download media with yt-dlp on Railway (`src/lib/jobs/video-downloader.ts`) and then upload it to GCS. That inbound write is free. A Vimeo job that also needs a YouTube upload downloads the full video to GCS and then downloads it back (`processor.ts` path 3).

A 2× to 3× video multiplier on 211.5 GiB written is 423–635 GiB. September's 518 GiB sits in that range (about **2.45×** the bytes written). That fit is a reconciliation, not a measurement. It is consistent with "most of the egress is Railway reading videos," with the AI path contributing a third read and retries filling the rest. Audio at 192 kbps is about 80 MiB per hour of program, so even a few dozen hours fetched three times (Deepgram, show feed, network feed) is on the order of **10–20 GiB, about $1–2 at list**. Treat audio as a $2/month line, not as the bill.

### After the read-once fix

Assume the other change lands and each video object is read once per processing run. Video egress for a 220 GiB month becomes about 220 GiB, plus on the order of 15 GiB of audio.

| | September actual | After read-once, same month, list price | After read-once, September effective rate |
| --- | ---: | ---: | ---: |
| Egress | $50.22 (518 GiB) | ~235 GiB × $0.12 = **$28** | ~235 GiB × $0.097 = **$23** |
| Storage (then 1,093 GiB / now 1,260 GiB) | $28.42 | $32.76 at today's size | $32.76 |
| Replication on 220 GiB written | $4.23 | $4.40 | $4.40 |
| **Total** | **$82.87** | **about $65** | **about $60** |

Read-once is worth doing and is assumed below. It does not remove the remaining full copy of every video crossing the public internet, and it does not change the fact that a 90 GB file is written to Railway's disk twice in the current code (once for ffmpeg, once for YouTube) under a **30-minute** cap on the whole job (`JOB_TIMEOUT_MS` in `processor.ts`). The in-process queue (`src/lib/jobs/job-queue.ts`) exists specifically because several of these downloads at once exhaust Railway memory. Default concurrency is 2.

Objects are not deleted after a successful distribute. `deleteFile` runs only from `deleteJob`. Nothing in the repo sets a lifecycle rule. The 1.35 TB is retained masters, and it grows by roughly the monthly upload volume.

## Same-region reads from a multi-region bucket

They are **not free**. Two official statements:

- Cloud Storage pricing, "Data transfer within Google Cloud": free when data "moves within the same location," with the note **"A region is not considered the same location as a multi-region, even if the region is within the geographic limits of a multi-region."** `us-central1` reading a `US` bucket does not qualify. A dual-region read is free only for a Google Cloud service located in one of the two regions that make up that dual-region (`nam4` read from `us-central1` is the documented example).
- Bucket locations: for a multi-region, **"Outbound data transfer charges always apply when reading data."** A regional bucket has "no outbound data transfer charges when reading data inside the same region."

So a Cloud Run service in `us-central1` reading `swm-producer-uploads` as it stands today pays the within-Google-Cloud rate, North America to North America: **$0.02 / GiB**. That is six times cheaper than internet egress and it is not zero. Getting to zero requires a bucket whose location is the Cloud Run region (a regional `us-central1` bucket, or a dual-region that includes `us-central1`). Bucket location cannot be changed in place.

YouTube, separately: VPC network pricing says data transfer **"to specific Google products such as Gmail, YouTube, Google Maps, DoubleClick, and Google Drive"** from a VM is **no charge**, whether the VM has an external or internal IP. Cloud Run's own pricing page says outbound internet data transfer is Premium Tier and billed at network rates, with 1 GiB/month free in North America, and it does not repeat the YouTube exemption. Treat "YouTube upload from Cloud Run is free" as **likely and unproven**. The proof is a precondition for either Cloud Run option.

## Option A — process video next to the bucket

### Shape that matches this code

Do not trigger on GCS `OBJECT_FINALIZE` (Eventarc / Pub/Sub). Finalize fires when the resumable upload completes, which is earlier than the app has a title, description, privacy, schedule, or thumbnail, and it also fires for thumbnails. The AI analysis and the distribute run are two different user actions (`/api/distribute/analyze` and `/api/upload/confirm`, plus platform retry in `src/app/dashboard/distribute/[id]/actions.ts` and `POST /api/jobs/process`). The app should enqueue, passing only the job id and which phase to run. YouTube refresh tokens live in `platform_credentials` and must not be placed on the task args, where they would land in logs.

Run the existing pipeline (`runAnalysis` / `processJob`) inside the Cloud Run job, using the same container image with a different command. Railway stays the web app and only enqueues. Splitting "bytes on Cloud Run, Transistor and WordPress still on Railway" saves little (those steps move megabytes, not the video) and requires cutting `processJob` in half.

Concrete changes:

| Piece | Change |
| --- | --- |
| New worker entrypoint | A Node script that loads `JOB_ID` and runs `runAnalysis` or `processJob`. Must not call `auth()`, `headers()`, or `cookies()`. `transcription.ts` imports `server-only`, which is fine in plain Node; confirm the import graph still runs outside a Next request. |
| `src/app/api/distribute/analyze/route.ts` | Replace in-process `enqueueJob(..., runAnalysis)` with a Cloud Run Jobs API `run` call. |
| `src/app/api/upload/confirm/route.ts` | Same for `processJob`. |
| `src/app/dashboard/distribute/[id]/actions.ts` | Platform retry starts the Cloud Run job instead of calling `processJob` in-process. |
| `src/app/api/jobs/process/route.ts` | Same, or it becomes the fallback path. |
| `src/lib/jobs/processor.ts` | Remove or sharply raise `JOB_TIMEOUT_MS` (30 minutes) for this runtime. A 90 GB upload plus ffmpeg does not fit in 30 minutes. Keep the "skip platforms already `completed`" behavior; that is what makes a retry safe. |
| `src/lib/jobs/audio-extractor.ts` | Stop `fetch`ing a signed URL to disk. Read the video from a GCS FUSE mount (seekable, which MP4 needs because `moov` is usually at the end of the file). Write the MP3 to the container's writable space and upload it with the Storage client. |
| `src/lib/platforms/youtube.ts` | Read the video from the FUSE path. The current "resumable" upload initiates a session and then PUTs the entire file in one request. A dropped connection on a 90 GB PUT starts over, and a retry after YouTube accepted the bytes but before the DB write can create a second video. Implement Content-Range resume, and do not mark the platform completed until the video id is stored. |
| `src/lib/gcs.ts`, browser uploader | No change for an A-only move. Bucket name stays an env var. |
| Dockerfile | Already installs ffmpeg, yt-dlp, and deno. Cloud Run job overrides the command; it should not run `scripts/migrate.mjs` on every task. |
| Job spec | Region `us-central1`. 4 vCPU / 8 GiB is the cost model's base; 8 vCPU / 16 GiB is the headroom case. Task timeout on the order of 24 hours (the hard limit is 168 hours). **Task retries = 0.** Retries stay on the existing button so Cloud Run does not blindly re-run a YouTube upload. Concurrency cap of 2, matching `MAX_CONCURRENT_JOBS`, so two  episodes do not stampede YouTube. |
| IAM and secrets | Runtime service account: `objectAdmin` on the bucket, Secret Manager accessor. Railway's existing GCP credential is granted only `run.jobs.runWithOverrides` (or equivalent) so it can start tasks. Secrets: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (token refresh in `src/lib/youtube-oauth.ts`), `DEEPGRAM_API_KEY`, and whatever the notification and WordPress calls need if the whole `processJob` moves. YouTube tokens stay in Postgres. The JSON key in `GCS_CREDENTIALS_JSON` is not required on the job if the runtime service account is attached. |
| Database | Railway Postgres over its public URL with TLS. A job is one-shot, so a Prisma client opened and closed per task is enough. Confirm the database's connection limit and that GCP egress IPs are allowed. |
| Logging | stdout goes to Cloud Logging. Job status the UI already reads stays in Postgres (`distribution_jobs`, `distribution_job_platforms`, metadata). Failure email stays inside `processJob`'s catch, so it still sends if the task actually runs that function. |

### 90 GB, memory, disk, ffmpeg

Cloud Run's container filesystem is an in-memory tmpfs capped by the memory limit, and memory maxes at **32 GiB**. A 90 GB MP4 cannot be written to `/tmp`. That rules out the current `extractAudio` pattern as-is.

Two supported ways to give ffmpeg a seekable file:

1. **GCS FUSE volume** ([Cloud Storage volume mounts for jobs](https://cloud.google.com/run/docs/configuring/jobs/cloud-storage-volume-mounts)). ffmpeg opens the mounted path and seeks. YouTube upload streams from the same path. FUSE reads are Cloud Storage reads: free if the bucket is regional `us-central1`, $0.02/GiB if the bucket stays US multi-region. Reading twice (ffmpeg, then YouTube) is therefore free on a regional bucket and $0.04/GiB on the current bucket. Do not write the video back through FUSE. FUSE stages a written object entirely in memory, and the memory ceiling is 32 GiB. The MP3 is small enough to write locally and upload with the client library.
2. **Ephemeral disk volume.** Real disk, minimum 10 GiB, billed at **$0.000109589 per GiB-hour** in `us-central1` for the whole provisioned size for the life of the instance. Default quota is **10 GB per instance and 100 GB per project per region**; a 90 GB file needs a quota increase, and the grant is not guaranteed from the docs. Copying 90 GB once also adds a full read and a chunk of wall time. Prefer FUSE. Use a small ephemeral disk only as scratch for the MP3 if `/tmp` pressure becomes real.

`ffmpeg -i pipe:0` is not a substitute. MP4s that were not written with `+faststart` keep the `moov` atom at the end, and a pipe is not seekable. The signed-URL input (`ffmpeg -i https://...`) can seek with range requests, but those ranges are still bytes leaving GCS, and on Cloud Run a signed-URL fetch is a worse way to hit the bucket than FUSE because the SKU is less obvious.

yt-dlp / deno for URL-sourced episodes can stay in this same job. That traffic is from YouTube or Vimeo into GCP (ingress, free) and is not the September egress line.

### Status, secrets, retries, observability

Status comes back through the same rows the UI polls. There is no second status channel to build, as long as the worker uses the existing Prisma updates.

Secrets are the operational risk. The worker needs the database URL and the Google OAuth client secret in order to refresh YouTube tokens the way `getYouTubeAccessToken` does today. Scope the runtime service account to this bucket and these secrets. Do not copy `GCS_CREDENTIALS_JSON` into the job env.

Cloud Run will restart a task on its own if retries are left at the default. Combined with the single-shot YouTube PUT, that can publish the episode twice. Set task retries to 0 and keep the manual retry, which already skips platforms in `completed`.

Observability is Cloud Logging plus the existing job page. Add a log-based alert on task failure, because a crashed task will not send the Resend email if it dies before `processJob`'s catch.

### Producer-facing performance

Upload speed and reliability stay on the current GCS resumable client. A regional bucket in Iowa instead of US multi-region can add some RTT for a producer far from Iowa. For multi-gigabyte resumable uploads, throughput is dominated by the producer's uplink, not by tens of milliseconds. This is a small risk, not a protocol change.

Processing latency should improve for large files. Cloud Run cold start is seconds against a job that already runs for many minutes. In-region FUSE throughput is far above the bitrate ffmpeg needs to decode. YouTube's upload endpoint is on Google's network, which is the path the current Railway hop is not. The 30-minute job cap and the Railway disk/memory cap go away; the replacement cap is the Cloud Run task timeout (set it in hours, not minutes).

### Cost

Cloud Run jobs in `us-central1` ([Cloud Run pricing](https://cloud.google.com/run/pricing)): $0.000018 per vCPU-second, $0.000002 per GiB-second, first 240,000 vCPU-seconds and 450,000 GiB-seconds free per month, 1-minute minimum, billed for the whole task lifetime.

Base case, labeled estimate: 40 jobs in a month (consistent with ~220 GiB at a few GiB per episode, against 874 objects in the bucket, many of which are MP3s and thumbnails), 60 minutes each, 4 vCPU, 8 GiB.

- vCPU: 40 × 3,600 × 4 = 576,000; minus 240,000 free; × $0.000018 = **$6.05**
- Memory: 40 × 3,600 × 8 = 1,152,000; minus 450,000 free; × $0.000002 = **$1.40**
- **Compute ≈ $7.50**, rounded to **$8** below.

Pessimistic case, labeled estimate: every job takes 2 hours on 8 vCPU and 16 GiB. vCPU $37, memory $8, **about $45**. That is the "we oversized every task and they all run long" case, not the expected bill. Ephemeral disk, if a 100 GiB volume were attached for those 40 hours, is 100 × 40 × $0.000109589 ≈ **$0.44**. It is not the cost driver.

#### A1 — Cloud Run, bucket stays US multi-region

No data migration. Video reads are $0.02/GiB, not free. One FUSE read of 220 GiB is $4.40. Two FUSE reads (ffmpeg and YouTube, no local copy) are $8.80. The table uses one read, matching the read-once intent; budget $9 if both consumers read through FUSE and the bucket has not moved.

| Line | Monthly, list | Notes |
| --- | ---: | --- |
| Storage, 1,260 GiB × $0.026 | $33 | Grows with retention |
| Replication, 220 GiB × $0.02 | $4.40 | Unchanged |
| Video read, 220 GiB × $0.02 | $4.40 | Within GCP, not internet |
| Audio leaving GCS to Deepgram and any remaining Railway fetch, ~15 GiB × $0.12 | $2 | Order-of-magnitude |
| YouTube upload | $0 | Only if the proof holds. If not: 220 × $0.12 = **$26** |
| Cloud Run | $8 | Base case. Pessimistic $45 |
| **Steady state** | **about $52** | **About $78 if YouTube is billed as internet egress** |

One-time migration cost: **$0**.

#### A2 — new regional bucket in `us-central1`, Cloud Run in `us-central1`

Reads in the same location are free, including a second FUSE read. Replication does not apply to a regional bucket. Storage rate drops from $0.026 to $0.020.

| Line | Monthly, list | Notes |
| --- | ---: | --- |
| Storage, 1,260 GiB × $0.020 | $25 | Plus about $4.40 for each additional month of video that is kept (220 GiB × $0.020) |
| Replication | $0 | |
| Video read | $0 | Same location |
| Audio egress, ~15 GiB × $0.12 | $2 | Deepgram and similar still pull from outside GCP |
| YouTube upload | $0 | Same proof as A1. If it fails, add ~$26 and do not cut over |
| Cloud Run | $8 | Base case |
| **Steady state at today's footprint** | **about $35** | Versus about $83 in September, and versus about $60–65 after read-once alone |

One-time copy of the existing objects, preserving keys, US multi-region to `us-central1`: within-Google-Cloud North America rate **1,260 GiB × $0.02 ≈ $25**. Class A operations on 874 objects are cents (multi-region Standard Class A is $0.01 per 1,000). Both buckets are billed for storage during the overlap; a few days of overlap is a few dollars, a month of overlap is another ~$33 on the old bucket. Do not use Storage Intelligence bucket relocation for this: that product adds its own per-GB fee on top of transfer. A Storage Transfer Service bucket-to-bucket copy, or `gcloud storage cp`, is the cheaper tool. Ingress to the new bucket is free. The copy does not incur multi-region replication on the destination, because the destination is regional.

Availability SLA goes from 99.95% (multi-region) to 99.9% (regional). Durability stays eleven 9s either way. The public copies of an episode are YouTube and Transistor. This bucket is the ingest inbox and the retained master. A regional outage blocks new processing; it does not take published episodes offline.

### Effort

A new deployable and a change to every place that starts `processJob` or `runAnalysis`. The browser upload path stays. The processor's control flow stays, with the timeout and the YouTube PUT as the two spots that have to change for 90 GB files to succeed. Packaging risk is the Next.js import graph under a non-request entrypoint. Secret and database-network setup is the other half of the work. Larger than a configuration change, smaller than a new upload protocol.

### Risks and failure modes

- **YouTube egress SKU.** If Cloud Run bills it at $0.12/GiB, A2's network savings disappear and the move adds compute on top. Gate on the proof. Do not discover this after cutover.
- **Duplicate YouTube videos** on retry, made worse if Cloud Run task retries are left on. Mitigate with retries = 0 and Content-Range resume.
- **FUSE and MP4.** A file whose `moov` atom is at the end causes a seek-heavy open. That is correct behavior and it is an extra partial read, not a second full copy, but a broken FUSE mount fails the task at startup (mount timeout is 30 seconds).
- **Database reachability.** Railway Postgres not accepting the Cloud Run connection, SSL mismatch, or exhausting connections if tasks overlap. The web app's own pool is separate.
- **Token refresh races.** Two tasks refreshing the same `platform_credentials` row. Rare at concurrency 2; the existing code already refreshes in place.
- **Split brain during rollback.** A task still running in Cloud Run after the flag points back at Railway can double-publish. Drain tasks before flipping the flag.
- **OAuth client and redirect.** Refresh uses the client id and secret; it does not need the web redirect URI. Do not point producers at a GCP URL.
- **90 GB task longer than expected.** ffmpeg has to decode the video to throw it away (`-vn` plus `libmp3lame`, not stream-copy). A high-bitrate 90 GB file can run for hours. The task timeout has to assume that. Cost stays in the pessimistic band above, not in a different order of magnitude.

### Rollback

Keep the Railway in-process path behind a flag (`process` locally versus `run` the job). Rollback of the runner is flipping the flag and redeploying Railway, after in-flight Cloud Run tasks finish.

Bucket rollback, for A2: leave the US multi-region bucket in place for a few weeks. `gcsPath` does not store the bucket name; the bucket comes from `GCS_BUCKET_NAME`. Copy objects with the same keys, switch the variable only after a second incremental copy of anything uploaded during the first copy, and switch back by restoring the old variable. Objects that exist only on the new bucket need a reverse copy (regional to multi-region, $0.02/GiB, plus replication on the multi-region write). Do the cutover when no upload is in progress.

### Billing proof (do this first, it is small)

From a Cloud Run job in `us-central1`, read about 10 GiB from the current US bucket and upload about 10 GiB to a private YouTube video, then delete the video. Read the billing export for the following days:

- A GCS "data transfer within Google Cloud" / North America SKU near **$0.20** means the $0.02 rate is real and A1's read math holds.
- An internet-egress SKU near **$1.20** on the read means the multi-region read was billed as internet and the locations doc's "charges always apply" was the $0.12 rate. A1 gets much worse; A2 (same-location read) is then the only Cloud Run variant that saves money.
- A network egress SKU near **$1.20** on the YouTube upload means the exemption does not apply to Cloud Run. Stop. Do not cut over.

Ten gibibytes is about $1.20 at risk if both hops are billed, and about $0.20 if only the read is.

## Option B — Cloudflare R2

R2 Standard, [published pricing](https://developers.cloudflare.com/r2/pricing/): **$0.015 / GB-month** storage, **$4.50 per million Class A** operations, **$0.36 per million Class B**, **egress $0**. Infrequent Access is $0.01 / GB-month with a $0.01 / GB retrieval fee and a 30-day minimum. Single-part upload max is **5 GiB**. Multipart max is 5 TiB, up to 10,000 parts, each part 5 MiB–5 GiB, and **every part except the last must be the same size**. Presigned URLs support GET, HEAD, PUT, and DELETE for up to 7 days. Presigned POST (HTML form) is not supported.

### What has to change

The GCS resumable protocol (`x-goog-resumable`, `Content-Range`, HTTP 308) does not exist on R2. A 90 GB file cannot use a single presigned PUT. The browser has to run S3 multipart.

| Piece | Change |
| --- | --- |
| `src/lib/gcs.ts` | Replace signed-URL helpers with an S3 client pointed at `https://<account>.r2.cloudflarestorage.com`, or hide both backends behind one module during transition. CreateMultipartUpload, presign UploadPart, CompleteMultipartUpload, AbortMultipartUpload, presign GetObject. |
| `src/app/api/upload/signed-url/route.ts` | Return an upload id and a batch of part URLs instead of one resumable URL. Part URLs expire; a long upload has to ask for the next batch. 16 MB parts (the live chunk size) are legal. 5 MB parts in the unused `video-upload.tsx` sit on R2's 5 MiB minimum; do not rely on that file. |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Replace the resumable loop. Upload parts, capture each ETag, retry a failed part, call complete. Parallel parts help throughput. This is the producer-facing risk. |
| `src/components/distribution/video-upload.tsx` | Unimported today. Update it or delete it so a later caller does not revive the GCS protocol. |
| `audio-extractor.ts`, `processor.ts` YouTube block, `transcription.ts`, `transistor.ts`, `image.ts` | Presigned GET instead of a GCS V4 read URL. Deepgram's `url` field fetches any HTTPS URL, so a presigned R2 GET works the same way a GCS signed URL works today. Transistor artwork is already "here is an HTTPS URL, fetch it within 4 hours"; a presigned GET with the same expiry works. YouTube still cannot ingest a URL. Something has to upload the bytes. That something remains Railway unless Option A is also built. |
| CORS | The bucket needs a rule for the portal origin, methods `PUT`, `GET`, `HEAD`, allowed headers including `Content-Type`, and **exposed `ETag`**. Without the exposed ETag the browser cannot complete the multipart upload. GCS must already allow the portal origin for the current resumable POST/PUT; R2 needs its own rule. |
| Credentials | R2 access key id and secret on Railway, in the existing secret store. Not committed. |
| Job records | `gcsPath` is a key, not a URL. Add a backend discriminator (column or metadata) so old keys stay on GCS and new keys go to R2. `deleteJob` has to delete from the backend that holds the object. |

Railway downloading from R2 is free on the R2 bill. The bytes still cross Railway's network: about 220 GiB in from R2 and about 220 GiB out to YouTube in a planning month, plus the audio. Whether Railway meters that depends on the plan; this report does not have the plan's egress allowance. Confirm it before treating R2 as a $0 move rather than a move of the egress bill from GCP to Railway.

Deepgram, Transistor, and YouTube keep working in the sense that none of them require the bytes to live on GCS. Deepgram and Transistor artwork need an HTTPS URL. YouTube needs the worker to possess the bytes. ffmpeg still needs a seekable local file, so the 90 GB disk copy and the 30-minute job cap remain.

### Migration versus new uploads only

New uploads only: point new jobs at R2, leave the 1.35 TB on GCS until a lifecycle rule or `deleteJob` removes it. No one-time egress. Storage savings appear only as the old bucket shrinks. Both backends run until the old objects are gone.

Full copy: Super Slurper or rclone. Super Slurper does not charge a transfer fee on the R2 side; objects over 100 MiB go up as multipart, and each part is a Class A operation. At $4.50 per million, even a pessimistic part count on 1.3 TB is a few dollars. The expensive side is GCS. Copying 1,260 GiB out to the internet is **1,260 × $0.12 = about $151** at list, or **about $122** at September's effective $0.097/GiB. GCS ingress on a rollback copy is free, and R2 egress on that rollback is free, so reversing the data copy is cheap. The $151 is paid on the way out of GCS.

Dual-read during transition is the discriminator above. Do not switch `GCS_BUCKET_NAME` globally; in-flight jobs hold keys in the old bucket.

### Steady-state cost

R2 bills decimal GB. 1.35 TB decimal = 1,350 GB × $0.015 = **$20.25/month** at today's size. Each extra month of retained uploads at 240 GB adds **$3.60/month** of storage.

Operations, labeled estimate. A 6 GB file in 16 MiB parts is about 400 Class A calls. Forty of those are 16,000 calls, about **$0.07**. A month of nothing but 90 GB files (40 × 5,760 parts) is about **$1**. Class B reads (one GET per Deepgram fetch, per ffmpeg download, per Transistor download) are thousands of calls, not millions, so they are cents. Infrequent Access is a poor fit for the first read, which happens the day of upload; a later transition of untouched objects to Infrequent Access saves $0.005/GB-month and charges $0.01/GB if an admin re-downloads a master.

| Line | Monthly |
| --- | ---: |
| R2 storage at today's size | $20 |
| R2 operations | about $1 |
| R2 egress | $0 |
| GCS, once the old bucket is emptied | $0 |
| **R2 steady state** | **about $21** |
| Railway bandwidth | unknown; confirm the plan |

Against September's $82.87 this is the lowest number in the report. It does not include a Railway egress charge if the plan has one, and it does not fix processing.

### Effort

The live upload function, a new multipart API, every signed-read caller, CORS, a backend flag on the job, and a copy plan. The upload change is the invasive one: it is the path producers use for files up to 90 GB, it has its own retry loop, and a bug shows up as a failed upload rather than as a slow job. Larger and more user-facing than Option A.

### Risks and failure modes

- **Multipart client bugs:** unequal part sizes, missing ETag, expired presign on a multi-hour upload, complete called twice, abandoned uploads that still count as stored parts until aborted. R2 stores in-progress parts. An abort-on-cancel path is required; the current cancel just drops the GCS session.
- **CORS mistakes** fail the upload in the browser only, which is easy to miss in server tests.
- **Two uploaders** drifting. The form is live; `video-upload.tsx` is not imported. A partial port leaves a trap.
- **Signed GET expiry.** The download helper defaults to 1 hour. Deepgram fetches immediately, so that is fine. A YouTube upload of a 90 GB file that starts with a 1-hour URL and then stalls is a problem only if the download itself exceeds an hour. Prefetch to disk first, as today, and the URL only has to survive the download.
- **Railway disk and the 30-minute cap** are unchanged. R2 removes the GCP egress line and leaves the reliability problem the job queue was written for.
- **Credential in the browser.** Presigned part URLs are the credential. Same trust model as today's signed resumable URL, with a longer maximum expiry (7 days). Keep each part URL short-lived and mint them in batches.
- **Cost moved, not removed,** if Railway bills egress.

### Producer-facing performance

A correct multipart upload with parallel 16 MB parts can be as fast as today's sequential 16 MB GCS chunks, and parallel parts can be faster. The risk is reliability during the rewrite: retries, resume after a laptop sleeps, and progress reporting all have to be rebuilt. GCS resumable upload has session resume semantics the current client only partly uses (it retries a chunk, it does not resume a session after a page reload). An R2 client can do better and can also ship worse. Processing latency is unchanged, because ffmpeg and YouTube still run on Railway.

### Rollback

Feature-flag new jobs onto R2. Old jobs keep reading GCS. Turning the flag off stops new R2 uploads. Objects already on R2 can be copied back without an R2 egress charge; GCS ingress is free. The hard rollback is a bad client already in producers' browsers: ship the flag so the server can hand out GCS resumable URLs again without a second client deploy, by keeping the old uploader in the same build for one release.

## Simpler alternatives

### Read-once only

Already assumed. Takes a September-like month from $50 of egress toward about **$23–28**. Storage and replication stay. No new system. Does not make 90 GB processing safe.

### Autoclass on the current bucket

[Autoclass charges](https://cloud.google.com/storage/pricing): **$0.0025 per 1,000 objects per 30 days**. At 874 objects that is under a cent. Objects under 128 KiB are not counted. Retrieval fees are not charged while Autoclass is enabled. US multi-region at-rest rates: Standard $0.026, Nearline $0.015, Coldline $0.00875, Archive $0.0030 per GiB-month (hourly rates × 730).

Objects that are never touched after the processing window cool on their own. A rough steady picture, labeled estimate, if about half of today's 1,260 GiB is old enough to be colder than Standard: storage falls from about $33 toward the high teens, and the gap widens as the archive grows. An admin "download video" or a retry reads the object and promotes it back to Standard. Autoclass does not remove replication ($0.02/GiB written, about $4/month) or internet egress.

Combined with read-once, a September-like month at today's footprint is on the order of **$23–28 egress + ~$18 cooled storage + $4.40 replication ≈ $45–50**, with no producer-facing change and no new runtime. That is the right move if Option A is deferred. It is not a substitute for A2 if the goal is to stop paying for every video byte to cross the internet.

### Delete source videos after distribute

There is no TTL in the code. A lifecycle rule that deletes objects after 90 days would cap storage near three months of uploads (about 660 GiB, about $17/month multi-region or $13/month regional) and stop the linear growth. That is a product decision. YouTube's copy is a transcode, not a master, and `deleteJob` is the only deletion path today, which implies the object is being kept on purpose. This report does not recommend turning that on without an explicit decision that the master can be discarded.

### Regional bucket without moving compute

Saves replication (about $4/month) and drops storage from $0.026 to $0.020 (about $8/month at today's size). Egress to Railway stays $0.12/GiB. One-time copy about $25. Small payback, and it is most of the migration work of A2 without the egress win. Not worth doing on its own. Worth doing as part of A2.

## Side-by-side

Figures are a steady month at today's stored size (~1,260 GiB) and 220 GiB of new video, after the read-once fix, at list price. Estimates are marked. September actual was $82.87 at a smaller stored size and with videos read more than once.

| | After read-once, bucket unchanged | Read-once + Autoclass | A1 Cloud Run, multi-region bucket | A2 Cloud Run + regional bucket | R2, old bucket emptied |
| --- | ---: | ---: | ---: | ---: | ---: |
| Storage | $33 | ~$18 estimate | $33 | $25 | $20 |
| Replication | $4 | $4 | $4 | $0 | $0 |
| Video egress | $26 | $26 | $4 | $0 | $0 |
| Audio egress | ~$2 | ~$2 | ~$2 | ~$2 | $0 |
| Compute | $0 | $0 | ~$8 | ~$8 | $0 |
| **Monthly** | **~$65** | **~$50** | **~$52** | **~$35** | **~$21** |
| One-time | $0 | $0 | $0 | ~$25 copy | ~$151 GCS egress, or $0 if old objects are left to age out |
| Upload path changes | No | No | No | No, aside from which regional endpoint the signed URL hits | Yes, multipart rewrite |
| 90 GB processing limit | Still Railway disk and 30 min | Same | Moved; timeout in hours | Moved; timeout in hours | Still Railway disk and 30 min |
| YouTube-egress assumption | n/a | n/a | Required | Required | n/a |

A1's $52 becomes about $78 if the YouTube exemption does not apply to Cloud Run, which is worse than doing nothing beyond read-once. A2 becomes about $61 in that same failure, still similar to read-once and not worth the migration. That is why the proof comes first.

## Recommendation, again

1. Let the read-once change land. It is the only change that cuts the September egress line without a new system.
2. Spend about a dollar on the Cloud Run billing proof (10 GiB read from the US bucket, 10 GiB upload to a private YouTube video).
3. If YouTube egress is $0, build **A2**: Cloud Run job in `us-central1` running the existing processor, GCS FUSE, new regional bucket, app-enqueued, task retries off, Railway path kept as a flag. Steady state about **$35/month** at today's footprint versus **$83** in September, one-time about **$25**, upload protocol unchanged. Add Autoclass on the regional bucket afterward if masters are still kept for months; the management fee is negligible and colder classes are cheaper than $0.020.
4. If the proof shows YouTube egress billed at internet rates, do not build A. Turn on Autoclass and stop. Expected bill about **$50/month** and falling slowly as objects cool, with the remaining ~$26 of video egress accepted.
5. Do not lead with R2. It is the cheapest row in the table and the one that rewrites the upload producers depend on, while leaving 90 GB ffmpeg and YouTube IO on Railway.

A2 carries meaningful technical risk on the processing cutover (second runtime, secrets, database access, duplicate-upload behavior, FUSE). It does not carry much performance risk for producers: the upload stays a GCS resumable upload, and processing moves onto a runtime that can actually hold the time and the file size this app already accepts. The cost risk is gated by the proof; without a passing proof the recommendation is Autoclass plus read-once, not a migration.
