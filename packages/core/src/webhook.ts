import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Options for {@link verifyWebhook}.
 *
 * Replay protection binds the request timestamp to the signature so that an old
 * `(body, signature)` pair cannot be replayed under a fresh timestamp:
 *
 * - Pass `timestamp` (the signed timestamp from the request, in epoch seconds).
 *   The HMAC is then computed over `` `${timestamp}.${rawBody}` `` (the
 *   Stripe-style scheme) unless you supply your own {@link signedPayload}. This
 *   makes the timestamp part of what is signed, so changing it invalidates the
 *   signature.
 * - Add `toleranceSec` to also enforce a freshness window: a request whose
 *   timestamp is older than `toleranceSec` (or further than `toleranceSec` in
 *   the future) relative to `now` is rejected.
 *
 * Supplying `toleranceSec` **without** `timestamp` is a misconfiguration — a
 * window can never be enforced without a timestamp — and is rejected (returns
 * `false`) rather than silently degrading to no replay protection.
 */
export interface VerifyWebhookOptions {
  /** HMAC digest algorithm. Only `"sha256"` is supported. Defaults to `"sha256"`. */
  algorithm?: "sha256";
  /**
   * Maximum allowed age (in seconds) of the request timestamp. Requires
   * `timestamp`; supplying it alone returns `false`.
   */
  toleranceSec?: number;
  /**
   * The signed request timestamp, in epoch **seconds**. When set (and
   * {@link signedPayload} is not), the timestamp is bound into the HMAC input as
   * `` `${timestamp}.${rawBody}` ``.
   */
  timestamp?: number;
  /** Current time, in epoch **seconds**. Injectable for deterministic tests. Defaults to `Date.now() / 1000`. */
  now?: number;
  /**
   * Provider-specific payload that was actually signed, overriding the default
   * binding. Use this when a gateway signs something other than
   * `` `${timestamp}.${rawBody}` `` (the caller is then responsible for
   * including the timestamp in it). The freshness window still applies.
   */
  signedPayload?: string | Buffer;
}

/** Convert a string or Buffer body to a stable byte view for HMAC input. */
function toBytes(value: string | Buffer): Uint8Array {
  return typeof value === "string"
    ? new Uint8Array(Buffer.from(value, "utf8"))
    : new Uint8Array(value);
}

/**
 * Resolve the exact bytes the signature must be checked against.
 *
 * - An explicit `signedPayload` wins (provider-specific binding).
 * - Otherwise, when a `timestamp` is present, bind it Stripe-style as
 *   `` `${timestamp}.${rawBody}` `` so the signature covers the timestamp.
 * - With neither, the raw body is signed as-is.
 *
 * The timestamp prefix and body are concatenated as **bytes** so binary bodies
 * are never corrupted by a string coercion.
 */
function resolveSignedBytes(
  rawBody: string | Buffer,
  opts?: VerifyWebhookOptions,
): Uint8Array {
  if (opts?.signedPayload !== undefined) {
    return toBytes(opts.signedPayload);
  }
  if (opts?.timestamp !== undefined) {
    const prefix = Buffer.from(`${opts.timestamp}.`, "utf8");
    const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
    return new Uint8Array(Buffer.concat([prefix, body]));
  }
  return toBytes(rawBody);
}

/**
 * Compares two strings in constant time.
 *
 * Returns `false` (never throws) when the byte lengths differ, because
 * {@link timingSafeEqual} requires equal-length buffers. A length mismatch
 * already proves inequality, so short-circuiting here leaks no more than the
 * comparison would have.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = new Uint8Array(Buffer.from(a, "utf8"));
  const bufB = new Uint8Array(Buffer.from(b, "utf8"));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a webhook signature using a constant-time HMAC comparison.
 *
 * The provided `signature` is matched against an HMAC of `rawBody` keyed by
 * `secret`, accepting either a hex or base64 encoding of the digest. The
 * comparison uses {@link timingSafeEqual} to avoid timing side-channels.
 *
 * When `opts.timestamp` is supplied, it is bound into the signed payload (see
 * {@link VerifyWebhookOptions}), so an old `(body, signature)` pair cannot be
 * replayed under a fresh timestamp. Adding `opts.toleranceSec` also rejects a
 * stale or far-future request (outside the window relative to `opts.now`)
 * before the signature is compared. Supplying `toleranceSec` without a
 * `timestamp` is rejected as a misconfiguration.
 *
 * This function **never throws** — any malformed input yields `false`, so a
 * caller can safely respond `401` on a falsy result.
 *
 * @param rawBody   The exact raw request body (string or Buffer). Never the parsed JSON.
 * @param signature The signature header value supplied by the provider.
 * @param secret    The shared webhook signing secret.
 * @param opts      Optional algorithm and replay-protection settings.
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
  opts?: VerifyWebhookOptions
): boolean {
  const algorithm = opts?.algorithm ?? "sha256";

  // A missing signature or secret can never be valid.
  if (typeof signature !== "string" || signature.length === 0 || !secret) {
    return false;
  }

  // Misconfiguration guard: a tolerance window is meaningless without a
  // timestamp to measure against. Fail closed rather than silently skip the
  // replay check the caller clearly intended to enable.
  if (opts?.toleranceSec !== undefined && opts?.timestamp === undefined) {
    return false;
  }

  // Freshness window: enforced only when a tolerance is supplied. The timestamp
  // itself is bound into the HMAC input below, so even without a window an old
  // signature cannot be replayed under a new timestamp.
  if (opts?.timestamp !== undefined && opts?.toleranceSec !== undefined) {
    const now = opts.now ?? Date.now() / 1000;
    const skew = Math.abs(now - opts.timestamp);
    if (!Number.isFinite(skew) || skew > opts.toleranceSec) {
      return false;
    }
  }

  // The signed payload binds the timestamp (or a provider-specific payload)
  // into what is HMAC'd, so tampering with the timestamp invalidates the
  // signature. Bytes are stable across `@types/node` versions.
  const signedBytes = resolveSignedBytes(rawBody, opts);

  let digest: Buffer;
  try {
    digest = createHmac(algorithm, secret).update(signedBytes).digest();
  } catch {
    // e.g. unsupported algorithm or invalid key material — treat as invalid.
    return false;
  }

  const expectedHex = digest.toString("hex");
  const expectedBase64 = digest.toString("base64");

  // Accept either encoding; both comparisons run in constant time and a
  // length mismatch short-circuits to `false`.
  return safeEqual(signature, expectedHex) || safeEqual(signature, expectedBase64);
}
