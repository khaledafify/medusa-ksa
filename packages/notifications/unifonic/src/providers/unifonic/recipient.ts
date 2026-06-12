import { KsaError, KsaErrorCodes } from "@medusa-ksa/core";

import { ERROR_MESSAGES, RECIPIENTS, UNIFONIC_PREFIX } from "./constants.js";

/** Return true when every character in `value` is an ASCII digit. */
function isDigits(value: string): boolean {
  for (const char of value) {
    if (char < RECIPIENTS.MIN_DIGIT || char > RECIPIENTS.MAX_DIGIT) {
      return false;
    }
  }
  return true;
}

/** Return true when `digits` is a Saudi national mobile number. */
function isSaudiNationalMobile(digits: string): boolean {
  return (
    digits.length === RECIPIENTS.NATIONAL_MOBILE_DIGIT_COUNT &&
    digits.startsWith(RECIPIENTS.NATIONAL_MOBILE_PREFIX)
  );
}

/** Return true when `digits` is a full Saudi international mobile number. */
function isSaudiInternationalMobile(digits: string): boolean {
  return (
    digits.length === RECIPIENTS.INTERNATIONAL_DIGIT_COUNT &&
    digits.startsWith(
      `${RECIPIENTS.COUNTRY_CODE}${RECIPIENTS.NATIONAL_MOBILE_PREFIX}`,
    )
  );
}

/**
 * Normalize accepted Saudi mobile-number forms to canonical international
 * format (`+9665xxxxxxxx`). The returned value is the package's internal form;
 * the client adapts it to Unifonic's digits-only wire format.
 */
export function normalizeRecipient(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith(RECIPIENTS.INTERNATIONAL_PREFIX)) {
    const digits = trimmed.slice(RECIPIENTS.INTERNATIONAL_PREFIX.length);
    if (isDigits(digits) && isSaudiInternationalMobile(digits)) {
      return `${RECIPIENTS.INTERNATIONAL_PREFIX}${digits}`;
    }
    throw invalidRecipientError();
  }

  if (!isDigits(trimmed)) {
    throw invalidRecipientError();
  }

  if (
    trimmed.length === RECIPIENTS.LOCAL_DIGIT_COUNT &&
    trimmed.startsWith(RECIPIENTS.LOCAL_MOBILE_PREFIX)
  ) {
    return `${RECIPIENTS.INTERNATIONAL_PREFIX}${RECIPIENTS.COUNTRY_CODE}${trimmed.slice(RECIPIENTS.LOCAL_COUNTRY_CODE_OFFSET)}`;
  }

  if (isSaudiInternationalMobile(trimmed)) {
    return `${RECIPIENTS.INTERNATIONAL_PREFIX}${trimmed}`;
  }

  if (isSaudiNationalMobile(trimmed)) {
    return `${RECIPIENTS.INTERNATIONAL_PREFIX}${RECIPIENTS.COUNTRY_CODE}${trimmed}`;
  }

  throw invalidRecipientError();
}

/** Build the canonical invalid-recipient error without echoing phone PII. */
function invalidRecipientError(): KsaError {
  return new KsaError(ERROR_MESSAGES.INVALID_RECIPIENT, {
    prefix: UNIFONIC_PREFIX,
    code: KsaErrorCodes.INVALID_INPUT,
  });
}
