import { afterEach, describe, expect, it, vi } from "vitest";

import { KsaErrorCodes } from "@medusa-ksa/core";

import {
  DEFAULTS,
  FULFILLMENT_DATA_KEYS,
  MEDUSA_CONTEXT_FIELDS,
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
type FulfillmentItemsInput = Parameters<
  TorodFulfillmentProviderService["createFulfillment"]
>[1];
type FulfillmentOrderInput = NonNullable<
  Parameters<TorodFulfillmentProviderService["createFulfillment"]>[2]
>;

interface StubTorodFetchOptions {
  couriers?: unknown;
  courierStatus?: number;
  regions?: unknown;
  regionStatus?: number;
  cities?: unknown;
  cityStatus?: number;
  rates?: unknown;
  rateStatus?: number;
  orderCreate?: unknown;
  orderCreateStatus?: number;
  shipProcess?: unknown;
  shipProcessStatus?: number;
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

function requestBody(init?: RequestInit): Record<string, unknown> {
  const rawBody = String(init?.body ?? "{}");
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    const params = new URLSearchParams(rawBody);
    const numericFields = new Set<string>([
      TOROD_REQUEST_FIELDS.WEIGHT,
      TOROD_REQUEST_FIELDS.ORDER_TOTAL,
      TOROD_REQUEST_FIELDS.BOX_COUNT,
      TOROD_REQUEST_FIELDS.IS_INSURANCE,
      TOROD_REQUEST_FIELDS.IS_OWN,
    ]);
    return Object.fromEntries(
      Array.from(params.entries()).map(([key, value]) => {
        if (!numericFields.has(key)) {
          return [key, value];
        }
        const numericValue = Number(value);
        return [key, Number.isFinite(numericValue) ? numericValue : value];
      }),
    );
  }
}

function stubTorodFetch(options: StubTorodFetchOptions) {
  const rateBodies: unknown[] = [];
  const orderCreateBodies: unknown[] = [];
  const shipProcessBodies: unknown[] = [];
  const cityQueries: Record<string, string>[] = [];
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const requestUrl = new URL(String(url));
    const path = String(url).replace(DEFAULTS.BASE_URL, "");
    if (path === TOROD_TOKEN.PATH) {
      return jsonResponse(tokenResponse("tok_service"));
    }
    if (path === TOROD_ENDPOINTS.COURIERS) {
      return jsonResponse(options.couriers, options.courierStatus);
    }
    if (path.startsWith(TOROD_ENDPOINTS.REGIONS)) {
      return jsonResponse(
        options.regions ?? {
          [TOROD_RESPONSE_FIELDS.DATA]: [
            {
              [TOROD_RESPONSE_FIELDS.REGION_ID]: "1",
              [TOROD_RESPONSE_FIELDS.REGION_NAME]: "Riyadh",
            },
          ],
        },
        options.regionStatus,
      );
    }
    if (path.startsWith(TOROD_ENDPOINTS.CITIES)) {
      cityQueries.push(Object.fromEntries(requestUrl.searchParams.entries()));
      return jsonResponse(options.cities, options.cityStatus);
    }
    if (path === TOROD_ENDPOINTS.RATES) {
      rateBodies.push(requestBody(init));
      return jsonResponse(options.rates, options.rateStatus);
    }
    if (path === TOROD_ENDPOINTS.CREATE_ORDER) {
      orderCreateBodies.push(requestBody(init));
      return jsonResponse(options.orderCreate, options.orderCreateStatus);
    }
    if (path === TOROD_ENDPOINTS.SHIP_PROCESS) {
      shipProcessBodies.push(requestBody(init));
      return jsonResponse(options.shipProcess, options.shipProcessStatus);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchImpl);
  return {
    fetchImpl,
    rateBodies,
    orderCreateBodies,
    shipProcessBodies,
    cityQueries,
  };
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

function fulfillmentItems(): FulfillmentItemsInput {
  return [
    {
      id: "fulitem_test",
      title: "Arabic Coffee",
      quantity: 2,
      line_item_id: "line_test",
    },
  ];
}

function fulfillmentOrder(
  overrides: Record<string, unknown> = {},
): FulfillmentOrderInput {
  return {
    id: "order_test",
    display_id: 1001,
    email: "buyer@example.com",
    shipping_address: {
      id: "addr_test",
      first_name: "Sara",
      last_name: "Ahmed",
      phone: "+966500000000",
      address_1: "King Fahd Road",
      address_2: "Unit 4",
      city: "Riyadh",
      country_code: "sa",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    },
    items: [
      {
        id: "line_test",
        title: "Arabic Coffee",
        quantity: 2,
        requires_shipping: true,
        metadata: {
          [MEDUSA_CONTEXT_FIELDS.WEIGHT_KG]: 0.5,
        },
        created_at: "2026-06-12T00:00:00.000Z",
        updated_at: "2026-06-12T00:00:00.000Z",
      },
    ],
    shipping_methods: [],
    total: 340,
    subtotal: 300,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  } as unknown as FulfillmentOrderInput;
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

  it("resolves serviceable city metadata during fulfillment data validation", async () => {
    const { cityQueries } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITIES_ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
    });

    const data = { existing: "value" };

    await expect(
      makeService().validateFulfillmentData(
        {},
        data,
        rateContext() as unknown as Parameters<
          TorodFulfillmentProviderService["validateFulfillmentData"]
        >[2],
      ),
    ).resolves.toEqual({
      existing: "value",
      [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
      [FULFILLMENT_DATA_KEYS.CITY_NAME]: "Riyadh",
    });
    expect(cityQueries).toEqual([
      {
        [TOROD_REQUEST_FIELDS.REGION_ID]: "1",
        [TOROD_REQUEST_FIELDS.PAGE]: "1",
      },
    ]);
  });

  it("rejects unserviceable city during fulfillment data validation", async () => {
    stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITIES_ID]: "202",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Jeddah",
          },
        ],
      },
    });

    await expect(
      makeService().validateFulfillmentData(
        {},
        {},
        rateContext() as unknown as Parameters<
          TorodFulfillmentProviderService["validateFulfillmentData"]
        >[2],
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE),
    });
  });

  it("rejects malformed Torod region data during city validation", async () => {
    stubTorodFetch({ regions: {} });

    await expect(
      makeService().validateFulfillmentData(
        {},
        {},
        rateContext() as unknown as Parameters<
          TorodFulfillmentProviderService["validateFulfillmentData"]
        >[2],
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.REGIONS_DATA_MALFORMED,
      ),
    });
  });

  it("rejects Torod region rows without a usable id during city validation", async () => {
    stubTorodFetch({
      regions: {
        [TOROD_RESPONSE_FIELDS.DATA]: [{}],
      },
    });

    await expect(
      makeService().validateFulfillmentData(
        {},
        {},
        rateContext() as unknown as Parameters<
          TorodFulfillmentProviderService["validateFulfillmentData"]
        >[2],
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.REGION_ID_MISSING),
    });
  });

  it("rejects non-object Torod region rows during city validation", async () => {
    stubTorodFetch({
      regions: {
        [TOROD_RESPONSE_FIELDS.DATA]: [null],
      },
    });

    await expect(
      makeService().validateFulfillmentData(
        {},
        {},
        rateContext() as unknown as Parameters<
          TorodFulfillmentProviderService["validateFulfillmentData"]
        >[2],
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.REGION_ID_MISSING),
    });
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

  it("books a Torod fulfillment with the documented two-step flow", async () => {
    const { orderCreateBodies, shipProcessBodies } = stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_123",
        },
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRK123",
          [TOROD_RESPONSE_FIELDS.LABEL_URL]:
            "https://demo.stage.torod.co/en/downloadLabel/4026",
        },
      },
    });
    const data = {
      ...optionData("15"),
      [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
      [FULFILLMENT_DATA_KEYS.CITY_NAME]: "Riyadh",
      [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
      [FULFILLMENT_DATA_KEYS.BOX_COUNT]: 3,
      [FULFILLMENT_DATA_KEYS.PAYMENT_METHOD]: TOROD_PAYMENT.COD,
      [FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
      [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 2.75,
    };

    await expect(
      makeService().createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).resolves.toEqual({
      data: {
        ...data,
        [FULFILLMENT_DATA_KEYS.TOROD_ORDER_ID]: "torod_order_123",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: "15",
        [FULFILLMENT_DATA_KEYS.TRACKING_NUMBER]: "TRK123",
        [FULFILLMENT_DATA_KEYS.LABEL_URL]:
          "https://demo.stage.torod.co/en/downloadLabel/4026",
        [FULFILLMENT_DATA_KEYS.BOX_COUNT]: 3,
        [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
        [FULFILLMENT_DATA_KEYS.PAYMENT_METHOD]: TOROD_PAYMENT.COD,
        [FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
      },
      labels: [
        {
          tracking_number: "TRK123",
          tracking_url: "https://demo.stage.torod.co/en/downloadLabel/4026",
          label_url: "https://demo.stage.torod.co/en/downloadLabel/4026",
        },
      ],
    });

    expect(orderCreateBodies).toEqual([
      {
        [TOROD_REQUEST_FIELDS.CUSTOMER_NAME]: "Sara Ahmed",
        [TOROD_REQUEST_FIELDS.CUSTOMER_EMAIL]: "buyer@example.com",
        [TOROD_REQUEST_FIELDS.CUSTOMER_PHONE]: "+966500000000",
        [TOROD_REQUEST_FIELDS.ITEM_DESCRIPTION]: "Arabic Coffee",
        [TOROD_REQUEST_FIELDS.ORDER_TOTAL]: 340,
        [TOROD_REQUEST_FIELDS.PAYMENT]: TOROD_PAYMENT.COD,
        [TOROD_REQUEST_FIELDS.WEIGHT]: 2.75,
        [TOROD_REQUEST_FIELDS.BOX_COUNT]: 3,
        [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
        [TOROD_REQUEST_FIELDS.CITY_ID]: "101",
        [TOROD_REQUEST_FIELDS.ADDRESS]: "King Fahd Road, Unit 4",
      },
    ]);
    expect(shipProcessBodies).toEqual([
      {
        [TOROD_REQUEST_FIELDS.ORDER_ID]: "torod_order_123",
        [TOROD_REQUEST_FIELDS.WAREHOUSE]: "warehouse_riyadh",
        [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: TOROD_SHIPMENT_TYPE.COLD,
        [TOROD_REQUEST_FIELDS.COURIER_PARTNER_ID]: "15",
        [TOROD_REQUEST_FIELDS.IS_OWN]: DEFAULTS.OWN_CARRIER,
        [TOROD_REQUEST_FIELDS.IS_INSURANCE]: DEFAULTS.INSURANCE,
      },
    ]);
  });

  it("uses shipping method data, configured default box count, and default weight for booking", async () => {
    const { orderCreateBodies, shipProcessBodies } = stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_default",
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRKDEFAULT",
        [TOROD_RESPONSE_FIELDS.LABEL_URL]:
          "https://demo.stage.torod.co/en/downloadLabel/4027",
      },
    });
    const order = fulfillmentOrder({
      items: [
        {
          id: "line_test",
          title: "Arabic Coffee",
          quantity: 2,
          requires_shipping: true,
          metadata: {},
          created_at: "2026-06-12T00:00:00.000Z",
          updated_at: "2026-06-12T00:00:00.000Z",
        },
      ],
      shipping_methods: [
        {
          id: "ship_method",
          order_id: "order_test",
          name: "Torod SMSA",
          data: {
            ...optionData("22"),
            [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
            [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_from_method",
          },
          created_at: "2026-06-12T00:00:00.000Z",
          updated_at: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    await expect(
      makeService({
        ...CONFIG,
        defaultBoxCount: 5,
        defaultWeightKg: 1.25,
      }).createFulfillment({}, fulfillmentItems(), order, {}),
    ).resolves.toMatchObject({
      data: {
        [FULFILLMENT_DATA_KEYS.TOROD_ORDER_ID]: "torod_order_default",
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: "22",
        [FULFILLMENT_DATA_KEYS.TRACKING_NUMBER]: "TRKDEFAULT",
        [FULFILLMENT_DATA_KEYS.LABEL_URL]:
          "https://demo.stage.torod.co/en/downloadLabel/4027",
        [FULFILLMENT_DATA_KEYS.BOX_COUNT]: 5,
        [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_from_method",
        [FULFILLMENT_DATA_KEYS.PAYMENT_METHOD]: DEFAULTS.PAYMENT,
        [FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE]: DEFAULTS.SHIPMENT_TYPE,
      },
    });

    expect(orderCreateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.WEIGHT]: 2.5,
      [TOROD_REQUEST_FIELDS.BOX_COUNT]: 5,
      [TOROD_REQUEST_FIELDS.PAYMENT]: DEFAULTS.PAYMENT,
      [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: DEFAULTS.SHIPMENT_TYPE,
    });
    expect(shipProcessBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.COURIER_PARTNER_ID]: "22",
      [TOROD_REQUEST_FIELDS.WAREHOUSE]: "warehouse_from_method",
    });
  });

  it("uses the company name when the shipping address has no personal name", async () => {
    const { orderCreateBodies } = stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_company",
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRKCOMPANY",
        [TOROD_RESPONSE_FIELDS.LABEL_URL]:
          "https://demo.stage.torod.co/en/downloadLabel/4031",
      },
    });

    await expect(
      makeService().createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder({
          shipping_address: {
            id: "addr_test",
            first_name: " ",
            last_name: " ",
            company: "Riyadh Trading",
            phone: "+966500000000",
            address_1: "King Fahd Road",
            city: "Riyadh",
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        }),
        {},
      ),
    ).resolves.toMatchObject({
      data: {
        [FULFILLMENT_DATA_KEYS.TRACKING_NUMBER]: "TRKCOMPANY",
      },
    });

    expect(orderCreateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.CUSTOMER_NAME]: "Riyadh Trading",
      [TOROD_REQUEST_FIELDS.ADDRESS]: "King Fahd Road",
    });
  });

  it("derives booking weight from fulfillment metadata, order items, and default weight", async () => {
    const { orderCreateBodies } = stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_weight",
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRKWEIGHT",
        [TOROD_RESPONSE_FIELDS.LABEL_URL]:
          "https://demo.stage.torod.co/en/downloadLabel/4030",
      },
    });
    const data = {
      ...optionData("15"),
      [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
      [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
    };
    const service = makeService({
      ...CONFIG,
      defaultWeightKg: 0.75,
    });

    await service.createFulfillment(
      data,
      [
        {
          title: "Metadata Weighted Item",
          quantity: 2,
          metadata: {
            [MEDUSA_CONTEXT_FIELDS.WEIGHT]: 1.1,
          },
        },
      ] as unknown as FulfillmentItemsInput,
      fulfillmentOrder({
        items: [],
      }),
      {},
    );

    await service.createFulfillment(
      data,
      [],
      fulfillmentOrder({
        items: [
          {
            id: "line_default",
            title: "Order Fallback Item",
            quantity: 3,
            requires_shipping: true,
            metadata: {},
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        ],
      }),
      {},
    );

    await service.createFulfillment(
      data,
      [
        {
          title: "No Line Id Item",
          quantity: 4,
        },
      ],
      fulfillmentOrder({
        items: [],
      }),
      {},
    );

    expect(orderCreateBodies.map((body) => {
      if (typeof body !== "object" || body === null) {
        return undefined;
      }
      return (body as Record<string, unknown>)[TOROD_REQUEST_FIELDS.WEIGHT];
    })).toEqual([2.2, 2.25, 3]);
  });

  it("resolves the order city before booking when validated city data is absent", async () => {
    const { orderCreateBodies } = stubTorodFetch({
      cities: {
        [TOROD_RESPONSE_FIELDS.DATA]: [
          {
            [TOROD_RESPONSE_FIELDS.CITIES_ID]: "101",
            [TOROD_RESPONSE_FIELDS.CITY_NAME]: "Riyadh",
          },
        ],
      },
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_city",
        },
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRKCITY",
          [TOROD_RESPONSE_FIELDS.LABEL_URL]:
            "https://demo.stage.torod.co/en/downloadLabel/4028",
        },
      },
    });

    await expect(
      makeService().createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).resolves.toMatchObject({
      data: {
        [FULFILLMENT_DATA_KEYS.TRACKING_NUMBER]: "TRKCITY",
      },
    });

    expect(orderCreateBodies[0]).toMatchObject({
      [TOROD_REQUEST_FIELDS.CITY_ID]: "101",
    });
  });

  it("fails booking before calling Torod when required order inputs are missing", async () => {
    const { orderCreateBodies, shipProcessBodies } = stubTorodFetch({});
    const service = makeService();

    await expect(
      service.createFulfillment(optionData("15"), fulfillmentItems(), undefined, {}),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.ORDER_MISSING),
    });

    await expect(
      service.createFulfillment(optionData("15"), fulfillmentItems(), {}, {}),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.SHIPPING_ADDRESS_MISSING,
      ),
    });

    await expect(
      service.createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder({
          email: "   ",
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.CUSTOMER_EMAIL_MISSING,
      ),
    });

    await expect(
      service.createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder({
          total: undefined,
          subtotal: undefined,
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.BOOKING_ORDER_TOTAL_MISSING,
      ),
    });

    expect(orderCreateBodies).toEqual([]);
    expect(shipProcessBodies).toEqual([]);
  });

  it("fails booking when customer address details are incomplete", async () => {
    const data = {
      ...optionData("15"),
      [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
      [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
      [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
    };
    const service = makeService();

    await expect(
      service.createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder({
          shipping_address: {
            id: "addr_test",
            first_name: " ",
            last_name: " ",
            company: " ",
            phone: "+966500000000",
            address_1: "King Fahd Road",
            city: "Riyadh",
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.CUSTOMER_NAME_MISSING,
      ),
    });

    await expect(
      service.createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder({
          shipping_address: {
            id: "addr_test",
            first_name: "Sara",
            last_name: "Ahmed",
            phone: " ",
            address_1: "King Fahd Road",
            city: "Riyadh",
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.CUSTOMER_PHONE_MISSING,
      ),
    });

    await expect(
      service.createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder({
          shipping_address: {
            id: "addr_test",
            first_name: "Sara",
            last_name: "Ahmed",
            phone: "+966500000000",
            address_1: " ",
            city: "Riyadh",
            created_at: "2026-06-12T00:00:00.000Z",
            updated_at: "2026-06-12T00:00:00.000Z",
          },
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.SHIPPING_ADDRESS_LINE_MISSING,
      ),
    });
  });

  it("fails booking when shipment inputs cannot be derived", async () => {
    const { orderCreateBodies, shipProcessBodies } = stubTorodFetch({});
    const service = makeService();

    await expect(
      service.createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WAREHOUSE_MISSING),
    });

    await expect(
      service.createFulfillment(
        {
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.COURIER_OPTION_MISSING,
      ),
    });

    await expect(
      service.createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
        },
        fulfillmentItems(),
        fulfillmentOrder({
          items: [
            {
              id: "line_test",
              title: "Arabic Coffee",
              quantity: 2,
              requires_shipping: true,
              metadata: {},
              created_at: "2026-06-12T00:00:00.000Z",
              updated_at: "2026-06-12T00:00:00.000Z",
            },
          ],
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.WEIGHT_MISSING),
    });

    expect(orderCreateBodies).toEqual([]);
    expect(shipProcessBodies).toEqual([]);
  });

  it("fails booking when there are no shippable order items", async () => {
    await expect(
      makeService().createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
        },
        [],
        fulfillmentOrder({
          items: [
            {
              id: "line_test",
              title: "Digital Download",
              quantity: 1,
              requires_shipping: false,
              metadata: {
                [MEDUSA_CONTEXT_FIELDS.WEIGHT_KG]: 1,
              },
              created_at: "2026-06-12T00:00:00.000Z",
              updated_at: "2026-06-12T00:00:00.000Z",
            },
          ],
        }),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.INVALID_INPUT,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.ORDER_ITEMS_MISSING),
    });
  });

  it("does not process a shipment when order/create omits the order id", async () => {
    const { shipProcessBodies } = stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.DATA]: {},
      },
    });

    await expect(
      makeService().createFulfillment(
        {
          ...optionData("15"),
          [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
          [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
          [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
        },
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.TOROD_ORDER_ID_MISSING,
      ),
    });

    expect(shipProcessBodies).toEqual([]);
  });

  it("fails booking when ship/process omits tracking or label data", async () => {
    const data = {
      ...optionData("15"),
      [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: "warehouse_riyadh",
      [FULFILLMENT_DATA_KEYS.CITY_CODE]: "101",
      [FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT]: 1,
    };

    stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_missing_tracking",
        },
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.LABEL_URL]:
            "https://demo.stage.torod.co/en/downloadLabel/4029",
        },
      },
    });

    await expect(
      makeService().createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.TRACKING_ID_MISSING),
    });

    stubTorodFetch({
      orderCreate: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.ORDER_ID]: "torod_order_missing_label",
        },
      },
      shipProcess: {
        [TOROD_RESPONSE_FIELDS.DATA]: {
          [TOROD_RESPONSE_FIELDS.TRACKING_ID]: "TRKMISSINGLABEL",
        },
      },
    });

    await expect(
      makeService().createFulfillment(
        data,
        fulfillmentItems(),
        fulfillmentOrder(),
        {},
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.LABEL_URL_MISSING),
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
