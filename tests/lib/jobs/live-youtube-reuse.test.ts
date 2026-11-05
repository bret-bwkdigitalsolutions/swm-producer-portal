import { describe, expect, it } from "vitest";
import { reusedLiveYoutubeUrl } from "@/lib/jobs/live-youtube-reuse";

const LIVE = "https://www.youtube.com/watch?v=bi_EF_FhjOk";

describe("reusedLiveYoutubeUrl", () => {
  it("reuses the live video when no producer file was uploaded", () => {
    expect(
      reusedLiveYoutubeUrl(
        {
          liveYoutubeVideoId: "bi_EF_FhjOk",
          liveStreamUrl: "https://www.youtube.com/live/bi_EF_FhjOk",
        },
        null
      )
    ).toBe(LIVE);
  });

  it("parses a live URL when the video id was not stored", () => {
    expect(
      reusedLiveYoutubeUrl(
        { liveStreamUrl: "https://youtu.be/bi_EF_FhjOk" },
        "uploads/2026/11/downloaded-audio.mp3"
      )
    ).toBe(LIVE);
  });

  it("does not replace an existing YouTube source", () => {
    expect(
      reusedLiveYoutubeUrl(
        {
          existingYoutubeUrl: "https://www.youtube.com/watch?v=CrP0kNuyT_Y",
          liveYoutubeVideoId: "bi_EF_FhjOk",
        },
        null
      )
    ).toBeNull();
  });

  it("does not skip an intentional producer upload", () => {
    expect(
      reusedLiveYoutubeUrl(
        {
          videoFileName: "finished-cut.mp4",
          liveYoutubeVideoId: "bi_EF_FhjOk",
          liveStreamUrl: LIVE,
        },
        "uploads/2026/11/finished-cut.mp4"
      )
    ).toBeNull();
  });

  it("reuses the live video when the producer file never landed in GCS", () => {
    expect(
      reusedLiveYoutubeUrl(
        {
          videoFileName: "finished-cut.mp4",
          liveYoutubeVideoId: "bi_EF_FhjOk",
        },
        null
      )
    ).toBe(LIVE);
  });

  it("does not reuse a live URL for a Vimeo source", () => {
    expect(
      reusedLiveYoutubeUrl(
        {
          existingVimeoUrl: "https://vimeo.com/123456789",
          liveYoutubeVideoId: "bi_EF_FhjOk",
        },
        null
      )
    ).toBeNull();
  });

  it("returns null when there is no live video", () => {
    expect(reusedLiveYoutubeUrl({ description: "no live" }, null)).toBeNull();
  });
});
