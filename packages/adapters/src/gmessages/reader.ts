/**
 * GoogleMessagesReader — the programmatic read/write API for Google Messages.
 *
 * `rooms()` lists every SMS/MMS conversation the mautrix-gmessages bridge
 * exposes, `messages()` reads one conversation newest-first, and `send()`
 * relays a text back through the bridge. This is the "wrapper" surface: an app
 * can read Messages without knowing anything about Matrix or the pipeline.
 */

import { AdapterNotConfiguredError } from "../errors.js";
import { isGoogleMessagesRoom, isTextMessage, roomLabel } from "./mapping.js";
import { MatrixClient, type MatrixEvent } from "./protocol.js";

export interface GoogleMessage {
  eventId: string;
  roomId: string;
  conversation: string;
  sender: string;
  body: string;
  sentAt: Date;
  inbound: boolean;
}

export interface GoogleMessageRoom {
  roomId: string;
  label: string;
  isDirect: boolean;
  lastMessageAt: Date | null;
}

export interface ListMessagesOptions {
  roomId: string;
  limit?: number;
  /** Only return messages received at or after this instant. */
  since?: Date;
}

export class GoogleMessagesReader {
  constructor(private readonly client: MatrixClient) {}

  async rooms(): Promise<GoogleMessageRoom[]> {
    const self = await this.client.whoami();
    const sync = await this.client.sync();
    return sync.rooms.filter(isGoogleMessagesRoom).map((room) => ({
      roomId: room.roomId,
      label: roomLabel(room),
      isDirect: room.isDirect || room.stateEvents.some((event) => event.type === "m.bridge"),
      lastMessageAt: lastTimestamp(room.timeline, self.user_id),
    }));
  }

  async messages(options: ListMessagesOptions): Promise<GoogleMessage[]> {
    const self = await this.client.whoami();
    const sync = await this.client.sync();
    const room = sync.rooms.find((candidate) => candidate.roomId === options.roomId);
    if (!room) throw new AdapterNotConfiguredError("gmessages", `unknown room ${options.roomId}`);

    const messages = room.timeline
      .filter(isTextMessage)
      .filter((event) => !options.since || event.origin_server_ts >= options.since.getTime())
      .map((event) => this.toGoogleMessage(room.roomId, roomLabel(room), event, self.user_id));

    messages.sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime());
    return messages.slice(0, options.limit ?? 50);
  }

  async send(roomId: string, body: string): Promise<string> {
    const response = await this.client.sendText(roomId, body, crypto.randomUUID());
    return response.event_id;
  }

  private toGoogleMessage(
    roomId: string,
    conversation: string,
    event: MatrixEvent,
    selfUserId: string,
  ): GoogleMessage {
    return {
      eventId: event.event_id,
      roomId,
      conversation,
      sender: event.sender,
      body: event.content?.body ?? "",
      sentAt: new Date(event.origin_server_ts),
      inbound: event.sender !== selfUserId,
    };
  }
}

function lastTimestamp(events: MatrixEvent[], selfUserId: string): Date | null {
  const inbound = events
    .filter(isTextMessage)
    .filter((event) => event.sender !== selfUserId)
    .map((event) => event.origin_server_ts);
  return inbound.length > 0 ? new Date(Math.max(...inbound)) : null;
}
