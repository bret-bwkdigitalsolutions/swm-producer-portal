# swm-producer-portal — Living State

## What This Is
A podcast producer portal that turns raw episode audio into distributed, multi-platform content and increasingly serves as the operational backend for the show's public website. A small internal producer team uses it to pull episodes in from Transistor.fm, generate transcripts, produce AI-assisted (including bilingual) blog posts with human-in-the-loop editing, and push finished content out to WordPress, YouTube, and Transistor — including a premium track that gates content behind private Transistor shows, unlisted YouTube uploads, and paywalled WordPress posts. Beyond distribution, it now manages the live-recording lifecycle (YouTube livestream → podcast episode), tracks per-show analytics across platforms, moderates listener chat coming from the public website, gives the team a subscriber management view, and administers per-show user access for producers.

## How to Run & Access
Run locally with `npm run dev` (Next.js dev server on `http://localhost:3000`). The database layer is Prisma 7 with the `pg` driver adapter (`@prisma/adapter-pg`), configured in `prisma.config.ts`; seed data loads via `npx tsx prisma/seed.ts`. Tests run with `npm run test` (Vitest) and `npm run test:smoke` (`scripts/smoke-test.ts`); linting is `npm run lint`.

Production builds as a multi-stage Docker image producing a Next.js standalone server (`output: "standalone"`). The runtime image installs FFmpeg, a pinned yt-dlp nightly build, and Deno — required for video/audio processing and the Transistor scraper subsystem — and runs pending Prisma migrations automatically via `scripts/migrate.mjs` before starting `server.js` on port 3000.

No deployment target (Vercel, Cloud Run, Fly, etc.) is declared anywhere in the repo: there's no `vercel.json`, no deploy step in CI, and no staging config. The single GitHub Actions workflow (`notify-obsidian-hub.yml`) pings an external documentation hub, not a deploy pipeline. Given the app's dependencies on Postgres, Google Cloud Storage, Upstash Redis, Deepgram, Anthropic, and now two separate WordPress custom APIs (chat, membership), it clearly runs on some container platform in production, but neither the host nor a production URL is evidenced in-repo — this document cannot state where the app is actually reachable.

## Site Map / Content Structure
*(Inferred from `docs/superpowers/specs/`, `docs/superpowers/plans/`, recent commit messages, and Next.js App Router convention — the full `app/` route tree is truncated in the source listing, so exact paths below are best-effort.)*

- `/` — public landing page
- `/privacy`, `/terms` — static legal pages
- `/forgot-password`, `/reset-password` — self-serve password reset flow
- `/admin` — dashboard home / activity overview
- `/admin/shows` — per-show config: platform links, hosts, AI style guides, season/episode numbering scheme, language settings, premium settings
- `/admin/shows/sync` — episode sync trigger from Transistor.fm
- `/admin/credentials` / `/admin/credentials/[showId]` — platform credential status, YouTube channel verification, connected-account display, per-identity cookie isolation
- `/admin/blog-ideas` — AI-generated blog ideas grouped by episode, collapsible groups, keyword/tag support, custom prompt controls
- `/admin/blog-ideas/import` — manual blog import from Google Docs / docx (via `mammoth`), AI-assisted metadata extraction
- `/admin/live-recordings` — livestream-to-podcast workflow tracker, premium toggle per recording
- `/admin/social-accounts` — social platform connections feeding follower/analytics reporting
- `/admin/analytics` — network-wide and per-show analytics, combined platform overview, YouTube demographics
- `/admin/subscribers` — membership base view/edit, backed by the website's WordPress membership API
- `/admin/chat` (or similar) — chat moderation and team inbox, backed by the WordPress `swm-chat` portal API
- `/admin/users`, `/admin/users/[id]` — invite flow, role and per-show access management
- `/admin/activity` — activity/audit log
- `/reaction` — public-facing content reaction submission form
- `/api/distribute/analyze` — AI content analysis (titles, metadata), runs in background for URL-sourced jobs
- `/api/distribute/[id]` — distribution pipeline endpoint, premium-aware routing across platforms
- `/api/upload/thumbnail` — image upload with EXIF correction, compression, crop support
- `/api/scraper/trigger` — Transistor dashboard scraper trigger
- `/api/webhooks/subscription` — inbound webhook for website subscription events, synced to Transistor subscriber lists

## Current Architecture
Next.js 16 (App Router) on React 19, PostgreSQL via Prisma 7 with the `pg` driver adapter, NextAuth v5 for auth (Google OAuth plus invite-based accounts with bcrypt-hashed credential fallback, now supplemented by self-serve and admin-triggered password reset). Content generation runs on Anthropic Claude via the official SDK, with the model ID centralized into a single env-controlled source of truth (`ANTHROPIC_MODEL`) rather than duplicated across call sites, plus a startup health check that pings the configured model and emails an admin if it comes back retired. This centralization exists because a hardcoded model ID was silently retired once already; the fact that the team just replaced a second retired model (`claude-sonnet-4-20250514` → `claude-sonnet-5`) and *then* centralized the reference suggests the earlier health check caught the problem but the fix wasn't structural until now.

