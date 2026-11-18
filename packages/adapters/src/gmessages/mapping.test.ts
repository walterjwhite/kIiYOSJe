import { describe, expect, it } from "vitest";
import {
  isGoogleMessagesRoom,
  isGoogleMessagesSender,
  isTextMessage,
  phoneNumber,
  roomLabel,
  toSignal,
} from "./mapping.js";
import type { MatrixEvent, MatrixRoom } from "./protocol.js";

const SELF = "@me:matrix.example";

function event(overrides: Partial<MatrixEvent> = {}): MatrixEvent {
  return {
    event_id: "$event",
    sender: "@gmessages_15551234567:matrix.example",
    origin_server_ts: Date.parse("2026-11-14T12:00:00.000Z"),
    type: "m.room.message",
    content: { msgtype: "m.text", body: "hello" },
    ...overrides,
  };
}

function room(overrides: Partial<MatrixRoom> = {}): MatrixRoom {
  return {
    roomId: "!room:matrix.example",
    name: "",
    isDirect: true,
    stateEvents: [
      { type: "m.bridge", content: { bridge: "gmessages" } },
      {
        type: "m.room.member",
        state_key: "@gmessages_15551234567:matrix.example",
      },
    ],
    timeline: [event()],
    ...overrides,
  };
}

describe("isGoogleMessagesRoom", () => {
  it("accepts a bridged room", () => {
    expect(isGoogleMessagesRoom(room())).toBe(true);
  });

  it("accepts a room whose member is a ghost even without m.bridge", () => {
    const ghostOnly = room({
      stateEvents: [{ type: "m.room.member", state_key: "@gmessages_1:x" }],
    });
    expect(isGoogleMessagesRoom(ghostOnly)).toBe(true);
  });

  it("rejects an unrelated room", () => {
    const other = room({
      stateEvents: [{ type: "m.room.member", state_key: SELF }],
      timeline: [event({ sender: SELF })],
    });
    expect(isGoogleMessagesRoom(other)).toBe(false);
  });
});

describe("phoneNumber", () => {
  it("extracts the number from a ghost mxid", () => {
    expect(phoneNumber("@gmessages_15551234567:matrix.example")).toBe(
      "15551234567",
    );
  });

  it("returns null for a normal user", () => {
    expect(phoneNumber(SELF)).toBeNull();
  });

  it("recognises ghost senders", () => {
    expect(isGoogleMessagesSender("@gmessages_1:x")).toBe(true);
    expect(isGoogleMessagesSender(SELF)).toBe(false);
  });
});

describe("roomLabel", () => {
  it("prefers the room name", () => {
    expect(roomLabel(room({ name: "Alex" }))).toBe("Alex");
  });

  it("falls back to the ghost's phone number", () => {
    expect(roomLabel(room())).toBe("15551234567");
  });
});

describe("isTextMessage", () => {
  it("accepts m.text and m.notice only", () => {
    expect(isTextMessage(event())).toBe(true);
    expect(
      isTextMessage(event({ content: { msgtype: "m.image", body: "x" } })),
    ).toBe(false);
    expect(isTextMessage(event({ type: "m.reaction" }))).toBe(false);
  });
});

describe("toSignal", () => {
  it("uses the phone number as sender and the room as thread", () => {
    const signal = toSignal(room(), event(), SELF);
    expect(signal.adapter).toBe("gmessages");
    expect(signal.externalId).toBe("$event");
    expect(signal.threadId).toBe("!room:matrix.example");
    expect(signal.sender).toBe("15551234567");
    expect(signal.recipients).toEqual([SELF]);
    expect(signal.kind).toBe("sms");
    expect(signal.receivedAt.toISOString()).toBe("2026-11-14T12:00:00.000Z");
  });
});
