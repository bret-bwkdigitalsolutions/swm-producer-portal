import { describe, expect, it } from "vitest";
import { sanitizeYouTubeTags } from "@/lib/platforms/youtube-tags";

/** YouTube's tags-field length: commas count, and spaced tags count as quoted. */
function fieldLength(tags: string[]): number {
  return tags.reduce((sum, tag, index) => {
    const quoted = /\s/.test(tag) ? tag.length + 2 : tag.length;
    return sum + quoted + (index > 0 ? 1 : 0);
  }, 0);
}

describe("sanitizeYouTubeTags", () => {
  it("strips apostrophes and other rejected characters", () => {
    expect(
      sanitizeYouTubeTags([
        "beer thirty sports o'clock",
        "dudley's sports grill",
        'say "hello"',
        "foo<bar>",
        "keep-this_one.mp3",
      ])
    ).toEqual([
      "beer thirty sports oclock",
      "dudleys sports grill",
      "say hello",
      "foobar",
      "keep-this_one.mp3",
    ]);
  });

  it("strips unicode curly quotes", () => {
    expect(
      sanitizeYouTubeTags([
        "dudley\u2019s sports grill",
        "\u201CHalf Marathons\u201D",
        "o\u2018clock",
      ])
    ).toEqual(["dudleys sports grill", "Half Marathons", "oclock"]);
  });

  it("trims, drops empties, and dedupes case-insensitively", () => {
    expect(
      sanitizeYouTubeTags([
        "  Beer Thirty  ",
        "beer thirty",
        "",
        "   ",
        "'",
        "<>",
        "...",
        "---",
      ])
    ).toEqual(["Beer Thirty"]);
  });

  it("caps each tag at 30 characters", () => {
    const long = "abcdefghijklmnopqrstuvwxyz0123456789";
    const [tag] = sanitizeYouTubeTags([long]);
    expect(tag).toHaveLength(30);
    expect(tag).toBe(long.slice(0, 30));
  });

  it("drops tags from the end once the 500-character field is full", () => {
    const tags = Array.from({ length: 40 }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      return `keyword ${suffix} xxxxxxxx`;
    });
    const sanitized = sanitizeYouTubeTags(tags);

    expect(sanitized.length).toBeGreaterThan(0);
    expect(sanitized.length).toBeLessThan(tags.length);
    expect(fieldLength(sanitized)).toBeLessThanOrEqual(500);
    expect(sanitized.every((tag) => tag.length <= 30)).toBe(true);

    const oneMore = [...sanitized, tags[sanitized.length]];
    expect(fieldLength(oneMore)).toBeGreaterThan(500);
  });

  it("returns an empty list for missing input", () => {
    expect(sanitizeYouTubeTags(null)).toEqual([]);
    expect(sanitizeYouTubeTags(undefined)).toEqual([]);
  });
});
