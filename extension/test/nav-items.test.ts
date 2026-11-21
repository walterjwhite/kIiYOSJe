import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navChildren, navTopLevel } from "../src/nav-items.js";

describe("nav structure", () => {
  it("keeps the operator's path first and the machine's screens behind a group", () => {
    const ids = navTopLevel().map((row) => (row.kind === "item" ? row.item.id : row.group.id));
    expect(ids).toEqual([
      "queue",
      "signals",
      "directions",
      "learnings",
      "analytics",
      "journal",
      "developer",
      "devices",
      "settings",
    ]);
  });

  it("puts System Events and Model Trace under Developer, not on the default path", () => {
    expect(navChildren("developer").map((i) => i.id)).toEqual(["systemEvents", "modelTrace"]);
    const topLevel = navTopLevel().filter((row) => row.kind === "item");
    expect(topLevel.map((row) => (row.kind === "item" ? row.item.id : ""))).not.toContain(
      "modelTrace",
    );
  });

  it("gives every item one command, and no group is empty", () => {
    const commands = NAV_ITEMS.map((i) => i.command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands.every((c) => c.startsWith("mind."))).toBe(true);
    for (const group of navTopLevel()) {
      if (group.kind === "group") expect(navChildren(group.group.id).length).toBeGreaterThan(0);
    }
  });

  it("describes Analytics by what it measures, not by time saved", () => {
    const analytics = NAV_ITEMS.find((i) => i.id === "analytics");
    expect(analytics?.description).toBe("absorb rate against Directions");
    expect(JSON.stringify(NAV_ITEMS)).not.toContain("time saved");
  });
});
