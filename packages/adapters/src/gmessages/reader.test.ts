import { describe, expect, it } from "vitest";
import { GoogleMessagesReader } from "./reader.js";
import type { MatrixClient, MatrixSync } from "./protocol.js";

const SELF = "@me:matrix.example";

const sync: MatrixSync = {
  nextBatch: "s1",
  rooms: [
    {
      roomId: "!sms:matrix.example",
      name: "Alex",
      isDirect: true,
      stateEvents: [{ type: "m.bridge", content: { bridge: "gmessages" } }],
      timeline: [
        {
          event_id: "$1",
          sender: "@gmessages_15551234567:matrix.example",
          origin_server_ts: Date.parse("2026-11-14T10:00:00.000Z"),
          type: "m.room.message",
          content: { msgtype: "m.text", body: "running late" },
        },
        {
          event_id: "$2",
          sender: SELF,
          origin_server_ts: Date.parse("2026-11-14T10:05:00.000Z"),
          type: "m.room.message",
          content: { msgtype: "m.text", body: "no problem" },
        },
      ],
    },
    {
      roomId: "!work:matrix.example",
      name: "Work",
      isDirect: false,
      stateEvents: [{ type: "m.room.member", state_key: SELF }],
      timeline: [],
    },
  ],
};

function fakeClient(sent: string[] = []): MatrixClient {
  return {
    whoami: async () => ({ user_id: SELF }),
    sync: async () => sync,
    sendText: async (roomId: string, body: string) => {
      sent.push(`${roomId}:${body}`);
      return { event_id: "$sent" };
    },
  } as unknown as MatrixClient;
}

describe("GoogleMessagesReader", () => {
  it("lists only bridged conversations", async () => {
    const rooms = await new GoogleMessagesReader(fakeClient()).rooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.label).toBe("Alex");
  });

  it("reads a conversation newest-first and marks direction", async () => {
    const messages = await new GoogleMessagesReader(fakeClient()).messages({
      roomId: "!sms:matrix.example",
    });
    expect(messages.map((message) => [message.eventId, message.inbound])).toEqual(
      [
        ["$2", false],
        ["$1", true],
      ],
    );
  });

  it("honours since and limit", async () => {
    const reader = new GoogleMessagesReader(fakeClient());
    const recent = await reader.messages({
      roomId: "!sms:matrix.example",
      since: new Date("2026-11-14T10:02:00.000Z"),
    });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.eventId).toBe("$2");
  });

  it("sends through the bridge", async () => {
    const sent: string[] = [];
    const eventId = await new GoogleMessagesReader(fakeClient(sent)).send(
      "!sms:matrix.example",
      "on my way",
    );
    expect(eventId).toBe("$sent");
    expect(sent).toEqual(["!sms:matrix.example:on my way"]);
  });

  it("rejects an unknown room", async () => {
    await expect(
      new GoogleMessagesReader(fakeClient()).messages({
        roomId: "!missing:matrix.example",
      }),
    ).rejects.toThrow(/unknown room/);
  });
});
