import type { EnvMap } from "@medusa-ksa/core";
import { validateOptions } from "@medusa-ksa/core";
import { z } from "zod";

import {
  DEFAULT_NATIONAL_ADDRESS_BASE_URL,
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  ENV,
  MODULE_PREFIX,
} from "./constants.js";

const STRICT_TRUE = "true";
const STRICT_FALSE = "false";

const strictBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === STRICT_TRUE) {
    return true;
  }
  if (normalized === STRICT_FALSE) {
    return false;
  }
  return value;
}, z.boolean());

/** Env-first option fallback map. */
export const SAUDI_ADDRESS_ENV_MAP: EnvMap = {
  nationalAddressApiKey: ENV.NATIONAL_ADDRESS_API_KEY,
  baseUrl: ENV.NATIONAL_ADDRESS_BASE_URL,
  strict: ENV.SAUDI_ADDRESS_STRICT,
};

/** Boot-time module options. The SPL API key is deliberately optional. */
export const saudiAddressOptionsSchema = z.object({
  nationalAddressApiKey: z
    .string({
      invalid_type_error: "must be a string copied from SPL National Address API credentials",
    })
    .min(1, "must not be empty")
    .optional(),
  baseUrl: z
    .string()
    .url()
    .default(DEFAULT_NATIONAL_ADDRESS_BASE_URL),
  strict: strictBoolean.default(false),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  retry: z
    .object({
      retries: z.number().int().min(0),
      baseDelayMs: z.number().min(0),
    })
    .default({
      retries: DEFAULT_RETRY.RETRIES,
      baseDelayMs: DEFAULT_RETRY.BASE_DELAY_MS,
    }),
});

/** Validated module options. */
export type SaudiAddressOptions = z.infer<typeof saudiAddressOptionsSchema>;

/** Locale accepted by geography list/search operations. */
export type SaudiAddressLocale = "ar" | "en";

/** Address validation status stored on order metadata. */
export type AddressValidationStatus = "valid" | "unvalidated" | "unchecked";

/** Raw upstream region row from the GPL data dependency. */
export interface RawSaudiRegion {
  region_id: number;
  capital_city_id: number;
  code: string;
  name_ar: string;
  name_en: string;
  population?: number;
}

/** Raw upstream city row from the GPL data dependency. */
export interface RawSaudiCity {
  city_id: number;
  region_id: number;
  name_ar: string;
  name_en: string;
}

/** Raw upstream district row from the GPL data dependency. */
export interface RawSaudiDistrict {
  district_id: number;
  city_id: number;
  region_id: number;
  name_ar: string;
  name_en: string;
}

/** Normalized seed region row. */
export interface SaudiRegionSeed {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sort_weight: number;
  capital_city_code: string | null;
  population: number | null;
}

/** Persisted region record returned by the module service. */
export type SaudiRegionRecord = SaudiRegionSeed;

/** Normalized seed city row. */
export interface SaudiCitySeed {
  id: string;
  code: string;
  region_code: string;
  name_ar: string;
  name_en: string;
  sort_weight: number;
}

/** Persisted city record returned by the module service. */
export type SaudiCityRecord = SaudiCitySeed;

/** Normalized seed district row. */
export interface SaudiDistrictSeed {
  id: string;
  code: string;
  city_code: string;
  region_code: string;
  name_ar: string;
  name_en: string;
  sort_weight: number;
}

/** Persisted district record returned by the module service. */
export type SaudiDistrictRecord = SaudiDistrictSeed;

/** Bilingual geography name exposed on every response. */
export interface BilingualName {
  ar: string;
  en: string;
}

/** Region list item. */
export interface SaudiRegionListItem {
  code: string;
  name: BilingualName;
}

/** City list item. */
export interface SaudiCityListItem {
  code: string;
  region_code: string;
  name: BilingualName;
}

/** District list item. */
export interface SaudiDistrictListItem {
  code: string;
  city_code: string;
  region_code: string;
  name: BilingualName;
}

/** Normalized geography seed dataset. */
export interface SaudiGeoDataset {
  regions: SaudiRegionSeed[];
  cities: SaudiCitySeed[];
  districts: SaudiDistrictSeed[];
  source: {
    packageName: string;
    license: "GPL-2.0";
    repository: string;
  };
}

/**
 * Validate module options with an explicit env snapshot. Loader code owns the
 * real process env; tests pass hermetic snapshots.
 */
export function validateSaudiAddressOptions(
  rawOptions: unknown,
  env: NodeJS.ProcessEnv,
): SaudiAddressOptions {
  return validateOptions(saudiAddressOptionsSchema, rawOptions, env, {
    prefix: MODULE_PREFIX,
    envMap: SAUDI_ADDRESS_ENV_MAP,
  });
}
