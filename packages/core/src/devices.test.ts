import { describe, expect, it } from "vitest";
import {
  DEVICE_SCOPES,
  deviceAccess,
  generateDeviceToken,
  generatePairingCode,
  hashSecret,
  MAX_PAIRING_ATTEMPTS,
  normalizeScopes,
  PAIRING_CODE_TTL_MS,
  pairingCodeIsUsable,
  pairingExpiresAt,
  parseScopes,
  secretEquals,
} from "./devices.js";

describe("pairing codes", () => {
  it("keeps six digits and leading zeros", () => {
    expect(generatePairingCode(() => 42)).toBe("000042");
    expect(generatePairingCode(() => 999_999)).toBe("999999");
  });

  it("expires ten minutes after it was started", () => {
    const now = new Date("2026-11-21T10:00:00.000Z");
    expect(pairingExpiresAt(now)).toBe(new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString());
  });

  it("is usable once, before expiry, within the attempt limit", () => {
    const now = new Date("2026-11-21T10:00:00.000Z");
    const row = { expiresAt: pairingExpiresAt(now), usedAt: null, attempts: 0 };
    expect(pairingCodeIsUsable(row, now)).toBe(true);
    expect(pairingCodeIsUsable({ ...row, usedAt: now.toISOString() }, now)).toBe(false);
    expect(pairingCodeIsUsable({ ...row, attempts: MAX_PAIRING_ATTEMPTS }, now)).toBe(false);
    expect(pairingCodeIsUsable({ ...row, expiresAt: "not a date" }, now)).toBe(false);
    expect(
      pairingCodeIsUsable({ ...row, expiresAt: new Date(now.getTime() - 1).toISOString() }, now),
    ).toBe(false);
  });

  it("hashes a code without keeping the plaintext", () => {
    expect(hashSecret("123456")).toBe(hashSecret("123456"));
    expect(hashSecret("123456")).not.toContain("123456");
    expect(hashSecret("123456")).not.toBe(hashSecret("654321"));
  });
});

describe("device credentials", () => {
  it("issues a long random token each time", () => {
    const one = generateDeviceToken();
    const two = generateDeviceToken();
    expect(one).toHaveLength(43);
    expect(one).not.toBe(two);
    expect(one).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("compares secrets in constant time and rejects different lengths", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("", "")).toBe(true);
  });
});

describe("device scopes", () => {
  it("keeps only known scopes, deduplicated, in canonical order", () => {
    expect(normalizeScopes(["send", "read", "send", "root", ""])).toEqual(["read", "send"]);
    expect(parseScopes(JSON.stringify(DEVICE_SCOPES))).toEqual([...DEVICE_SCOPES]);
    expect(parseScopes("garbage")).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(JSON.stringify({ read: true }))).toEqual([]);
  });
});

describe("deviceAccess", () => {
  it("lets a device read the operator's data but never manage devices", () => {
    expect(deviceAccess("GET", "/queue")).toEqual({ kind: "scope", scope: "read" });
    expect(deviceAccess("GET", "/signals?range=today")).toEqual({ kind: "scope", scope: "read" });
    expect(deviceAccess("GET", "/devices")).toEqual({ kind: "master" });
    expect(deviceAccess("POST", "/devices/pairing")).toEqual({ kind: "master" });
    expect(deviceAccess("DELETE", "/devices/dev-1")).toEqual({ kind: "master" });
  });

  it("separates capture, send, render and settings", () => {
    expect(deviceAccess("POST", "/thoughts")).toEqual({ kind: "scope", scope: "capture" });
    expect(deviceAccess("POST", "/events/notes")).toEqual({ kind: "scope", scope: "capture" });
    expect(deviceAccess("PUT", "/signals/sig-1/reviewed")).toEqual({
      kind: "scope",
      scope: "capture",
    });
    expect(deviceAccess("POST", "/actions/act-1/send")).toEqual({ kind: "scope", scope: "send" });
    expect(deviceAccess("PATCH", "/actions/act-1")).toEqual({ kind: "scope", scope: "send" });
    expect(deviceAccess("GET", "/summary/audio")).toEqual({ kind: "scope", scope: "render" });
    expect(deviceAccess("PUT", "/admin/notifications")).toEqual({
      kind: "scope",
      scope: "settings",
    });
    expect(deviceAccess("PATCH", "/signals/sig-1")).toEqual({ kind: "scope", scope: "settings" });
    expect(deviceAccess("PUT", "/queue/order")).toEqual({ kind: "scope", scope: "settings" });
  });

  it("closes anything not deliberately opened, including adapter ingress", () => {
    const denied = deviceAccess("POST", "/signals");
    expect(denied.kind).toBe("deny");
    expect(deviceAccess("DELETE", "/thoughts/th-1").kind).toBe("deny");
    expect(deviceAccess("POST", "/queue/order").kind).toBe("deny");
  });
});
