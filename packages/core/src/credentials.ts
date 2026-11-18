/**
 * Adapter credentials: environment first, then ~/.config/kIiYOSJe/mind/credentials.yml.
 *
 * A section can describe one account (the original flat shape) or several:
 *
 *   google:
 *     clientId: "..."
 *     clientSecret: "..."
 *     refreshToken: "..."          # the default account
 *     accounts:
 *       - label: work
 *         address: me@work.example
 *         refreshToken: "..."
 *       - label: personal
 *         address: me@personal.example
 *         refreshToken: "..."
 *
 * Shared keys (an OAuth client id/secret, a homeserver URL) apply to every
 * account; identity keys (tokens, mailbox addresses, labels) stay per account.
 * A missing file yields no accounts so every adapter degrades to "not
 * configured" instead of failing startup. The file is re-read when its mtime
 * changes, so rotating a token needs no restart.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configDir } from "./config.js";

export type CredentialSection = Record<string, unknown>;
export type Credentials = Record<string, CredentialSection>;

/** One account of one source, with shared section keys already merged in. */
export interface CredentialAccount {
  /** Stable name used in adapter ids and on signals. `default` for the flat shape. */
  label: string;
  /** The credentials.yml section this account came from (`google`, `outlook`, …). */
  section: string;
  config: CredentialSection;
}

/**
 * Keys that belong to one account rather than the whole section. Everything
 * else in a section is shared by every account in it.
 */
const ACCOUNT_IDENTITY_KEYS: Record<string, readonly string[]> = {
  google: ["refreshToken", "address", "label"],
  outlook: ["refreshToken", "user", "address", "label"],
  gmessages: ["accessToken", "userId", "address", "label"],
  github: ["token", "address", "label"],
};

const DEFAULT_IDENTITY_KEYS: readonly string[] = ["label"];

let cached: { at: number; value: Credentials } | undefined;

export function credentialsPath(): string {
  return `${configDir()}/credentials.yml`;
}

export function loadCredentials(): Credentials {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  const mtime = statSync(path).mtimeMs;
  if (cached?.at === mtime) return cached.value;

  const parsed = parseYaml(readFileSync(path, "utf8")) as unknown;
  const value =
    parsed && typeof parsed === "object" ? (parsed as Credentials) : {};
  cached = { at: mtime, value };
  return value;
}

/** Environment first, then the named section of credentials.yml. */
export function credentialString(
  section: string,
  key: string,
  envVar: string,
): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  const value = loadCredentials()[section]?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Resets the credential cache — tests replace the file between cases. */
export function resetCredentialCache(): void {
  cached = undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Every account configured under `section`, in file order.
 *
 * The flat section still means one account, labelled `default`; an `accounts`
 * list is additive, so adding a second mailbox does not require moving the
 * first token. Environment variables only fill the `default` account, since
 * they have no label to disambiguate by.
 */
export function credentialAccounts(section: string): CredentialAccount[] {
  const raw = loadCredentials()[section];
  if (!raw || typeof raw !== "object") return [];

  const identityKeys = ACCOUNT_IDENTITY_KEYS[section] ?? DEFAULT_IDENTITY_KEYS;
  const accounts: CredentialAccount[] = [];
  const usedLabels = new Set<string>();

  const add = (label: string, config: CredentialSection): void => {
    let unique = label;
    for (let i = 2; usedLabels.has(unique); i += 1) unique = `${label}-${i}`;
    usedLabels.add(unique);
    accounts.push({ label: unique, section, config });
  };

  const shared = Object.fromEntries(
    Object.entries(raw).filter(
      ([key]) =>
        key !== "accounts" && !(identityKeys as readonly string[]).includes(key),
    ),
  );

  // The flat block is the default account whenever it carries an identity key
  // (a token, mailbox user, phone number). Shared-only blocks do not. It stays
  // first so callers that fall back to "the first source/account" keep using
  // the one the operator already had.
  const hasFlatIdentity = identityKeys.some(
    (key) => nonEmptyString(raw[key]) !== undefined,
  );
  if (hasFlatIdentity) {
    const config = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "accounts"),
    );
    add("default", config);
  }

  const list = raw["accounts"];
  if (Array.isArray(list)) {
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const fields = entry as CredentialSection;
      const label = nonEmptyString(fields["label"]) ?? `account-${index + 1}`;
      add(label, { ...shared, ...fields });
    });
  }

  return accounts;
}

/**
 * One key for one account, with the environment filling in only the default
 * account. Returns undefined rather than an empty string so callers can treat
 * a blank YAML value as missing.
 */
export function accountCredential(
  account: CredentialAccount,
  key: string,
  envVar?: string,
): string | undefined {
  const direct = nonEmptyString(account.config[key]);
  if (direct) return direct;
  if (account.label === "default" && envVar) {
    return nonEmptyString(process.env[envVar]);
  }
  return undefined;
}

/** `gmail` for the default account, `gmail:work` for a labelled one. */
export function adapterIdForAccount(base: string, account: string): string {
  return account === "default" ? base : `${base}:${account}`;
}

/** `gmail:work` → `work`; `gmail` → `default`. */
export function accountFromAdapterId(base: string, id: string): string {
  return id === base ? "default" : (id.slice(base.length + 1) || "default");
}

/**
 * The mailbox/phone number an account belongs to, when the file says so.
 * Used for the outbound `From:` address and for the built-in "is this me"
 * list, so a second account does not look like an inbound stranger.
 */
export function accountAddress(account: CredentialAccount): string | undefined {
  return nonEmptyString(account.config["address"]);
}

/**
 * Addresses that count as "me" when deciding if a signal is addressed
 * directly. `operator.addresses` remains the explicit list; every account
 * labelled with an `address` is added automatically.
 */
export function operatorAddresses(): string[] {
  const raw = loadCredentials()["operator"];
  const configured = raw?.["addresses"];
  const addresses: string[] = [];

  if (Array.isArray(configured)) {
    for (const value of configured) {
      if (typeof value === "string" && value.length > 0) addresses.push(value);
    }
  }

  for (const section of ["google", "outlook", "gmessages", "github"]) {
    for (const account of credentialAccounts(section)) {
      const address = accountAddress(account);
      if (address) addresses.push(address);
    }
  }

  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
