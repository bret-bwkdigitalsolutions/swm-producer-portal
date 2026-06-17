# Episode Keywords & Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain tags text input on the distribution form with a smart chip UI backed by AI-generated keywords and per-show tag history.

**Architecture:** Three loosely-coupled layers: (1) `ai-processor.ts` generates an eighth suggestion type (`"keywords"`) alongside existing types; (2) a new `TagInput` React component handles all chip UI interactions and exposes a hidden form input; (3) `page.tsx` computes per-show frequent tags from historical `DistributionJob.metadata.tags`, and `distribution-form.tsx` wires them all together.

**Tech Stack:** Next.js 16 App Router, Vitest + @testing-library/react (jsdom), Prisma 7, Tailwind v4, Lucide icons

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/jobs/ai-processor.ts` | Add `"keywords"` to `AiSuggestionType`; add `buildKeywordsPrompt`; wire into `singleConfigs` |
| Modify | `tests/lib/jobs/ai-processor.test.ts` | Fix broken mock (missing `showMetadata`, `upsert`, `deleteMany`); add keywords assertions |
| Create | `src/components/forms/tag-input.tsx` | Chip UI: selected chips (×-dismissible), suggested chips (click-to-add), free-text input, hidden form input |
| Create | `tests/components/tag-input.test.tsx` | Unit tests for all TagInput interactions |
| Modify | `src/app/dashboard/distribute/new/page.tsx` | Query `DistributionJob.metadata.tags` per show; compute top-12 per show; pass `frequentTags` to form |
| Modify | `src/app/dashboard/distribute/new/distribution-form.tsx` | Add `frequentTags` prop; `tags`/`suggestedTags` state; reset on show/video change; AI keyword parsing; replace `<Input>` with `<TagInput>` |

---

### Task 1: Add `"keywords"` to `ai-processor.ts`

**Files:**
- Modify: `src/lib/jobs/ai-processor.ts`

**Context:** `AiSuggestionType` is a string union on line 4. `buildKeywordsPrompt` needs to be a new function following the same pattern as `buildSummaryPrompt`. The `singleConfigs` array (currently chapters + summary) is what gets processed via `Promise.allSettled` — keywords goes there, not with blog. The `typesToGenerate` default on line 153 needs `"keywords"` added.

- [ ] **Step 1: Extend `AiSuggestionType` to include `"keywords"`**

In `src/lib/jobs/ai-processor.ts`, change line 4:

```typescript
export type AiSuggestionType = "chapters" | "summary" | "blog" | "keywords";
```

- [ ] **Step 2: Add `buildKeywordsPrompt` after `buildBlogPrompt` (around line 107)**

```typescript
function buildKeywordsPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer tag an episode for SEO discovery.",
    "Generate 8-12 short, SEO-friendly tags (1-3 word phrases each).",
    "Requirements:",
    "- One tag per line",
    "- No markdown, no bullet points, no numbering",
    "- No duplicates",
    "- Lowercase only",
    "- Focus on topics, themes, people, and places discussed",
    ctx.language === "es"
      ? "- Write all tags in Spanish since the episode is in Spanish"
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 3: Update `typesToGenerate` default and add keywords to `singleConfigs`**

Change the default types on line 153:
```typescript
const typesToGenerate = types ?? ["chapters", "summary", "blog", "keywords"];
```

Add to `singleConfigs` block — after the existing `if (typesToGenerate.includes("summary"))` block (around line 161):
```typescript
if (typesToGenerate.includes("keywords")) {
  suggestionConfigs.push({ type: "keywords", prompt: buildKeywordsPrompt(ctx) });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobs/ai-processor.ts
git commit -m "feat: add keywords AiSuggestionType and prompt builder"
```

---

### Task 2: Fix and update `ai-processor.test.ts`

**Files:**
- Modify: `tests/lib/jobs/ai-processor.test.ts`

**Context:** The existing test mock is missing `db.showMetadata`, `db.aiSuggestion.findFirst`, `db.aiSuggestion.upsert`, and `db.aiSuggestion.deleteMany`. Without these, the tests fail silently (Promise.allSettled swallows upsert errors). The mock also doesn't set `wpShowId` on `MOCK_JOB`. Fix the mock as part of updating for keywords. After fixing, Anthropic is called 4 times (chapters, summary, keywords in allSettled + blog separately).

