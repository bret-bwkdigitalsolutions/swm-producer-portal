# Blog Editing Workflow — Implementation Prompt

Paste this into a new Claude Code session to pick up where we left off:

---

I have a completed spec for a blog editing workflow via Google Docs at `docs/superpowers/specs/2026-04-02-blog-editing-workflow-design.md`. Read the spec, then use the `superpowers:writing-plans` skill to create a detailed implementation plan.

Key context:
- The blog generation pipeline already works (AI generates content from episode transcripts via `src/lib/jobs/ai-processor.ts` and `src/app/admin/blog-ideas/actions.ts`)
- We're replacing the "create WP draft" step with "create Google Doc" and adding a review/publish workflow
- Google Docs API via service account, Resend for email (already configured), WordPress REST API for publishing
- New Prisma models needed: `BlogPost` and `ShowBlogFolder`
- Author field learns from history (most recent author for that show becomes the default)
- Admin UI lives at `/admin/blog-ideas` (existing page to be enhanced)

After writing the plan, use `superpowers:subagent-driven-development` to implement it.
