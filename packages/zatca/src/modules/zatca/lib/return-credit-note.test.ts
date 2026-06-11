import { describe, expect, it } from "vitest";

import { buildReturnCreditNoteTaxBase } from "./return-credit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_2001",
  xml: "<Invoice/>",
  lines_snapshot: {
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
      {
        id: 2,
        sourceItemId: "item_zero",
        name: "Zero item",
        quantity: 1,
        unitPriceHalalas: 5000,
        lineExtensionHalalas: 5000,
        vatPercent: 0,
      },
    ],
    documentAllowances: [],
    documentCharges: [{ amountHalalas: 1000, vatPercent: 15, reason: "shipping" }],
    totals: { taxInclusiveHalalas: 33750, taxHalalas: 3750 },
  },
};

describe("return credit-note tax base", () => {
  it("credits received quantity at the original line VAT rate", () => {
    const taxBase = buildReturnCreditNoteTaxBase({
      originalInvoice,
      returnItems: [{ item_id: "item_taxable", received_quantity: 1 }],
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual([
      {
        id: 1,
        name: "Return: Taxable item",
        quantity: 1,
        unitPriceHalalas: 10000,
        lineExtensionHalalas: 10000,
        vatPercent: 15,
      },
    ]);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(11500);
    expect(taxBase.expectedTaxHalalas).toBe(1500);
  });

  it("falls back to requested quantity when received_quantity is absent", () => {
    const taxBase = buildReturnCreditNoteTaxBase({
      originalInvoice,
      returnItems: [{ item_id: "item_zero", quantity: 1 }],
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual([
      {
        id: 1,
        name: "Return: Zero item",
        quantity: 1,
        unitPriceHalalas: 5000,
        lineExtensionHalalas: 5000,
        vatPercent: 0,
      },
    ]);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(5000);
    expect(taxBase.expectedTaxHalalas).toBe(0);
  });

  it("uses the full original snapshot when all invoiced quantities are returned", () => {
    const taxBase = buildReturnCreditNoteTaxBase({
      originalInvoice,
      returnItems: [
        { item_id: "item_taxable", received_quantity: 2 },
        { item_id: "item_zero", received_quantity: 1 },
      ],
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual(originalInvoice.lines_snapshot.lines);
    expect(taxBase.documentCharges).toEqual(originalInvoice.lines_snapshot.documentCharges);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(33750);
    expect(taxBase.expectedTaxHalalas).toBe(3750);
  });

  it("rejects returned quantities above the original invoiced quantity", () => {
    expect(() =>
      buildReturnCreditNoteTaxBase({
        originalInvoice,
        returnItems: [{ item_id: "item_taxable", received_quantity: 3 }],
        existingCreditNotes: [],
      }),
    ).toThrow(/exceeds invoiced quantity/);
  });
});
