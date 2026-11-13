import { beforeEach, describe, expect, it, vi } from "vitest";

const readVimeoLiveEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/jobs/job-queue", () => ({
  enqueueJob: vi.fn(),
  enqueueSideJob: vi.fn(),
}));
vi.mock("@/lib/live-marks/vimeo-client", () => ({ readVimeoLiveEvent }));
vi.mock("@/lib/live-marks/vimeo-audio", () => ({
  captureHlsAudio: vi.fn(),
  probeHlsEdgeSeconds: vi.fn(),
}));
vi.mock("@/lib/transcription", () => ({ transcribeAudioBytes: vi.fn() }));
vi.mock("@/lib/live-marks/website", () => ({ postLiveMarksJson: vi.fn() }));

import { queueVimeoLiveMarks } from "@/lib/live-marks/vimeo-watch";

beforeEach(() => {
  readVimeoLiveEvent.mockReset();
  delete process.env.LIVE_TRANSCRIPTION_ENABLED;
  process.env.VIMEO_LIVE_EVENTS = "6344608:f86b2c8698:21";
});

describe("queueVimeoLiveMarks", () => {
  it("does not call Vimeo while LIVE_TRANSCRIPTION_ENABLED is off", async () => {
    const summary = await queueVimeoLiveMarks();
    expect(summary).toEqual({
      disabled: true,
      watching: [],
      archived: [],
      idle: [],
    });
    expect(readVimeoLiveEvent).not.toHaveBeenCalled();
  });

  it("checks the configured event when the flag is on", async () => {
    process.env.LIVE_TRANSCRIPTION_ENABLED = "true";
    readVimeoLiveEvent.mockResolvedValue({
      snapshot: {
        eventId: "6344608",
        title: "The OG",
        privacy: "embed_only",
        status: "unavailable",
        videoId: null,
        configUrl: null,
      },
      hls: null,
      auth: "viewer",
    });

    const summary = await queueVimeoLiveMarks();

    expect(summary.disabled).toBe(false);
    expect(summary.idle).toEqual(["6344608"]);
    expect(readVimeoLiveEvent).toHaveBeenCalledTimes(1);
  });
});
