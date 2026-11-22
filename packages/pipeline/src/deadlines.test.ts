import { describe, expect, it } from "vitest";
import { groundDeadline, isPlausibleDate } from "./deadlines.js";

// A Monday. Calendar days are compared in local time, which is how deadlines are
// shown, so the tests do not depend on the machine's time zone.
const RECEIVED = new Date(2026, 2, 2, 9, 0, 0);
const day = (iso: string | null) => {
  if (iso === null) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

describe("groundDeadline", () => {
  it("reads a deadline from the text, resolved against when the message arrived", () => {
    const g = groundDeadline("Please send the report by Friday.", RECEIVED, null);
    expect(g.source).toBe("text");
    expect(day(g.value)).toBe("2026-3-6");
  });

  it("uses the end of the working day when the message gives only a date", () => {
    const g = groundDeadline("Due no later than March 5", RECEIVED, null);
    const d = new Date(g.value ?? "");
    expect(day(g.value)).toBe("2026-3-5");
    expect(d.getHours()).toBe(17);
  });

  it("keeps an explicit time of day", () => {
    const g = groundDeadline("Needed before March 5 at 3pm", RECEIVED, null);
    expect(new Date(g.value ?? "").getHours()).toBe(15);
  });

  it("prefers the text over a model date that disagrees", () => {
    const wrongYear = new Date(2023, 2, 6, 17, 0, 0).toISOString();
    const g = groundDeadline("Send it by Friday", RECEIVED, wrongYear);
    expect(g.source).toBe("text");
    expect(day(g.value)).toBe("2026-3-6");
  });

  it("does not treat a meeting date as a deadline", () => {
    const g = groundDeadline("Can we meet on Thursday?", RECEIVED, null);
    expect(g.value).toBeNull();
    expect(g.source).toBeNull();
  });

  it("keeps a plausible model date when the text has no deadline phrase", () => {
    const modelDate = new Date(2026, 2, 4, 12, 0, 0).toISOString();
    const g = groundDeadline("Could you take a look at this when you can?", RECEIVED, modelDate);
    expect(g).toEqual({ value: modelDate, source: "model", droppedModelDate: false });
  });

  it("drops a model date in the past or years away, rather than trusting it", () => {
    const past = new Date(2023, 4, 1).toISOString();
    const far = new Date(2031, 0, 1).toISOString();
    expect(groundDeadline("No deadline here.", RECEIVED, past)).toEqual({
      value: null,
      source: null,
      droppedModelDate: true,
    });
    expect(groundDeadline("No deadline here.", RECEIVED, far).droppedModelDate).toBe(true);
  });

  it("ignores a date in the text that is already past", () => {
    const g = groundDeadline("The report was due by 2023-05-01", RECEIVED, null);
    expect(g.value).toBeNull();
  });

  it("handles 'within 24 hours'", () => {
    const g = groundDeadline("Reply within 24 hours please", RECEIVED, null);
    expect(g.source).toBe("text");
    expect(day(g.value)).toBe("2026-3-3");
  });

  it("returns nothing for empty text and no model date", () => {
    expect(groundDeadline("", RECEIVED, null)).toEqual({
      value: null,
      source: null,
      droppedModelDate: false,
    });
  });

  it("ignores an unparseable model date", () => {
    expect(groundDeadline("nothing", RECEIVED, "tomorrow-ish").droppedModelDate).toBe(true);
  });
});

describe("isPlausibleDate", () => {
  it("accepts a date from a day before arrival to two years after", () => {
    expect(isPlausibleDate(new Date(2026, 2, 1, 12), RECEIVED)).toBe(true);
    expect(isPlausibleDate(new Date(2028, 1, 1), RECEIVED)).toBe(true);
  });
  it("rejects an earlier or much later date", () => {
    expect(isPlausibleDate(new Date(2026, 1, 20), RECEIVED)).toBe(false);
    expect(isPlausibleDate(new Date(2029, 0, 1), RECEIVED)).toBe(false);
  });
});
