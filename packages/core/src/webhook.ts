import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Options for {@link verifyWebhook}.
 *
 * Replay protection is opt-in: pass both `timestamp` (the signed timestamp from
 * the incoming request, in epoch seconds) and `toleranceSec`. When supplied,
 * a request whose timestamp is older than `toleranceSec` relative to `now`
 * (or further than `toleranceSec` in the future) is rejected.
 */
export interface VerifyWebhookOptions {
  /** HMAC digest algorithm. Only `"sha256"` is supported. Defaults to `"sha256"`. */
  algorithm?: "sha256";
  /**
   * Maximum allowed age (in seconds) of the request timestamp. Has no effect
   * unless `timestamp` is also provided.
   */
  toleranceSec?: number;
  /** The signed request timestamp, in epoch **seconds**. Enables replay checks. */
  timestamp?: number;
  /** Current time, in epoch **seconds**. Injectable for deterministic tests. Defaults to `Date.now() / 1000`. */
  now?: number;
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
 * When `opts.timestamp` and `opts.toleranceSec` are both supplied, a stale or
 * far-future request (outside the tolerance window relative to `opts.now`) is
 * rejected before the signature is even compared.
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

  // Optional replay protection: only enforced when both a timestamp and a
  // tolerance are supplied.
  if (opts?.timestamp !== undefined && opts?.toleranceSec !== undefined) {
    const now = opts.now ?? Date.now() / 1000;
    const skew = Math.abs(now - opts.timestamp);
    if (!Number.isFinite(skew) || skew > opts.toleranceSec) {
      return false;
    }
  }

  // Normalize the body to bytes so the HMAC input type is stable across
  // `@types/node` versions (string and Buffer both narrow to Uint8Array here).
  const bodyBytes =
    typeof rawBody === "string"
      ? new Uint8Array(Buffer.from(rawBody, "utf8"))
      : new Uint8Array(rawBody);

  let digest: Buffer;
  try {
    digest = createHmac(algorithm, secret).update(bodyBytes).digest();
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
