/**
 * Outlook adapter — polls unread mail through Microsoft Graph and sends
 * approved replies back through the same backend.
 *
 * The Outlook Web transport is monorepo-only: it depends on
 * `@walterjwhite/lib`, which is not published. See ./backend.ts.
 */

import { logger } from "@mind/core";
import type {
  Adapter,
  NewSignal,
  OutboundDraft,
  SendResult,
} from "@mind/core";
import { isNotConfigured } from "../errors.js";
import { outlookBackend } from "./backend.js";
import { GraphMailSource } from "./graph.js";
import { toSignal } from "./mapper.js";
import type { OutlookMailSource } from "./source.js";

const DEFAULT_POLL_MS = 60_000;

/** Graph only in this tree; `outlookBackend()` rejects anything else. */
export function createOutlookSource(): OutlookMailSource {
  outlookBackend();
  return new GraphMailSource();
}

export class OutlookAdapter implements Adapter {
  readonly id = "outlook";
  readonly capabilities = { canSend: true, canStream: false };
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: OutlookMailSource = createOutlookSource(),
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    await this.poll(sink);
    this.timer = setInterval(() => void this.poll(sink), this.pollMs);
    logger.info(
      { adapter: this.id, backend: this.source.backend },
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
        sink(toSignal(mail));
      }
    } catch (err) {
      if (isNotConfigured(err)) {
        logger.info(
          { adapter: this.id, backend: this.source.backend },
          "outlook: no credentials, adapter idle",
        );
        return;
      }
      logger.warn(
        { adapter: this.id, err: String(err) },
        "outlook: poll failed",
      );
    }
  }
}
