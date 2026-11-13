import { describe, expect, it } from "vitest";
import phrases from "../../fixtures/mark-that-phrases.json";
import { detectMarks, utteranceCue } from "@/lib/live-marks/matcher";
import {
  VIMEO_EVENT_FIELDS,
  buildVimeoLiveMarkPayload,
  parseVimeoEventSnapshot,
  parseVimeoHlsSource,
  parseVimeoLiveEvents,
  redactSecrets,
  utterancesAtStreamEdge,
  vimeoFailureDisposition,
  vimeoLiveReferrer,
  vimeoLiveWatchRestartAllowed,
  vimeoMarkBucket,
  vimeoMarkIdentity,
  vimeoPaidWindowAllowed,
} from "@/lib/live-marks/vimeo-events";
import { buildLiveMarksPayload } from "@/lib/live-marks/payload";

describe("Vimeo live mark payload", () => {
  it("sends the vimeo contract and leaves the YouTube payload unchanged", () => {
    const youtube = buildLiveMarksPayload({
      wpShowId: 21,
      youtubeVideoId: "abcdefghijk",
      marks: [{ seconds: 32, quote: "A porch.", cue: "Mark that" }],
    });
    expect(youtube).not.toHaveProperty("platform");
    expect(youtube).not.toHaveProperty("vimeo_event_id");
    expect(Object.keys(youtube).sort()).toEqual([
      "live_youtube_id",
      "marks",
      "show_id",
      "source",
    ]);

    const payload = buildVimeoLiveMarkPayload({
      showId: 21,
      eventId: "6344608",
      videoId: "1245272985",
      mark: { seconds: 2594, quote: "Nobody looked under the porch.", cue: "Mark that" },
    });
    expect(payload).toEqual({
      show_id: 21,
      platform: "vimeo",
      vimeo_event_id: "6344608",
      vimeo_video_id: "1245272985",
      offset_seconds: 2594,
      cue_text: "Nobody looked under the porch. Mark that",
      source: "live_transcript",
      marks: [
        {
          seconds: 2594,
          offset_seconds: 2594,
          quote: "Nobody looked under the porch.",
          cue: "Mark that",
          cue_text: "Nobody looked under the porch. Mark that",
        },
      ],
    });
    expect(payload).not.toHaveProperty("live_youtube_id");
  });

  it("sends vimeo ids as JSON strings and offset_seconds as an integer", () => {
    const payload = buildVimeoLiveMarkPayload({
      showId: 21,
      eventId: 6344608,
      videoId: 1245272985,
      mark: { seconds: 2594, quote: "A porch.", cue: "mark that" },
    });
    const body = JSON.parse(JSON.stringify(payload)) as {
      vimeo_event_id: unknown;
      vimeo_video_id: unknown;
      offset_seconds: unknown;
    };

    expect(payload.vimeo_event_id).toBe("6344608");
    expect(payload.vimeo_video_id).toBe("1245272985");
    expect(typeof body.vimeo_event_id).toBe("string");
    expect(typeof body.vimeo_video_id).toBe("string");
    expect(body.vimeo_event_id).toBe("6344608");
    expect(body.vimeo_video_id).toBe("1245272985");
    expect(typeof body.offset_seconds).toBe("number");
    expect(body.offset_seconds).toBe(2594);
    expect(Number.isInteger(body.offset_seconds)).toBe(true);
  });

  it("omits vimeo_video_id when the broadcast id is not known yet", () => {
    const payload = buildVimeoLiveMarkPayload({
      showId: 21,
      eventId: "6344608",
      videoId: null,
      mark: { seconds: 12, quote: "", cue: "mark it" },
    });
    expect(payload.vimeo_video_id).toBeUndefined();
    expect(payload.cue_text).toBe("mark it");
    expect(Object.keys(payload)).not.toContain("vimeo_video_id");
  });
});

describe("Vimeo cue detection", () => {
  it("places a spoken cue on the stream clock and builds one vimeo mark", () => {
    const edge = 2500;
    const shifted = utterancesAtStreamEdge(
      [
        { start: 100, end: 104, text: "Nobody looked under the porch." },
        { start: 104, end: 106, text: "Mark that." },
      ],
      edge
    );
    const marks = detectMarks(shifted);
    expect(marks).toHaveLength(1);
    expect(marks[0].seconds).toBe(edge + 104 - 10);
    expect(marks[0].cue).toBe("Mark that");

    const payload = buildVimeoLiveMarkPayload({
      showId: 21,
      eventId: "6344608",
      videoId: "1245272985",
      mark: marks[0],
    });
    expect(payload.offset_seconds).toBe(2594);
    expect(payload.cue_text).toContain("Mark that");
    expect(payload.platform).toBe("vimeo");
  });

  it("keeps the shared cue list and rejects non-cues", () => {
    for (const text of phrases.match) {
      expect(utteranceCue(text)).toBeTruthy();
    }
    for (const text of phrases.noMatch) {
      expect(utteranceCue(text)).toBeNull();
      expect(detectMarks([{ start: 40, end: 42, text }])).toEqual([]);
    }
  });

  it("dedupes a repeated cue into one 30-second bucket", () => {
    const marks = detectMarks([
      { start: 100, end: 102, text: "Mark that." },
      { start: 110, end: 112, text: "Mark it." },
      { start: 140, end: 142, text: "Mark this." },
    ]);
    expect(marks.map((mark) => mark.seconds)).toEqual([90, 130]);
    expect(vimeoMarkBucket(marks[0].seconds)).toBe(3);
    expect(vimeoMarkBucket(marks[1].seconds)).toBe(4);
    expect(vimeoMarkBucket(29)).toBe(vimeoMarkBucket(0));
  });
});

