/**
 * Adapters and the default registration used by the server.
 *
 * Every source is in-process and isolated behind the Adapter contract, so the
 * pipeline never imports an API shape and a broken source cannot take the
 * others down: start() logs "not configured" and returns.
 */

import type { AdapterRegistry } from "@mind/pipeline";
import { CalendarAdapter } from "./calendar/adapter.js";
import { GmailAdapter } from "./gmail/adapter.js";
import { GitHubAdapter } from "./github/adapter.js";
import { GmessagesAdapter } from "./gmessages/adapter.js";
import { OutlookAdapter } from "./outlook/adapter.js";

export * from "./errors.js";
export * from "./calendar/adapter.js";
export * from "./calendar/google.js";
export * from "./calendar/ics.js";
export * from "./gmail/adapter.js";
export * from "./gmail/client.js";
export * from "./github/adapter.js";
export * from "./github/client.js";
export * from "./gmessages/adapter.js";
export * from "./gmessages/protocol.js";
export * from "./gmessages/reader.js";
export * from "./google/auth.js";
export * from "./outlook/adapter.js";
export * from "./outlook/auth.js";
export * from "./outlook/client.js";

// Mappers share helper names (`toSignal`, `stripHtml`), so they are namespaced.
export * as gmailMapping from "./gmail/mapper.js";
export * as githubMapping from "./github/mapper.js";
export * as gmessagesMapping from "./gmessages/mapping.js";
export * as outlookMapping from "./outlook/mapper.js";

export function registerDefaultAdapters(registry: AdapterRegistry): void {
  // One adapter per configured account, so a send resolves to the mailbox or
  // bridge that received the signal. Unconfigured sources still register one
  // idle adapter, which keeps /health and `mind doctor` honest.
  for (const adapter of GmailAdapter.allFromConfig()) registry.register(adapter);
  for (const adapter of GitHubAdapter.allFromConfig()) registry.register(adapter);
  for (const adapter of GmessagesAdapter.allFromConfig()) registry.register(adapter);
  registry.register(CalendarAdapter.fromConfig());
  for (const adapter of OutlookAdapter.allFromConfig()) registry.register(adapter);
}