- [ ] **Step 1: Verify the existing tests fail (confirms the mock is broken)**

```bash
npm test -- tests/lib/jobs/ai-processor.test.ts
```

Expected: Several test failures due to `db.showMetadata.findUnique is not a function` and assertion mismatches.

- [ ] **Step 2: Replace the db mock and `MOCK_JOB` constant with correct versions**

Replace the entire `vi.mock("@/lib/db", ...)` block and `MOCK_JOB` constant with:

```typescript
// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockJobFindUnique = vi.fn();
const mockShowMetaFindUnique = vi.fn();
const mockSuggestionFindFirst = vi.fn();
const mockSuggestionUpsert = vi.fn();
const mockSuggestionDeleteMany = vi.fn();
const mockSuggestionCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    distributionJob: {
      findUnique: (...args: unknown[]) => mockJobFindUnique(...args),
    },
    showMetadata: {
      findUnique: (...args: unknown[]) => mockShowMetaFindUnique(...args),
    },
    aiSuggestion: {
      findFirst: (...args: unknown[]) => mockSuggestionFindFirst(...args),
      upsert: (...args: unknown[]) => mockSuggestionUpsert(...args),
      deleteMany: (...args: unknown[]) => mockSuggestionDeleteMany(...args),
      create: (...args: unknown[]) => mockSuggestionCreate(...args),
    },
  },
}));
```

And update `MOCK_JOB`:
```typescript
const MOCK_JOB = {
  id: "job-123",
  wpShowId: 42,
  title: "The Mystery of the Missing Cat",
  metadata: {
    description: "An in-depth look at a puzzling case.",
  },
};
```

- [ ] **Step 3: Update `beforeEach` to set up all mock defaults**

Replace the existing `beforeEach`:
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv, ANTHROPIC_API_KEY: "test-key-123" };

  mockJobFindUnique.mockResolvedValue(MOCK_JOB);
  mockShowMetaFindUnique.mockResolvedValue(null); // no show metadata
  mockSuggestionFindFirst.mockResolvedValue(null); // no existing suggestion
  mockSuggestionUpsert.mockResolvedValue({ id: "suggestion-1" });
  mockSuggestionDeleteMany.mockResolvedValue({ count: 0 });
  mockSuggestionCreate.mockResolvedValue({ id: "suggestion-new" });
  mockMessagesCreate.mockResolvedValue(
    makeMockResponse("Mock AI response content")
  );
});
```

- [ ] **Step 4: Update the "creates three AI suggestions" test to expect four**

Replace the first `it(...)` test:
```typescript
it("creates four AI suggestions (chapters, summary, keywords, blog) for a valid job", async () => {
  await generateAiSuggestions("job-123", "This is a transcript about cats.");

  expect(mockJobFindUnique).toHaveBeenCalledWith({ where: { id: "job-123" } });

  // 3 via Promise.allSettled (chapters, summary, keywords) + 1 for blog = 4
  expect(mockMessagesCreate).toHaveBeenCalledTimes(4);

  // chapters, summary, keywords are upserted (3 calls)
  expect(mockSuggestionUpsert).toHaveBeenCalledTimes(3);
  const upsertTypes = mockSuggestionUpsert.mock.calls.map(
    (call) => (call[0] as { create: { type: string } }).create.type
  );
  expect(upsertTypes).toContain("chapters");
  expect(upsertTypes).toContain("summary");
  expect(upsertTypes).toContain("keywords");

  // blog ideas are created (1 — mock response has no '---' separator)
  expect(mockSuggestionCreate).toHaveBeenCalledTimes(1);
  expect(mockSuggestionCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ type: "blog", accepted: false }),
  });
});
```

- [ ] **Step 5: Add a test for keywords prompt content**

Add a new test after the existing tests:
```typescript
it("keywords prompt includes SEO tag instructions and transcript content", async () => {
  await generateAiSuggestions("job-123", "A transcript about serial killers and forensic science.");

  // Find the call where the prompt contains keywords-specific instructions
  const keywordsCall = mockMessagesCreate.mock.calls.find((call) => {
    const params = call[0] as { messages: { content: string }[] };
    return params.messages[0].content.includes("One tag per line");
  });
  expect(keywordsCall).toBeDefined();

  const prompt = (keywordsCall![0] as { messages: { content: string }[] })
    .messages[0].content;
  expect(prompt).toContain("8-12");
  expect(prompt).toContain("Lowercase only");
  expect(prompt).toContain("A transcript about serial killers");
});

