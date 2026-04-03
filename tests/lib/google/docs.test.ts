import { describe, it, expect, vi } from "vitest";

// Mock server-only to avoid import error in test env
vi.mock("server-only", () => ({}));

import { parseHtmlToSections, sectionsToHtml } from "@/lib/google/docs";

describe("parseHtmlToSections", () => {
  it("parses paragraphs with plain text", () => {
    const html = "<p>Hello world</p>";
    const sections = parseHtmlToSections(html);
    expect(sections).toEqual([
      { type: "paragraph", runs: [{ text: "Hello world" }] },
    ]);
  });

  it("parses h2 and h3 headings", () => {
    const html = "<h2>Main Heading</h2><h3>Sub Heading</h3>";
    const sections = parseHtmlToSections(html);
    expect(sections).toEqual([
      { type: "heading", level: 2, runs: [{ text: "Main Heading" }] },
      { type: "heading", level: 3, runs: [{ text: "Sub Heading" }] },
    ]);
  });

  it("parses inline formatting: bold, italic, links", () => {
    const html =
      '<p>This is <strong>bold</strong> and <em>italic</em> and <a href="https://example.com">a link</a>.</p>';
    const sections = parseHtmlToSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].runs).toEqual([
      { text: "This is " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
      { text: " and " },
      { text: "a link", link: "https://example.com" },
      { text: "." },
    ]);
  });

  it("handles empty input", () => {
    expect(parseHtmlToSections("")).toEqual([]);
  });
});

describe("sectionsToHtml", () => {
  it("converts sections back to HTML", () => {
    const sections = [
      { type: "heading" as const, level: 2, runs: [{ text: "Title" }] },
      {
        type: "paragraph" as const,
        runs: [{ text: "Hello " }, { text: "world", bold: true }],
      },
    ];
    const html = sectionsToHtml(sections);
    expect(html).toBe("<h2>Title</h2>\n<p>Hello <strong>world</strong></p>");
  });

  it("renders links and italic", () => {
    const sections = [
      {
        type: "paragraph" as const,
        runs: [
          { text: "Visit " },
          { text: "here", link: "https://example.com" },
          { text: " for ", italic: true },
          { text: "more" },
        ],
      },
    ];
    const html = sectionsToHtml(sections);
    expect(html).toBe(
      '<p>Visit <a href="https://example.com">here</a> <em>for </em>more</p>'
    );
  });
});
