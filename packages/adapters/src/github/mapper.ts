/**
 * Pull request → Signal mapping.
 *
 * A PR enters attention in one of three shapes. They are distinct signals
 * because they need different decisions: review it, deliver on it, or answer a
 * reviewer. The external id is stable per (PR, reason) so a poll loop cannot
 * re-signal the same PR — the pipeline's dedupe key would drop it anyway, but
 * not creating it in the first place keeps the logs and the volume honest.
 */

import type { NewSignal } from "@mind/core";
import { adapterIdForAccount } from "@mind/core";
import type { GitHubPullRequest } from "./client.js";

export type PullRequestReason = "review_requested" | "assigned" | "changes_requested";

export const REASON_LABEL: Record<PullRequestReason, string> = {
  review_requested: "review requested",
  assigned: "assigned to you",
  changes_requested: "changes requested on your PR",
};

const BODY_EXCERPT = 1200;

export function repoFromApiUrl(repositoryUrl: string): string {
  const marker = "/repos/";
  const at = repositoryUrl.indexOf(marker);
  return at === -1 ? repositoryUrl : repositoryUrl.slice(at + marker.length);
}

export function externalIdFor(
  pr: Pick<GitHubPullRequest, "number">,
  repo: string,
  reason: PullRequestReason,
): string {
  return `pr:${repo}#${pr.number}:${reason}`;
}

export function toSignal(
  pr: GitHubPullRequest,
  reason: PullRequestReason,
  self: string,
  account = "default",
): NewSignal {
  const repo = repoFromApiUrl(pr.repository_url);
  const labels = pr.labels.map((label) => label.name).filter(Boolean);
  const author = pr.user?.login ?? "github";
  const body = (pr.body ?? "").slice(0, BODY_EXCERPT);

  return {
    adapter: adapterIdForAccount("github", account),
    account,
    externalId: externalIdFor(pr, repo, reason),
    threadId: `${repo}#${pr.number}`,
    sender: author,
    recipients: self ? [self] : [],
    kind: "pull_request",
    subject: pr.title,
    body: [
      `Pull request: ${pr.title}`,
      `Repository: ${repo}`,
      `URL: ${pr.html_url}`,
      `Reason: ${REASON_LABEL[reason]}`,
      `Author: ${author}`,
      ...(pr.draft ? ["Status: draft"] : []),
      ...(labels.length > 0 ? [`Labels: ${labels.join(", ")}`] : []),
      `Updated: ${pr.updated_at}`,
      "",
      body,
    ].join("\n"),
    receivedAt: new Date(pr.updated_at),
    urgencyHint: reason === "changes_requested" ? 0.7 : null,
  };
}
