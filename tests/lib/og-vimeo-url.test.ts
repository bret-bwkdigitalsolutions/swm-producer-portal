import { describe, expect, it } from "vitest";
import { parseOgVimeoUrl } from "@/lib/vimeo-url";

describe("parseOgVimeoUrl", () => {
  it("accepts a plain video, a privacy hash, and a player URL", () => {
    expect(parseOgVimeoUrl("https://vimeo.com/555")).toEqual({
      videoId: "555",
      hash: null,
      mediaUrl: "https://vimeo.com/555",
    });
    expect(parseOgVimeoUrl("https://www.vimeo.com/555/abc123")).toEqual({
      videoId: "555",
      hash: "abc123",
      mediaUrl: "https://vimeo.com/555/abc123",
    });
    expect(parseOgVimeoUrl("https://player.vimeo.com/video/555?h=abc123")).toEqual({
      videoId: "555",
      hash: "abc123",
      mediaUrl: "https://vimeo.com/555/abc123",
    });
  });

  it("rejects channel URLs and other hosts", () => {
    expect(parseOgVimeoUrl("https://vimeo.com/channels/staffpicks/555")).toBeNull();
    expect(parseOgVimeoUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBeNull();
    expect(parseOgVimeoUrl("not a url")).toBeNull();
  });
});
