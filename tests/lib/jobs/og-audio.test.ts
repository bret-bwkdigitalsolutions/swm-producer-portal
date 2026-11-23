import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockToken = vi.fn();
const mockExists = vi.fn();
const mockExtract = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/analytics/credentials", () => ({
  getVimeoAccessToken: (...args: unknown[]) => mockToken(...args),
}));

vi.mock("@/lib/gcs", () => ({
  gcsObjectExists: (...args: unknown[]) => mockExists(...args),
}));

vi.mock("@/lib/jobs/audio-extractor", () => ({
  extractAudio: (...args: unknown[]) => mockExtract(...args),
  derivedGcsAudioPath: (gcsVideoPath: string) => gcsVideoPath.replace(/\.[^.]+$/, ".mp3"),
}));

import { ensureOgTransistorAudio } from "@/lib/jobs/og-audio";
import { OG_VIMEO_TOKEN_MISSING } from "@/lib/og-episode";

const TOKEN = "vimeo-test-token-do-not-log";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fileResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "video/mp4" },
  });
}

describe("ensureOgTransistorAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockResolvedValue(true);
    mockExtract.mockResolvedValue("uploads/2026/11/extracted.mp3");
    mockToken.mockResolvedValue(TOKEN);
  });

  afterEach(() => {
    delete process.env.GCS_BUCKET_NAME;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses audio already extracted from the uploaded file", async () => {
    const audio = await ensureOgTransistorAudio({
      jobId: "job-1",
      wpShowId: 21,
      gcsVideoPath: "uploads/2026/11/cut.mp4",
      videoBucket: null,
      metadata: { gcsAudioPath: "uploads/2026/11/cut.mp3" },
      vimeoVideoId: "555",
      vimeoHash: "abc",
    });

    expect(audio).toEqual({
      gcsAudioPath: "uploads/2026/11/cut.mp3",
      source: "stored",
    });
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("extracts an uploaded file without calling Vimeo", async () => {
    mockExists.mockResolvedValue(false);
    const audio = await ensureOgTransistorAudio({
      jobId: "job-1",
      wpShowId: 21,
      gcsVideoPath: "uploads/2026/11/cut.mp4",
      videoBucket: "regional-bucket",
      metadata: {},
      vimeoVideoId: "555",
      vimeoHash: "abc",
    });

    expect(audio.source).toBe("upload");
    expect(mockExtract).toHaveBeenCalledWith("uploads/2026/11/cut.mp4", {
      bucket: "regional-bucket",
    });
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("downloads a Vimeo file without sending the token to the file host", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.vimeo.com/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
        return jsonResponse({
          download: [
            {
              link: "https://player.vimeo.com/progressive_redirect/playback/555/file.mp4",
              quality: "sd",
              type: "video/mp4",
              size: 1200,
              height: 360,
            },
          ],
        });
      }
      expect(url).toBe("https://player.vimeo.com/progressive_redirect/playback/555/file.mp4");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      return fileResponse();
    });
    process.env.GCS_BUCKET_NAME = "test-bucket";
    vi.stubGlobal("fetch", fetchMock);
    const logs: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args);
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args);
    });

    const audio = await ensureOgTransistorAudio({
      jobId: "job-1",
      wpShowId: 21,
      gcsVideoPath: null,
      videoBucket: null,
      metadata: {},
      vimeoVideoId: "555",
      vimeoHash: "abc123",
    });

    expect(audio.source).toBe("vimeo");
    expect(audio.gcsAudioPath).toBe("uploads/2026/11/extracted.mp3");
    expect(mockExtract).toHaveBeenCalledWith(
      expect.stringMatching(/uploads\/\d{4}\/\d{2}\/\d+-og-vimeo-555\.mp4$/),
      expect.objectContaining({ localVideoPath: expect.stringContaining("video.mp4") })
    );
    expect(mockToken).toHaveBeenCalledWith(21);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("player.vimeo.com");
    expect(logged).not.toContain("abc123");
  });

  it("fails closed when the token is missing and does not call Vimeo", async () => {
    mockToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureOgTransistorAudio({
        jobId: "job-1",
        wpShowId: 21,
        gcsVideoPath: null,
        videoBucket: null,
        metadata: {},
        vimeoVideoId: "555",
        vimeoHash: null,
      })
    ).rejects.toThrow(OG_VIMEO_TOKEN_MISSING);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
