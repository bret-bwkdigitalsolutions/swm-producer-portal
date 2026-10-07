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

  it("sends integer seconds from 0 to 86400, a short cue, and plain quote text", () => {
    const payload = buildLiveMarksPayload({
      wpShowId: 21,
      youtubeVideoId: "abcdefghijk",
      marks: [
        {
          seconds: 32.9,
          quote: "  <b>Nobody&nbsp;looked</b> there.  ",
          cue: "mark that",
        },
        {
          seconds: 90000,
          quote: "x".repeat(300),
          cue: "m".repeat(50),
        },
        { seconds: -4, quote: "Start.", cue: "   " },
      ],
    });

    expect(payload.marks[0]).toEqual({ seconds: 0, quote: "Start.", cue: "" });
    expect(payload.marks[1]).toEqual({
      seconds: 32,
      quote: "Nobody looked there.",
      cue: "mark that",
    });
    expect(payload.marks[2].seconds).toBe(86400);
    expect(payload.marks[2].quote.length).toBeLessThanOrEqual(280);
    expect(payload.marks[2].cue.length).toBeLessThanOrEqual(40);
  });

  it("sends at most the earliest 50 marks", () => {
    const marks = Array.from({ length: 60 }, (_, index) => ({
      seconds: 1000 - index,
      quote: `q${index}`,
      cue: "mark that",
    }));
    const payload = buildLiveMarksPayload({
      wpShowId: 21,
      youtubeVideoId: "abcdefghijk",
      marks,
    });
    expect(payload.marks).toHaveLength(50);
    expect(payload.marks[0].seconds).toBe(941);
    expect(payload.marks[49].seconds).toBe(990);
    expect(payload.marks.every((mark) => typeof mark.cue === "string")).toBe(true);
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
