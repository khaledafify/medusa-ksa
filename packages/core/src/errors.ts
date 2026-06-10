import { MedusaError } from "@medusajs/framework/utils";

/**
 * Stable, machine-readable error codes shared across the suite.
 *
 * Connector authors should reuse these where they fit and add new ones here
 * rather than inventing ad-hoc strings, so that {@link toMedusaError} can map
 * them to the correct Medusa error type at the API/provider boundary.
 */
export const KsaErrorCodes = {
  /** A connector option / env var is missing or failed schema validation. */
  INVALID_OPTIONS: "invalid_options",
  /** Generic invalid input that is not a configuration problem. */
  INVALID_INPUT: "invalid_input",
  /** A webhook signature did not verify (constant-time mismatch or stale). */
  WEBHOOK_VERIFICATION_FAILED: "webhook_verification_failed",
  /** Encryption key was the wrong length / format. */
  INVALID_ENCRYPTION_KEY: "invalid_encryption_key",
  /** Ciphertext was tampered with or could not be decrypted. */
  DECRYPTION_FAILED: "decryption_failed",
  /** Outbound HTTP failed (timeout, network, non-2xx after retries). */
  HTTP_ERROR: "http_error",
  /** The upstream provider rejected an otherwise-valid request. */
  PROVIDER_ERROR: "provider_error",
  /** A currency other than SAR reached a SAR-only boundary. */
  INVALID_CURRENCY: "invalid_currency",
  /** A SAR amount was not a finite, non-negative number. */
  INVALID_AMOUNT: "invalid_amount",
  /** Catch-all for unexpected internal failures. */
  UNEXPECTED: "unexpected",
} as const;

/**
 * The set of canonical {@link KsaError} codes.
 *
 * A wider `string` is also accepted by {@link KsaError} so connectors can carry
 * their own provider-specific codes without patching core.
 */
export type KsaErrorCode =
  | (typeof KsaErrorCodes)[keyof typeof KsaErrorCodes]
  | (string & {});

/** Options accepted by the {@link KsaError} constructor. */
export interface KsaErrorOptions {
  /**
   * Short connector tag used to prefix the message, e.g. `"moyasar"`.
   * The rendered message becomes `"[moyasar] <message>"`.
   */
  prefix?: string;
  /** Stable, machine-readable error code. Defaults to `"unexpected"`. */
  code?: KsaErrorCode;
  /** The original error / value that triggered this one, for chaining. */
  cause?: unknown;
}

/**
 * The single error type thrown everywhere inside the suite.
 *
 * Carries a connector {@link prefix}, a stable {@link code}, and an optional
 * {@link cause}. The public `message` is always prefixed (`"[prefix] msg"`),
 * while {@link rawMessage} preserves the unprefixed text.
 *
 * Never put secrets, tokens, or full request bodies in the message — redact
 * them with `redactSecrets` at the call site first.
 */
export class KsaError extends Error {
  /** Distinguishes a `KsaError` across realms / bundling boundaries. */
  readonly __isKsaError = true as const;

  /** Connector tag the error was raised under, e.g. `"moyasar"`. */
  readonly prefix?: string;

  /** Stable, machine-readable error code. */
  readonly code: KsaErrorCode;

  /** The message exactly as supplied, without the `[prefix]` decoration. */
  readonly rawMessage: string;

  override name = "KsaError";

  constructor(message: string, options: KsaErrorOptions = {}) {
    const { prefix, code, cause } = options;
    const rendered = prefix ? `[${prefix}] ${message}` : message;

    super(rendered, cause === undefined ? undefined : { cause });

    this.prefix = prefix;
    this.code = code ?? KsaErrorCodes.UNEXPECTED;
    this.rawMessage = message;

    // Restore the prototype chain for environments / transpile targets where
    // `extends Error` would otherwise break `instanceof`.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Type guard usable across module/realm boundaries. */
  static isKsaError(value: unknown): value is KsaError {
    return (
      value instanceof KsaError ||
      (typeof value === "object" &&
        value !== null &&
        (value as { __isKsaError?: unknown }).__isKsaError === true)
    );
  }
}

/**
 * Maps a {@link KsaError} {@link KsaErrorCode} to the closest Medusa error type.
 * Anything unrecognized falls back to `UNEXPECTED_STATE`.
 */
function medusaTypeForCode(code: KsaErrorCode): string {
  switch (code) {
    case KsaErrorCodes.INVALID_OPTIONS:
    case KsaErrorCodes.INVALID_INPUT:
    case KsaErrorCodes.INVALID_CURRENCY:
    case KsaErrorCodes.INVALID_AMOUNT:
      return MedusaError.Types.INVALID_DATA;
    case KsaErrorCodes.WEBHOOK_VERIFICATION_FAILED:
      return MedusaError.Types.UNAUTHORIZED;
    case KsaErrorCodes.INVALID_ENCRYPTION_KEY:
    case KsaErrorCodes.DECRYPTION_FAILED:
      return MedusaError.Types.INVALID_ARGUMENT;
    case KsaErrorCodes.HTTP_ERROR:
    case KsaErrorCodes.PROVIDER_ERROR:
      return MedusaError.Types.UNEXPECTED_STATE;
    case KsaErrorCodes.UNEXPECTED:
      return MedusaError.Types.UNEXPECTED_STATE;
    default:
      return MedusaError.Types.UNEXPECTED_STATE;
  }
}

/**
 * Normalizes any thrown value into a Medusa-shaped error at the
 * API/provider boundary.
 *
 * - An existing {@link MedusaError} is returned unchanged.
 * - A {@link KsaError} keeps its prefixed message and code, with the type
 *   inferred from {@link KsaErrorCode}.
 * - A plain `Error` becomes an `UNEXPECTED_STATE` `MedusaError` preserving its
 *   message and chaining the original as `cause`.
 * - Any other value is stringified into an `UNEXPECTED_STATE` `MedusaError`.
 *
 * Never throws.
 */
export function toMedusaError(err: unknown): MedusaError {
  // `MedusaError.isMedusaError` reads `error.__isMedusaError` without a null
  // guard, so it throws on `null`/`undefined`. Guard here to honor the
  // never-throws contract.
  if (
    typeof err === "object" &&
    err !== null &&
    MedusaError.isMedusaError(err)
  ) {
    return err;
  }

  if (KsaError.isKsaError(err)) {
    const medusaErr = new MedusaError(
      medusaTypeForCode(err.code),
      err.message,
      err.code,
    );
    (medusaErr as { cause?: unknown }).cause = err;
    return medusaErr;
  }

  if (err instanceof Error) {
    const medusaErr = new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      err.message,
      KsaErrorCodes.UNEXPECTED,
    );
    (medusaErr as { cause?: unknown }).cause = err;
    return medusaErr;
  }

  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    typeof err === "string" && err.length > 0 ? err : "Unknown error",
    KsaErrorCodes.UNEXPECTED,
  );
}
