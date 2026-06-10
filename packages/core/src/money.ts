import { KsaError, KsaErrorCodes } from "./errors.js";

/**
 * The only sanctioned money type in the suite (CONTRACT.md §Money).
 *
 * A `SarAmount` is an **integer number of halalas** (1 SAR = 100 halalas),
 * branded so the type system rejects raw `number`s. Floats are banned:
 * conversion happens only through {@link sarToHalalas} / {@link halalasToSar},
 * so connectors never multiply money by 100 or handle fractional halalas.
 */
export type SarAmount = number & { readonly __brand: "halalas" };

/** Prefix used on every money-related {@link KsaError}. */
const PREFIX = "core";

/**
 * Convert a SAR figure (e.g. `49.99`) to integer halalas as a {@link SarAmount}.
 *
 * Rounds **half-up** at the halalas boundary. Decimal half-way cases that IEEE-754
 * cannot represent exactly (the classic `1.005` vector) are corrected with a tiny
 * epsilon before rounding, so `sarToHalalas(1.005)` deterministically yields `101`.
 *
 * @throws {KsaError} `invalid_amount` if `sar` is not a finite number, or is negative.
 */
export function sarToHalalas(sar: number): SarAmount {
  if (typeof sar !== "number" || !Number.isFinite(sar)) {
    throw new KsaError(
      `expected a finite SAR number, received ${stringifyAmount(sar)}`,
      { prefix: PREFIX, code: KsaErrorCodes.INVALID_AMOUNT },
    );
  }
  if (sar < 0) {
    throw new KsaError(`SAR amount must not be negative, received ${sar}`, {
      prefix: PREFIX,
      code: KsaErrorCodes.INVALID_AMOUNT,
    });
  }

  const scaled = sar * 100;
  // Nudge by a relative epsilon so decimal half-way values that land just below
  // the .5 boundary in binary (e.g. 1.005 -> 100.49999999999999) round half-up.
  const corrected = scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled);
  const halalas = Math.round(corrected);

  return halalas as SarAmount;
}

/**
 * Convert integer halalas back to a SAR figure by dividing by 100.
 *
 * The result may be fractional (e.g. `4999` -> `49.99`); it is intended for
 * display/serialization, never for further arithmetic on money.
 */
export function halalasToSar(h: SarAmount): number {
  return h / 100;
}

/**
 * Guard against a silently-wrong currency. Accepts only `"SAR"` (case-insensitive).
 *
 * @throws {KsaError} `invalid_currency` for any other code.
 */
export function assertSar(currencyCode: string): void {
  if (typeof currencyCode !== "string" || currencyCode.toUpperCase() !== "SAR") {
    throw new KsaError(
      `expected currency "SAR", received ${stringifyAmount(currencyCode)}`,
      { prefix: PREFIX, code: KsaErrorCodes.INVALID_CURRENCY },
    );
  }
}

/** Render an arbitrary bad input safely for an error message (no secrets here, but keep it bounded). */
function stringifyAmount(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}
