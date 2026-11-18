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
import { GmessagesAdapter } from "./gmessages/adapter.js";
import { OutlookAdapter } from "./outlook/adapter.js";
import { TeamsAdapter } from "./teams/adapter.js";

export * from "./errors.js";
export * from "./calendar/adapter.js";
export * from "./calendar/google.js";
export * from "./calendar/ics.js";
export * from "./gmail/adapter.js";
export * from "./gmail/client.js";
export * from "./gmessages/adapter.js";
export * from "./gmessages/protocol.js";
export * from "./gmessages/reader.js";
export * from "./google/auth.js";
export * from "./outlook/adapter.js";
export * from "./outlook/auth.js";
export * from "./outlook/client.js";
export * from "./teams/adapter.js";

// Mappers share helper names (`toSignal`, `stripHtml`), so they are namespaced.
export * as gmailMapping from "./gmail/mapper.js";
export * as gmessagesMapping from "./gmessages/mapping.js";
export * as outlookMapping from "./outlook/mapper.js";
export * as teamsMapping from "./teams/mapper.js";

export function registerDefaultAdapters(registry: AdapterRegistry): void {
  registry.register(new GmailAdapter());
  registry.register(GmessagesAdapter.fromConfig());
  registry.register(new CalendarAdapter());
  registry.register(new TeamsAdapter());
  registry.register(new OutlookAdapter());
}
