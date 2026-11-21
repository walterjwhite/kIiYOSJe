/**
 * Device pairing and per-device permissions.
 *
 * A paired device is not a second account: it is a second client for the same
 * operator. It gets its own random credential, stored only as a SHA-256 hash,
 * and a closed set of scopes. Revoking one device never touches another, and
 * takes effect on its next request because the server looks the token up on
 * every call (see packages/server/src/auth.ts).
 *
 * Pairing itself is a short-lived six-digit code the editor shows and the new
 * device types in. The code is stored hashed, expires after ten minutes, and
 * can be tried only a handful of times.
 *
 * Everything here is pure so the rules are testable without a server, a clock,
 * or a filesystem. The server owns the rows.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * What a paired device may do. Deliberately coarse: a new phone defaults to
 * `read` + `capture`, the least it needs to show the Queue and add a thought.
 *
 *   read      list the Queue, signals, thoughts, directions, metrics
 *   capture   add a thought or journal note, acknowledge a signal
 *   send      approve or discard a drafted reply, edit a draft
 *   render    audio summary (the one route that asks for more than plain read)
 *   settings  change admin settings, Directions, goal links, queue order
 *
 * Device management (`/devices*`) is never available to a device token, so a
 * stolen phone cannot revoke or re-scope the editor; only the master token can.
 */
export const DEVICE_SCOPES = ["read", "capture", "send", "render", "settings"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];
export const DeviceScopeSchema = z.enum(DEVICE_SCOPES);

/** Pairing codes are valid for ten minutes, as the mockup and TODO.md describe. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

/** Five wrong tries per code, then the row is dead even if not yet expired. */
export const MAX_PAIRING_ATTEMPTS = 5;

/** SHA-256, hex. Used for pairing codes and device tokens alike: the plaintext
 *  exists only in the response that creates it and in the device's own store. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A fresh 256-bit device credential, URL-safe so it survives headers and JSON. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A six-digit code with leading zeros kept. `randomInt` is injectable so a test
 * can pin the value; production passes Node's CSPRNG.
 */
export function generatePairingCode(
  randomIntFn: (min: number, max: number) => number = randomInt,
): string {
  return String(randomIntFn(0, 1_000_000)).padStart(6, "0");
}

/** ISO-8601 expiry for a code started at `now`. */
export function pairingExpiresAt(now: Date): string {
  return new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
}

/** Whether a stored pairing code may still be exchanged for a device token. */
export function pairingCodeIsUsable(
  row: { readonly expiresAt: string; readonly usedAt: string | null; readonly attempts: number },
  now: Date,
): boolean {
  if (row.usedAt !== null) return false;
  if (row.attempts >= MAX_PAIRING_ATTEMPTS) return false;
  const expiry = Date.parse(row.expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

/** Parses the JSON `scopes` column, dropping anything that is not a known scope. */
export function parseScopes(json: string | null | undefined): DeviceScope[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeScopes(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return [];
  }
}

/** Valid scopes only, deduplicated, in the canonical order. */
export function normalizeScopes(input: readonly string[]): DeviceScope[] {
  const given = new Set(input);
  return DEVICE_SCOPES.filter((scope) => given.has(scope));
}

/** True when a device holding `scopes` may do the thing `needed` names. */
export function hasScope(scopes: readonly DeviceScope[], needed: DeviceScope): boolean {
  return scopes.includes(needed);
}

/**
 * What the server should require for one request from a device token.
 * `master` means only the operator's own token is allowed (device management);
 * `deny` means no device scope grants it at all. Unknown routes default to
 * deny, not to read, so a new route is closed until someone decides otherwise.
 */
export type DeviceAccess =
  | { readonly kind: "scope"; readonly scope: DeviceScope }
  | { readonly kind: "master" }
  | { readonly kind: "deny"; readonly reason: string };

export function deviceAccess(method: string, rawPath: string): DeviceAccess {
  const m = method.toUpperCase();
  const path = (rawPath.split("?")[0] ?? rawPath).replace(/\/+$/, "") || "/";

  // Device registry: list, start pairing, revoke. Master token only.
  if (path === "/devices" || path.startsWith("/devices/")) return { kind: "master" };

  if (m === "GET") {
    // The one read that costs the machine work rather than just data.
    if (path === "/summary" || path.startsWith("/summary/")) {
      return { kind: "scope", scope: "render" };
    }
    return { kind: "scope", scope: "read" };
  }

  // Capture: add something of the operator's own, or mark a signal seen.
  if (m === "POST" && (path === "/thoughts" || path === "/events/notes")) {
    return { kind: "scope", scope: "capture" };
  }
  if (m === "PATCH" && path.startsWith("/thoughts/")) {
    return { kind: "scope", scope: "capture" };
  }
  if ((m === "PUT" || m === "DELETE") && path.endsWith("/reviewed")) {
    return { kind: "scope", scope: "capture" };
  }

  // Anything that decides an outbound action needs the send scope, including
  // editing a draft: an edit is part of authorizing the send.
  if (
    (m === "POST" || m === "PATCH" || m === "DELETE") &&
    (path === "/actions" || path.startsWith("/actions/"))
  ) {
    return { kind: "scope", scope: "send" };
  }

  // Policy and shared state.
  if (
    (m === "PUT" || m === "PATCH" || m === "DELETE") &&
    (path.startsWith("/admin/") ||
      path.startsWith("/directions") ||
      path.startsWith("/signals/") ||
      path.startsWith("/queue/") ||
      path.startsWith("/proposals"))
  ) {
    return { kind: "scope", scope: "settings" };
  }

  return { kind: "deny", reason: `a paired device cannot ${m} ${path}` };
}

/** Constant-time string compare for secrets of equal length. */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