it("keywords prompt uses Spanish instruction when show language is es", async () => {
  mockShowMetaFindUnique.mockResolvedValue({ language: "es" });

  await generateAiSuggestions("job-123", "Una transcripción en español.");

  const keywordsCall = mockMessagesCreate.mock.calls.find((call) => {
    const params = call[0] as { messages: { content: string }[] };
    return params.messages[0].content.includes("One tag per line");
  });
  expect(keywordsCall).toBeDefined();

  const prompt = (keywordsCall![0] as { messages: { content: string }[] })
    .messages[0].content;
  expect(prompt).toContain("Write all tags in Spanish");
});
```

- [ ] **Step 6: Update remaining tests that reference old mock variable names**

Find all references to `mockFindUnique` and `mockCreate` in the test file and replace them:
- `mockFindUnique` → `mockJobFindUnique`  
- `mockCreate` → `mockSuggestionCreate`

Also update the assertion `expect(mockCreate).not.toHaveBeenCalled()` tests to use `mockSuggestionCreate` and `mockSuggestionUpsert`.

In the "skips generation gracefully" test, update `vi.doMock` to include all db methods:
```typescript
vi.doMock("@/lib/db", () => ({
  db: {
    distributionJob: { findUnique: mockJobFindUnique },
    showMetadata: { findUnique: mockShowMetaFindUnique },
    aiSuggestion: {
      findFirst: mockSuggestionFindFirst,
      upsert: mockSuggestionUpsert,
      deleteMany: mockSuggestionDeleteMany,
      create: mockSuggestionCreate,
    },
  },
}));
```

And update the assertions:
```typescript
expect(mockMessagesCreate).not.toHaveBeenCalled();
expect(mockSuggestionUpsert).not.toHaveBeenCalled();
expect(mockSuggestionCreate).not.toHaveBeenCalled();
```

In the "handles partial failures" test, update `mockCreate` → `mockSuggestionCreate` and adjust the timing assertion. The test mocks 3 messages.create calls (2 succeed, 1 fails). With 4 types now (chapters, summary, keywords in allSettled + blog), update:
```typescript
// chapters succeeds, summary fails, keywords succeeds, blog succeeds
mockMessagesCreate
  .mockResolvedValueOnce(makeMockResponse("Chapters content"))
  .mockRejectedValueOnce(new Error("Rate limit exceeded"))
  .mockResolvedValueOnce(makeMockResponse("Keywords content"))
  .mockResolvedValueOnce(makeMockResponse("Blog content"));

// 2 upserts succeed (chapters and keywords), 1 fails (summary)
expect(mockSuggestionUpsert).toHaveBeenCalledTimes(2);
// blog create succeeds
expect(mockSuggestionCreate).toHaveBeenCalledTimes(1);
```

In the "handles job not found" test, update `mockFindUnique` → `mockJobFindUnique` and assertions:
```typescript
expect(mockMessagesCreate).not.toHaveBeenCalled();
expect(mockSuggestionUpsert).not.toHaveBeenCalled();
expect(mockSuggestionCreate).not.toHaveBeenCalled();
```

- [ ] **Step 7: Run tests and confirm all pass**

```bash
npm test -- tests/lib/jobs/ai-processor.test.ts
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add tests/lib/jobs/ai-processor.test.ts
git commit -m "test: update ai-processor tests for keywords type and fix stale mocks"
```

---

### Task 3: Build `TagInput` component

**Files:**
- Create: `src/components/forms/tag-input.tsx`
- Create: `tests/components/tag-input.test.tsx`

**Context:** The project uses Tailwind v4 and shadcn/ui v4 (base-ui, not Radix). No `asChild`. Use Lucide's `XIcon` for the dismiss button. The hidden `<input type="hidden">` is what the form submission reads. Selected chips should not show duplicates — dedup when adding. On `Backspace` with empty text input and at least one selected tag, remove the last tag.

- [ ] **Step 1: Write failing tests first**

Create `tests/components/tag-input.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "@/components/forms/tag-input";

