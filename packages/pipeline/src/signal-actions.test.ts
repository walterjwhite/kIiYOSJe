import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@mind/core";
import { DirectionConfigSchema, SignalActionSchema, directions } from "@mind/core";
import { loadDirections } from "./directions-loader.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "core", "migrations");
const EXAMPLES_DIR = join(here, "..", "..", "..", "directions", "work");

const link = (linkPrefix: string) =>
  SignalActionSchema.safeParse({ id: "x", label: "X", kind: "openLink", linkPrefix });

describe("SignalActionSchema", () => {
  it("accepts acknowledge and an https openLink", () => {
    expect(
      SignalActionSchema.safeParse({ id: "ack", label: "Ack", kind: "acknowledge" }).success,
    ).toBe(true);
    expect(link("https://accounts.google.com/AccountDisavow?adt=").success).toBe(true);
  });

  it.each([
    "http://a.test/x",
    "https://a.test/",
    "https://user:pw@a.test/x",
    "javascript:alert(1)",
    "not a url",
  ])("rejects linkPrefix %s", (p) => {
    expect(link(p).success).toBe(false);
  });

  it("rejects unknown kinds, so a YAML file cannot request arbitrary behaviour", () => {
    expect(
      SignalActionSchema.safeParse({ id: "x", label: "X", kind: "shell", command: "rm -rf /" })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate action ids in a direction", () => {
    const r = DirectionConfigSchema.safeParse({
      name: "d",
      scope: { kind: "topic", value: "v" },
      posture: "surface",
      autonomy: "observe",
      standard: "s",
      signalActions: [
        { id: "a", label: "A", kind: "acknowledge" },
        { id: "a", label: "B", kind: "acknowledge" },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("signalActions loading", () => {
  it("stores the actions declared in directions/work/google-signin.yaml", () => {
    const db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    loadDirections(db, EXAMPLES_DIR);

    const row = db
      .select()
      .from(directions)
      .all()
      .find((d) => d.name === "google-signin-notice");
    const actions = JSON.parse(row!.signalActions!);
    expect(actions.map((a: { id: string }) => a.id)).toEqual(["acknowledge", "disavow"]);
    expect(actions[1]).toMatchObject({
      kind: "openLink",
      linkPrefix: "https://accounts.google.com/AccountDisavow?adt=",
    });
  });

  it("skips a direction whose action is invalid instead of loading it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-actions-"));
    writeFileSync(
      join(dir, "bad.yaml"),
      `name: bad
scope: { kind: topic, value: v }
posture: surface
autonomy: observe
standard: s
signalActions:
  - { id: go, label: Go, kind: openLink, linkPrefix: "http://insecure.test/x" }
`,
    );
    const db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    loadDirections(db, dir);
    expect(
      db
        .select()
        .from(directions)
        .all()
        .find((d) => d.name === "bad"),
    ).toBeUndefined();
  });
});
