import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { KsaError } from "./errors.js";
import { createLoader, validateOptions } from "./loader.js";

const optionsSchema = z.object({
  secretKey: z.string().min(1),
  timeoutMs: z.coerce.number().int().positive().default(8000),
});

describe("validateOptions", () => {
  it("returns typed options when the config is valid", () => {
    const result = validateOptions(
      optionsSchema,
      { secretKey: "sk_test_123", timeoutMs: 5000 },
      {},
    );

    expect(result).toEqual({ secretKey: "sk_test_123", timeoutMs: 5000 });
  });

  it("applies schema defaults for omitted optional fields", () => {
    const result = validateOptions(
      optionsSchema,
      { secretKey: "sk_test_123" },
      {},
    );

    expect(result.timeoutMs).toBe(8000);
  });

  it("throws a KsaError when a required field is missing", () => {
    expect(() => validateOptions(optionsSchema, {}, {})).toThrow(KsaError);
  });

  it("names the offending field in the error message", () => {
    let caught: unknown;
    try {
      validateOptions(optionsSchema, {}, {}, { prefix: "moyasar" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(KsaError);
    const error = caught as KsaError;
    expect(error.code).toBe("invalid_options");
    expect(error.message).toContain("secretKey");
  });

  it("includes the env var to set when the field has an env fallback", () => {
    let caught: unknown;
    try {
      validateOptions(
        optionsSchema,
        {},
        {},
        { prefix: "moyasar", envMap: { secretKey: "MOYASAR_SECRET_KEY" } },
      );
    } catch (err) {
      caught = err;
    }

    const error = caught as KsaError;
    expect(error.message).toContain("MOYASAR_SECRET_KEY");
  });

  it("fills a missing option from the mapped env var", () => {
    const result = validateOptions(
      optionsSchema,
      { timeoutMs: 3000 },
      { MOYASAR_SECRET_KEY: "sk_test_from_env" },
      { envMap: { secretKey: "MOYASAR_SECRET_KEY" } },
    );

    expect(result.secretKey).toBe("sk_test_from_env");
  });

  it("prefers an explicit option over the env fallback", () => {
    const result = validateOptions(
      optionsSchema,
      { secretKey: "sk_test_explicit", timeoutMs: 3000 },
      { MOYASAR_SECRET_KEY: "sk_test_from_env" },
      { envMap: { secretKey: "MOYASAR_SECRET_KEY" } },
    );

    expect(result.secretKey).toBe("sk_test_explicit");
  });

  it("treats an empty-string env var as unset", () => {
    expect(() =>
      validateOptions(
        optionsSchema,
        {},
        { MOYASAR_SECRET_KEY: "" },
        { envMap: { secretKey: "MOYASAR_SECRET_KEY" } },
      ),
    ).toThrow(KsaError);
  });

  it("does not echo the offending value in the message", () => {
    let caught: unknown;
    try {
      validateOptions(
        z.object({ secretKey: z.string().min(20) }),
        { secretKey: "sk_live_supersecret" },
        {},
      );
    } catch (err) {
      caught = err;
    }

    const error = caught as KsaError;
    expect(error.message).not.toContain("sk_live_supersecret");
  });

  it("tolerates a non-object rawOptions (e.g. undefined) and falls back to env", () => {
    const result = validateOptions(
      optionsSchema,
      undefined,
      { MOYASAR_SECRET_KEY: "sk_test_from_env" },
      { envMap: { secretKey: "MOYASAR_SECRET_KEY" } },
    );

    expect(result.secretKey).toBe("sk_test_from_env");
  });
});

describe("createLoader", () => {
  it("returns an async loader that resolves when options are valid", async () => {
    const onValidated = vi.fn();
    const loader = createLoader(optionsSchema, {
      prefix: "moyasar",
      onValidated,
      resolveOptions: (args) =>
        (args[0] as { options?: unknown } | undefined)?.options,
    });

    await expect(
      loader({ options: { secretKey: "sk_test_123" } }),
    ).resolves.toBeUndefined();

    expect(onValidated).toHaveBeenCalledWith({
      secretKey: "sk_test_123",
      timeoutMs: 8000,
    });
  });

  it("rejects with a KsaError when options are invalid", async () => {
    const loader = createLoader(optionsSchema, {
      prefix: "moyasar",
      resolveOptions: (args) =>
        (args[0] as { options?: unknown } | undefined)?.options,
    });

    await expect(loader({ options: {} })).rejects.toThrow(KsaError);
  });

  it("reads options off args[0].options by default (Medusa LoaderOptions shape)", async () => {
    const onValidated = vi.fn();
    const loader = createLoader(optionsSchema, { onValidated });

    await loader({ options: { secretKey: "sk_test_123" } });

    expect(onValidated).toHaveBeenCalledWith(
      expect.objectContaining({ secretKey: "sk_test_123" }),
    );
  });

  it("falls back to process.env for env-mapped fields", async () => {
    const onValidated = vi.fn();
    const loader = createLoader(optionsSchema, {
      envMap: { secretKey: "MOYASAR_SECRET_KEY" },
      onValidated,
    });

    vi.stubEnv("MOYASAR_SECRET_KEY", "sk_test_env_boot");
    try {
      await loader({ options: { timeoutMs: 2000 } });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(onValidated).toHaveBeenCalledWith({
      secretKey: "sk_test_env_boot",
      timeoutMs: 2000,
    });
  });
});
