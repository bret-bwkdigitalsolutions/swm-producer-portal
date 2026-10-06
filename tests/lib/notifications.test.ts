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

import {
  sendStakeholderNotification,
  sendVerificationFailureNotification,
  verificationAlertRecipients,
} from "@/lib/notifications";

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

describe("sendVerificationFailureNotification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RESEND_API_KEY: "re_test_123" };
    delete process.env.VERIFICATION_ALERT_TO;
    mockSend.mockResolvedValue({ id: "email-1" });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const params = {
    jobTitle: "Episode 12 <The Lake>",
    showName: "Your Dark Companion",
    issues: [
      { platform: "transistor_network", message: "Episode was NOT cross-posted", severity: "critical" as const },
      { platform: "website", field: "status", expected: "publish", actual: "trash", severity: "critical" as const },
    ],
    warnings: [
      { platform: "website", field: "thumbnail", expected: "featured image", actual: "none", severity: "warning" as const },
    ],
    jobUrl: "https://portal.example.com/dashboard/distribute/job-1",
  };

  it("uses a clear ❌ FAILED subject and lists critical issues before warnings", async () => {
    await sendVerificationFailureNotification(params);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const email = mockSend.mock.calls[0][0];
    expect(email.subject).toBe(
      "❌ FAILED: Episode 12 <The Lake> (Your Dark Companion) — distribution verification"
    );
    expect(email.to).toEqual(["bret@stolenwatermedia.com"]);
    const html: string = email.html;
    expect(html).toContain("Episode 12 &lt;The Lake&gt;");
    expect(html.indexOf("Needs action")).toBeLessThan(html.indexOf("Warnings"));
    expect(html).toContain("Episode was NOT cross-posted");
    expect(html).toContain("expected publish, got trash");
  });

  it("sends to VERIFICATION_ALERT_TO when set", async () => {
    process.env.VERIFICATION_ALERT_TO = "ops@example.com, bret@example.com";
    expect(verificationAlertRecipients()).toEqual(["ops@example.com", "bret@example.com"]);
    await sendVerificationFailureNotification(params);
    expect(mockSend.mock.calls[0][0].to).toEqual(["ops@example.com", "bret@example.com"]);
  });

  it("omits the warnings section when there are none", async () => {
    await sendVerificationFailureNotification({ ...params, warnings: [] });
    expect(mockSend.mock.calls[0][0].html).not.toContain("Warnings (cosmetic");
  });
});
