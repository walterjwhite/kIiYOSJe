/**
 * Bridge mapping for mautrix-gmessages.
 *
 * The bridge marks its rooms with an `m.bridge` state event and creates ghost
 * users named `@gmessages_<id>:server`; phone-number chats also show up as room
 * names. These helpers are pure so the bridge's conventions stay in one file —
 * that is the part most likely to drift.
 */

import type { NewSignal } from "@mind/core";
import { adapterIdForAccount } from "@mind/core";
import type { MatrixEvent, MatrixRoom } from "./protocol.js";

const GHOST_PREFIX = "@gmessages_";

export function isBridgeRoom(room: MatrixRoom): boolean {
  return room.stateEvents.some((event) => event.type === "m.bridge");
}

export function isGoogleMessagesSender(sender: string): boolean {
  return sender.startsWith(GHOST_PREFIX);
}

/** A room counts as Google Messages when it is bridged or one of its members is a ghost. */
export function isGoogleMessagesRoom(room: MatrixRoom): boolean {
  if (isBridgeRoom(room)) return true;
  const ghostMember = room.stateEvents.some(
    (event) => event.type === "m.room.member" && isGoogleMessagesSender(event.state_key ?? ""),
  );
  return ghostMember || room.timeline.some((event) => isGoogleMessagesSender(event.sender));
}

/** The phone number behind a ghost user, when the bridge encodes one. */
export function phoneNumber(sender: string): string | null {
  if (!isGoogleMessagesSender(sender)) return null;
  const localpart = sender.slice(1).split(":")[0] ?? "";
  const raw = localpart.slice(GHOST_PREFIX.length - 1).replace(/^_/, "");
  const digits = raw.replace(/[^+\d]/g, "");
  return digits.length >= 7 ? digits : null;
}

export function roomLabel(room: MatrixRoom): string {
  if (room.name.length > 0) return room.name;
  const ghost = room.stateEvents.find(
    (event) => event.type === "m.room.member" && isGoogleMessagesSender(event.state_key ?? ""),
  );
  return phoneNumber(ghost?.state_key ?? "") ?? room.roomId;
}

export function isTextMessage(event: MatrixEvent): boolean {
  return (
    event.type === "m.room.message" &&
    (event.content?.msgtype === "m.text" || event.content?.msgtype === "m.notice") &&
    typeof event.content?.body === "string"
  );
}

export function toSignal(
  room: MatrixRoom,
  event: MatrixEvent,
  selfUserId: string,
  account = "default",
): NewSignal {
  return {
    adapter: adapterIdForAccount("gmessages", account),
    account,
    externalId: event.event_id,
    threadId: room.roomId,
    sender: phoneNumber(event.sender) ?? event.sender,
    recipients: [selfUserId],
    kind: "sms",
    body: event.content?.body ?? "",
    receivedAt: new Date(event.origin_server_ts),
    urgencyHint: null,
  };
}
