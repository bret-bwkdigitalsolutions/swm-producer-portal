import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBSITE_NOT_READY_BACKOFF_MS } from "@/lib/live-marks/constants";
import {
  isTranscriptDue,
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
});
