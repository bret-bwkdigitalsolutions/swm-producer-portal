# swm-producer-portal — Living State

## What This Is
A podcast producer portal that turns raw episode audio into distributed, multi-platform content. A small internal producer team uses it to pull episodes in from Transistor.fm, generate transcripts, produce AI-assisted (and now bilingual) blog posts with human-in-the-loop editing, and push finished content out to WordPress, YouTube, and Transistor — including a premium track that gates content behind private shows, unlisted videos, and paywalled posts. It also manages the live-recording lifecycle (YouTube livestream → podcast episode), tracks per-show analytics across platforms, and manages per-show user access for the team.

## How to Run & Access
Run locally with `npm run dev` (Next.js dev server on http://localhost:3000). Database migrations and seeding go through Prisma 7 with the `pg` driver adapter (`npx prisma migrate`, `npx tsx prisma/seed.ts`, configured via `prisma.config.ts`). Tests run via `npm run test` (Vitest) and `npm run test:smoke` (`scripts/smoke-test.ts`); linting is `npm run lint`.

Production is a multi-stage Docker build producing a Next.js standalone server (`output: "standalone"` in `next.config.ts`). The image bakes in FFmpeg, a pinned yt-dlp nightly build, and Deno — required for video/audio processing and the transistor-scraper subsystem — and runs pending Prisma migrations automatically via `scripts/migrate.mjs` before starting `server.js` on port 3000.

No deployment target (Vercel, Cloud Run, Fly, etc.) is declared anywhere in the repo — no `vercel.json`, no cloud deploy workflow. The only GitHub Actions workflow (`notify-obsidian-hub.yml`) notifies an external documentation hub and does not deploy anything. Given the Postgres, GCS, and Redis dependencies, the app clearly runs on some container platform in production, but neither the target nor a production URL is evidenced in-repo.

## Site Map / Content Structure
- `/` — public landing page
- `/privacy`, `/terms` — static legal pages
- `/admin` — dashboard home with activity overview
- `/admin/shows` — show configuration: platform links, hosts, AI style guides, season/episode numbering scheme, language settings, premium settings
- `/admin/shows/sync` — episode sync trigger from Transistor.fm
- `/admin/credentials` — platform credential list with OAuth health status
- `/admin/credentials/[showId]` — per-show credentials, YouTube channel verification, connected account display, per-identity cookie isolation
- `/admin/blog-ideas` — AI-generated blog ideas grouped by episode, collapsible groups, keyword/tag support, custom prompt controls
- `/admin/blog-ideas/import` — manual blog import from Google Docs with AI-assisted metadata extraction and docx (`mammoth`) support
- `/admin/live-recordings` — livestream-to-podcast workflow tracker, premium toggle per recording
- `/admin/social-accounts` — social platform connection UI, with follower/analytics data feeding into reporting (per `docs/plans/…follower-analytics-plan.md`)
- `/admin/analytics` (naming inferred from `docs/superpowers/specs/*analytics*`) — network-wide and per-show analytics, combined overview across platforms, YouTube demographics breakdown
- `/admin/users`, `/admin/users/[id]` — invite flow, role/access management
- `/admin/activity` — activity/audit log
- `/reaction` — public-facing content reaction submission form
- `/api/distribute/analyze` — AI content analysis (titles, metadata suggestions), runs in background for URL-sourced jobs to avoid proxy timeouts
- `/api/distribute/[id]` — distribution pipeline endpoint, premium-aware routing across platforms
- `/api/upload/thumbnail` — image upload with EXIF correction, compression, and crop support
- `/api/scraper/trigger` — Transistor dashboard scraper trigger
- `/api/webhooks/subscription` — inbound webhook for website subscription events, synced to Transistor subscriber lists

## Current Architecture
Next.js 16 (App Router) on React 19, PostgreSQL via Prisma 7 with the `pg` driver adapter (`@prisma/adapter-pg`), NextAuth v5 for auth (Google OAuth plus invite-based accounts, bcrypt-hashed credentials as fallback). Content generation runs on Anthropic Claude via the official SDK. The model ID is read from `ANTHROPIC_MODEL` rather than hardcoded, and a startup health check pings the configured model and emails an admin if it comes back retired — a direct response to a production incident where a hardcoded model (`claude-sonnet-4-20250514`) was silently retired mid-flight.

Episode ingestion runs through a standalone scraper (`scripts/transistor-scraper`, Deno-based per its own Docker stage) that logs into the Transistor dashboard and pulls episode data the public API doesn't expose. Transcription uses Deepgram. Video handling combines `@distube/ytdl-core` with a containerized, version-pinned yt-dlp binary — pinned because YouTube's player API changes faster than yt-dlp's stable release cadence — with per-YouTube-identity cookie isolation to prevent cross-account auth conflicts, and full Vimeo-source video download as an intermediate asset for YouTube re-upload. Media assets live in Google Cloud Storage; images go through `sharp` and `react-image-crop` for EXIF-safe resizing and manual cropping. WordPress publishing goes through its REST API with SEO fields, categories, and premium-gating support. Upstash Redis handles caching and rate limiting. Resend sends transactional email (invites, health-check alerts). Tiptap (with link and placeholder extensions) powers rich-text editing; `mammoth` handles docx import for manually-authored posts; `marked` renders Markdown server-side.

The premium content model threads an `isPremiumOnly` flag from live recordings through to distribution jobs, which route to a private Transistor show, an unlisted YouTube upload, and a gated WordPress post, with verification logic that skips public-URL checks for gated content. A Transistor subscriber API client plus a nightly reconciliation cron keep premium show access in sync with website subscription state, driven by an inbound webhook receiver — a two-path sync design (webhook for immediacy, cron for correctness) that hedges against dropped or delayed webhook deliveries.

Distribution jobs are the system's most concurrency-sensitive surface. The schema and job-processing code carry atomic guards on retries, race-safe metadata merges across every job writer, and persisted verification schedules that survive process restarts — evidence that the original design under-accounted for concurrent writes and mid-flight restarts, and the team has been hardening the existing model under production load rather than redesigning it.

An extensive `docs/superpowers/specs/` and `docs/superpowers/plans/` archive documents feature-by-feature design work (analytics integration, network analytics, analytics hierarchy redesign, combined analytics overview, YouTube demographics, bilingual blog posts, episode keywords/tags, blog-edit voice learning, custom blog prompts, blog-edit detection, AI title form restructure) — the project follows a spec-then-implement workflow rather than ad hoc feature addition, with `recharts` in `package.json` backing the analytics visualizations these specs describe.

## What Works Today
- Episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, and transcript generation
- AI blog post generation from transcripts via Claude, with per-show style guides that adapt after repeated human edits (voice learning) and support for custom per-show prompts
- Bilingual blog post generation and a primary-language field per post
- Episode keyword/tag extraction and storage
- Google Docs-based collaborative editing with automated AI-vs-human edit-percentage tracking and edit detection
- Distribution to WordPress (SEO fields, categories, formatted transcript, premium gating) and YouTube (AI-suggested titles capped at 100 characters, thumbnail cropping, premium routing to unlisted uploads)
- Full Vimeo video download as a source asset for YouTube uploads in the distribution pipeline
- Manual blog import directly from Google Docs (including docx) with AI-assisted metadata auto-fill
- Live recording lifecycle tracking from YouTube stream creation through podcast handoff, with a premium toggle
- Configurable per-show season/episode numbering schemes
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress
- Premium-aware, tiered verification (30s/2m/10m/30m checks) that skips public-URL checks for gated content and survives process restarts
- Atomically-guarded, race-safe distribution job writes that prevent duplicate uploads under conc

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-07-23_
