import { createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeInvoiceHash } from "./invoice-hash";
import {
  certificatePublicKey,
  getCertificateInfo,
  signInvoice,
  signInvoiceHash,
} from "./signer";
import { buildSimplifiedInvoiceXml, type SimplifiedInvoiceProps } from "./xml-builder";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const goldenXml = readFileSync(join(FIXTURES, "simplified-invoice.xml"), "utf8");
const sampleCert = readFileSync(join(FIXTURES, "sample-cert.pem"), "utf8");
const sampleKey = readFileSync(join(FIXTURES, "sample-priv-key.pem"), "utf8");

/** Golden invariants extracted from the SDK sample (see fixtures README). */
const GOLDEN_HASH = "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=";
const GOLDEN_SIGNING_TIME = "2024-01-14T10:26:49";
const GOLDEN_PROPS_DIGEST =
  "NTUzMzVmMjExNWRjYzZkYzRlNjI1Y2Q1NDM1NWMwYjMzZjQ4MTZiYjlhOTZlMmY5ZDkzM2Q3ZDM1ODliNjE0ZA==";
const GOLDEN_CERT_DIGEST =
  "ZDMwMmI0MTE1NzVjOTU2NTk4YzVlODhhYmI0ODU2NDUyNTU2YTVhYjhhMDFmN2FjYjk1YTA2OWQ0NjY2MjQ4NQ==";
const GOLDEN_ISSUER = "CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local";
const GOLDEN_SERIAL = "379112742831380471835263969587287663520528387";
/** SignatureValue embedded in the golden sample (signed by the SDK). */
const GOLDEN_SIGNATURE =
  "MEUCIQCs+DNQ1vlz7JoovA7JRjakn4tUs0JlCcAoJNh/J65FHwIgKppt2+DfcLXtKQ6yR49tcVydgs/MSY2yV9vATzcpUq4=";

/** Builder input reproducing the golden sample body (same as xml-builder test). */
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

describe("getCertificateInfo (golden)", () => {
  it("reproduces the golden certificate digest, issuer, and serial", () => {
    const info = getCertificateInfo(sampleCert);
    expect(info.hash).toBe(GOLDEN_CERT_DIGEST);
    expect(info.issuerName).toBe(GOLDEN_ISSUER);
    expect(info.serialNumber).toBe(GOLDEN_SERIAL);
  });

  it("accepts a full PEM wrapper too", () => {
    const body = sampleCert.trim();
    const pem = `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
    expect(getCertificateInfo(pem).hash).toBe(GOLDEN_CERT_DIGEST);
  });
});

describe("signInvoiceHash", () => {
  it("matches the SDK signing convention (verifies over the raw hash bytes)", () => {
    const signature = signInvoiceHash(GOLDEN_HASH, sampleKey);
    const verify = createVerify("sha256");
    verify.update(Buffer.from(GOLDEN_HASH, "base64"));
    expect(
      verify.verify(certificatePublicKey(sampleCert), Buffer.from(signature, "base64")),
    ).toBe(true);
  });

  it("the golden sample's own SignatureValue verifies under the same convention", () => {
    const verify = createVerify("sha256");
    verify.update(Buffer.from(GOLDEN_HASH, "base64"));
    expect(
      verify.verify(
        certificatePublicKey(sampleCert),
        Buffer.from(GOLDEN_SIGNATURE, "base64"),
      ),
    ).toBe(true);
  });
});

describe("signInvoice (golden byte-match, ADR-0007)", () => {
  const sign = () =>
    signInvoice({
      xml: buildSimplifiedInvoiceXml(goldenProps).xml,
      certificate: sampleCert,
      privateKey: sampleKey,
      signingTime: GOLDEN_SIGNING_TIME,
    });

  it("reproduces the golden SignedProperties digest at the golden signing time", () => {
    expect(sign().signedPropertiesHash).toBe(GOLDEN_PROPS_DIGEST);
  });

  it("preserves the invoice hash (body untouched by signing)", () => {
    const { signedXml, invoiceHash } = sign();
    expect(invoiceHash).toBe(GOLDEN_HASH);
    expect(computeInvoiceHash(signedXml)).toBe(GOLDEN_HASH);
  });

  it("byte-matches the golden signed sample modulo the fresh ECDSA value and QR", () => {
    const { signedXml, digitalSignature } = sign();
    // ECDSA is randomized: substituting the golden SignatureValue (and the
    // golden QR for the still-unstamped placeholder) must yield the golden
    // file byte-for-byte — proving every other signing byte matches.
    const goldenQr =
      /<cbc:ID>QR<\/cbc:ID>[\s\S]*?mimeCode="text\/plain">([^<]+)</.exec(goldenXml)![1]!;
    const normalized = signedXml
      .replace(digitalSignature, GOLDEN_SIGNATURE)
      .replace("SET_QR_CODE_DATA", goldenQr);
    expect(normalized).toBe(goldenXml);
  });

  it("produces a fresh signature that verifies against the certificate", () => {
    const { invoiceHash, digitalSignature } = sign();
    const verify = createVerify("sha256");
    verify.update(Buffer.from(invoiceHash, "base64"));
    expect(
      verify.verify(
        certificatePublicKey(sampleCert),
        Buffer.from(digitalSignature, "base64"),
      ),
    ).toBe(true);
  });

  it("defaults the signing time to now in ZATCA's format", () => {
    const { signedXml } = signInvoice({
      xml: buildSimplifiedInvoiceXml(goldenProps).xml,
      certificate: sampleCert,
      privateKey: sampleKey,
    });
    const time = /<xades:SigningTime>([^<]+)</.exec(signedXml)![1];
    expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("never leaks the private key into output or errors", () => {
    const keyBody = sampleKey.trim();
    const { signedXml } = sign();
    expect(signedXml).not.toContain(keyBody);
    try {
      signInvoice({ xml: "<not-an-invoice/>", certificate: sampleCert, privateKey: sampleKey });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(keyBody);
    }
  });
});
