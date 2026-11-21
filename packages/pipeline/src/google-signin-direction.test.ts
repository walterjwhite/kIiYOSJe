import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@mind/core";
import type { NewSignal } from "@mind/core";
import { loadDirections } from "./directions-loader.js";
import { matchSignal } from "./match.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "core", "migrations");
const EXAMPLES_DIR = join(here, "..", "..", "..", "directions", "work");

function signalWithBody(body: string): NewSignal {
  return {
    adapter: "gmail",
    externalId: "g-1",
    threadId: "t-g-1",
    sender: "no-reply@accounts.google.com",
    recipients: ["me@gmail.com"],
    kind: "email",
    subject: "Security alert",
    body,
    receivedAt: new Date("2026-11-14T10:00:00.000Z"),
    urgencyHint: null,
  };
}

describe("directions/work/google-signin.yaml", () => {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  loadDirections(db, EXAMPLES_DIR);

  it.each(["Linux", "Windows", "Apple"])(
    "matches a %s sign-in notice and carries a transformPrompt",
    (platform) => {
      const m = matchSignal(
        db,
        signalWithBody(
          `We noticed a new sign-in to your Google Account on a ${platform} device. If this was you, you don't need to do anything.`,
        ),
      );
      expect(m?.direction.name).toBe("google-signin-notice");
      expect(m?.direction.posture).toBe("surface");
      expect(m?.direction.transformPrompt).toContain(
        "account sign-in on <platform> - <email-address> - <recovery-email-address>",
      );
    },
  );

  it("matches when the sentence wraps before the platform", () => {
    const m = matchSignal(
      db,
      signalWithBody("We noticed a new sign-in to your Google Account\non a Linux device."),
    );
    expect(m?.direction.name).toBe("google-signin-notice");
  });

  it("does not match unrelated mail", () => {
    const m = matchSignal(db, signalWithBody("Your weekly digest is ready."));
    expect(m?.direction.name).not.toBe("google-signin-notice");
  });
});
