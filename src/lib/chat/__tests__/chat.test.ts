import { describe, it, expect } from "vitest";
import { formatCentral } from "../types";
import {
  normalizeMessage,
  normalizeConversation,
  normalizeDmMessage,
  toFlag,
} from "../normalize";

describe("formatCentral", () => {
  it("formats an already-Central timestamp without any timezone shift", () => {
    // 14:03 must stay 2:03 PM — no conversion.
    expect(formatCentral("2026-08-05 14:03:11")).toBe("Aug 5, 2026, 2:03 PM CT");
  });

  it("handles midnight and noon boundaries", () => {
    expect(formatCentral("2026-01-01 00:00:00")).toBe("Jan 1, 2026, 12:00 AM CT");
    expect(formatCentral("2026-12-31 12:00:00")).toBe("Dec 31, 2026, 12:00 PM CT");
  });

  it("accepts ISO 'T' separators and missing seconds", () => {
    expect(formatCentral("2026-08-05T09:30")).toBe("Aug 5, 2026, 9:30 AM CT");
  });

  it("returns a dash for empty input and echoes unparseable strings", () => {
    expect(formatCentral(null)).toBe("—");
    expect(formatCentral("")).toBe("—");
    expect(formatCentral("not a date")).toBe("not a date");
  });
});

describe("normalize (WordPress returns ints as strings)", () => {
  it("toFlag coerces string/number/absent to 0|1", () => {
    expect(toFlag("1")).toBe(1);
    expect(toFlag(1)).toBe(1);
    expect(toFlag("0")).toBe(0);
    expect(toFlag(0)).toBe(0);
    expect(toFlag(undefined)).toBe(0);
  });

  it("normalizeMessage yields real numbers so reported/is_locked === 1 works", () => {
    const raw = {
      id: "15",
      subscriber_id: "2",
      body: "hey",
      author_name: "Bret",
      author_kind: "member",
      status: "visible",
      reported: "1",
      created_at: "2026-08-05 19:22:08",
      context_type: "show",
      context_id: "8",
      context_title: "YDC",
      thread_id: "3",
      is_locked: "1",
    };
    const m = normalizeMessage(raw);
    expect(m.id).toBe(15);
    expect(m.subscriber_id).toBe(2);
    expect(m.reported === 1).toBe(true);
    expect(m.is_locked === 1).toBe(true);
    expect(m.context_id).toBe(8);
    expect(m.thread_id).toBe(3);
  });

  it("normalizeConversation coerces unread counts to numbers", () => {
    const c = normalizeConversation({
      id: "1",
      subscriber_id: "2",
      status: "open",
      unread_by_team: "1",
      unread_by_member: "0",
      last_message_at: "2026-08-05 19:22:25",
      created_at: "2026-08-05 19:22:20",
      email: "a@b.com",
      display_name: "Bret",
    });
    expect(c.id).toBe(1);
    expect(c.unread_by_team).toBe(1);
    expect(c.unread_by_team > 0).toBe(true);
  });

  it("normalizeDmMessage tags sender and numbers ids", () => {
    const msg = normalizeDmMessage({
      id: "88",
      sender: "team",
      sender_id: "3",
      body: "hi",
      created_at: "2026-08-05 19:23:00",
      read_at: null,
    });
    expect(msg.id).toBe(88);
    expect(msg.sender).toBe("team");
    expect(msg.sender_id).toBe(3);
  });
});
