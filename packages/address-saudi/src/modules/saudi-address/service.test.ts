import { describe, expect, it, vi } from "vitest";

import SaudiAddressModuleService from "./service.js";
import type {
  SaudiCityRecord,
  SaudiDistrictRecord,
  SaudiRegionRecord,
} from "./types.js";

function makeService(methods: Record<string, unknown>): SaudiAddressModuleService {
  const service = new SaudiAddressModuleService({});
  for (const [name, value] of Object.entries(methods)) {
    Reflect.set(service, name, value);
  }
  return service;
}

const REGIONS: SaudiRegionRecord[] = [
  {
    id: "sareg_mk",
    code: "MK",
    name_ar: "منطقة مكة المكرمة",
    name_en: "Makkah",
    sort_weight: 0,
    capital_city_code: "6",
    population: null,
  },
  {
    id: "sareg_rd",
    code: "RD",
    name_ar: "منطقة الرياض",
    name_en: "Riyadh",
    sort_weight: -1,
    capital_city_code: "3",
    population: null,
  },
  {
    id: "sareg_as",
    code: "AS",
    name_ar: "منطقة عسير",
    name_en: "Aseer",
    sort_weight: 0,
    capital_city_code: "15",
    population: null,
  },
];

const CITIES: SaudiCityRecord[] = [
  {
    id: "sacity_6",
    code: "6",
    region_code: "MK",
    name_ar: "مكة",
    name_en: "Makkah",
    sort_weight: 0,
  },
  {
    id: "sacity_3",
    code: "3",
    region_code: "RD",
    name_ar: "الرياض",
    name_en: "Riyadh",
    sort_weight: -1,
  },
  {
    id: "sacity_9",
    code: "9",
    region_code: "RD",
    name_ar: "الدوادمي",
    name_en: "Ad Dawadimi",
    sort_weight: 0,
  },
];

const DISTRICTS: SaudiDistrictRecord[] = [
  {
    id: "sadist_2",
    code: "2",
    city_code: "3",
    region_code: "RD",
    name_ar: "حي النرجس",
    name_en: "An Narjis Dist.",
    sort_weight: 0,
  },
  {
    id: "sadist_1",
    code: "1",
    city_code: "3",
    region_code: "RD",
    name_ar: "حي العمل",
    name_en: "Al Amal Dist.",
    sort_weight: 0,
  },
];

describe("SaudiAddressModuleService listings", () => {
  it("lists regions with Riyadh first and the rest alphabetized by English", async () => {
    const service = makeService({
      listSaudiAddressRegions: vi.fn(async () => REGIONS),
    });

    const regions = await service.regions({ locale: "en" });

    expect(regions.map((region) => region.code)).toEqual(["RD", "AS", "MK"]);
    expect(regions[0]).toEqual({
      code: "RD",
      name: { ar: "منطقة الرياض", en: "Riyadh" },
    });
  });

  it("lists regions with Riyadh first and the rest alphabetized by Arabic", async () => {
    const service = makeService({
      listSaudiAddressRegions: vi.fn(async () => REGIONS),
    });

    const regions = await service.regions({ locale: "ar" });

    expect(regions[0]?.code).toBe("RD");
    expect(regions.slice(1).map((region) => region.name.ar)).toEqual([
      "منطقة عسير",
      "منطقة مكة المكرمة",
    ]);
  });

  it("lists cities by region with Riyadh pinned and bilingual names", async () => {
    const listSaudiAddressCities = vi.fn(async (filters: { region_code: string }) =>
      CITIES.filter((city) => city.region_code === filters.region_code),
    );
    const service = makeService({ listSaudiAddressCities });

    const cities = await service.cities({ regionCode: "RD", locale: "en" });

    expect(listSaudiAddressCities).toHaveBeenCalledWith({ region_code: "RD" });
    expect(cities.map((city) => city.code)).toEqual(["3", "9"]);
    expect(cities[0]).toEqual({
      code: "3",
      region_code: "RD",
      name: { ar: "الرياض", en: "Riyadh" },
    });
  });

  it("lists districts by city with locale-aware ordering and no network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const listSaudiAddressDistricts = vi.fn(async () => DISTRICTS);
    const service = makeService({ listSaudiAddressDistricts });

    const districts = await service.districts({ cityCode: "3", locale: "en" });

    expect(listSaudiAddressDistricts).toHaveBeenCalledWith({ city_code: "3" });
    expect(districts.map((district) => district.code)).toEqual(["1", "2"]);
    expect(districts[0]).toEqual({
      code: "1",
      city_code: "3",
      region_code: "RD",
      name: { ar: "حي العمل", en: "Al Amal Dist." },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
