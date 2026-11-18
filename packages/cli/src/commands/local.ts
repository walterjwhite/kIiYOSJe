/** Commands that touch the database file directly; no server required. */

import { existsSync, statSync } from "node:fs";
import {
  accountCredential,
  aiConfigured,
  aiProvider,
  credentialAccounts,
  credentialString,
  dbPath,
  isPaused,
  listSnapshots,
  loadCredentials,
  operatorAddresses,
  pause,
  resume,
  restore,
  snapshot,
  tokenPath,
} from "@mind/core";
import { api, print } from "../client.js";

export function pauseSends(): void {
  pause();
  console.log("sends paused — proposals stay, nothing is written");
}

export function resumeSends(): void {
  resume();
  console.log("sends resumed (direction and adapter gates still apply)");
}

export async function takeSnapshot(label?: string): Promise<void> {
  console.log(`snapshot written: ${await snapshot(label)}`);
}

export function snapshots(): void {
  print(listSnapshots());
}

export async function restoreSnapshot(label: string): Promise<void> {
  if (!label) throw new Error("usage: mind restore <label>");
  print(await restore(label));
}

/**
 * One command to answer "can I start live testing today, and what is missing".
 * Read-only: it never creates credentials and never sends anything.
 */
export async function doctor(): Promise<void> {
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
  const check = (label: string, ok: boolean, detail: string): void => {
    checks.push({ label, ok, detail });
  };

  const token = tokenPath();
  check(
    "api token",
    existsSync(token),
    existsSync(token) ? token : "missing — run `mind start` once",
  );

  const database = dbPath();
  const dbExists = existsSync(database);
  check(
    "database",
    dbExists,
    dbExists
      ? `${database} (${(statSync(database).size / 1024).toFixed(0)} KiB)`
      : `missing — run \`mind start\` once (${database})`,
  );

  const provider = aiProvider();
  const configured = aiConfigured();
  check(
    "model provider",
    configured,
    `${provider}${configured ? "" : " — no API key configured"}`,
  );

  const googleAccounts = credentialAccounts("google").filter(
    (account) =>
      accountCredential(account, "refreshToken", "MIND_GOOGLE_REFRESH_TOKEN") !==
      undefined,
  );
  const googleCount =
    googleAccounts.length > 0
      ? googleAccounts.length
      : credentialString("google", "refreshToken", "MIND_GOOGLE_REFRESH_TOKEN")
        ? 1
        : 0;
  const google = googleCount > 0;
  check(
    "gmail",
    google,
    google
      ? `${googleCount} google account${googleCount === 1 ? "" : "s"}`
      : "no google.refreshToken or google.accounts — see LIVE.md §2",
  );

  const ics = credentialString("calendar", "icsUrl", "MIND_CALENDAR_ICS_URL");
  const listedCalendars = loadCredentials()["calendar"]?.["sources"];
  const calendarCount = Array.isArray(listedCalendars)
    ? listedCalendars.filter(
        (entry) =>
          typeof entry === "string" ||
          (entry !== null && typeof entry === "object"),
      ).length
    : 0;
  check(
    "calendar",
    Boolean(google || ics || calendarCount > 0),
    calendarCount > 0
      ? `${calendarCount} calendar source${calendarCount === 1 ? "" : "s"}`
      : google
        ? `${googleCount} google account${googleCount === 1 ? "" : "s"}`
        : ics
          ? "iCal feed configured"
          : "needs google.accounts or calendar.sources — LIVE.md §3",
  );

  const githubAccounts = credentialAccounts("github").filter(
    (account) =>
      accountCredential(account, "token", "GITHUB_TOKEN") !== undefined,
  );
  const githubCount =
    githubAccounts.length > 0
      ? githubAccounts.length
      : credentialString("github", "token", "GITHUB_TOKEN") ??
          credentialString("github", "token", "MIND_GITHUB_TOKEN")
        ? 1
        : 0;
  check(
    "github pull requests",
    githubCount > 0,
    githubCount > 0
      ? `${githubCount} token${githubCount === 1 ? "" : "s"}`
      : "no github.token or github.accounts — see LIVE.md §4",
  );

  const smsAccounts = credentialAccounts("gmessages").filter(
    (account) =>
      accountCredential(account, "accessToken", "MIND_GMESSAGES_ACCESS_TOKEN") !==
      undefined,
  );
  const matrixToken =
    smsAccounts.length > 0
      ? "configured"
      : credentialString(
          "gmessages",
          "accessToken",
          "MIND_GMESSAGES_ACCESS_TOKEN",
        );
  const homeserver = credentialString(
    "gmessages",
    "homeserverUrl",
    "MIND_GMESSAGES_HOMESERVER_URL",
  );
  check(
    "sms (google messages bridge)",
    Boolean(matrixToken),
    matrixToken
      ? smsAccounts.length > 0
        ? `${smsAccounts.length} bridge account${smsAccounts.length === 1 ? "" : "s"}, homeserver ${homeserver ?? "http://localhost:8008"}`
        : `homeserver ${homeserver ?? "http://localhost:8008"}`
      : "no gmessages.accessToken — see LIVE.md §5",
  );

  const addresses = operatorAddresses();
  check(
    "operator addresses",
    addresses.length > 0,
    addresses.length > 0
      ? addresses.join(", ")
      : "no operator.addresses — reply tracking can't tell my messages from theirs",
  );

  check(
    "sends",
    !isPaused(),
    isPaused()
      ? "PAUSED — `mind resume` when ready"
      : "not paused; MIND_SEND_ENABLED still gates autonomous sends",
  );

  let serverDetail = "reachable";
  try {
    await api("/health");
  } catch {
    serverDetail = "unreachable — start it with `npm run dev`";
  }
  check("server", serverDetail === "reachable", serverDetail);

  for (const entry of checks) {
    console.log(
      `${entry.ok ? "ok  " : "MISS"}  ${entry.label.padEnd(28)} ${entry.detail}`,
    );
  }

  const missing = checks.filter((entry) => !entry.ok).length;
  console.log(
    `\n${checks.length - missing}/${checks.length} ready.` +
      (missing > 0
        ? ` ${missing} to fix before live testing.`
        : " Nothing is sent until you approve a draft."),
  );
}
