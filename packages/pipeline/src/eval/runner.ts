/**
 * Runs labelled fixtures through the real `ingest()`.
 *
 * No model is called unless `live` is set. Each fixture gets its own in-memory
 * database, so one case cannot change another. Nothing is sent: the test adapter
 * counts `send()` calls, and `MIND_SEND_ENABLED` is removed for the run. A send
 * that happens anyway is a gate violation.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import type { Adapter, NewSignal, OutboundDraft, SendResult } from "@mind/core";
import { aiProvider, classifyModel, signals as signalsTable, thoughts } from "@mind/core";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { AdapterRegistry } from "../adapter-registry.js";
import { loadDirections } from "../directions-loader.js";
import { ensureFallbackDirection } from "../fallback-direction.js";
import { type IngestOverrides, ingest } from "../ingest.js";
import { LINK_PROMPT_VERSION } from "../link.js";
import { CLASSIFY_PROMPT_VERSION, DRAFT_PROMPT_VERSION } from "../prompt-versions.js";
import { evalDataDir, type Fixture } from "./fixtures.js";
import { computeMetrics, type FixtureOutcome, type Metrics } from "./metrics.js";

const EVAL_ADAPTER = "eval-email";
/** Fixed so deadline grounding and ordering are the same on every run. */
const RECEIVED_AT = new Date("2026-03-02T09:00:00.000Z");

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "core",
  "migrations",
);

class CountingAdapter implements Adapter {
  readonly id = EVAL_ADAPTER;
  readonly capabilities = { canSend: true, canStream: false };
  sends = 0;
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_draft: OutboundDraft): Promise<SendResult> {
    this.sends++;
    return { externalId: `eval-sent-${this.sends}` };
  }
}

export interface EvalReport {
  readonly model: string;
  readonly promptVersions: Readonly<Record<string, string>>;
  readonly date: string;
  readonly live: boolean;
  readonly fixtures: number;
  /** Fixtures whose recorded answer only a live run can confirm. */
  readonly liveChecks: number;
  readonly outcomes: readonly FixtureOutcome[];
  readonly metrics: Metrics;
}

export interface RunOptions {
  /** Use the configured model instead of the recorded output. Manual only. */
  readonly live?: boolean;
  readonly directionsDir?: string;
  /** Injected so a test can pin the date in the report. */
  readonly now?: () => Date;
}

function openDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => sqlite.close() };
}

async function runOne(
  fixture: Fixture,
  live: boolean,
  directionsDir: string,
  adapter: CountingAdapter,
): Promise<FixtureOutcome> {
  const base = {
    id: fixture.id,
    known: fixture.known,
    expectedDirectionId: fixture.expected.directionId,
    expectedSurfaced: fixture.expected.surfaced,
  };
  const { db, close } = openDb();
  try {
    ensureFallbackDirection(db);
    loadDirections(db, directionsDir);

    const adapters = new AdapterRegistry();
    adapters.register(adapter);

    const signal: NewSignal = {
      adapter: EVAL_ADAPTER,
      externalId: fixture.id,
      threadId: fixture.signal.threadId,
      sender: fixture.signal.sender,
      recipients: ["me@eval.test"],
      kind: "email",
      ...(fixture.signal.subject === null ? {} : { subject: fixture.signal.subject }),
      body: fixture.signal.body,
      receivedAt: RECEIVED_AT,
      urgencyHint: null,
    };
    const overrides: IngestOverrides = live
      ? {}
      : {
          classifierOutput: fixture.recorded.classifier,
          draftBody: fixture.recorded.draft,
          transformedSummary: null,
          linkOutput: null,
        };

    const result = await ingest(db, signal, adapters, overrides);
    const row = result.signalId
      ? db.select().from(signalsTable).where(eq(signalsTable.id, result.signalId)).get()
      : undefined;
    const thoughtCreated = result.thoughtId
      ? db.select().from(thoughts).where(eq(thoughts.id, result.thoughtId)).get() !== undefined
      : false;

    return {
      ...base,
      error: null,
      directionId: row?.directionId ?? null,
      disposition: result.disposition,
      thoughtCreated,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
      directionId: null,
      disposition: "error",
      thoughtCreated: false,
    };
  } finally {
    close();
  }
}

export async function runEval(
  fixtures: readonly Fixture[],
  options: RunOptions = {},
): Promise<EvalReport> {
  const live = options.live === true;
  const directionsDir = options.directionsDir ?? join(evalDataDir(), "directions");
  const adapter = new CountingAdapter();

  // The send gate under test must be closed, whatever the caller's environment says.
  const previous = process.env["MIND_SEND_ENABLED"];
  delete process.env["MIND_SEND_ENABLED"];
  // Recorded runs use the default sensitive topics, not the operator's own list,
  // so the report is the same on every machine. A live run keeps the real config.
  const previousConfigDir = process.env["MIND_CONFIG_DIR"];
  if (!live) process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-eval-config-"));
  const outcomes: FixtureOutcome[] = [];
  try {
    for (const fixture of fixtures) {
      outcomes.push(await runOne(fixture, live, directionsDir, adapter));
    }
  } finally {
    if (previous !== undefined) process.env["MIND_SEND_ENABLED"] = previous;
    if (!live) {
      if (previousConfigDir === undefined) delete process.env["MIND_CONFIG_DIR"];
      else process.env["MIND_CONFIG_DIR"] = previousConfigDir;
    }
  }

  return {
    model: live ? `${aiProvider()}:${classifyModel()}` : "stub (recorded output)",
    // Classify and draft prompts are not versioned yet (ai-quality.md asks for it).
    promptVersions: {
      link: String(LINK_PROMPT_VERSION),
      classify: String(CLASSIFY_PROMPT_VERSION),
      draft: String(DRAFT_PROMPT_VERSION),
    },
    date: (options.now ?? (() => new Date()))().toISOString().slice(0, 10),
    live,
    fixtures: fixtures.length,
    liveChecks: fixtures.filter((f) => f.liveCheck).length,
    outcomes,
    metrics: computeMetrics(outcomes, adapter.sends),
  };
}
