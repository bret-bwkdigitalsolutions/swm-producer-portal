import { describe, it, expect } from "vitest";
import { sanitizeImportedHtml } from "../sanitize-html";

describe("sanitizeImportedHtml", () => {
  describe("text content preservation", () => {
    it("does not change any text characters", () => {
      const html = `<p style="font-family: Calibri">Hello "world" — it's a test, isn't it?</p>`;
      const result = sanitizeImportedHtml(html);
      expect(result).toContain(
        `Hello "world" — it's a test, isn't it?`
      );
    });

    it("preserves special characters and accents", () => {
      const html = `<p>Jérémy Doku · Türkiye · ¡hola! · 2026</p>`;
      const result = sanitizeImportedHtml(html);
      expect(result).toContain("Jérémy Doku");
      expect(result).toContain("Türkiye");
      expect(result).toContain("¡hola!");
    });

    it("preserves text inside multiple tags", () => {
      const html = `<p>Word <strong>one</strong> and <em>two</em>.</p>`;
      const result = sanitizeImportedHtml(html);
      expect(result).toContain("Word");
      expect(result).toContain("one");
      expect(result).toContain("two");
    });
  });

  describe("allowlist", () => {
    it("preserves headings", () => {
      const result = sanitizeImportedHtml("<h2>Section</h2>");
      expect(result).toBe("<h2>Section</h2>");
    });

    it("preserves lists", () => {
      const result = sanitizeImportedHtml("<ul><li>a</li><li>b</li></ul>");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>a</li>");
    });

    it("preserves links with href", () => {
      const result = sanitizeImportedHtml(
        '<a href="https://example.com">link</a>'
      );
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("link");
    });

    it("preserves images with src and alt", () => {
      const result = sanitizeImportedHtml(
        '<img src="https://example.com/x.jpg" alt="An image" />'
      );
      expect(result).toContain('src="https://example.com/x.jpg"');
      expect(result).toContain('alt="An image"');
    });
  });

  describe("strips Word and Drive cruft", () => {
    it("strips inline styles", () => {
      const result = sanitizeImportedHtml(
        '<p style="font-family: Calibri; color: red">Text</p>'
      );
      expect(result).not.toContain("style=");
      expect(result).not.toContain("Calibri");
      expect(result).toContain("Text");
    });

    it("strips classes and ids", () => {
      const result = sanitizeImportedHtml(
        '<p class="Word-cruft" id="x">Text</p>'
      );
      expect(result).not.toContain("class=");
      expect(result).not.toContain("id=");
      expect(result).toContain("Text");
    });

    it("strips MS Office namespaced tags", () => {
      const result = sanitizeImportedHtml(
        "<p>Hello<o:p></o:p> world</p>"
      );
      expect(result).not.toContain("<o:p>");
      expect(result).toContain("Hello");
      expect(result).toContain("world");
    });
  });

  describe("strips dangerous content", () => {
    it("strips script tags", () => {
      const result = sanitizeImportedHtml(
        "<p>Safe text</p><script>alert(1)</script>"
      );
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("alert");
      expect(result).toContain("Safe text");
    });

    it("strips on* event attributes", () => {
      const result = sanitizeImportedHtml(
        '<a href="x" onclick="alert(1)">link</a>'
      );
      expect(result).not.toContain("onclick");
      expect(result).toContain("link");
    });

    it("strips javascript: URLs", () => {
      const result = sanitizeImportedHtml(
        '<a href="javascript:alert(1)">link</a>'
      );
      expect(result).not.toContain("javascript:");
      expect(result).toContain("link");
    });

    it("strips iframes", () => {
      const result = sanitizeImportedHtml(
        '<p>before</p><iframe src="x"></iframe><p>after</p>'
      );
      expect(result).not.toContain("<iframe>");
      expect(result).toContain("before");
      expect(result).toContain("after");
    });
  });

  describe("link safety", () => {
    it("adds rel=noopener to outbound links", () => {
      const result = sanitizeImportedHtml(
        '<a href="https://example.com">link</a>'
      );
      expect(result).toContain("noopener");
    });
  });
});
