# swm-producer-portal — Living State

## What This Is
A comprehensive podcast producer portal that automatically ingests episodes from podcast platforms, generates AI-powered blog content from transcripts, and distributes finished posts across WordPress, YouTube, and other channels. Podcast producers use this to transform their audio content into written materials while maintaining brand consistency and editorial control through collaborative editing workflows.

## How to Run & Access
Development server runs with `npm run dev` on http://localhost:3000. Application is containerized with Docker using standalone Next.js output, including FFmpeg, yt-dlp, and Deno for media processing. The container runs automated database migrations on startup via `scripts/migrate.mjs` and serves on port 3000. No production deployment URLs are evident, though the Dockerfile suggests deployment readiness with health checks and proper user permissions.

## Site Map / Content Structure
- `/` — Public landing page with portal introduction
- `/privacy` — Privacy policy page
- `/terms` — Terms of service page
- `/admin` — Administrative dashboard with activity overview and navigation
- `/admin/shows` — Show configuration with platform links, host management, and style guides
- `/admin/shows/sync` — Episode synchronization from Transistor.fm and other platforms
- `/admin/credentials` — Platform credential overview with OAuth health checks
- `/admin/credentials/[showId]` — Individual show API credential management and channel verification
- `/admin/blog-ideas` — AI-generated blog ideas organized by episode with collapsible grouping
- `/admin/users` — User invitation and access management system
- `/admin/users/[id]` — Individual user profile management
- `/admin/activity` — System activity logs and monitoring
- `/admin/social-accounts` — Social media platform integration management
- `/reaction` — Content reaction submission form with show filtering
- `/api/distribute/analyze` — AI analysis endpoint for title suggestions and metadata
- `/api/distribute/[id]` — Multi-platform content distribution pipeline
- `/api/upload/thumbnail` — Image processing with compression and EXIF handling
- `/api/scraper/trigger` — Transistor dashboard scraping automation

## Current Architecture
Next.js 16 application with App Router using PostgreSQL via Prisma ORM for multi-tenant podcast data management. Authentication flows through NextAuth with Google OAuth and invite-based user onboarding. Core integrations include Transistor.fm scraping for episode ingestion, Deepgram for transcription services, Anthropic Claude for content generation with custom prompts, Google Drive for collaborative editing workflows, WordPress REST API for content publishing, YouTube Data API for video uploads with OAuth verification, and Google Cloud Storage for media assets. Upstash Redis handles caching and rate limiting. The architecture emphasizes automated content workflows with human review checkpoints, per-show customization including season schemes and style guides, and comprehensive edit tracking to measure human input on AI-generated content.

## What Works Today
- Automated episode ingestion from Transistor.fm with metadata extraction and thumbnail processing
- AI blog post generation from episode transcripts using Claude with show-specific style guides and custom prompts
- Google Docs collaborative editing integration with change detection and edit percentage tracking
- Multi-platform distribution to WordPress with SEO optimization, taxonomy assignment, and formatted transcripts
- YouTube video publishing with AI-suggested titles, thumbnail previews, and enforced character limits
- Season and episode numbering driven by configurable per-show metadata schemes
- Pre-distribution duplicate detection across YouTube, Transistor, and WordPress platforms
- Tiered post-distribution verification at 30-second, 2-minute, 10-minute, and 30-minute intervals
- User management with invitation tokens, role-based access control, and activity tracking
- Image processing with EXIF rotation, compression, and WordPress media library integration
- YouTube OAuth with channel verification and connected account email display
- Content reaction submission system with categorization and show association
- Auto-reload functionality for stale server actions after deployments
- Style guide auto-synthesis as blog edits accumulate to capture voice and preferences

## Recent Activity
Development over the past two weeks has focused on **social media analytics foundation** with new SocialAccount, SocialAccountCredential, and SocialFollowerSnapshot database models plus administrative interfaces. **Authentication improvements** include auto-linking Google sign-in to existing credential accounts by email and proper OAuth token refresh handling to prevent false expiry warnings. **Content distribution reliability** has been enhanced with comprehensive duplicate checking, tiered verification workflows, and improved error handling for analysis failures. **Show management features** now include configurable season schemes, current season tracking, and conditional season number handling. **Style guide automation** automatically synthesizes writing guidelines as human edits accumulate on AI-generated content.

## Known Gaps & Limitations
- Social media analytics models exist but lack data collection and visualization implementations
- YouTube OAuth tokens require manual refresh cycles when expired without automated renewal
- Distribution pipeline lacks automated retry mechanisms for partial platform upload failures
- Edit tracking measures percentage changes but cannot assess semantic quality improvements
- Google Drive integration has minimal error handling for API quota limits and permission issues
- Multi-show processing can create resource contention without proper job queuing
- Content validation for reaction submissions lacks quality control and spam prevention

## Next Meaningful Capabilities
- Social media follower analytics dashboard with historical tracking and growth insights
- Cross-platform content performance analytics combining podcast metrics with blog and video engagement
- Automated social media snippet generation optimized for platform-specific requirements
- Advanced content calendar with strategic scheduling based on audience behavior patterns
- Template-driven blog structures allowing custom post formats beyond simple prompt variations
- Enhanced collaborative workflows with approval chains and granular reviewer permissions

## Open Technical Questions
- Optimal job queuing architecture for concurrent episode processing without resource conflicts
- Long-term media storage strategy balancing cost efficiency with performance requirements
- Social media API integration approach for follower data collection across multiple platforms
- Error recovery mechanisms for handling partial distribution failures gracefully
- Content quality assessment framework for measuring AI output improvements over time
- Performance optimization strategy for processing long-form transcripts and large media files

## Key Files & Entry Points
- `src/app/admin/blog-ideas/page.tsx` — Primary blog content management with episode organization
- `src/app/api/distribute/analyze/route.ts` — AI analysis for title suggestions and metadata extraction
- `scripts/transistor-scraper/index.ts` — Episode ingestion automation with authentication
- `src/app/admin/shows/page.tsx` — Show configuration with platform integration and style guides
- `prisma/schema.prisma` — Complete data model for shows, episodes, users, and social accounts
- `src/app/admin/blog-ideas/actions.ts` — Blog generation workflows with atomic processing
- `Dockerfile` — Production container with media tools and migration automation
- `src/app/admin/credentials/[showId]/page.tsx` — Platform credential management with OAuth verification
- `src/app/admin/blog-ideas/parse-blog-output.ts` — Content parsing with edit detection logic
- `scripts/sync-style-guide.ts` — Automated style guide synthesis from accumulated edits

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-05-14_
