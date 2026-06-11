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
  it("canonicalizes to the exact bytes of the golden sample", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(canonicalizeForHashing(xml)).toBe(canonicalizeForHashing(goldenXml));
  });

  it("reproduces the SDK invoice hash from builder output", () => {
    const { xml } = buildSimplifiedInvoiceXml(goldenProps);
    expect(computeInvoiceHash(xml)).toBe(GOLDEN_HASH);
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
    expect(xml).not.toContain("AccountingCustomerParty></cac:AccountingCustomerParty");
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
