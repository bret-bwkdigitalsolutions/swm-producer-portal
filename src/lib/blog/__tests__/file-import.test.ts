import { describe, it, expect } from "vitest";
import {
  parseFileToHtml,
  UnsupportedFileTypeError,
} from "../file-import";

describe("parseFileToHtml", () => {
  describe("markdown", () => {
    it("converts headings, paragraphs, and bold/italic", async () => {
      const md = `# Title

This is a **bold** and *italic* paragraph.

## Second header

Another paragraph.`;
      const result = await parseFileToHtml(Buffer.from(md), "post.md");
      expect(result.html).toContain("<h1>Title</h1>");
      expect(result.html).toContain("<strong>bold</strong>");
      expect(result.html).toContain("<em>italic</em>");
      expect(result.html).toContain("<h2>Second header</h2>");
    });

    it("converts lists", async () => {
      const md = `- one\n- two\n- three`;
      const result = await parseFileToHtml(Buffer.from(md), "list.md");
      expect(result.html).toContain("<ul>");
      expect(result.html).toContain("<li>one</li>");
    });

    it("preserves inline links", async () => {
      const md = `Visit [our site](https://example.com) for more.`;
      const result = await parseFileToHtml(Buffer.from(md), "post.md");
      expect(result.html).toContain('href="https://example.com"');
    });

    it("accepts .markdown extension", async () => {
      const result = await parseFileToHtml(
        Buffer.from("# Hi"),
        "post.markdown"
      );
      expect(result.html).toContain("<h1>Hi</h1>");
    });
  });

  describe("plain text", () => {
    it("wraps paragraphs separated by blank lines", async () => {
      const text = `First paragraph.\n\nSecond paragraph.\n\nThird.`;
      const result = await parseFileToHtml(Buffer.from(text), "post.txt");
      expect(result.html).toBe(
        "<p>First paragraph.</p>\n<p>Second paragraph.</p>\n<p>Third.</p>"
      );
    });

    it("escapes HTML in text content", async () => {
      const text = `Contains <script>alert(1)</script> and & ampersands.`;
      const result = await parseFileToHtml(Buffer.from(text), "post.txt");
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain("&lt;script&gt;");
      expect(result.html).toContain("&amp;");
    });

    it("ignores empty lines and surrounding whitespace", async () => {
      const text = `\n\n   First   \n\n\n\n   Second   \n\n`;
      const result = await parseFileToHtml(Buffer.from(text), "post.txt");
      expect(result.html).toBe("<p>First</p>\n<p>Second</p>");
    });

    it("returns null title for plain text", async () => {
      const result = await parseFileToHtml(
        Buffer.from("hello"),
        "post.txt"
      );
      expect(result.title).toBeNull();
    });
  });

  describe("unsupported types", () => {
    it("throws UnsupportedFileTypeError for .doc", async () => {
      await expect(
        parseFileToHtml(Buffer.from(""), "post.doc")
      ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
    });

    it("throws for unrecognized extension", async () => {
      await expect(
        parseFileToHtml(Buffer.from(""), "post.pages")
      ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
    });

    it("throws for missing extension", async () => {
      await expect(
        parseFileToHtml(Buffer.from(""), "post")
      ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
    });
  });
});
