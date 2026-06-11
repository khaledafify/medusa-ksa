/**
 * One-off generator: derives the byte-exact UBLExtensions signature template
 * from the ZATCA SDK golden sample (test/fixtures/sdk/simplified-invoice.xml).
 *
 * The golden sample ships fully signed; the bytes between
 * <ext:UBLExtensions>…</ext:UBLExtensions> are exactly what the SDK validator
 * accepted, so the runtime template is generated from them instead of being
 * hand-typed (ADR-0007). Only the eight signature-variable values become
 * placeholders.
 *
 * Run from packages/zatca:  node scripts/derive-sign-template-from-golden.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const golden = readFileSync(
  join(pkgRoot, "test/fixtures/sdk/simplified-invoice.xml"),
  "utf8",
);

/** Replace exactly one occurrence or throw (guards against silent drift). */
function replaceOnce(haystack, needle, replacement) {
  const first = haystack.indexOf(needle);
  if (first === -1) throw new Error(`needle not found: ${needle.slice(0, 80)}`);
  if (haystack.indexOf(needle, first + 1) !== -1) {
    throw new Error(`needle not unique: ${needle.slice(0, 80)}`);
  }
  return (
    haystack.slice(0, first) + replacement + haystack.slice(first + needle.length)
  );
}

// Inner content of <ext:UBLExtensions> — what replaces SET_UBL_EXTENSIONS_STRING.
const start = golden.indexOf("<ext:UBLExtensions>") + "<ext:UBLExtensions>".length;
const end = golden.indexOf("</ext:UBLExtensions>");
if (start < "<ext:UBLExtensions>".length || end === -1) {
  throw new Error("UBLExtensions region not found in golden sample");
}
let tpl = golden.slice(start, end);

const grab = (re) => {
  const m = golden.match(re);
  if (!m) throw new Error(`value not found: ${re}`);
  return m[1];
};

const invoiceDigest = grab(/Id="invoiceSignedData"[\s\S]*?<ds:DigestValue>([^<]+)/);
const propsDigest = grab(/#xadesSignedProperties"[\s\S]*?<ds:DigestValue>([^<]+)/);
const signatureValue = grab(/<ds:SignatureValue>([^<]+)/);
const certificate = grab(/<ds:X509Certificate>([^<]+)/);
const signingTime = grab(/<xades:SigningTime>([^<]+)/);
const certDigest = grab(/<xades:CertDigest>[\s\S]*?<ds:DigestValue>([^<]+)/);
const issuerName = grab(/<ds:X509IssuerName>([^<]+)/);
const serialNumber = grab(/<ds:X509SerialNumber>([^<]+)/);

tpl = replaceOnce(tpl, invoiceDigest, "SET_INVOICE_HASH");
tpl = replaceOnce(tpl, propsDigest, "SET_SIGNED_PROPERTIES_HASH");
tpl = replaceOnce(tpl, signatureValue, "SET_DIGITAL_SIGNATURE");
tpl = replaceOnce(tpl, certificate, "SET_CERTIFICATE");
tpl = replaceOnce(tpl, signingTime, "SET_SIGN_TIMESTAMP");
tpl = replaceOnce(tpl, certDigest, "SET_CERTIFICATE_HASH");
tpl = replaceOnce(tpl, issuerName, "SET_CERTIFICATE_ISSUER");
tpl = replaceOnce(tpl, serialNumber, "SET_CERTIFICATE_SERIAL_NUMBER");

const banner = `/**
 * GENERATED from test/fixtures/sdk/simplified-invoice.xml by
 * scripts/derive-sign-template-from-golden.mjs — DO NOT EDIT BY HAND.
 *
 * Byte-exact inner content of <ext:UBLExtensions> as the ZATCA SDK validator
 * accepted it (ADR-0007); only signature-variable values are placeholders.
 * Regenerate with: node scripts/derive-sign-template-from-golden.mjs
 */
`;

const out =
  banner +
  `export const UBL_SIGNATURE_TEMPLATE = ${JSON.stringify(tpl)};\n`;

const outPath = join(pkgRoot, "src/modules/zatca/lib/templates/ubl-signature.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log(`written: ${outPath}`);
console.log(`template bytes: ${tpl.length}`);
