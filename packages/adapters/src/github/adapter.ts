/**
 * GitHub adapter — pull requests that are actually waiting on me.
 *
 * Read-only: GitHub is where the work happens, so `canSend` is false on
 * purpose and replies to reviewers stay in the browser. What this source adds
 * is the thing a mail-only tool cannot see — a review request is a decision
 * with a deadline, and a stalled PR is an attention cost nobody bills you for.
 *
 * Polls three searches per tick. Search needs a literal login, so the adapter
 * resolves `/user` once and substitutes it for @me.
 */

import { credentialString } from "@mind/core";
import { logger } from "@mind/core";
import type { Adapter, NewSignal } from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { GitHubClient } from "./client.js";
import type { PullRequestReason } from "./mapper.js";
import { externalIdFor, repoFromApiUrl, toSignal } from "./mapper.js";

const DEFAULT_POLL_MS = 5 * 60 * 1000;

export function githubQueries(
  login: string,
): Array<{ query: string; reason: PullRequestReason }> {
  return [
    { query: `is:pr is:open review-requested:${login}`, reason: "review_requested" },
    { query: `is:pr is:open assignee:${login}`, reason: "assigned" },
    {
      query: `is:pr is:open author:${login} review:changes_requested`,
      reason: "changes_requested",
    },
  ];
}

export class GitHubAdapter implements Adapter {
  readonly id = "github";
  readonly capabilities = { canSend: false, canStream: false };
  private timer: NodeJS.Timeout | undefined;
  private readonly emitted = new Set<string>();
  private login: string | null = null;

  constructor(
    private readonly token:
      | string
      | undefined = credentialString("github", "token", "GITHUB_TOKEN") ??
      credentialString("github", "token", "MIND_GITHUB_TOKEN"),
    private readonly pollMs = pollInterval(),
  ) {}

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    if (!this.token) {
      logger.info(
        { adapter: this.id },
        "github: no token, adapter idle (set github.token in credentials.yml)",
      );
      return;
    }

    const client = new GitHubClient(this.token);

    const poll = async (): Promise<void> => {
      try {
        this.login ??= (await client.whoami()).login;
        for (const { query, reason } of githubQueries(this.login)) {
          for (const pr of await client.searchPullRequests(query)) {
            const externalId = externalIdFor(
              pr,
              repoFromApiUrl(pr.repository_url),
              reason,
            );
            if (this.emitted.has(externalId)) continue;
            this.emitted.add(externalId);
            sink(toSignal(pr, reason, this.login));
          }
        }
      } catch (err) {
        if (isNotConfigured(err)) return;
        logger.warn(
          { adapter: this.id, err: String(err) },
          "github: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info({ adapter: this.id, login: this.login }, "github adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function pollInterval(): number {
  const raw = Number(process.env["MIND_GITHUB_POLL_MS"]);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_POLL_MS;
}
