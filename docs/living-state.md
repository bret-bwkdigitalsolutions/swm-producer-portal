# swm-producer-portal — Living State

## What This Is
A comprehensive content management portal for podcast producers that ingests episodes from external platforms, generates AI-powered blog content, and distributes finished posts across multiple channels. Producers connect their podcast feeds, review automatically generated blog ideas and drafts, edit content through integrated workflows, and publish to WordPress, YouTube, and other platforms from a centralized dashboard.

## How to Run & Access
Development server runs with `npm run dev` on http://localhost:3000. Application deploys as standalone Docker container with automated database migrations, FFmpeg for audio processing, yt-dlp for YouTube downloads, and Deno runtime for JavaScript challenge solving. Production deployment configuration and URLs not evident in current codebase - no CI/CD workflows or environment-specific deployment scripts present.

## Site Map / Content Structure
- `/admin` — Administrative dashboard with user management and system controls
- `/admin/shows` — Podcast show configuration, host management, and platform integration settings
- `/admin/shows/sync` — Episode synchronization from external podcast platforms
- `/admin/credentials/[showId]` — API credentials management for individual shows
- `/admin/blog-ideas` — AI-generated blog post ideas organized by episode with collapsible groups
- `/admin/users` — User invitation system and access management
- `/admin/activity` — System activity monitoring and audit logs
- `/api/auth/[...nextauth]` — NextAuth authentication endpoints
- `/api/distribute/[id]` — Content distribution pipeline with status tracking
- `/api/oauth/youtube` — YouTube OAuth flow for channel authorization
- `/api/scraper/trigger` — Transistor.fm dashboard scraping automation
- `/api/upload` — File upload handling for audio and media assets

## Current Architecture
Next.js 16 with App Router serving a multi-tenant podcast management platform. PostgreSQL database with Prisma ORM stores shows, episodes, blog posts, and user data with complex relationships tracking content lifecycle from episode ingestion through publication. Authentication via NextAuth with Google OAuth and invite-based user onboarding. External service integrations: Transistor.fm scraping for episode data, Deepgram for transcription, Claude AI for content generation, Google Drive for collaborative editing, WordPress API for publication, YouTube API for video uploads, and Google Cloud Storage for media files. Redis provides caching and session management. The architecture emphasizes automated workflows with human oversight points for content quality control.

## What Works Today
- Multi-show podcast episode ingestion from Transistor.fm via automated scraping
- AI-powered blog post generation from episode transcripts using Claude
- Rich text editing workflow with Google Docs integration and edit detection
- Automated distribution to WordPress with SEO optimization and taxonomy assignment
- YouTube video uploads with thumbnail and metadata synchronization
- User invitation system with role-based access control
- Episode grouping with 30-day cleanup and collapsible interface organization
- Bilingual content support with language-specific styling and formatting
- Style guide integration for consistent brand voice across generated content
- Real-time edit detection comparing original AI content with human modifications

## Recent Activity
Over the past month, development has concentrated on three major areas: **blog content workflow automation** with collapsible episode grouping, atomic claim prevention for duplicate generation, and comprehensive edit detection comparing Google Docs modifications against original AI content; **distribution pipeline hardening** including yt-dlp replacement for reliable YouTube downloads, cookie-based authentication, flexible format selection, and verification across all platforms; and **content quality improvements** with speaker-labeled transcript formatting, WordPress taxonomy auto-assignment, and brand consistency enforcement through style guides.

## Known Gaps & Limitations
- Google Drive API integration lacks comprehensive error handling for quota limits and permission issues
- YouTube download reliability depends on cookie authentication which may expire without automated refresh
- Blog post edit detection only tracks percentage changes without semantic analysis of modification quality
- Multi-language content generation relies on basic language codes without dialect or regional variation support
- Distribution status verification across platforms lacks automated retry mechanisms for transient failures
- User permission model operates at show level without granular content-type or workflow-stage restrictions

## Next Meaningful Capabilities
- Advanced analytics dashboard combining podcast metrics, blog performance, and cross-platform engagement data
- Automated content calendar with strategic publishing schedules based on audience behavior patterns
- Template-driven content generation allowing producers to define custom blog post structures and AI prompts
- Social media snippet generation with platform-specific optimization for Twitter, LinkedIn, and Instagram
- Collaborative workflow management with approval chains, reviewer assignments, and change tracking
- Brand voice consistency scoring with AI-powered analysis comparing generated content against established style guidelines

## Open Technical Questions
- Scalability approach for handling multiple simultaneous episode processing jobs without resource contention
- Long-term storage strategy for audio files, transcripts, and generated content with cost optimization
- Integration architecture for expanding beyond WordPress to additional CMS platforms and social networks
- Error recovery mechanisms for failed distribution attempts across multiple platforms simultaneously
- Performance optimization strategy for large transcript processing and content generation workflows
- Multi-tenant data isolation approach ensuring show data security in shared infrastructure

## Key Files & Entry Points
- `src/app/admin/blog-ideas/page.tsx` — Primary blog content management interface with episode grouping
- `src/app/admin/shows/page.tsx` — Podcast show configuration and platform integration management
- `src/app/api/distribute/analyze/route.ts` — Content distribution orchestration and platform publishing
- `scripts/transistor-scraper/` — Automated episode ingestion from podcast hosting platforms
- `prisma/schema.prisma` — Complete data model with shows, episodes, blog posts, and user relationships
- `src/app/admin/blog-ideas/actions.ts` — Blog post generation and AI content processing workflows
- `Dockerfile` — Production container with audio processing, YouTube tools, and migration automation
- `src/app/admin/shows/sync/` — Episode synchronization and metadata management system

---
_Auto-generated by [obsidian-hub](https://github.com/bret-bwkdigitalsolutions/obsidian-hub) · 2026-04-20_
