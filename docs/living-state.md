# swm-producer-portal — Living State

## What This Is
A comprehensive podcast producer portal that automatically transforms audio content into multi-platform digital assets. Podcast producers use this to ingest episodes from hosting platforms, generate AI-powered blog posts from transcripts with collaborative human editing, and distribute finished content across WordPress, YouTube, and social media while maintaining brand consistency through automated style guides and editorial workflows.

## How to Run & Access
Development server runs with `npm run dev` on http://localhost:3000. The application is fully containerized with Docker using Next.js standalone output, including FFmpeg, yt-dlp v2026.03.17, and Deno v2.7.12 for media processing. The container automatically runs database migrations via `scripts/migrate.mjs` before starting the server on port 3000. Production deployment configuration is complete but no live deployment URLs are evident in the codebase.

## Site Map / Content Structure
- `/` — Public landing page introducing the portal
- `/privacy` — Privacy policy page
- `/terms` — Terms of service page
- `/admin` — Administrative dashboard with activity overview and navigation
- `/admin/shows` — Show configuration with platform links, host management, and AI style guides
- `/admin/shows/sync` — Episode synchronization from Transistor.fm and other platforms
- `/admin/credentials` — Platform credential management with OAuth health monitoring
- `/admin/credentials/[showId]` — Per-show API credentials with YouTube channel verification
- `/admin/blog-ideas` — AI-generated blog ideas organized by episode with collapsible grouping
- `/admin/blog-ideas/import` — Direct blog post import from Google Docs with metadata extraction
- `/admin/social-accounts` — Social media platform integration and analytics management
- `/admin/users` — User invitation system and access control
- `/admin/users/[id]` — Individual user profile and permission management
- `/admin/activity` — System activity logs and user behavior tracking
- `/reaction` — Content reaction submission form with show-specific filtering
- `/api/distribute/analyze` — AI content analysis for titles and metadata suggestions
- `/api/distribute/[id]` — Multi-platform content distribution pipeline
- `/api/upload/thumbnail` — Image processing with EXIF handling and compression
- `/api/scraper/trigger` — Automated Transistor dashboard scraping

## Current Architecture
Next.js 16 application with App Router architecture using PostgreSQL via Prisma ORM with connection pooling for multi-tenant podcast data. Authentication flows through NextAuth v5 with Google OAuth and invite-based user management. Core integrations include a standalone Transistor.fm scraper with Playwright for episode ingestion, Deepgram SDK for transcription services, Anthropic Claude for content generation with show-specific style guides, Google Drive integration for collaborative editing workflows, WordPress REST API for SEO-optimized publishing, YouTube Data API v3 with OAuth channel verification, and Google Cloud Storage for media asset management. Upstash Redis provides caching and rate limiting. The system emphasizes automated content workflows with human review checkpoints, comprehensive edit tracking to measure AI vs. human contributions, and per-show customization including seasonal numbering schemes and dynamic style guide synthesis.

## What Works Today
- Automated episode ingestion from Transistor.fm with metadata extraction, thumbnail processing, and transcript generation
- AI blog post generation from episode transcripts using Claude with dynamically learned style guides and custom prompts
- Google Docs collaborative editing integration with automatic change detection and edit percentage tracking
- Multi-platform content distribution to WordPress with SEO optimization, category assignment, and formatted transcripts
- YouTube video publishing with AI-suggested titles, thumbnail cropping, and 100-character title limit enforcement
- Host-written blog post import directly from Google Docs with AI metadata auto-fill
- Season and episode numbering driven by configurable per-show schemes (numeric, none, custom)
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress platforms
- Tiered post-distribution verification at 30-second, 2-minute, 10-minute, and 30-minute intervals
- Appearance gallery management with per-file upload and 16:9 hero image cropping
- Auto-syncing style guides that learn from accumulated human edits on AI-generated content
- User invitation system with role-based access and last login tracking
- Image processing pipeline with EXIF rotation correction and WordPress media library integration
- YouTube OAuth with channel verification and connected Google account email display
- Content reaction submission system with show association and categorization
- Auto-reload functionality preventing stale server actions after deployments

## Recent Activity
Development over the past month has concentrated on **social media analytics infrastructure** with new database models for SocialAccount, SocialAccountCredential, and SocialFollowerSnapshot plus administrative shell interfaces. **Content import capabilities** have expanded with direct Google Docs import supporting file uploads, AI metadata auto-fill, and per-post primary language selection. **Media management improvements** include appearance gallery functionality with per-file upload and 16:9 hero image cropping interfaces. **Authentication reliability** has been enhanced with auto-linking Google sign-in to existing accounts by email and proper OAuth token refresh handling. **Distribution pipeline robustness** now features comprehensive duplicate checking, tiered verification workflows, and improved season scheme handling that conditionally omits season numbers for shows that don't use them.

## Known Gaps & Limitations
- Social media analytics models exist but lack data collection automation and dashboard visualization
- YouTube OAuth tokens require manual intervention when expired without automated refresh workflows
- Distribution pipeline lacks retry mechanisms for handling partial platform upload failures
- Style guide synthesis measures edit percentages but cannot assess semantic quality improvements
- Google Drive integration has minimal error handling for API quota exhaustion and permission failures
- Concurrent multi-show processing can create resource contention without proper job queuing
- Content validation for reaction submissions lacks quality control and spam prevention measures
- Import workflow supports Google Docs but lacks validation for malformed or incomplete content

## Next Meaningful Capabilities
- Social media follower analytics dashboard with historical tracking and cross-platform growth insights
- Automated social media snippet generation optimized for platform-specific character limits and engagement patterns
- Advanced content calendar with strategic scheduling based on audience behavior analytics and optimal posting times
- Cross-platform performance analytics combining podcast metrics with blog engagement and video view data
- Template-driven blog post structures allowing custom formats beyond simple prompt-based generation
- Enhanced collaborative workflows with approval chains, granular reviewer permissions, and change request systems

## Open Technical Questions
- Optimal job queuing architecture for concurrent episode processing without database locks or resource conflicts
- Long-term media storage strategy balancing Google Cloud Storage costs with CDN performance requirements
- Social media API integration approach for automated follower data collection across platforms with varying rate limits
- Error recovery and retry mechanisms for gracefully handling partial distribution failures without data corruption
- Content quality assessment framework for measuring semantic improvements in AI-generated content over time
- Performance optimization strategy for processing long-form transcripts and large media files within memory constraints

## Key Files & Entry Points
- `src/app/admin/blog-ideas/page.tsx` — Primary blog content management with episode-based organization and collapsible grouping
- `src/app/api/distribute/analyze/route.ts` — AI-powered content analysis for title suggestions and metadata extraction
- `scripts/transistor-scraper/index.ts` — Automated episode ingestion with Playwright authentication and data parsing
- `src/app/admin/shows/page.tsx` — Show configuration interface with platform integration and style guide management
- `prisma/schema.prisma` — Complete data model defining shows, episodes, users, credentials, and social media analytics
- `src/app/admin/blog-ideas/actions.ts` — Blog generation workflows with atomic processing and error handling
- `src/app/admin/blog-ideas/import/page.tsx` — Google Docs import interface with AI metadata auto-fill capabilities
- `Dockerfile` — Production container with pinned media processing tools and automated migration runner
- `src/app/admin/credentials/[showId]/page.tsx` — Platform credential management with OAuth verification and health monitoring
- `src/app/admin/blog-ideas/parse-blog-output.ts` — Content parsing logic with edit detection and percentage tracking

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-05-18_