describe("TagInput", () => {
  it("renders selected tags as dismissible chips", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    expect(screen.getByText("true crime")).toBeInTheDocument();
    expect(screen.getByText("cold case")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /remove tag/i })).toHaveLength(2);
  });

  it("calls onChange without the tag when × is clicked", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove tag true crime" }));
    expect(onChange).toHaveBeenCalledWith(["cold case"]);
  });

  it("adds a tag on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "forensics{Enter}");
    expect(onChange).toHaveBeenCalledWith(["forensics"]);
  });

  it("adds a tag on comma and clears the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "forensics,");
    expect(onChange).toHaveBeenCalledWith(["forensics"]);
  });

  it("trims and lowercases typed tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={onChange} />
    );
    await user.type(screen.getByRole("textbox"), "  TRUE CRIME  {Enter}");
    expect(onChange).toHaveBeenCalledWith(["true crime"]);
  });

  it("does not add duplicate tags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    await user.type(screen.getByRole("textbox"), "true crime{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes last tag on Backspace when input is empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["true crime"]);
  });

  it("renders suggested tags as click-to-add buttons", () => {
    render(
      <TagInput
        selectedTags={[]}
        suggestedTags={["forensics", "serial killer"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "+ forensics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ serial killer" })).toBeInTheDocument();
  });

  it("moves a suggested tag into selected when clicked", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={["forensics"]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ forensics" }));
    expect(onChange).toHaveBeenCalledWith(["true crime", "forensics"]);
  });

  it("hides a suggested tag if it is already selected", () => {
    render(
      <TagInput
        selectedTags={["forensics"]}
        suggestedTags={["forensics", "cold case"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "+ forensics" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ cold case" })).toBeInTheDocument();
  });

  it("hidden input contains comma-joined selected tags", () => {
    const { container } = render(
      <TagInput
        selectedTags={["true crime", "cold case"]}
        suggestedTags={[]}
        onChange={vi.fn()}
        name="tags"
      />
    );
    const hidden = container.querySelector('input[type="hidden"][name="tags"]') as HTMLInputElement;
    expect(hidden.value).toBe("true crime,cold case");
  });

  it("does not render suggestions section when suggestedTags is empty", () => {
    render(
      <TagInput selectedTags={[]} suggestedTags={[]} onChange={vi.fn()} />
    );
    expect(screen.queryByText("Suggestions:")).not.toBeInTheDocument();
  });

  it("input and dismiss buttons are disabled when disabled prop is true", () => {
    render(
      <TagInput
        selectedTags={["true crime"]}
        suggestedTags={["forensics"]}
        onChange={vi.fn()}
        disabled
      />
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove tag true crime" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ forensics" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
npm test -- tests/components/tag-input.test.tsx
```

Expected: All tests fail with "Cannot find module '@/components/forms/tag-input'".

- [ ] **Step 3: Check if `@testing-library/user-event` is installed**

```bash
cat package.json | grep user-event
```

If not present, install it:
```bash
npm install --save-dev @testing-library/user-event
```

- [ ] **Step 4: Create `src/components/forms/tag-input.tsx`**

```typescript
"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { XIcon } from "lucide-react";

interface TagInputProps {
  selectedTags: string[];
  suggestedTags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
}

export function TagInput({
  selectedTags,
  suggestedTags,
  onChange,
  disabled,
  placeholder = "Add a tag...",
  name = "tags",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || selectedTags.includes(tag)) return;
    onChange([...selectedTags, tag]);
  }

  function removeTag(tag: string) {
    onChange(selectedTags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
      setInputValue("");
    } else if (
      e.key === "Backspace" &&
      inputValue === "" &&
      selectedTags.length > 0
    ) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  }

  const visibleSuggestions = suggestedTags.filter(
    (t) => !selectedTags.includes(t)
  );

  return (
    <div className="space-y-2">
      {/* Selected chips + inline input */}
      <div
        className="flex min-h-10 flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        onClick={() => inputRef.current?.focus()}
      >
        {selectedTags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="rounded-sm opacity-60 hover:opacity-100 disabled:cursor-not-allowed"
              aria-label={`Remove tag ${tag}`}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          role="textbox"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) {
              addTag(inputValue);
              setInputValue("");
            }
          }}
          disabled={disabled}
          placeholder={selectedTags.length === 0 ? placeholder : ""}
          className="min-w-20 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {/* Suggested chips */}
      {visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {visibleSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => onChange([...selectedTags, tag])}
              className="rounded-md border border-input px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`+ ${tag}`}
            >
              + {tag}
            </button>
          ))}
        </div>
      )}

      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={selectedTags.join(",")} />
    </div>
  );
}
```

- [ ] **Step 5: Run tests and confirm all pass**

```bash
npm test -- tests/components/tag-input.test.tsx
```

Expected: All 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/forms/tag-input.tsx tests/components/tag-input.test.tsx
git commit -m "feat: add TagInput chip component with tests"
```

