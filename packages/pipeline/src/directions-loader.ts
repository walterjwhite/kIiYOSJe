/**
 * Loads Direction YAML files from a directory tree and upserts them into the
 * database.  Called at startup and on SIGHUP to reload without restarting.
 *
 * File format: directions/**\/*.yaml, one Direction per file.
 * The file path relative to the root (without extension) is used as the
 * stable ID, e.g. "work/boss" for directions/work/boss.yaml.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import type { Db } from "@mind/core";
import { directions, DirectionConfigSchema, logger } from "@mind/core";
import type { DirectionConfig } from "@mind/core";

export function loadDirections(db: Db, dirRoot: string): void {
  const files = collectYaml(dirRoot);
  let loaded = 0;
  let skipped = 0;

  for (const file of files) {
    const relPath = relative(dirRoot, file);
    const id = relPath.replace(/\.ya?ml$/, "").replace(/\\/g, "/");

    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (err) {
      logger.warn({ file, err }, "direction: failed to parse YAML, skipping");
      skipped++;
      continue;
    }

    const result = DirectionConfigSchema.safeParse(raw);
    if (!result.success) {
      logger.warn(
        { file, issues: result.error.issues },
        "direction: schema validation failed, skipping",
      );
      skipped++;
      continue;
    }

    upsertDirection(db, id, result.data);
    loaded++;
  }

  logger.info({ loaded, skipped }, "directions loaded");
}

function upsertDirection(db: Db, id: string, cfg: DirectionConfig): void {
  const existing = db
    .select({ version: directions.version })
    .from(directions)
    .where(eq(directions.id, id))
    .get();

  const now = new Date().toISOString();
  const guardsJson = cfg.guards ? JSON.stringify(cfg.guards) : null;

  if (!existing) {
    db.insert(directions)
      .values({
        id,
        name: cfg.name,
        scopeKind: cfg.scope.kind,
        scopeValue: cfg.scope.value,
        posture: cfg.posture,
        standard: cfg.standard,
        autonomy: cfg.autonomy,
        confidenceMin: cfg.confidenceMin ?? 0.7,
        guards: guardsJson,
        matchPrompt: cfg.matchPrompt ?? null,
        responsePrompt: cfg.responsePrompt ?? null,
        enabled: true,
        version: 1,
      })
      .run();
  } else {
    db.update(directions)
      .set({
        name: cfg.name,
        scopeKind: cfg.scope.kind,
        scopeValue: cfg.scope.value,
        posture: cfg.posture,
        standard: cfg.standard,
        autonomy: cfg.autonomy,
        confidenceMin: cfg.confidenceMin ?? 0.7,
        guards: guardsJson,
        matchPrompt: cfg.matchPrompt ?? null,
        responsePrompt: cfg.responsePrompt ?? null,
        version: existing.version + 1,
        updatedAt: now,
      })
      .where(eq(directions.id, id))
      .run();
  }
}

function collectYaml(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectYaml(full));
    } else if (stat.isFile() && /\.ya?ml$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}
