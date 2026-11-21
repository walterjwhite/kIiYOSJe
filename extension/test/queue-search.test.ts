import { describe, expect, it } from "vitest";
import { itemSearchText } from "../src/queue-search.js";

const item = {
  adapter: "gmail",
  account: "work",
  sender: "Ana Ruiz <ana@example.com>",
  summary: "Asks to move the Q4 review",
  draftPreview: "Sure, Thursday works.",
  plannedFor: "2026-11-20",
  receivedAt: "2026-11-19T09:00:00.000Z",
  direction: { name: "Scheduling" },
  timing: { bucket: "today" as const, actBy: null, reason: "Meeting is soon" },
};

describe("itemSearchText", () => {
  const text = itemSearchText(item, "2026-11-19");

  it("includes every attribute a card shows", () => {
    for (const part of [
      "gmail",
      "ana ruiz",
      "ana@example.com",
      "q4 review",
      "thursday works",
      "scheduling",
      "meeting is soon",
      "tomorrow",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("is lower case and tolerates missing optional fields", () => {
    expect(text).toBe(text.toLowerCase());
    const bare = itemSearchText(
      { ...item, draftPreview: null, direction: null, plannedFor: null },
      "2026-11-19",
    );
    expect(bare).toContain("ana@example.com");
    expect(bare).not.toContain("null");
  });
});
