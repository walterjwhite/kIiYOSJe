/**
 * GitHub adapter — pull requests that are actually waiting on me.
 *
 * Read-only: GitHub is where the work happens, so `canSend` is false on
 * purpose and replies to reviewers stay in the browser. What this source adds
 * is the thing a mail-only tool cannot see — a review request is a decision
 * with a deadline, and a stalled PR is an attention cost nobody bills you for.
 *
 * One instance per configured token/account: a work and a personal GitHub
 * login can both be in the ledger without one hiding the other.
 *
 * Polls three searches per tick. Search needs a literal login, so the adapter
 * resolves `/user` once and substitutes it for @me.
 */

import {
  accountCredential,
  adapterIdForAccount,
  credentialAccounts,
  credentialString,
} from "@mind/core";
import { logger } from "@mind/core";
import type { Adapter, NewSignal } from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { GitHubClient } from "./client.js";
import type { PullRequestReason } from "./mapper.js";
import { externalIdFor, repoFromApiUrl, toSignal } from "./mapper.js";

const DEFAULT_POLL_MS = 5 * 60 * 1000;

export function githubQueries(login: string): Array<{ query: string; reason: PullRequestReason }> {
  return [
    { query: `is:pr is:open review-requested:${login}`, reason: "review_requested" },
    { query: `is:pr is:open assignee:${login}`, reason: "assigned" },
    {
      query: `is:pr is:open author:${login} review:changes_requested`,
      reason: "changes_requested",
    },
  ];
}

function configuredToken(): string | undefined {
  return (
    credentialString("github", "token", "GITHUB_TOKEN") ??
    credentialString("github", "token", "MIND_GITHUB_TOKEN")
  );
}

export class GitHubAdapter implements Adapter {
  readonly id: string;
  readonly account: string;
  readonly capabilities = { canSend: false, canStream: false };
  private readonly token: string | undefined;
  private readonly pollMs: number;
  private timer: NodeJS.Timeout | undefined;
  private readonly emitted = new Set<string>();
  private login: string | null = null;

  constructor(
    token: string | undefined = configuredToken(),
    pollMs = pollInterval(),
    account = "default",
  ) {
    this.account = account;
    this.id = adapterIdForAccount("github", account);
    this.token = token;
    this.pollMs = pollMs;
  }

  /** One adapter per configured GitHub account; one idle adapter if none. */
  static allFromConfig(): GitHubAdapter[] {
    const accounts = credentialAccounts("github")
      .map((account) => ({
        label: account.label,
        token: accountCredential(account, "token", "GITHUB_TOKEN"),
      }))
      .filter((account): account is { label: string; token: string } => Boolean(account.token));

    if (accounts.length === 0) return [new GitHubAdapter()];
    return accounts.map(
      (account) => new GitHubAdapter(account.token, pollInterval(), account.label),
    );
  }

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    if (!this.token) {
      logger.info(
        { adapter: this.id, account: this.account },
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
            const externalId = externalIdFor(pr, repoFromApiUrl(pr.repository_url), reason);
            if (this.emitted.has(externalId)) continue;
            this.emitted.add(externalId);
            sink(toSignal(pr, reason, this.login, this.account));
          }
        }
      } catch (err) {
        if (isNotConfigured(err)) return;
        logger.warn(
          { adapter: this.id, account: this.account, err: String(err) },
          "github: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info(
      { adapter: this.id, account: this.account, login: this.login },
      "github adapter started",
    );
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
