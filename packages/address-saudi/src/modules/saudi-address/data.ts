import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  DATASET_COUNTS,
  GEO_DATA_PACKAGE,
  GEO_DATA_PATH,
  ID_PREFIX,
  RIYADH_CITY_CODE,
  RIYADH_REGION_CODE,
} from "./constants.js";
import type {
  RawSaudiCity,
  RawSaudiDistrict,
  RawSaudiRegion,
  SaudiCitySeed,
  SaudiDistrictSeed,
  SaudiGeoDataset,
  SaudiRegionSeed,
} from "./types.js";

const DATA_REPOSITORY =
  "https://github.com/homaily/Saudi-Arabia-Regions-Cities-and-Districts";

interface Resolver {
  resolve(id: string): string;
}

function readJson<T>(resolver: Resolver, path: string): T {
  const filePath = resolver.resolve(`${GEO_DATA_PACKAGE}/${path}`);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function code(value: number): string {
  return String(value);
}

function rowId(prefix: string, value: string): string {
  return `${prefix}_${value}`;
}

function regionSortWeight(region: RawSaudiRegion): number {
  return region.code === RIYADH_REGION_CODE ? -1 : 0;
}

function citySortWeight(city: RawSaudiCity): number {
  return code(city.city_id) === RIYADH_CITY_CODE ? -1 : 0;
}

function districtSortWeight(_district: RawSaudiDistrict): number {
  return 0;
}

function regionById(regions: RawSaudiRegion[]): Map<number, RawSaudiRegion> {
  return new Map(regions.map((region) => [region.region_id, region]));
}

function normalizeRegions(regions: RawSaudiRegion[]): SaudiRegionSeed[] {
  return regions.map((region) => {
    const regionCode = region.code;
    return {
      id: rowId(ID_PREFIX.REGION, regionCode),
      code: regionCode,
      name_ar: region.name_ar,
      name_en: region.name_en,
      sort_weight: regionSortWeight(region),
      capital_city_code: code(region.capital_city_id),
      population: region.population ?? null,
    };
  });
}

function normalizeCities(
  cities: RawSaudiCity[],
  regions: Map<number, RawSaudiRegion>,
): SaudiCitySeed[] {
  return cities.map((city) => {
    const region = regions.get(city.region_id);
    const cityCode = code(city.city_id);
    return {
      id: rowId(ID_PREFIX.CITY, cityCode),
      code: cityCode,
      region_code: region?.code ?? code(city.region_id),
      name_ar: city.name_ar,
      name_en: city.name_en,
      sort_weight: citySortWeight(city),
    };
  });
}

function normalizeDistricts(
  districts: RawSaudiDistrict[],
  regions: Map<number, RawSaudiRegion>,
): SaudiDistrictSeed[] {
  return districts.map((district) => {
    const region = regions.get(district.region_id);
    const districtCode = code(district.district_id);
    return {
      id: rowId(ID_PREFIX.DISTRICT, districtCode),
      code: districtCode,
      city_code: code(district.city_id),
      region_code: region?.code ?? code(district.region_id),
      name_ar: district.name_ar,
      name_en: district.name_en,
      sort_weight: districtSortWeight(district),
    };
  });
}

function assertCounts(dataset: SaudiGeoDataset): void {
  if (
    dataset.regions.length !== DATASET_COUNTS.REGIONS ||
    dataset.cities.length !== DATASET_COUNTS.CITIES ||
    dataset.districts.length !== DATASET_COUNTS.DISTRICTS
  ) {
    throw new Error(
      `Saudi geography dataset count mismatch: ` +
        `${dataset.regions.length}/${dataset.cities.length}/${dataset.districts.length}`,
    );
  }
}

/**
 * Load and normalize the GPL-2.0 Saudi geography dependency for DB seeding.
 * The data remains in the dependency package; this module only reads it.
 */
export function loadSaudiGeoDataset(
  resolver: Resolver = createRequire(import.meta.url),
): SaudiGeoDataset {
  const rawRegions = readJson<RawSaudiRegion[]>(resolver, GEO_DATA_PATH.REGIONS);
  const rawCities = readJson<RawSaudiCity[]>(resolver, GEO_DATA_PATH.CITIES);
  const rawDistricts = readJson<RawSaudiDistrict[]>(
    resolver,
    GEO_DATA_PATH.DISTRICTS,
  );
  const regionsById = regionById(rawRegions);

  const dataset: SaudiGeoDataset = {
    regions: normalizeRegions(rawRegions),
    cities: normalizeCities(rawCities, regionsById),
    districts: normalizeDistricts(rawDistricts, regionsById),
    source: {
      packageName: GEO_DATA_PACKAGE,
      license: "GPL-2.0",
      repository: DATA_REPOSITORY,
    },
  };

  assertCounts(dataset);
  return dataset;
}
