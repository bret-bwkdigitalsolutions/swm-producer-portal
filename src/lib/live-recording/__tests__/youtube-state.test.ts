import { describe, it, expect } from "vitest";
import { deriveDecision, HANDOFF_PROCESSING_WINDOW_MS } from "../youtube-state";
import type { YouTubeVideoLiveDetails } from "@/lib/youtube-api";

const baseDetails = (
  overrides: Partial<YouTubeVideoLiveDetails> = {}
): YouTubeVideoLiveDetails => ({
  videoId: "abc123",
  title: "Test stream",
  channelId: "UC_test",
  liveBroadcastContent: "upcoming",
  scheduledStartTime: null,
  actualStartTime: null,
  actualEndTime: null,
  thumbnailUrl: null,
  ...overrides,
});

describe("deriveDecision — scheduled state", () => {
  it("transitions scheduled → live when broadcast goes live", () => {
    const start = new Date("2026-05-20T19:02:00Z");
    const decision = deriveDecision({
      currentState: "scheduled",
      ytDetails: baseDetails({
        liveBroadcastContent: "live",
        actualStartTime: start,
      }),
      now: new Date("2026-05-20T19:03:00Z"),
    });
    expect(decision.action).toBe("transition");
    if (decision.action === "transition") {
      expect(decision.to).toBe("live");
      expect(decision.updates.actualStartedAt).toEqual(start);
    }
  });

  it("transitions scheduled → ended_pending when broadcast ended before we saw it live", () => {
    const start = new Date("2026-05-20T19:00:00Z");
    const end = new Date("2026-05-20T19:01:00Z");
    const decision = deriveDecision({
      currentState: "scheduled",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualStartTime: start,
        actualEndTime: end,
      }),
      now: new Date("2026-05-20T19:02:00Z"),
    });
    expect(decision.action).toBe("transition");
    if (decision.action === "transition") {
      expect(decision.to).toBe("ended_pending");
      expect(decision.updates.actualStartedAt).toEqual(start);
      expect(decision.updates.actualEndedAt).toEqual(end);
    }
  });

  it("stays scheduled when broadcast hasn't begun (upcoming, no actualStartTime)", () => {
    const decision = deriveDecision({
      currentState: "scheduled",
      ytDetails: baseDetails({
        liveBroadcastContent: "upcoming",
      }),
      now: new Date("2026-05-20T19:03:00Z"),
    });
    expect(decision.action).toBe("no_change");
  });

  it("stays scheduled when YT briefly returns 'none' with no actualStartTime yet", () => {
    // YouTube eventual consistency — should not be interpreted as "ended"
    const decision = deriveDecision({
      currentState: "scheduled",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
      }),
      now: new Date("2026-05-20T19:03:00Z"),
    });
    expect(decision.action).toBe("no_change");
  });
});

describe("deriveDecision — live state", () => {
  it("transitions live → ended_pending when actualEndTime is set", () => {
    const start = new Date("2026-05-20T19:00:00Z");
    const end = new Date("2026-05-20T20:30:00Z");
    const decision = deriveDecision({
      currentState: "live",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualStartTime: start,
        actualEndTime: end,
      }),
      now: new Date("2026-05-20T20:31:00Z"),
    });
    expect(decision.action).toBe("transition");
    if (decision.action === "transition") {
      expect(decision.to).toBe("ended_pending");
      expect(decision.updates.actualEndedAt).toEqual(end);
    }
  });

  it("stays live when YT briefly reports 'none' but no actualEndTime", () => {
    // Transient eventual consistency — must NOT bounce out of live
    const decision = deriveDecision({
      currentState: "live",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualStartTime: new Date("2026-05-20T19:00:00Z"),
        actualEndTime: null,
      }),
      now: new Date("2026-05-20T19:05:00Z"),
    });
    expect(decision.action).toBe("no_change");
  });

  it("stays live while liveBroadcastContent remains 'live'", () => {
    const decision = deriveDecision({
      currentState: "live",
      ytDetails: baseDetails({
        liveBroadcastContent: "live",
        actualStartTime: new Date("2026-05-20T19:00:00Z"),
      }),
      now: new Date("2026-05-20T19:30:00Z"),
    });
    expect(decision.action).toBe("no_change");
  });
});

describe("deriveDecision — ended_pending state", () => {
  it("triggers handoff after the processing window has elapsed", () => {
    const end = new Date("2026-05-20T20:00:00Z");
    const now = new Date(end.getTime() + HANDOFF_PROCESSING_WINDOW_MS + 1000);
    const decision = deriveDecision({
      currentState: "ended_pending",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualEndTime: end,
      }),
      now,
    });
    expect(decision.action).toBe("trigger_handoff");
  });

  it("does NOT trigger handoff before the processing window has elapsed", () => {
    const end = new Date("2026-05-20T20:00:00Z");
    const now = new Date(end.getTime() + 5 * 60 * 1000); // only 5 min after end
    const decision = deriveDecision({
      currentState: "ended_pending",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualEndTime: end,
      }),
      now,
    });
    expect(decision.action).toBe("no_change");
  });

  it("does NOT trigger handoff if actualEndTime is missing (defensive)", () => {
    const decision = deriveDecision({
      currentState: "ended_pending",
      ytDetails: baseDetails({
        liveBroadcastContent: "none",
        actualEndTime: null,
      }),
      now: new Date(),
    });
    expect(decision.action).toBe("no_change");
  });
});

describe("deriveDecision — terminal states", () => {
  it("returns no_change for archived (poller skips, but safety net)", () => {
    const decision = deriveDecision({
      currentState: "archived",
      ytDetails: baseDetails({ liveBroadcastContent: "none" }),
      now: new Date(),
    });
    expect(decision.action).toBe("no_change");
  });

  it("returns no_change for cancelled", () => {
    const decision = deriveDecision({
      currentState: "cancelled",
      ytDetails: baseDetails({ liveBroadcastContent: "none" }),
      now: new Date(),
    });
    expect(decision.action).toBe("no_change");
  });

  it("returns no_change for stuck (admin must intervene)", () => {
    const decision = deriveDecision({
      currentState: "stuck",
      ytDetails: baseDetails({ liveBroadcastContent: "none" }),
      now: new Date(),
    });
    expect(decision.action).toBe("no_change");
  });
});
