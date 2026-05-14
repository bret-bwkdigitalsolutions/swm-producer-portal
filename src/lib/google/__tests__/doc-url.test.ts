import { describe, it, expect } from "vitest";
import { parseGoogleDocUrl } from "../doc-url";

const ID = "1zrlzytCHTuDKnh3NyLrUlklobnF90VTpcXLFJMYGUyI";

describe("parseGoogleDocUrl", () => {
  it("extracts ID from a /edit?usp=sharing URL", () => {
    expect(
      parseGoogleDocUrl(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`)
    ).toBe(ID);
  });

  it("extracts ID from a plain /edit URL", () => {
    expect(
      parseGoogleDocUrl(`https://docs.google.com/document/d/${ID}/edit`)
    ).toBe(ID);
  });

  it("extracts ID from a /view URL", () => {
    expect(
      parseGoogleDocUrl(`https://docs.google.com/document/d/${ID}/view`)
    ).toBe(ID);
  });

  it("extracts ID from a URL with no trailing path", () => {
    expect(parseGoogleDocUrl(`https://docs.google.com/document/d/${ID}`)).toBe(
      ID
    );
  });

  it("accepts a bare ID with sufficient length", () => {
    expect(parseGoogleDocUrl(ID)).toBe(ID);
  });

  it("strips surrounding whitespace", () => {
    expect(
      parseGoogleDocUrl(`  https://docs.google.com/document/d/${ID}/edit  `)
    ).toBe(ID);
  });

  it("rejects empty input", () => {
    expect(parseGoogleDocUrl("")).toBeNull();
    expect(parseGoogleDocUrl("   ")).toBeNull();
  });

  it("rejects URLs from other Google products", () => {
    expect(
      parseGoogleDocUrl("https://docs.google.com/spreadsheets/d/abc123/edit")
    ).toBeNull();
    expect(
      parseGoogleDocUrl("https://drive.google.com/file/d/abc123/view")
    ).toBeNull();
  });

  it("rejects short strings that aren't URLs", () => {
    expect(parseGoogleDocUrl("hello")).toBeNull();
    expect(parseGoogleDocUrl("shortid")).toBeNull();
  });

  it("rejects URLs without a document ID segment", () => {
    expect(parseGoogleDocUrl("https://docs.google.com/document/")).toBeNull();
    expect(
      parseGoogleDocUrl("https://stolenwatermedia.com/some-blog")
    ).toBeNull();
  });
});
