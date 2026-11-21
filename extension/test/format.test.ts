import { describe, expect, it } from "vitest";
import { ago, channelLabel, timingLabel } from "../src/format.js";

describe("channelLabel", () => {
  it("does not repeat the account when the adapter id already has it", () => {
    expect(channelLabel("gmail:75a788d4", "75a788d4")).toBe("gmail:75a788d4");
  });
  it("appends the account to a plain adapter id", () => {
    expect(channelLabel("gmail", "work")).toBe("gmail:work");
  });
  it("shows just the adapter when there is no account", () => {
    expect(channelLabel("github", null)).toBe("github");
    expect(channelLabel("github", "")).toBe("github");
  });
  it("does not treat a suffix of a longer account as a match", () => {
    expect(channelLabel("gmail:mywork", "work")).toBe("gmail:mywork:work");
  });
});

describe("ago", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  it.each([
    ["2026-11-14T11:59:40Z", "just now"],
    ["2026-11-14T11:30:00Z", "30 min ago"],
    ["2026-11-14T09:00:00Z", "3 h ago"],
    ["2026-11-10T12:00:00Z", "4 d ago"],
  ])("%s -> %s", (iso, expected) => expect(ago(iso, now)).toBe(expected));
});

describe("timingLabel", () => {
  it("names the bucket alone when there is no deadline", () => {
    expect(timingLabel("can-wait", null)).toBe("Can wait");
  });
  it("adds the deadline when there is one", () => {
    expect(timingLabel("now", "2026-11-14T15:00:00Z")).toMatch(/^Now · by /);
  });
});
