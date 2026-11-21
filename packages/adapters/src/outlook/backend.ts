/**
 * Which Outlook transport the adapter uses.
 *
 * This tree ships the Microsoft Graph transport only. The Outlook Web client
 * lives in `@walterjwhite/lib` (not published), so `owa` is rejected loudly
 * instead of being silently downgraded — a mailbox that quietly stopped
 * polling is worse than a startup error.
 */

import { AdapterNotConfiguredError } from "../errors.js";
import { credentialString } from "@mind/core";

export type OutlookBackendName = "graph";

export function outlookBackend(): OutlookBackendName {
  const configured = credentialString("outlook", "backend", "MIND_OUTLOOK_BACKEND");
  if (configured?.trim().toLowerCase() === "owa") {
    throw new AdapterNotConfiguredError(
      "outlook",
      "owa backend (Graph only here; set outlook.backend: graph)",
    );
  }
  return "graph";
}
