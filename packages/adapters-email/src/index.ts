/**
 * Email adapter — stub for P0.
 *
 * Full implementation is P3: IMAP polling for read, save-to-Drafts for write.
 * See §5 and open decision §3 in PLAN.md.
 * Credentials come from ~/.config/mind/email.json (not under version control).
 */

import type { Adapter, NewSignal, OutboundDraft, SendResult } from "@mind/core";
import { logger } from "@mind/core";

export class EmailAdapter implements Adapter {
  readonly id = "email";
  readonly capabilities = { canSend: false, canStream: false };

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    logger.info(
      { adapter: this.id },
      "Email adapter started (stub — IMAP not configured)",
    );
    // TODO P3: Open IMAP connection, poll for new messages, call sink().
    // Write capability (save-to-Drafts) added after confirming email write
    // permission — open decision §3.
  }

  async stop(): Promise<void> {
    logger.info({ adapter: this.id }, "Email adapter stopped");
  }
}
