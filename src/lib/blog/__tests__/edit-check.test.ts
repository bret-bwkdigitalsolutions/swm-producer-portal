import { describe, it, expect } from "vitest";
import { computeEditPercentage, getEditLabel } from "../edit-check";

describe("computeEditPercentage", () => {
  it("returns 0 for identical content", () => {
    const html = "<h2>Title</h2><p>Some paragraph text here.</p>";
    expect(computeEditPercentage(html, html)).toBe(0);
  });

  it("detects minor edits (typo fix)", () => {
    const original = "<h2>Title</h2><p>This is a great paragraph about music.</p>";
    const edited = "<h2>Title</h2><p>This is a great paragraph about jazz.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(10);
  });

  it("detects moderate edits (rewritten paragraph)", () => {
    const original =
      "<h2>Intro</h2><p>Dallas has a rich music history spanning decades of innovation.</p>" +
      "<h2>Details</h2><p>The city grew into a hub for indie rock and jazz fusion.</p>";
    const edited =
      "<h2>Intro</h2><p>Dallas has a rich music history spanning decades of innovation.</p>" +
      "<h2>Details</h2><p>Over time, Dallas became known for its thriving hip-hop and electronic scenes.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(10);
    expect(pct).toBeLessThanOrEqual(50);
  });

  it("detects heavy rewrite", () => {
    const original = "<p>Original content about topic A with many details and examples.</p>";
    const edited = "<p>Completely different text about a new subject entirely.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(30);
  });

  it("strips HTML tags so formatting-only changes return 0", () => {
    const original = "<p>Some text here</p>";
    const edited = "<p><strong>Some text here</strong></p>";
    expect(computeEditPercentage(original, edited)).toBe(0);
  });

  it("returns 100 when original is empty and edited has content", () => {
    expect(computeEditPercentage("", "<p>New content</p>")).toBe(100);
  });

  it("handles null original gracefully", () => {
    expect(computeEditPercentage(null, "<p>New content</p>")).toBe(100);
  });
});

describe("getEditLabel", () => {
  it("returns 'No changes' for 0%", () => {
    expect(getEditLabel(0)).toBe("No changes");
  });

  it("returns 'Minor edits' for 1-10%", () => {
    expect(getEditLabel(5)).toBe("Minor edits");
    expect(getEditLabel(10)).toBe("Minor edits");
  });

  it("returns 'Moderate edits' for 11-30%", () => {
    expect(getEditLabel(15)).toBe("Moderate edits");
    expect(getEditLabel(30)).toBe("Moderate edits");
  });

  it("returns 'Heavily rewritten' for 31%+", () => {
    expect(getEditLabel(31)).toBe("Heavily rewritten");
    expect(getEditLabel(85)).toBe("Heavily rewritten");
  });
});
