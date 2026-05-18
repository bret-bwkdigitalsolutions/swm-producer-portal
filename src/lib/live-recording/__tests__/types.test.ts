import { describe, it, expect } from "vitest";
import {
  isLiveRecordingState,
  canTransition,
  ACTIVE_LIVE_RECORDING_STATES,
  LIVE_RECORDING_STATES,
} from "../types";

describe("isLiveRecordingState", () => {
  it("accepts every defined state", () => {
    for (const s of LIVE_RECORDING_STATES) {
      expect(isLiveRecordingState(s)).toBe(true);
    }
  });

  it("rejects unknown states", () => {
    expect(isLiveRecordingState("processing")).toBe(false);
    expect(isLiveRecordingState("")).toBe(false);
    expect(isLiveRecordingState("LIVE")).toBe(false);
  });
});

describe("ACTIVE_LIVE_RECORDING_STATES", () => {
  it("contains the three states the poller walks", () => {
    expect(ACTIVE_LIVE_RECORDING_STATES.has("scheduled")).toBe(true);
    expect(ACTIVE_LIVE_RECORDING_STATES.has("live")).toBe(true);
    expect(ACTIVE_LIVE_RECORDING_STATES.has("ended_pending")).toBe(true);
  });

  it("excludes terminal states", () => {
    expect(ACTIVE_LIVE_RECORDING_STATES.has("archived")).toBe(false);
    expect(ACTIVE_LIVE_RECORDING_STATES.has("cancelled")).toBe(false);
  });

  it("excludes stuck (admin must intervene before polling resumes)", () => {
    expect(ACTIVE_LIVE_RECORDING_STATES.has("stuck")).toBe(false);
  });
});

describe("canTransition", () => {
  describe("from scheduled", () => {
    it("allows scheduled → live", () => {
      expect(canTransition("scheduled", "live")).toBe(true);
    });
    it("allows scheduled → ended_pending (short broadcasts may skip live observation)", () => {
      expect(canTransition("scheduled", "ended_pending")).toBe(true);
    });
    it("allows scheduled → cancelled", () => {
      expect(canTransition("scheduled", "cancelled")).toBe(true);
    });
    it("rejects scheduled → archived (no skipping the pipeline)", () => {
      expect(canTransition("scheduled", "archived")).toBe(false);
    });
    it("rejects scheduled → stuck (stuck is only reachable from ended_pending)", () => {
      expect(canTransition("scheduled", "stuck")).toBe(false);
    });
  });

  describe("from live", () => {
    it("allows live → ended_pending", () => {
      expect(canTransition("live", "ended_pending")).toBe(true);
    });
    it("allows live → cancelled", () => {
      expect(canTransition("live", "cancelled")).toBe(true);
    });
    it("rejects live → scheduled (no going backwards)", () => {
      expect(canTransition("live", "scheduled")).toBe(false);
    });
    it("rejects live → archived (must go through ended_pending)", () => {
      expect(canTransition("live", "archived")).toBe(false);
    });
  });

  describe("from ended_pending", () => {
    it("allows ended_pending → archived", () => {
      expect(canTransition("ended_pending", "archived")).toBe(true);
    });
    it("allows ended_pending → stuck", () => {
      expect(canTransition("ended_pending", "stuck")).toBe(true);
    });
    it("allows ended_pending → cancelled", () => {
      expect(canTransition("ended_pending", "cancelled")).toBe(true);
    });
    it("rejects ended_pending → live (broadcast doesn't restart)", () => {
      expect(canTransition("ended_pending", "live")).toBe(false);
    });
  });

  describe("from stuck", () => {
    it("allows stuck → ended_pending (admin retry)", () => {
      expect(canTransition("stuck", "ended_pending")).toBe(true);
    });
    it("allows stuck → archived (admin force-archive)", () => {
      expect(canTransition("stuck", "archived")).toBe(true);
    });
    it("allows stuck → cancelled", () => {
      expect(canTransition("stuck", "cancelled")).toBe(true);
    });
  });

  describe("from terminal states", () => {
    it("rejects all transitions from archived", () => {
      for (const s of LIVE_RECORDING_STATES) {
        expect(canTransition("archived", s)).toBe(false);
      }
    });
    it("rejects all transitions from cancelled", () => {
      for (const s of LIVE_RECORDING_STATES) {
        expect(canTransition("cancelled", s)).toBe(false);
      }
    });
  });

  it("rejects same-state transitions universally", () => {
    for (const s of LIVE_RECORDING_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