---

### Task 4: Compute `frequentTags` in `page.tsx`

**Files:**
- Modify: `src/app/dashboard/distribute/new/page.tsx`

**Context:** `page.tsx` is a server component. `showIds` is already computed as `string[]` (line 28). The `DistributionJob.metadata` field is `Json` in Prisma — cast it to `Record<string, unknown>`. Filter out jobs with status `"uploading"` to avoid counting in-progress jobs. Top 12 per show, sorted by frequency descending.

**Note:** `showIds` contains string IDs (e.g. `"123"`), but `wpShowId` in the DB is an `Int`. The query needs `{ in: showIds.map(Number) }`. The resulting `frequentTagsMap` keys are strings matching the format used by `distribution-form.tsx`'s `showId` state.

- [ ] **Step 1: Add the `frequentTags` query after the `footerMap` computation**

In `src/app/dashboard/distribute/new/page.tsx`, after the `footerMap` block (after the closing `}` around line 38), add:

```typescript
// Compute top-12 frequent tags per show from past distribution jobs
const pastJobs = await db.distributionJob.findMany({
  where: {
    wpShowId: { in: showIds.map(Number) },
    status: { not: "uploading" },
  },
  select: { wpShowId: true, metadata: true },
});

const frequentTagsMap: Record<string, string[]> = {};
for (const showId of showIds) {
  const tagCounts: Record<string, number> = {};
  for (const job of pastJobs) {
    if (String(job.wpShowId) !== showId) continue;
    const meta = job.metadata as Record<string, unknown>;
    const tags = meta.tags;
    if (!Array.isArray(tags)) continue;
    for (const tag of tags as string[]) {
      if (typeof tag === "string" && tag.trim()) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
  }
  frequentTagsMap[showId] = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag);
}
```

- [ ] **Step 2: Pass `frequentTags` to `DistributionForm`**

Update the JSX return (around line 46) to pass the new prop:

```tsx
return (
  <div className="py-6">
    <DistributionForm
      shows={shows}
      descriptionFooters={footerMap}
      frequentTags={frequentTagsMap}
    />
  </div>
);
```

- [ ] **Step 3: Run build to catch type errors early**

```bash
npm run build 2>&1 | head -50
```

Expected: Build will error because `DistributionForm` doesn't accept `frequentTags` yet. That's the expected state before Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/distribute/new/page.tsx
git commit -m "feat: compute per-show frequent tags from past jobs in distribution page"
```

---

### Task 5: Wire `TagInput` into `distribution-form.tsx`

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx`

**Context:** This is a large client component. Key locations:
- Line 56–61: `AiSuggestion` interface — needs `"keywords"` in the `type` union
- Line 75–81: component props — add `frequentTags`
- Line 88: `const [showId, setShowId]` — intercept changes
- Lines 109–116: existing AI analysis state — add `tags` and `suggestedTags`
- Line 252: `startAiAnalysis` — parse keywords suggestion after AI returns
- Lines 346–358: `startAiAnalysis` `useCallback` deps — add `tags`, `frequentTags`
- Line 575: `ShowSelect` `onValueChange` — reset tags on show change
- Lines 610–614: video change reset block — reset tags here too
- Lines 829–839: the plain `<Input>` tags field to replace with `<TagInput>`

