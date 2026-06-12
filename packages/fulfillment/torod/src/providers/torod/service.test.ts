import { describe, expect, it } from "vitest";

import { KsaErrorCodes } from "@medusa-ksa/core";

import {
  DEFAULTS,
  PROVIDER_ID,
  TOROD_ERROR_MESSAGES,
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

describe("TorodFulfillmentProviderService", () => {
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

  it("starts with no courier fulfillment options until T2.2 loads Torod couriers", async () => {
    await expect(makeService().getFulfillmentOptions()).resolves.toEqual([]);
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
