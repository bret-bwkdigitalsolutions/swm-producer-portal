import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/credentials", () => ({
  getYouTubeAccessToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("@/lib/platforms/bounded-upload", () => ({
  streamFilePut: vi.fn(),
  uploadFileInChunks: vi.fn().mockResolvedValue({
    body: JSON.stringify({ id: "abc123xyz01" }),
  }),
}));

import { uploadToYouTube } from "@/lib/platforms/youtube";

describe("uploadToYouTube tag sanitization", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "Location" ? "https://upload.example/session" : null,
        },
        text: async () => "",
      })
    );
  });

  it("sends sanitized tags on the resumable upload init call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yt-tags-"));
    const videoFilePath = join(dir, "video.mp4");
    writeFileSync(videoFilePath, "not-a-real-video");

    await uploadToYouTube({
      wpShowId: 22,
      title: "Beer 30",
      description: "Episode",
      tags: [
        "beer thirty sports o'clock",
        "dudley\u2019s sports grill",
        "",
        "beer thirty sports o'clock",
      ],
      privacy: "public",
      videoFilePath,
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0];
    expect(String(init[0])).toContain("uploadType=resumable");
    const body = JSON.parse(init[1].body as string) as {
      snippet: { tags: string[] };
    };
    expect(body.snippet.tags).toEqual([
      "beer thirty sports oclock",
      "dudleys sports grill",
    ]);
  });
});