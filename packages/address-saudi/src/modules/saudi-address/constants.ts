/** Container registration key. camelCase because Medusa module names cannot contain dashes. */
export const MODULE_NAME = "saudiAddress";

/** Error prefix used by all Saudi Address errors. */
export const MODULE_PREFIX = "saudi-address";

/** External GPL geography dependency package alias. */
export const GEO_DATA_PACKAGE = "saudi-geo";

/** Upstream geography data paths inside {@link GEO_DATA_PACKAGE}. */
export const GEO_DATA_PATH = {
  REGIONS: "json/regions_lite.json",
  CITIES: "json/cities_lite.json",
  DISTRICTS: "json/districts_lite.json",
} as const;

/** Supported geography entities. */
export const ENTITY = {
  REGION: "region",
  CITY: "city",
  DISTRICT: "district",
} as const;

/** Physical table names owned by this module. */
export const TABLE = {
  REGION: "saudi_address_region",
  CITY: "saudi_address_city",
  DISTRICT: "saudi_address_district",
} as const;

/** Deterministic ID prefixes for seeded geography rows. */
export const ID_PREFIX = {
  REGION: "sareg",
  CITY: "sacity",
  DISTRICT: "sadist",
} as const;

/** Environment variables owned by this module. */
export const ENV = {
  NATIONAL_ADDRESS_API_KEY: "NATIONAL_ADDRESS_API_KEY",
  NATIONAL_ADDRESS_BASE_URL: "NATIONAL_ADDRESS_BASE_URL",
  SAUDI_ADDRESS_STRICT: "SAUDI_ADDRESS_STRICT",
} as const;

/** Order metadata status values written by the checkout hook. */
export const ADDRESS_STATUS = {
  VALID: "valid",
  UNVALIDATED: "unvalidated",
  UNCHECKED: "unchecked",
} as const;

/** Order metadata key for the address validation status. */
export const ORDER_METADATA_KEY = "saudi_address_status";

/** Riyadh sort pin constants from the upstream dataset. */
export const RIYADH_REGION_CODE = "RD";
export const RIYADH_CITY_CODE = "3";

/** Response locales supported by the geography service. */
export const LOCALE = {
  AR: "ar",
  EN: "en",
} as const;

/** Default response sort locale. */
export const DEFAULT_LOCALE = LOCALE.EN;

/** ICU collation locales for geography ordering. */
export const COLLATOR_LOCALE = {
  AR: "ar-SA",
  EN: "en-US",
} as const;

/** Default SPL API base URL. Verified during the S6 adapter slice before use. */
export const DEFAULT_NATIONAL_ADDRESS_BASE_URL = "https://api.address.gov.sa";

/** Default bounded outbound timeout for the optional SPL adapter. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Default retry policy for idempotent optional SPL reads. */
export const DEFAULT_RETRY = {
  RETRIES: 2,
  BASE_DELAY_MS: 250,
} as const;

/** SPL endpoints. Verified during S6 before adapter activation. */
export const SPL_ENDPOINTS = {
  RESOLVE: "/national-address/v1/addresses/short",
  VERIFY: "/national-address/v1/addresses/verify",
} as const;

/** SPL query types. Verified during S6 before adapter activation. */
export const QUERY_TYPE = {
  SHORT_ADDRESS: "short_address",
  NATIONAL_ADDRESS: "national_address",
} as const;

/** SPL cache TTL settings in milliseconds. */
export const TTL = {
  FRESH_MS: 7 * 24 * 60 * 60 * 1000,
  STALE_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

/** Expected upstream geography counts used by structural seed checks. */
export const DATASET_COUNTS = {
  REGIONS: 13,
  CITIES: 4581,
  DISTRICTS: 3732,
} as const;

/** Deterministic seed SQL chunk size. */
export const SEED_CHUNK_SIZE = 500;
