import { describe, it, expect } from "vitest";
import { ContentType, UserRole, CONTENT_TYPE_LABELS } from "@/lib/constants";

describe("ContentType", () => {
  it("defines all content types", () => {
    expect(ContentType.REVIEW).toBe("review");
    expect(ContentType.TRAILER).toBe("trailer");
    expect(ContentType.APPEARANCE).toBe("appearance");
    expect(ContentType.EPISODE).toBe("episode");
    expect(ContentType.CASE_DOCUMENT).toBe("case_document");
    expect(ContentType.SHOW).toBe("show");
  });

  it("has labels for all content types", () => {
    const types = Object.values(ContentType);
    for (const type of types) {
      expect(CONTENT_TYPE_LABELS[type]).toBeDefined();
      expect(typeof CONTENT_TYPE_LABELS[type]).toBe("string");
    }
  });
});

describe("UserRole", () => {
  it("defines admin and producer roles", () => {
    expect(UserRole.ADMIN).toBe("admin");
    expect(UserRole.PRODUCER).toBe("producer");
  });
});
