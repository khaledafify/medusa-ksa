import type { TypeOf, ZodError, ZodTypeAny } from "zod";

import { KsaError, KsaErrorCodes } from "./errors.js";

/**
 * Maps an option key to the environment variable that fills it when the option
 * is omitted from the config block (CLAUDE.md §7.1 — env-first with fallback).
 *
 * @example
 * { secretKey: "MOYASAR_SECRET_KEY" }
 */
export type EnvMap = Record<string, string>;

/**
 * Options shared by {@link validateOptions} and {@link createLoader}.
 */
export interface ValidateOptionsConfig {
  /**
   * Connector prefix used in error messages, e.g. "moyasar" → "[moyasar] …".
   * Defaults to "ksa".
   */
  prefix?: string;
  /**
   * Maps an option key to the env var that fills it when the option is absent.
   * Drives both the env fallback merge and the "set <ENV_VAR>" error hint.
   */
  envMap?: EnvMap;
}

const DEFAULT_PREFIX = "ksa";

/**
 * Merge `rawOptions` with an env-var fallback.
 *
 * For every entry in `envMap`, if the option is missing/undefined in
 * `rawOptions` we read the mapped env var. Explicit options always win over
 * env. Empty-string env values are treated as "unset" so a stray `FOO=` in a
 * shell does not satisfy a required field.
 */
function mergeWithEnv(
  rawOptions: unknown,
  env: NodeJS.ProcessEnv,
  envMap: EnvMap,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof rawOptions === "object" && rawOptions !== null
      ? { ...(rawOptions as Record<string, unknown>) }
      : {};

  for (const [optionKey, envVar] of Object.entries(envMap)) {
    if (base[optionKey] !== undefined) {
      continue;
    }
    const envValue = env[envVar];
    if (envValue !== undefined && envValue !== "") {
      base[optionKey] = envValue;
    }
  }

  return base;
}

/**
 * Turn a {@link ZodError} into a single human-readable line, naming the
 * offending field(s) and — when the field has an env fallback — the env var to
 * set. Never echoes the offending values (they may be secrets).
 */
function describeIssues(error: ZodError, envMap: EnvMap): string {
  return error.issues
    .map((issue) => {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      const topKey = issue.path.length > 0 ? String(issue.path[0]) : undefined;
      const envVar = topKey !== undefined ? envMap[topKey] : undefined;
      const hint =
        envVar !== undefined ? ` (set option "${field}" or env ${envVar})` : "";
      return `${field}: ${issue.message}${hint}`;
    })
    .join("; ");
}

/**
 * Validate a connector's options at boot.
 *
 * Pure: given the same inputs it always behaves identically and performs no
 * I/O beyond reading the passed-in `env` snapshot. Merges `rawOptions` with the
 * env-var fallback (per `opts.envMap`), then parses with `schema`.
 *
 * @throws {KsaError} with code `invalid_options`, naming the offending field(s)
 * and the env var to set when applicable. Never includes the bad values.
 */
export function validateOptions<S extends ZodTypeAny>(
  schema: S,
  rawOptions: unknown,
  env: NodeJS.ProcessEnv = process.env,
  opts: ValidateOptionsConfig = {},
): TypeOf<S> {
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  const envMap = opts.envMap ?? {};

  const merged = mergeWithEnv(rawOptions, env, envMap);
  const result = schema.safeParse(merged);

  if (!result.success) {
    throw new KsaError(
      `invalid configuration — ${describeIssues(result.error, envMap)}`,
      {
        prefix,
        code: KsaErrorCodes.INVALID_OPTIONS,
        cause: result.error,
      },
    );
  }

  return result.data as TypeOf<S>;
}

/**
 * A Medusa module loader: an async function the framework invokes at boot. We
 * deliberately keep the dependency on `@medusajs/framework` types out of the
 * signature so `core` needs no runtime import of the peer for this primitive.
 */
export type MedusaLoader = (...args: unknown[]) => Promise<void>;

/**
 * Build an async Medusa loader that validates a connector's options against
 * `schema` at server boot and throws a {@link KsaError} on failure. The
 * validated, typed options are returned via the `onValidated` callback so the
 * caller can stash them on the module container.
 *
 * @example
 * export default createLoader(optionsSchema, {
 *   prefix: "moyasar",
 *   envMap: { secretKey: "MOYASAR_SECRET_KEY" },
 *   resolveOptions: (args) => (args[0] as { options?: unknown }).options,
 * });
 */
export function createLoader<S extends ZodTypeAny>(
  schema: S,
  opts: ValidateOptionsConfig & {
    /**
     * Extract the raw options object from the loader arguments. Defaults to
     * reading `args[0].options` (Medusa's `LoaderOptions` shape).
     */
    resolveOptions?: (args: unknown[]) => unknown;
    /**
     * Invoked with the validated, typed options after a successful parse.
     */
    onValidated?: (options: TypeOf<S>) => void | Promise<void>;
  } = {},
): MedusaLoader {
  const { resolveOptions, onValidated, ...validateConfig } = opts;

  return async (...args: unknown[]): Promise<void> => {
    const raw = resolveOptions
      ? resolveOptions(args)
      : extractDefaultOptions(args);

    const validated = validateOptions(schema, raw, process.env, validateConfig);

    if (onValidated) {
      await onValidated(validated);
    }
  };
}

/**
 * Default `resolveOptions`: read `options` off the first loader argument, which
 * Medusa passes as `{ container, options, ... }`.
 */
function extractDefaultOptions(args: unknown[]): unknown {
  const first = args[0];
  if (typeof first === "object" && first !== null && "options" in first) {
    return (first as { options?: unknown }).options;
  }
  return first;
}
