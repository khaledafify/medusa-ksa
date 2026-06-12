import { afterEach, describe, expect, it, vi } from "vitest";

import { KsaErrorCodes } from "@medusa-ksa/core";

import {
  DEFAULTS,
  FULFILLMENT_DATA_KEYS,
  PROVIDER_ID,
  TOROD_ENDPOINTS,
  TOROD_ERROR_MESSAGES,
  TOROD_HTTP_HEADERS,
  TOROD_MEDIA_TYPES,
  TOROD_PAYMENT,
  TOROD_REQUEST_FIELDS,
  TOROD_RESPONSE_FIELDS,
  TOROD_SHIPMENT_TYPE,
  TOROD_TOKEN,
  optionIdForCourier,
} from "./constants.js";
import { TorodFulfillmentProviderService } from "./service.js";

const CONFIG = {
  clientId: "client_test_id",
  clientSecret: "client_test_secret",
  baseUrl: DEFAULTS.BASE_URL,
};

type RateContext = Parameters<TorodFulfillmentProviderService["calculatePrice"]>[2];

interface StubTorodFetchOptions {
  couriers?: unknown;
  courierStatus?: number;
  cities?: unknown;
  cityStatus?: number;
  rates?: unknown;
  rateStatus?: number;
}

function makeService(
  config: Record<string, unknown> = CONFIG,
): TorodFulfillmentProviderService {
  return new TorodFulfillmentProviderService({}, config);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { [TOROD_HTTP_HEADERS.CONTENT_TYPE]: TOROD_MEDIA_TYPES.JSON },
  });
}

function tokenResponse(token: string) {
  return {
    status: true,
    code: 200,
    data: {
      [TOROD_RESPONSE_FIELDS.BEARER_TOKEN]: token,
      [TOROD_RESPONSE_FIELDS.TOKEN_GENERATED_DATE]: "2026-06-12T09:00:00+03:00",
      [TOROD_RESPONSE_FIELDS.EXPIRES_IN]: "24 Hours",
    },
  };
}

function stubTorodFetch(options: StubTorodFetchOptions) {
  const rateBodies: unknown[] = [];
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace(DEFAULTS.BASE_URL, "");
    if (path === TOROD_TOKEN.PATH) {
      return jsonResponse(tokenResponse("tok_service"));
    }
    if (path === TOROD_ENDPOINTS.COURIERS) {
      return jsonResponse(options.couriers, options.courierStatus);
    }
    if (path.startsWith(TOROD_ENDPOINTS.CITIES)) {
      return jsonResponse(options.cities, options.cityStatus);
    }
    if (path === TOROD_ENDPOINTS.RATES) {
      rateBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonResponse(options.rates, options.rateStatus);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchImpl);
  return { fetchImpl, rateBodies };
}

