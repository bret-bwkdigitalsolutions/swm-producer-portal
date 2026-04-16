import { describe, it, expect } from "vitest";
import { parseBlogOutput } from "../parse-blog-output";

describe("parseBlogOutput", () => {
  it("parses a full structured response", () => {
    const raw = [
      "The History of the Dallas Music Scene",
      "EXCERPT: A quick look at how Dallas shaped indie rock.",
      "SEO: Dallas indie rock history from the 80s to today.",
      "KEYPHRASE: dallas music scene",
      "",
      "<h2>Intro</h2>",
      "<p>Dallas has long been...</p>",
    ].join("\n");

    const result = parseBlogOutput(raw);

    expect(result.title).toBe("The History of the Dallas Music Scene");
    expect(result.excerpt).toBe("A quick look at how Dallas shaped indie rock.");
    expect(result.seoDescription).toBe(
      "Dallas indie rock history from the 80s to today."
    );
    expect(result.seoKeyphrase).toBe("dallas music scene");
    expect(result.content).toContain("<h2>Intro</h2>");
    expect(result.content).toContain("<p>Dallas has long been");
  });

  it("strips a leading markdown header from the title", () => {
    const raw = [
      "# The Title",
      "EXCERPT: short",
      "SEO: short",
      "KEYPHRASE: kp",
      "",
      "<p>Body</p>",
    ].join("\n");

    expect(parseBlogOutput(raw).title).toBe("The Title");
  });

  it("truncates SEO description at 160 chars", () => {
    const longSeo = "x".repeat(300);
    const raw = [
      "Title",
      `SEO: ${longSeo}`,
      "<p>Body</p>",
    ].join("\n");

    expect(parseBlogOutput(raw).seoDescription.length).toBe(160);
  });

  it("handles missing prefix lines (HTML starts immediately after title)", () => {
    const raw = ["Title Only", "<p>Body starts here</p>"].join("\n");

    const result = parseBlogOutput(raw);
    expect(result.title).toBe("Title Only");
    expect(result.excerpt).toBe("");
    expect(result.seoDescription).toBe("");
    expect(result.seoKeyphrase).toBe("");
    expect(result.content).toContain("<p>Body starts here</p>");
  });

  it("returns empty content when input has only a title", () => {
    const result = parseBlogOutput("Just a Title");
    expect(result.title).toBe("Just a Title");
    expect(result.content).toBe("");
  });
});
