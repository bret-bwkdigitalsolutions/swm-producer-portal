import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  downloadVimeoFile,
  fetchVimeoFileCandidates,
  parseVimeoFileCandidates,
  pickVimeoAudioSource,
  VIMEO_DOWNLOAD_MAX_BYTES,
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
  it("keeps an allowlisted https file and drops everything else", () => {
    expect(
      parseVimeoFileCandidates({
        download: [
          { link: "http://player.vimeo.com/a.mp4", type: "video/mp4", size: 10 },
          { link: "https://evil.example/stolen.mp4", type: "video/mp4", size: 10 },
          { link: "https://player.vimeo.com/a.mp4", type: "video/mp4", size: 20 },
          {
            link: "https://vod-progressive.akamaized.net/huge.mp4",
            type: "video/mp4",
            size: VIMEO_DOWNLOAD_MAX_BYTES + 1,
          },
        ],
      }).map((item) => item.link)
    ).toEqual(["https://player.vimeo.com/a.mp4"]);
  });
});

describe("downloadVimeoFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refuses an off-allowlist host before fetching it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dir = await mkdtemp(join(tmpdir(), "swm-vimeo-block-"));
    try {
      await expect(
        downloadVimeoFile("https://evil.example/video.mp4", join(dir, "video.mp4"))
      ).rejects.toThrow(/not on an allowed host/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not follow a redirect to a non-Vimeo host", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.startsWith("https://player.vimeo.com/")).toBe(true);
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/secret.mp4" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const dir = await mkdtemp(join(tmpdir(), "swm-vimeo-redir-"));
    try {
      await expect(
        downloadVimeoFile(
          "https://player.vimeo.com/progressive_redirect/playback/1/file.mp4",
          join(dir, "video.mp4")
        )
      ).rejects.toThrow(/not on an allowed host/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("evil.example");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a file whose Content-Length is over 2 GiB", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(VIMEO_DOWNLOAD_MAX_BYTES + 1),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const dir = await mkdtemp(join(tmpdir(), "swm-vimeo-size-"));
    try {
      await expect(
        downloadVimeoFile("https://download-video.akamaized.net/file.mp4", join(dir, "video.mp4"))
      ).rejects.toThrow(/larger than 2 GiB/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
