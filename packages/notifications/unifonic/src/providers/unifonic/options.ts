import { z } from "zod";

import type { EnvMap } from "@medusa-ksa/core";
import { createLoader, validateOptions } from "@medusa-ksa/core";

import {
  CHANNEL,
  DEFAULTS,
  DEFAULT_BASE_URL,
  ENV,
  OPTION_HINTS,
  UNIFONIC_PREFIX,
} from "./constants.js";

/** Maps provider options to their documented env-var fallbacks. */
export const ENV_MAP: EnvMap = {
  appSid: ENV.APP_SID,
  senderId: ENV.SENDER_ID,
  baseUrl: ENV.BASE_URL,
};

/** Zod schema for Unifonic provider options. */
export const unifonicOptionsSchema = z.object({
  appSid: z
    .string({
      required_error: `is required — ${OPTION_HINTS.APP_SID}`,
      invalid_type_error: `must be a string — ${OPTION_HINTS.APP_SID}`,
    })
    .min(1, `must not be empty — ${OPTION_HINTS.APP_SID}`),
  senderId: z
    .string({
      required_error: `is required — ${OPTION_HINTS.SENDER_ID}`,
      invalid_type_error: `must be a string — ${OPTION_HINTS.SENDER_ID}`,
    })
    .min(1, `must not be empty — ${OPTION_HINTS.SENDER_ID}`),
  baseUrl: z.string().url().default(DEFAULT_BASE_URL),
  timeoutMs: z.number().int().positive().default(DEFAULTS.TIMEOUT_MS),
  retry: z
    .object({
      retries: z.number().int().min(0),
      baseDelayMs: z.number().min(0),
    })
    .default(DEFAULTS.RETRY),
  channels: z.array(z.literal(CHANNEL)).default([CHANNEL]),
});

/** Validated, typed options the Unifonic provider runs with. */
export type ResolvedUnifonicOptions = z.infer<typeof unifonicOptionsSchema>;

/**
 * Validate raw Unifonic options at boot. Explicit config wins over env vars,
 * empty env vars are treated as missing, and secret values are never echoed.
 */
export function resolveUnifonicOptions(
  rawOptions: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedUnifonicOptions {
  return validateOptions(unifonicOptionsSchema, rawOptions, env, {
    prefix: UNIFONIC_PREFIX,
    envMap: ENV_MAP,
  });
}

/**
 * Medusa loader for fail-fast provider validation when the framework invokes
 * package loaders. The provider service also calls the same resolver.
 */
export const loadUnifonicOptions = createLoader(unifonicOptionsSchema, {
  prefix: UNIFONIC_PREFIX,
  envMap: ENV_MAP,
});
