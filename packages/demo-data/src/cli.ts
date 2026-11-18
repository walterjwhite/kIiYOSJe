#!/usr/bin/env node
/**
 * mind-demo CLI — seed, reset, or summarize the demo database.
 *
 * Usage:
 *   mind-demo seed [persona...]   Reset and seed the demo DB (default: all personas)
 *   mind-demo reset               Delete the demo DB
 *   mind-demo summary             Print a per-persona metrics summary from the demo DB
 *
 * The demo DB never touches ~/.data/kIiYOSJe/mind/mind.db — see seed.ts.
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
    const { aiConfigured, aiProvider } = await import("@mind/core");
    if (!aiConfigured()) {
      console.error(
        [
          "No AI provider is configured — classify()/draft() would run as stubs and",
          "every signal would simply escalate. Configure one first:",
          "",
          "  Local (free, no key): start Ollama (`ollama serve`) and pull a model",
          "  (`ollama pull qwen2.5:3b-instruct`). ollama is the default provider,",
          "  so no further config is needed once it's running.",
          "",
          "  Cloud: use the 'mind: Configure AI Provider' command in VS Code, or",
          "  write ~/.config/kIiYOSJe/mind/ai.json directly.",
        ].join("\n"),
      );
      process.exit(1);
    }
    console.log(`Using provider: ${aiProvider()}. This calls a real model for every signal — expect this to take a while.\n`);

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
        `  signals: ${r.signalsIngested}  historical sent: ${r.historicalResolved.sent}  historical discarded: ${r.historicalResolved.discarded}  live proposed: ${r.liveLeftProposed}  learning proposals: ${r.learningProposals}\n`,
      );
    }
    console.log(
      "Open the mind extension in VS Code and work the Review panel — the live-era\nsignals above are real proposed actions waiting for you, produced by the\nconfigured AI provider, not scripted.",
    );
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
