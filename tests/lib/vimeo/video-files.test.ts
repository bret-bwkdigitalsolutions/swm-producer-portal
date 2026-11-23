import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchVimeoFileCandidates,
  parseVimeoFileCandidates,
  pickVimeoAudioSource,
  type VimeoFileCandidate,
} from "@/lib/vimeo/video-files";

const TOKEN = "vimeo-test-token-do-not-log";

function file(partial: Partial<VimeoFileCandidate> & Pick<VimeoFileCandidate, "link">): VimeoFileCandidate {
  return {
    quality: null,
    type: "video/mp4",
    size: null,
    height: null,
    source: "download",
    ...partial,
  };
}

describe("pickVimeoAudioSource", () => {
  it("prefers the smallest owner download and skips HLS", () => {
    const picked = pickVimeoAudioSource([
      file({
        link: "https://cdn.example/hls.m3u8",
        quality: "hls",
        type: "application/vnd.apple.mpegurl",
        size: 100,
        source: "files",
      }),
      file({
        link: "https://cdn.example/source.mp4",
        quality: "source",
        type: "source",
        size: 9_000,
        source: "download",
      }),
      file({
        link: "https://cdn.example/sd.mp4",
        quality: "sd",
        type: "video/mp4",
        size: 400,
        height: 360,
        source: "download",
      }),
      file({
        link: "https://cdn.example/player-tiny.mp4",
        quality: "sd",
        type: "video/mp4",
        size: 50,
        source: "files",
      }),
    ]);
    expect(picked?.link).toBe("https://cdn.example/sd.mp4");
  });

  it("falls back to player files when download links are absent", () => {
    const picked = pickVimeoAudioSource([
      file({
        link: "https://cdn.example/hd.mp4",
        quality: "hd",
        size: 2000,
        source: "files",
      }),
      file({
        link: "https://cdn.example/sd.mp4",
        quality: "sd",
        size: 800,
        source: "files",
      }),
    ]);
    expect(picked?.link).toBe("https://cdn.example/sd.mp4");
  });
});

describe("parseVimeoFileCandidates", () => {
  it("ignores non-https links", () => {
    expect(
      parseVimeoFileCandidates({
        download: [{ link: "http://cdn.example/a.mp4", type: "video/mp4", size: 10 }],
        files: [{ link: "https://cdn.example/b.mp4", type: "video/mp4", quality: "sd", size: 20 }],
      }).map((item) => item.link)
    ).toEqual(["https://cdn.example/b.mp4"]);
  });
});

describe("fetchVimeoFileCandidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the token only to the Vimeo API and does not include it in errors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url.startsWith("https://api.vimeo.com/videos/555:abc123")).toBe(true);
      expect(url).not.toContain(TOKEN);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      return new Response("nope", { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const logs: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args);
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args);
    });

    await expect(
      fetchVimeoFileCandidates({ videoId: "555", hash: "abc123", token: TOKEN })
    ).rejects.toThrow("HTTP 403");

    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
