# Test Suites Design: Functional, Reliability & Security

**Date:** 2026-04-18
**Status:** Approved

## Overview

Add comprehensive CI-ready test suites covering functional correctness, reliability under failure, and security attack vectors. All tests run via `npm test` (Vitest), fully mocked with no external API calls.

**Current state:** 21 test files, 125 tests. 5 failing (YouTube downloader mock staleness).
**Target state:** 38 test files, ~235 tests. 0 failing.

## Architecture

### Directory Structure

```
tests/
  setup.ts                          # existing — no changes needed
  factories.ts                      # NEW — shared entity builders
  lib/                              # existing unit tests (unchanged)
  functional/                       # NEW
    distribute-actions.test.ts      # distribution submission + retry actions
    episode-actions.test.ts         # episode form submission
    credential-actions.test.ts      # admin credential save
    api-upload.test.ts              # signed URL + confirm routes
    api-jobs.test.ts                # process trigger + health check
    api-oauth-callback.test.ts      # YouTube OAuth callback
  reliability/                      # NEW
    processor-timeout.test.ts       # 30-min hard timeout behavior
    processor-cascades.test.ts      # platform failure cascades
    processor-retry.test.ts         # retry idempotency
    platform-errors.test.ts         # YouTube/Transistor/WP error handling
    wp-cache-resilience.test.ts     # WordPress cache empty-result protection
  security/                         # NEW
    auth-bypass.test.ts             # role escalation, token tampering
    input-validation.test.ts        # XSS, path traversal, injection
    ownership-checks.test.ts        # job/show ownership enforcement
    api-auth.test.ts                # bearer token + session auth on routes
```

### Test Factories (`tests/factories.ts`)

Shared builders for consistent test data. Extends the `makeSession()` pattern from existing auth-guard tests.

```typescript
// Session factory
makeSession(overrides?) → { user: { id, name, email, role, image } }

// Job factory
makeJob(overrides?) → { id, userId, status, wpShowId, title, description,
                         platforms: [...], metadata: {}, createdAt, updatedAt }

// Platform record factory
makePlatform(overrides?) → { id, jobId, platform, status, externalId, error }

// Credential factory
makeCredential(overrides?) → { id, wpShowId, platform, type, credentials, networkId }

// Distribution form data factory
makeDistributeFormData(overrides?) → FormData with valid defaults

// Episode form data factory
makeEpisodeFormData(overrides?) → FormData with valid defaults
```

### Mocking Strategy

Follow existing codebase conventions:
- `vi.mock()` at module level before imports
- Mock Prisma via `vi.mock("@/lib/db")` returning chainable query builders
- Mock `next/navigation` redirect to throw `NEXT_REDIRECT`
- Mock auth via `vi.mock("@/lib/auth")` returning controlled sessions
- Mock fetch globally for API route tests
- Mock platform modules for processor tests (YouTube, Transistor, WordPress uploaders)
- Use `vi.useFakeTimers()` for timeout/timing tests

## Suite 1: Functional Tests (~45 tests)

### distribute-actions.test.ts
Tests `submitDistribution` and `retryPlatform` server actions.

- Valid submission creates job with correct platforms and metadata
- Show access verified before job creation
- Live YouTube URL mode extracts video ID via `extractYoutubeVideoId`
- Scheduled mode stores `scheduledAt` with timezone conversion
- At least one platform must be selected
- `retryPlatform` only retries failed platforms, skips completed ones
- Auth failure redirects to `/login` (not error message)

### episode-actions.test.ts
Tests `submitEpisode` server action.

- Valid submission creates episode record
- Content-type access gate (`requireContentTypeAccess("episode")`)
- Show access gate (`UserShowAccess` check)
- Episode number must be positive integer
- Season number is optional but validated when present
- URL fields validated against `^https?:\/\/.+` pattern
- Missing required fields return form errors

### credential-actions.test.ts
Tests `saveCredential` admin action.

- Admin-only gate (producer gets redirect)
- Platform must be in whitelist: `youtube|spotify|apple|transistor`
- Credential type must be `oauth` or `api_key`
- `wpShowId` parsed as integer
- Upserts by show+platform compound key
- Network default credentials use `wpShowId=0`

### api-upload.test.ts
Tests `/api/upload/signed-url` and `/api/upload/confirm` route handlers.

