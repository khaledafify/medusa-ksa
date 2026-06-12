import { MedusaService } from "@medusajs/framework/utils";

import {
  ADDRESS_STATUS,
  CACHE_KEY,
  COLLATOR_LOCALE,
  DEFAULT_LOCALE,
  ENTITY,
  ENTITY_SEARCH_WEIGHT,
  LOCALE,
  QUERY_TYPE,
  SEARCH_LIMIT,
  SPL_CACHE_STATE,
  SPL_RESOLVE_DISABLED_MESSAGE,
  SPL_RESOLVE_STATUS,
  TTL,
  VALIDATION_REASON,
} from "./constants.js";
import SaudiAddressCache from "./models/cache.js";
import SaudiAddressCity from "./models/city.js";
import SaudiAddressDistrict from "./models/district.js";
import SaudiAddressRegion from "./models/region.js";
import { SplClient } from "./spl-client.js";
import {
  getSaudiAddressOptions,
  validateSaudiAddressOptions,
} from "./types.js";
import type {
  SaudiAddressCacheRecord,
  SaudiAddressOfficialVerifyInput,
  SaudiAddressOfficialVerifyResult,
  SaudiAddressLocale,
  SaudiAddressResolveInput,
  SaudiAddressResolveResult,
  SaudiAddressResolveSuccessResult,
  SaudiAddressSearchInput,
  SaudiAddressSearchResult,
  SaudiAddressOptions,
  SaudiAddressValidateInput,
  SaudiAddressValidateResult,
  SaudiCityListItem,
  SaudiCityRecord,
  SaudiDistrictListItem,
  SaudiDistrictRecord,
  SaudiRegionListItem,
  SaudiRegionRecord,
  SplClientContract,
} from "./types.js";

type ListFilters = Record<string, unknown>;

interface ListInput {
  locale?: SaudiAddressLocale;
}

interface CitiesInput extends ListInput {
  regionCode: string;
}

interface DistrictsInput extends ListInput {
  cityCode: string;
}

interface GeneratedGeographyMethods {
  listSaudiAddressRegions(filters?: unknown): Promise<SaudiRegionRecord[]>;
  listSaudiAddressCities(filters?: unknown): Promise<SaudiCityRecord[]>;
  listSaudiAddressDistricts(filters?: unknown): Promise<SaudiDistrictRecord[]>;
  listSaudiAddressCaches(
    filters?: unknown,
    config?: unknown,
  ): Promise<SaudiAddressCacheRecord[]>;
  createSaudiAddressCaches(input: SaudiAddressCacheInsert): Promise<unknown>;
  updateSaudiAddressCaches(input: SaudiAddressCacheUpdate): Promise<unknown>;
}

interface SaudiAddressCacheInsert {
  cache_key: string;
  query_type: SaudiAddressCacheRecord["query_type"];
  payload: Record<string, unknown>;
  expires_at: Date;
  stale_expires_at: Date;
}

interface SaudiAddressCacheUpdate extends SaudiAddressCacheInsert {
  id: string;
}

interface SaudiAddressRuntimeDeps {
  clock?: () => Date;
  splClient?: SplClientContract;
}

function generatedMethods(
  service: SaudiAddressModuleService,
): GeneratedGeographyMethods {
  return service;
}

function nameForLocale(
  item: { name_ar: string; name_en: string },
  locale: SaudiAddressLocale,
): string {
  return locale === LOCALE.AR ? item.name_ar : item.name_en;
}

function collatorFor(locale: SaudiAddressLocale): Intl.Collator {
  return new Intl.Collator(
    locale === LOCALE.AR ? COLLATOR_LOCALE.AR : COLLATOR_LOCALE.EN,
    { sensitivity: "base" },
  );
}

function sortByLocale<Row extends { sort_weight: number; name_ar: string; name_en: string }>(
  rows: Row[],
  locale: SaudiAddressLocale,
): Row[] {
  const collator = collatorFor(locale);
  return [...rows].sort((left, right) => {
    const weight = left.sort_weight - right.sort_weight;
    if (weight !== 0) {
      return weight;
    }
    return collator.compare(
      nameForLocale(left, locale),
      nameForLocale(right, locale),
    );
  });
}

