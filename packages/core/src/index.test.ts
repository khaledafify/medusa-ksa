import { describe, expect, it } from "vitest";

import * as core from "./index.js";
import type {
  AuthStrategy,
  HttpRequest,
  KsaFulfillmentOptions,
  KsaNotificationOptions,
  KsaPaymentOptions,
  SarAmount,
} from "./index.js";

/**
 * The public surface contract (CONTRACT.md + handoff TEST-GAPS Phase F).
 *
 * Every primitive named here MUST be exported from the barrel; this is the
 * single test that fails the moment a connector author can no longer reach a
 * sanctioned core primitive (e.g. a refactor drops it from `index.ts`).
 */
describe("public runtime surface", () => {
  it("exports every contract function", () => {
    const fns = [
      "createLoader",
      "validateOptions",
      "toMedusaError",
      "verifyWebhook",
      "encrypt",
      "decrypt",
      "sarToHalalas",
      "halalasToSar",
      "assertSar",
      "detectSandbox",
      "idempotencyKey",
      "withIdempotency",
      "redactSecrets",
    ] as const;

    for (const name of fns) {
      expect(typeof core[name], `${name} must be an exported function`).toBe(
        "function",
      );
    }
  });

  it("exports KsaError as a constructable class with its codes", () => {
    expect(typeof core.KsaError).toBe("function");
    const err = new core.KsaError("boom", { prefix: "moyasar", code: core.KsaErrorCodes.HTTP_ERROR });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("[moyasar] boom");
    expect(err.code).toBe("http_error");
    expect(typeof core.KsaErrorCodes).toBe("object");
    expect(core.KsaErrorCodes.DECRYPTION_FAILED).toBe("decryption_failed");
  });

  it("exports HttpClient as a constructable class", () => {
    expect(typeof core.HttpClient).toBe("function");
    const client = new core.HttpClient({ baseUrl: "https://x.test", timeoutMs: 1000 });
    expect(client).toBeInstanceOf(core.HttpClient);
  });

  it("exposes the secrets namespace backed by the named exports", () => {
    expect(typeof core.secrets).toBe("object");
    expect(core.secrets.encrypt).toBe(core.encrypt);
    expect(core.secrets.decrypt).toBe(core.decrypt);
  });

  it("wires the barrel exports to working implementations (smoke)", () => {
    // Not truthiness checks — each call exercises real behavior end-to-end.
    expect(core.sarToHalalas(1.005)).toBe(101);
    expect(core.halalasToSar(101 as SarAmount)).toBeCloseTo(1.01, 10);
    expect(core.detectSandbox("sk_test_abc")).toBe(true);
    expect(core.detectSandbox("sk_live_abc")).toBe(false);
    expect(core.redactSecrets("token=abc123", ["abc123"])).toBe("token=***");
    expect(core.idempotencyKey("seed")).toBe(core.idempotencyKey("seed"));
  });
});

/**
 * Compile-time surface: these assignments are erased at runtime but are
 * typechecked by `tsc --noEmit` (the typecheck gate). If any exported shared
 * type were removed, renamed, or had its members changed incompatibly, this
 * file would fail to compile.
 */
describe("public type surface (compile-time)", () => {
  it("constructs a value of every exported shared type", () => {
    const bearer: AuthStrategy = { type: "bearer", token: "t" };
    const basic: AuthStrategy = { type: "basic", username: "u", password: "p" };
    const apiKey: AuthStrategy = { type: "api-key", header: "x-api-key", value: "v" };

    const req: HttpRequest = {
      method: "GET",
      path: "/x",
      query: { a: 1, b: "two", c: true, d: undefined },
      idempotent: true,
      timeoutMs: 1000,
    };

    const amount: SarAmount = core.sarToHalalas(10);

    const payment: KsaPaymentOptions = { currency: "SAR", secretKey: "sk" };
    const fulfillment: KsaFulfillmentOptions = { apiKey: "k", codEnabled: true };
    const notification: KsaNotificationOptions = { apiKey: "k", channels: ["sms", "whatsapp"] };

    // Touch each binding at runtime so it is not elided/flagged unused.
    expect(
      [bearer, basic, apiKey, req, amount, payment, fulfillment, notification].length,
    ).toBe(8);
  });
});
