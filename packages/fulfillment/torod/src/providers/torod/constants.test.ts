import { describe, expect, it } from "vitest";

import {
  DEFAULTS,
  ENV,
  FULFILLMENT_DATA_KEYS,
  PROVIDER_ID,
  TOROD_ENDPOINTS,
  TOROD_PAYMENT,
  TOROD_REQUEST_FIELDS,
  TOROD_RESPONSE_FIELDS,
  TOROD_SHIPMENT_TYPE,
  TOROD_STATUS,
  TOROD_STATUS_TO_MEDUSA,
  TOROD_TERMINAL_STATUSES,
  TOROD_TOKEN,
  courierCodeFromOptionId,
  optionIdForCourier,
} from "./constants.js";

describe("Torod constants", () => {
  it("exports the provider identity and documented env var names", () => {
    expect(PROVIDER_ID).toBe("torod");
    expect(ENV).toEqual({
      CLIENT_ID: "TOROD_CLIENT_ID",
      CLIENT_SECRET: "TOROD_CLIENT_SECRET",
      BASE_URL: "TOROD_BASE_URL",
      DEFAULT_WEIGHT_KG: "TOROD_DEFAULT_WEIGHT_KG",
      DEFAULT_BOX_COUNT: "TOROD_DEFAULT_BOX_COUNT",
      WEBHOOK_SECRET: "TOROD_WEBHOOK_SECRET",
    });
  });

  it("normalizes every documented endpoint path to a leading slash", () => {
    expect(TOROD_ENDPOINTS).toMatchObject({
      TOKEN: "/token",
      COURIERS: "/get-all/courier/partners",
      RATES: "/courier/partners/list",
      CREATE_ORDER: "/order/create",
      SHIP_PROCESS: "/order/ship/process",
      TRACK: "/order/track",
      CANCEL: "/shipments/cancel",
      CITIES: "/get-all/cities",
    });
    expect(Object.values(TOROD_ENDPOINTS).every((path) => path.startsWith("/"))).toBe(
      true,
    );
  });

  it("captures OAuth bearer token fields from the Torod response", () => {
    expect(TOROD_TOKEN).toMatchObject({
      PATH: TOROD_ENDPOINTS.TOKEN,
      AUTHORIZATION_HEADER: "Authorization",
      BEARER_SCHEME: "Bearer",
      RESPONSE_TOKEN_FIELD: "bearer_token",
      GENERATED_DATE_FIELD: "token_generated_date",
      EXPIRES_IN_FIELD: "expires_in",
    });
  });

  it("models package handling as box count only", () => {
    expect(DEFAULTS.BOX_COUNT).toBe(1);
    expect(FULFILLMENT_DATA_KEYS.BOX_COUNT).toBe("boxCount");

    const dataKeys = Object.values(FULFILLMENT_DATA_KEYS);
    expect(dataKeys).not.toContain("torodPackageTemplateId");
    expect(dataKeys).not.toContain("packageLengthCm");
    expect(dataKeys).not.toContain("packageWidthCm");
    expect(dataKeys).not.toContain("packageHeightCm");
  });

  it("exports documented payment, shipment, request, and response field names", () => {
    expect(TOROD_PAYMENT).toEqual({
      COD: "COD",
      PREPAID: "Prepaid",
      BANK: "Bank",
    });
    expect(TOROD_SHIPMENT_TYPE.NORMAL).toBe("normal");
    expect(TOROD_REQUEST_FIELDS.BOX_COUNT).toBe("no_of_box");
    expect(TOROD_REQUEST_FIELDS.CUSTOMER_CITY_ID).toBe("customer_city_id");
    expect(TOROD_RESPONSE_FIELDS.LABEL_URL).toBe("aws_label");
    expect(TOROD_RESPONSE_FIELDS.TRACKING_ID).toBe("tracking_id");
  });

  it("builds and parses courier option ids through the single helper pair", () => {
    expect(optionIdForCourier("15")).toBe("torod:15");
    expect(optionIdForCourier("carrier/with space")).toBe(
      "torod:carrier%2Fwith%20space",
    );
    expect(courierCodeFromOptionId("torod:15")).toBe("15");
    expect(courierCodeFromOptionId("torod:carrier%2Fwith%20space")).toBe(
      "carrier/with space",
    );
  });

  it("rejects malformed courier option ids", () => {
    expect(courierCodeFromOptionId("smsa:15")).toBeUndefined();
    expect(courierCodeFromOptionId("torod:")).toBeUndefined();
    expect(courierCodeFromOptionId("torod:%E0%A4%A")).toBeUndefined();
  });

  it("maps every Torod webhook status to a Medusa fulfillment state", () => {
    expect(Object.keys(TOROD_STATUS_TO_MEDUSA).sort()).toEqual(
      Object.values(TOROD_STATUS).sort(),
    );
    expect(TOROD_STATUS_TO_MEDUSA.Pending).toBe("pending");
    expect(TOROD_STATUS_TO_MEDUSA.Created).toBe("shipped");
    expect(TOROD_STATUS_TO_MEDUSA.Shipped).toBe("shipped");
    expect(TOROD_STATUS_TO_MEDUSA.Delivered).toBe("delivered");
    expect(TOROD_STATUS_TO_MEDUSA.Cancelled).toBe("canceled");
    expect(TOROD_STATUS_TO_MEDUSA.Failed).toBe("failed");
    expect(TOROD_STATUS_TO_MEDUSA.RTO).toBe("returned");
  });

  it("names terminal Torod statuses as data", () => {
    expect(TOROD_TERMINAL_STATUSES).toEqual([
      TOROD_STATUS.CANCELLED,
      TOROD_STATUS.DELIVERED,
      TOROD_STATUS.FAILED,
      TOROD_STATUS.RTO,
    ]);
  });
});
