/**
 * Teams adapter — read and send through the Teams Chat Service via teams-api
 * (https://github.com/Maxim-Mazurok/teams-api).
 *
 * Reading polls every conversation for messages since the last pass; sending
 * replies into the same conversation. Message ids sent by this adapter are
 * remembered and skipped, so the poll cannot ingest our own replies as signals.
 */

import { TeamsClient } from "teams-api";
import type { Conversation, Message } from "teams-api";
import { credentialString } from "@mind/core";
import { logger } from "@mind/core";
import type {
  Adapter,
  NewSignal,
  OutboundDraft,
  SendResult,
} from "@mind/core";
import { AdapterNotConfiguredError, isNotConfigured } from "../errors.js";
import { toSignal } from "./mapper.js";

const DEFAULT_POLL_MS = 60_000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export class TeamsAdapter implements Adapter {
  readonly id = "teams";
  readonly capabilities = { canSend: true, canStream: false };
  private timer: NodeJS.Timeout | undefined;
  private client: TeamsClient | null = null;
  private since = new Date(Date.now() - LOOKBACK_MS);
  private readonly sent = new Set<string>();

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    this.client = connectTeams();
    if (!this.client) {
      logger.info(
        { adapter: this.id },
        "teams: no token in credentials.yml, adapter idle",
      );
      return;
    }
    const client = this.client;

    const poll = async (): Promise<void> => {
      try {
        const since = this.since;
        for (const conversation of await client.listConversations()) {
          for (const message of await client.getMessages(conversation.id, {
            since: since.toISOString(),
          })) {
            this.emit(conversation, message, sink);
          }
        }
        this.since = new Date();
      } catch (err) {
        if (isNotConfigured(err)) return;
        logger.warn(
          { adapter: this.id, err: String(err) },
          "teams: poll failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), DEFAULT_POLL_MS);
    logger.info({ adapter: this.id }, "teams adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async send(draft: OutboundDraft): Promise<SendResult> {
    if (!this.client || !draft.threadId) {
      throw new AdapterNotConfiguredError("teams", "conversation for reply");
    }
    const sent = await this.client.sendMessage(draft.threadId, draft.body);
    this.sent.add(sent.messageId);
    return { externalId: sent.messageId };
  }

  private emit(
    conversation: Conversation,
    message: Message,
    sink: (signal: NewSignal) => void,
  ): void {
    if (this.sent.has(message.id)) return;
    const signal = toSignal(conversation, message);
    if (signal) sink(signal);
  }
}

function connectTeams(): TeamsClient | null {
  const skypeToken = credentialString(
    "teams",
    "skypeToken",
    "MIND_TEAMS_SKYPE_TOKEN",
  );
  if (!skypeToken) return null;
  return TeamsClient.fromToken(
    skypeToken,
    credentialString("teams", "region", "MIND_TEAMS_REGION") ?? "emea",
    credentialString("teams", "bearerToken", "MIND_TEAMS_BEARER_TOKEN"),
    credentialString("teams", "substrateToken", "MIND_TEAMS_SUBSTRATE_TOKEN"),
  );
}
