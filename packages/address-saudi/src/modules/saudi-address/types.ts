import type { EnvMap } from "@medusa-ksa/core";
import { validateOptions } from "@medusa-ksa/core";
import { z } from "zod";

import type {
  ADDRESS_STATUS,
  ENTITY,
  SPL_CACHE_STATE,
  SPL_RESOLVE_STATUS,
  VALIDATION_REASON,
} from "./constants.js";
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

let currentSaudiAddressOptions = saudiAddressOptionsSchema.parse({});

/** Store boot-validated module options for runtime services and hooks. */
export function setSaudiAddressOptions(options: SaudiAddressOptions): void {
  currentSaudiAddressOptions = options;
}

/** Read boot-validated module options. Defaults keep dataset-only installs off-network. */
export function getSaudiAddressOptions(): SaudiAddressOptions {
  return currentSaudiAddressOptions;
}

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

/** Persisted optional SPL lookup cache row. */
export interface SaudiAddressCacheRecord {
  id: string;
  cache_key: string;
  query_type: string;
  payload: Record<string, unknown>;
  expires_at: Date | string;
  stale_expires_at: Date | string;
}

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

/** Search result item. */
export interface SaudiAddressSearchResult {
  entity: (typeof ENTITY)[keyof typeof ENTITY];
  code: string;
  region_code?: string;
  city_code?: string;
  name: BilingualName;
}

/** Search input. */
export interface SaudiAddressSearchInput {
  query: string;
  locale?: SaudiAddressLocale;
  limit?: number;
}

/** Structural validation input. */
export interface SaudiAddressValidateInput {
  cityCode?: string;
  cityName?: string;
  districtCode?: string;
  districtName?: string;
  buildingNumber?: string;
  postCode?: string;
  additionalNumber?: string;
  locale?: SaudiAddressLocale;
}

/** Structural validation result. */
export interface SaudiAddressValidateResult {
  status:
    | typeof ADDRESS_STATUS.VALID
    | typeof ADDRESS_STATUS.UNVALIDATED;
  reason?: (typeof VALIDATION_REASON)[keyof typeof VALIDATION_REASON];
  city?: SaudiCityListItem;
  district?: SaudiDistrictListItem;
}

/** Short-address resolve input. */
export interface SaudiAddressResolveInput {
  shortAddress: string;
}

/** Optional SPL adapter disabled response. */
export interface SaudiAddressResolveDisabledResult {
  status: typeof SPL_RESOLVE_STATUS.DISABLED;
  message: string;
}

/** Bilingual field returned by the optional SPL adapter when available. */
export interface SplBilingualField {
  ar?: string;
  en?: string;
}

/** Normalized SPL address. Fields are optional because the public short-address page is sparse. */
export interface SplResolvedAddress {
  address_line_1?: SplBilingualField;
  address_line_2?: SplBilingualField;
  building_number?: string;
  street?: SplBilingualField;
  district?: SplBilingualField;
  city?: SplBilingualField;
  post_code?: string;
  additional_number?: string;
  region?: SplBilingualField;
  latitude?: string;
  longitude?: string;
}

/** Successful optional SPL short-address resolve response. */
export interface SaudiAddressResolveSuccessResult {
  status:
    | typeof SPL_RESOLVE_STATUS.FOUND
    | typeof SPL_RESOLVE_STATUS.NOT_FOUND;
  cache_state: (typeof SPL_CACHE_STATE)[keyof typeof SPL_CACHE_STATE];
  short_address: string;
  found: boolean;
  address?: SplResolvedAddress;
}

/** Store/service short-address resolve response. */
export type SaudiAddressResolveResult =
  | SaudiAddressResolveDisabledResult
  | SaudiAddressResolveSuccessResult;

/** Official SPL verification input. */
export interface SaudiAddressOfficialVerifyInput {
  buildingNumber: string;
  postCode: string;
  additionalNumber: string;
}

/** Official SPL verification result. */
export interface SaudiAddressOfficialVerifyResult {
  verified: boolean;
  cache_state: (typeof SPL_CACHE_STATE)[keyof typeof SPL_CACHE_STATE];
}

/** Injectable optional SPL client surface used by the module service. */
export interface SplClientContract {
  resolveShortAddress: (
    input: SaudiAddressResolveInput | string,
  ) => Promise<SaudiAddressResolveSuccessResult>;
  verifyNationalAddress: (
    input: SaudiAddressOfficialVerifyInput,
  ) => Promise<SaudiAddressOfficialVerifyResult>;
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
