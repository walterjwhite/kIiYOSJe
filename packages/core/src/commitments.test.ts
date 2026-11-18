import { describe, expect, it } from "vitest";
import {
  isOpenCommitment,
  newCommitment,
  parseCommitment,
  sameCommitmentText,
  serializeCommitment,
  settleCommitment,
  supersedeCommitment,
  verifyCommitment,
} from "./commitments.js";

const AT = "2026-11-18T09:00:00.000Z";

function committed(text = "send the migration plan", dueDate = "2026-11-20T17:00:00.000Z") {
  return newCommitment({
    text,
    dueDate,
    confidence: 0.8,
    sourceSignalId: "signal-1",
    at: AT,
  });
}

describe("commitments", () => {
  it("starts proposed and open", () => {
    const c = committed();
    expect(c.status).toBe("proposed");
    expect(isOpenCommitment(c)).toBe(true);
    expect(c.previousStates).toEqual([]);
  });

  it("verify keeps the value and moves lastVerifiedAt only", () => {
    const c = verifyCommitment(committed(), "2026-11-19T09:00:00.000Z");
    expect(c.text).toBe("send the migration plan");
    expect(c.lastVerifiedAt).toBe("2026-11-19T09:00:00.000Z");
    expect(c.previousStates).toEqual([]);
  });

  it("supersede replaces the date and appends the old state", () => {
    const previous = committed();
    const next = newCommitment({
      text: "send the migration plan",
      dueDate: "2026-11-25T17:00:00.000Z",
      confidence: 0.9,
      sourceSignalId: "signal-2",
      at: "2026-11-19T10:00:00.000Z",
    });

    const merged = supersedeCommitment(previous, next, "2026-11-19T10:00:00.000Z");

    expect(merged.dueDate).toBe("2026-11-25T17:00:00.000Z");
    expect(merged.status).toBe("changed");
    expect(merged.supersededBy).toBe("signal-2");
    expect(merged.previousStates).toHaveLength(1);
    expect(merged.previousStates[0]).toMatchObject({
      status: "proposed",
      dueDate: previous.dueDate,
      text: previous.text,
    });
  });

  it("superseding twice keeps the whole chain", () => {
    const first = committed();
    const second = newCommitment({
      text: "send the migration plan",
      dueDate: "2026-11-25T17:00:00.000Z",
      confidence: 0.9,
      sourceSignalId: "signal-2",
      at: "2026-11-19T10:00:00.000Z",
    });
    const third = newCommitment({
      text: "send the migration plan",
      dueDate: "2026-12-01T17:00:00.000Z",
      confidence: 0.95,
      sourceSignalId: "signal-3",
      at: "2026-11-21T10:00:00.000Z",
    });

    const merged = supersedeCommitment(
      supersedeCommitment(first, second, "2026-11-19T10:00:00.000Z"),
      third,
      "2026-11-21T10:00:00.000Z",
    );

    expect(merged.supersededBy).toBe("signal-3");
    expect(merged.dueDate).toBe("2026-12-01T17:00:00.000Z");
    expect(merged.previousStates.map((s) => s.dueDate)).toEqual([
      "2026-11-20T17:00:00.000Z",
      "2026-11-25T17:00:00.000Z",
    ]);
  });

  it("settling closes it and is no longer open", () => {
    const done = settleCommitment(committed(), "done", "2026-11-20T18:00:00.000Z");
    expect(done.status).toBe("done");
    expect(isOpenCommitment(done)).toBe(false);
    expect(done.previousStates).toHaveLength(1);
  });

  it("sameCommitmentText ignores case and punctuation but not wording", () => {
    expect(sameCommitmentText("Send the plan, Friday.", "send the plan friday")).toBe(true);
    expect(sameCommitmentText("Send the plan", "Send the revised plan")).toBe(false);
  });

  it("round-trips through the JSON column", () => {
    const c = committed();
    expect(parseCommitment(serializeCommitment(c))).toEqual(c);
    expect(parseCommitment(null)).toBeNull();
    expect(parseCommitment("not json")).toBeNull();
    expect(parseCommitment(JSON.stringify({ text: 1 }))).toBeNull();
  });
});
