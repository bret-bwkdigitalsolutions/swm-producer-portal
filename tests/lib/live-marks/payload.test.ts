import { describe, expect, it } from "vitest";
import {
  buildLiveMarksPayload,
  parseLiveMarksResponse,
  youtubeTimestampUrl,
} from "@/lib/live-marks/payload";

describe("buildLiveMarksPayload", () => {
  it("uses the website contract", () => {
    expect(
      buildLiveMarksPayload({
        wpShowId: 21,
        youtubeVideoId: "abcdefghijk",
        marks: [
          { seconds: 32, quote: "Nobody looked there.", cue: "Mark that" },
        ],
      })
    ).toEqual({
      show_id: 21,
      live_youtube_id: "abcdefghijk",
      marks: [{ seconds: 32, quote: "Nobody looked there.", cue: "Mark that" }],
      source: "live_transcript",
    });
  });

  it("keeps an empty marks array in the same shape", () => {
    const payload = buildLiveMarksPayload({
      wpShowId: 28,
      youtubeVideoId: "zzzzzzzzzzz",
      marks: [],
    });
    expect(payload.marks).toEqual([]);
    expect(Object.keys(payload).sort()).toEqual([
      "live_youtube_id",
      "marks",
      "show_id",
      "source",
    ]);
  });
});

describe("youtubeTimestampUrl", () => {
  it("links the live video at that second", () => {
    expect(youtubeTimestampUrl("abcdefghijk", 32)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=32s"
    );
  });
});

describe("parseLiveMarksResponse", () => {
  it("accepts the documented response", () => {
    expect(
      parseLiveMarksResponse({ stored: 2, posted_to: 4401, live_post_id: 4300 })
    ).toEqual({ stored: 2, posted_to: 4401, live_post_id: 4300 });
  });

  it("rejects a body that is missing the contract fields", () => {
    expect(parseLiveMarksResponse({ ok: true })).toBeNull();
  });
});
