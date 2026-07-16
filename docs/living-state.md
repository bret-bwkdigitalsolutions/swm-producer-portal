# swm-producer-portal — Living State

## What This Is
A podcast producer portal that turns raw episode audio into distributed, multi-platform content. Podcast producers use it to pull episodes in from Transistor.fm, generate transcripts, produce AI-assisted blog posts with human-in-the-loop editing, and push finished content out to WordPress, YouTube, and Transistor — including a premium track that gates content behind private shows, unlisted videos, and paywalled posts. It also manages the live-recording lifecycle (YouTube livestream → podcast episode) and tracks user access across shows for a small internal producer team.

## How to Run & Access
Run locally with `npm run dev` (Next.js dev server on http://localhost:3000). Database migrations and seeding go through Prisma (`npx prisma migrate`, `npx tsx prisma/seed.ts`). Tests run via `npm run test` (Vitest) and `npm run test:smoke` (a standalone smoke-test script). Linting is `npm run lint`.

The production image is a multi-stage Docker build producing a Next.js standalone server. It bakes in FFmpeg, a pinned yt-dlp nightly build, and Deno (both needed for video/audio processing and the transistor-scraper subsystem), and runs pending Prisma migrations automatically via `scripts/migrate.mjs` before starting `server.js` on port 3000. No deployment target (Vercel, Cloud Run, Fly, etc.) is declared in the repo — there's no vercel.json, no cloud deploy workflow, and no documented production URL. The `.github/workflows/notify-obsidian-hub.yml` workflow only pings this documentation hub; it does not deploy. Given the GCS and Postgres dependencies, the app is presumably deployed to a container platform, but this is not evidenced in-repo.

## Site Map / Content Structure
- `/` — public landing page
- `/privacy`, `/terms` — static legal pages
- `/admin` — dashboard home with activity overview
- `/admin/shows` — show configuration: platform links, hosts, AI style guides, season numbering scheme, premium settings
- `/admin/shows/sync` — episode sync trigger from Transistor.fm
- `/admin/credentials` — platform credential list with OAuth health status
- `/admin/credentials/[showId]` — per-show credentials, YouTube channel verification, connected account display
- `/admin/blog-ideas` — AI-generated blog ideas grouped by episode, collapsible
- `/admin/blog-ideas/import` — manual blog import from Google Docs with AI-assisted metadata extraction
- `/admin/live-recordings` — livestream-to-podcast workflow tracker, premium toggle per recording
- `/admin/social-accounts` — social platform connection UI (shell; analytics not yet wired up)
- `/admin/users`, `/admin/users/[id]` — invite flow, role/access management
- `/admin/activity` — activity/audit log
- `/reaction` — public-facing content reaction submission form
- `/api/distribute/analyze` — AI content analysis (titles, metadata suggestions)
- `/api/distribute/[id]` — distribution pipeline endpoint, premium-aware routing across platforms
- `/api/upload/thumbnail` — image upload with EXIF correction and compression
- `/api/scraper/trigger` — Transistor scraper trigger
- `/api/webhooks/subscription` — inbound webhook for website subscription events, synced to Transistor

## Current Architecture
Next.js 16 (App Router) on React 19, PostgreSQL via Prisma 7 with the `pg` adapter (`@prisma/adapter-pg`), NextAuth v5 for auth (Google OAuth + invite-based accounts). Content generation runs on Anthropic Claude through the official SDK — the model is now read from `ANTHROPIC_MODEL` rather than hardcoded, and a startup health check pings the configured model and emails an admin if it comes back retired, a direct response to a recent production incident where a hardcoded model ID (`claude-sonnet-4-20250514`) was retired without warning.

Episode ingestion runs through a standalone Playwright-based scraper (`scripts/transistor-scraper`) that logs into the Transistor dashboard and pulls episode data the API doesn't expose. Transcription uses Deepgram. Video handling uses `@distube/ytdl-core` plus a containerized yt-dlp binary (pinned nightly, since YouTube's player API outpaces yt-dlp's stable releases) with per-YouTube-identity cookie isolation to avoid cross-account auth conflicts. Media assets live in Google Cloud Storage; images go through `sharp` for EXIF-safe resizing. WordPress publishing goes through its REST API with SEO fields and premium-gating support. Upstash Redis handles caching/rate limiting. Resend sends transactional email (invites, health-check alerts). Tiptap powers the rich-text editing surfaces; `mammoth` handles docx import for manually-authored posts.

The premium content model threads an `isPremiumOnly` flag from live recordings through to distribution jobs, which then route to a private Transistor show, an unlisted YouTube upload, and a gated WordPress post — with verification logic aware enough to skip public-URL checks for gated content. A Transistor subscriber API client and a nightly reconciliation cron keep premium show access in sync with website subscription state, driven by an inbound webhook receiver.

Distribution jobs are the system's most concurrency-sensitive area: recent work has added atomic guards on retries, race-safe metadata merges across all job writers, and persisted verification schedules — evidence that the original design under-accounted for concurrent writes and process restarts, and the team is actively hardening it rather than redesigning it.

## What Works Today
- Episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, and transcript generation
- AI blog post generation from transcripts using Claude, with per-show style guides that adapt after 2+ human edits
- Google Docs-based collaborative editing with automated edit-percentage tracking (AI vs. human contribution)
- Distribution to WordPress (SEO fields, categories, formatted transcript, premium gating) and YouTube (AI-suggested titles capped at 100 characters, thumbnail cropping, premium routing to unlisted uploads)
- Full Vimeo video download as a source for YouTube uploads in the distribution pipeline
- Manual blog import directly from Google Docs with AI-assisted metadata auto-fill
- Live recording lifecycle tracking from YouTube stream creation through podcast handoff, with a premium toggle
- Configurable per-show season/episode numbering schemes
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress
- Premium-aware verification that skips public-URL checks for gated content, with tiered verification checks (30s/2m/10m/30m) that survive process restarts
- Race-safe, atomically-guarded distribution job writes that prevent duplicate uploads under concurrent retries
- Background AI analysis for URL-sourced jobs (avoids proxy timeouts) with recovery for pipelines interrupted by restarts
- Configurable Anthropic model selection with a startup health check that emails an admin if the model is retired
- Transistor subscriber sync: webhook-driven updates plus a nightly reconciliation cron for premium shows
- YouTube Studio reminder surfaced for premium distributions requiring a manual step
- Show list correctly excludes archived shows and de-duplicates by name (moved off an unreliable `is_archive_show` flag)
- Admin users bypass per-show access checks correctly in `verifyShowAccess`
- User invitation flow with role-based access and last-login tracking
- Content reaction submission form with show association
- Appearance gallery management with 16:9 hero cropping

## Recent Activity
The last few weeks show a clear pivot from **feature buildout** to **reliability and correctness hardening** on the distribution pipeline.

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-07-16_
