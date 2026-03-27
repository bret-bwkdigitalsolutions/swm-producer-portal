import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock server-only
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mock Resend
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { sendStakeholderNotification } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS = {
  showName: "True Crime Weekly",
  contentType: "episode",
  title: "Episode 42: The Cold Case",
  postUrl: "https://example.com/posts/42",
  submittedBy: "producer@example.com",
  stakeholderEmails: ["stakeholder@example.com", "editor@example.com"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendStakeholderNotification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RESEND_API_KEY: "re_test_123" };
    mockSend.mockResolvedValue({ id: "email-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sends an email with correct subject, recipients, and HTML body", async () => {
    await sendStakeholderNotification(DEFAULT_PARAMS);

    expect(mockSend).toHaveBeenCalledTimes(1);

    const callArgs = mockSend.mock.calls[0][0] as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };

    expect(callArgs.from).toContain("SWM Producer Portal");
    expect(callArgs.to).toEqual([
      "stakeholder@example.com",
      "editor@example.com",
    ]);
    expect(callArgs.subject).toBe(
      "New episode published — True Crime Weekly"
    );
    expect(callArgs.html).toContain("True Crime Weekly");
    expect(callArgs.html).toContain("Episode 42: The Cold Case");
    expect(callArgs.html).toContain("producer@example.com");
    expect(callArgs.html).toContain("https://example.com/posts/42");
  });

  it("returns early without sending when stakeholder list is empty", async () => {
    await sendStakeholderNotification({
      ...DEFAULT_PARAMS,
      stakeholderEmails: [],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("logs a warning and returns when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendStakeholderNotification(DEFAULT_PARAMS);

    expect(mockSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("RESEND_API_KEY is not set")
    );

    warnSpy.mockRestore();
  });

  it("catches and logs errors from the Resend API", async () => {
    mockSend.mockRejectedValue(new Error("Resend rate limit"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw
    await sendStakeholderNotification(DEFAULT_PARAMS);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send stakeholder email"),
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it("includes a View Post link in the email HTML", async () => {
    await sendStakeholderNotification(DEFAULT_PARAMS);

    const callArgs = mockSend.mock.calls[0][0] as { html: string };
    expect(callArgs.html).toContain('href="https://example.com/posts/42"');
    expect(callArgs.html).toContain("View Post");
  });
});
