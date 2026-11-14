import { describe, it, expect } from "vitest";
import { normalize } from "./normalize.js";

describe("normalize", () => {
  it("passes through plain text unchanged", () => {
    const { body } = normalize("Hello, please send the report.");
    expect(body).toBe("Hello, please send the report.");
  });

  it("strips email quote lines starting with >", () => {
    const raw = `Thanks for the note.

> On Mon, 1 Jan 2024, Alice wrote:
> Can you review this?

Happy to help.`;

    const { body } = normalize(raw);
    expect(body).toContain("Thanks for the note.");
    expect(body).toContain("Happy to help.");
    expect(body).not.toContain("Can you review this?");
  });

  it("returns empty commitments and deadlines (deferred to classifier)", () => {
    const { commitments, deadlines } = normalize("Let's meet by Friday.");
    expect(commitments).toEqual([]);
    expect(deadlines).toEqual([]);
  });
});
