#!/usr/bin/env node
/**
 * mind-demo CLI — seed, reset, or summarize the demo database.
 *
 * Usage:
 *   mind-demo seed [persona...]   Reset and seed the demo DB (default: all personas)
 *   mind-demo reset               Delete the demo DB
 *   mind-demo summary             Print a per-persona metrics summary from the demo DB
 *
 * The demo DB never touches ~/.local/share/mind/mind.db — see seed.ts.
 */

import { sql } from "drizzle-orm";
import { signals, thoughts, actions, directions } from "@mind/core";
import { ALL_PERSONAS, resetDemoDb, seedDemo, demoDbPath } from "./index.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/demo-data/dist/cli.js -> walk up to workspace root -> directions/
const DIRECTIONS_ROOT = join(__dirname, "..", "..", "..", "directions");

const [, , command, ...args] = process.argv;

switch (command) {
  case "seed": {
    resetDemoDb();
    const requested = args.length > 0
      ? ALL_PERSONAS.filter((p) => args.includes(p.id))
      : ALL_PERSONAS;

    if (requested.length === 0) {
      console.error(`No matching persona. Choices: ${ALL_PERSONAS.map((p) => p.id).join(", ")}`);
      process.exit(1);
    }

    const { results } = await seedDemo(DIRECTIONS_ROOT, requested);

    console.log(`Seeded demo database at ${demoDbPath()}\n`);
    for (const r of results) {
      const persona = ALL_PERSONAS.find((p) => p.id === r.personaId)!;
      console.log(`${persona.displayName} (${r.personaId})`);
      console.log(`  ${persona.pitch}\n`);
      console.log(
        `  signals: ${r.signalsIngested}  sent: ${r.actionsSent}  discarded: ${r.actionsDiscarded}  learning proposals: ${r.learningProposals}\n`,
      );
    }
    break;
  }

  case "reset": {
    resetDemoDb();
    console.log(`Removed demo database at ${demoDbPath()}`);
    break;
  }

  case "summary": {
    const { openDb } = await import("@mind/core");
    const db = openDb(demoDbPath());

    const signalCount = db.select({ count: sql<number>`count(*)` }).from(signals).get();
    const thoughtCount = db.select({ count: sql<number>`count(*)` }).from(thoughts).get();
    const absorbed = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(sql`${signals.disposition} = 'absorbed'`)
      .get();
    const escalated = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(sql`${signals.disposition} = 'escalated'`)
      .get();
    const sent = db.select({ count: sql<number>`count(*)` }).from(actions).where(sql`${actions.status} = 'sent'`).get();
    const discarded = db.select({ count: sql<number>`count(*)` }).from(actions).where(sql`${actions.status} = 'discarded'`).get();
    const disabledDirs = db.select({ id: directions.id, name: directions.name }).from(directions).where(sql`${directions.enabled} = 0`).all();

    const s = signalCount?.count ?? 0;
    const t = thoughtCount?.count ?? 0;

    console.log(`Signals:            ${s}`);
    console.log(`Thoughts:           ${t}`);
    console.log(`Signal/Thought ratio: ${t > 0 ? (s / t).toFixed(2) : "n/a"}`);
    console.log(`Absorbed:           ${absorbed?.count ?? 0}`);
    console.log(`Escalated:          ${escalated?.count ?? 0}`);
    console.log(`Actions sent:       ${sent?.count ?? 0}`);
    console.log(`Actions discarded:  ${discarded?.count ?? 0}`);
    console.log(`Auto-disabled directions: ${disabledDirs.map((d) => d.name).join(", ") || "none"}`);
    break;
  }

  default: {
    console.log(
      [
        "mind-demo — seed, reset, or summarize the demo database",
        "",
        "Commands:",
        "  mind-demo seed [persona...]   Reset and seed (default: all personas)",
        `                                Choices: ${ALL_PERSONAS.map((p) => p.id).join(", ")}`,
        "  mind-demo reset               Delete the demo database",
        "  mind-demo summary             Print a metrics summary",
      ].join("\n"),
    );
    if (command && command !== "help") {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
  }
}
