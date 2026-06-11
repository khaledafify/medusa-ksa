import { describe, expect, it } from "vitest";

import {
  OverCreditError,
  buildRefundCreditNoteTaxBase,
  extractInvoiceSerial,
} from "./refund-credit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_1001",
  xml:
    '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    "<cbc:ProfileID>reporting:1.0</cbc:ProfileID>" +
    "<cbc:ID>INV-1001</cbc:ID>" +
    "</Invoice>",
  lines_snapshot: {
    lines: [
      {
        id: 1,
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

describe("refund credit-note tax base", () => {
  it("extracts the original invoice serial for BR-KSA-56", () => {
    expect(extractInvoiceSerial(originalInvoice.xml)).toBe("INV-1001");
  });

  it("builds a full-refund credit note from the original issued snapshot", () => {
    const taxBase = buildRefundCreditNoteTaxBase({
      originalInvoice,
      refundAmountHalalas: 11500,
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual(originalInvoice.lines_snapshot.lines);
    expect(taxBase.documentAllowances).toEqual([]);
    expect(taxBase.documentCharges).toEqual([]);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(11500);
    expect(taxBase.expectedTaxHalalas).toBe(1500);
  });

  it("builds one positive single-rate line for a partial money refund", () => {
    const taxBase = buildRefundCreditNoteTaxBase({
      originalInvoice,
      refundAmountHalalas: 5750,
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual([
      {
        id: 1,
        name: "Refund @ 15% VAT",
        quantity: 1,
        unitPriceHalalas: 5000,
        lineExtensionHalalas: 5000,
        vatPercent: 15,
      },
    ]);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(5750);
    expect(taxBase.expectedTaxHalalas).toBe(750);
  });

  it("allocates partial mixed-rate refunds proportionally by original category", () => {
    const taxBase = buildRefundCreditNoteTaxBase({
      originalInvoice: {
        ...originalInvoice,
        lines_snapshot: {
          lines: [
            ...originalInvoice.lines_snapshot.lines,
            {
              id: 2,
              name: "Zero-rated item",
              quantity: 1,
              unitPriceHalalas: 10000,
              lineExtensionHalalas: 10000,
              vatPercent: 0,
            },
          ],
          documentAllowances: [],
          documentCharges: [],
          totals: { taxInclusiveHalalas: 21500, taxHalalas: 1500 },
        },
      },
      refundAmountHalalas: 10750,
      existingCreditNotes: [],
    });

    expect(taxBase.lines).toEqual([
      {
        id: 1,
        name: "Refund @ 15% VAT",
        quantity: 1,
        unitPriceHalalas: 5000,
        lineExtensionHalalas: 5000,
        vatPercent: 15,
      },
      {
        id: 2,
        name: "Refund @ 0% VAT",
        quantity: 1,
        unitPriceHalalas: 5000,
        lineExtensionHalalas: 5000,
        vatPercent: 0,
      },
    ]);
    expect(taxBase.expectedTaxInclusiveHalalas).toBe(10750);
    expect(taxBase.expectedTaxHalalas).toBe(750);
  });

  it("rejects over-crediting beyond the original invoice total", () => {
    expect(() =>
      buildRefundCreditNoteTaxBase({
        originalInvoice,
        refundAmountHalalas: 6000,
        existingCreditNotes: [
          {
            id: "zatinv_credit_1",
            lines_snapshot: {
              lines: [],
              totals: { taxInclusiveHalalas: 6000, taxHalalas: 783 },
            },
            xml: "<Invoice/>",
          },
        ],
      }),
    ).toThrow(OverCreditError);
  });
});
