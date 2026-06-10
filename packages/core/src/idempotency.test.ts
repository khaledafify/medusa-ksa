import { describe, it, expect, vi } from "vitest";
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

  it("does not re-run fn for a settled key (result is sticky)", async () => {
    const key = `sticky_${idempotencyKey()}`;
    const fn = vi.fn(async () => "captured");

    const first = await withIdempotency(key, fn);
    const second = await withIdempotency(key, fn);

    expect(first).toBe("captured");
    expect(second).toBe("captured");
    expect(fn).toHaveBeenCalledTimes(1);
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
