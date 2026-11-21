/**
 * `mind demo [persona...]` — seed the demo database with one or more personas.
 *
 * This is the same flow as `npm run demo:seed`, kept in the CLI so the command
 * set matches the monorepo. The demo database is separate from the real one
 * (see packages/demo-data/src/seed.ts).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** packages/cli/dist/commands/demo.js -> workspace root -> directions/ */
function directionsRoot(): string {
  return join(import.meta.dirname, "..", "..", "..", "..", "directions");
}

export async function demo(personas: string[]): Promise<void> {
  const { aiConfigured, aiProvider } = await import("@mind/core");
  if (!aiConfigured()) {
    throw new Error(
      "No AI provider is configured, so classify()/draft() would run as stubs. " +
        "Start Ollama (the default provider) or configure one via the extension.",
    );
  }
  const { ALL_PERSONAS, demoDbPath, resetDemoDb, seedDemo } = await import("@mind/demo-data");

  const requested =
    personas.length > 0
      ? ALL_PERSONAS.filter((persona) => personas.includes(persona.id))
      : ALL_PERSONAS;
  if (requested.length === 0) {
    throw new Error(`No matching persona. Choices: ${ALL_PERSONAS.map((p) => p.id).join(", ")}`);
  }

  console.log(
    `Using provider: ${aiProvider()}. This calls a real model for every signal — expect this to take a while.\n`,
  );
  resetDemoDb();
  const root = directionsRoot();
  if (!existsSync(root)) {
    throw new Error(`directions directory not found at ${root}`);
  }
  const { results } = await seedDemo(root, requested);
  console.log(`Seeded demo database at ${demoDbPath()}\n`);
  for (const result of results) {
    console.log(`${result.personaId}: ${result.signalsIngested} signals ingested`);
  }
}
