import { describe, expect, it } from "vitest";
import { type LinkEvent, linkCorrections } from "./link-quality.js";

let t = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)).toISOString();
const auto = (signalId: string, thoughtId: string, promptVersion = 2): LinkEvent => ({
  at: at(),
  actor: "system",
  kind: "signal.thought_linked",
  payload: JSON.stringify({ signalId, thoughtId, auto: true, promptVersion }),
});
const manual = (signalId: string, thoughtId: string): LinkEvent => ({
  at: at(),
  actor: "user",
  kind: "signal.thought_linked",
  payload: JSON.stringify({ signalId, thoughtId }),
});
const unlink = (signalId: string): LinkEvent => ({
  at: at(),
  actor: "user",
  kind: "signal.thought_unlinked",
  payload: JSON.stringify({ signalId }),
});

describe("linkCorrections", () => {
  it("counts an automatic link as corrected when it is later unlinked or moved by hand", () => {
    const r = linkCorrections([
      auto("a", "g1"),
      auto("b", "g1"),
      auto("c", "g1"),
      auto("d", "g1"),
      unlink("a"),
      manual("b", "g2"),
      manual("c", "g1"), // confirmed: same goal
    ]);
    expect(r.autoLinks).toBe(4);
    expect(r.corrected).toBe(2);
    expect(r.rate).toBe(0.5);
  });

  it("only looks forward: a manual link before the automatic one is not a correction", () => {
    const r = linkCorrections([manual("a", "g2"), auto("a", "g1")]);
    expect(r).toMatchObject({ autoLinks: 1, corrected: 0 });
  });

  it("splits the result by prompt version, with 1 for links recorded before versions existed", () => {
    const old = auto("x", "g1");
    const legacy = {
      ...old,
      payload: JSON.stringify({ signalId: "x", thoughtId: "g1", auto: true }),
    };
    const r = linkCorrections([legacy, auto("y", "g1", 2), unlink("y")]);
    expect(r.byPromptVersion).toEqual({
      "1": { autoLinks: 1, corrected: 0 },
      "2": { autoLinks: 1, corrected: 1 },
    });
  });

  it("reports no rate when there were no automatic links, and ignores bad payloads", () => {
    expect(linkCorrections([]).rate).toBeNull();
    const bad: LinkEvent = {
      at: at(),
      actor: "system",
      kind: "signal.thought_linked",
      payload: "{",
    };
    expect(linkCorrections([bad]).autoLinks).toBe(0);
  });
});
