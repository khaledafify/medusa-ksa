import { describe, expect, it } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import { RECIPIENTS } from "./constants.js";
import { normalizeRecipient } from "./recipient.js";

describe("normalizeRecipient", () => {
  it("normalizes supported Saudi mobile formats to canonical international format", () => {
    expect(normalizeRecipient("0501234567")).toBe("+966501234567");
    expect(normalizeRecipient("966501234567")).toBe("+966501234567");
    expect(normalizeRecipient("+966501234567")).toBe("+966501234567");
  });

  it("rejects empty recipients without preparing a POSTable value", () => {
    expect(() => normalizeRecipient("")).toThrowError(KsaError);
  });

  it("rejects unparseable recipients with INVALID_INPUT", () => {
    try {
      normalizeRecipient("12345");
    } catch (err) {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).code).toBe("invalid_input");
      expect((err as KsaError).message).toContain(
        RECIPIENTS.INTERNATIONAL_PREFIX,
      );
    }
  });
});
