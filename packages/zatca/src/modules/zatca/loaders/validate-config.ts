import { createLoader, validateOptions } from "@medusa-ksa/core";
import { z } from "zod";

import {
  ZATCA_ENVIRONMENTS,
  ZATCA_TRIGGERS,
  type ZatcaModuleOptions,
} from "../types";

const PREFIX = "zatca";

/** AES-256-GCM requires a 32-byte key (core `secrets`). */
const KEY_BYTES = 32;

const ENV_MAP = {
  environment: "ZATCA_ENV",
  encryptionKey: "ZATCA_ENCRYPTION_KEY",
  trigger: "ZATCA_TRIGGER",
} as const;

/**
 * Boot-time options schema (PRD §2). `encryptionKey` must be a base64 string
 * decoding to exactly 32 bytes — anything else refuses to boot, because a
 * weak or truncated key would silently weaken credential encryption at rest.
 */
export const zatcaOptionsSchema = z.object({
  environment: z.enum(ZATCA_ENVIRONMENTS).default("sandbox"),
  encryptionKey: z
    .string({
      required_error:
        "missing — generate a 32-byte base64 key with: openssl rand -base64 32",
    })
    .refine((value) => Buffer.from(value, "base64").length === KEY_BYTES, {
      message: `must be a base64 string decoding to exactly ${KEY_BYTES} bytes — generate one with: openssl rand -base64 32`,
    }),
  trigger: z.enum(ZATCA_TRIGGERS).default("payment_captured"),
});

/**
 * Validate raw module options (exported for tests and for callers that need
 * the parsed options outside a loader context). Throws a `KsaError` naming
 * the offending option and its env var; never echoes the key itself.
 */
export function validateZatcaOptions(rawOptions: unknown): ZatcaModuleOptions {
  return validateOptions(zatcaOptionsSchema, rawOptions, process.env, {
    prefix: PREFIX,
    envMap: ENV_MAP,
  });
}

/**
 * Fail-fast module loader (core `createLoader`): runs at server boot, merges
 * env fallbacks (`ZATCA_ENV`, `ZATCA_ENCRYPTION_KEY`, `ZATCA_TRIGGER`) and
 * refuses to start on a missing/short encryption key or invalid environment.
 */
export default createLoader(zatcaOptionsSchema, {
  prefix: PREFIX,
  envMap: ENV_MAP,
});
