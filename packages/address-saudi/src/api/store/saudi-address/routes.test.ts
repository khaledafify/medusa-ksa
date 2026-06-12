import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";
import { describe, expect, it, vi } from "vitest";

import {
  ADDRESS_STATUS,
  HTTP_STATUS,
  LOCALE,
  SPL_RESOLVE_DISABLED_MESSAGE,
  SPL_RESOLVE_STATUS,
  SPL_CACHE_STATE,
  STORE_FIELD,
  STORE_RESPONSE_KEY,
  VALIDATION_REASON,
} from "../../../modules/saudi-address/constants.js";
import type {
  SaudiAddressSearchInput,
  SaudiAddressValidateInput,
} from "../../../modules/saudi-address/types.js";
import { GET as getCities } from "./cities/route.js";
import { GET as getDistricts } from "./districts/route.js";
import { GET as getRegions } from "./regions/route.js";
import { POST as postResolve } from "./resolve/route.js";
import { GET as getSearch } from "./search/route.js";
import type {
  StoreSaudiAddressCitiesQuery,
  StoreSaudiAddressDistrictsQuery,
  StoreSaudiAddressRegionsQuery,
  StoreSaudiAddressResolveBody,
  StoreSaudiAddressSearchQuery,
  StoreSaudiAddressValidateBody,
} from "./validators.js";
import { POST as postValidate } from "./validate/route.js";

interface CapturedResponse<Body> {
  payload?: Body;
  statusCode?: number;
  json(payload: Body): CapturedResponse<Body>;
  status(code: number): CapturedResponse<Body>;
}

interface FakeService {
  regions: ReturnType<typeof vi.fn>;
  cities: ReturnType<typeof vi.fn>;
  districts: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  validate: ReturnType<typeof vi.fn>;
  resolveShortAddress: ReturnType<typeof vi.fn>;
}

