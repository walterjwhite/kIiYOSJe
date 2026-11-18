/**
 * SMS adapter backed by mautrix-gmessages.
 *
 * Polls the Matrix sync endpoint, keeps only rooms that belong to the Google
 * Messages bridge, and hands inbound texts to the pipeline. Sending uses the
 * same room, so an approved reply is delivered as SMS through the bridge.
 */

import { credentialString } from "@mind/core";
import { logger } from "@mind/core";
import type {
  Adapter,
  NewSignal,
  OutboundDraft,
  SendResult,
} from "@mind/core";
import { AdapterNotConfiguredError, isNotConfigured } from "../errors.js";
import { isGoogleMessagesRoom, isTextMessage, toSignal } from "./mapping.js";
import { MatrixClient } from "./protocol.js";

const DEFAULT_POLL_MS = 15_000;

export class GmessagesAdapter implements Adapter {
  readonly id = "gmessages";
  readonly capabilities = { canSend: true, canStream: true };
  private timer: NodeJS.Timeout | undefined;
  private since: string | undefined;
  private selfUserId = "";

  constructor(
    private readonly client?: MatrixClient,
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  static fromConfig(pollMs?: number): GmessagesAdapter {
    try {
      return new GmessagesAdapter(configuredClient(), pollMs);
    } catch {
      return new GmessagesAdapter(undefined, pollMs);
    }
  }

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    if (!this.client) {
      logger.info(
        { adapter: this.id },
        "gmessages: no homeserver/token, adapter idle",
      );
      return;
    }
    const client = this.client;
    this.selfUserId = await client
      .whoami()
      .then((who) => who.user_id)
      .catch(() => "");

    const poll = async (): Promise<void> => {
      try {
        const sync = await client.sync(this.since);
        this.since = sync.nextBatch;
        for (const room of sync.rooms.filter(isGoogleMessagesRoom)) {
          for (const event of room.timeline.filter(isTextMessage)) {
            if (event.sender === this.selfUserId) continue;
            sink(toSignal(room, event, this.selfUserId));
          }
        }
      } catch (err) {
        if (isNotConfigured(err)) return;
        logger.warn(
          { adapter: this.id, err: String(err) },
          "gmessages: sync failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info({ adapter: this.id }, "gmessages adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async send(draft: OutboundDraft): Promise<SendResult> {
    if (!this.client || !draft.threadId) {
      throw new AdapterNotConfiguredError("gmessages", "room for reply");
    }
    const eventId = await this.client.sendText(
      draft.threadId,
      draft.body,
      crypto.randomUUID(),
    );
    return { externalId: eventId.event_id };
  }
}

function configuredClient(): MatrixClient {
  const homeserverUrl =
    credentialString(
      "gmessages",
      "homeserverUrl",
      "MIND_GMESSAGES_HOMESERVER_URL",
    ) ?? "http://localhost:8008";
  const accessToken = credentialString(
    "gmessages",
    "accessToken",
    "MIND_GMESSAGES_ACCESS_TOKEN",
  );
  const userId = credentialString(
    "gmessages",
    "userId",
    "MIND_GMESSAGES_USER_ID",
  );
  return MatrixClient.fromCredentials(homeserverUrl, accessToken, userId);
}
