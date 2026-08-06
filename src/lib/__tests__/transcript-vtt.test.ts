import { describe, it, expect } from "vitest";
import { formatTranscriptAsVtt } from "../transcription";
import type { TranscriptSegment } from "../transcription";

const seg = (start: number, end: number, text: string): TranscriptSegment => ({
  start,
  end,
  text,
});

describe("formatTranscriptAsVtt", () => {
  it("emits a valid WEBVTT header and one cue per segment", () => {
    const vtt = formatTranscriptAsVtt([
      seg(0, 5.23, "Welcome to the show"),
      seg(5.23, 12, "Mark that"),
    ]);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:05.230\nWelcome to the show");
    expect(vtt).toContain("00:00:05.230 --> 00:00:12.000\nMark that");
    expect(vtt.endsWith("\n")).toBe(true);
  });

  it("formats hours and milliseconds correctly", () => {
    const vtt = formatTranscriptAsVtt([seg(3661.5, 3665, "later")]);
    expect(vtt).toContain("01:01:01.500 --> 01:01:05.000");
  });

  it("skips empty/whitespace segments", () => {
    const vtt = formatTranscriptAsVtt([
      seg(0, 2, "   "),
      seg(2, 4, "real text"),
    ]);
    expect(vtt).toContain("real text");
    // Only one cue → only one timing arrow.
    expect(vtt.match(/-->/g)?.length).toBe(1);
  });

  it("nudges the end when it is not greater than the start (VTT requires end>start)", () => {
    const vtt = formatTranscriptAsVtt([seg(10, 10, "zero length")]);
    expect(vtt).toContain("00:00:10.000 --> 00:00:12.000");
  });

  it("returns an empty string when there are no usable segments", () => {
    expect(formatTranscriptAsVtt([])).toBe("");
    expect(formatTranscriptAsVtt([seg(0, 1, "")])).toBe("");
  });
});
