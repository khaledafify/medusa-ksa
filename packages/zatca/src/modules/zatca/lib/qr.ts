import { parseCertificate } from "./signer";

/**
 * TLV 9-tag QR (BR-KSA-27; ADR-0007, adapted from wes4m/zatca-xml-js, MIT).
 *
 * Byte layout pinned by the SDK golden samples (qr.test.ts decodes them):
 * each tag is `[tag, length, ...value]` with a single-byte length; tags 1–7
 * are UTF-8 text (6/7 are the *base64 strings*, not decoded bytes); tags 8–9
 * are raw DER bytes (public key SPKI, certificate's ECDSA signature). The
 * timestamp carries no zone suffix — exactly as in the invoice body.
 */

/** Encode values as 1-indexed TLV tags (single-byte tag and length). */
export function encodeTlv(values: (string | Buffer)[]): Buffer {
  const parts = values.map((value, i) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    if (bytes.length > 255) {
      throw new Error(
        `[zatca] QR tag ${i + 1} is ${bytes.length} bytes — TLV length is a single byte (max 255)`,
      );
    }
    return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
  });
  return Buffer.concat(parts);
}

/** Single-byte DER length at offset; returns [length, nextOffset]. */
function readDerLength(der: Buffer, offset: number): [number, number] {
  const first = der[offset]!;
  offset += 1;
  if (!(first & 0x80)) return [first, offset];
  const numBytes = first & 0x7f;
  let length = 0;
  for (let k = 0; k < numBytes; k++) {
    length = (length << 8) | der[offset]!;
    offset += 1;
  }
  return [length, offset];
}

/**
 * Certificate's own ECDSA signature bytes (QR tag 9).
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm,
 * signatureValue BIT STRING } — walk to the trailing BIT STRING.
 */
export function certificateSignatureBytes(certificate: string): Buffer {
  const der = parseCertificate(certificate).raw;
  let offset = 1; // outer SEQUENCE tag
  [, offset] = readDerLength(der, offset); // enter outer SEQUENCE
  for (const _part of ["tbsCertificate", "signatureAlgorithm"]) {
    offset += 1; // element tag
    const [len, next] = readDerLength(der, offset);
    offset = next + len;
  }
  if (der[offset] !== 0x03) {
    throw new Error("[zatca] malformed certificate: signature BIT STRING not found");
  }
  offset += 1;
  const [len, next] = readDerLength(der, offset);
  // First content byte is the unused-bits count — always 0 here, skip it.
  return Buffer.from(der.subarray(next + 1, next + len));
}

/** Certificate public key as DER SubjectPublicKeyInfo (QR tag 8). */
export function certificatePublicKeyDer(certificate: string): Buffer {
  return parseCertificate(certificate).publicKey.export({
    type: "spki",
    format: "der",
  });
}

export interface QrInput {
  /** Seller registration name (tag 1). */
  sellerName: string;
  /** Seller VAT number (tag 2). */
  vatNumber: string;
  /** Issue date+time `YYYY-MM-DDTHH:mm:ss`, no zone suffix (tag 3). */
  issueDateTime: string;
  /** Tax-inclusive total as the invoice's decimal string (tag 4). */
  taxInclusiveTotal: string;
  /** VAT total as the invoice's decimal string (tag 5). */
  vatTotal: string;
  /** Invoice body hash, base64 (tag 6). */
  invoiceHash: string;
  /** ECDSA signature over the hash, base64 (tag 7). */
  digitalSignature: string;
  /** Signing certificate (base64 body or PEM) — tags 8 and 9. */
  certificate: string;
}

/** Build the base64 TLV QR payload for a signed Simplified invoice. */
export function generateQr(input: QrInput): string {
  return encodeTlv([
    input.sellerName,
    input.vatNumber,
    input.issueDateTime,
    input.taxInclusiveTotal,
    input.vatTotal,
    input.invoiceHash,
    input.digitalSignature,
    certificatePublicKeyDer(input.certificate),
    certificateSignatureBytes(input.certificate),
  ]).toString("base64");
}