function regionItem(row: SaudiRegionRecord): SaudiRegionListItem {
  return {
    code: row.code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function cityItem(row: SaudiCityRecord): SaudiCityListItem {
  return {
    code: row.code,
    region_code: row.region_code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function districtItem(row: SaudiDistrictRecord): SaudiDistrictListItem {
  return {
    code: row.code,
    city_code: row.city_code,
    region_code: row.region_code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase(COLLATOR_LOCALE.EN);
}

function includesQuery(
  row: { code: string; name_ar: string; name_en: string },
  query: string,
): boolean {
  const normalized = normalizedText(query);
  return (
    normalizedText(row.code).includes(normalized) ||
    normalizedText(row.name_ar).includes(normalized) ||
    normalizedText(row.name_en).includes(normalized)
  );
}

function matchesName(
  row: { name_ar: string; name_en: string },
  name: string,
): boolean {
  const normalized = normalizedText(name);
  return (
    normalizedText(row.name_ar) === normalized ||
    normalizedText(row.name_en) === normalized
  );
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return SEARCH_LIMIT.DEFAULT;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return SEARCH_LIMIT.DEFAULT;
  }
  return Math.min(Math.trunc(limit), SEARCH_LIMIT.MAX);
}

function regionSearchItem(row: SaudiRegionRecord): SaudiAddressSearchResult {
  return {
    entity: ENTITY.REGION,
    code: row.code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function citySearchItem(row: SaudiCityRecord): SaudiAddressSearchResult {
  return {
    entity: ENTITY.CITY,
    code: row.code,
    region_code: row.region_code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function districtSearchItem(row: SaudiDistrictRecord): SaudiAddressSearchResult {
  return {
    entity: ENTITY.DISTRICT,
    code: row.code,
    city_code: row.city_code,
    region_code: row.region_code,
    name: { ar: row.name_ar, en: row.name_en },
  };
}

function searchWeight(entity: SaudiAddressSearchResult["entity"]): number {
  switch (entity) {
    case ENTITY.REGION:
      return ENTITY_SEARCH_WEIGHT.REGION;
    case ENTITY.CITY:
      return ENTITY_SEARCH_WEIGHT.CITY;
    case ENTITY.DISTRICT:
      return ENTITY_SEARCH_WEIGHT.DISTRICT;
  }
}

function sortSearchResults(
  rows: SaudiAddressSearchResult[],
  locale: SaudiAddressLocale,
): SaudiAddressSearchResult[] {
  const collator = collatorFor(locale);
  return [...rows].sort((left, right) => {
    const weight = searchWeight(left.entity) - searchWeight(right.entity);
    if (weight !== 0) {
      return weight;
    }
    return collator.compare(
      locale === LOCALE.AR ? left.name.ar : left.name.en,
      locale === LOCALE.AR ? right.name.ar : right.name.en,
    );
  });
}

function cacheKey(
  queryType: SaudiAddressCacheRecord["query_type"],
  parts: string[],
): string {
  const normalizedParts = parts.map((part) => part.trim().toUpperCase());
  return [
    queryType,
    normalizedParts.join(CACHE_KEY.PART_SEPARATOR),
  ].join(CACHE_KEY.SEPARATOR);
}

function dateMs(value: Date | string): number {
  return new Date(value).getTime();
}

function isFresh(row: SaudiAddressCacheRecord, now: Date): boolean {
  return dateMs(row.expires_at) > now.getTime();
}

function isStaleReadable(row: SaudiAddressCacheRecord, now: Date): boolean {
  return dateMs(row.stale_expires_at) > now.getTime();
}

function isResolvePayload(
  value: unknown,
): value is SaudiAddressResolveSuccessResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.status === SPL_RESOLVE_STATUS.FOUND ||
      record.status === SPL_RESOLVE_STATUS.NOT_FOUND) &&
    typeof record.short_address === "string" &&
    typeof record.found === "boolean"
  );
}

function resolvePayload(
  value: unknown,
): SaudiAddressResolveSuccessResult | undefined {
  return isResolvePayload(value) ? value : undefined;
}

function withResolveCacheState(
  payload: SaudiAddressResolveSuccessResult,
  cacheState: SaudiAddressResolveSuccessResult["cache_state"],
): SaudiAddressResolveSuccessResult {
  return {
    ...payload,
    cache_state: cacheState,
  };
}

function isVerifyPayload(
  value: unknown,
): value is SaudiAddressOfficialVerifyResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.verified === "boolean";
}

function verifyPayload(
  value: unknown,
): SaudiAddressOfficialVerifyResult | undefined {
  return isVerifyPayload(value) ? value : undefined;
}

function withVerifyCacheState(
  payload: SaudiAddressOfficialVerifyResult,
  cacheState: SaudiAddressOfficialVerifyResult["cache_state"],
): SaudiAddressOfficialVerifyResult {
  return {
    ...payload,
    cache_state: cacheState,
  };
}

function cachePayload(payload: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload));
}

function officialVerifyInput(
  input: SaudiAddressValidateInput,
): SaudiAddressOfficialVerifyInput | undefined {
  if (
    input.buildingNumber === undefined ||
    input.postCode === undefined ||
    input.additionalNumber === undefined
  ) {
    return undefined;
  }
  return {
    buildingNumber: input.buildingNumber,
    postCode: input.postCode,
    additionalNumber: input.additionalNumber,
  };
}

/**
 * Saudi Address module service. `MedusaService` provides CRUD methods for the
 * seeded geography tables; domain list/search/validation methods are layered
 * on top in later slices.
 */
class SaudiAddressModuleService extends MedusaService({
  SaudiAddressRegion,
  SaudiAddressCity,
  SaudiAddressDistrict,
  SaudiAddressCache,
}) {
  protected readonly options: SaudiAddressOptions;
  protected readonly clock: () => Date;
  protected readonly splClient?: SplClientContract;

  constructor(
    container: Record<string, unknown>,
    options?: unknown,
    deps: SaudiAddressRuntimeDeps = {},
  ) {
    super(container);
    this.options =
      options === undefined
        ? getSaudiAddressOptions()
        : validateSaudiAddressOptions(options, {});
    this.clock = deps.clock ?? (() => new Date());
    this.splClient = deps.splClient ?? this.buildSplClient();
  }

  /** Whether checkout validation should block genuinely invalid addresses. */
  isStrict(): boolean {
    return this.options.strict;
  }

  /** Whether the optional SPL adapter is enabled by API key. */
  isSplEnabled(): boolean {
    return this.splClient !== undefined;
  }

  /**
   * List Saudi regions from the offline dataset, with Riyadh pinned first and
   * the remaining rows sorted by the requested locale.
   */
  async regions(input: ListInput = {}): Promise<SaudiRegionListItem[]> {
    const locale = input.locale ?? DEFAULT_LOCALE;
    const rows = await generatedMethods(this).listSaudiAddressRegions();
    return sortByLocale(rows, locale).map(regionItem);
  }

  /**
   * List cities for a Saudi region from the offline dataset, with Riyadh city
   * pinned first when it belongs to the requested region.
   */
  async cities(input: CitiesInput): Promise<SaudiCityListItem[]> {
    const filters: ListFilters = {
      region_code: input.regionCode,
    };
    const rows = await generatedMethods(this).listSaudiAddressCities(filters);
    return sortByLocale(rows, input.locale ?? DEFAULT_LOCALE).map(cityItem);
  }

  /** List districts for a Saudi city from the offline dataset. */
  async districts(input: DistrictsInput): Promise<SaudiDistrictListItem[]> {
    const filters: ListFilters = {
      city_code: input.cityCode,
    };
    const rows = await generatedMethods(this).listSaudiAddressDistricts(filters);
    return sortByLocale(rows, input.locale ?? DEFAULT_LOCALE).map(districtItem);
  }

  /** Search the offline region/city/district dataset. No network is used. */
  async search(
    input: SaudiAddressSearchInput,
  ): Promise<SaudiAddressSearchResult[]> {
    const query = input.query.trim();
    if (query === "") {
      return [];
    }

    const [regions, cities, districts] = await Promise.all([
      generatedMethods(this).listSaudiAddressRegions(),
      generatedMethods(this).listSaudiAddressCities(),
      generatedMethods(this).listSaudiAddressDistricts(),
    ]);
    const matches = [
      ...regions.filter((row) => includesQuery(row, query)).map(regionSearchItem),
      ...cities.filter((row) => includesQuery(row, query)).map(citySearchItem),
      ...districts
        .filter((row) => includesQuery(row, query))
        .map(districtSearchItem),
    ];

    return sortSearchResults(
      matches,
      input.locale ?? DEFAULT_LOCALE,
    ).slice(0, boundedLimit(input.limit));
  }

  /**
   * Structurally validate a city/district pair against the offline dataset.
   * A pair is valid only when both exist and the district belongs to the city.
   */
  async validate(
    input: SaudiAddressValidateInput,
  ): Promise<SaudiAddressValidateResult> {
    const city = await this.findCity(input);
    if (city === undefined) {
      return {
        status: ADDRESS_STATUS.UNVALIDATED,
        reason: VALIDATION_REASON.CITY_NOT_FOUND,
      };
    }

    const district = await this.findDistrict(input, city);
    if (district === undefined) {
      return {
        status: ADDRESS_STATUS.UNVALIDATED,
        reason: VALIDATION_REASON.DISTRICT_NOT_FOUND,
        city: cityItem(city),
      };
    }

    if (district.city_code !== city.code) {
      return {
        status: ADDRESS_STATUS.UNVALIDATED,
        reason: VALIDATION_REASON.DISTRICT_CITY_MISMATCH,
        city: cityItem(city),
        district: districtItem(district),
      };
    }

    const officialInput = officialVerifyInput(input);
    if (officialInput !== undefined && this.splClient !== undefined) {
      try {
        const official = await this.verifyNationalAddress(officialInput);
        if (
          !official.verified &&
          official.cache_state !== SPL_CACHE_STATE.STALE
        ) {
          return {
            status: ADDRESS_STATUS.UNVALIDATED,
            reason: VALIDATION_REASON.OFFICIAL_NOT_FOUND,
            city: cityItem(city),
            district: districtItem(district),
          };
        }
      } catch {
        // SPL is optional and unreliable; structural validation remains the floor.
      }
    }

    return {
      status: ADDRESS_STATUS.VALID,
      city: cityItem(city),
      district: districtItem(district),
    };
  }

  /** Resolve a Saudi short address through the optional SPL adapter. */
  async resolveShortAddress(
    input: SaudiAddressResolveInput,
  ): Promise<SaudiAddressResolveResult> {
    if (this.splClient === undefined) {
      return {
        status: SPL_RESOLVE_STATUS.DISABLED,
        message: SPL_RESOLVE_DISABLED_MESSAGE,
      };
    }

    const shortAddress = input.shortAddress.trim().toUpperCase();
    const key = cacheKey(QUERY_TYPE.SHORT_ADDRESS, [shortAddress]);
    const cached = await this.cacheRow(key);
    if (cached !== undefined && isFresh(cached, this.clock())) {
      const payload = resolvePayload(cached.payload);
      if (payload !== undefined) {
        return withResolveCacheState(payload, SPL_CACHE_STATE.HIT);
      }
    }

    try {
      const resolved = await this.splClient.resolveShortAddress(shortAddress);
      await this.writeCache(
        QUERY_TYPE.SHORT_ADDRESS,
        key,
        cachePayload(resolved),
        cached,
      );
      return resolved;
    } catch (err) {
      const payload = resolvePayload(cached?.payload);
      if (
        cached !== undefined &&
        payload !== undefined &&
        isStaleReadable(cached, this.clock())
      ) {
        return withResolveCacheState(payload, SPL_CACHE_STATE.STALE);
      }
      throw err;
    }
  }

  /** Officially verify a National Address tuple through the optional SPL adapter. */
  async verifyNationalAddress(
    input: SaudiAddressOfficialVerifyInput,
  ): Promise<SaudiAddressOfficialVerifyResult> {
    if (this.splClient === undefined) {
      return {
        verified: false,
        cache_state: SPL_CACHE_STATE.MISS,
      };
    }

    const key = cacheKey(QUERY_TYPE.NATIONAL_ADDRESS, [
      input.buildingNumber,
      input.postCode,
      input.additionalNumber,
    ]);
    const cached = await this.cacheRow(key);
    if (cached !== undefined && isFresh(cached, this.clock())) {
      const payload = verifyPayload(cached.payload);
      if (payload !== undefined) {
        return withVerifyCacheState(payload, SPL_CACHE_STATE.HIT);
      }
    }

    try {
      const verified = await this.splClient.verifyNationalAddress(input);
      await this.writeCache(
        QUERY_TYPE.NATIONAL_ADDRESS,
        key,
        cachePayload(verified),
        cached,
      );
      return verified;
    } catch (err) {
      const payload = verifyPayload(cached?.payload);
      if (
        cached !== undefined &&
        payload !== undefined &&
        isStaleReadable(cached, this.clock())
      ) {
        return withVerifyCacheState(payload, SPL_CACHE_STATE.STALE);
      }
      throw err;
    }
  }

  private async findCity(
    input: SaudiAddressValidateInput,
  ): Promise<SaudiCityRecord | undefined> {
    if (input.cityCode !== undefined) {
      const rows = await generatedMethods(this).listSaudiAddressCities({
        code: input.cityCode,
      });
      return rows[0];
    }
    if (input.cityName === undefined) {
      return undefined;
    }
    const cityName = input.cityName;
    const rows = await generatedMethods(this).listSaudiAddressCities();
    return rows.find((row) => matchesName(row, cityName));
  }

  private async findDistrict(
    input: SaudiAddressValidateInput,
    city: SaudiCityRecord,
  ): Promise<SaudiDistrictRecord | undefined> {
    if (input.districtCode !== undefined) {
      const rows = await generatedMethods(this).listSaudiAddressDistricts({
        code: input.districtCode,
      });
      return rows[0];
    }
    if (input.districtName === undefined) {
      return undefined;
    }
    const districtName = input.districtName;
    const rows = await generatedMethods(this).listSaudiAddressDistricts({
      city_code: city.code,
    });
    return rows.find((row) => matchesName(row, districtName));
  }

  private buildSplClient(): SplClientContract | undefined {
    if (this.options.nationalAddressApiKey === undefined) {
      return undefined;
    }
    return new SplClient({
      apiKey: this.options.nationalAddressApiKey,
      baseUrl: this.options.baseUrl,
      timeoutMs: this.options.timeoutMs,
      retry: this.options.retry,
    });
  }

  private async cacheRow(
    key: string,
  ): Promise<SaudiAddressCacheRecord | undefined> {
    const [row] = await generatedMethods(this).listSaudiAddressCaches(
      { cache_key: key },
      { take: 1 },
    );
    return row;
  }

  private async writeCache(
    queryType: SaudiAddressCacheRecord["query_type"],
    key: string,
    payload: Record<string, unknown>,
    existing: SaudiAddressCacheRecord | undefined,
  ): Promise<void> {
    const now = this.clock();
    const input: SaudiAddressCacheInsert = {
      cache_key: key,
      query_type: queryType,
      payload,
      expires_at: new Date(now.getTime() + TTL.FRESH_MS),
      stale_expires_at: new Date(now.getTime() + TTL.STALE_MS),
    };
    if (existing === undefined) {
      await generatedMethods(this).createSaudiAddressCaches(input);
      return;
    }
    await generatedMethods(this).updateSaudiAddressCaches({
      id: existing.id,
      ...input,
    });
  }
}

export default SaudiAddressModuleService;
