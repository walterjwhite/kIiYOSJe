import { describe, expect, it } from "vitest";
import type { Conversation, Message } from "teams-api";
import { isHumanText, stripHtml, toSignal } from "./mapper.js";

const conversation = {
  id: "19:conversation",
  topic: "Release crew",
  threadType: "chat",
  version: 1,
  lastMessageTime: null,
  memberCount: 4,
} as Conversation;

const message = {
  id: "1600000000000",
  messageType: "RichText/Html",
  senderMri: "8:orgid:alice",
  senderDisplayName: "Alice",
  content: "<p>Can you review <b>this</b>?</p>",
  originalArrivalTime: "2026-11-14T09:00:00.000Z",
  composeTime: "2026-11-14T09:00:00.000Z",
  editTime: null,
  subject: null,
  isDeleted: false,
  reactions: [],
  followers: [],
  mentions: [{ mri: "8:orgid:me" }],
  quotedMessageId: null,
  images: [],
  files: [],
} as unknown as Message;

describe("isHumanText", () => {
  it("accepts rich text and rejects system events and deletes", () => {
    expect(isHumanText(message)).toBe(true);
    expect(isHumanText({ ...message, isDeleted: true } as Message)).toBe(false);
    expect(
      isHumanText({
        ...message,
        messageType: "ThreadActivity/AddMember",
      } as Message),
    ).toBe(false);
  });
});

describe("stripHtml", () => {
  it("keeps words and line breaks", () => {
    expect(stripHtml("<p>a &lt; b</p><p>c</p>")).toBe("a < b\nc");
  });
});

describe("toSignal", () => {
  it("maps a conversation message", () => {
    const signal = toSignal(conversation, message);
    expect(signal?.adapter).toBe("teams");
    expect(signal?.externalId).toBe("1600000000000");
    expect(signal?.threadId).toBe("19:conversation");
    expect(signal?.sender).toBe("8:orgid:alice");
    expect(signal?.body).toBe("Can you review this?");
    expect(signal?.urgencyHint).toBe(1);
  });

  it("returns null for a system event", () => {
    expect(
      toSignal(conversation, {
        ...message,
        messageType: "Event/Call",
      } as Message),
    ).toBeNull();
  });
});
