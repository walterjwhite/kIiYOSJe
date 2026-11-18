import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adapterIdForAccount,
  credentialAccounts,
  operatorAddresses,
  resetCredentialCache,
} from "./credentials.js";

let dir: string;
let previousConfigDir: string | undefined;

const ENV_KEYS = [
  "MIND_GOOGLE_CLIENT_ID",
  "MIND_GOOGLE_CLIENT_SECRET",
  "MIND_GOOGLE_REFRESH_TOKEN",
  "MIND_GMESSAGES_ACCESS_TOKEN",
  "MIND_GMESSAGES_HOMESERVER_URL",
];

function writeCredentials(body: string): void {
  writeFileSync(join(dir, "credentials.yml"), body, "utf8");
  resetCredentialCache();
}

beforeEach(() => {
  previousConfigDir = process.env["MIND_CONFIG_DIR"];
  dir = mkdtempSync(join(tmpdir(), "mind-credentials-"));
  process.env["MIND_CONFIG_DIR"] = dir;
  for (const key of ENV_KEYS) delete process.env[key];
  resetCredentialCache();
});

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env["MIND_CONFIG_DIR"];
  else process.env["MIND_CONFIG_DIR"] = previousConfigDir;
  for (const key of ENV_KEYS) delete process.env[key];
  resetCredentialCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("credentialAccounts", () => {
  it("keeps the flat section as the default account", () => {
    writeCredentials(
      [
        "google:",
        '  clientId: "client"',
        '  clientSecret: "secret"',
        '  refreshToken: "default-token"',
      ].join("\n"),
    );

    const accounts = credentialAccounts("google");
    expect(accounts.map((account) => account.label)).toEqual(["default"]);
    expect(accounts[0]?.config["refreshToken"]).toBe("default-token");
    expect(accounts[0]?.config["clientId"]).toBe("client");
  });

  it("merges shared keys into every labelled account", () => {
    writeCredentials(
      [
        "google:",
        '  clientId: "client"',
        '  clientSecret: "secret"',
        '  refreshToken: "default-token"',
        "  accounts:",
        "    - label: work",
        "      address: me@work.example",
        '      refreshToken: "work-token"',
        "    - label: personal",
        '      refreshToken: "personal-token"',
      ].join("\n"),
    );

    const accounts = credentialAccounts("google");
    expect(accounts.map((account) => account.label)).toEqual([
      "default",
      "work",
      "personal",
    ]);
    const work = accounts.find((account) => account.label === "work");
    expect(work?.config["refreshToken"]).toBe("work-token");
    expect(work?.config["clientId"]).toBe("client");
    expect(work?.config["address"]).toBe("me@work.example");
  });

  it("does not invent a default account when only accounts are configured", () => {
    writeCredentials(
      [
        "outlook:",
        '  tenantId: "tenant"',
        '  clientId: "client"',
        '  clientSecret: "secret"',
        "  accounts:",
        "    - label: work",
        "      user: team@work.example",
      ].join("\n"),
    );

    expect(credentialAccounts("outlook").map((account) => account.label)).toEqual(
      ["work"],
    );
  });

  it("names unnamed entries and keeps labels unique", () => {
    writeCredentials(
      [
        "gmessages:",
        '  homeserverUrl: "http://bridge:8008"',
        "  accounts:",
        '    - accessToken: "one"',
        "    - label: work",
        '      accessToken: "two"',
        "    - label: work",
        '      accessToken: "three"',
      ].join("\n"),
    );

    const accounts = credentialAccounts("gmessages");
    expect(accounts.map((account) => account.label)).toEqual([
      "account-1",
      "work",
      "work-2",
    ]);
    expect(accounts.every((account) => account.config["homeserverUrl"])).toBe(
      true,
    );
  });

  it("returns nothing for an absent section", () => {
    writeCredentials("");
    expect(credentialAccounts("google")).toEqual([]);
  });
});

describe("adapterIdForAccount", () => {
  it("keeps the plain id for the default account", () => {
    expect(adapterIdForAccount("gmail", "default")).toBe("gmail");
  });

  it("namespaces labelled accounts", () => {
    expect(adapterIdForAccount("gmail", "work")).toBe("gmail:work");
    expect(adapterIdForAccount("gmessages", "home")).toBe("gmessages:home");
  });
});

describe("operatorAddresses", () => {
  it("includes account addresses automatically and removes duplicates", () => {
    writeCredentials(
      [
        "operator:",
        "  addresses:",
        "    - me@example.com",
        "google:",
        '  refreshToken: "token"',
        "  accounts:",
        "    - label: work",
        "      address: me@work.example",
        '      refreshToken: "work-token"',
        "    - label: duplicate",
        "      address: ME@example.com",
        '      refreshToken: "other-token"',
      ].join("\n"),
    );

    expect(operatorAddresses()).toEqual(["me@example.com", "me@work.example"]);
  });
});