- Signed URL: session required, returns 401 without
- Signed URL: job ownership verified (user's job only)
- Signed URL: content-type whitelist (video/* and image/* only)
- Signed URL: returns valid GCS signed URL structure
- Confirm: marks job as ready for processing
- Confirm: job ownership verified
- Confirm: rejects already-processing jobs

### api-jobs.test.ts
Tests `/api/jobs/process` and `/api/jobs/health` route handlers.

- Process: requires `JOB_PROCESSING_SECRET` bearer token
- Process: rejects missing/invalid token with 401
- Process: looks up job by ID and invokes processor
- Process: returns 404 for nonexistent job
- Health: requires bearer token
- Health: returns counts of stuck and failed jobs

### api-oauth-callback.test.ts
Tests `/api/oauth/youtube/callback` route handler.

- Admin-only gate
- Validates state and code parameters present
- Exchanges code for tokens and stores in DB
- Handles token exchange failure gracefully

## Suite 2: Reliability Tests (~35 tests)

### processor-timeout.test.ts
Tests the 30-minute hard timeout in `processDistribution`.

- Job exceeding timeout: all in-flight platforms marked `failed`
- Job exceeding timeout: job status set to `failed`
- Cleanup runs in `finally` block even after timeout
- Platforms completed before timeout retain `completed` status
- Timeout error message stored in platform error field

### processor-cascades.test.ts
Tests failure cascade behavior across dependent platforms.

- YouTube failure → WordPress skipped (needs embed URL)
- YouTube failure → Transistor still processes (independent)
- Audio extraction failure → Transistor fails, YouTube continues
- Transcription failure → AI falls back to title/description only
- Thumbnail upload failure → falls back to YouTube CDN thumbnail
- Network playlist add failure → non-fatal, job still succeeds
- All platforms fail → job status is `failed`
- One platform fails, others succeed → job status is `completed`
- Verification failure → non-fatal, sends notification but job stays `completed`

### processor-retry.test.ts
Tests retry idempotency and state management.

- Already-completed YouTube platform skipped on retry
- Extracted audio path reused from `job.metadata.gcsPath`
- Transcript reused from `job.metadata.transcript`
- Failed platform error cleared before retry attempt
- Platform status reset to `uploading` on retry
- Double-submit of same job prevented (status check at line 85-88)
- Partial metadata from previous attempt doesn't corrupt retry

### platform-errors.test.ts
Tests error handling in each platform uploader.

**YouTube:**
- HTTP 403 (quota exceeded) throws descriptive error
- HTTP 500 (server error) throws with status
- Missing upload URL in resumable response throws
- Missing video ID in upload response throws
- Network timeout on upload throws

**Transistor:**
- Slug lookup returns no match → uses ID as-is
- S3 upload URL missing from authorize response throws
- HTTP 422 (validation error) throws with body
- Episode creation fails after audio uploaded → throws

**WordPress:**
- Post creation fails → throws
- Featured image upload fails → non-fatal, continues
- Invalid content type in response → throws
- Brand taxonomy: show 21 → YDC (term 2), others → Sunset Lounge (term 3)

### wp-cache-resilience.test.ts
Tests `getCachedShows()` cache protection.

- Empty results throw (preventing cache of transient failures)
- Valid results cached and returned
- Cache miss triggers fresh fetch
- Caller `.catch(() => [])` pattern returns empty array on failure

## Suite 3: Security Tests (~30 tests)

### auth-bypass.test.ts
Tests authorization boundary enforcement.

- Producer calling admin-only action → redirect to login
- Tampered session with `role: "admin"` but non-admin DB record → rejected
- Accessing job belonging to another user → rejected
- Admin can access any user's jobs (bypass check)
- Session with expired timestamp → re-auth required
- Missing session on protected server action → redirect
- `requireContentTypeAccess` with non-granted type → rejected
- `requireShowAccess` with non-granted show → rejected

### input-validation.test.ts
Tests resistance to malicious input.

**XSS vectors:**
- `<script>alert('xss')</script>` in title → stored escaped or stripped
- `<img onerror=alert(1)>` in description → handled safely
- JavaScript protocol in URL fields → rejected

**Path traversal:**
- Filename `../../../etc/passwd` in upload → sanitized or rejected
- Filename with null bytes `file\x00.mp4` → sanitized
- Filename with URL encoding `%2e%2e%2f` → sanitized

**Size limits:**
- Title with 10,000 characters → accepted or truncated (document behavior)
- Description with 100,000 characters → handled without crash
- 1,000 tags in comma-separated field → handled without crash

**Type coercion:**
- `wpShowId` as string "abc" → validation error
- `episode_number` as negative → validation error
- `season_number` as float → validation error or floor

### ownership-checks.test.ts
Tests resource ownership enforcement across actions.

- Distribution submission: user without show access → rejected
- Distribution submission: valid show access → accepted
- Job status check: non-owner → rejected
- Job retry: non-owner → rejected
- AI suggestion update: non-owner → rejected
- Signed URL request: non-owner's job → rejected
- Upload confirm: non-owner's job → rejected

### api-auth.test.ts
Tests authentication on all API routes.

- `/api/upload/signed-url` without session → 401
- `/api/upload/confirm` without session → 401
- `/api/jobs/process` without bearer token → 401
- `/api/jobs/process` with wrong bearer token → 401
- `/api/jobs/health` without bearer token → 401
- `/api/distribute/[id]/status` without session → 401
- `/api/oauth/youtube/callback` as non-admin → 403

## Fix: Existing YouTube Downloader Tests

Fix the 5 failing tests in `tests/lib/jobs/youtube-video-downloader.test.ts`:
1. Mock `readdir` from `fs/promises` (currently unmocked)
2. Update error message assertion to match current `extractYoutubeVideoId` output
3. Mock `unlink` for cleanup verification

## Implementation Order

1. Create `tests/factories.ts` (shared dependency for all suites)
2. Fix existing YouTube downloader tests (quick win, 0 failing baseline)
3. Security suite (highest value — catches real vulnerabilities)
4. Functional suite (validates core flows)
5. Reliability suite (complex mocking, builds on functional patterns)

## Success Criteria

- `npm test` passes with 0 failures
- All 17 new test files + 21 existing = 38 total
- ~235 total tests (125 existing + ~110 new)
- No external API calls in any test
- Tests complete in under 10 seconds
