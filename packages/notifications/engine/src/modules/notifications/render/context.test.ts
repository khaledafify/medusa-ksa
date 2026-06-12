import { describe, expect, it } from "vitest";

import { CURRENCY } from "../constants.js";
import { buildOrderRenderContext } from "./context.js";

describe("buildOrderRenderContext", () => {
  it("maps order, customer, and fulfillment fields without side effects", () => {
    const context = buildOrderRenderContext({
      id: "order_123",
      display_id: 1001,
      total: 2550,
      currency_code: CURRENCY.SAR,
      created_at: "2026-06-12T00:00:00.000Z",
      customer: {
        first_name: "Khaled",
        last_name: "Afify",
        phone: "+966500000000",
        email: "customer@example.com",
      },
      shipping_address: {
        first_name: "سارة",
        last_name: "العلي",
        phone: "0500000000",
      },
      fulfillments: [{ tracking_numbers: ["TRK123"] }],
    });

    expect(context).toEqual({
      order: {
        id: "order_123",
        display_id: "1001",
        total: 2550,
        currency_code: CURRENCY.SAR,
        created_at: "2026-06-12T00:00:00.000Z",
      },
      customer: {
        name: "سارة العلي",
        first_name: "سارة",
        last_name: "العلي",
        phone: "0500000000",
        email: "customer@example.com",
      },
      fulfillment: {
        tracking_number: "TRK123",
      },
    });
  });

  it("falls back to order id, customer email, and explicit tracking override", () => {
    const context = buildOrderRenderContext(
      {
        id: "order_456",
        customer: { email: "buyer@example.com" },
      },
      { trackingNumber: "OVERRIDE123" },
    );

    expect(context.order).toMatchObject({
      id: "order_456",
      display_id: "order_456",
      total: 0,
      currency_code: CURRENCY.SAR,
    });
    expect(context.customer).toMatchObject({
      name: "buyer@example.com",
      email: "buyer@example.com",
    });
    expect(context.fulfillment).toMatchObject({
      tracking_number: "OVERRIDE123",
    });
  });
});
