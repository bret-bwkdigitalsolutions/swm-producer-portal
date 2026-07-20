# swm-producer-portal — Living State

## What This Is
A podcast producer portal that turns raw episode audio into distributed, multi-platform content. A small internal producer team uses it to pull episodes in from Transistor.fm, generate transcripts, produce AI-assisted blog posts with human-in-the-loop editing, and push finished content out to WordPress, YouTube, and Transistor — including a premium track that gates content behind private shows, unlisted videos, and paywalled posts. It also manages the live-recording lifecycle (YouTube livestream → podcast episode) and tracks per-show user access for the team.

## How to Run & Access
Run locally with `npm run dev` (Next.js dev server on http://localhost:3000). Database migrations and seeding go through Prisma (`npx prisma migrate`, `npx tsx prisma/seed.ts`, configured via `prisma.config.ts`). Tests run via `npm run test` (Vitest) and `npm run test:smoke` (`scripts/smoke-test.ts`). Linting is `npm run lint`.

Production is a multi-stage Docker build producing a Next.js standalone server (`output: "standalone"` in `next.config.ts`). The image bakes in FFmpeg, a pinned yt-dlp nightly build, and Deno — all required for video/audio processing and the transistor-scraper subsystem — and runs pending Prisma migrations automatically via `scripts/migrate.mjs` before starting `server.js` on port 3000.

No deployment target (Vercel, Cloud Run, Fly, etc.) is declared anywhere in the repo — no `vercel.json`, no cloud deploy workflow. The only GitHub Actions workflow (`notify-obsidian-hub.yml`) pings an external documentation hub and does not deploy. Given the Postgres, GCS, and Redis dependencies, the app clearly runs on a container platform in production, but the target and production URL are not evidenced in-repo — this doc cannot state where it's actually live.

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
- `/api/scraper/trigger` — Transistor dashboard scraper trigger
- `/api/webhooks/subscription` — inbound webhook for website subscription events, synced to Transistor

## Current Architecture
Next.js 16 (App Router) on React 19, PostgreSQL via Prisma 7 with the `pg` adapter (`@prisma/adapter-pg`), NextAuth v5 for auth (Google OAuth plus invite-based accounts). Content generation runs on Anthropic Claude through the official SDK. The model ID is now read from `ANTHROPIC_MODEL` rather than hardcoded, and a startup health check pings the configured model and emails an admin if it comes back retired — a direct response to a production incident where a hardcoded model (`claude-sonnet-4-20250514`) was silently retired.

Episode ingestion runs through a standalone Playwright-style scraper (`scripts/transistor-scraper`) that logs into the Transistor dashboard and pulls episode data the public API doesn't expose. Transcription uses Deepgram. Video handling combines `@distube/ytdl-core` with a containerized, version-pinned yt-dlp binary — pinned because YouTube's player API changes faster than yt-dlp's stable release cadence — with per-YouTube-identity cookie isolation to prevent cross-account auth conflicts. Media assets live in Google Cloud Storage; images go through `sharp` for EXIF-safe resizing and cropping. WordPress publishing goes through its REST API with SEO fields and premium-gating support. Upstash Redis handles caching and rate limiting. Resend sends transactional email (invites, health-check alerts). Tiptap powers rich-text editing; `mammoth` handles docx import for manually-authored posts.

The premium content model threads an `isPremiumOnly` flag from live recordings through to distribution jobs, which route to a private Transistor show, an unlisted YouTube upload, and a gated WordPress post, with verification logic that skips public-URL checks for gated content. A Transistor subscriber API client plus a nightly reconciliation cron keep premium show access in sync with website subscription state, driven by an inbound webhook receiver — a two-path sync design (webhook for immediacy, cron for correctness) that hedges against dropped or delayed webhook deliveries.

Distribution jobs are the system's most concurrency-sensitive surface. The schema and job-processing code have been retrofitted with atomic guards on retries, race-safe metadata merges across every job writer, and persisted verification schedules that survive process restarts — evidence that the original design under-accounted for concurrent writes and mid-flight restarts, and the team is hardening the existing model rather than redesigning it.

## What Works Today
- Episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, and transcript generation
- AI blog post generation from transcripts via Claude, with per-show style guides that adapt after repeated human edits
- Google Docs-based collaborative editing with automated AI-vs-human edit-percentage tracking
- Distribution to WordPress (SEO fields, categories, formatted transcript, premium gating) and YouTube (AI-suggested titles capped at 100 characters, thumbnail cropping, premium routing to unlisted uploads)
- Full Vimeo video download as a source asset for YouTube uploads in the distribution pipeline
- Manual blog import directly from Google Docs with AI-assisted metadata auto-fill
- Live recording lifecycle tracking from YouTube stream creation through podcast handoff, with a premium toggle
- Configurable per-show season/episode numbering schemes
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress
- Premium-aware, tiered verification (30s/2m/10m/30m checks) that skips public-URL checks for gated content and survives process restarts
- Atomically-guarded, race-safe distribution job writes that prevent duplicate uploads under concurrent retries
- Background AI analysis for URL-sourced jobs to avoid proxy timeouts, with recovery for pipelines killed by restarts
- Configurable Anthropic model selection with a startup health check and admin email alert on model retirement
- Transistor subscriber sync via webhook plus nightly reconciliation cron for premium shows
- YouTube Studio reminder surfaced for premium distributions requiring a manual step
- Show list correctly excludes archived shows and de-duplicates by name
- Admin users bypass per-show access checks correctly
- User invitation flow with role-based access and last-login tracking
- Content reaction submission form with show association
- Appearance gallery management with 16:9 hero cropping

## Recent Activity
Momentum over the past several weeks has moved through three distinct phases:

**Premium distribution buildout** — the premium/gated-content track (private Transistor shows, unlisted YouTube uploads, gated WordPress posts) is built end-to-end: `isPremiumOnly` threading from live recordings into distribution jobs, premium-aware verification, a Transistor subscriber API client, a webhook receiver for website subscription events, and a nightly reconciliation cron.

**Distribution pipeline hardening** — immediately following the premium buildout, a concentrated pass of correctness fixes lands on the same pipeline: atomic guards against duplicate uploads on retry, race-safe metadata merges across all job writers, persisted verification schedules that survive restarts, recovery for analyze pipelines killed by restarts, backgrounding of AI analysis to dodge proxy timeouts, and a security fix requiring show access on aggregated analytics actions. This reads as a response to real production failure modes rather than proactive polish.

**Operational cleanup** — most recently, attention shifts to access-control and data-correctness bugs: admin users bypassing show-access checks correctly, archived shows being filtered out of the portal list via a name-based de-dupe (replacing a distrusted `is_archive_show` flag), and a full Vimeo video download path added to the distribution pipeline for YouTube re-uploads. A temporary admin endpoint for manually fixing a YouTube playlist was added and then deliberately removed, alongside cleanup of accidentally committed local files.

The trajectory: premium content is now feature-complete and the team's energy has moved to trust and correctness — fixing access-control edge cases and pipeline race conditions rather than adding new surface area.

## Known Gaps & Limitations
- No documented production deployment target or URL exists in-repo; operational knowledge of where this runs lives outside the codebase
- Social account analytics UI exists (`/admin/social-accounts`) but the underlying analytics integration is not evidenced as wired up
- The distribution pipeline required multiple rounds of concurrency fixes (atomic guards, race-safe merges, restart recovery) after initial implementation — its correctness under load has been reactive, not designed-in, and further edge cases may still exist
- The transistor-scraper subsystem depends on scraping the Transistor dashboard UI rather than an official API, which is inherently fragile to any UI changes on Transistor's side
- YouTube uploads still require a manual "YouTube Studio reminder" step for premium content — the premium YouTube flow is not fully automated
- yt-dlp is pinned to a specific nightly build that requires manual bumping when YouTube changes break downloads (documented as an expected recurring maintenance task, not a one-off fix)
- A temporary admin endpoint for fixing YouTube playlist membership was added and removed within the same week, suggesting the playlist-management flow has an unresolved gap that was patched manually rather than fixed at the root

## Next Meaningful Capabilities
- Full YouTube Studio automation for premium content, removing the last manual step in the premium distribution path
- Live analytics on the social accounts screen, turning an existing UI shell into an actual reporting surface
- A supported, non-scraped path to Transistor episode data, removing dependency on browser automation for core ingestion
- Staging environment and documented deployment pipeline, closing the current gap where production topology is undocumented
- Automated root-cause fix for YouTube playlist membership issues, replacing the ad hoc admin endpoint pattern already used once

## Open Technical Questions
- Where does this actually deploy, and is there a staging environment distinct from production? Not answered anywhere in-repo.
- Is the current per-job atomic-guard/race-safe-merge approach to distribution concurrency the long-term design, or a stopgap ahead of a more structural rework (e.g., a proper job queue with leader election)?
- Should the Transistor dashboard scraper be replaced once/if Transistor exposes the needed data via API, or is scraping considered a permanent integration strategy?
- Is the webhook + nightly-cron dual-path subscriber sync intended to stay dual-path long-term, or is the cron a temporary safety net for an unreliable webhook?

## Key Files & Entry Points
- `prisma/schema.prisma` — full data model: shows, episodes, blog posts, distribution jobs, live recordings, credentials, social accounts
- `Dockerfile` — production build: standalone Next.js server plus pinned FFmpeg/yt-dlp/Deno toolchain
- `scripts/migrate.mjs` — runs pending Prisma migrations on container start before the server boots
- `scripts/transistor-scraper/index.ts` — dashboard-scraping entry point for episode ingestion
- `next.config.ts` — standalone output, server-external packages, server action body size limit
- `prisma/seed.ts` — database seeding entry point
- `docs/youtube-cookie-refresh.md` — operational doc for maintaining yt-dlp/cookie auth as YouTube changes
- `docs/live-recording-setup.md` — live-recording-to-podcast workflow documentation
- `AGENTS.md` / `CLAUDE.md` — agent operating instructions for AI-assisted development on this repo
- `docs/superpowers/specs/2026-06-05-premium-content-distribution.md` — design spec for the premium content track

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub)_

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-07-20_
