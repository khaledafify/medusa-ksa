import { describe, expect, it } from "vitest";

import { KsaError, detectSandbox } from "@medusa-ksa/core";

import { resolveMoyasarOptions } from "./types.js";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

const VALID = {
  secretKey: "sk_test_abc123",
  publishableKey: "pk_test_abc123",
};

describe("resolveMoyasarOptions", () => {
  it("throws a KsaError naming MOYASAR_SECRET_KEY and where to get it when the secret key is missing", () => {
    let caught: unknown;
    try {
      resolveMoyasarOptions({ publishableKey: "pk_test_abc" }, EMPTY_ENV);
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const err = caught as KsaError;
    expect(err.code).toBe("invalid_options");
    expect(err.message).toContain("[moyasar]");
    expect(err.message).toContain("MOYASAR_SECRET_KEY");
    expect(err.message).toContain("dashboard.moyasar.com");
  });

  it("boots on the secret key alone — the publishable key is optional (hosted-redirect default)", () => {
    const options = resolveMoyasarOptions({ secretKey: "sk_test_abc" }, EMPTY_ENV);

    expect(options.secretKey).toBe("sk_test_abc");
    expect(options.publishableKey).toBeUndefined();
  });

  it("rejects an empty publishable key when one is supplied", () => {
    let caught: unknown;
    try {
      resolveMoyasarOptions(
        { secretKey: "sk_test_abc", publishableKey: "" },
        EMPTY_ENV,
      );
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const err = caught as KsaError;
    expect(err.message).toContain("MOYASAR_PUBLISHABLE_KEY");
    expect(err.message).toContain("dashboard.moyasar.com");
  });

  it("falls back to env vars when options are omitted", () => {
    const options = resolveMoyasarOptions(undefined, {
      MOYASAR_SECRET_KEY: "sk_test_env",
      MOYASAR_PUBLISHABLE_KEY: "pk_test_env",
      MOYASAR_WEBHOOK_SECRET: "whsec_env",
    });

    expect(options.secretKey).toBe("sk_test_env");
    expect(options.publishableKey).toBe("pk_test_env");
    expect(options.webhookSecret).toBe("whsec_env");
  });

  it("prefers explicit options over env fallback", () => {
    const options = resolveMoyasarOptions(VALID, {
      MOYASAR_SECRET_KEY: "sk_test_env",
      MOYASAR_PUBLISHABLE_KEY: "pk_test_env",
    });

    expect(options.secretKey).toBe(VALID.secretKey);
    expect(options.publishableKey).toBe(VALID.publishableKey);
  });

  it("leaves the webhook secret undefined when not configured", () => {
    const options = resolveMoyasarOptions(VALID, EMPTY_ENV);
    expect(options.webhookSecret).toBeUndefined();
  });

  it("never echoes a bad option value in the error message", () => {
    let caught: unknown;
    try {
      resolveMoyasarOptions(
        { secretKey: 12345, publishableKey: "pk_test_abc" },
        EMPTY_ENV,
      );
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    expect((caught as KsaError).message).not.toContain("12345");
  });

  it("accepts optional transport overrides", () => {
    const options = resolveMoyasarOptions(
      {
        ...VALID,
        baseUrl: "https://proxy.example.com/v1",
        timeoutMs: 5000,
        retry: { retries: 1, baseDelayMs: 100 },
      },
      EMPTY_ENV,
    );

    expect(options.baseUrl).toBe("https://proxy.example.com/v1");
    expect(options.timeoutMs).toBe(5000);
    expect(options.retry).toEqual({ retries: 1, baseDelayMs: 100 });
  });
});

describe("sandbox detection", () => {
  it("detects sandbox from an sk_test_ secret key", () => {
    const options = resolveMoyasarOptions(VALID, EMPTY_ENV);
    expect(detectSandbox(options.secretKey)).toBe(true);
  });

  it("treats an sk_live_ secret key as live", () => {
    const options = resolveMoyasarOptions(
      { secretKey: "sk_live_abc123", publishableKey: "pk_live_abc123" },
      EMPTY_ENV,
    );
    expect(detectSandbox(options.secretKey)).toBe(false);
  });
});
