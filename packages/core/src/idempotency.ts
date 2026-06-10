import { createHash, randomUUID } from "node:crypto";

/**
 * Produce an idempotency key.
 *
 * - With no `seed`, returns a fresh random UUID (v4). Two calls never collide.
 * - With a `seed`, returns a deterministic key derived from the seed via
 *   SHA-256 (hex). The same seed always yields the same key, so callers can
 *   make a retry idempotent by reusing the seed (e.g. an order id).
 *
 * The key is opaque; callers should treat it as a string token, not parse it.
 */
export function idempotencyKey(seed?: string): string {
  if (seed === undefined) {
    return randomUUID();
  }
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

/**
 * In-memory registry of in-flight / settled operations, keyed by idempotency
 * key. The stored value is the promise returned by `fn` so that concurrent
 * callers with the same key share a single execution rather than racing.
 *
 * This is process-local memoization, not a distributed lock — it guarantees
 * "run once per key within this process" which is exactly what a payment
 * capture/refund retry within a single request lifecycle needs.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `fn` at most once per `key` within this process.
 *
 * The first call for a given key invokes `fn` and caches its promise; any
 * concurrent or subsequent call with the same key returns that same promise
 * instead of invoking `fn` again. Distinct keys are fully independent.
 *
 * Rejections are NOT cached: if `fn` throws/rejects, the key is released so a
 * later retry can attempt the operation again. (A successful result stays
 * cached so a genuine duplicate can never re-execute the side effect.)
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) {
    return existing as Promise<T>;
  }

  const promise = (async () => fn())().catch((err: unknown) => {
    // Allow a future retry of a failed operation; only successes are sticky.
    inFlight.delete(key);
    throw err;
  });

  inFlight.set(key, promise);
  return promise;
}
