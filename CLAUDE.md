# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# SWM Producer Portal

## Overview
Standalone Next.js portal for Stolen Water Media producers to submit content and manage episode distribution. Replaces WordPress admin forms. WordPress is the source of truth for published content — the portal DB stores user config, credentials, job state, and logs only.

## Tech Stack
- **Framework:** Next.js 16 (App Router, Server Actions)
- **Auth:** NextAuth v5 (Google OAuth + credentials)
- **Database:** PostgreSQL via Prisma 7 with PrismaPg driver adapter
- **UI:** Tailwind v4 + shadcn/ui v4 (uses @base-ui/react, NOT Radix)
- **Rich Text:** Tiptap
- **Hosting:** Railway (staging autodeploys from `main`, production autodeploys from `production`)

## Development
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm test             # Run vitest tests
npm run test:watch   # Vitest in watch mode
npx prisma studio    # Browse database
npx prisma db seed   # Seed dev data
```

## Database
Uses Docker PostgreSQL on port 5434 (container: cairn-postgres). Database: `swm_producer_portal`.

## Key Patterns

### Prisma 7
No `url` in schema.prisma datasource — connection configured in `prisma.config.ts` and via PrismaPg adapter in `src/lib/db.ts`. Prisma's `JsonValue` type is strict — use `JSON.parse(JSON.stringify(obj))` when writing complex objects to JSON columns.

### Server Actions
Co-located `actions.ts` files using `(prevState, formData) => Promise<FormState>` pattern with `useActionState`. When auth fails in a server action, call `redirect("/login")` (it throws, never returns) rather than returning an error message.

### Auth Guards
`requireAuth()`, `requireAdmin()`, `requireContentTypeAccess(type)` in `src/lib/auth-guard.ts`. Page-level guards redirect; action-level guards should also redirect (not return error messages that get cached or confuse users).

### shadcn/ui v4
Components use `@base-ui/react`, not Radix. No `asChild` prop — triggers render children directly.

### revalidateTag
Next.js 16 requires 2 args: `revalidateTag("tag", "max")`

### WordPress Cache
`getCachedShows()` in `src/lib/wordpress/cache.ts` uses `unstable_cache` with 1-hour revalidation. It throws on empty results to prevent caching transient WP API failures. Callers should `.catch(() => [])` at the page level.

## Two Podcast Networks

SWM operates two networks with separate credentials:
- **Sunset Lounge DFW** — 7 shows (IDs 22-28), uses network default credentials at `wpShowId=0`
- **Your Dark Companion (YDC)** — 1 show (ID 21), uses its own credentials (no network fallback)

Credential resolution (`src/lib/analytics/credentials.ts`) always checks show-specific first, then falls back to network default (`wpShowId=0`). YDC has overrides so it never hits the network default.

WordPress brand taxonomy: YDC → "Your Dark Companion" (term ID 2), all others → "The Sunset Lounge" (term ID 3). These are hardcoded in `src/lib/platforms/wordpress.ts`.

## Distribution Pipeline

The core feature. Two paths converge into a single processor:

### Path 1: Normal Upload
Producer uploads video file → browser does resumable GCS upload → processor extracts audio → uploads to YouTube, Transistor, WordPress.

### Path 2: Live YouTube Recording
Producer provides YouTube URL → processor downloads audio via `yt-dlp` (no video needed) → uploads to Transistor, WordPress. YouTube is marked completed without re-uploading.

### Processing Order (src/lib/jobs/processor.ts)
Platforms are processed in dependency order:
1. **YouTube** (Phase 1) — must complete first because WordPress needs the embed URL
2. **Transistor** (Phase 2) — needs extracted audio, independent of YouTube
3. **WordPress** (Phase 3) — needs YouTube URL for embed, thumbnail from GCS

Each phase also handles network cross-posting (Transistor network feed, YouTube network playlist) for shows using network default credentials.

### YouTube URL Handling
All YouTube URL parsing goes through `src/lib/youtube-url.ts` (`extractYoutubeVideoId`). Supports `/watch?v=`, `/live/`, and `youtu.be` formats. **Never use `searchParams.get("v")` directly** — it fails on `/live/` URLs.

### Post-Distribution Verification
After completion, waits 60 seconds then hits each platform's API to verify title and thumbnail are present. Results stored in `job.metadata.verification`. Sends email notification on mismatches. Skips YouTube verification for live recordings (portal OAuth may not read external channels).

### YouTube Download (src/lib/jobs/youtube-video-downloader.ts)
Uses `yt-dlp` (not `ytdl-core`) with audio-only extraction. Requires `deno` in the Docker image for YouTube's JS challenge solver. Supports cookie-based auth via `YOUTUBE_COOKIES` env var (Netscape format). Dockerfile pins specific versions of both yt-dlp and deno.

## Project Structure
- `src/app/dashboard/distribute/` — Distribution form and actions
- `src/app/dashboard/` — Producer content forms (episode, show, trailer, etc.)
- `src/app/admin/` — Admin panel (user management, activity log, blog ideas)
- `src/lib/jobs/` — Distribution processor, audio extractor, AI processor, verification
- `src/lib/platforms/` — YouTube, Transistor, WordPress upload implementations
- `src/lib/wordpress/` — WP REST API client + cache
- `src/lib/analytics/` — YouTube/Transistor analytics + credential resolution
- `src/lib/youtube-url.ts` — YouTube URL parsing (used everywhere)
- `src/components/forms/` — Shared form components (rich text, image input, etc.)
- `prisma/` — Schema and migrations

## Environment Variables
Key env vars required for distribution: `GCS_BUCKET_NAME`, `GCS_CREDENTIALS_JSON`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WP_API_URL`, `WP_APP_USER`, `WP_APP_PASSWORD`, `RESEND_API_KEY`. Optional: `YOUTUBE_COOKIES` (for yt-dlp auth).

## Deployment
Railway builds from Dockerfile (node:20-alpine with ffmpeg, yt-dlp, deno). Migrations run automatically at container startup via `scripts/migrate.mjs`. To deploy: push to `main` (staging) or `production` (production). Use `railway logs` to check production logs.
