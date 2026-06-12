import { afterEach, describe, expect, it } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import { ENV, PROVIDER_ID } from "./constants.js";
import { loadUnifonicOptions, resolveUnifonicOptions } from "./options.js";

const VALID_OPTIONS = {
  appSid: "app_test_secret",
  senderId: "MedusaKSA",
};

const ENV_KEYS = [
  ENV.APP_SID,
  ENV.SENDER_ID,
  ENV.BASE_URL,
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("Unifonic options", () => {
  it("resolves valid explicit options", () => {
    expect(resolveUnifonicOptions(VALID_OPTIONS)).toMatchObject({
      appSid: "app_test_secret",
      senderId: "MedusaKSA",
      channels: ["sms"],
    });
  });

  it("falls back to documented env vars", () => {
    const env = {
      [ENV.APP_SID]: "env_app_sid",
      [ENV.SENDER_ID]: "EnvSender",
      [ENV.BASE_URL]: "https://proxy.example",
    };

    expect(resolveUnifonicOptions({}, env)).toMatchObject({
      appSid: "env_app_sid",
      senderId: "EnvSender",
      baseUrl: "https://proxy.example",
      channels: ["sms"],
    });
  });

  it("createLoader throws a KsaError naming UNIFONIC_APP_SID when AppSid is missing", async () => {
    process.env[ENV.SENDER_ID] = "MedusaKSA";

    await expect(loadUnifonicOptions({ options: {} })).rejects.toSatisfy(
      (err) =>
        KsaError.isKsaError(err) &&
        err.code === "invalid_options" &&
        err.message.includes(ENV.APP_SID),
    );
  });

  it("createLoader throws a KsaError naming UNIFONIC_SENDER_ID when Sender ID is missing", async () => {
    process.env[ENV.APP_SID] = "app_test_secret";

    await expect(loadUnifonicOptions({ options: {} })).rejects.toSatisfy(
      (err) =>
        KsaError.isKsaError(err) &&
        err.code === "invalid_options" &&
        err.message.includes(ENV.SENDER_ID),
    );
  });

  it("does not include AppSid values in validation errors", () => {
    const leakedSecret = "app_secret_never_echo";

    try {
      resolveUnifonicOptions({ appSid: leakedSecret });
    } catch (err) {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).message).not.toContain(leakedSecret);
      expect((err as KsaError).message).toContain(PROVIDER_ID);
    }
  });
});
