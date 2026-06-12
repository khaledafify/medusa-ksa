import { z } from "zod";

import type { EnvMap, MedusaLoader } from "@medusa-ksa/core";
import { createLoader, validateOptions } from "@medusa-ksa/core";

import { DEFAULTS, ENV, TOROD_PREFIX } from "./constants.js";

const CREDENTIALS_HINT =
  "copy them from Torod Partners → Applications and use sandbox credentials for testing";
const BASE_URL_HINT =
  "use Torod sandbox https://demo.stage.torod.co/en/api or live https://torod.co/en/api";
const WEBHOOK_HINT =
  "use the shared secret configured in Torod Partners webhook settings";

export const TOROD_ENV_MAP: EnvMap = {
  clientId: ENV.CLIENT_ID,
  clientSecret: ENV.CLIENT_SECRET,
  baseUrl: ENV.BASE_URL,
  defaultWeightKg: ENV.DEFAULT_WEIGHT_KG,
  defaultBoxCount: ENV.DEFAULT_BOX_COUNT,
  webhookSecret: ENV.WEBHOOK_SECRET,
};

export const torodRetrySchema = z.object({
  retries: z.number().int().min(0),
  baseDelayMs: z.number().min(0),
});

export const torodOptionsSchema = z.object({
  clientId: z
    .string({
      required_error: `is required — ${CREDENTIALS_HINT}`,
      invalid_type_error: `must be a string — ${CREDENTIALS_HINT}`,
    })
    .min(1, `must not be empty — ${CREDENTIALS_HINT}`),
  clientSecret: z
    .string({
      required_error: `is required — ${CREDENTIALS_HINT}`,
      invalid_type_error: `must be a string — ${CREDENTIALS_HINT}`,
    })
    .min(1, `must not be empty — ${CREDENTIALS_HINT}`),
  baseUrl: z
    .string({ invalid_type_error: `must be a URL string — ${BASE_URL_HINT}` })
    .url(`must be a valid URL — ${BASE_URL_HINT}`)
    .default(DEFAULTS.BASE_URL),
  defaultWeightKg: z.coerce.number().positive().optional(),
  defaultBoxCount: z.coerce.number().int().positive().default(DEFAULTS.BOX_COUNT),
  webhookSecret: z
    .string({ invalid_type_error: `must be a string — ${WEBHOOK_HINT}` })
    .min(1, `must not be empty — ${WEBHOOK_HINT}`)
    .optional(),
  timeoutMs: z.number().int().positive().default(DEFAULTS.TIMEOUT_MS),
  retry: torodRetrySchema.default({
    retries: DEFAULTS.RETRY.RETRIES,
    baseDelayMs: DEFAULTS.RETRY.BASE_DELAY_MS,
  }),
});

export type TorodOptions = z.infer<typeof torodOptionsSchema>;

export function resolveTorodOptions(
  rawOptions: unknown,
  env: NodeJS.ProcessEnv = process.env,
): TorodOptions {
  return validateOptions(torodOptionsSchema, rawOptions, env, {
    prefix: TOROD_PREFIX,
    envMap: TOROD_ENV_MAP,
  });
}

export function createTorodLoader(
  onValidated?: (options: TorodOptions) => void | Promise<void>,
): MedusaLoader {
  return createLoader(torodOptionsSchema, {
    prefix: TOROD_PREFIX,
    envMap: TOROD_ENV_MAP,
    onValidated,
  });
}

export const torodLoader = createTorodLoader();
