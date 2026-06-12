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
  TOROD_RESPONSE_FIELDS,
  TOROD_TOKEN,
  optionIdForCourier,
} from "./constants.js";
import { TorodFulfillmentProviderService } from "./service.js";

const CONFIG = {
  clientId: "client_test_id",
  clientSecret: "client_test_secret",
  baseUrl: DEFAULTS.BASE_URL,
};

function makeService(): TorodFulfillmentProviderService {
  return new TorodFulfillmentProviderService({}, CONFIG);
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

function stubTorodFetch(courierData: unknown, status = 200) {
  const fetchImpl = vi.fn(async (url: unknown) => {
    const path = String(url).replace(DEFAULTS.BASE_URL, "");
    if (path === TOROD_TOKEN.PATH) {
      return jsonResponse(tokenResponse("tok_service"));
    }
    if (path === TOROD_ENDPOINTS.COURIERS) {
      return jsonResponse(courierData, status);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;

  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
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
      [TOROD_RESPONSE_FIELDS.DATA]: [
        {
          [TOROD_RESPONSE_FIELDS.ID]: "untitled",
          [TOROD_RESPONSE_FIELDS.TITLE]: "   ",
        },
      ],
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
    stubTorodFetch({});

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(
        TOROD_ERROR_MESSAGES.COURIERS_DATA_MALFORMED,
      ),
    });
  });

  it("rejects courier responses without a usable id", async () => {
    stubTorodFetch({
      [TOROD_RESPONSE_FIELDS.DATA]: [
        {
          [TOROD_RESPONSE_FIELDS.TITLE]: "Missing Id",
        },
      ],
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING),
    });
  });

  it("rejects non-object courier entries", async () => {
    stubTorodFetch({
      [TOROD_RESPONSE_FIELDS.DATA]: [null],
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING),
    });
  });

  it("rejects duplicate courier ids before exposing admin options", async () => {
    stubTorodFetch({
      [TOROD_RESPONSE_FIELDS.DATA]: [
        { [TOROD_RESPONSE_FIELDS.ID]: "duplicate" },
        { [TOROD_RESPONSE_FIELDS.ID]: "duplicate" },
      ],
    });

    await expect(makeService().getFulfillmentOptions()).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.COURIER_ID_DUPLICATE),
    });
  });

  it("converts Torod HTTP errors while loading couriers into Medusa errors", async () => {
    stubTorodFetch({ message: "forbidden" }, 403);

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

  it("does not advertise calculated rates before the rate task", async () => {
    await expect(
      makeService().canCalculate(
        {} as Parameters<TorodFulfillmentProviderService["canCalculate"]>[0],
      ),
    ).resolves.toBe(false);
  });

  it("fails closed instead of fabricating a calculated price before T2.3", async () => {
    await expect(
      makeService().calculatePrice(
        {},
        {},
        {} as Parameters<TorodFulfillmentProviderService["calculatePrice"]>[2],
      ),
    ).rejects.toMatchObject({
      code: KsaErrorCodes.PROVIDER_ERROR,
      message: expect.stringContaining(TOROD_ERROR_MESSAGES.RATES_NOT_READY),
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
