# swm-producer-portal — Living State

## What This Is
A comprehensive podcast producer portal that automatically ingests episodes from podcast platforms, generates AI-powered blog content from transcripts, and distributes finished posts across WordPress, YouTube, and other channels. Podcast producers use this to transform their audio content into written materials while maintaining brand consistency and editorial control through collaborative editing workflows.

## How to Run & Access
Development server runs with `npm run dev` on http://localhost:3000. Application is containerized with Docker using standalone Next.js output, including FFmpeg for audio processing, yt-dlp for YouTube downloads, and Deno for JavaScript execution. The container runs automated database migrations on startup and serves on port 3000. No production deployment URLs or CI/CD pipelines are evident in the current codebase.

## Site Map / Content Structure
- `/` — Public landing page with portal introduction
- `/privacy` — Privacy policy page
- `/terms` — Terms of service page
- `/admin` — Main administrative dashboard with activity overview
- `/admin/shows` — Show configuration, host management, language settings, and style guides
- `/admin/shows/sync` — Episode synchronization from Transistor.fm and other platforms
- `/admin/credentials/[showId]` — Individual show API credential management
- `/admin/credentials` — Platform credential overview with health checks
- `/admin/blog-ideas` — AI-generated blog ideas organized by episode with collapsible day grouping
- `/admin/users/[id]` — Individual user profile management
- `/admin/users` — User invitation and access management system
- `/admin/activity` — System activity logs and monitoring
- `/reaction` — Content reaction submission form with show filtering
- `/api/auth/[...nextauth]` — NextAuth authentication endpoints
- `/api/distribute/[id]` — Content distribution pipeline with AI analysis and multi-platform publishing
- `/api/distribute/analyze` — AI analysis endpoint for title suggestions and metadata extraction
- `/api/upload/thumbnail` — Image upload with compression and EXIF rotation
- `/api/scraper/trigger` — Transistor dashboard scraping automation

## Current Architecture
Next.js 16 application with App Router using PostgreSQL via Prisma ORM for multi-tenant podcast data management. Authentication through NextAuth with Google OAuth and invite-based onboarding. Core integrations include Transistor.fm scraping for episode ingestion, Deepgram for transcription, Anthropic Claude for content generation, Google Drive for collaborative editing, WordPress REST API for publishing, YouTube Data API for video uploads with OAuth channel verification, and Google Cloud Storage for media assets. Upstash Redis provides caching and rate limiting. The system emphasizes automated content workflows with human review checkpoints, per-show season numbering schemes, and comprehensive edit tracking to measure human input on AI-generated content. TipTap provides rich text editing capabilities for blog content management.

## What Works Today
- Automated episode ingestion from Transistor.fm with metadata extraction and thumbnail processing
- AI blog post generation from episode transcripts using Claude with custom prompts and show-specific style guides
- Google Docs integration for collaborative editing with real-time change detection and edit percentage tracking
- Multi-platform distribution to WordPress with SEO fields, taxonomy assignment, and speaker-labeled transcripts
- YouTube video publishing with AI-suggested titles based on show history and enforced 100-character limits
- Season and episode number handling driven by per-show metadata configuration
- Pre-distribution duplicate checks across YouTube, Transistor, and WordPress platforms
- Tiered post-distribution verification at 30 second, 2 minute, 10 minute, and 30 minute intervals
- User management with invitation tokens, role-based access, and last login tracking
- Image processing with EXIF rotation, compression, and WordPress gallery attachment
- YouTube OAuth with channel verification and connected email display
- Reaction content submission with content type categorization and show association
- Auto-reload functionality when server actions become stale after deployments

## Recent Activity
Development over the past week has concentrated on **distribution reliability and verification** including pre-distribution duplicate detection across all platforms, tiered post-distribution verification at multiple intervals, and proper handling of OAuth credential refresh cycles to prevent false expiry warnings. **Season and episode management** has been enhanced with per-show season schemes, current season tracking, and conditional season number inclusion based on show preferences. **YouTube integration improvements** include AI-suggested titles based on show history with enforced character limits, channel verification during OAuth, connected account email display, and proper access token handling. **User experience refinements** feature restructured distribution forms moving metadata below path selection, AI title suggestions with show context, YouTube thumbnail previews, and enhanced error handling for analysis failures.

## Known Gaps & Limitations
- YouTube authentication relies on OAuth tokens that require manual refresh when expired
- Distribution pipeline lacks automated retry mechanisms for failed platform uploads
- Edit detection measures percentage changes but cannot assess semantic quality of modifications
- Google Drive integration has minimal error handling for API quota limits and permission failures
- Content validation for reaction submissions lacks quality control and duplicate detection
- Multi-show processing can create resource contention without proper job queuing
- Job failure handling marks entire jobs as failed when individual analysis steps error

## Next Meaningful Capabilities
- Cross-platform analytics dashboard combining podcast metrics, blog performance, and engagement data
- Advanced content calendar with strategic scheduling based on audience behavior patterns
- Template-driven blog generation allowing custom post structures beyond simple prompts
- Automated social media snippet creation optimized for different platform requirements
- Enhanced collaborative workflows with approval chains and detailed reviewer assignment
- Intelligent content recommendation engine suggesting topics based on episode performance and trends

## Open Technical Questions
- Optimal job queuing strategy for handling concurrent episode processing without resource conflicts
- Long-term media storage approach balancing cost efficiency with access performance requirements
- Architecture for expanding distribution beyond WordPress to additional CMS platforms and social networks
- Error recovery mechanisms for partial distribution failures across multiple platforms simultaneously
- Performance optimization strategy for processing long-form content and large transcript analysis
- Content quality validation framework for user-submitted reactions and custom blog inputs

## Key Files & Entry Points
- `src/app/admin/blog-ideas/page.tsx` — Main blog content management interface with episode grouping
- `src/app/api/distribute/analyze/route.ts` — AI analysis endpoint for title suggestions and metadata extraction
- `src/app/admin/shows/page.tsx` — Show configuration with platform links and style guide management
- `scripts/transistor-scraper/` — Automated episode ingestion system with authentication and data collection
- `src/app/admin/blog-ideas/actions.ts` — Blog generation workflows with atomic claim processing
- `prisma/schema.prisma` — Complete data model covering shows, episodes, users, and content relationships
- `src/app/reaction/page.tsx` — Reaction content submission interface with show filtering
- `Dockerfile` — Production container setup with media processing tools and migration automation
- `src/app/admin/blog-ideas/parse-blog-output.ts` — Content parsing with edit detection and validation logic
- `src/app/admin/shows/sync/page.tsx` — Episode synchronization interface with platform integration

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-05-07_
