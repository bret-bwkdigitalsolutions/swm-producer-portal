import {
  MAX_BROADCAST_SECONDS,
  MIN_BROADCAST_SECONDS,
} from "./constants";

export interface DurationDecision {
  ok: boolean;
  /** Whole seconds, when both timestamps were usable. */
  seconds: number | null;
  reason: string | null;
}

/**
 * Cost guard. Only a finished broadcast that is longer than 2 minutes and
 * shorter than 4 hours is transcribed. Missing timestamps skip the scan
 * rather than guessing.
 */
export function evaluateBroadcastDuration(
  startedAt: Date | null | undefined,
  endedAt: Date | null | undefined
): DurationDecision {
  if (!startedAt || !endedAt) {
    return {
      ok: false,
      seconds: null,
      reason:
        "Broadcast length is unknown (missing start or end time), so it was not transcribed.",
    };
  }
  const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return {
      ok: false,
      seconds: null,
      reason: "Broadcast length is not usable, so it was not transcribed.",
    };
  }
  const whole = Math.round(seconds);
  if (seconds <= MIN_BROADCAST_SECONDS) {
    return {
      ok: false,
      seconds: whole,
      reason: `Broadcast is ${whole}s, which is not longer than 2 minutes.`,
    };
  }
  if (seconds >= MAX_BROADCAST_SECONDS) {
    return {
      ok: false,
      seconds: whole,
      reason: `Broadcast is ${whole}s, which is not shorter than 4 hours.`,
    };
  }
  return { ok: true, seconds: whole, reason: null };
}
