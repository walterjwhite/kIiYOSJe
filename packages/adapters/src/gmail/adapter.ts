/**
 * Gmail adapter — one instance per Google account.
 *
 * Read: polls unread mail from the last day and hands each message to the
 * pipeline. Write: sends an approved reply from the mailbox that received it.
 * The adapter id is `gmail` for the default account and `gmail:<label>` for a
 * named one, so the registry, the Review queue, and `actions.adapter` all
 * resolve a reply to the right mailbox.
 */

import { adapterIdForAccount, accountAddress, credentialAccounts } from "@mind/core";
import { logger, operatorAddresses } from "@mind/core";
import type { Adapter, NewSignal, OutboundDraft, SendResult } from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { googleAccessTokenFor, googleAccountLabels } from "../google/auth.js";
import { GmailClient } from "./client.js";
import { toSignal } from "./mapper.js";

const DEFAULT_POLL_MS = 60_000;
const QUERY = "is:unread newer_than:1d";

/** The address to send from: the account's own, else the first configured one. */
function selfAddressFor(account: string): string {
  const configured = credentialAccounts("google").find((entry) => entry.label === account);
  const own = configured ? accountAddress(configured) : undefined;
  return own ?? (account === "default" ? (operatorAddresses()[0] ?? "") : "");
}

export class GmailAdapter implements Adapter {
  readonly id: string;
  readonly account: string;
  readonly capabilities = { canSend: true, canStream: false };
  private readonly client: GmailClient;
  private readonly pollMs: number;
  private readonly selfAddress: string;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    client?: GmailClient,
    pollMs = DEFAULT_POLL_MS,
    account = "default",
    selfAddress = selfAddressFor(account),
  ) {
    this.account = account;
    this.id = adapterIdForAccount("gmail", account);
    this.pollMs = pollMs;
    this.selfAddress = selfAddress;
    this.client =
      client ?? new GmailClient(() => googleAccessTokenFor(account), undefined, selfAddress);
  }

  /** One adapter per configured Google account; one idle adapter if none. */
  static allFromConfig(): GmailAdapter[] {
    const labels = googleAccountLabels();
    if (labels.length === 0) return [new GmailAdapter()];
    return labels.map((label) => new GmailAdapter(undefined, DEFAULT_POLL_MS, label));
  }

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    const poll = async (): Promise<void> => {
      try {
        for (const id of await this.client.listMessageIds(QUERY)) {
          sink(toSignal(await this.client.getMessage(id), this.selfAddress, this.account));
        }
      } catch (err) {
        if (isNotConfigured(err)) {
          logger.info(
            { adapter: this.id, account: this.account },
            "gmail: no credentials, adapter idle",
          );
          return;
        }
        logger.warn(
          { adapter: this.id, account: this.account, err: String(err) },
          "gmail: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info({ adapter: this.id, account: this.account }, "gmail adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  send(draft: OutboundDraft): Promise<SendResult> {
    return this.client.send(draft);
  }
}