function rateContext(overrides: Record<string, unknown> = {}): RateContext {
  return {
    id: "cart_test",
    shipping_address: {
      id: "addr_test",
      city: "Riyadh",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    },
    items: [
      {
        id: "item_test",
        quantity: 2,
        requires_shipping: true,
        variant: {
          id: "variant_test",
          weight: 1.5,
          length: 0,
          height: 0,
          width: 0,
          material: "",
          product: { id: "product_test" },
        },
        product: {
          id: "product_test",
          collection_id: "collection_test",
          categories: [],
          tags: [],
        },
      },
    ],
    from_location: {
      id: "sloc_test",
      name: "Riyadh Warehouse",
      metadata: {
        [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
      },
      address_id: "sladdr_test",
      fulfillment_sets: [],
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      deleted_at: null,
    },
    total: 250,
    ...overrides,
  } as unknown as RateContext;
}

function optionData(courierCode = "15"): Record<string, unknown> {
  return {
    id: optionIdForCourier(courierCode),
    [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: courierCode,
  };
}

describe("TorodFulfillmentProviderService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Torod provider identifier expected by Medusa", () => {
    const service = makeService();

    expect(TorodFulfillmentProviderService.identifier).toBe(PROVIDER_ID);
    expect(service.getIdentifier()).toBe(PROVIDER_ID);
  });

  it("validates provider options through the Torod option resolver", () => {
    expect(() => TorodFulfillmentProviderService.validateOptions(CONFIG)).not.toThrow();
    expect(() =>
      TorodFulfillmentProviderService.validateOptions({ clientId: CONFIG.clientId }),
    ).toThrow(/TOROD_CLIENT_SECRET/);
  });

  it("loads one stable fulfillment option per Torod courier", async () => {
    stubTorodFetch({
      couriers: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: 15,
            [TOROD_RESPONSE_FIELDS.TITLE]: "SMSA Express",
            [TOROD_RESPONSE_FIELDS.METHOD]: "standard",
          },
          {
            [TOROD_RESPONSE_FIELDS.ID]: "carrier/with space",
            [TOROD_RESPONSE_FIELDS.TITLE]: "Courier With Space",
          },
        ],
      },
    });

    await expect(makeService().getFulfillmentOptions()).resolves.toEqual([
      {
        id: optionIdForCourier("15"),
        name: "SMSA Express",
        is_return: false,
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: "15",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_NAME]: "SMSA Express",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_METHOD]: "standard",
      },
      {
        id: optionIdForCourier("carrier/with space"),
        name: "Courier With Space",
        is_return: false,
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: "carrier/with space",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_NAME]: "Courier With Space",
      },
    ]);
  });

  it("falls back to the courier id when Torod omits a title", async () => {
    stubTorodFetch({
      couriers: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "untitled",
            [TOROD_RESPONSE_FIELDS.TITLE]: "   ",
          },
        ],
      },
    });

    await expect(makeService().getFulfillmentOptions()).resolves.toMatchObject([
      {
        id: optionIdForCourier("untitled"),
        name: "untitled",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_NAME]: "untitled",
      },
    ]);
  });

  it("rejects malformed courier responses", async () => {
    stubTorodFetch({ couriers: {} });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.COURIERS_DATA_MALFORMED,
      ),
    });
  });

  it("rejects courier responses without a usable id", async () => {
    stubTorodFetch({
      couriers: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.TITLE]: "Missing Id",
          },
        ],
      },
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING),
    });
  });

  it("rejects non-object courier entries", async () => {
    stubTorodFetch({
      couriers: {
        [TOROD_RESPONSE_FIELDS.DATA]: [null],
      },
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING),
    });
  });

  it("rejects duplicate courier ids before exposing admin options", async () => {
    stubTorodFetch({
      couriers: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          { [TOROD_RESPONSE_FIELDS.ID]: "duplicate" },
          { [TOROD_RESPONSE_FIELDS.ID]: "duplicate" },
        ],
      },
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_DUPLICATE),
    });
  });

  it("converts Torod HTTP errors while loading couriers into Medusa errors", async () => {
    stubTorodFetch({ couriers: { message: "forbidden" }, courierStatus: 403 });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.HTTP_ERROR,
      message: expect.stringContaining(TOROD_ENDPOINTS.COURIERS),
    });
  });

  it("accepts option data during the registration skeleton", async () => {
    await expect(makeService().validateOption({})).resolves.toBe(true);
  });

  it("passes fulfillment data through until T2.4 resolves serviceability", async () => {
    const data = { city: "Riyadh" };

    await expect(
      makeService().validateFulfillmentData({}, data, {
        from_location: { id: "sloc_test" },
      } as Parameters<TorodFulfillmentProviderService["validateFulfillmentData"]>[2]),
    ).resolves.toBe(data);
  });

  it("advertises calculated rates only when a Torod courier is present", async () => {
    await expect(
      makeService().canCalculate(
        {
          data: optionData(),
        } as Parameters<TorodFulfillmentProviderService["canCalculate"]>[0],
      ),
    ).resolves.toBe(true);

    await expect(
      makeService().canCalculate(
        {
          data: {
            id: optionIdForCourier("15"),
          },
        } as unknown as Parameters<TorodFulfillmentProviderService["canCalculate"]>[0],
      ),
    ).resolves.toBe(true);

    await expect(
      makeService().canCalculate(
        { data: {} } as Parameters<
          TorodFulfillmentProviderService["canCalculate"]
        >[0],
      ),
    ).resolves.toBe(false);

    await expect(
      makeService().canCalculate(
        {} as Parameters<TorodFulfillmentProviderService["canCalculate"]>[0],
      ),
    ).resolves.toBe(false);
  });

  it("returns the selected Torod courier rate and sends the documented payload", async () => {
    const { rateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITIES_ID]: 101,
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "16",
            [TOROD_RESPONSE_FIELDS.RATE]: 30,
          },
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: "21.5",
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).resolves.toEqual({
      calculated_amount: 21.5,
      is_calculated_price_tax_inclusive: false,
    });

    expect(rateBodies).toEqual([
      {
        [TOROD_REQUEST_FIELDS.WAREHOUSE]: "warehouse_riyadh",
        [TOROD_REQUEST_FIELDS.CUSTOMER_CITY_ID]: "101",
        [TOROD_REQUEST_FIELDS.PAYMENT]: DEFAULTS.PAYMENT,
        [TOROD_REQUEST_FIELDS.WEIGHT]: 3,
        [TOROD_REQUEST_FIELDS.ORDER_TOTAL]: 250,
        [TOROD_REQUEST_FIELDS.BOX_COUNT]: DEFAULTS.BOX_COUNT,
        [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: DEFAULTS.SHIPMENT_TYPE,
        [TOROD_REQUEST_FIELDS.FILTER_BY]: DEFAULTS.RATE_FILTER,
        [TOROD_REQUEST_FIELDS.IS_INSURANCE]: DEFAULTS.INSURANCE,
      },
    ]);
  });

  it("uses validated fulfillment data overrides when calculating rates", async () => {
    const { rateBodies } = stubTorodFetch({
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 18,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "202",
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_override",
          [FULFILLMENT_DATA_KEYS.BOX_COUNT]: 4,
          [FULFILLMENT_DATA_KEYS.PAYMENT_METHOD]: TOROD_PAYMENT.COD,
          [FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
        },
        rateContext(),
      ),
    ).resolves.toMatchObject({
      calculated_amount: 18,
    });

    expect(rateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.WAREHOUSE]: "warehouse_override",
      [TOROD_REQUEST_FIELDS.CUSTOMER_CITY_ID]: "202",
      [TOROD_REQUEST_FIELDS.PAYMENT]: TOROD_PAYMENT.COD,
      [TOROD_REQUEST_FIELDS.BOX_COUNT]: 4,
      [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
    });
  });

  it("uses the configured default weight only when item weight is missing", async () => {
    const { rateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "303",
            [TOROD_RESPONSE_FIELDS.TITLE]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 9,
          },
        ],
      },
    });

    await expect(
      makeService({ ...CONFIG, defaultWeightKg: 0.75 }).calculatePrice(
        optionData("15"),
        {},
        rateContext({
          items: [
            {
              id: "item_without_weight",
              quantity: { numeric: 3 },
              requires_shipping: true,
              variant: {
                id: "variant_without_weight",
                weight: 0,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
          ],
          subtotal: { value: "120" },
          total: undefined,
        }),
      ),
    ).resolves.toMatchObject({
      calculated_amount: 9,
    });

    expect(rateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.WEIGHT]: 2.25,
      [TOROD_REQUEST_FIELDS.ORDER_TOTAL]: 120,
    });
  });

  it("ignores non-shipping items and supports Medusa numeric objects", async () => {
    const objectWithoutValueOf = Object.create(null) as Record<string, never>;
    const selfReturningNumberLike = {
      valueOf() {
        return selfReturningNumberLike;
      },
    };
    const { rateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 11,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {
          [FULFILLMENT_DATA_KEYS.BOX_COUNT]: selfReturningNumberLike,
        },
        rateContext({
          items: [
            {
              id: "non_shipping_item",
              quantity: 10,
              requires_shipping: false,
              variant: {
                id: "non_shipping_variant",
                weight: 99,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
            {
              id: "shipping_item",
              quantity: {
                valueOf: () => 2,
              },
              requires_shipping: true,
              variant: {
                id: "shipping_variant",
                weight: 1.25,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      calculated_amount: 11,
    });

    expect(rateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.WEIGHT]: 2.5,
      [TOROD_REQUEST_FIELDS.BOX_COUNT]: DEFAULTS.BOX_COUNT,
    });

    rateBodies.length = 0;

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {
          [FULFILLMENT_DATA_KEYS.BOX_COUNT]: objectWithoutValueOf,
        },
        rateContext(),
      ),
    ).resolves.toMatchObject({
      calculated_amount: 11,
    });
  });

  it("reads the warehouse code from stock-location address metadata", async () => {
    const { rateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 12,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          from_location: {
            id: "sloc_test",
            name: "Riyadh Warehouse",
            metadata: {},
            address_id: "sladdr_test",
            address: {
              address_1: "Warehouse Street",
              country_code: "sa",
              metadata: {
                [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_address",
              },
              created_at: "2026-06-12T00:00:00.000Z",
              updated_at: "2026-06-12T00:00:00.000Z",
              deleted_at: null,
            },
            fulfillment_sets: [],
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
            deleted_at: null,
          },
        }),
      ),
    ).resolves.toMatchObject({
      calculated_amount: 12,
    });

    expect(rateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.WAREHOUSE]: "warehouse_address",
    });
  });

  it("throws instead of fabricating a rate when shipment weight is missing", async () => {
    stubTorodFetch({});

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          items: [
            {
              id: "item_without_weight",
              quantity: 1,
              requires_shipping: true,
              variant: {
                id: "variant_without_weight",
                weight: 0,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WEIGHT_MISSING),
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          items: [
            {
              id: "item_with_nan_quantity",
              quantity: { numeric: Number.NaN },
              requires_shipping: true,
              variant: {
                id: "variant_with_weight",
                weight: 1,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WEIGHT_MISSING),
    });
  });

  it("throws when all cart items are non-shipping", async () => {
    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          items: [
            {
              id: "non_shipping_item",
              quantity: 1,
              requires_shipping: false,
              variant: {
                id: "non_shipping_variant",
                weight: 1,
                length: 0,
                height: 0,
                width: 0,
                material: "",
                product: { id: "product_test" },
              },
              product: {
                id: "product_test",
                collection_id: "collection_test",
                categories: [],
                tags: [],
              },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WEIGHT_MISSING),
    });
  });

  it("throws instead of fabricating a rate when the destination city is unresolvable", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Jeddah",
            [TOROD_RESPONSE_FIELDS.ID]: "404",
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE),
    });
  });

  it("resolves cities by alternate Torod city fields", async () => {
    const { rateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          null,
          {
            [TOROD_RESPONSE_FIELDS.ID]: "505",
            [TOROD_RESPONSE_FIELDS.TITLE]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 14,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).resolves.toMatchObject({
      calculated_amount: 14,
    });

    expect(rateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.CUSTOMER_CITY_ID]: "505",
    });
  });

  it("throws when the matched Torod city has no usable id", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE),
    });
  });

  it("throws when Torod returns malformed city data", async () => {
    stubTorodFetch({
      cities: {},
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CITIES_DATA_MALFORMED),
    });
  });

  it("throws when the cart has no destination city", async () => {
    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          shipping_address: {
            id: "addr_test",
            city: " ",
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE),
    });
  });

  it("throws when the shipping option data has no Torod courier id", async () => {
    await expect(
      makeService().calculatePrice({}, {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_OPTION_MISSING),
    });
  });

  it("throws when required non-weight rate inputs are missing", async () => {
    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          from_location: undefined,
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WAREHOUSE_MISSING),
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          total: "not-a-number",
          subtotal: undefined,
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.ORDER_TOTAL_MISSING),
    });

    await expect(
      makeService().calculatePrice(
        optionData("15"),
        {},
        rateContext({
          total: Number.NaN,
          subtotal: undefined,
        }),
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.ORDER_TOTAL_MISSING),
    });
  });

  it("throws when Torod does not return a usable selected-courier rate", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME_AR]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "16",
            [TOROD_RESPONSE_FIELDS.RATE]: 30,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.RATE_NOT_FOUND),
    });

    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 0,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.RATE_MISSING),
    });
  });

  it("throws when Torod returns malformed rate data", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {},
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.RATE_DATA_MALFORMED),
    });
  });

  it("ignores non-object Torod rate entries while selecting the courier", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      rates: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          null,
          {
            [TOROD_RESPONSE_FIELDS.ID]: "15",
            [TOROD_RESPONSE_FIELDS.RATE]: 17,
          },
        ],
      },
    });

    await expect(
      makeService().calculatePrice(optionData("15"), {}, rateContext()),
    ).resolves.toMatchObject({
      calculated_amount: 17,
    });
  });

  it("fails closed instead of booking a shipment before T3.1", async () => {
    await expect(
      makeService().createFulfillment({}, [], undefined, {}),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.BOOKING_NOT_READY),
    });
  });

  it("fails closed instead of canceling a shipment before T3.3", async () => {
    await expect(makeService().cancelFulfillment({})).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CANCELLATION_NOT_READY),
    });
  });

  it("returns empty document arrays until Torod labels are stored", async () => {
    const service = makeService();

    await expect(service.getFulfillmentDocuments({})).resolves.toEqual([]);
    await expect(service.getReturnDocuments({})).resolves.toEqual([]);
    await expect(service.getShipmentDocuments({})).resolves.toEqual([]);
    await expect(service.retrieveDocuments({}, "label")).resolves.toBeUndefined();
  });

  it("fails return fulfillment fast while Torod returns are deferred", async () => {
    await expect(makeService().createReturnFulfillment({})).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.RETURNS_DEFERRED),
    });
  });
});