Changes must also:
1. Remove the `import { Input }` from the import (only if `Input` has no other usages — it does, at line 641 for episode title and season/episode fields, so keep that import)
2. Import `TagInput`

- [ ] **Step 1: Update the `AiSuggestion` interface (line 56)**

```typescript
interface AiSuggestion {
  id: string;
  type: "chapters" | "summary" | "blog" | "keywords";
  content: string;
  accepted: boolean;
}
```

- [ ] **Step 2: Add `frequentTags` to the component props (line 75)**

```typescript
export function DistributionForm({
  shows,
  descriptionFooters = {},
  frequentTags = {},
}: {
  shows: Show[];
  descriptionFooters?: Record<string, string>;
  frequentTags?: Record<string, string[]>;
}) {
```

- [ ] **Step 3: Add `tags` and `suggestedTags` state after the existing AI analysis state**

After line 116 (`const [analysisError, setAnalysisError] = useState...`), add:

```typescript
// Tag chip state
const [tags, setTags] = useState<string[]>([]);
const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
```

- [ ] **Step 4: Intercept `ShowSelect`'s `onValueChange` to reset tags**

Find the `ShowSelect` usage (around line 575):
```typescript
<ShowSelect
  allowedShows={shows}
  value={showId}
  onValueChange={setShowId}
/>
```

Replace with:
```typescript
<ShowSelect
  allowedShows={shows}
  value={showId}
  onValueChange={(newShowId) => {
    setShowId(newShowId);
    setTags(frequentTags[newShowId] ?? []);
    setSuggestedTags([]);
  }}
/>
```

- [ ] **Step 5: Reset tags in the video file change handler**

Find the video `onChange` handler (around line 604–614):
```typescript
onChange={(e) => {
  const file = e.target.files?.[0] ?? null;
  videoFileRef.current = file;
  setVideoFileName(file?.name ?? null);
  setVideoFileSize(file?.size ?? 0);
  setVideoContentType(file?.type ?? "");
  // Reset mode if video changes
  setDescriptionMode(null);
  setSuggestions([]);
  setAiUploadedJobId(null);
}}
```

Add the tag resets:
```typescript
onChange={(e) => {
  const file = e.target.files?.[0] ?? null;
  videoFileRef.current = file;
  setVideoFileName(file?.name ?? null);
  setVideoFileSize(file?.size ?? 0);
  setVideoContentType(file?.type ?? "");
  // Reset mode if video changes
  setDescriptionMode(null);
  setSuggestions([]);
  setAiUploadedJobId(null);
  setTags(frequentTags[showId] ?? []);
  setSuggestedTags([]);
}}
```

- [ ] **Step 6: Parse keywords suggestion in `startAiAnalysis`**

Find the section after `setChapters(...)` in `startAiAnalysis` (around line 331–337), before `setAnalysisStep("")`:

```typescript
      const chaptersSuggestion = aiSuggestions.find(
        (s) => s.type === "chapters"
      );
      if (chaptersSuggestion) {
        setChapters(chaptersSuggestion.content);
      }

      setAnalysisStep("");
```

Insert keyword parsing between the chapters block and `setAnalysisStep("")`:

```typescript
      // Parse AI keywords and merge with any un-selected frequent tags
      const keywordsSuggestion = aiSuggestions.find((s) => s.type === "keywords");
      if (keywordsSuggestion) {
        const aiKeywords = keywordsSuggestion.content
          .split("\n")
          .map((k) => k.trim())
          .filter(Boolean);
        const alreadySelected = new Set(tags);
        const aiNew = aiKeywords.filter((k) => !alreadySelected.has(k));
        const freqRemaining = (frequentTags[showId] ?? []).filter(
          (t) => !alreadySelected.has(t) && !aiNew.includes(t)
        );
        setSuggestedTags([...aiNew, ...freqRemaining]);
      }
```

- [ ] **Step 7: Add `tags` and `frequentTags` to `startAiAnalysis` dependency array**

