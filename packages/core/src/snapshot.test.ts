import Database from "better-sqlite3";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSnapshots, restore, safeLabel, snapshot } from "./snapshot.js";

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "mind-snapshot-"));
  const dbFile = join(dir, "mind.db");
  const db = new Database(dbFile);
  db.exec("CREATE TABLE things (id text)");
  db.exec("INSERT INTO things (id) VALUES ('one')");
  db.close();
  return { dir, dbFile, snapshots: join(dir, "snapshots") };
}

describe("snapshots", () => {
  it("archives the database, lists it, and restores it", async () => {
    const { dbFile, snapshots } = workspace();
    const path = await snapshot("Before Refactor", dbFile, snapshots);
    expect(path.endsWith("before-refactor.db")).toBe(true);

    const live = new Database(dbFile);
    live.exec("DELETE FROM things");
    live.close();

    const listed = listSnapshots(snapshots);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe("before-refactor");

    const result = await restore("before-refactor", dbFile, snapshots, async () => {});
    expect(result.restored.endsWith("before-refactor.db")).toBe(true);
    expect(result.archived).toContain(".replaced-");

    const restored = new Database(dbFile, { readonly: true });
    expect(restored.prepare("SELECT count(*) AS n FROM things").get()).toEqual({ n: 1 });
    restored.close();
  });

  it("keeps the displaced database so the restore is undoable", async () => {
    const { dbFile, snapshots } = workspace();
    await snapshot("keep", dbFile, snapshots);
    const { archived } = await restore("keep", dbFile, snapshots, async () => {});
    expect(archived && readdirSync(snapshots).length >= 1).toBeTruthy();
  });

  it("refuses when the server guard throws, and rejects unknown labels", async () => {
    const { dbFile, snapshots } = workspace();
    await expect(
      restore("x", dbFile, snapshots, async () => {
        throw new Error("server up");
      }),
    ).rejects.toThrow("server up");
    await expect(restore("missing", dbFile, snapshots, async () => {})).rejects.toThrow(
      "no snapshot named missing",
    );
  });

  it("normalises labels to filesystem-safe names", () => {
    expect(safeLabel("Before Refactor")).toBe("before-refactor");
    expect(safeLabel("../../etc/passwd")).toBe("etc-passwd");
    expect(safeLabel("!!!").length).toBeGreaterThan(0);
  });
});
