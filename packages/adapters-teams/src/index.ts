/**
 * Teams adapter — stub for P0.
 *
 * The real implementation bridges an existing Teams web client that can
 * stream inbound messages and send outbound ones. See §5 and open decision §2
 * in PLAN.md. The interface below is the contract; the transport details are
 * deferred.
 */

import type { Adapter, NewSignal, OutboundDraft, SendResult } from "@mind/core";
import { logger } from "@mind/core";

export class TeamsAdapter implements Adapter {
  readonly id = "teams";
  readonly capabilities = { canSend: false, canStream: false };

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    logger.info(
      { adapter: this.id },
      "Teams adapter started (stub — no transport configured)",
    );
    // TODO P1: Connect to the Teams web client bridge and call sink() for each
    // inbound message. The bridge URL and credentials come from
    // ~/.config/mind/teams.json (not under version control).
  }

  async stop(): Promise<void> {
    logger.info({ adapter: this.id }, "Teams adapter stopped");
  }

  // send() is intentionally absent until transport is confirmed (open decision §2).
}
