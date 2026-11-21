import { describe, expect, it } from "vitest";
import { chooseLink } from "./link.js";

const goals = [
  { id: "g1", title: "Ship the Q4 report", body: "" },
  { id: "g2", title: "Hire a designer", body: "" },
];

describe("chooseLink", () => {
  it("links a known goal at or above the threshold", () => {
    expect(chooseLink({ thoughtId: "g1", confidence: 0.8 }, goals, 0.8)).toEqual({
      thoughtId: "g1",
      confidence: 0.8,
    });
  });
  it("does not link below the threshold", () => {
    expect(chooseLink({ thoughtId: "g1", confidence: 0.79 }, goals, 0.8)).toBeNull();
  });
  it("does not link an id the model invented", () => {
    expect(chooseLink({ thoughtId: "nope", confidence: 0.99 }, goals, 0.8)).toBeNull();
  });
  it("does not link when the model says none fit, or gave no answer", () => {
    expect(chooseLink({ thoughtId: null, confidence: 0.99 }, goals, 0.8)).toBeNull();
    expect(chooseLink(null, goals, 0.8)).toBeNull();
  });
});
