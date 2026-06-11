import { KsaError } from "@medusa-ksa/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import validateConfigLoader, {
  validateZatcaOptions,
} from "./validate-config";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

const ZATCA_ENV_VARS = [
  "ZATCA_ENV",
  "ZATCA_ENCRYPTION_KEY",
  "ZATCA_TRIGGER",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const name of ZATCA_ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of ZATCA_ENV_VARS) {
    const value = savedEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("validateZatcaOptions", () => {
  it("throws a KsaError naming ZATCA_ENCRYPTION_KEY when the key is missing", () => {
    expect(() => validateZatcaOptions({})).toThrowError(KsaError);
    try {
      validateZatcaOptions({});
      expect.unreachable("should have thrown");
    } catch (err) {
      const ksa = err as KsaError;
      expect(ksa.message).toContain("[zatca]");
      expect(ksa.message).toContain("encryptionKey");
      expect(ksa.message).toContain("ZATCA_ENCRYPTION_KEY");
      expect(ksa.code).toBe("invalid_options");
    }
  });

  it("throws on a key shorter than 32 bytes and never echoes the key", () => {
    const shortKey = Buffer.alloc(16, 1).toString("base64");
    try {
      validateZatcaOptions({ encryptionKey: shortKey });
      expect.unreachable("should have thrown");
    } catch (err) {
      const ksa = err as KsaError;
      expect(ksa).toBeInstanceOf(KsaError);
      expect(ksa.message).toContain("32 bytes");
      expect(ksa.message).not.toContain(shortKey);
    }
  });

  it("throws on a non-base64 / wrong-length key from env", () => {
    process.env.ZATCA_ENCRYPTION_KEY = "not-a-real-key";
    expect(() => validateZatcaOptions({})).toThrowError(KsaError);
  });

  it("rejects an invalid environment, naming ZATCA_ENV", () => {
    try {
      validateZatcaOptions({ environment: "staging", encryptionKey: VALID_KEY });
      expect.unreachable("should have thrown");
    } catch (err) {
      const ksa = err as KsaError;
      expect(ksa).toBeInstanceOf(KsaError);
      expect(ksa.message).toContain("environment");
      expect(ksa.message).toContain("ZATCA_ENV");
    }
  });

  it("rejects an invalid trigger, naming ZATCA_TRIGGER", () => {
    try {
      validateZatcaOptions({ trigger: "order_shipped", encryptionKey: VALID_KEY });
      expect.unreachable("should have thrown");
    } catch (err) {
      const ksa = err as KsaError;
      expect(ksa).toBeInstanceOf(KsaError);
      expect(ksa.message).toContain("trigger");
      expect(ksa.message).toContain("ZATCA_TRIGGER");
    }
  });

  it("parses a valid key and applies KSA defaults", () => {
    const options = validateZatcaOptions({ encryptionKey: VALID_KEY });
    expect(options).toEqual({
      environment: "sandbox",
      encryptionKey: VALID_KEY,
      trigger: "payment_captured",
    });
  });

  it("falls back to env vars when options are omitted", () => {
    process.env.ZATCA_ENV = "simulation";
    process.env.ZATCA_ENCRYPTION_KEY = VALID_KEY;
    process.env.ZATCA_TRIGGER = "order_placed";

    const options = validateZatcaOptions({});
    expect(options).toEqual({
      environment: "simulation",
      encryptionKey: VALID_KEY,
      trigger: "order_placed",
    });
  });

  it("prefers explicit options over env fallbacks", () => {
    process.env.ZATCA_ENV = "production";
    const options = validateZatcaOptions({
      environment: "sandbox",
      encryptionKey: VALID_KEY,
    });
    expect(options.environment).toBe("sandbox");
  });
});

describe("validate-config loader", () => {
  it("rejects boot when the encryption key is missing", async () => {
    await expect(
      validateConfigLoader({ options: {} }),
    ).rejects.toThrowError(KsaError);
  });

  it("boots clean with a valid key", async () => {
    await expect(
      validateConfigLoader({ options: { encryptionKey: VALID_KEY } }),
    ).resolves.toBeUndefined();
  });
});
