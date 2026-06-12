import { MedusaService } from "@medusajs/framework/utils";

import {
  COLLATOR_LOCALE,
  DEFAULT_LOCALE,
  LOCALE,
} from "./constants.js";
import SaudiAddressCity from "./models/city.js";
import SaudiAddressDistrict from "./models/district.js";
import SaudiAddressRegion from "./models/region.js";
import type {
  SaudiAddressLocale,
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
}

export default SaudiAddressModuleService;
