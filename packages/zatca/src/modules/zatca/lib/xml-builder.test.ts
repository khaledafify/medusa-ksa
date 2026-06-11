import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalizeForHashing, computeInvoiceHash } from "./invoice-hash";
import {
  buildSimplifiedInvoiceXml,
  formatHalalas,
  type SimplifiedInvoiceProps,
} from "./xml-builder";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const goldenXml = readFileSync(join(FIXTURES, "simplified-invoice.xml"), "utf8");

/** Invoice hash of the golden sample, confirmed via `fatoora -generateHash`. */
const GOLDEN_HASH = "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=";

/**
 * The golden sample predates BR-KSA-EN16931-06 (the live Fatoora API rejects
 * price-level AllowanceCharge with indicator "true"). The builder emits
 * "false"; golden comparisons normalize that single known divergence.
 */
const normalizedGolden = goldenXml.replaceAll(
  "<cbc:ChargeIndicator>true</cbc:ChargeIndicator>",
  "<cbc:ChargeIndicator>false</cbc:ChargeIndicator>",
);

/** The golden sample's data, reconstructed as builder input. */
const goldenProps: SimplifiedInvoiceProps = {
  serialNumber: "SME00010",
  uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
  issueDate: "2022-08-17",
  issueTime: "17:41:08",
  invoiceTypeName: "0200000",
  note: { languageId: "ar", text: "ABC" },
  icv: 10,
  pih: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
  supplier: {
    crn: "1010010000",
    street: "الامير سلطان | Prince Sultan",
    building: "2322",
    citySubdivision: "المربع | Al-Murabba",
    city: "الرياض | Riyadh",
    postalZone: "23333",
    vatNumber: "399999999900003",
    name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
  },
  customer: {
    street: "صلاح الدين | Salah Al-Din",
    building: "1111",
    citySubdivision: "المروج | Al-Murooj",
    city: "الرياض | Riyadh",
    postalZone: "12222",
    vatNumber: "399999999800003",
    name: "شركة نماذج فاتورة المحدودة | Fatoora Samples LTD",
  },
  paymentMeansCode: "10",
  lines: [
    { id: 1, name: "كتاب", quantity: 33, unitPriceHalalas: 300, vatPercent: 15 },
    { id: 2, name: "قلم", quantity: 3, unitPriceHalalas: 3400, vatPercent: 15 },
  ],
};

describe("invoice-hash (golden sample)", () => {
  it("reproduces the SDK's invoice hash for the golden sample", () => {
    expect(computeInvoiceHash(goldenXml)).toBe(GOLDEN_HASH);
  });
});

describe("buildSimplifiedInvoiceXml (golden byte-match, ADR-0007)", () => {
  it("canonicalizes to the exact bytes of the golden sample (normalized)", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(canonicalizeForHashing(xml)).toBe(canonicalizeForHashing(normalizedGolden));
  });

  it("hashes identically to the normalized golden sample", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(computeInvoiceHash(xml)).toBe(computeInvoiceHash(normalizedGolden));
  });

  it("computes the golden totals in halalas", () => {
    const built = buildSimplifiedInvoiceXml(goldenProps);
    expect(built.taxExclusiveHalalas).toBe(20100);
    expect(built.taxHalalas).toBe(3015);
    expect(built.taxInclusiveHalalas).toBe(23115);
  });
});

