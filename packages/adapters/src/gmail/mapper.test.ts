import { describe, expect, it } from "vitest";
import {
  buildRawMessage,
  extractBody,
  parseAddresses,
  toSignal,
} from "./mapper.js";

const encoded = (text: string): string =>
  Buffer.from(text, "utf8").toString("base64url");

describe("extractBody", () => {
  it("finds a nested text/plain part", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: encoded("<b>hi</b>") } },
        { mimeType: "text/plain", body: { data: encoded("hello from plain") } },
      ],
    });
    expect(body).toBe("hello from plain");
  });

  it("returns an empty string for an empty payload", () => {
    expect(extractBody(undefined)).toBe("");
  });
});

describe("parseAddresses", () => {
  it("extracts bare and angled addresses, lower-cased", () => {
    expect(parseAddresses("Alice <Alice@Example.com>, bob@example.com")).toEqual(
      ["alice@example.com", "bob@example.com"],
    );
  });
});

describe("toSignal", () => {
  it("maps headers, body, and the internal date", () => {
    const signal = toSignal(
      {
        id: "m-1",
        threadId: "t-1",
        labelIds: ["IMPORTANT"],
        internalDate: String(Date.parse("2026-11-14T09:00:00.000Z")),
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Alice <alice@example.com>" },
            { name: "To", value: "me@example.com" },
            { name: "Subject", value: "Quarterly report" },
          ],
          body: { data: encoded("Please review.") },
        },
      },
      "me@example.com",
    );

    expect(signal.adapter).toBe("gmail");
    expect(signal.externalId).toBe("m-1");
    expect(signal.sender).toBe("alice@example.com");
    expect(signal.recipients).toEqual(["me@example.com"]);
    expect(signal.subject).toBe("Quarterly report");
    expect(signal.body).toBe("Please review.");
    expect(signal.receivedAt.toISOString()).toBe("2026-11-14T09:00:00.000Z");
    expect(signal.urgencyHint).toBe(1);
  });
});

describe("buildRawMessage", () => {
  it("round-trips through base64url", () => {
    const raw = buildRawMessage({
      from: "me@example.com",
      to: ["alice@example.com"],
      subject: "Re: Report",
      body: "On it.",
      inReplyTo: "m-1",
    });
    const message = Buffer.from(raw, "base64url").toString("utf8");
    expect(message).toContain("Subject: Re: Report");
    expect(message).toContain("In-Reply-To: m-1");
    expect(message.endsWith("On it.")).toBe(true);
  });
});
