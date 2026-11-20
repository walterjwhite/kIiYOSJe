/**
 * Loads Direction YAML files from a directory tree and upserts them into the
 * database.  Called at startup and on SIGHUP to reload without restarting.
 *
 * File format: directions/**\/*.yaml, one Direction per file.
 * The file path relative to the root (without extension) is used as the
 * stable ID, e.g. "work/boss" for directions/work/boss.yaml.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from "yaml";
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
  const signalActionsJson =
    cfg.signalActions && cfg.signalActions.length > 0
      ? JSON.stringify(cfg.signalActions)
      : null;

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
        transformPrompt: cfg.transformPrompt ?? null,
        signalActions: signalActionsJson,
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
        transformPrompt: cfg.transformPrompt ?? null,
        signalActions: signalActionsJson,
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

// ── File write-back ─────────────────────────────────────────────────────────
// The YAML under directions/ is the source of truth: loadDirections() rewrites
// the database row from it on every start and SIGHUP. Edits and deletions made
// through the API must therefore reach the file, or they silently revert.

const DIRECTION_ID = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function isValidDirectionId(id: string): boolean {
  return DIRECTION_ID.test(id) && !id.split("/").includes("..");
}

function existingDirectionFile(dirRoot: string, id: string): string | null {
  if (!isValidDirectionId(id)) throw new Error(`invalid direction id: ${id}`);
  for (const ext of [".yaml", ".yml"]) {
    const file = join(dirRoot, id + ext);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Creates directions/<id>.yaml. Throws if the file already exists. */
export function createDirectionFile(
  dirRoot: string,
  id: string,
  cfg: DirectionConfig,
): void {
  if (existingDirectionFile(dirRoot, id)) {
    throw new Error(`direction already exists: ${id}`);
  }
  const file = join(dirRoot, id + ".yaml");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyYaml(cfg), { flag: "wx" });
}

/** Fields of an UpdateDirectionRequest that live in the YAML file. */
export interface DirectionFilePatch {
  name?: string | undefined;
  posture?: string | undefined;
  autonomy?: string | undefined;
  scopeKind?: string | undefined;
  scopeValue?: string | undefined;
  confidenceMin?: number | undefined;
  standard?: string | undefined;
  matchPrompt?: string | null | undefined;
  responsePrompt?: string | null | undefined;
  transformPrompt?: string | null | undefined;
}

/**
 * Applies an edit to the direction's YAML file, keeping comments and other
 * keys. Returns false when the direction has no file (e.g. system/catch-all).
 */
export function patchDirectionFile(
  dirRoot: string,
  id: string,
  patch: DirectionFilePatch,
): boolean {
  const file = existingDirectionFile(dirRoot, id);
  if (!file) return false;
  const doc = parseDocument(readFileSync(file, "utf8"));

  const setOrDelete = (key: string, value: string | null): void => {
    if (value === null || value === "") doc.delete(key);
    else doc.set(key, value);
  };

  if (patch.name !== undefined) doc.set("name", patch.name);
  if (patch.posture !== undefined) doc.set("posture", patch.posture);
  if (patch.autonomy !== undefined) doc.set("autonomy", patch.autonomy);
  if (patch.scopeKind !== undefined) doc.setIn(["scope", "kind"], patch.scopeKind);
  if (patch.scopeValue) doc.setIn(["scope", "value"], patch.scopeValue);
  if (patch.confidenceMin !== undefined) doc.set("confidenceMin", patch.confidenceMin);
  if (patch.standard !== undefined) {
    // A file may use the `guidance` alias; keep whichever key it has.
    const key = doc.has("guidance") && !doc.has("standard") ? "guidance" : "standard";
    doc.set(key, patch.standard);
  }
  if (patch.matchPrompt !== undefined) setOrDelete("matchPrompt", patch.matchPrompt);
  if (patch.responsePrompt !== undefined) setOrDelete("responsePrompt", patch.responsePrompt);
  if (patch.transformPrompt !== undefined) setOrDelete("transformPrompt", patch.transformPrompt);

  writeFileSync(file, doc.toString());
  return true;
}

/**
 * Retires a direction's file by renaming it to <name>.deleted, which the loader
 * ignores. Reversible: rename it back. Returns false when there is no file.
 */
export function retireDirectionFile(dirRoot: string, id: string): boolean {
  const file = existingDirectionFile(dirRoot, id);
  if (!file) return false;
  renameSync(file, file + ".deleted");
  return true;
}