function makeResponse<Body>(): MedusaResponse<Body> & CapturedResponse<Body> {
  const response: CapturedResponse<Body> = {
    json(payload) {
      response.payload = payload;
      return response;
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
  };

  return response as MedusaResponse<Body> & CapturedResponse<Body>;
}

function makeRequest<Body, Query>(
  validatedBody: Body,
  validatedQuery: Query,
  service: unknown,
): MedusaStoreRequest<Body, Query> {
  return {
    validatedBody,
    validatedQuery,
    publishable_key_context: {
      key: "pk_test",
      sales_channel_ids: [],
    },
    scope: {
      resolve: vi.fn(() => service),
    },
  } as unknown as MedusaStoreRequest<Body, Query>;
}

function makeService(): FakeService {
  return {
    regions: vi.fn(),
    cities: vi.fn(),
    districts: vi.fn(),
    search: vi.fn(),
    validate: vi.fn(),
    resolveShortAddress: vi.fn(),
  };
}

function expectNoSecret(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain("NATIONAL_ADDRESS_API_KEY");
  expect(serialized).not.toContain("secret");
}

describe("Saudi Address Store API routes", () => {
  it("returns bilingual offline regions", async () => {
    const service = makeService();
    const regions = [
      {
        code: "RD",
        name: { ar: "الرياض", en: "Riyadh" },
      },
    ];
    service.regions.mockResolvedValue(regions);
    const response = makeResponse();

    await getRegions(
      makeRequest<unknown, StoreSaudiAddressRegionsQuery>(
        undefined,
        { [STORE_FIELD.LOCALE]: LOCALE.EN },
        service,
      ),
      response,
    );

    expect(service.regions).toHaveBeenCalledWith({ locale: LOCALE.EN });
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.REGIONS]: regions,
    });
    expectNoSecret(response.payload);
  });

  it("passes region filters to the offline cities service", async () => {
    const service = makeService();
    const cities = [
      {
        code: "3",
        region_code: "RD",
        name: { ar: "الرياض", en: "Riyadh" },
      },
    ];
    service.cities.mockResolvedValue(cities);
    const response = makeResponse();

    await getCities(
      makeRequest<unknown, StoreSaudiAddressCitiesQuery>(
        undefined,
        {
          [STORE_FIELD.REGION_CODE]: "RD",
          [STORE_FIELD.LOCALE]: LOCALE.AR,
        },
        service,
      ),
      response,
    );

    expect(service.cities).toHaveBeenCalledWith({
      regionCode: "RD",
      locale: LOCALE.AR,
    });
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.CITIES]: cities,
    });
    expectNoSecret(response.payload);
  });

  it("passes city filters to the offline districts service", async () => {
    const service = makeService();
    const districts = [
      {
        code: "101",
        city_code: "3",
        region_code: "RD",
        name: { ar: "العليا", en: "Olaya" },
      },
    ];
    service.districts.mockResolvedValue(districts);
    const response = makeResponse();

    await getDistricts(
      makeRequest<unknown, StoreSaudiAddressDistrictsQuery>(
        undefined,
        {
          [STORE_FIELD.CITY_CODE]: "3",
          [STORE_FIELD.LOCALE]: LOCALE.EN,
        },
        service,
      ),
      response,
    );

    expect(service.districts).toHaveBeenCalledWith({
      cityCode: "3",
      locale: LOCALE.EN,
    });
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.DISTRICTS]: districts,
    });
    expectNoSecret(response.payload);
  });

  it("searches the offline dataset through the service", async () => {
    const service = makeService();
    const results = [
      {
        entity: "city",
        code: "3",
        region_code: "RD",
        name: { ar: "الرياض", en: "Riyadh" },
      },
    ];
    service.search.mockResolvedValue(results);
    const response = makeResponse();

    await getSearch(
      makeRequest<unknown, StoreSaudiAddressSearchQuery>(
        undefined,
        {
          [STORE_FIELD.QUERY]: "Riyadh",
          [STORE_FIELD.LIMIT]: 1,
          [STORE_FIELD.LOCALE]: LOCALE.EN,
        },
        service,
      ),
      response,
    );

    expect(service.search).toHaveBeenCalledWith({
      query: "Riyadh",
      limit: 1,
      locale: LOCALE.EN,
    } satisfies SaudiAddressSearchInput);
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.RESULTS]: results,
    });
    expectNoSecret(response.payload);
  });

  it("validates addresses structurally through the offline service", async () => {
    const service = makeService();
    const validation = {
      status: ADDRESS_STATUS.UNVALIDATED,
      reason: VALIDATION_REASON.DISTRICT_CITY_MISMATCH,
    };
    service.validate.mockResolvedValue(validation);
    const response = makeResponse();
    const body = {
      cityCode: "3",
      districtCode: "999",
      cityName: undefined,
      districtName: undefined,
      buildingNumber: undefined,
      postCode: undefined,
      additionalNumber: undefined,
      locale: LOCALE.EN,
    } satisfies StoreSaudiAddressValidateBody;

    await postValidate(
      makeRequest<StoreSaudiAddressValidateBody, Record<string, never>>(
        body,
        {},
        service,
      ),
      response,
    );

    expect(service.validate).toHaveBeenCalledWith(
      body satisfies SaudiAddressValidateInput,
    );
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.VALIDATION]: validation,
    });
    expectNoSecret(response.payload);
  });

  it("returns the disabled resolve response when the SPL adapter is off", async () => {
    const service = makeService();
    service.resolveShortAddress.mockResolvedValue({
      status: SPL_RESOLVE_STATUS.DISABLED,
      message: SPL_RESOLVE_DISABLED_MESSAGE,
    });
    const response = makeResponse();
    const body = {
      shortAddress: "RRRD2929",
    } satisfies StoreSaudiAddressResolveBody;

    await postResolve(
      makeRequest<StoreSaudiAddressResolveBody, Record<string, never>>(
        body,
        {},
        service,
      ),
      response,
    );

    expect(service.resolveShortAddress).toHaveBeenCalledWith(body);
    expect(response.statusCode).toBe(HTTP_STATUS.NOT_IMPLEMENTED);
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.RESOLVE]: {
        status: SPL_RESOLVE_STATUS.DISABLED,
        message: SPL_RESOLVE_DISABLED_MESSAGE,
      },
    });
    expectNoSecret(response.payload);
  });

  it("returns cache-aware short-address resolve when the SPL adapter is enabled", async () => {
    const service = makeService();
    service.resolveShortAddress.mockResolvedValue({
      status: SPL_RESOLVE_STATUS.FOUND,
      cache_state: SPL_CACHE_STATE.HIT,
      short_address: "RRRD2929",
      found: true,
      address: {
        building_number: "8228",
        city: { ar: "الرياض", en: "Riyadh" },
      },
    });
    const response = makeResponse();
    const body = {
      shortAddress: "RRRD2929",
    } satisfies StoreSaudiAddressResolveBody;

    await postResolve(
      makeRequest<StoreSaudiAddressResolveBody, Record<string, never>>(
        body,
        {},
        service,
      ),
      response,
    );

    expect(response.statusCode).toBeUndefined();
    expect(response.payload).toEqual({
      [STORE_RESPONSE_KEY.RESOLVE]: {
        status: SPL_RESOLVE_STATUS.FOUND,
        cache_state: SPL_CACHE_STATE.HIT,
        short_address: "RRRD2929",
        found: true,
        address: {
          building_number: "8228",
          city: { ar: "الرياض", en: "Riyadh" },
        },
      },
    });
    expectNoSecret(response.payload);
  });
});
