import { KsaError } from "@medusa-ksa/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import validateConfigLoader from "./loaders/validate-config.js";
import {
  getSaudiAddressOptions,
  setSaudiAddressOptions,
  validateSaudiAddressOptions,
} from "./types.js";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;
const ENV_KEYS = [
  "NATIONAL_ADDRESS_API_KEY",
  "NATIONAL_ADDRESS_BASE_URL",
  "SAUDI_ADDRESS_STRICT",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  setSaudiAddressOptions(validateSaudiAddressOptions({}, EMPTY_ENV));
});

describe("validateSaudiAddressOptions", () => {
  it("boots without a National Address API key", () => {
    const options = validateSaudiAddressOptions({}, EMPTY_ENV);

    expect(options.nationalAddressApiKey).toBeUndefined();
    expect(options.strict).toBe(false);
    expect(options.baseUrl).toBe("https://api.address.gov.sa");
  });

  it("falls back to documented env vars when supplied", () => {
    const options = validateSaudiAddressOptions({}, {
      NATIONAL_ADDRESS_API_KEY: "spl_secret",
      NATIONAL_ADDRESS_BASE_URL: "https://proxy.example.test",
      SAUDI_ADDRESS_STRICT: "true",
    });

    expect(options).toMatchObject({
      nationalAddressApiKey: "spl_secret",
      baseUrl: "https://proxy.example.test",
      strict: true,
    });
  });

  it("rejects invalid env values without echoing the API key", () => {
    let caught: unknown;
    try {
      validateSaudiAddressOptions(
        { nationalAddressApiKey: "spl_secret" },
        { NATIONAL_ADDRESS_BASE_URL: "not-a-url" },
      );
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    expect((caught as KsaError).message).toContain("[saudi-address]");
    expect((caught as KsaError).message).toContain("NATIONAL_ADDRESS_BASE_URL");
    expect((caught as KsaError).message).not.toContain("spl_secret");
  });
});

describe("validate-config loader", () => {
  it("boots cleanly with no key in options or env", async () => {
    await expect(validateConfigLoader({ options: {} })).resolves.toBeUndefined();
  });

  it("stores boot-validated strict mode for runtime services", async () => {
    process.env.SAUDI_ADDRESS_STRICT = "true";

    await validateConfigLoader({ options: {} });

    expect(getSaudiAddressOptions().strict).toBe(true);
  });

  it("rejects a malformed strict flag at boot", async () => {
    process.env.SAUDI_ADDRESS_STRICT = "sometimes";

    await expect(validateConfigLoader({ options: {} })).rejects.toThrowError(
      KsaError,
    );
  });
});
