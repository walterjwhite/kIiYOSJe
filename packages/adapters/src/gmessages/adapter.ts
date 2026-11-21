/**
 * SMS adapter backed by mautrix-gmessages — one instance per bridge account.
 *
 * Polls the Matrix sync endpoint, keeps only rooms that belong to the Google
 * Messages bridge, and hands inbound texts to the pipeline. Sending uses the
 * same room, so an approved reply is delivered as SMS through the bridge that
 * received it.
 */

import { accountCredential, adapterIdForAccount, credentialAccounts } from "@mind/core";
import { logger } from "@mind/core";
import type { Adapter, NewSignal, OutboundDraft, SendResult } from "@mind/core";
import { AdapterNotConfiguredError, isNotConfigured } from "../errors.js";
import { isGoogleMessagesRoom, isTextMessage, toSignal } from "./mapping.js";
import { MatrixClient } from "./protocol.js";

const DEFAULT_POLL_MS = 15_000;

export class GmessagesAdapter implements Adapter {
  readonly id: string;
  readonly account: string;
  readonly capabilities = { canSend: true, canStream: true };
  private readonly client: MatrixClient | undefined;
  private readonly pollMs: number;
  private timer: NodeJS.Timeout | undefined;
  private since: string | undefined;
  private selfUserId = "";

  constructor(client?: MatrixClient, pollMs = DEFAULT_POLL_MS, account = "default") {
    this.account = account;
    this.id = adapterIdForAccount("gmessages", account);
    this.client = client;
    this.pollMs = pollMs;
  }

  /** One adapter per configured bridge account; one idle adapter if none. */
  static allFromConfig(pollMs?: number): GmessagesAdapter[] {
    const accounts = credentialAccounts("gmessages").filter(
      (account) =>
        accountCredential(account, "accessToken", "MIND_GMESSAGES_ACCESS_TOKEN") !== undefined,
    );
    if (accounts.length === 0) {
      try {
        return [new GmessagesAdapter(configuredClient("default"), pollMs, "default")];
      } catch {
        return [new GmessagesAdapter(undefined, pollMs, "default")];
      }
    }
    return accounts.map((account) => {
      try {
        return new GmessagesAdapter(configuredClient(account.label), pollMs, account.label);
      } catch {
        return new GmessagesAdapter(undefined, pollMs, account.label);
      }
    });
  }

  /** First configured adapter, kept for callers that only need one. */
  static fromConfig(pollMs?: number): GmessagesAdapter {
    return GmessagesAdapter.allFromConfig(pollMs)[0]!;
  }

  async start(sink: (signal: NewSignal) => void): Promise<void> {
    if (!this.client) {
      logger.info(
        { adapter: this.id, account: this.account },
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
            sink(toSignal(room, event, this.selfUserId, this.account));
          }
        }
      } catch (err) {
        if (isNotConfigured(err)) return;
        logger.warn(
          { adapter: this.id, account: this.account, err: String(err) },
          "gmessages: sync failed",
        );
      }
    };

    await poll();
    this.timer = setInterval(() => void poll(), this.pollMs);
    logger.info({ adapter: this.id, account: this.account }, "gmessages adapter started");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async send(draft: OutboundDraft): Promise<SendResult> {
    if (!this.client || !draft.threadId) {
      throw new AdapterNotConfiguredError("gmessages", "room for reply");
    }
    const eventId = await this.client.sendText(draft.threadId, draft.body, crypto.randomUUID());
    return { externalId: eventId.event_id };
  }
}

function configuredClient(label = "default"): MatrixClient {
  const account =
    credentialAccounts("gmessages").find((entry) => entry.label === label) ??
    (label === "default" ? { label: "default", section: "gmessages", config: {} } : undefined);
  if (!account) {
    throw new AdapterNotConfiguredError("gmessages", `account '${label}'`);
  }

  const homeserverUrl =
    accountCredential(account, "homeserverUrl", "MIND_GMESSAGES_HOMESERVER_URL") ??
    "http://localhost:8008";
  const accessToken = accountCredential(account, "accessToken", "MIND_GMESSAGES_ACCESS_TOKEN");
  const userId = accountCredential(account, "userId", "MIND_GMESSAGES_USER_ID");
  return MatrixClient.fromCredentials(homeserverUrl, accessToken, userId);
}
