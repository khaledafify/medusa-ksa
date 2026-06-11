import {
  createHash,
  createSign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

import { computeInvoiceHash } from "./invoice-hash";
import { UBL_SIGNATURE_TEMPLATE } from "./templates/ubl-signature";

/**
 * XAdES-BES / ECDSA-secp256k1 cryptographic stamp (ADR-0007, adapted from
 * wes4m/zatca-xml-js, MIT — see test/fixtures/sdk/README.md).
 *
 * ZATCA's conventions are deliberately non-standard; each is pinned by a
 * golden-sample test, never re-derived from the spec PDF:
 * - digests are base64 of the **hex** SHA-256 string (not the raw bytes);
 * - the ECDSA signature is computed over the raw 32-byte invoice digest
 *   (i.e. SHA-256 of the digest, ECDSA-DER output);
 * - the SignedProperties digest hashes a fixed "for-signing" serialization
 *   whose indentation differs from the embedded form;
 * - SigningTime is local-format `YYYY-MM-DDTHH:mm:ss` with **no** zone suffix.
 */

/**
 * SignedProperties exactly as the SDK validator re-serializes them for the
 * digest (36-space base indent, explicit xmlns:ds declarations). One byte of
 * drift fails validation — the golden tests pin this for both SDK fixtures.
 */
const SIGNED_PROPERTIES_FOR_SIGNING = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>SET_SIGN_TIMESTAMP</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_HASH</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_ISSUER</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_SERIAL_NUMBER</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

/** base64 of the hex SHA-256 string — ZATCA's digest convention. */
function hexSha256Base64(input: string | Buffer): string {
  const hex = createHash("sha256").update(input).digest("hex");
  return Buffer.from(hex).toString("base64");
}

/** Strip PEM armor/whitespace down to the single-line base64 body. */
function pemBody(input: string): string {
  return input.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
}

/** Wrap a base64 body (or pass through a PEM) as a parseable PEM block. */
function toPem(input: string, label: string): string {
  const body = pemBody(input);
  const lines = body.match(/.{1,64}/g);
  if (!lines) {
    throw new Error(`[zatca] empty ${label.toLowerCase()}`);
  }
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export interface CertificateInfo {
  /** Single-line base64 certificate body as embedded in the XML. */
  body: string;
  /** ZATCA certificate digest (base64 of hex SHA-256 of the body). */
  hash: string;
  /** Issuer RDNs, most-specific first, comma-separated. */
  issuerName: string;
  /** Certificate serial as a decimal string. */
  serialNumber: string;
}

/** Parse a certificate given as a bare base64 body or a full PEM. */
export function parseCertificate(certificate: string): X509Certificate {
  return new X509Certificate(toPem(certificate, "CERTIFICATE"));
}

export function getCertificateInfo(certificate: string): CertificateInfo {
  const body = pemBody(certificate);
  const x509 = parseCertificate(certificate);
  return {
    body,
    hash: hexSha256Base64(body),
    issuerName: x509.issuer.split("\n").reverse().join(", "),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
  };
}

/** Public key of the signing certificate (for signature verification). */
export function certificatePublicKey(certificate: string): KeyObject {
  return parseCertificate(certificate).publicKey;
}

/**
 * ECDSA signature over the raw invoice-digest bytes (KSA-15).
 * Accepts the key as a bare base64 SEC1 body or a full PEM.
 */
export function signInvoiceHash(invoiceHash: string, privateKey: string): string {
  const sign = createSign("sha256");
  sign.update(Buffer.from(invoiceHash, "base64"));
  return sign.sign(toPem(privateKey, "EC PRIVATE KEY")).toString("base64");
}

/** ZATCA SigningTime format: local `YYYY-MM-DDTHH:mm:ss`, no zone suffix. */
function formatSigningTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

function fill(template: string, values: Record<string, string>): string {
  let out = template;
  // Longest first: SET_CERTIFICATE must not swallow SET_CERTIFICATE_HASH etc.
  const entries = Object.entries(values).sort(([a], [b]) => b.length - a.length);
  for (const [placeholder, value] of entries) {
    out = out.split(placeholder).join(value);
  }
  return out;
}

export interface SignInvoiceInput {
  /** Unsigned invoice XML with the SET_UBL_EXTENSIONS_STRING placeholder. */
  xml: string;
  /** Signing certificate (base64 body or PEM). */
  certificate: string;
  /** secp256k1 private key (base64 SEC1 body or PEM). Never logged. */
  privateKey: string;
  /** Override for reproducible tests; defaults to now. */
  signingTime?: string;
}

export interface SignedInvoice {
  /** Invoice with the signature embedded; QR placeholder still intact (S3.2). */
  signedXml: string;
  /** Body hash (KSA-13 input for the next invoice's PIH). */
  invoiceHash: string;
  /** Base64 DER ECDSA signature (KSA-15, QR tag 7). */
  digitalSignature: string;
  /** Digest of the for-signing SignedProperties serialization. */
  signedPropertiesHash: string;
}

/**
 * Apply the cryptographic stamp: hash the body, sign the hash, and embed the
 * XAdES UBLExtensions block (byte-derived from the SDK golden sample).
 */
export function signInvoice(input: SignInvoiceInput): SignedInvoice {
  if (!input.xml.includes("<ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>")) {
    throw new Error("[zatca] invoice XML is missing the UBLExtensions signing placeholder");
  }

  const invoiceHash = computeInvoiceHash(input.xml);
  const cert = getCertificateInfo(input.certificate);
  const digitalSignature = signInvoiceHash(invoiceHash, input.privateKey);
  const signingTime = input.signingTime ?? formatSigningTime(new Date());

  const signedPropertiesHash = hexSha256Base64(
    fill(SIGNED_PROPERTIES_FOR_SIGNING, {
      SET_SIGN_TIMESTAMP: signingTime,
      SET_CERTIFICATE_HASH: cert.hash,
      SET_CERTIFICATE_ISSUER: cert.issuerName,
      SET_CERTIFICATE_SERIAL_NUMBER: cert.serialNumber,
    }),
  );

  const ublSignature = fill(UBL_SIGNATURE_TEMPLATE, {
    SET_INVOICE_HASH: invoiceHash,
    SET_SIGNED_PROPERTIES_HASH: signedPropertiesHash,
    SET_DIGITAL_SIGNATURE: digitalSignature,
    SET_CERTIFICATE: cert.body,
    SET_SIGN_TIMESTAMP: signingTime,
    SET_CERTIFICATE_HASH: cert.hash,
    SET_CERTIFICATE_ISSUER: cert.issuerName,
    SET_CERTIFICATE_SERIAL_NUMBER: cert.serialNumber,
  });

  const signedXml = input.xml.replace("SET_UBL_EXTENSIONS_STRING", ublSignature);
  return { signedXml, invoiceHash, digitalSignature, signedPropertiesHash };
}
