import type { ResilienceSettings } from "@mind/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  isRetryableModelError,
  ModelUnavailableError,
  resetResilience,
  resilienceState,
  withResilience,
} from "./resilience.js";

const fast: ResilienceSettings = {
  timeoutSeconds: 5,
  retries: 2,
  retryDelayMs: 100,
  breakerFailures: 3,
  breakerResetSeconds: 5,
  maxConcurrent: 2,
};

afterEach(() => resetResilience());

const transient = () => Object.assign(new Error("server error"), { statusCode: 503 });

describe("isRetryableModelError", () => {
  it("retries a rate limit, a server error, a timeout, and a dropped connection", () => {
    expect(isRetryableModelError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("x"), { statusCode: 500 }))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("x"), { isRetryable: true }))).toBe(true);
    expect(isRetryableModelError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(
      true,
    );
    const refused = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    expect(isRetryableModelError(refused)).toBe(true);
  });

  it("does not retry a bad request, bad credentials, or an invalid answer", () => {
    expect(isRetryableModelError(Object.assign(new Error("x"), { statusCode: 400 }))).toBe(false);
    expect(isRetryableModelError(Object.assign(new Error("x"), { statusCode: 401 }))).toBe(false);
    expect(isRetryableModelError(new SyntaxError("Unexpected token"))).toBe(false);
    expect(isRetryableModelError("boom")).toBe(false);
  });
});

describe("withResilience", () => {
  it("returns the result of a call that works", async () => {
    expect(await withResilience(async () => 42, fast)).toBe(42);
  });

  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const result = await withResilience(async () => {
      calls++;
      if (calls < 3) throw transient();
      return "ok";
    }, fast);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the configured retries and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withResilience(
        async () => {
          calls++;
          throw transient();
        },
        { ...fast, retries: 1, breakerFailures: 50 },
      ),
    ).rejects.toThrow("server error");
    expect(calls).toBe(2);
  });

  it("does not retry an error that retrying cannot fix", async () => {
    let calls = 0;
    await expect(
      withResilience(async () => {
        calls++;
        throw new SyntaxError("bad json");
      }, fast),
    ).rejects.toThrow("bad json");
    expect(calls).toBe(1);
  });

  it("aborts a call that outlives the timeout and hands the signal to the call", async () => {
    let aborted = false;
    const run = withResilience(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      { ...fast, timeoutSeconds: 5, retries: 0 },
      50,
    );
    await expect(run).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(aborted).toBe(true);
  });

  it("opens the breaker after consecutive failures and then fails at once", async () => {
    const settings = { ...fast, retries: 0, breakerFailures: 3 };
    let calls = 0;
    const failing = async () => {
      calls++;
      throw transient();
    };
    for (let i = 0; i < 3; i++) await expect(withResilience(failing, settings)).rejects.toThrow();
    expect(resilienceState(settings).circuit).toBe("open");

    const before = calls;
    const refused = withResilience(failing, settings);
    await expect(refused).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(refused).rejects.toMatchObject({ code: "circuit_open" });
    expect(calls).toBe(before);
  });

  it("limits how many calls run at once", async () => {
    const settings = { ...fast, maxConcurrent: 2 };
    let running = 0;
    let peak = 0;
    const call = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return "done";
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => withResilience(call, settings)),
    );
    expect(results).toEqual(Array(6).fill("done"));
    expect(peak).toBe(2);
  });

  it("applies new settings on the next call without a restart", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw transient();
    };
    await expect(withResilience(failing, { ...fast, retries: 0 })).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(
      withResilience(failing, { ...fast, retries: 1, breakerFailures: 50 }),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
});