describe("buildSimplifiedInvoiceXml (general)", () => {
  it("builds a hashable invoice without customer and note", () => {
    const { xml } = buildSimplifiedInvoiceXml({
      ...goldenProps,
      customer: undefined,
      note: undefined,
    });
    // UBL 2.1 requires the element; B2C keeps it empty (wes4m convention).
    expect(xml).toContain(
      "<cac:AccountingCustomerParty></cac:AccountingCustomerParty>",
    );
    expect(xml).not.toContain("PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>");
    expect(xml).not.toContain("<cbc:Note");
    // still well-formed and hashable
    expect(computeInvoiceHash(xml)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("escapes XML-special characters in text fields", () => {
    const { xml } = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [
        {
          id: 1,
          name: 'Tom & Jerry <"large">',
          quantity: 1,
          unitPriceHalalas: 100,
          vatPercent: 15,
        },
      ],
    });
    expect(xml).toContain("Tom &amp; Jerry &lt;&quot;large&quot;&gt;");
    expect(computeInvoiceHash(xml)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("renders zero-VAT lines with category O", () => {
    const { xml, taxHalalas } = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [{ id: 1, name: "x", quantity: 1, unitPriceHalalas: 100, vatPercent: 0 }],
    });
    expect(taxHalalas).toBe(0);
    expect(xml).toContain('5305" schemeAgencyID="6">O</cbc:ID>');
  });

  it("renders a document-level discount allowance in the tax base", () => {
    const built = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [
        {
          id: 1,
          name: "Discounted taxable item",
          quantity: 2,
          unitPriceHalalas: 10000,
          vatPercent: 15,
        },
      ],
      documentAllowances: [
        {
          amountHalalas: 2000,
          vatPercent: 15,
          reason: "discount",
        },
      ],
    });

    expect(built.taxExclusiveHalalas).toBe(18000);
    expect(built.taxHalalas).toBe(2700);
    expect(built.taxInclusiveHalalas).toBe(20700);
    expect(built.xml).toContain(
      "<cbc:LineExtensionAmount currencyID=\"SAR\">200.00</cbc:LineExtensionAmount>",
    );
    expect(built.xml).toContain(
      "<cbc:ChargeIndicator>false</cbc:ChargeIndicator>\n        <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>\n        <cbc:Amount currencyID=\"SAR\">20.00</cbc:Amount>",
    );
    expect(built.xml).toContain(
      "<cbc:TaxableAmount currencyID=\"SAR\">180.00</cbc:TaxableAmount>",
    );
    expect(built.xml).toContain(
      "<cbc:AllowanceTotalAmount currencyID=\"SAR\">20.00</cbc:AllowanceTotalAmount>",
    );
  });

  it("renders shipping as a document-level charge with ChargeTotalAmount", () => {
    const built = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [
        {
          id: 1,
          name: "Shipped taxable item",
          quantity: 1,
          unitPriceHalalas: 10000,
          vatPercent: 15,
        },
      ],
      documentCharges: [
        {
          amountHalalas: 1000,
          vatPercent: 15,
          reason: "shipping",
        },
      ],
    });

    expect(built.taxExclusiveHalalas).toBe(11000);
    expect(built.taxHalalas).toBe(1650);
    expect(built.taxInclusiveHalalas).toBe(12650);
    expect(built.xml).toContain(
      "<cbc:ChargeIndicator>true</cbc:ChargeIndicator>\n        <cbc:AllowanceChargeReason>shipping</cbc:AllowanceChargeReason>\n        <cbc:Amount currencyID=\"SAR\">10.00</cbc:Amount>",
    );
    expect(built.xml).toContain(
      "<cbc:TaxableAmount currencyID=\"SAR\">110.00</cbc:TaxableAmount>",
    );
    expect(built.xml).toContain(
      "<cbc:ChargeTotalAmount currencyID=\"SAR\">10.00</cbc:ChargeTotalAmount>",
    );
  });

  it("groups tax subtotals by VAT rate", () => {
    const built = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [
        {
          id: 1,
          name: "Standard rated item",
          quantity: 1,
          unitPriceHalalas: 10000,
          vatPercent: 15,
        },
        {
          id: 2,
          name: "Out of scope item",
          quantity: 1,
          unitPriceHalalas: 5000,
          vatPercent: 0,
        },
      ],
    });

    expect(built.taxExclusiveHalalas).toBe(15000);
    expect(built.taxHalalas).toBe(1500);
    expect(built.taxInclusiveHalalas).toBe(16500);
    expect(built.xml).toContain(
      "<cbc:TaxableAmount currencyID=\"SAR\">100.00</cbc:TaxableAmount>",
    );
    expect(built.xml).toContain(
      "<cbc:TaxableAmount currencyID=\"SAR\">50.00</cbc:TaxableAmount>",
    );
    expect(built.xml).toContain("<cbc:Percent>15.00</cbc:Percent>");
    expect(built.xml).toContain("<cbc:Percent>0.00</cbc:Percent>");
  });

  it("renders fractional quantities without changing the layout or throwing", () => {
    const built = buildSimplifiedInvoiceXml({
      ...goldenProps,
      lines: [
        {
          id: 1,
          name: "Weighted item",
          quantity: 1.5,
          unitPriceHalalas: 1000,
          lineExtensionHalalas: 1500,
          vatPercent: 15,
        },
      ],
    });

    expect(built.taxExclusiveHalalas).toBe(1500);
    expect(built.taxHalalas).toBe(225);
    expect(built.taxInclusiveHalalas).toBe(1725);
    expect(built.xml).toContain(
      "<cbc:InvoicedQuantity unitCode=\"PCE\">1.500000</cbc:InvoicedQuantity>",
    );
  });

  it("rejects empty invoices and invalid money", () => {
    expect(() => buildSimplifiedInvoiceXml({ ...goldenProps, lines: [] })).toThrow();
    expect(() =>
      buildSimplifiedInvoiceXml({
        ...goldenProps,
        lines: [{ id: 1, name: "x", quantity: 1, unitPriceHalalas: 1.5, vatPercent: 15 }],
      }),
    ).toThrow(/integer/);
    expect(() =>
      buildSimplifiedInvoiceXml({
        ...goldenProps,
        lines: [{ id: 1, name: "x", quantity: 0, unitPriceHalalas: 100, vatPercent: 15 }],
      }),
    ).toThrow(/quantity/);
  });

  it("keeps the signing and QR placeholders for the signer", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(xml).toContain("<ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>");
    expect(xml).toContain("SET_QR_CODE_DATA");
  });

  it("builds a credit note with billing reference and instruction note", () => {
    const { xml } = buildSimplifiedInvoiceXml({
      ...goldenProps,
      invoiceTypeCode: "381",
      billingReference: "SME00010",
      instructionNote: "Goods returned",
    });
    expect(xml).toContain('name="0200000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain(
      "<cac:BillingReference>\n        <cac:InvoiceDocumentReference>\n            <cbc:ID>SME00010</cbc:ID>",
    );
    // InstructionNote stays inside PaymentMeans (BR-KSA-17).
    expect(xml).toMatch(
      /<cbc:PaymentMeansCode>10<\/cbc:PaymentMeansCode>\n {8}<cbc:InstructionNote>Goods returned<\/cbc:InstructionNote>\n {4}<\/cac:PaymentMeans>/,
    );
  });

  it("plain invoices contain no billing reference or instruction note", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(xml).not.toContain("BillingReference");
    expect(xml).not.toContain("InstructionNote");
  });
});

describe("formatHalalas", () => {
  it("formats integer halalas exactly", () => {
    expect(formatHalalas(0)).toBe("0.00");
    expect(formatHalalas(5)).toBe("0.05");
    expect(formatHalalas(3015)).toBe("30.15");
    expect(formatHalalas(23115)).toBe("231.15");
  });

  it("rejects floats and negatives", () => {
    expect(() => formatHalalas(1.5)).toThrow();
    expect(() => formatHalalas(-1)).toThrow();
  });
});
