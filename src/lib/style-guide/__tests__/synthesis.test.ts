import { describe, it, expect } from "vitest";
import { decideSynthesis } from "../synthesis";

describe("decideSynthesis", () => {
  describe("no existing guide", () => {
    it("does not synthesize when below first-synthesis threshold", () => {
      const decision = decideSynthesis({
        hasExistingGuide: false,
        totalEdits: 4,
        newEditsSinceLastSynthesis: 4,
      });
      expect(decision.shouldSynthesize).toBe(false);
      expect(decision.reason).toBe("below_first_threshold");
    });

    it("synthesizes when total edits first reaches 5", () => {
      const decision = decideSynthesis({
        hasExistingGuide: false,
        totalEdits: 5,
        newEditsSinceLastSynthesis: 5,
      });
      expect(decision.shouldSynthesize).toBe(true);
      expect(decision.reason).toBe("first_synthesis");
    });

    it("synthesizes when total edits exceeds 5 and no guide yet", () => {
      const decision = decideSynthesis({
        hasExistingGuide: false,
        totalEdits: 12,
        newEditsSinceLastSynthesis: 12,
      });
      expect(decision.shouldSynthesize).toBe(true);
      expect(decision.reason).toBe("first_synthesis");
    });

    it("does not synthesize on zero edits", () => {
      const decision = decideSynthesis({
        hasExistingGuide: false,
        totalEdits: 0,
        newEditsSinceLastSynthesis: 0,
      });
      expect(decision.shouldSynthesize).toBe(false);
      expect(decision.reason).toBe("below_first_threshold");
    });
  });

  describe("guide exists", () => {
    it("does not refresh after 0 new edits since synthesis", () => {
      const decision = decideSynthesis({
        hasExistingGuide: true,
        totalEdits: 10,
        newEditsSinceLastSynthesis: 0,
      });
      expect(decision.shouldSynthesize).toBe(false);
      expect(decision.reason).toBe("not_enough_new_edits");
    });

    it("does not refresh after 2 new edits since synthesis", () => {
      const decision = decideSynthesis({
        hasExistingGuide: true,
        totalEdits: 7,
        newEditsSinceLastSynthesis: 2,
      });
      expect(decision.shouldSynthesize).toBe(false);
      expect(decision.reason).toBe("not_enough_new_edits");
    });

    it("refreshes after exactly 3 new edits since synthesis", () => {
      const decision = decideSynthesis({
        hasExistingGuide: true,
        totalEdits: 8,
        newEditsSinceLastSynthesis: 3,
      });
      expect(decision.shouldSynthesize).toBe(true);
      expect(decision.reason).toBe("refresh_threshold_met");
    });

    it("refreshes on every multiple of 3 once the threshold is crossed", () => {
      const decision = decideSynthesis({
        hasExistingGuide: true,
        totalEdits: 100,
        newEditsSinceLastSynthesis: 9,
      });
      expect(decision.shouldSynthesize).toBe(true);
      expect(decision.reason).toBe("refresh_threshold_met");
    });
  });

  describe("decision payload", () => {
    it("echoes the input counts on every return", () => {
      const decision = decideSynthesis({
        hasExistingGuide: true,
        totalEdits: 12,
        newEditsSinceLastSynthesis: 4,
      });
      expect(decision.totalEdits).toBe(12);
      expect(decision.newEditsSinceLastSynthesis).toBe(4);
    });
  });
});
