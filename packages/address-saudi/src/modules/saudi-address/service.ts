import { MedusaService } from "@medusajs/framework/utils";

import {
  ADDRESS_STATUS,
  COLLATOR_LOCALE,
  DEFAULT_LOCALE,
  ENTITY,
  ENTITY_SEARCH_WEIGHT,
  LOCALE,
  SEARCH_LIMIT,
  VALIDATION_REASON,
} from "./constants.js";
import SaudiAddressCity from "./models/city.js";
import SaudiAddressDistrict from "./models/district.js";
import SaudiAddressRegion from "./models/region.js";
import type {
  SaudiAddressLocale,
  SaudiAddressSearchInput,
  SaudiAddressSearchResult,
  SaudiAddressValidateInput,
  SaudiAddressValidateResult,
  SaudiCityListItem,
  SaudiCityRecord,
  SaudiDistrictListItem,
  SaudiDistrictRecord,
  SaudiRegionListItem,
  SaudiRegionRecord,
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

/**
 * Saudi Address module service. `MedusaService` provides CRUD methods for the
 * seeded geography tables; domain list/search/validation methods are layered
 * on top in later slices.
 */
class SaudiAddressModuleService extends MedusaService({
  SaudiAddressRegion,
  SaudiAddressCity,
  SaudiAddressDistrict,
}) {
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

    return {
      status: ADDRESS_STATUS.VALID,
      city: cityItem(city),
      district: districtItem(district),
    };
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
}

export default SaudiAddressModuleService;
