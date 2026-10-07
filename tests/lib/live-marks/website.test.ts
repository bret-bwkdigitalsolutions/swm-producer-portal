import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEBSITE_NOT_READY_BACKOFF_MS,
  WEBSITE_NOT_READY_MAX_MS,
  WEBSITE_OVERLAP_BACKOFF_MS,
} from "@/lib/live-marks/constants";
import {
  isTranscriptDue,
  planConfigError,
  planContractError,
  planOverlapRetry,
  planWebsiteNotReady,
} from "@/lib/live-marks/retry";
import { postLiveMarks } from "@/lib/live-marks/website";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const payload = {
  wpShowId: 21,
  youtubeVideoId: "abcdefghijk",
  marks: [{ seconds: 32, quote: "A porch.", cue: "Mark that" }],
};

beforeEach(() => {
  mockFetch.mockReset();
  process.env.WP_API_URL = "https://example.com/wp-json/wp/v2";
  process.env.WP_APP_USER = "testuser";
  process.env.WP_APP_PASSWORD = "testpass";
});

describe("postLiveMarks 404", () => {
  it("treats a missing route as website_not_ready, not a thrown failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "rest_no_route",
    });

    const result = await postLiveMarks(payload);

    expect(result).toEqual({ ok: false, kind: "website_not_ready" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/wp-json/swm-chat/v1/portal/live-marks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization:
            "Basic " + Buffer.from("testuser:testpass").toString("base64"),
        }),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.source).toBe("live_transcript");
    expect(body.marks).toHaveLength(1);
  });
});

describe("postLiveMarks 401 and 403", () => {
  it.each([401, 403])(
    "treats HTTP %s as a non-retryable config error",
    async (status) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => "rest_forbidden",
      });

      const result = await postLiveMarks(payload);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("config");
      const plan = planConfigError(
        1,
        result.ok ? "" : result.message
      );
      expect(plan.transcriptStatus).toBe("config_error");
      expect(plan.transcriptNextAttemptAt).toBeNull();
      expect(
        isTranscriptDue(
          {
            transcriptStatus: plan.transcriptStatus,
            transcriptAttempts: plan.transcriptAttempts,
            transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
          },
          new Date("2026-10-07T18:00:00.000Z")
        )
      ).toBe(false);
    }
  );
});

describe("postLiveMarks 400 and 422", () => {
  it.each([400, 422])(
    "treats HTTP %s as a permanent contract error",
    async (status) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => "invalid marks",
      });

      const result = await postLiveMarks(payload);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("contract");
      const plan = planContractError(1, result.message);
      expect(plan.transcriptStatus).toBe("contract_error");
      expect(plan.transcriptNextAttemptAt).toBeNull();
      expect(
        isTranscriptDue(
          {
            transcriptStatus: plan.transcriptStatus,
            transcriptAttempts: plan.transcriptAttempts,
            transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
          },
          new Date("2026-10-07T18:00:00.000Z")
        )
      ).toBe(false);
    }
  );
});

describe("postLiveMarks 409", () => {
  it("retries an overlapping write soon, not as a contract error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => "locked",
    });

    const now = new Date("2026-10-07T18:00:00.000Z");
    const result = await postLiveMarks(payload);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("overlap");
    const plan = planOverlapRetry(now, 1, result.message);
    expect(plan.transcriptStatus).not.toBe("contract_error");
    expect(plan.transcriptStatus).toBe("pending");
    expect(plan.transcriptNextAttemptAt?.toISOString()).toBe(
      new Date(now.getTime() + WEBSITE_OVERLAP_BACKOFF_MS).toISOString()
    );
    expect(
      isTranscriptDue(
        {
          transcriptStatus: plan.transcriptStatus,
          transcriptAttempts: plan.transcriptAttempts,
          transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
        },
        now
      )
    ).toBe(false);
    expect(
      isTranscriptDue(
        {
          transcriptStatus: plan.transcriptStatus,
          transcriptAttempts: plan.transcriptAttempts,
          transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
        },
        new Date(now.getTime() + WEBSITE_OVERLAP_BACKOFF_MS)
      )
    ).toBe(true);
  });
});

describe("postLiveMarks 500", () => {
  it("keeps a server error retryable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "unavailable",
    });
    const result = await postLiveMarks(payload);
    expect(result).toMatchObject({ ok: false, kind: "retryable" });
  });
});

describe("planWebsiteNotReady", () => {
  it("schedules a retry without burning a failure attempt", () => {
    const now = new Date("2026-10-07T18:00:00.000Z");
    const plan = planWebsiteNotReady(now, 2);

    expect(plan.transcriptStatus).toBe("website_not_ready");
    expect(plan.transcriptStatus).not.toBe("failed");
    expect(plan.transcriptAttempts).toBe(2);
    expect(plan.transcriptScannedAt).toBeNull();
    expect(plan.transcriptNextAttemptAt?.toISOString()).toBe(
      new Date(now.getTime() + WEBSITE_NOT_READY_BACKOFF_MS).toISOString()
    );
    expect(
      isTranscriptDue(
        {
          transcriptStatus: plan.transcriptStatus,
          transcriptAttempts: plan.transcriptAttempts,
          transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
        },
        now
      )
    ).toBe(false);
    expect(
      isTranscriptDue(
        {
          transcriptStatus: plan.transcriptStatus,
          transcriptAttempts: plan.transcriptAttempts,
          transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
        },
        new Date(now.getTime() + WEBSITE_NOT_READY_BACKOFF_MS)
      )
    ).toBe(true);
  });

  it("stops retrying after 14 days so an admin can re-scan", () => {
    const since = new Date("2026-09-23T18:00:00.000Z");
    const now = new Date(since.getTime() + WEBSITE_NOT_READY_MAX_MS);
    const plan = planWebsiteNotReady(now, 2, since);

    expect(plan.transcriptStatus).toBe("failed");
    expect(plan.transcriptNextAttemptAt).toBeNull();
    expect(plan.transcriptError).toMatch(/14 days/);
    expect(
      isTranscriptDue(
        {
          transcriptStatus: plan.transcriptStatus,
          transcriptAttempts: plan.transcriptAttempts,
          transcriptNextAttemptAt: plan.transcriptNextAttemptAt,
        },
        now
      )
    ).toBe(false);
  });
});
