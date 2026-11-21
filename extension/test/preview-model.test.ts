import { describe, expect, it } from "vitest";
import { buildPreview, type PreviewResult, type PreviewSample } from "../src/preview-model.js";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const SINCE = "2026-10-22T12:00:00.000Z";

const sample = (over: Partial<PreviewSample> = {}): PreviewSample => ({
  signalId: "s1",
  receivedAt: "2026-11-20T09:00:00.000Z",
  adapter: "gmail",
  sender: "boss@example.com",
  kind: "email",
  disposition: "promoted",
  matchedDirectionId: "work/boss",
  matchedByFallback: false,
  wouldMatch: true,
  guardTriggered: false,
  ...over,
});

const result = (over: Partial<PreviewResult> = {}): PreviewResult => ({
  directionId: "work/boss",
  name: "boss",
  sampleWindow: { since: SINCE, limit: 50 },
  sampled: 4,
  wouldMatch: 2,
  matchedByFallback: 1,
  guardsTriggered: 1,
  samples: [
    sample(),
    sample({
      signalId: "s2",
      wouldMatch: false,
      matchedDirectionId: "system/catch-all",
      matchedByFallback: true,
    }),
    sample({ signalId: "s3", wouldMatch: false, matchedDirectionId: "work/ci" }),
    sample({ signalId: "s4", wouldMatch: false, matchedDirectionId: null }),
  ],
  ...over,
});

describe("buildPreview", () => {
  it("reports all three numbers the author needs, not just matches", () => {
    const view = buildPreview(result(), NOW);
    expect(view.summary).toBe(
      "2 of 4 sampled signals would match. 1 would trip a guard. 1 fell through to the catch-all.",
    );
    expect(view.hasMatches).toBe(true);
  });

  it("says plainly what it sampled and that the model was not called", () => {
    const view = buildPreview(result({ sampled: 0, wouldMatch: 0, samples: [] }), NOW);
    expect(view.summary).toBe("No stored signals in the sample window.");
    expect(view.caption).toBe(
      "Samples up to 50 stored signals from the past 30 days. Nothing is written except one direction.previewed event. The model is not called for this preview.",
    );
    expect(view.hasMatches).toBe(false);
  });

  it("flags catch-all, guards and model verdicts per row", () => {
    const view = buildPreview(
      result({
        classification: [
          {
            signalId: "s1",
            confidence: 0.41,
            signalKind: "question",
            answerable: false,
            answerBlocker: "needs an OTP",
            wouldEscalate: true,
            wouldDispute: true,
          },
        ],
      }),
      NOW,
    );
    expect(view.rows[0]).toMatchObject({
      signalId: "s1",
      day: "2026-11-20",
      matched: "work/boss",
      wouldMatch: true,
      confidence: 0.41,
      flags: ["below confidence", "may need you", "no answer: needs an OTP"],
    });
    expect(view.rows[1]?.flags).toEqual(["fell through to catch-all"]);
    expect(view.rows[3]?.matched).toBe("nothing");
    expect(view.caption).toContain("1 match classified with the model (capped at 10).");
  });

  it("keeps a guard visible even when the sample matches", () => {
    const view = buildPreview(result({ samples: [sample({ guardTriggered: true })] }), NOW);
    expect(view.rows[0]?.flags).toEqual(["guard tripped"]);
  });
});
