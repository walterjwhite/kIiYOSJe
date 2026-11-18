#!/usr/bin/env node
/**
 * mind — local attention manager.
 *
 *   mind start                 start the server, adapters, and jobs
 *   mind health                server + adapter status
 *   mind metrics [7d]          signals/thoughts ratio and rates
 *   mind coverage [12]         absorb rate per week against coverage
 *   mind preview <id> [--classify]  dry-run a Direction, writes nothing
 *   mind explain <signalId>    why one decision happened
 *   mind doctor                what is configured and what is missing
 *   mind observe               current metrics
 *   mind proposals [status]    Direction proposals awaiting a decision
 *   mind capture <title>       create a Thought by hand
 *   mind demo [persona...]     seed the demo database
 *   mind snapshot [label]      archive the database before a risky change
 *   mind snapshots             list archived databases
 *   mind restore <label>       put an archive back
 *   mind pause | resume        the send kill switch
 */

import {
  capture,
  coverage,
  explain,
  health,
  metrics,
  observe,
  preview,
  proposals,
} from "./commands/api.js";
import { demo } from "./commands/demo.js";
import {
  doctor,
  pauseSends,
  resumeSends,
  restoreSnapshot,
  snapshots,
  takeSnapshot,
} from "./commands/local.js";

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "start": {
      const { startServer } = await import("@mind/server");
      await startServer();
      break;
    }
    case "pause":
      pauseSends();
      break;
    case "resume":
      resumeSends();
      break;
    case "health":
      await health();
      break;
    case "metrics":
      await metrics(args[0] ?? "7d");
      break;
    case "coverage":
      await coverage(args[0] ?? "12");
      break;
    case "preview":
      await preview(args[0] ?? "", args.includes("--classify"));
      break;
    case "explain":
      await explain(args[0] ?? "");
      break;
    case "doctor":
      await doctor();
      break;
    case "observe":
      await observe();
      break;
    case "proposals":
      await proposals(args[0] ?? "pending");
      break;
    case "capture":
      await capture(args.join(" ").trim());
      break;
    case "demo":
      await demo(args);
      break;
    case "snapshot":
      await takeSnapshot(args[0]);
      break;
    case "snapshots":
      snapshots();
      break;
    case "restore":
      await restoreSnapshot(args[0] ?? "");
      break;
    default:
      console.log(
        [
          "mind — local attention manager",
          "",
          "  mind start               start the server and all adapters",
          "  mind health              server and adapter status",
          "  mind metrics [7d]        signals/thoughts ratio for a window",
          "  mind coverage [12]       absorb rate per week against coverage",
          "  mind preview <id>        dry-run a Direction over stored signals",
          "  mind explain <signalId>  why one decision happened",
          "  mind doctor              what is configured and what is missing",
          "  mind observe             current metrics",
          "  mind proposals [status]  Direction proposals (default: pending)",
          "  mind capture <title>     record a Thought",
          "  mind demo [persona...]   seed the demo database",
          "  mind snapshot [label]    archive the database",
          "  mind snapshots           list archives",
          "  mind restore <label>     put an archive back",
          "  mind pause               stop every send immediately",
          "  mind resume              re-enable sends",
        ].join("\n"),
      );
      if (command) process.exitCode = 1;
  }
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exitCode = 1;
}
