/**
 * node packages/pipeline/dist/eval/cli.js [--live] [--json]
 *
 * Default: recorded model output, no network, safe for CI.
 * --live: the configured model classifies and drafts. Manual only; the result
 * goes in the PR that changes a prompt or a model (`ai-quality.md`).
 * Exit code 1 when a counted fixture fails or a send happened, 2 on a bad
 * fixture file.
 *
 * Pipeline logs are silenced so stdout holds only the report. Set
 * MIND_LOG_LEVEL to see them (they go to mind.log in a temporary directory).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<number> {
  // The logger writes to stdout in development and to a file in the data
  // directory otherwise. Use the file mode, silenced, with the data directory in
  // a temporary folder, so the report is the only output and nothing is written
  // to the operator's data directory. The config directory is left alone so
  // --live finds the configured model.
  process.env["MIND_LOG_JSON"] = "true";
  process.env["MIND_LOG_LEVEL"] ??= "silent";
  process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-eval-"));
  // Loaded after the log level is set: the logger reads it when it is created.
  const { loadFixtures } = await import("./fixtures.js");
  const { formatJson, formatReport } = await import("./report.js");
  const { runEval } = await import("./runner.js");

  const args = new Set(process.argv.slice(2));
  const report = await runEval(loadFixtures(), { live: args.has("--live") });
  process.stdout.write(args.has("--json") ? formatJson(report) : formatReport(report));
  return report.metrics.failures.length > 0 || report.metrics.gateViolations > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  },
);
