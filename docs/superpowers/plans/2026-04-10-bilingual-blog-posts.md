# Bilingual Blog Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-show language settings so Spanish-language shows generate blog content in Spanish, with automatic English translation at publish time and a WordPress frontend language toggle.

**Architecture:** Two new fields on `ShowMetadata` (`language`, `bilingual`) drive the entire feature. The AI pipeline reads these instead of hardcoded checks. At publish time, bilingual shows get a Claude translation step that stores English content in WP custom meta fields. The WordPress plugin renders both versions with a client-side toggle.

**Tech Stack:** Prisma 7, Next.js Server Actions, Anthropic SDK (Claude Sonnet), WordPress REST API, vanilla JS (WP plugin)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add `language` and `bilingual` fields to `ShowMetadata` |
| `src/app/admin/shows/show-language-editor.tsx` | New client component: language dropdown + bilingual checkbox |
| `src/app/admin/shows/actions.ts` | New `updateShowLanguage` server action |
| `src/app/admin/shows/page.tsx` | Wire up `ShowLanguageEditor` below `ShowHostsEditor` |
| `src/lib/jobs/ai-processor.ts` | Read language from ShowMetadata; pass to blog prompt |
| `src/app/admin/blog-ideas/actions.ts` | Add language instruction to blog generation prompt |
| `src/app/admin/blog-ideas/blog-actions.ts` | Translation step in `publishToWordPress` |
| `src/lib/ai/translate.ts` | New module: translate blog content via Claude |
| `wordpress/swm-frontend-display/bilingual-toggle.php` | WP plugin: render toggle + both language versions |
| `wordpress/swm-frontend-display/bilingual-toggle.js` | Client-side toggle logic |
| `wordpress/swm-frontend-display/bilingual-toggle.css` | Toggle styling |

---

### Task 1: Database — Add language fields to ShowMetadata

**Files:**
- Modify: `prisma/schema.prisma` (the `ShowMetadata` model, around line 191)

- [ ] **Step 1: Add fields to schema**

In `prisma/schema.prisma`, add two fields to the `ShowMetadata` model:

```prisma
model ShowMetadata {
  id                 String  @id @default(cuid())
  wpShowId           Int     @unique
  hosts              String
  descriptionFooter  String?
  blogReviewerEmails String?
  language           String  @default("en")
  bilingual          Boolean @default(false)

  @@map("show_metadata")
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-show-language-fields
```

Expected: Migration created and applied. Two new columns on `show_metadata` table with defaults.

- [ ] **Step 3: Verify with Prisma Studio**

Run:
```bash
npx prisma studio
```

Open `ShowMetadata` table. Confirm existing rows have `language: "en"` and `bilingual: false`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add language and bilingual fields to ShowMetadata"
```

---

### Task 2: Admin UI — Show language editor component

**Files:**
- Create: `src/app/admin/shows/show-language-editor.tsx`
- Modify: `src/app/admin/shows/actions.ts` (add `updateShowLanguage` action)
- Modify: `src/app/admin/shows/page.tsx` (wire up the new component)

- [ ] **Step 1: Create the `updateShowLanguage` server action**

Add to `src/app/admin/shows/actions.ts`:

```typescript
export async function updateShowLanguage(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  const language = (formData.get("language") as string)?.trim() || "en";
  const bilingual = formData.get("bilingual") === "on";

  if (isNaN(wpShowId) || wpShowId <= 0) {
    return { success: false, message: "Invalid show." };
  }

  if (language !== "en" && language !== "es") {
    return { success: false, message: "Invalid language." };
  }

  try {
    await db.showMetadata.upsert({
      where: { wpShowId },
      create: { wpShowId, hosts: "", language, bilingual },
      update: { language, bilingual },
    });

    revalidatePath("/admin/shows");
    return { success: true, message: "Language settings saved." };
  } catch (error) {
    console.error("Failed to update show language:", error);
    return { success: false, message: "Failed to save language settings." };
  }
}
```

- [ ] **Step 2: Create `ShowLanguageEditor` component**

Create `src/app/admin/shows/show-language-editor.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateShowLanguage } from "./actions";
import { Loader2Icon } from "lucide-react";

