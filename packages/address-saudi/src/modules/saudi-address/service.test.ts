import { describe, expect, it, vi } from "vitest";

import {
  ADDRESS_STATUS,
  SPL_CACHE_STATE,
  SPL_RESOLVE_DISABLED_MESSAGE,
  SPL_RESOLVE_STATUS,
  QUERY_TYPE,
  VALIDATION_REASON,
} from "./constants.js";
import SaudiAddressModuleService from "./service.js";
import type {
  SaudiAddressCacheRecord,
  SaudiAddressResolveSuccessResult,
  SaudiCityRecord,
  SaudiDistrictRecord,
  SaudiRegionRecord,
  SplClientContract,
} from "./types.js";

function makeService(methods: Record<string, unknown>): SaudiAddressModuleService {
  const service = new SaudiAddressModuleService({});
  for (const [name, value] of Object.entries(methods)) {
    Reflect.set(service, name, value);
  }
  return service;
}

function makeSplService(
  methods: Record<string, unknown>,
  splClient: SplClientContract,
  now = new Date("2026-06-12T12:00:00.000Z"),
): SaudiAddressModuleService {
  const service = new SaudiAddressModuleService(
    {},
    { nationalAddressApiKey: "spl_secret" },
    {
      clock: () => now,
      splClient,
    },
  );
  for (const [name, value] of Object.entries(methods)) {
    Reflect.set(service, name, value);
  }
  return service;
}

function cacheRow(
  payload: Record<string, unknown>,
  expiresAt: string,
  staleExpiresAt = "2026-07-12T12:00:00.000Z",
  cacheKey = "short_address:RRRD2929",
  queryType: string = QUERY_TYPE.SHORT_ADDRESS,
): SaudiAddressCacheRecord {
  return {
    id: "sacache_1",
    cache_key: cacheKey,
    query_type: queryType,
    payload,
    expires_at: expiresAt,
    stale_expires_at: staleExpiresAt,
  };
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

describe("SaudiAddressModuleService search and validation", () => {
  it("searches regions, cities, and districts offline", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = makeService({
      listSaudiAddressRegions: vi.fn(async () => REGIONS),
      listSaudiAddressCities: vi.fn(async () => CITIES),
      listSaudiAddressDistricts: vi.fn(async () => DISTRICTS),
    });

    const results = await service.search({ query: "riyadh", locale: "en" });

    expect(results.map((result) => result.entity)).toEqual(["region", "city"]);
    expect(results[0]).toMatchObject({
      code: "RD",
      name: { ar: "منطقة الرياض", en: "Riyadh" },
    });

    const districtResults = await service.search({ query: "amal", locale: "en" });
    expect(districtResults).toEqual([
      {
        entity: "district",
        code: "1",
        city_code: "3",
        region_code: "RD",
        name: { ar: "حي العمل", en: "Al Amal Dist." },
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns valid for a real consistent city/district pair", async () => {
    const service = makeService({
      listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
        CITIES.filter((city) => city.code === filters?.code),
      ),
      listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
        DISTRICTS.filter((district) => district.code === filters?.code),
      ),
    });

    const result = await service.validate({
      cityCode: "3",
      districtCode: "1",
    });

    expect(result).toMatchObject({
      status: ADDRESS_STATUS.VALID,
      city: { code: "3" },
      district: { code: "1", city_code: "3" },
    });
  });

  it("returns unvalidated when city and district are mismatched", async () => {
    const service = makeService({
      listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
        CITIES.filter((city) => city.code === filters?.code),
      ),
      listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
        DISTRICTS.filter((district) => district.code === filters?.code),
      ),
    });

    const result = await service.validate({
      cityCode: "6",
      districtCode: "1",
    });

    expect(result).toMatchObject({
      status: ADDRESS_STATUS.UNVALIDATED,
      reason: VALIDATION_REASON.DISTRICT_CITY_MISMATCH,
    });
  });

  it("returns unvalidated for a bad city or district", async () => {
    const service = makeService({
      listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
        CITIES.filter((city) => city.code === filters?.code),
      ),
      listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
        DISTRICTS.filter((district) => district.code === filters?.code),
      ),
    });

    await expect(
      service.validate({ cityCode: "missing", districtCode: "1" }),
    ).resolves.toMatchObject({
      status: ADDRESS_STATUS.UNVALIDATED,
      reason: VALIDATION_REASON.CITY_NOT_FOUND,
    });
    await expect(
      service.validate({ cityCode: "3", districtCode: "missing" }),
    ).resolves.toMatchObject({
      status: ADDRESS_STATUS.UNVALIDATED,
      reason: VALIDATION_REASON.DISTRICT_NOT_FOUND,
    });
  });
});

