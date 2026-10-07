import { describe, it, expect } from "vitest";
import {
  extractYoutubeVideoId,
  isValidYoutubeUrl,
  youtubeWatchUrl,
} from "@/lib/youtube-url";

const ID = "dQw4w9WgXcQ";

describe("extractYoutubeVideoId", () => {
  it("parses /watch?v=", () => {
    expect(
      extractYoutubeVideoId(`https://www.youtube.com/watch?v=${ID}`)
    ).toBe(ID);
    expect(extractYoutubeVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("parses /live/", () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/live/${ID}`)).toBe(
      ID
    );
    expect(
      extractYoutubeVideoId(`https://www.youtube.com/live/${ID}?feature=share`)
    ).toBe(ID);
  });

  it("parses /shorts/ and /embed/", () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(
      ID
    );
    expect(extractYoutubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(
      ID
    );
  });

  it("parses youtu.be short links", () => {
    expect(extractYoutubeVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractYoutubeVideoId(`https://youtu.be/${ID}?t=42`)).toBe(ID);
  });

  it("accepts http as well as https", () => {
    expect(extractYoutubeVideoId(`http://www.youtube.com/watch?v=${ID}`)).toBe(
      ID
    );
    expect(extractYoutubeVideoId(`http://youtu.be/${ID}`)).toBe(ID);
  });

  it("rejects non-http schemes, including a javascript URL on a YouTube host", () => {
    expect(
      extractYoutubeVideoId(
        "javascript://youtube.com/%0Aalert(1)//?v=AAAAAAAAAAA"
      )
    ).toBeNull();
    expect(
      extractYoutubeVideoId(`javascript:https://www.youtube.com/watch?v=${ID}`)
    ).toBeNull();
  });

  it("rejects lookalike hostnames", () => {
    expect(
      extractYoutubeVideoId(`https://youtube.com.evil.example/watch?v=${ID}`)
    ).toBeNull();
    expect(
      extractYoutubeVideoId(`https://notyoutube.com/watch?v=${ID}`)
    ).toBeNull();
    expect(extractYoutubeVideoId(`https://evil-youtu.be/${ID}`)).toBeNull();
  });

  it("rejects malformed video IDs", () => {
    expect(
      extractYoutubeVideoId("https://www.youtube.com/watch?v=short")
    ).toBeNull();
    expect(
      extractYoutubeVideoId(
        "https://www.youtube.com/watch?v=../../../etc/passwd"
      )
    ).toBeNull();
    expect(extractYoutubeVideoId("https://youtu.be/")).toBeNull();
  });

  it("rejects non-video YouTube URLs and garbage input", () => {
    expect(
      extractYoutubeVideoId("https://www.youtube.com/playlist?list=abc")
    ).toBeNull();
    expect(extractYoutubeVideoId("not a url")).toBeNull();
    expect(extractYoutubeVideoId("")).toBeNull();
  });
});

describe("youtubeWatchUrl", () => {
  it("builds a canonical watch URL from a validated id", () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(youtubeWatchUrl("short")).toBeNull();
    expect(youtubeWatchUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("isValidYoutubeUrl", () => {
  it("mirrors extractYoutubeVideoId", () => {
    expect(isValidYoutubeUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isValidYoutubeUrl("https://example.com")).toBe(false);
  });
});