interface ShowLanguageEditorProps {
  wpShowId: number;
  currentLanguage: string;
  currentBilingual: boolean;
}

export function ShowLanguageEditor({
  wpShowId,
  currentLanguage,
  currentBilingual,
}: ShowLanguageEditorProps) {
  const [state, formAction, isPending] = useActionState(updateShowLanguage, {});

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Language Settings</Label>
      <p className="text-xs text-muted-foreground">
        Primary language for AI-generated blog content. Bilingual shows get an
        auto-translated version at publish time.
      </p>
      <form action={formAction} className="flex items-center gap-4">
        <input type="hidden" name="wp_show_id" value={wpShowId} />
        <select
          name="language"
          defaultValue={currentLanguage}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="bilingual"
            defaultChecked={currentBilingual}
            className="rounded border-input"
          />
          Bilingual
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
        </Button>
        {state.success && (
          <span className="text-xs text-green-600">Saved</span>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire up in page.tsx**

In `src/app/admin/shows/page.tsx`:

Add the import at the top (after the `ShowHostsEditor` import):
```tsx
import { ShowLanguageEditor } from "./show-language-editor";
```

After the `ShowHostsEditor` block (after line 125), add:
```tsx
<ShowLanguageEditor
  wpShowId={show.id}
  currentLanguage={showMeta?.language ?? "en"}
  currentBilingual={showMeta?.bilingual ?? false}
/>
```

- [ ] **Step 4: Verify in browser**

Run `npm run dev`, navigate to `/admin/shows`. Each show card should display:
- The existing Hosts editor
- A new Language Settings section with a dropdown (English/Spanish) and Bilingual checkbox
- Save button that persists the settings

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/shows/show-language-editor.tsx src/app/admin/shows/actions.ts src/app/admin/shows/page.tsx
git commit -m "feat: add language settings UI to admin show management"
```

---

### Task 3: AI Processor — Use ShowMetadata language for blog ideas

**Files:**
- Modify: `src/lib/jobs/ai-processor.ts`

- [ ] **Step 1: Look up ShowMetadata in `generateAiSuggestions`**

In `src/lib/jobs/ai-processor.ts`, after the job lookup (line 128), add a ShowMetadata lookup and use it to determine language:

```typescript
// After: const job = await db.distributionJob.findUnique({ where: { id: jobId } });

const showMetadata = await db.showMetadata.findUnique({
  where: { wpShowId: job.wpShowId },
});

// ShowMetadata.language takes precedence over detected language for blog content
const showLanguage = showMetadata?.language ?? language ?? undefined;
```

Then update the context object (line 134) to use `showLanguage`:

```typescript
const ctx: AnalysisContext = {
  title: job.title,
  description: (metadata.description as string) ?? undefined,
  transcript: transcript ?? undefined,
  language: showLanguage,
};
```

Note: This means `buildSummaryPrompt` also picks up the ShowMetadata language, which is correct — the existing `ctx.language === "es"` check on line 64 will now be driven by ShowMetadata instead of only Deepgram detection.

- [ ] **Step 2: Add language instruction to `buildBlogPrompt`**

In `src/lib/jobs/ai-processor.ts`, modify `buildBlogPrompt` (line 74) to include a language instruction:

```typescript
function buildBlogPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are an SEO content strategist analyzing a podcast episode to find companion blog post opportunities.",
    "",
    "Your goal: identify 2-3 topics that were MENTIONED but NOT deeply explored in the episode.",
    "These topics should be:",
    "- Tangential to the episode content, not a retelling of it",
    "- Interesting enough to stand alone as a blog post",
    "- Likely to attract search engine and AI traffic",
    "- Deep enough to write 800-1200 words about",
    "",
    "For each suggestion, provide:",
    "1. A compelling, SEO-optimized blog post title",
    "2. A 2-3 sentence description of what the post would cover and why it's valuable",
    "3. 5-8 target SEO keywords",
    "4. How it connects to the episode (so we can cross-link)",
    "",
    "Separate each suggestion with a line containing only '---'.",
    "",
    "DO NOT suggest posts that simply summarize or recap the episode.",
    "DO suggest posts that a listener would want to read AFTER hearing the episode to learn more about something that caught their interest.",
    ctx.language === "es"
      ? "\nIMPORTANT: Write all blog titles, descriptions, and keywords in Spanish. The show is Spanish-language."
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/ai-processor.ts
git commit -m "feat: use ShowMetadata language for blog idea generation"
```

---

### Task 4: Blog Generation — Write full posts in show's primary language

**Files:**
- Modify: `src/app/admin/blog-ideas/actions.ts`

- [ ] **Step 1: Look up ShowMetadata language in `generateBlogPost`**

In `src/app/admin/blog-ideas/actions.ts`, after the suggestion lookup (around line 36), add:

```typescript
const showMetadata = await db.showMetadata.findUnique({
  where: { wpShowId: suggestion.job.wpShowId },
});
const showLanguage = showMetadata?.language ?? "en";
```

- [ ] **Step 2: Add language instruction to the generation prompt**

In the prompt array (starting line 62), add a language instruction after the Requirements section. Insert before the `customInstructions` block:

```typescript
    showLanguage === "es"
      ? "- IMPORTANT: Write the entire blog post in Spanish — headline, excerpt, SEO description, keyphrase, and HTML body must all be in Spanish"
      : "",
```

The full prompt array becomes (showing only the changed area around the Requirements section):

```typescript
  const prompt = [
    "You are a skilled blog writer for a podcast network. Write a complete, SEO-optimized blog post based on the topic idea below.",
    "",
    "## Blog Topic Idea",
    suggestion.content,
    "",
    "## Source Episode",
    `Title: "${suggestion.job.title}"`,
    episodeDescription ? `Description: ${episodeDescription}` : "",
    "",
    transcript
      ? `## Episode Transcript (for reference — do NOT summarize the episode, use this for context and accuracy)\n${transcript.slice(0, 8000)}`
      : "",
    "",
    "## Requirements",
    "- Write 800-1200 words",
    "- Use an engaging, conversational tone",
    "- Include a compelling headline (H1)",
    "- Use H2 and H3 subheadings to break up the content",
    "- Naturally incorporate SEO keywords from the topic idea",
    "- Reference the episode at the end with a call-to-action to listen",
    "- Output the post body in HTML (no <html>/<head>/<body> tags, just the content)",
    "- First line should be the headline as plain text (no HTML)",
    "- Second line should be a ~30 word excerpt/summary for preview cards, prefixed with EXCERPT:",
    "- Third line should be a meta description for SEO (max 160 chars), prefixed with SEO:",
    "- Fourth line should be an SEO focus keyphrase (2-4 words), prefixed with KEYPHRASE:",
    "- Then a blank line, then the HTML body",
    showLanguage === "es"
      ? "- IMPORTANT: Write the entire blog post in Spanish — headline, excerpt, SEO description, keyphrase, and HTML body must all be in Spanish"
      : "",
    customInstructions
      ? `\n## Additional Instructions from Editor\n${customInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/blog-ideas/actions.ts
git commit -m "feat: generate full blog posts in show's primary language"
```

---

### Task 5: Translation Module — Translate blog content via Claude

**Files:**
- Create: `src/lib/ai/translate.ts`

- [ ] **Step 1: Create the translation module**

Create `src/lib/ai/translate.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export interface BlogTranslation {
  title: string;
  content: string;
  excerpt: string;
  seoDescription: string;
  seoKeyphrase: string;
}

/**
 * Translate blog post content from one language to another using Claude.
 * Returns the translated fields, or null if translation fails.
 */
export async function translateBlogPost(
  source: {
    title: string;
    content: string;
    excerpt: string | null;
    seoDescription: string | null;
    seoKeyphrase: string | null;
  },
  fromLanguage: string,
  toLanguage: string
): Promise<BlogTranslation | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[translate] ANTHROPIC_API_KEY is not set.");
    return null;
  }

  const fromLabel = fromLanguage === "es" ? "Spanish" : "English";
  const toLabel = toLanguage === "es" ? "Spanish" : "English";

  const prompt = [
    `Translate the following blog post from ${fromLabel} to ${toLabel}.`,
    "Preserve the HTML structure exactly. Do not add or remove HTML tags.",
    "Translate naturally — this should read as if originally written in the target language, not as a literal translation.",
    "",
    "Return the translation in this exact format:",
    "TITLE: <translated title>",
    "EXCERPT: <translated excerpt>",
    "SEO: <translated SEO description, max 160 chars>",
    "KEYPHRASE: <translated focus keyphrase>",
    "",
    "<translated HTML body>",
    "",
    "---",
    "",
    `## Title`,
    source.title,
    "",
    `## Excerpt`,
    source.excerpt ?? "",
    "",
    `## SEO Description`,
    source.seoDescription ?? "",
    "",
    `## Focus Keyphrase`,
    source.seoKeyphrase ?? "",
    "",
    `## HTML Body`,
    source.content,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const fullText = textBlock?.text ?? "";

    // Parse structured output
    const lines = fullText.split("\n");
    let title = "";
    let excerpt = "";
    let seoDescription = "";
    let seoKeyphrase = "";
    let bodyStartIndex = 0;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (line.startsWith("TITLE:")) {
        title = line.replace("TITLE:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("EXCERPT:")) {
        excerpt = line.replace("EXCERPT:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("SEO:")) {
        seoDescription = line.replace("SEO:", "").trim().slice(0, 160);
        bodyStartIndex = i + 1;
      } else if (line.startsWith("KEYPHRASE:")) {
        seoKeyphrase = line.replace("KEYPHRASE:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("<")) {
        bodyStartIndex = i;
        break;
      }
    }

    const content = lines.slice(bodyStartIndex).join("\n").trim();

    if (!title || !content) {
      console.error("[translate] Translation returned empty title or content.");
      return null;
    }

    return { title, content, excerpt, seoDescription, seoKeyphrase };
  } catch (error) {
    console.error("[translate] Translation failed:", error);
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/translate.ts
git commit -m "feat: add blog post translation module"
```

---

### Task 6: Publish Flow — Translate at publish time for bilingual shows

**Files:**
- Modify: `src/app/admin/blog-ideas/blog-actions.ts`

- [ ] **Step 1: Add translation step to `publishToWordPress`**

In `src/app/admin/blog-ideas/blog-actions.ts`, add the import at the top:

```typescript
import { translateBlogPost } from "@/lib/ai/translate";
```

In the `publishToWordPress` function, after reading the Google Doc content (after line 213, the `if (!docHtml.trim())` check), add a ShowMetadata lookup and translation step:

```typescript
  // Look up show language settings
  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: blogPost.job.wpShowId },
  });
  const isBilingual = showMetadata?.bilingual ?? false;
  const primaryLanguage = showMetadata?.language ?? "en";

  // Translate if bilingual
  let translationMeta: Record<string, string> = {};
  if (isBilingual) {
    const secondaryLanguage = primaryLanguage === "es" ? "en" : "es";
    const translation = await translateBlogPost(
      {
        title,
        content: docHtml,
        excerpt: blogPost.excerpt,
        seoDescription: blogPost.seoDescription,
        seoKeyphrase: blogPost.seoKeyphrase,
      },
      primaryLanguage,
      secondaryLanguage
    );

    if (translation) {
      const suffix = `_${secondaryLanguage}`;
      translationMeta = {
        [`_swm_blog_title${suffix}`]: translation.title,
        [`_swm_blog_content${suffix}`]: translation.content,
        [`_swm_blog_excerpt${suffix}`]: translation.excerpt,
        [`_swm_blog_seo_description${suffix}`]: translation.seoDescription,
        [`_swm_blog_seo_keyphrase${suffix}`]: translation.seoKeyphrase,
      };
    } else {
      console.warn(
        `[publishToWordPress] Translation failed for blog post ${blogPostId}. Publishing primary language only.`
      );
    }
  }
```

Then modify the WordPress POST body's `meta` object to include the translation fields. Change the `meta` object in the `JSON.stringify` call (around line 231) to spread `translationMeta`:

```typescript
        meta: {
          parent_show_id: blogPost.job.wpShowId,
          _swm_blog_author: blogPost.author ?? "",
          _swm_source_suggestion_id: blogPost.suggestion.id,
          ...(blogPost.job.platforms[0]?.externalId
            ? { _swm_linked_episode: parseInt(blogPost.job.platforms[0].externalId, 10) }
            : {}),
          ...(blogPost.seoDescription
            ? { _swm_seo_description: blogPost.seoDescription }
            : {}),
          ...(blogPost.seoKeyphrase
            ? { _swm_seo_focus_keyphrase: blogPost.seoKeyphrase }
            : {}),
          ...translationMeta,
        },
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/blog-ideas/blog-actions.ts
git commit -m "feat: translate blog posts at publish time for bilingual shows"
```

---

### Task 7: WordPress Plugin — Bilingual toggle on blog posts

**Files:**
- Create: `wordpress/swm-frontend-display/bilingual-toggle.php`
- Create: `wordpress/swm-frontend-display/bilingual-toggle.js`
- Create: `wordpress/swm-frontend-display/bilingual-toggle.css`

Note: The SWM Frontend Display plugin lives in WordPress, not in this repo. These files document exactly what needs to be added to the plugin. The admin will need to deploy these to the WordPress installation.

- [ ] **Step 1: Create the PHP template filter**

Create `wordpress/swm-frontend-display/bilingual-toggle.php`:

```php
<?php
/**
 * Bilingual toggle for swm_blog posts.
 *
 * Renders both language versions with a client-side toggle when
 * bilingual meta fields exist on the post.
 */

if (!defined('ABSPATH')) exit;

/**
 * Register bilingual meta fields so they're available via REST API.
 */
function swm_register_bilingual_meta() {
    $fields = [
        '_swm_blog_title_en',
        '_swm_blog_content_en',
        '_swm_blog_excerpt_en',
        '_swm_blog_seo_description_en',
        '_swm_blog_seo_keyphrase_en',
    ];

    foreach ($fields as $field) {
        register_post_meta('swm_blog', $field, [
            'show_in_rest' => true,
            'single'       => true,
            'type'         => 'string',
            'auth_callback' => function() {
                return current_user_can('edit_posts');
            },
        ]);
    }
}
add_action('init', 'swm_register_bilingual_meta');

/**
 * Filter the_content on swm_blog single posts to add the bilingual toggle.
 */
function swm_bilingual_content_filter($content) {
    if (!is_singular('swm_blog')) {
        return $content;
    }

    $post_id = get_the_ID();
    $en_content = get_post_meta($post_id, '_swm_blog_content_en', true);

    // No translation — render normally
    if (empty($en_content)) {
        return $content;
    }

    $en_title = get_post_meta($post_id, '_swm_blog_title_en', true);

    // Enqueue assets
    $plugin_url = plugin_dir_url(__FILE__);
    wp_enqueue_style('swm-bilingual-toggle', $plugin_url . 'bilingual-toggle.css', [], '1.0');
    wp_enqueue_script('swm-bilingual-toggle', $plugin_url . 'bilingual-toggle.js', [], '1.0', true);

    // Build the toggle + dual-content HTML
    $toggle = '<div class="swm-lang-toggle" role="tablist" aria-label="Language">'
        . '<button class="swm-lang-btn active" role="tab" aria-selected="true" data-lang="es">ES</button>'
        . '<button class="swm-lang-btn" role="tab" aria-selected="false" data-lang="en">EN</button>'
        . '</div>';

    $primary = '<div class="swm-lang-content" data-lang="es">' . $content . '</div>';
    $secondary = '<div class="swm-lang-content" data-lang="en" style="display:none">'
        . ($en_title ? '<h1>' . esc_html($en_title) . '</h1>' : '')
        . $en_content
        . '</div>';

    return $toggle . $primary . $secondary;
}
add_filter('the_content', 'swm_bilingual_content_filter', 20);
```

- [ ] **Step 2: Create the client-side toggle script**

Create `wordpress/swm-frontend-display/bilingual-toggle.js`:

```javascript
(function () {
  "use strict";

  var STORAGE_KEY = "swm_preferred_lang";

  function init() {
    var toggle = document.querySelector(".swm-lang-toggle");
    if (!toggle) return;

    var buttons = toggle.querySelectorAll(".swm-lang-btn");
    var sections = document.querySelectorAll(".swm-lang-content");

    // Determine default language
    var stored = localStorage.getItem(STORAGE_KEY);
    var defaultLang = stored || (navigator.language.startsWith("es") ? "es" : "en");

    switchLang(defaultLang, buttons, sections);

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var lang = btn.getAttribute("data-lang");
        switchLang(lang, buttons, sections);
        localStorage.setItem(STORAGE_KEY, lang);
      });
    });
  }

  function switchLang(lang, buttons, sections) {
    buttons.forEach(function (btn) {
      var isActive = btn.getAttribute("data-lang") === lang;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    sections.forEach(function (section) {
      section.style.display = section.getAttribute("data-lang") === lang ? "" : "none";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
```

- [ ] **Step 3: Create the toggle styles**

Create `wordpress/swm-frontend-display/bilingual-toggle.css`:

```css
.swm-lang-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: #f1f1f1;
  border-radius: 6px;
  margin-bottom: 1.5em;
}

.swm-lang-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: #666;
  transition: background 0.15s, color 0.15s;
}

.swm-lang-btn.active {
  background: #fff;
  color: #111;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.swm-lang-btn:hover:not(.active) {
  color: #333;
}
```

- [ ] **Step 4: Commit**

```bash
git add wordpress/swm-frontend-display/
git commit -m "feat: WordPress bilingual toggle for swm_blog posts"
```

---

### Task 8: WordPress Meta Registration — Ensure meta fields are writable

**Files:**
- Modify: The main SWM Frontend Display plugin file (or `bilingual-toggle.php` from Task 7 already handles this)

This is already handled by `swm_register_bilingual_meta()` in Task 7's `bilingual-toggle.php`. The `register_post_meta` calls with `show_in_rest => true` make the fields writable via the REST API.

- [ ] **Step 1: Verify meta fields are accepted by WP REST API**

After deploying the plugin update, test with curl:

```bash
curl -X POST "${WP_API_URL}/swm_blog" \
  -H "Authorization: Basic ${WP_AUTH}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test bilingual","content":"<p>Test</p>","status":"draft","meta":{"_swm_blog_content_en":"<p>English test</p>","_swm_blog_title_en":"English Test"}}'
```

Expected: Post created with meta fields stored. Verify with:
```bash
curl "${WP_API_URL}/swm_blog/<post_id>?_fields=meta" -H "Authorization: Basic ${WP_AUTH}"
```

- [ ] **Step 2: Clean up test post**

Delete the test post from WordPress admin or via REST API.

---

### Task 9: End-to-end verification

- [ ] **Step 1: Set Al Maximo to Spanish + Bilingual**

In the admin panel at `/admin/shows`, find Al Maximo. Set language to "Spanish" and check "Bilingual". Save.

- [ ] **Step 2: Verify blog ideas generate in Spanish**

Upload an episode for Al Maximo (or trigger AI suggestions on an existing job). Confirm the blog ideas are in Spanish.

- [ ] **Step 3: Verify full blog post generates in Spanish**

Click "Generate Post" on a Spanish blog idea. Confirm the Google Doc contains a Spanish blog post.

- [ ] **Step 4: Verify publish creates translation**

Click "Publish" on the Spanish blog post. Check the WordPress post:
- Standard fields (title, content, excerpt) should be in Spanish
- Meta fields (`_swm_blog_title_en`, `_swm_blog_content_en`, etc.) should contain English translations

- [ ] **Step 5: Verify frontend toggle**

Visit the published blog post on the website. Confirm:
- ES/EN toggle appears below the title
- Clicking EN shows the English translation
- Clicking ES shows the Spanish original
- Default language matches `navigator.language`
- Choice persists in `localStorage` across page loads

- [ ] **Step 6: Verify non-bilingual shows are unaffected**

Check an English-only show. Confirm:
- Blog ideas generate in English (as before)
- Published posts have no translation meta fields
- No toggle appears on the frontend