describe("SaudiAddressModuleService optional SPL adapter", () => {
  const RESOLVED: SaudiAddressResolveSuccessResult = {
    status: SPL_RESOLVE_STATUS.FOUND,
    cache_state: SPL_CACHE_STATE.MISS,
    short_address: "RRRD2929",
    found: true,
    address: {
      building_number: "8228",
      post_code: "12643",
      additional_number: "2121",
      city: { ar: "الرياض", en: "Riyadh" },
      district: { ar: "العمل", en: "Al Amal" },
      street: { ar: "طريق الملك عبدالعزيز", en: "King Abdulaziz Road" },
      region: { ar: "الرياض", en: "Riyadh" },
    },
  };

  it("keeps the adapter cleanly off without an API key", async () => {
    const service = new SaudiAddressModuleService({});

    await expect(
      service.resolveShortAddress({ shortAddress: "RRRD2929" }),
    ).resolves.toEqual({
      status: SPL_RESOLVE_STATUS.DISABLED,
      message: SPL_RESOLVE_DISABLED_MESSAGE,
    });
  });

  it("serves a fresh short-address cache hit without calling SPL", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(async () => {
        throw new Error("should not call SPL");
      }),
      verifyNationalAddress: vi.fn(),
    };
    const listSaudiAddressCaches = vi.fn(async () => [
      cacheRow({ ...RESOLVED }, "2026-06-13T12:00:00.000Z"),
    ]);
    const service = makeSplService({ listSaudiAddressCaches }, splClient);

    const result = await service.resolveShortAddress({ shortAddress: "RRRD2929" });

    expect(result).toEqual({
      ...RESOLVED,
      cache_state: SPL_CACHE_STATE.HIT,
    });
    expect(splClient.resolveShortAddress).not.toHaveBeenCalled();
  });

  it("serves stale short-address cache when SPL is down", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(async () => {
        throw new Error("SPL unavailable");
      }),
      verifyNationalAddress: vi.fn(),
    };
    const listSaudiAddressCaches = vi.fn(async () => [
      cacheRow({ ...RESOLVED }, "2026-06-11T12:00:00.000Z"),
    ]);
    const service = makeSplService({ listSaudiAddressCaches }, splClient);

    const result = await service.resolveShortAddress({ shortAddress: "RRRD2929" });

    expect(result).toEqual({
      ...RESOLVED,
      cache_state: SPL_CACHE_STATE.STALE,
    });
    expect(splClient.resolveShortAddress).toHaveBeenCalledTimes(1);
  });

  it("fetches and stores a short-address cache miss", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(async () => RESOLVED),
      verifyNationalAddress: vi.fn(),
    };
    const createSaudiAddressCaches = vi.fn(async () => RESOLVED);
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => []),
        createSaudiAddressCaches,
      },
      splClient,
    );

    const result = await service.resolveShortAddress({ shortAddress: "RRRD2929" });

    expect(result).toEqual(RESOLVED);
    expect(createSaudiAddressCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        cache_key: "short_address:RRRD2929",
        query_type: QUERY_TYPE.SHORT_ADDRESS,
      }),
    );
  });

  it("serves a fresh official verify cache hit without calling SPL", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(),
      verifyNationalAddress: vi.fn(async () => {
        throw new Error("should not call SPL");
      }),
    };
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => [
          cacheRow(
            { verified: true, cache_state: SPL_CACHE_STATE.MISS },
            "2026-06-13T12:00:00.000Z",
            "2026-07-12T12:00:00.000Z",
            "national_address:8228|12643|2121",
            QUERY_TYPE.NATIONAL_ADDRESS,
          ),
        ]),
      },
      splClient,
    );

    await expect(
      service.verifyNationalAddress({
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).resolves.toEqual({
      verified: true,
      cache_state: SPL_CACHE_STATE.HIT,
    });
    expect(splClient.verifyNationalAddress).not.toHaveBeenCalled();
  });

  it("serves stale official verify cache when SPL is down", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(),
      verifyNationalAddress: vi.fn(async () => {
        throw new Error("SPL unavailable");
      }),
    };
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => [
          cacheRow(
            { verified: true, cache_state: SPL_CACHE_STATE.MISS },
            "2026-06-11T12:00:00.000Z",
            "2026-07-12T12:00:00.000Z",
            "national_address:8228|12643|2121",
            QUERY_TYPE.NATIONAL_ADDRESS,
          ),
        ]),
      },
      splClient,
    );

    await expect(
      service.verifyNationalAddress({
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).resolves.toEqual({
      verified: true,
      cache_state: SPL_CACHE_STATE.STALE,
    });
  });

  it("adds official verification when complete building fields are provided", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(),
      verifyNationalAddress: vi.fn(async () => ({
        verified: false,
        cache_state: SPL_CACHE_STATE.MISS,
      })),
    };
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => []),
        createSaudiAddressCaches: vi.fn(),
        listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
          CITIES.filter((city) => city.code === filters?.code),
        ),
        listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
          DISTRICTS.filter((district) => district.code === filters?.code),
        ),
      },
      splClient,
    );

    const result = await service.validate({
      cityCode: "3",
      districtCode: "1",
      buildingNumber: "8228",
      postCode: "12643",
      additionalNumber: "2121",
    });

    expect(result).toMatchObject({
      status: ADDRESS_STATUS.UNVALIDATED,
      reason: VALIDATION_REASON.OFFICIAL_NOT_FOUND,
    });
  });

  it("falls open to structural validation when official verification is down", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(),
      verifyNationalAddress: vi.fn(async () => {
        throw new Error("SPL unavailable");
      }),
    };
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => []),
        listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
          CITIES.filter((city) => city.code === filters?.code),
        ),
        listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
          DISTRICTS.filter((district) => district.code === filters?.code),
        ),
      },
      splClient,
    );

    await expect(
      service.validate({
        cityCode: "3",
        districtCode: "1",
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).resolves.toMatchObject({
      status: ADDRESS_STATUS.VALID,
    });
  });

  it("does not block validation on a stale official invalid result", async () => {
    const splClient: SplClientContract = {
      resolveShortAddress: vi.fn(),
      verifyNationalAddress: vi.fn(async () => {
        throw new Error("SPL unavailable");
      }),
    };
    const service = makeSplService(
      {
        listSaudiAddressCaches: vi.fn(async () => [
          cacheRow(
            { verified: false, cache_state: SPL_CACHE_STATE.MISS },
            "2026-06-11T12:00:00.000Z",
            "2026-07-12T12:00:00.000Z",
            "national_address:8228|12643|2121",
            QUERY_TYPE.NATIONAL_ADDRESS,
          ),
        ]),
        listSaudiAddressCities: vi.fn(async (filters?: { code?: string }) =>
          CITIES.filter((city) => city.code === filters?.code),
        ),
        listSaudiAddressDistricts: vi.fn(async (filters?: { code?: string }) =>
          DISTRICTS.filter((district) => district.code === filters?.code),
        ),
      },
      splClient,
    );

    await expect(
      service.validate({
        cityCode: "3",
        districtCode: "1",
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).resolves.toMatchObject({
      status: ADDRESS_STATUS.VALID,
    });
  });
});
