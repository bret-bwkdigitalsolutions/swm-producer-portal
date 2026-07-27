# swm-producer-portal — Living State

## What This Is
A podcast producer portal that turns raw episode audio into distributed, multi-platform content. A small internal producer team uses it to pull episodes in from Transistor.fm, generate transcripts, produce AI-assisted (including bilingual) blog posts with human-in-the-loop editing, and push finished content out to WordPress, YouTube, and Transistor — including a premium track that gates content behind private shows, unlisted videos, and paywalled posts. It also manages the live-recording lifecycle (YouTube livestream → podcast episode), tracks per-show analytics across platforms, and manages per-show user access for the team.

## How to Run & Access
Run locally with `npm run dev` (Next.js dev server on http://localhost:3000). Database schema and seed data go through Prisma 7 with the `pg` driver adapter (`@prisma/adapter-pg`), configured in `prisma.config.ts`; seeding runs via `npx tsx prisma/seed.ts`. Tests run with `npm run test` (Vitest) and `npm run test:smoke` (`scripts/smoke-test.ts`); linting is `npm run lint`.

Production is a multi-stage Docker build producing a Next.js standalone server (`output: "standalone"` in `next.config.ts`). The image installs FFmpeg, a pinned yt-dlp nightly build, and Deno — required for video/audio processing and the Transistor scraper subsystem — and runs pending Prisma migrations automatically via `scripts/migrate.mjs` before starting `server.js` on port 3000.

No deployment target (Vercel, Cloud Run, Fly, etc.) is declared anywhere in the repo — there is no `vercel.json` and no deploy step in CI. The only GitHub Actions workflow (`notify-obsidian-hub.yml`) pings an external documentation hub, not a deploy pipeline. Given the app's dependency on Postgres, Google Cloud Storage, Upstash Redis, Deepgram, and Anthropic, it clearly runs on some container platform in production, but neither the host nor a production URL is evidenced in-repo.

## Site Map / Content Structure
*(Routes inferred from `docs/superpowers/specs`, `docs/superpowers/plans`, and README's App Router convention; exact file paths under `app/` are not fully visible in the provided tree.)*

- `/` — public landing page
- `/privacy`, `/terms` — static legal pages
- `/admin` — dashboard home / activity overview
- `/admin/shows` — per-show config: platform links, hosts, AI style guides, season/episode numbering scheme, language settings, premium settings
- `/admin/shows/sync` — episode sync trigger from Transistor.fm
- `/admin/credentials` — platform credential list with OAuth health status
- `/admin/credentials/[showId]` — per-show credentials, YouTube channel verification, connected-account display, per-identity cookie isolation
- `/admin/blog-ideas` — AI-generated blog ideas grouped by episode, collapsible groups, keyword/tag support, custom prompt controls
- `/admin/blog-ideas/import` — manual blog import from Google Docs, docx (`mammoth`) support, AI-assisted metadata extraction
- `/admin/live-recordings` — livestream-to-podcast workflow tracker, premium toggle per recording
- `/admin/social-accounts` — social platform connections feeding follower/analytics reporting
- `/admin/analytics` — network-wide and per-show analytics, combined platform overview, YouTube demographics
- `/admin/users`, `/admin/users/[id]` — invite flow, role and per-show access management
- `/admin/activity` — activity/audit log
- `/reaction` — public-facing content reaction submission form
- `/api/distribute/analyze` — AI content analysis (titles, metadata), runs in background for URL-sourced jobs
- `/api/distribute/[id]` — distribution pipeline endpoint, premium-aware routing across platforms
- `/api/upload/thumbnail` — image upload with EXIF correction, compression, and crop support
- `/api/scraper/trigger` — Transistor dashboard scraper trigger
- `/api/webhooks/subscription` — inbound webhook for website subscription events, synced to Transistor subscriber lists

## Current Architecture
Next.js 16 (App Router) on React 19, PostgreSQL via Prisma 7 with the `pg` driver adapter, NextAuth v5 for auth (Google OAuth plus invite-based accounts with bcrypt-hashed credential fallback). Content generation runs on Anthropic Claude via the official SDK, with the model ID read from `ANTHROPIC_MODEL` rather than hardcoded and a startup health check that pings the configured model and emails an admin if it comes back retired — a direct response to a production incident where a hardcoded model (`claude-sonnet-4-20250514`) was silently retired mid-flight.

Episode ingestion runs through a standalone scraper (`scripts/transistor-scraper`, Deno-based per its own Docker stage) that logs into the Transistor dashboard to pull data the public API doesn't expose. Transcription uses Deepgram. Video handling combines `@distube/ytdl-core` with a containerized, version-pinned yt-dlp binary — pinned because YouTube's player API changes faster than yt-dlp's stable release cadence — plus per-YouTube-identity cookie isolation to prevent cross-account auth conflicts, and full Vimeo-source video download as an intermediate asset for YouTube re-upload. Media lives in Google Cloud Storage; images go through `sharp` and `react-image-crop` for EXIF-safe resizing and manual cropping. WordPress publishing goes through its REST API with SEO fields, categories, and premium-gating support. Upstash Redis handles caching/rate limiting. Resend sends transactional email (invites, health-check alerts). Tiptap powers rich-text editing; `mammoth` handles docx import; `marked` renders Markdown server-side.

The premium content model threads an `isPremiumOnly` flag from live recordings through to distribution jobs, which route to a private Transistor show, an unlisted YouTube upload, and a gated WordPress post, with verification logic that skips public-URL checks for gated content. A Transistor subscriber API client plus a nightly reconciliation cron keep premium show access in sync with website subscription state, driven by an inbound webhook receiver — a two-path sync design (webhook for immediacy, cron for correctness) that hedges against dropped or delayed webhook deliveries.

Distribution jobs are the system's most concurrency-sensitive surface: the code carries atomic guards on retries, race-safe metadata merges across every job writer, and persisted verification schedules that survive process restarts, plus explicit recovery for AI-analysis pipelines killed by server restarts. This is evidence of hardening an existing model under production load rather than a from-scratch redesign — the original design under-accounted for concurrent writes and mid-flight restarts.

Access control is enforced per-show throughout (`verifyShowAccess`), with admins granted an explicit bypass; a recent fix closed a gap where that bypass wasn't applied consistently, and aggregated analytics actions now require show access explicitly. An extensive `docs/superpowers/specs/` and `docs/superpowers/plans/` archive documents feature-by-feature design work — the project follows a spec-then-implement workflow rather than ad hoc feature addition.

## What Works Today
- Episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, and transcript generation, filtering out duplicate/archived shows by name
- AI blog post generation from transcripts via Claude, with per-show style guides that adapt from human edits (voice learning) and per-show custom prompts
- Bilingual blog post generation with a primary-language field per post
- Episode keyword/tag extraction and storage
- Google Docs-based collaborative editing with automated AI-vs-human edit-percentage tracking and edit detection
- Distribution to WordPress (SEO fields, categories, formatted transcript, premium gating) and YouTube (AI-suggested titles capped at 100 characters, thumbnail cropping, premium routing to unlisted uploads, YouTube Studio reminder for premium distributions)
- Full Vimeo video download as a source asset for YouTube uploads in the distribution pipeline
- Manual blog import directly from Google Docs (including docx) with AI-assisted metadata auto-fill
- Live recording lifecycle tracking from YouTube stream creation through podcast handoff, with a premium toggle
- Configurable per-show season/episode numbering schemes
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress
- Premium-aware, tiered verification (30s/2m/10m/30m checks) that skips public-URL checks for gated content and survives process restarts
- Nightly Transistor subscriber reconciliation plus a webhook receiver, keeping premium show access aligned with website subscription state
- Startup AI-model health check that alerts an admin by email if the configured Claude model is retired
- Per-show access control on admin actions, including aggregated analytics, with an explicit admin bypass

## Recent Activity
**Distribution pipeline concurrency hardening (mid-June, the bulk of recent engineering effort):** atomic guards on `retryPlatform` to stop duplicate uploads, race-safe metadata merges across all `distributionJob` writers, persisted verification schedules that survive restarts, recovery for AI-analysis pipelines killed mid-run, background execution of AI analysis to dodge proxy timeouts, and Transistor platform failures now surfaced instead of silently passing when publish/schedule steps fail. This reads as a concentrated push to make the distribution system correct under real production concurrency, not just under happy-path testing.

**Premium content and subscriber sync (early June):** Transistor subscriber API client, nightly reconciliation cron for private-show access, inbound webhook receiver for website subscription events, and a YouTube Studio reminder for premium distributions — building out the full premium gating loop end to end.

**AI model resilience (mid-June):** fixed a retired hardcoded Anthropic model ID, made the model configurable via `ANTHROPIC_MODEL`, and added a startup health check that emails an admin if the configured model is retired — direct hardening against a class of failure that already happened once in production.

**Access control and correctness fixes (mid-to-late June):** admin bypass fix in `verifyShowAccess`, required show access on aggregated analytics actions, credential-exposure and URL-validation fixes, YouTube-identity cookie isolation fixes, and cleanup of a temporary admin endpoint that had been shipped to patch a playlist bug directly in production.

**Show-list correctness (late June, most recent code changes):** two consecut

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-07-27_
