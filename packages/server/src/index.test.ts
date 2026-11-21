import { describe, expect, it } from "vitest";
import { liveAdaptersAllowed } from "./index.js";

describe("liveAdaptersAllowed", () => {
  it("refuses live adapters when MIND_ADAPTERS is none", () => {
    expect(liveAdaptersAllowed({ MIND_ADAPTERS: "none" })).toBe(false);
  });

  it("refuses live adapters when the database is demo.db, even without the flag", () => {
    expect(liveAdaptersAllowed({ MIND_DB_PATH: "/home/op/.data/kIiYOSJe/mind/demo.db" })).toBe(
      false,
    );
  });

  it("allows live adapters for the real database", () => {
    expect(liveAdaptersAllowed({ MIND_DB_PATH: "/home/op/.data/kIiYOSJe/mind/mind.db" })).toBe(
      true,
    );
  });
});