Find the `useCallback` dependency array for `startAiAnalysis` (around line 346–358):

```typescript
  }, [
    showId,
    title,
    videoFileName,
    videoFileSize,
    videoContentType,
    publishState.status,
    uploadVideoToGCS,
    uploadThumbnailToGCS,
    descriptionFooters,
  ]);
```

Update to:
```typescript
  }, [
    showId,
    title,
    videoFileName,
    videoFileSize,
    videoContentType,
    publishState.status,
    uploadVideoToGCS,
    uploadThumbnailToGCS,
    descriptionFooters,
    tags,
    frequentTags,
  ]);
```

- [ ] **Step 8: Import `TagInput` at the top of the file**

Add after the existing form component imports (e.g., after the `PublishToggle` import around line 21):

```typescript
import { TagInput } from "@/components/forms/tag-input";
```

- [ ] **Step 9: Replace the plain `<Input>` tags field with `<TagInput>`**

Find the current tags block (around lines 829–839):
```typescript
          {/* Tags */}
          {descriptionMode && (
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                name="tags"
                placeholder="true crime, cold case, investigation (comma-separated)"
                disabled={isDisabled}
              />
            </div>
          )}
```

Replace with:
```typescript
          {/* Tags */}
          {descriptionMode && (
            <div className="space-y-2">
              <Label>Tags</Label>
              <TagInput
                selectedTags={tags}
                suggestedTags={suggestedTags}
                onChange={setTags}
                disabled={isDisabled}
                placeholder="true crime, cold case, investigation..."
              />
            </div>
          )}
```

Note: The `Label` no longer needs `htmlFor` because `TagInput` renders its own internal `<input role="textbox">`. Remove `htmlFor="tags"` to avoid a lint warning. The hidden `<input name="tags">` is rendered by `TagInput` and serves the same form submission role.

- [ ] **Step 10: Run build to verify no type errors**

```bash
npm run build 2>&1 | head -60
```

Expected: Clean build (or only pre-existing unrelated warnings).

- [ ] **Step 11: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "feat: integrate TagInput with frequentTags and AI keyword suggestions"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Task |
|-----------------|------|
| `"keywords"` as new `AiSuggestionType` | Task 1 |
| Prompt generates 8–12 SEO tags, newline-separated | Task 1 |
| Keywords generated alongside chapters/summary in `generateAiSuggestions` | Task 1 |
| Selected tags as dismissible chips (×) | Task 3 |
| Suggested tags as outlined click-to-add chips | Task 3 |
| Inline free-text input (Enter/comma to add) | Task 3 |
| Hidden input for form submission | Task 3 |
| `frequentTags: Record<string, string[]>` computed from past jobs (top 12) | Task 4 |
| `frequentTags` passed to `DistributionForm` | Task 4 |
| On show change: reset `tags` to `frequentTags[showId]`, clear `suggestedTags` | Task 5 |
| Manual path: `TagInput` with `suggestedTags=[]`, pre-selected frequent tags | Task 5 |
| AI path: parse keywords, `setSuggestedTags(aiKeywords + remaining freqTags)` | Task 5 |
| On video change: same tag reset as show change | Task 5 |
| `TagInput` replaces plain `Input` in same position (gated on `descriptionMode`) | Task 5 |
| No schema change | ✓ (metadata.tags unchanged) |
| `actions.ts` parsing unchanged | ✓ (hidden input still provides comma-separated string) |

### Placeholder Scan

No TBDs, TODOs, or "similar to Task N" references found.

### Type Consistency Check

- `AiSuggestionType` extended to include `"keywords"` in both `ai-processor.ts` (Task 1) and `distribution-form.tsx`'s local `AiSuggestion` interface (Task 5).
- `frequentTags: Record<string, string[]>` — defined in `page.tsx` (Task 4) and consumed as a prop in `distribution-form.tsx` (Task 5). Keys are string show IDs in both places.
- `TagInput` props `selectedTags: string[]` and `onChange: (tags: string[]) => void` match usage in `distribution-form.tsx` (`tags` state and `setTags`).
- Hidden input `name="tags"` in `TagInput` matches what `actions.ts` reads via `formData.get("tags")`.
