import { describe, expect, it } from "vitest";
import { buildFlow, type FlowRow } from "../src/flow-model.js";

const row = (adapter: string, directionId: string | null, disposition: string, count: number): FlowRow => ({
  adapter, directionId, directionName: directionId ? directionId.split("/")[1]! : null, disposition, count,
});

const rows = [
  row("gmail", "work/boss", "absorbed", 6),
  row("gmail", "work/boss", "promoted", 2),
  row("gmail", "work/ci", "absorbed", 4),
  row("outlook", "work/boss", "escalated", 1),
  row("outlook", null, "filed", 3),
];

describe("buildFlow", () => {
  it("has the three columns, each summing to the total", () => {
    const g = buildFlow(rows);
    expect(g.columns.map((c) => c.title)).toEqual(["Channel", "Direction", "Outcome"]);
    expect(g.total).toBe(16);
    for (const c of g.columns) expect(c.nodes.reduce((n, x) => n + x.count, 0)).toBe(16);
  });

  it("conserves flow: every node's links in and out add up to its count", () => {
    const g = buildFlow(rows);
    const direction = g.columns[1]!.nodes.find((n) => n.id === "d:work/boss")!;
    const into = g.links.filter((l) => l.to === direction.id).reduce((n, l) => n + l.count, 0);
    const out = g.links.filter((l) => l.from === direction.id).reduce((n, l) => n + l.count, 0);
    expect([into, out]).toEqual([direction.count, direction.count]);
  });

  it("orders outcomes meaningfully and puts unmatched signals last among directions", () => {
    const g = buildFlow(rows);
    expect(g.columns[2]!.nodes.map((n) => n.id)).toEqual(["o:absorbed", "o:filed", "o:promoted", "o:escalated"]);
    expect(g.columns[1]!.nodes.at(-1)).toMatchObject({ id: "d:*none", label: "No direction", filter: null });
  });

  it("labels directions by name and gives every link the filter that selects its signals", () => {
    const g = buildFlow(rows);
    expect(g.columns[1]!.nodes.find((n) => n.id === "d:work/boss")?.label).toBe("boss");
    expect(g.links.find((l) => l.from === "c:gmail" && l.to === "d:work/boss")?.filter).toEqual({ adapter: "gmail", directionId: "work/boss" });
    expect(g.links.find((l) => l.from === "d:work/boss" && l.to === "o:promoted")?.filter).toEqual({ directionId: "work/boss", disposition: "promoted" });
    expect(g.columns[2]!.nodes[0]!.filter).toEqual({ disposition: "absorbed" });
  });

  it("folds the smallest nodes into Other, which cannot be drilled into", () => {
    const many = ["a", "b", "c", "d", "e"].map((c, i) => row(c, "work/x", "absorbed", 10 - i));
    const g = buildFlow(many, 3);
    const channels = g.columns[0]!.nodes;
    expect(channels.map((n) => n.id)).toEqual(["c:a", "c:b", "c:c", "c:*other"]);
    expect(channels.at(-1)).toMatchObject({ label: "Other channels", count: 7 + 6, filter: null });
    expect(buildFlow(many, 3).total).toBe(10 + 9 + 8 + 7 + 6);
  });

  it("handles no data and ignores empty rows", () => {
    expect(buildFlow([]).total).toBe(0);
    expect(buildFlow([row("gmail", "work/boss", "absorbed", 0)]).columns[0]!.nodes).toEqual([]);
  });
});
