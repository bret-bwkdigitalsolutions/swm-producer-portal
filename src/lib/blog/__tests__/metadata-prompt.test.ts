import { describe, it, expect } from "vitest";
import {
  buildMetadataPrompt,
  parseMetadataResponse,
} from "../metadata-prompt";

describe("buildMetadataPrompt", () => {
  it("includes the body content verbatim when short", () => {
    const body = "<p>Hello world</p>";
    const prompt = buildMetadataPrompt(body, "en");
    expect(prompt).toContain(body);
  });

  it("uses English language instruction for en", () => {
    const prompt = buildMetadataPrompt("<p>hi</p>", "en");
    expect(prompt).toContain("English");
  });

  it("uses Spanish language instruction for es", () => {
    const prompt = buildMetadataPrompt("<p>hola</p>", "es");
    expect(prompt).toContain("español");
  });

  it("trims long bodies but keeps head and tail", () => {
    // Total body ~30k chars; trimMiddle keeps first 6k and last 6k.
    // Place the marker at offset ~15k so it lands squarely in the dropped slice.
    const head = "HEAD_MARKER " + "x".repeat(10000);
    const middle = "y".repeat(2000) + " MIDDLE_MARKER " + "y".repeat(2000);
    const tail = "z".repeat(10000) + " TAIL_MARKER";
    const body = head + middle + tail;
    const prompt = buildMetadataPrompt(body, "en");
    expect(prompt).toContain("HEAD_MARKER");
    expect(prompt).toContain("TAIL_MARKER");
    expect(prompt).not.toContain("MIDDLE_MARKER");
    expect(prompt).toContain("middle of post trimmed");
  });

  it("requests the four expected fields", () => {
    const prompt = buildMetadataPrompt("<p>hi</p>", "en");
    expect(prompt).toContain("title");
    expect(prompt).toContain("excerpt");
    expect(prompt).toContain("seoDescription");
    expect(prompt).toContain("seoKeyphrase");
  });

  it("specifies the 160 char hard limit for SEO description", () => {
    const prompt = buildMetadataPrompt("<p>hi</p>", "en");
    expect(prompt).toContain("160");
  });
});

describe("parseMetadataResponse", () => {
  const validJson = JSON.stringify({
    title: "Test Title",
    excerpt: "An excerpt of about thirty words for the listing page.",
    seoDescription: "A short SEO description.",
    seoKeyphrase: "test keyphrase",
  });

  it("parses clean JSON", () => {
    const result = parseMetadataResponse(validJson);
    expect(result).toEqual({
      title: "Test Title",
      excerpt: "An excerpt of about thirty words for the listing page.",
      seoDescription: "A short SEO description.",
      seoKeyphrase: "test keyphrase",
    });
  });

  it("strips a leading markdown code fence", () => {
    const result = parseMetadataResponse("```json\n" + validJson + "\n```");
    expect(result?.title).toBe("Test Title");
  });

  it("strips a bare markdown fence without language tag", () => {
    const result = parseMetadataResponse("```\n" + validJson + "\n```");
    expect(result?.title).toBe("Test Title");
  });

  it("tolerates leading/trailing whitespace", () => {
    const result = parseMetadataResponse("   \n\n" + validJson + "\n  ");
    expect(result?.title).toBe("Test Title");
  });

  it("pulls JSON out of surrounding prose", () => {
    const result = parseMetadataResponse(
      "Here is the result:\n" + validJson + "\nHope that helps!"
    );
    expect(result?.title).toBe("Test Title");
  });

  it("trims whitespace from each field", () => {
    const padded = JSON.stringify({
      title: "  Title  ",
      excerpt: "  Excerpt  ",
      seoDescription: "  SEO  ",
      seoKeyphrase: "  Keyphrase  ",
    });
    const result = parseMetadataResponse(padded);
    expect(result?.title).toBe("Title");
    expect(result?.excerpt).toBe("Excerpt");
  });

  it("returns null for malformed JSON", () => {
    expect(parseMetadataResponse("not json at all")).toBeNull();
    expect(parseMetadataResponse("")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    const missing = JSON.stringify({
      title: "T",
      excerpt: "E",
      seoDescription: "S",
      // missing seoKeyphrase
    });
    expect(parseMetadataResponse(missing)).toBeNull();
  });

  it("returns null when a required field is an empty string", () => {
    const empty = JSON.stringify({
      title: "T",
      excerpt: "",
      seoDescription: "S",
      seoKeyphrase: "K",
    });
    expect(parseMetadataResponse(empty)).toBeNull();
  });

  it("returns null when a field is the wrong type", () => {
    const wrongType = JSON.stringify({
      title: 123,
      excerpt: "E",
      seoDescription: "S",
      seoKeyphrase: "K",
    });
    expect(parseMetadataResponse(wrongType)).toBeNull();
  });
});
