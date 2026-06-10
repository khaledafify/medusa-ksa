import { createHash, randomUUID } from "node:crypto";

import { KsaError, KsaErrorCodes } from "./errors.js";

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
 * In-memory registry of **in-flight** operations, keyed by idempotency key. The
 * stored value is the promise returned by `fn` so that concurrent callers with
 * the same key share a single execution rather than racing.
 *
 * The map is bounded to genuinely concurrent work: an entry is removed as soon
 * as its operation settles (success **or** failure). It is process-local
 * concurrency de-duplication, not a distributed lock and not a durable cache —
 * durable, cross-request idempotency must still be delegated to a
 * provider/database idempotency key (CONTRACT.md "Idempotency").
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Collapse concurrent invocations for the same `key` into a single execution.
 *
 * While an operation for `key` is in flight, any concurrent call with the same
 * key returns the same promise instead of invoking `fn` again. Once it settles
 * — whether it resolves or rejects — the key is released, so the map never
 * grows beyond the set of currently-running operations and a later call may
 * retry. Distinct keys are fully independent.
 *
 * This deliberately does **not** cache settled results: holding successes
 * forever would grow unbounded, and true duplicate-suppression across separate
 * requests belongs to the provider's idempotency key, carried over HTTP.
 *
 * @throws {KsaError} `invalid_input` when `key` is not a non-empty string.
 */
export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof key !== "string" || key.length === 0) {
    throw new KsaError("withIdempotency requires a non-empty key.", {
      prefix: "core",
      code: KsaErrorCodes.INVALID_INPUT,
    });
  }

  const existing = inFlight.get(key);
  if (existing !== undefined) {
    return existing as Promise<T>;
  }

  // Release the key once the operation settles (success or failure) so the map
  // stays bounded to in-flight work and a later call can retry.
  const tracked = (async () => fn())().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, tracked);
  return tracked;
}
