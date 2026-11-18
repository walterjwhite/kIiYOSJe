import { describe, expect, it } from "vitest";
import type { GitHubPullRequest } from "./client.js";
import { externalIdFor, repoFromApiUrl, toSignal } from "./mapper.js";

function pr(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 42,
    title: "Add commitment supersession",
    body: "Replaces the old date reminder.\n\n- one\n- two",
    html_url: "https://github.com/acme/mind/pull/42",
    state: "open",
    created_at: "2026-11-16T10:00:00.000Z",
    updated_at: "2026-11-17T10:00:00.000Z",
    repository_url: "https://api.github.com/repos/acme/mind",
    user: { login: "octocat" },
    labels: [{ name: "attention" }, { name: "backend" }],
    ...overrides,
  };
}

describe("github mapper", () => {
  it("extracts owner/name from the API repository URL", () => {
    expect(repoFromApiUrl("https://api.github.com/repos/acme/mind")).toBe("acme/mind");
  });

  it("builds a stable external id per pull request and reason", () => {
    expect(externalIdFor(pr(), "acme/mind", "review_requested")).toBe(
      "pr:acme/mind#42:review_requested",
    );
    expect(externalIdFor(pr(), "acme/mind", "review_requested")).toBe(
      externalIdFor(pr(), "acme/mind", "review_requested"),
    );
  });

  it("maps a review request into a signal the matcher can see", () => {
    const signal = toSignal(pr(), "review_requested", "me");

    expect(signal.adapter).toBe("github");
    expect(signal.kind).toBe("pull_request");
    expect(signal.threadId).toBe("acme/mind#42");
    expect(signal.sender).toBe("octocat");
    expect(signal.subject).toBe("Add commitment supersession");
    expect(signal.receivedAt).toEqual(new Date("2026-11-17T10:00:00.000Z"));
    // The reason line is what a topic Direction matches on.
    expect(signal.body).toContain("Reason: review requested");
    expect(signal.body).toContain("Repository: acme/mind");
    expect(signal.body).toContain("Labels: attention, backend");
  });

  it("separates the three reasons so they are not collapsed into one signal", () => {
    const review = toSignal(pr(), "review_requested", "me");
    const assigned = toSignal(pr(), "assigned", "me");
    const changes = toSignal(pr(), "changes_requested", "me");

    expect(new Set([review.externalId, assigned.externalId, changes.externalId]).size).toBe(3);
    expect(changes.urgencyHint).toBe(0.7);
    expect(review.urgencyHint).toBeNull();
  });

  it("truncates a very long PR body and tolerates a missing author", () => {
    const signal = toSignal(
      pr({ body: "x".repeat(5000), user: null, labels: [] }),
      "assigned",
      "",
    );

    expect(signal.body.length).toBeLessThan(1600);
    expect(signal.sender).toBe("github");
    expect(signal.recipients).toEqual([]);
  });
});
