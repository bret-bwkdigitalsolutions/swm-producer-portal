import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    distributionJob: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    aiSuggestion: {
      create: (...args: unknown[]) => mockCreate(...args),
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

    mockFindUnique.mockResolvedValue(MOCK_JOB);
    mockMessagesCreate.mockResolvedValue(
      makeMockResponse("Mock AI response content")
    );
    mockCreate.mockResolvedValue({ id: "suggestion-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates three AI suggestions (chapters, summary, blog) for a valid job", async () => {
    await generateAiSuggestions("job-123", "This is a transcript about cats.");

    // Should have fetched the job
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "job-123" },
    });

    // Should have called Claude 3 times
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);

    // Should have created 3 AiSuggestion records
    expect(mockCreate).toHaveBeenCalledTimes(3);

    const types = mockCreate.mock.calls.map(
      (call: unknown[]) => (call[0] as { data: { type: string } }).data.type
    );
    expect(types).toContain("chapters");
    expect(types).toContain("summary");
    expect(types).toContain("blog");

    // All suggestions should default to accepted: false
    for (const call of mockCreate.mock.calls) {
      expect(
        (call as unknown[])[0] as { data: { accepted: boolean } }
      ).toMatchObject({
        data: expect.objectContaining({ accepted: false }),
      });
    }
  });

  it("uses title/description when no transcript is provided", async () => {
    await generateAiSuggestions("job-123");

    // Should still generate all 3 suggestion types
    expect(mockMessagesCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate).toHaveBeenCalledTimes(3);

    // Verify prompts contain the title (not "Transcript:")
    for (const call of mockMessagesCreate.mock.calls) {
      const args = call as unknown[];
      const params = args[0] as { messages: { content: string }[] };
      const prompt = params.messages[0].content;
      expect(prompt).toContain("The Mystery of the Missing Cat");
      expect(prompt).not.toContain("Transcript:");
    }
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
        distributionJob: { findUnique: mockFindUnique },
        aiSuggestion: { create: mockCreate },
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
    expect(mockCreate).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("handles partial failures gracefully — creates suggestions for successful calls", async () => {
    // First call succeeds, second fails, third succeeds
    mockMessagesCreate
      .mockResolvedValueOnce(makeMockResponse("Chapters content"))
      .mockRejectedValueOnce(new Error("Rate limit exceeded"))
      .mockResolvedValueOnce(makeMockResponse("Blog content"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateAiSuggestions("job-123", "Some transcript");

    // Two suggestions should have been created (the one that failed won't)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Should have logged the error
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate suggestion"),
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it("handles job not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateAiSuggestions("nonexistent-job");

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found")
    );

    errorSpy.mockRestore();
  });
});
