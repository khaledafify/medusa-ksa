import { describe, expect, it } from "vitest";

import {
  assertSimplifiedInvoiceReconciles,
  deriveSimplifiedInvoiceTaxBase,
} from "./tax-base";
import { buildSimplifiedInvoiceXml } from "./xml-builder";

describe("deriveSimplifiedInvoiceTaxBase", () => {
  it("derives ex-tax document allowance from Medusa's tax-inclusive discount totals", () => {
    const derived = deriveSimplifiedInvoiceTaxBase({
      id: "order_discount",
      total: 207,
      tax_total: 27,
      items: [
        {
          id: "ordli_discount",
          title: "Discounted taxable item",
          quantity: 2,
          unit_price: 100,
          is_tax_inclusive: false,
          subtotal: 200,
          total: 207,
          tax_total: 27,
          discount_total: 23,
          discount_tax_total: 3,
          tax_lines: [{ rate: 15, total: 27, subtotal: 30 }],
          detail: { quantity: 2 },
        },
      ],
      shipping_methods: [],
    });

    expect(derived.lines).toEqual([
      {
        id: 1,
        sourceItemId: "ordli_discount",
        name: "Discounted taxable item",
        quantity: 2,
        unitPriceHalalas: 10000,
        lineExtensionHalalas: 20000,
        vatPercent: 15,
      },
    ]);
    expect(derived.documentAllowances).toEqual([
      {
        amountHalalas: 2000,
        vatPercent: 15,
        reason: "discount",
      },
    ]);
    expect(derived.documentCharges).toEqual([]);
    expect(derived.expectedTaxInclusiveHalalas).toBe(20700);
    expect(derived.expectedTaxHalalas).toBe(2700);
  });

  it("derives shipping as a document charge from Medusa shipping totals", () => {
    const derived = deriveSimplifiedInvoiceTaxBase({
      id: "order_shipping",
      total: 126.5,
      tax_total: 16.5,
      items: [
        {
          id: "ordli_shipping",
          title: "Shipped taxable item",
          quantity: 1,
          unit_price: 100,
          is_tax_inclusive: false,
          subtotal: 100,
          total: 115,
          tax_total: 15,
          discount_total: 0,
          discount_tax_total: 0,
          tax_lines: [{ rate: 15, total: 15, subtotal: 15 }],
          detail: { quantity: 1 },
        },
      ],
      shipping_methods: [
        {
          total: 11.5,
          tax_total: 1.5,
          tax_lines: [{ rate: 15, total: 1.5 }],
        },
      ],
    });

    expect(derived.documentAllowances).toEqual([]);
    expect(derived.documentCharges).toEqual([
      {
        amountHalalas: 1000,
        vatPercent: 15,
        reason: "shipping",
      },
    ]);
    expect(derived.expectedTaxInclusiveHalalas).toBe(12650);
    expect(derived.expectedTaxHalalas).toBe(1650);
  });

  it("derives net unit price for tax-inclusive Medusa lines", () => {
    const derived = deriveSimplifiedInvoiceTaxBase({
      id: "order_inclusive",
      total: 115,
      tax_total: 15,
      items: [
        {
          id: "ordli_inclusive",
          title: "Inclusive taxable item",
          quantity: 1,
          unit_price: 115,
          is_tax_inclusive: true,
          subtotal: 100,
          total: 115,
          tax_total: 15,
          discount_total: 0,
          discount_tax_total: 0,
          tax_lines: [{ rate: 15, total: 15, subtotal: 15 }],
          detail: { quantity: 1 },
        },
      ],
      shipping_methods: [],
    });

    expect(derived.lines[0]).toMatchObject({
      unitPriceHalalas: 10000,
      lineExtensionHalalas: 10000,
    });
    expect(derived.expectedTaxInclusiveHalalas).toBe(11500);
    expect(derived.expectedTaxHalalas).toBe(1500);
  });

  it("rejects a built document whose totals do not reconcile to the order", () => {
    const expected = {
      expectedTaxInclusiveHalalas: 11500,
      expectedTaxHalalas: 1500,
    };
    expect(() =>
      assertSimplifiedInvoiceReconciles(
        { taxInclusiveHalalas: 11500, taxHalalas: 1500 },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertSimplifiedInvoiceReconciles(
        { taxInclusiveHalalas: 11600, taxHalalas: 1500 },
        expected,
      ),
    ).toThrow(/reconciliation_mismatch/);
  });

  it("maps a discount plus shipping order into a reconciled invoice build", () => {
    const taxBase = deriveSimplifiedInvoiceTaxBase({
      id: "order_discount_shipping",
      total: 218.5,
      tax_total: 28.5,
      items: [
        {
          id: "ordli_discount_shipping",
          title: "Discounted shipped item",
          quantity: 2,
          unit_price: 100,
          is_tax_inclusive: false,
          subtotal: 200,
          total: 207,
          tax_total: 27,
          discount_total: 23,
          discount_tax_total: 3,
          tax_lines: [{ rate: 15, total: 27, subtotal: 30 }],
          detail: { quantity: 2 },
        },
      ],
      shipping_methods: [
        {
          total: 11.5,
          tax_total: 1.5,
          tax_lines: [{ rate: 15, total: 1.5 }],
        },
      ],
    });
    const built = buildSimplifiedInvoiceXml({
      serialNumber: "INV-1",
      uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
      issueDate: "2026-06-11",
      issueTime: "12:00:00",
      icv: 1,
      pih: "seed",
      supplier: {
        crn: "1010010000",
        street: "Prince Sultan",
        building: "2322",
        citySubdivision: "Al-Murabba",
        city: "Riyadh",
        postalZone: "23333",
        vatNumber: "399999999900003",
        name: "Maximum Speed Tech Supply LTD",
      },
      lines: taxBase.lines,
      documentAllowances: taxBase.documentAllowances,
      documentCharges: taxBase.documentCharges,
    });

    expect(built.taxExclusiveHalalas).toBe(19000);
    expect(built.taxHalalas).toBe(2850);
    expect(built.taxInclusiveHalalas).toBe(21850);
    expect(() =>
      assertSimplifiedInvoiceReconciles(built, taxBase),
    ).not.toThrow();
  });
});
