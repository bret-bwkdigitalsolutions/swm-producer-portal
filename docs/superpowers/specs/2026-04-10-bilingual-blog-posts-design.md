# Bilingual Blog Posts Design

## Problem

Al Maximo is a Spanish-language show. The blog generation pipeline currently produces English-only content regardless of the show's language. Hosts need to review and edit in Spanish, and the website should display both Spanish and English versions with a visitor-facing toggle.

## Scope

Blog posts only. Episode descriptions and other AI-generated content are out of scope (episode summaries already conditionally generate in Spanish).

## Design

### Show-Level Language Setting

Add two fields to `ShowMetadata`:

- `language` (String, default `"en"`) — The primary content language for the show. Controls what language AI-generated blog content is written in.
- `bilingual` (Boolean, default `false`) — Whether to auto-generate a translation in the secondary language at publish time.

For Al Maximo: `language: "es"`, `bilingual: true`. All other shows keep defaults.

The admin shows page gets a language dropdown (English, Spanish) and a bilingual checkbox. These replace the hardcoded `language === "es"` check currently in `ai-processor.ts`.

### Blog Generation Pipeline

#### Blog Idea Generation

`ai-processor.ts` reads `ShowMetadata.language` for the show being processed. The blog ideas prompt instructs Claude to generate ideas in the show's primary language. For Spanish shows, blog ideas come back in Spanish.

#### Full Blog Post Generation

When admin clicks "Generate Post" in the blog ideas UI, the generation prompt (`blog-actions.ts` / `actions.ts`) writes in the show's primary language. For Al Maximo, the output (title, excerpt, SEO description, focus keyphrase, HTML body) is all in Spanish. The Google Doc is created with Spanish content.

#### Host Review

No change to the review workflow. Hosts receive the Google Doc link via email and edit in the primary language (Spanish for Al Maximo). Only one Google Doc per blog post.

#### Translation at Publish Time

When publishing a blog post for a bilingual show (`publishToWordPress` in `blog-actions.ts`):

1. Read the final content from Google Docs (existing step).
2. Call Claude (Sonnet) to translate the full post to the secondary language (English for Spanish-primary shows). Translate: title, excerpt, body HTML, SEO description, and focus keyphrase.
3. Create the WordPress post with:
   - Standard fields (`title`, `content`, `excerpt`) hold the primary language (Spanish).
   - Translation stored in custom meta fields:
     - `_swm_blog_title_en` — English title
     - `_swm_blog_content_en` — English body HTML
     - `_swm_blog_excerpt_en` — English excerpt
     - `_swm_blog_seo_description_en` — English SEO description
     - `_swm_blog_seo_keyphrase_en` — English focus keyphrase

The primary language occupies the standard WP fields so search, RSS, excerpts, and SEO plugins all work normally using the primary language content.

For non-bilingual shows, the publish flow is unchanged — no translation step, no extra meta fields.

### WordPress Frontend Toggle

The SWM Frontend Display plugin renders a language toggle on blog posts that have bilingual meta fields.

#### Detection

On `swm_blog` single post templates, check if `_swm_blog_content_en` meta exists and is non-empty. If not present, render the post normally with no toggle.

#### Toggle UI

A small pill-tab switcher rendered just below the post title: two buttons labeled "ES" and "EN". Styled to match the site's existing design. Unobtrusive — does not interfere with post content.

#### Behavior

Both language versions are rendered in the HTML output. The translation sits in a hidden container (`display: none`). Clicking the toggle swaps visibility between the two containers. Pure client-side JavaScript — no page reload, no AJAX. This keeps the page fully cacheable by Varnish.

#### Default Language

On page load, check `navigator.language`:
- If it starts with `"es"`, default to Spanish.
- Otherwise, default to English.

Store the visitor's choice in `localStorage` so it persists across page visits and Al Maximo posts.

#### Non-bilingual posts

No toggle rendered. No extra markup. Zero impact on existing posts.

### Data Flow

```
Episode uploaded
  → Deepgram detects language
  → AI processor reads ShowMetadata.language (replaces hardcoded check)
  → Blog ideas generated in show's primary language

Admin clicks "Generate Post"
  → Full blog written in primary language
  → Google Doc created in primary language

Hosts review/edit in Google Doc (primary language only)

Admin clicks "Publish"
  → Read final content from Google Doc
  → If ShowMetadata.bilingual:
      → Claude translates to secondary language
  → WordPress post created:
      - title/content/excerpt = primary language
      - _swm_blog_*_en meta fields = English translation (if bilingual)

Visitor loads post
  → SWM Frontend Display checks for bilingual meta
  → If present: render toggle + both versions, default by navigator.language
  → If absent: render normally
```

### Database Changes

```prisma
model ShowMetadata {
  id                 String  @id @default(cuid())
  wpShowId           Int     @unique
  hosts              String
  descriptionFooter  String?
  blogReviewerEmails String?
  language           String  @default("en")  // NEW
  bilingual          Boolean @default(false)  // NEW
}
```

### Files Modified

**Portal:**

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `language` and `bilingual` to `ShowMetadata` |
| `src/app/admin/shows/page.tsx` | Language dropdown + bilingual checkbox in show settings |
| `src/app/admin/shows/actions.ts` | Handle language/bilingual updates |
| `src/lib/jobs/ai-processor.ts` | Read language from `ShowMetadata` instead of hardcoded check; pass to blog prompt |
| `src/app/admin/blog-ideas/actions.ts` | Pass show language to blog generation prompt |
| `src/app/admin/blog-ideas/blog-actions.ts` | Spanish blog generation prompt; translation step at publish time |

**WordPress:**

| File | Change |
|------|--------|
| `swm-frontend-display` plugin | Bilingual toggle component on `swm_blog` single posts |

### Error Handling

- If translation fails at publish time, publish the primary language version anyway and log the error. The post is usable without the translation — the toggle simply won't appear on the frontend.
- If `ShowMetadata` doesn't exist for a show (shouldn't happen, but defensively), default to `language: "en"`, `bilingual: false`.
