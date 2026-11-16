import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mind-backup-"));

vi.mock("@mind/core", async (orig) => {
  const actual = await orig<typeof import("@mind/core")>();
  return {
    ...actual,
    backupDir: () => dir,
    getRawDb: () => ({
      backup: async (dest: string) => { writeFileSync(dest, "db"); },
    }),
  };
});

import { runBackup } from "./backup.js";

describe("runBackup", () => {
  it("writes today's backup file", async () => {
    await runBackup();
    const today = new Date().toISOString().slice(0, 10);
    expect(readdirSync(dir)).toContain(`mind-${today}.db`);
  });

  it("keeps only the 14 most recent backups", async () => {
    for (let d = 1; d <= 20; d++) {
      writeFileSync(join(dir, `mind-2020-01-${String(d).padStart(2, "0")}.db`), "x");
    }
    await runBackup();
    const files = readdirSync(dir).filter((f) => f.startsWith("mind-"));
    expect(files).toHaveLength(14);
    expect(files).not.toContain("mind-2020-01-01.db");
  });
});
