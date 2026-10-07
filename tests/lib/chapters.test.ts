import { describe, expect, it } from "vitest";
import {
  chaptersToHtml,
  parseChapters,
  renderChaptersForWordPress,
  SWM_CHAPTERS_META_KEY,
} from "@/lib/chapters";

const SAMPLE = [
  "00:05:30 - How Jesse Hawila lost 130 lbs",
  "One meal a day, high protein.",
  "",
  "00:18:00 - Pete Delkus on the forecast",
  "The weekend outlook.",
].join("\n");

describe("parseChapters", () => {
  it("parses name, start, end, id, and seek link", () => {
    const chapters = parseChapters(SAMPLE, 3600);

    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      name: "How Jesse Hawila lost 130 lbs",
      start: 330,
      end: 1080,
      description: "One meal a day, high protein.",
      id: "how-jesse-hawila-lost-130-lbs",
      seek: "?t=330",
    });
    expect(chapters[1]).toMatchObject({
      name: "Pete Delkus on the forecast",
      start: 1080,
      end: 3600,
      seek: "?t=1080",
      description: "The weekend outlook.",
    });
  });

  it("omits end when the next timestamp is not later and duration is unknown", () => {
    const chapters = parseChapters("5:30 - Intro\n4:00 - Earlier");
    expect(chapters[0].end).toBeUndefined();
    expect(chapters[1].end).toBeUndefined();
    expect(chapters[0].start).toBe(330);
  });

  it("returns nothing for blank or untimestamped text", () => {
    expect(parseChapters("")).toEqual([]);
    expect(parseChapters("just a paragraph about the game")).toEqual([]);
    expect(parseChapters(null)).toEqual([]);
  });

  it("disambiguates duplicate anchors", () => {
    const chapters = parseChapters("00:00:01 - Intro\n00:01:00 - Intro");
    expect(chapters.map((chapter) => chapter.id)).toEqual(["intro", "intro-2"]);
  });
});

describe("chapters HTML and WordPress payload", () => {
  it("renders H2s with id anchors and ?t= links", () => {
    const html = chaptersToHtml(parseChapters(SAMPLE, 3600));
    expect(html).toContain('class="swm-chapters"');
    expect(html).toContain(
      '<h2 id="how-jesse-hawila-lost-130-lbs"><a href="?t=330">How Jesse Hawila lost 130 lbs</a></h2>'
    );
    expect(html).toContain("<p>One meal a day, high protein.</p>");
  });

  it("escapes titles before they land in HTML", () => {
    const html = chaptersToHtml(parseChapters("00:00:01 - Tom & <Jerry>"));
    expect(html).toContain("Tom &amp; &lt;Jerry&gt;");
    expect(html).not.toContain("<Jerry>");
  });

  it("sends structured JSON for parseable chapters and keeps the legacy block otherwise", () => {
    const rendered = renderChaptersForWordPress(SAMPLE, 90 * 60);
    expect(rendered?.html).toContain("<h2 ");
    const payload = JSON.parse(rendered!.structuredJson!);
    expect(payload.version).toBe(1);
    expect(payload.chapters[0].name).toBe("How Jesse Hawila lost 130 lbs");
    expect(payload.chapters[0].start).toBe(330);
    expect(payload.chapters[0].end).toBe(1080);
    expect(payload.chapters[1].end).toBe(90 * 60);
    expect(SWM_CHAPTERS_META_KEY).toBe("_swm_chapters");

    const legacy = renderChaptersForWordPress("no timestamps here\nsecond line");
    expect(legacy?.structuredJson).toBeUndefined();
    expect(legacy?.html).toBe(
      "<h3>Chapters</h3>\nno timestamps here<br>second line"
    );
    expect(renderChaptersForWordPress("  ")).toBeNull();
    expect(renderChaptersForWordPress(undefined)).toBeNull();
  });
});
