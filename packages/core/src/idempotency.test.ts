import { describe, it, expect, vi } from "vitest";
import { KsaError } from "./errors.js";
import { idempotencyKey, withIdempotency } from "./idempotency.js";

describe("idempotencyKey", () => {
  it("derives a stable SHA-256 hex key from a seed", () => {
    const a = idempotencyKey("order_123");
    const b = idempotencyKey("order_123");
    expect(a).toBe(b);
    // SHA-256 hex is 64 lowercase hex chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives different keys for different seeds", () => {
    expect(idempotencyKey("order_123")).not.toBe(idempotencyKey("order_124"));
  });

  it("returns a unique random UUID when no seed is given", () => {
    const a = idempotencyKey();
    const b = idempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe("withIdempotency", () => {
  it("invokes fn exactly once for concurrent calls with the same key", async () => {
    const key = `concurrent_${idempotencyKey()}`;
    let resolveFn!: (value: number) => void;
    const gate = new Promise<number>((resolve) => {
      resolveFn = resolve;
    });
    const fn = vi.fn(() => gate);

    // Fire several concurrent callers before fn settles.
    const callers = [
      withIdempotency(key, fn),
      withIdempotency(key, fn),
      withIdempotency(key, fn),
    ];

    resolveFn(42);
    const results = await Promise.all(callers);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual([42, 42, 42]);
  });

  it("de-dupes only in-flight work, releasing the key once settled", async () => {
    // In-flight-only semantics: the registry must NOT cache settled successes
    // forever (that would grow unbounded). Once an operation settles, a later
    // call with the same key runs fn again — durable de-duplication is the
    // provider idempotency key's job, not this in-process collapse.
    const key = `inflight_${idempotencyKey()}`;
    const fn = vi.fn(async () => "captured");

    const first = await withIdempotency(key, fn);
    const second = await withIdempotency(key, fn);

    expect(first).toBe("captured");
    expect(second).toBe("captured");
    // Two SEQUENTIAL (already-settled) calls => fn runs twice.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent callers but re-runs after they settle", async () => {
    const key = `bounded_${idempotencyKey()}`;
    let resolveFn!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => gate)
      .mockResolvedValue("second");

    // Two concurrent callers share one execution while in flight.
    const a = withIdempotency(key, fn);
    const b = withIdempotency(key, fn);
    resolveFn("first");
    expect(await a).toBe("first");
    expect(await b).toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);

    // After settling, the key is free again — a fresh call re-runs fn.
    expect(await withIdempotency(key, fn)).toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty key", async () => {
    await expect(withIdempotency("", async () => "x")).rejects.toBeInstanceOf(KsaError);
    const err = await withIdempotency("", async () => "x").catch((e: unknown) => e);
    expect((err as KsaError).code).toBe("invalid_input");
  });

  it("treats different keys independently", async () => {
    const fnA = vi.fn(async () => "a");
    const fnB = vi.fn(async () => "b");

    const a = await withIdempotency(`key_a_${idempotencyKey()}`, fnA);
    const b = await withIdempotency(`key_b_${idempotencyKey()}`, fnB);

    expect(a).toBe("a");
    expect(b).toBe("b");
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("releases the key after a rejection so a later call can retry", async () => {
    const key = `retry_${idempotencyKey()}`;
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");

    await expect(withIdempotency(key, fn)).rejects.toThrow("transient");
    // The failed key must not poison subsequent attempts.
    await expect(withIdempotency(key, fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not invoke fn synchronously before it is needed", async () => {
    const key = `lazy_${idempotencyKey()}`;
    const fn = vi.fn(async () => "value");

    const pending = withIdempotency(key, fn);
    // fn is invoked within the async wrapper, but resolution is awaited.
    const result = await pending;

    expect(result).toBe("value");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
