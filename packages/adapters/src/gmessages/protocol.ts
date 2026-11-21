/**
 * Matrix client-server protocol subset used by the mautrix-gmessages wrapper.
 *
 * mautrix-gmessages is a Matrix bridge: it presents Google Messages chats as
 * Matrix rooms and relays outbound `m.text` events back to SMS/MMS. So reading
 * Google Messages programmatically means speaking the Matrix client-server API
 * to the homeserver that runs the bridge — which is what this client does, with
 * no matrix-js-sdk dependency.
 */

import { requestJson } from "@mind/core";
import { AdapterNotConfiguredError } from "../errors.js";

export interface MatrixConfig {
  homeserverUrl: string;
  accessToken: string;
  userId?: string;
}

export interface MatrixEvent {
  event_id: string;
  sender: string;
  origin_server_ts: number;
  type: string;
  content?: { msgtype?: string; body?: string };
}

export interface MatrixRoom {
  roomId: string;
  name: string;
  isDirect: boolean;
  stateEvents: {
    type: string;
    state_key?: string;
    sender?: string;
    content?: Record<string, unknown>;
  }[];
  timeline: MatrixEvent[];
}

export interface MatrixSync {
  nextBatch: string;
  rooms: MatrixRoom[];
}

export class MatrixClient {
  constructor(
    private readonly config: MatrixConfig,
    private readonly fetchJson = requestJson,
  ) {}

  static fromCredentials(
    homeserverUrl: string | undefined,
    accessToken: string | undefined,
    userId?: string,
  ): MatrixClient {
    if (!homeserverUrl || !accessToken) {
      throw new AdapterNotConfiguredError("gmessages", "homeserverUrl/accessToken");
    }
    return new MatrixClient({
      homeserverUrl: homeserverUrl.replace(/\/$/, ""),
      accessToken,
      ...(userId ? { userId } : {}),
    });
  }

  whoami(): Promise<{ user_id: string }> {
    return this.call("/_matrix/client/v3/account/whoami");
  }

  async sync(since?: string, timeoutMs = 0): Promise<MatrixSync> {
    const query = `?timeout=${timeoutMs}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    const raw = await this.call<RawSync>(`/_matrix/client/v3/sync${query}`);
    return { nextBatch: raw.next_batch, rooms: mapRooms(raw) };
  }

  sendText(roomId: string, body: string, transactionId: string): Promise<{ event_id: string }> {
    return this.call(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(transactionId)}`,
      { method: "PUT", json: { msgtype: "m.text", body } },
    );
  }

  private call<T>(
    path: string,
    options: { method?: "GET" | "PUT"; json?: unknown } = {},
  ): Promise<T> {
    return this.fetchJson<T>(`${this.config.homeserverUrl}${path}`, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
      ...(options.json === undefined ? {} : { json: options.json }),
    });
  }
}

interface RawSync {
  next_batch: string;
  rooms?: {
    join?: Record<
      string,
      {
        state?: { events?: MatrixRoom["stateEvents"] };
        timeline?: { events?: MatrixEvent[] };
      }
    >;
  };
}

function mapRooms(raw: RawSync): MatrixRoom[] {
  return Object.entries(raw.rooms?.join ?? {}).map(([roomId, room]) => {
    const stateEvents = room.state?.events ?? [];
    const nameEvent = stateEvents.find((event) => event.type === "m.room.name");
    return {
      roomId,
      name: typeof nameEvent?.content?.["name"] === "string" ? nameEvent.content["name"] : "",
      isDirect:
        stateEvents.some((event) => event.type === "m.direct") ||
        stateEvents.some(
          (event) => event.type === "m.room.member" && event.content?.["is_direct"] === true,
        ),
      stateEvents,
      timeline: room.timeline?.events ?? [],
    };
  });
}
