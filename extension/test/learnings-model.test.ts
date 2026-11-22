import { describe, expect, it } from "vitest";
import type { ProposalView } from "../src/learnings-model.js";
import { describeProposal, describeSchedule } from "../src/learnings-model.js";

const base: ProposalView = {
  kind: "narrow",
  directionId: "work/boss",
  field: "confidenceMin",
  currentValue: 0.7,
  proposedValue: 0.75,
  rationale: "raw",
  evidence: { total: 10, discarded: 4, sent: 6, overrideRate: 0.4 },
};

describe("describeProposal", () => {
  it("explains a narrow proposal with percentages and counts", () => {
    const t = describeProposal(base);
    expect(t.headline).toBe('Be pickier about "work/boss"');
    expect(t.change).toContain("70% → 75%");
    expect(t.why).toContain("discarded 4 of its 10 decisions");
    expect(t.why).toContain("40%");
    expect(t.effect).toContain("directions/work/boss.yaml");
  });

  it("explains lowering the confidence bar", () => {
    const t = describeProposal({
      ...base,
      kind: "widen",
      currentValue: 0.7,
      proposedValue: 0.65,
      evidence: { total: 20, discarded: 1, sent: 15, overrideRate: 0.05 },
    });
    expect(t.headline).toBe('Be less picky about "work/boss"');
    expect(t.change).toContain("70% → 65%");
  });

  it("explains an autonomy step and reminds that send gates still apply", () => {
    const draft = describeProposal({
      ...base,
      kind: "widen",
      field: "autonomy",
      currentValue: "observe",
      proposedValue: "draft",
    });
    expect(draft.headline).toBe('Start drafting replies for "work/boss"');
    expect(draft.change).toContain("observe (only records what it would do)");

    const send = describeProposal({
      ...base,
      kind: "widen",
      field: "autonomy",
      currentValue: "draft",
      proposedValue: "send",
    });
    expect(send.headline).toBe('Allow "work/boss" to send');
    expect(send.change).toContain("MIND_SEND_ENABLED=true");
  });

  it("explains a new Direction without technical field names", () => {
    const t = describeProposal({
      kind: "new",
      directionId: null,
      field: "scope.value",
      currentValue: null,
      proposedValue: "news@example.com",
      rationale: "raw",
      evidence: { total: 3, discarded: 0, sent: 0, overrideRate: 0 },
    });
    expect(t.headline).toBe("Add a Direction for news@example.com");
    expect(t.why).toContain("3 messages");
    expect(t.why).not.toContain("scope.value");
    expect(t.effect).toContain("Nothing is created for you");
  });

  it("uses singular nouns for a count of one", () => {
    const t = describeProposal({ ...base, evidence: { ...base.evidence, total: 1, discarded: 1 } });
    expect(t.why).toContain("1 decision ");
  });
});

describe("describeSchedule", () => {
  const fmt = (iso: string) => `at ${iso}`;
  const window = { windowStart: "00:00", windowEnd: "04:00" };

  it("states the window and that it has not run", () => {
    const s = describeSchedule({ window, lastRun: null }, fmt);
    expect(s).toContain("between 00:00 and 04:00");
    expect(s).toContain("It has not run yet.");
  });

  it("states the last run and who started it", () => {
    const s = describeSchedule(
      { window, lastRun: { at: "T", trigger: "schedule", proposalCount: 1 } },
      fmt,
    );
    expect(s).toContain("Last run: at T, overnight, 1 new suggestion.");
    expect(
      describeSchedule({ window, lastRun: { at: "T", trigger: "manual", proposalCount: 0 } }, fmt),
    ).toContain("by you, 0 new suggestions");
  });
});
