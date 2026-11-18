import { describe, expect, it } from "vitest";
import { fromGraph, stripHtml, toSignal } from "./mapper.js";

describe("stripHtml", () => {
  it("flattens markup and entities", () => {
    expect(
      stripHtml("<p>Thanks &amp; regards</p><p>Alice<br>Sent from Outlook</p>"),
    ).toBe("Thanks & regards\nAlice\nSent from Outlook");
  });
});

describe("fromGraph", () => {
  it("maps addresses, subject, and html body", () => {
    const signal = toSignal(
      fromGraph({
        id: "AAMk",
        conversationId: "conv-1",
        subject: "Quarterly report",
        from: { emailAddress: { address: "Alice@Example.com" } },
        toRecipients: [{ emailAddress: { address: "me@example.com" } }],
        receivedDateTime: "2026-11-14T09:30:00.000Z",
        body: { contentType: "html", content: "<p>Please review</p>" },
        importance: "high",
      }),
    );

    expect(signal.adapter).toBe("outlook");
    expect(signal.threadId).toBe("conv-1");
    expect(signal.sender).toBe("alice@example.com");
    expect(signal.recipients).toEqual(["me@example.com"]);
    expect(signal.body).toBe("Please review");
    expect(signal.subject).toBe("Quarterly report");
    expect(signal.urgencyHint).toBe(1);
    expect(signal.receivedAt.toISOString()).toBe("2026-11-14T09:30:00.000Z");
  });

  it("falls back to bodyPreview for a text body and tolerates missing fields", () => {
    const signal = toSignal(fromGraph({ id: "AAMk2", bodyPreview: "short" }));
    expect(signal.body).toBe("short");
    expect(signal.sender).toBe("unknown");
    expect(signal.threadId).toBeNull();
    expect(signal.subject).toBeUndefined();
  });
});
