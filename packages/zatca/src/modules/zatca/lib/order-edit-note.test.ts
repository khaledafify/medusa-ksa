import { describe, expect, it } from "vitest";

import { buildOrderEditLifecycleTaxBase } from "./order-edit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_4001",
  xml: "<Invoice/>",
  lines_snapshot: {
    lines: [
      {
        id: 1,
        sourceItemId: "item_taxable",
        name: "Taxable item",
        quantity: 1,
        unitPriceHalalas: 10000,
        lineExtensionHalalas: 10000,
        vatPercent: 15,
      },
    ],
    documentAllowances: [],
    documentCharges: [],
    totals: { taxInclusiveHalalas: 11500, taxHalalas: 1500 },
  },
};

describe("order edit lifecycle tax base", () => {
  it("builds a credit-note delta when the edited order value decreases", () => {
    const result = buildOrderEditLifecycleTaxBase({
      originalInvoice,
      currentTaxBase: {
        lines: [
          {
            id: 1,
            sourceItemId: "item_taxable",
            name: "Taxable item",
            quantity: 1,
            unitPriceHalalas: 5000,
            lineExtensionHalalas: 5000,
            vatPercent: 15,
          },
        ],
        documentAllowances: [],
        documentCharges: [],
        expectedTaxInclusiveHalalas: 5750,
        expectedTaxHalalas: 750,
      },
    });

    expect(result).toEqual({
      documentType: "credit_note",
      reason: "Order edit decrease",
      lines: [
        {
          id: 1,
          name: "Order edit decrease @ 15% VAT",
          quantity: 1,
          unitPriceHalalas: 5000,
          lineExtensionHalalas: 5000,
          vatPercent: 15,
        },
      ],
      documentAllowances: [],
      documentCharges: [],
      expectedTaxInclusiveHalalas: 5750,
      expectedTaxHalalas: 750,
    });
  });

  it("builds a debit-note delta when the edited order value increases", () => {
    const result = buildOrderEditLifecycleTaxBase({
      originalInvoice,
      currentTaxBase: {
        lines: [
          {
            id: 1,
            sourceItemId: "item_taxable",
            name: "Taxable item",
            quantity: 2,
            unitPriceHalalas: 10000,
            lineExtensionHalalas: 20000,
            vatPercent: 15,
          },
        ],
        documentAllowances: [],
        documentCharges: [],
        expectedTaxInclusiveHalalas: 23000,
        expectedTaxHalalas: 3000,
      },
    });

    expect(result?.documentType).toBe("debit_note");
    expect(result?.reason).toBe("Order edit increase");
    expect(result?.expectedTaxInclusiveHalalas).toBe(11500);
    expect(result?.expectedTaxHalalas).toBe(1500);
    expect(result?.lines[0]).toMatchObject({
      name: "Order edit increase @ 15% VAT",
      unitPriceHalalas: 10000,
      vatPercent: 15,
    });
  });

  it("returns null when the edit does not change the tax base", () => {
    const result = buildOrderEditLifecycleTaxBase({
      originalInvoice,
      currentTaxBase: {
        lines: originalInvoice.lines_snapshot.lines,
        documentAllowances: [],
        documentCharges: [],
        expectedTaxInclusiveHalalas: 11500,
        expectedTaxHalalas: 1500,
      },
    });

    expect(result).toBeNull();
  });
});
