import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const updateMany = vi.hoisted(() => vi.fn());
const postLiveMarks = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    liveRecording: { findUnique, updateMany },
  },
}));

vi.mock("@/lib/live-marks/website", () => ({ postLiveMarks }));
vi.mock("@/lib/gcs", () => ({ deleteFile: vi.fn() }));
vi.mock("@/lib/jobs/video-downloader", () => ({
  downloadVideoToGcs: vi.fn(),
}));
vi.mock("@/lib/transcription", () => ({
  formatTranscriptAsVtt: vi.fn(),
  transcribeAudio: vi.fn(),
}));

import { runLiveTranscription } from "@/lib/live-marks/worker";

const row = {
  id: "rec-1",
  state: "archived",
  wpShowId: 22,
  youtubeVideoId: "abcdefghijk",
  transcriptStatus: "processing",
  transcriptClaimToken: "token-1",
  transcriptVtt: "WEBVTT",
  transcriptUtterances: [{ start: 1, end: 2, text: "No cue in this line." }],
  transcriptAudioPath: null,
  transcriptAttempts: 1,
  transcriptNotReadySince: null,
  actualStartedAt: null,
  actualEndedAt: null,
};

beforeEach(() => {
  findUnique.mockReset();
  updateMany.mockReset();
  postLiveMarks.mockReset();
  findUnique.mockResolvedValue(row);
  updateMany.mockResolvedValue({ count: 1 });
  postLiveMarks.mockResolvedValue({
    ok: true,
    response: { stored: 0, posted_to: 12, live_post_id: 9 },
  });
});

describe("runLiveTranscription empty marks", () => {
  it("posts marks: [] on a cron retry while the admin re-scan flag is set", async () => {
    findUnique.mockResolvedValue({ ...row, liveScanAdminRescan: true });

    const result = await runLiveTranscription("rec-1", "token-1");

    expect(postLiveMarks).toHaveBeenCalledWith({
      wpShowId: 22,
      youtubeVideoId: "abcdefghijk",
      marks: [],
    });
    expect(result).toEqual({
      ok: true,
      message: "Sent an empty mark list so the website clears stale live marks.",
    });
    const cleared = updateMany.mock.calls.map((call) => call[0].data);
    expect(cleared.at(-1).liveScanAdminRescan).toBe(false);
  });

  it("keeps the admin re-scan flag when the empty post does not succeed", async () => {
    findUnique.mockResolvedValue({ ...row, liveScanAdminRescan: true });
    postLiveMarks.mockResolvedValue({ ok: false, kind: "website_not_ready" });

    await runLiveTranscription("rec-1", "token-1");

    expect(postLiveMarks).toHaveBeenCalledWith(
      expect.objectContaining({ marks: [] })
    );
    const writes = updateMany.mock.calls.map((call) => call[0].data);
    expect(writes.some((data) => data.liveScanAdminRescan === false)).toBe(false);
  });

  it("does not post when a cron scan finds no marks", async () => {
    const result = await runLiveTranscription("rec-1", "token-1");

    expect(postLiveMarks).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: "Scanned. No marks to send.",
    });
  });
});
