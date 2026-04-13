import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------

const mockMessagesCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: (...args: unknown[]) => mockMessagesCreate(...args),
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { generateAiSuggestions } from "@/lib/jobs/ai-processor";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_JOB = {
  id: "job-123",
  wpShowId: 42,
  title: "The Mystery of the Missing Cat",
  metadata: {
    description: "An in-depth look at a puzzling case.",
  },
};

function makeMockResponse(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateAiSuggestions", () => {
  const originalEnv = process.env;

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

  afterEach(() => {
    process.env = originalEnv;
  });

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

  it("uses title/description when no transcript is provided", async () => {
    await generateAiSuggestions("job-123");

    // Should still generate all 4 suggestion types
    expect(mockMessagesCreate).toHaveBeenCalledTimes(4);
    expect(mockSuggestionUpsert).toHaveBeenCalledTimes(3);
    expect(mockSuggestionCreate).toHaveBeenCalledTimes(1);

    // Verify prompts contain the title (not "Transcript:")
    for (const call of mockMessagesCreate.mock.calls) {
      const args = call as unknown[];
      const params = args[0] as { messages: { content: string }[] };
      const prompt = params.messages[0].content;
      expect(prompt).toContain("The Mystery of the Missing Cat");
      expect(prompt).not.toContain("Transcript:");
    }
  });

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

  it("skips generation gracefully when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Re-import to pick up the missing env — but since getClient() reads
    // process.env at call time, clearing it is sufficient.
    // We need a fresh module to reset the cached client.
    vi.resetModules();

    // Re-mock after resetModules
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
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: mockMessagesCreate };
      },
    }));

    const { generateAiSuggestions: freshGenerate } = await import(
      "@/lib/jobs/ai-processor"
    );

    await freshGenerate("job-123");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ANTHROPIC_API_KEY is not set")
    );
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockSuggestionUpsert).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles partial failures gracefully — creates suggestions for successful calls", async () => {
    // chapters succeeds, summary fails, keywords succeeds, blog succeeds
    mockMessagesCreate
      .mockResolvedValueOnce(makeMockResponse("Chapters content"))
      .mockRejectedValueOnce(new Error("Rate limit exceeded"))
      .mockResolvedValueOnce(makeMockResponse("Keywords content"))
      .mockResolvedValueOnce(makeMockResponse("Blog content"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateAiSuggestions("job-123", "Some transcript");

    // 2 upserts succeed (chapters and keywords), 1 fails (summary)
    expect(mockSuggestionUpsert).toHaveBeenCalledTimes(2);
    // blog create succeeds
    expect(mockSuggestionCreate).toHaveBeenCalledTimes(1);

    // Should have logged the error
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ai-processor] Failed:"),
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it("handles job not found", async () => {
    mockJobFindUnique.mockResolvedValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateAiSuggestions("nonexistent-job");

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockSuggestionUpsert).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found")
    );

    errorSpy.mockRestore();
  });
});