describe("Vimeo event config", () => {
  it("defaults to the OG event and lets the env replace the list", () => {
    const previous = process.env.VIMEO_LIVE_EVENTS;
    delete process.env.VIMEO_LIVE_EVENTS;
    try {
      expect(parseVimeoLiveEvents().map((event) => event.eventId)).toEqual(["6344608"]);
      expect(parseVimeoLiveEvents("")).toEqual(parseVimeoLiveEvents());
    } finally {
      if (previous === undefined) delete process.env.VIMEO_LIVE_EVENTS;
      else process.env.VIMEO_LIVE_EVENTS = previous;
    }
    expect(parseVimeoLiveEvents("off")).toEqual([]);
    expect(parseVimeoLiveEvents("6344608:f86b2c8698:21, 7000001::22")).toEqual([
      { eventId: "6344608", hash: "f86b2c8698", showId: 21 },
      { eventId: "7000001", hash: "", showId: 22 },
    ]);
    expect(parseVimeoLiveEvents("not-an-event")).toEqual([]);
  });

  it("keeps the referrer on https", () => {
    expect(vimeoLiveReferrer("http://stolenwatermedia.com/")).toBe(
      "https://stolenwatermedia.com/"
    );
    expect(vimeoLiveReferrer("https://www.stolenwatermedia.com/og")).toBe(
      "https://www.stolenwatermedia.com/og"
    );
  });

  it("does not request or keep the stream key", () => {
    expect(VIMEO_EVENT_FIELDS).not.toMatch(/stream_key|rtmp/i);
    const snapshot = parseVimeoEventSnapshot("6344608", {
      title: "The OG",
      stream_key: "do-not-store",
      rtmp_link: "rtmp://example/live/secret",
      stream_privacy: { view: "embed_only" },
      clip_to_play: {
        uri: "/videos/1245272985",
        live: { status: "streaming" },
        config_url: "https://player.vimeo.com/video/1245272985/config",
      },
    });
    expect(snapshot).toMatchObject({
      eventId: "6344608",
      status: "streaming",
      videoId: "1245272985",
      privacy: "embed_only",
    });
    expect(JSON.stringify(snapshot)).not.toContain("do-not-store");
    expect(JSON.stringify(snapshot)).not.toContain("rtmp");
  });

  it("reads the player HLS url and ignores other hosts", () => {
    const source = parseVimeoHlsSource({
      request: {
        files: {
          hls: {
            default_cdn: "fastly_live",
            cdns: {
              fastly_live: { url: "https://live-api.vimeocdn.com/master.m3u8" },
            },
          },
        },
      },
      video: { live_event: { ingest: { start_time: 1_794_524_000 } } },
    });
    expect(source).toEqual({
      url: "https://live-api.vimeocdn.com/master.m3u8",
      streamStartedAt: 1_794_524_000,
    });
    expect(
      parseVimeoHlsSource({
        request: {
          files: {
            hls: { cdns: { bad: { url: "https://evil.example/master.m3u8" } } },
          },
        },
      })
    ).toBeNull();
  });

  it("strips bearer tokens and urls from errors", () => {
    expect(redactSecrets("Vimeo API 401 bearer abc.def for https://api.vimeo.com/x?sig=1")).toBe(
      "Vimeo API 401 bearer [redacted] for [url]"
    );
  });
});

describe("Vimeo mark follow-ups", () => {
  it("treats a 400 or 422 as terminal and other failures as retryable", () => {
    expect(vimeoFailureDisposition("contract")).toBe("terminal");
    expect(vimeoFailureDisposition("retryable")).toBe("retry");
    expect(vimeoFailureDisposition("website_not_ready")).toBe("retry");
    expect(vimeoFailureDisposition("overlap")).toBe("retry");
    expect(vimeoFailureDisposition("config")).toBe("stop");
  });

  it("dedupes a cue on the event and time bucket, ignoring the video id", () => {
    const livePass = vimeoMarkIdentity("6344608", 2594);
    const archivePass = vimeoMarkIdentity("6344608", 2600);
    expect(livePass).toEqual(archivePass);
    expect(livePass).toEqual({ eventId: "6344608", dedupeBucket: 86 });
    expect(livePass).not.toHaveProperty("videoId");
    expect(vimeoMarkIdentity("6344608", 90)).not.toEqual(
      vimeoMarkIdentity("6344608", 130)
    );
  });

  it("counts a live window against the daily cap", () => {
    expect(vimeoPaidWindowAllowed(9, 10)).toBe(true);
    expect(vimeoPaidWindowAllowed(10, 10)).toBe(false);
    expect(vimeoPaidWindowAllowed(11, 10)).toBe(false);
  });

  it("does not restart a live watch that already finished for this video", () => {
    expect(
      vimeoLiveWatchRestartAllowed({ videoId: "1245272985", exhaustedVideoId: null })
    ).toBe(true);
    expect(
      vimeoLiveWatchRestartAllowed({
        videoId: "1245272985",
        exhaustedVideoId: "1245272985",
      })
    ).toBe(false);
    expect(
      vimeoLiveWatchRestartAllowed({ videoId: null, exhaustedVideoId: "" })
    ).toBe(false);
    expect(
      vimeoLiveWatchRestartAllowed({
        videoId: "999",
        exhaustedVideoId: "1245272985",
      })
    ).toBe(true);
  });
});
