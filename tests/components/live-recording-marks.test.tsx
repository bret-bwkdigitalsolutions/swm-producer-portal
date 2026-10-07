import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveRecordingMarks } from "@/components/dashboard/live-recording-marks";

describe("LiveRecordingMarks", () => {
  it("links each mark to the live YouTube video at that second", () => {
    render(
      <LiveRecordingMarks
        youtubeVideoId="abcdefghijk"
        transcriptStatus="completed"
        transcriptAttempts={1}
        transcriptNextAttemptAt={null}
        transcriptScannedAt={new Date("2026-10-07T20:00:00.000Z")}
        transcriptError={null}
        transcriptMarksResponse={{ stored: 1, posted_to: 4401, live_post_id: 4300 }}
        transcriptMarks={[
          { seconds: 32, quote: "Nobody looked there.", cue: "Mark that" },
        ]}
      />
    );

    expect(screen.getByText("Scanned · 1 mark")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "0:32" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=32s"
    );
    expect(screen.getByText(/Nobody looked there/)).toBeInTheDocument();
    expect(screen.getByText(/Stored 1/)).toBeInTheDocument();
  });

  it("records a finished scan that found nothing", () => {
    render(
      <LiveRecordingMarks
        youtubeVideoId="abcdefghijk"
        transcriptStatus="completed"
        transcriptAttempts={1}
        transcriptNextAttemptAt={null}
        transcriptScannedAt={new Date("2026-10-07T20:00:00.000Z")}
        transcriptError={null}
        transcriptMarksResponse={null}
        transcriptMarks={[]}
      />
    );

    expect(screen.getByText("Scanned · no marks")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a website 404 as a retry, not a dead end", () => {
    render(
      <LiveRecordingMarks
        youtubeVideoId="abcdefghijk"
        transcriptStatus="website_not_ready"
        transcriptAttempts={0}
        transcriptNextAttemptAt={new Date("2026-10-07T20:15:00.000Z")}
        transcriptScannedAt={null}
        transcriptError="Website route is not ready (HTTP 404). Will retry."
        showError
        transcriptMarksResponse={null}
        transcriptMarks={[
          { seconds: 32, quote: "A porch.", cue: "Mark that" },
        ]}
      />
    );

    expect(screen.getByText("Website not ready")).toBeInTheDocument();
    expect(screen.getByText("Next attempt")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0:32" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abcdefghijk&t=32s"
    );
  });

  it("hides the transcript error from producers", () => {
    render(
      <LiveRecordingMarks
        youtubeVideoId="abcdefghijk"
        transcriptStatus="failed"
        transcriptAttempts={3}
        transcriptNextAttemptAt={new Date("2026-10-07T20:15:00.000Z")}
        transcriptScannedAt={null}
        transcriptError="yt-dlp exited 1"
        transcriptMarksResponse={null}
        transcriptMarks={[]}
      />
    );

    expect(screen.queryByText(/yt-dlp/)).not.toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
