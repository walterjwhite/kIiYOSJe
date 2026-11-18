/**
 * Gmail adapter.
 *
 * Read: polls unread mail from the last day and hands each message to the
 * pipeline. Write: sends an approved reply. Both directions are declared in
 * capabilities, and the pipeline still applies the Direction and kill-switch
 * gates before `send` is ever called.
 */

import { operatorAddresses } from "@mind/core";
import { logger } from "@mind/core";
import type {
  Adapter,
  NewSignal,
  OutboundDraft,
  SendResult,
} from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { googleAccessToken } from "../google/auth.js";
import { GmailClient } from "./client.js";
import { toSignal } from "./mapper.js";

const DEFAULT_POLL_MS = 60_000;
const QUERY = "is:unread newer_than:1d";

export class GmailAdapter implements Adapter {
  readonly id = "gmail";
  readonly capabilities = { canSend: true, canStream: false };
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: GmailClient = new GmailClient(
      () => googleAccessToken(),
      undefined,
      operatorAddresses()[0] ?? "",
    ),
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    const poll = async (): Promise<void> => {
      try {
        for (const id of await this.client.listMessageIds(QUERY)) {
          sink(toSignal(await this.client.getMessage(id), ""));
        }
      } catch (err) {
        if (isNotConfigured(err)) {
          logger.info(
            { adapter: this.id },
            "gmail: no credentials, adapter idle",
          );
          return;
        }
        logger.warn(
          { adapter: this.id, err: String(err) },
          "gmail: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info({ adapter: this.id }, "gmail adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  send(draft: OutboundDraft): Promise<SendResult> {
    return this.client.send(draft);
  }
}
