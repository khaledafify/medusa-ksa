import { describe, expect, it, vi } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import { DEFAULTS, ENV, TOROD_PREFIX } from "./constants.js";
import {
  TOROD_ENV_MAP,
  createTorodLoader,
  resolveTorodOptions,
  torodOptionsSchema,
} from "./options.js";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

const VALID_OPTIONS = {
  clientId: "client_test_123",
  clientSecret: "secret_test_123",
};

describe("resolveTorodOptions", () => {
  it("requires both Torod OAuth credentials and names the client id env var", () => {
    let caught: unknown;
    try {
      resolveTorodOptions({ clientSecret: "secret_test_123" }, EMPTY_ENV);
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const error = caught as KsaError;
    expect(error.prefix).toBe(TOROD_PREFIX);
    expect(error.code).toBe("invalid_options");
    expect(error.message).toContain(ENV.CLIENT_ID);
  });

  it("requires both Torod OAuth credentials and names the client secret env var", () => {
    let caught: unknown;
    try {
      resolveTorodOptions({ clientId: "client_test_123" }, EMPTY_ENV);
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const error = caught as KsaError;
    expect(error.prefix).toBe(TOROD_PREFIX);
    expect(error.code).toBe("invalid_options");
    expect(error.message).toContain(ENV.CLIENT_SECRET);
  });

  it("boots with credentials only and applies safe defaults", () => {
    const options = resolveTorodOptions(VALID_OPTIONS, EMPTY_ENV);

    expect(options).toEqual({
      ...VALID_OPTIONS,
      baseUrl: DEFAULTS.BASE_URL,
      defaultBoxCount: DEFAULTS.BOX_COUNT,
      timeoutMs: DEFAULTS.TIMEOUT_MS,
      retry: {
        retries: DEFAULTS.RETRY.RETRIES,
        baseDelayMs: DEFAULTS.RETRY.BASE_DELAY_MS,
      },
    });
  });

  it("falls back to documented env vars when explicit options are omitted", () => {
    const options = resolveTorodOptions(undefined, {
      TOROD_CLIENT_ID: "client_env",
      TOROD_CLIENT_SECRET: "secret_env",
      TOROD_BASE_URL: "https://proxy.example.com/torod",
      TOROD_DEFAULT_WEIGHT_KG: "2.5",
      TOROD_DEFAULT_BOX_COUNT: "3",
      TOROD_WEBHOOK_SECRET: "webhook_env",
    });

    expect(options).toMatchObject({
      clientId: "client_env",
      clientSecret: "secret_env",
      baseUrl: "https://proxy.example.com/torod",
      defaultWeightKg: 2.5,
      defaultBoxCount: 3,
      webhookSecret: "webhook_env",
    });
  });

  it("prefers explicit options over env fallback", () => {
    const options = resolveTorodOptions(
      {
        ...VALID_OPTIONS,
        defaultWeightKg: 1.25,
        defaultBoxCount: 2,
      },
      {
        TOROD_CLIENT_ID: "client_env",
        TOROD_CLIENT_SECRET: "secret_env",
        TOROD_DEFAULT_WEIGHT_KG: "9",
        TOROD_DEFAULT_BOX_COUNT: "9",
      },
    );

    expect(options.clientId).toBe(VALID_OPTIONS.clientId);
    expect(options.clientSecret).toBe(VALID_OPTIONS.clientSecret);
    expect(options.defaultWeightKg).toBe(1.25);
    expect(options.defaultBoxCount).toBe(2);
  });

  it("rejects invalid numeric defaults and names the matching env var", () => {
    let caught: unknown;
    try {
      resolveTorodOptions(VALID_OPTIONS, {
        TOROD_DEFAULT_BOX_COUNT: "0",
      });
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    expect((caught as KsaError).message).toContain(ENV.DEFAULT_BOX_COUNT);
  });

  it("rejects an invalid base URL without echoing secret values", () => {
    let caught: unknown;
    try {
      resolveTorodOptions(
        {
          clientId: "client_secret_should_not_echo",
          clientSecret: "secret_should_not_echo",
          baseUrl: "not-a-url",
        },
        EMPTY_ENV,
      );
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const message = (caught as KsaError).message;
    expect(message).toContain(ENV.BASE_URL);
    expect(message).not.toContain("client_secret_should_not_echo");
    expect(message).not.toContain("secret_should_not_echo");
  });

  it("keeps the env map aligned with the schema fields", () => {
    expect(Object.keys(TOROD_ENV_MAP).sort()).toEqual(
      Object.keys(torodOptionsSchema.shape)
        .filter((field) => field !== "timeoutMs" && field !== "retry")
        .sort(),
    );
  });
});

describe("createTorodLoader", () => {
  it("creates a Medusa loader that validates options and returns them to the callback", async () => {
    const onValidated = vi.fn();
    const loader = createTorodLoader(onValidated);

    await expect(loader({ options: VALID_OPTIONS })).resolves.toBeUndefined();

    expect(onValidated).toHaveBeenCalledWith(
      expect.objectContaining(VALID_OPTIONS),
    );
  });

  it("rejects with a KsaError when the loader receives invalid options", async () => {
    const loader = createTorodLoader();

    await expect(loader({ options: {} })).rejects.toThrow(KsaError);
  });
});
