import { describe, expect, it } from "vitest";
import { detectMarks, utteranceCue } from "@/lib/live-marks/matcher";

describe("utteranceCue", () => {
  it.each(["Mark that.", "Okay, mark it!", "mark this"])(
    "matches %j",
    (text) => {
      expect(utteranceCue(text)).toMatch(/^mark\s+(that|it|this)$/i);
    }
  );

  it.each([
    "Mark it down.",
    "they mark this with a bar graph",
    "Marky Mark that he went",
    "Mark said that",
  ])("rejects %j", (text) => {
    expect(utteranceCue(text)).toBeNull();
  });

  it("matches a cue sentence that is followed by another sentence", () => {
    expect(utteranceCue("Okay. Mark that. We'll come back.")).toBe("Mark that");
  });
});

describe("detectMarks", () => {
  it("seeks 10 seconds before the cue and quotes the previous utterances", () => {
    const marks = detectMarks([
      { start: 20, end: 28, text: "He buried it under the porch." },
      { start: 30, end: 40, text: "Nobody looked there for years." },
      { start: 42.2, end: 44, text: "Mark that." },
    ]);
    expect(marks).toEqual([
      {
        seconds: 32,
        quote: "He buried it under the porch. Nobody looked there for years.",
        cue: "Mark that",
      },
    ]);
  });

  it("clamps the seek to zero when the cue is near the start", () => {
    const marks = detectMarks([{ start: 5, end: 6, text: "mark this" }]);
    expect(marks[0].seconds).toBe(0);
    expect(marks[0].quote).toBe("");
  });

  it("keeps the quote at or under 280 characters, from the end", () => {
    const long = "word ".repeat(80).trim();
    const marks = detectMarks([
      { start: 0, end: 10, text: long },
      { start: 12, end: 20, text: long },
      { start: 40, end: 42, text: "Mark that." },
    ]);
    const joined = `${long} ${long}`;
    expect(marks[0].quote.length).toBeLessThanOrEqual(280);
    expect(marks[0].quote.length).toBeGreaterThan(200);
    expect(joined.endsWith(marks[0].quote)).toBe(true);
  });

  it("drops a second cue within 30 seconds and keeps one 31 seconds later", () => {
    const marks = detectMarks([
      { start: 100, end: 102, text: "Mark that." },
      { start: 120, end: 122, text: "Okay, mark it!" },
      { start: 151, end: 153, text: "mark this" },
    ]);
    expect(marks.map((mark) => mark.cue)).toEqual(["Mark that", "mark this"]);
    expect(marks.map((mark) => mark.seconds)).toEqual([90, 141]);
  });
});
