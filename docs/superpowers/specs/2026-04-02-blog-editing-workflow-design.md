# Blog Editing Workflow via Google Docs

Replace the current "generate WP draft" flow with a Google Docs-based editing workflow where hosts review and edit blog drafts in a familiar environment, and admins publish to WordPress with one click.

## Current State

- AI generates 2-3 blog topic ideas per episode from transcripts (working)
- Admin can trigger full blog post generation from an idea (working)
- Generated posts create WordPress drafts directly (working, but hosts can't/won't edit in WP)
- No notification to hosts, no review workflow, no author control

## Design

### Google Drive Structure

A top-level shared folder ("Blog Drafts" or similar) in SWM's Google Workspace. Inside it, one subfolder per show. Show folders are shared with the host(s) directly by the admin — the portal does not manage folder-level permissions.

A Google service account has editor access to the top-level folder. All doc creation goes through this service account. Docs inherit permissions from their parent show folder.

**Environment config:**
- `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON key for the service account
- `GOOGLE_BLOG_FOLDER_ID` — top-level "Blog Drafts" folder ID

**Database config:**
- Show-to-folder mapping stored in a new `ShowBlogFolder` model: `wpShowId` + `googleFolderId`

### Data Model

New `BlogPost` model:

```
BlogPost
  id            String    @id @default(cuid())
  suggestionId  String    — FK to AiSuggestion
  jobId         String    — FK to DistributionJob
  wpShowId      Int       — which show
  title         String    — blog post title
  googleDocId   String    — Google Doc identifier
  googleDocUrl  String    — shareable URL
  author        String?   — editable author name (learned default)
  hostEmail     String?   — who was notified
  status        String    — "draft" | "reviewing" | "published"
  wpPostId      Int?      — populated after WP publish
  wpPostUrl     String?   — populated after WP publish
  createdAt     DateTime
  updatedAt     DateTime
```

**Author defaulting:** When creating a new `BlogPost`, query the most recent published `BlogPost` for the same `wpShowId` and pre-fill the `author` field. If none exists, leave blank.

### Workflow

**Step 1: Generate (admin clicks "Generate Post" on a blog idea)**
1. AI generates full blog content (existing logic)
2. Portal creates a Google Doc in the show's Drive folder via Google Docs API
3. Doc contains formatted blog content (headings, paragraphs — Google Docs native formatting, not raw HTML)
4. `BlogPost` record created with status `draft`
5. `AiSuggestion.accepted` set to `true`
6. Admin sees: doc link, editable author field, host email field, "Send to Host" button

**Step 2: Send to Host (admin clicks "Send to Host")**
1. Portal sends email via Resend to the host
2. Email contains: blog title, episode name, show name, Google Doc link, brief instructions
3. `BlogPost.status` moves to `reviewing`
4. `BlogPost.hostEmail` recorded

**Step 3: Publish (admin clicks "Publish to WP")**
1. Portal reads the current Google Doc content via Google Docs API
2. Converts Google Doc content to HTML suitable for WordPress
3. Creates WordPress post with:
   - Title from the doc (or from `BlogPost.title` — admin can edit)
   - Content as HTML
   - Author name from `BlogPost.author` field (stored as WP custom meta `_swm_blog_author` — not a WP user assignment since hosts don't have WP accounts)
   - Status: `publish` (live immediately) or `draft` (admin choice)
   - Meta: `_swm_source_episode`, `_swm_source_suggestion_id`
4. `BlogPost.status` moves to `published`
5. `BlogPost.wpPostId` and `BlogPost.wpPostUrl` populated

### Admin UI

Enhanced `/admin/blog-ideas` page. Each blog idea row shows contextual controls based on state:

**Ungenerated idea:**
- "Generate Post" button (existing, modified to create Google Doc)

**Draft (generated, not sent):**
- Google Doc link
- Author field (text input, pre-filled from show history)
- Host email field
- "Send to Host" button

**Reviewing (sent to host):**
- Google Doc link
- Author field (still editable)
- Status badge: "With Host"
- "Publish to WP" button

**Published:**
- Google Doc link
- WordPress post link
- Author name
- Status badge: "Published"

### Email Template

Subject: `Blog draft ready for review: {title}`

Body:
- Show name and episode reference
- Brief note: "A blog draft has been created based on your recent episode. Please review and edit directly in the Google Doc."
- Prominent Google Doc link button
- Sign-off from SWM

Sent via Resend using existing configuration.

### Google Docs API Integration

New utility module for Google Docs operations:

**Create Doc:**
- Uses Google Drive API to create a new document in the show's folder
- Inserts formatted content using Google Docs API (not raw HTML — native headings, paragraphs, bold, links)
- Returns doc ID and URL

**Read Doc:**
- Reads the full document content via Google Docs API
- Converts Google Docs structured content to clean HTML for WordPress
- Preserves headings (H2, H3), paragraphs, bold, italic, links

Authentication: Service account with domain-wide delegation is NOT needed. The service account just needs editor access to the shared folder (granted by sharing the folder with the service account's email).

### Show Folder Mapping

New `ShowBlogFolder` model:

```
ShowBlogFolder
  id              String  @id @default(cuid())
  wpShowId        Int     @unique
  googleFolderId  String
```

Admin can configure this in settings or it can be seeded. When a blog is generated for a show without a folder mapping, the admin is prompted to add one.

## Files to Create

- `src/lib/google/docs.ts` — Google Docs API client (create doc, read doc, convert to HTML)
- `src/lib/google/auth.ts` — Service account authentication
- `src/app/admin/blog-ideas/send-to-host-button.tsx` — Send email component
- `src/app/admin/blog-ideas/publish-button.tsx` — Publish to WP component
- `src/app/admin/blog-ideas/author-field.tsx` — Editable author with learned defaults

## Files to Modify

- `prisma/schema.prisma` — Add `BlogPost` and `ShowBlogFolder` models
- `src/app/admin/blog-ideas/actions.ts` — Modify `generateBlogPost()` to create Google Doc instead of WP draft; add `sendToHost()` and `publishToWordPress()` actions
- `src/app/admin/blog-ideas/page.tsx` — Show lifecycle controls per blog post state
- `src/app/admin/blog-ideas/generate-blog-button.tsx` — Update to work with new Google Doc flow

## Environment Variables

- `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON service account credentials (or path to key file)
- `GOOGLE_BLOG_FOLDER_ID` — Top-level Google Drive folder ID
- Resend already configured (`RESEND_API_KEY`, etc.)
