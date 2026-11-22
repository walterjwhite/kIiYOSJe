import { describe, expect, it } from "vitest";
import { ago, channelLabel, duration, timingLabel } from "../src/format.js";

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

describe("duration", () => {
  it("uses ms under a second, seconds under a minute, then minutes", () => {
    expect(duration(850)).toBe("850 ms");
    expect(duration(4200)).toBe("4.2 s");
    expect(duration(59_900)).toBe("59.9 s");
    expect(duration(60_000)).toBe("1 min");
    expect(duration(125_000)).toBe("2 min 5 s");
    expect(duration(3_600_000 + 120_000)).toBe("1 h 2 min");
  });
  it("rounds sub-second noise and rejects bad input", () => {
    expect(duration(0)).toBe("0 ms");
    expect(duration(-5)).toBe("");
    expect(duration(Number.NaN)).toBe("");
  });
});