Episode ingestion runs through a standalone scraper (`scripts/transistor-scraper`, a Deno-based subsystem with its own Docker stage) that logs into the Transistor dashboard directly, because the public Transistor API doesn't expose the data the portal needs. The Transistor API client that *is* used now retries on 429/5xx so podcast analytics survive rate limiting rather than failing outright. Transcription uses Deepgram, and transcripts now flow two directions: internally for blog generation, and outward as timestamped WebVTT (pushed to a `_swm_transcript_vtt` field) so the public website can power a "Mark That" interactive-transcript feature — the portal is acting as the transcript source of truth for the site, not just for internal content production.

Video handling combines `@distube/ytdl-core` with a containerized, version-pinned yt-dlp binary — pinned because YouTube's player API changes faster than yt-dlp's stable release cadence (see `docs/youtube-cookie-refresh.md`) — plus per-YouTube-identity cookie isolation, and full Vimeo-source video download as an intermediate asset for YouTube re-upload; Vimeo download failures are now correctly attributed as Vimeo errors rather than misreported as YouTube cookie errors. Media lives in Google Cloud Storage; images go through `sharp` and `react-image-crop`. WordPress publishing goes through its REST API with SEO fields, categories, and premium-gating support.

Two new integrations extend the portal into subscriber-facing territory: a chat moderation and team-inbox feature backed by a WordPress `swm-chat` portal API (which returns some numeric fields as strings, requiring explicit normalization on ingest — a sign of a loosely-typed contract on the WordPress side), and a subscribers dashboard backed by a WordPress membership API's `/portal/subscribers` endpoints. Both are read/write views into WordPress-owned state rather than data the portal itself owns.

The premium content model threads an `isPremiumOnly` flag from live recordings through to distribution jobs, routing to a private Transistor show, an unlisted YouTube upload, and a gated WordPress post, with verification logic that skips public-URL checks for gated content. A Transistor subscriber API client plus a nightly reconciliation cron keep premium show access in sync with website subscription state, driven by an inbound webhook receiver — a two-path sync design that hedges against dropped or delayed webhook deliveries.

Distribution jobs remain the system's most concurrency-sensitive surface: atomic guards on retries, race-safe metadata merges across every job writer, persisted verification schedules that survive process restarts, and explicit recovery for AI-analysis pipelines killed by restarts. AI suggestion failures no longer dead-end producers — the workflow now degrades gracefully when Claude is unavailable instead of blocking progress. Access control is enforced per-show throughout (`verifyShowAccess`), with admins granted an explicit bypass. An extensive `docs/superpowers/specs/` and `docs/superpowers/plans/` archive documents feature-by-feature design work, and `AGENTS.md` / `CLAUDE.md` / `.mcp.json` at the repo root indicate the project is actively developed with AI coding-agent tooling as a first-class part of the workflow, following a spec-then-implement pattern.

## What Works Today
- Episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, transcript generation, and resilience to Transistor API rate limiting
- AI blog post generation from transcripts via Claude, with per-show style guides that adapt from human edits and per-show custom prompts, degrading gracefully rather than blocking producers when AI is unavailable
- Bilingual blog post generation with a primary-language field per post
- Episode keyword/tag extraction and storage
- Google Docs-based collaborative editing with automated AI-vs-human edit-percentage tracking
- Distribution to WordPress (SEO fields, categories, formatted transcript, premium gating) and YouTube (AI-suggested titles, thumbnail cropping, premium routing to unlisted uploads)
- Timestamped WebVTT transcript export to the public website, powering an interactive "Mark That" transcript feature
- Full Vimeo video download as a source asset for YouTube uploads, with correctly attributed download error reporting
- Manual blog import directly from Google Docs (including docx) with AI-assisted metadata auto-fill
- Live recording lifecycle tracking from YouTube stream creation through podcast handoff, with a premium toggle
- Premium-aware, tiered content verification that skips public-URL checks for gated content and survives process restarts
- Nightly Transistor subscriber reconciliation plus a webhook receiver, keeping premium show access aligned with website subscription state
- Chat moderation and a team inbox for messages originating from the website's chat feature
- A subscribers dashboard for viewing and editing membership-base records against the live website membership API
- Self-serve password reset plus an admin-initiated "send reset link" flow
- Startup AI-model health check that alerts an admin by email if the configured Claude model is retired
- Per-show access control on admin actions, including aggregated analytics, with an explicit admin bypass

## Recent Activity
**Website-facing subsc

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-08-06_
