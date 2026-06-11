import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeTlv, generateQr, type QrInput } from "./qr";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const goldenXml = readFileSync(join(FIXTURES, "simplified-invoice.xml"), "utf8");
const resignedXml = readFileSync(
  join(FIXTURES, "simplified-invoice-signed.xml"),
  "utf8",
);
const sampleCert = readFileSync(join(FIXTURES, "sample-cert.pem"), "utf8");

const qrOf = (xml: string): string =>
  /<cbc:ID>QR<\/cbc:ID>[\s\S]*?mimeCode="text\/plain">([^<]+)</.exec(xml)![1]!;
const signatureOf = (xml: string): string =>
  /<ds:SignatureValue>([^<]+)/.exec(xml)![1]!;

/** Golden values (tags 1–6 are identical across both fixtures). */
const goldenInput = (digitalSignature: string): QrInput => ({
  sellerName:
    "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
  vatNumber: "399999999900003",
  issueDateTime: "2022-08-17T17:41:08",
  taxInclusiveTotal: "231.15",
  vatTotal: "30.15",
  invoiceHash: "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=",
  digitalSignature,
  certificate: sampleCert,
});

describe("generateQr (golden byte-match, ADR-0007)", () => {
  it("reproduces the golden sample QR byte-for-byte", () => {
    const qr = generateQr(goldenInput(signatureOf(goldenXml)));
    expect(qr).toBe(qrOf(goldenXml));
  });

  it("reproduces the SDK re-signed QR byte-for-byte (only tag 7 differs)", () => {
    const qr = generateQr(goldenInput(signatureOf(resignedXml)));
    expect(qr).toBe(qrOf(resignedXml));
  });

  it("encodes all 9 tags with correct TLV byte lengths", () => {
    const buf = Buffer.from(generateQr(goldenInput(signatureOf(goldenXml))), "base64");
    const tags = new Map<number, Buffer>();
    let i = 0;
    while (i < buf.length) {
      const tag = buf[i]!;
      const len = buf[i + 1]!;
      tags.set(tag, buf.subarray(i + 2, i + 2 + len));
      i += 2 + len;
    }
    expect([...tags.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Seller name length counts UTF-8 bytes, not characters.
    expect(tags.get(1)!.length).toBe(111);
    expect(tags.get(3)!.toString()).toBe("2022-08-17T17:41:08");
    // 8/9 are raw DER bytes (public key SPKI, certificate signature).
    expect(tags.get(8)!.length).toBe(88);
    expect(tags.get(9)!.length).toBe(71);
  });
});

describe("encodeTlv", () => {
  it("encodes tag/length/value sequences", () => {
    const buf = encodeTlv(["AB", Buffer.from([0xff])]);
    expect([...buf]).toEqual([1, 2, 0x41, 0x42, 2, 1, 0xff]);
  });

  it("rejects values longer than 255 bytes (single-byte TLV length)", () => {
    expect(() => encodeTlv(["x".repeat(256)])).toThrow(/255/);
  });
});
