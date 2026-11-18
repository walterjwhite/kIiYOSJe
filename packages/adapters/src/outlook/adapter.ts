/**
 * Outlook adapter — polls unread mail through Microsoft Graph and sends
 * approved replies back through the same backend. One instance per account.
 *
 * The Outlook Web transport is monorepo-only: it depends on
 * `@walterjwhite/lib`, which is not published. See ./backend.ts.
 */

import { adapterIdForAccount } from "@mind/core";
import { logger } from "@mind/core";
import type {
  Adapter,
  NewSignal,
  OutboundDraft,
  SendResult,
} from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { outlookBackend } from "./backend.js";
import { outlookAccountLabels } from "./auth.js";
import { GraphMailSource } from "./graph.js";
import { toSignal } from "./mapper.js";
import type { OutlookMailSource } from "./source.js";

const DEFAULT_POLL_MS = 60_000;

/** Graph only in this tree; `outlookBackend()` rejects anything else. */
export function createOutlookSource(account = "default"): OutlookMailSource {
  outlookBackend();
  return GraphMailSource.forAccount(account);
}

export class OutlookAdapter implements Adapter {
  readonly id: string;
  readonly account: string;
  readonly capabilities = { canSend: true, canStream: false };
  private readonly source: OutlookMailSource;
  private readonly pollMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    source: OutlookMailSource = createOutlookSource(),
    pollMs = DEFAULT_POLL_MS,
    account = "default",
  ) {
    this.account = account;
    this.id = adapterIdForAccount("outlook", account);
    this.source = source;
    this.pollMs = pollMs;
  }

  /** One adapter per configured Outlook account; one idle adapter if none. */
  static allFromConfig(): OutlookAdapter[] {
    const labels = outlookAccountLabels();
    if (labels.length === 0) return [new OutlookAdapter()];
    return labels.map(
      (label) =>
        new OutlookAdapter(
          createOutlookSource(label),
          DEFAULT_POLL_MS,
          label,
        ),
    );
  }

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    await this.poll(sink);
    this.timer = setInterval(() => void this.poll(sink), this.pollMs);
    logger.info(
      { adapter: this.id, account: this.account, backend: this.source.backend },
      "outlook adapter started",
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  send(draft: OutboundDraft): Promise<SendResult> {
    return this.source.send(draft);
  }

  private async poll(sink: (signal: NewSignal) => void): Promise<void> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const mail of await this.source.listUnread(since)) {
        sink(toSignal(mail, this.account));
      }
    } catch (err) {
      if (isNotConfigured(err)) {
        logger.info(
          { adapter: this.id, account: this.account, backend: this.source.backend },
          "outlook: no credentials, adapter idle",
        );
        return;
      }
      logger.warn(
        { adapter: this.id, account: this.account, err: String(err) },
        "outlook: poll failed",
      );
    }
  }
}
