import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MAX_TRANSCRIPT_ATTEMPTS } from "@/lib/live-marks/constants";
import {
  formatMarkClock,
  readStoredMarks,
  readStoredMarksResponse,
  transcriptStatusLabel,
  youtubeTimestampUrl,
} from "@/lib/live-marks/payload";

export interface LiveRecordingMarksProps {
  youtubeVideoId: string;
  transcriptStatus: string | null;
  transcriptMarks: unknown;
  transcriptMarksResponse: unknown;
  transcriptError: string | null;
  transcriptAttempts: number;
  transcriptNextAttemptAt: Date | null;
  transcriptScannedAt: Date | null;
  /** Transcript error text is shown to admins only. */
  showError?: boolean;
}

export function LiveRecordingMarks({
  youtubeVideoId,
  transcriptStatus,
  transcriptMarks,
  transcriptMarksResponse,
  transcriptError,
  transcriptAttempts,
  transcriptNextAttemptAt,
  transcriptScannedAt,
  showError = false,
}: LiveRecordingMarksProps) {
  const marks = readStoredMarks(transcriptMarks);
  const response = readStoredMarksResponse(transcriptMarksResponse);
  const gaveUp =
    transcriptStatus === "failed" &&
    transcriptAttempts >= MAX_TRANSCRIPT_ATTEMPTS;
  const summary =
    transcriptStatus === "completed"
      ? marks.length === 0
        ? "Scanned · no marks"
        : `Scanned · ${marks.length} mark${marks.length === 1 ? "" : "s"}`
      : transcriptStatusLabel(transcriptStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mark that</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Field label="Transcription" value={summary} />
        {transcriptScannedAt && (
          <Field label="Scanned" value={transcriptScannedAt.toLocaleString()} />
        )}
        {(transcriptStatus === "failed" ||
          transcriptStatus === "config_error" ||
          transcriptStatus === "contract_error" ||
          transcriptStatus === "website_not_ready") && (
          <Field
            label="Next attempt"
            value={
              transcriptStatus === "config_error"
                ? "Not retrying. Fix the WordPress app user, then Re-scan."
                : transcriptStatus === "contract_error"
                  ? "Not retrying. The website rejected the marks payload."
                  : transcriptStatus === "failed" &&
                      (gaveUp || !transcriptNextAttemptAt)
                    ? "Not retrying. An admin can Re-scan."
                    : transcriptNextAttemptAt?.toLocaleString() ?? "Waiting"
            }
          />
        )}
        {response && (
          <Field
            label="Website"
            value={`Stored ${response.stored}${
              response.live_post_id != null
                ? ` · live post ${response.live_post_id}`
                : ""
            }${
              response.posted_to != null
                ? ` · posted to ${response.posted_to}`
                : ""
            }`}
          />
        )}
        {showError && transcriptError && (
          <p className="whitespace-pre-wrap break-words text-muted-foreground">
            {transcriptError}
          </p>
        )}
        {marks.length > 0 && (
          <ul className="space-y-2">
            {marks.map((mark, index) => (
              <li key={`${mark.seconds}-${index}`} className="break-words">
                <a
                  href={youtubeTimestampUrl(youtubeVideoId, mark.seconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {formatMarkClock(mark.seconds)}
                </a>
                {mark.quote ? ` “${mark.quote}”` : ""}
                {mark.cue ? (
                  <span className="text-muted-foreground"> · {mark.cue}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}
