/**
 * One-off generator: derives the byte-exact Simplified-invoice template from
 * the ZATCA SDK golden sample (test/fixtures/sdk/simplified-invoice.xml).
 *
 * The golden sample's exact bytes — including its irregular indentation —
 * are what the SDK validator hashed and approved, so the runtime template is
 * generated from it instead of being hand-typed (a single byte of drift fails
 * the invoice-hash byte-match gate, ADR-0007).
 *
 * Run from packages/zatca:  node scripts/derive-template-from-golden.mjs
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
  const first = haystack.indexOf(
    typeof needle === "string" ? needle : needle.source,
  );
  if (typeof needle === "string") {
    if (first === -1) throw new Error(`needle not found: ${needle.slice(0, 80)}`);
    if (haystack.indexOf(needle, first + 1) !== -1) {
      throw new Error(`needle not unique: ${needle.slice(0, 80)}`);
    }
    return (
      haystack.slice(0, first) +
      replacement +
      haystack.slice(first + needle.length)
    );
  }
  throw new Error("regex needles not supported");
}

/** Extract the block between startMarker..endMarker (inclusive), exactly once. */
function extractOnce(haystack, startMarker, endMarker) {
  const start = haystack.indexOf(startMarker);
  if (start === -1) throw new Error(`start not found: ${startMarker.slice(0, 60)}`);
  const end = haystack.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end not found: ${endMarker.slice(0, 60)}`);
  const block = haystack.slice(start, end + endMarker.length);
  if (haystack.indexOf(startMarker, start + 1) !== -1) {
    // fine for repeated blocks — caller handles
  }
  return block;
}

let tpl = golden;

// ── 1. UBLExtensions → single placeholder element ───────────────────────────
const ublExt = extractOnce(tpl, "<ext:UBLExtensions>", "</ext:UBLExtensions>");
tpl = replaceOnce(
  tpl,
  ublExt,
  "<ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>",
);

// ── 2. Header scalars ────────────────────────────────────────────────────────
tpl = replaceOnce(tpl, "<cbc:ID>SME00010</cbc:ID>", "<cbc:ID>SET_INVOICE_SERIAL_NUMBER</cbc:ID>");
tpl = replaceOnce(tpl, "<cbc:UUID>8e6000cf-1a98-4174-b3e7-b5d5954bc10d</cbc:UUID>", "<cbc:UUID>SET_INVOICE_UUID</cbc:UUID>");
tpl = replaceOnce(tpl, "<cbc:IssueDate>2022-08-17</cbc:IssueDate>", "<cbc:IssueDate>SET_ISSUE_DATE</cbc:IssueDate>");
tpl = replaceOnce(tpl, "<cbc:IssueTime>17:41:08</cbc:IssueTime>", "<cbc:IssueTime>SET_ISSUE_TIME</cbc:IssueTime>");
tpl = replaceOnce(
  tpl,
  '<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>',
  '<cbc:InvoiceTypeCode name="SET_INVOICE_TYPE_NAME">SET_INVOICE_TYPE_CODE</cbc:InvoiceTypeCode>',
);
tpl = replaceOnce(
  tpl,
  '    <cbc:Note languageID="ar">ABC</cbc:Note>\n',
  "SET_NOTE",
);

// ── 3. ICV + PIH ─────────────────────────────────────────────────────────────
tpl = replaceOnce(tpl, "<cbc:UUID>10</cbc:UUID>", "<cbc:UUID>SET_INVOICE_COUNTER</cbc:UUID>");
tpl = replaceOnce(
  tpl,
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
  "SET_PREVIOUS_INVOICE_HASH",
);

// ── 4. QR payload ────────────────────────────────────────────────────────────
const qrBlock = extractOnce(
  tpl,
  "    <cac:AdditionalDocumentReference>\n        <cbc:ID>QR</cbc:ID>",
  "</cac:AdditionalDocumentReference>",
);
const qrValueStart = qrBlock.indexOf('mimeCode="text/plain">') + 'mimeCode="text/plain">'.length;
const qrValueEnd = qrBlock.indexOf("</cbc:EmbeddedDocumentBinaryObject>");
const qrValue = qrBlock.slice(qrValueStart, qrValueEnd);
tpl = replaceOnce(tpl, qrValue, "SET_QR_CODE_DATA");

// ── 5. Supplier ──────────────────────────────────────────────────────────────
tpl = replaceOnce(tpl, '<cbc:ID schemeID="CRN">1010010000</cbc:ID>', '<cbc:ID schemeID="CRN">SET_SUPPLIER_CRN</cbc:ID>');
tpl = replaceOnce(tpl, "<cbc:StreetName>الامير سلطان | Prince Sultan</cbc:StreetName>", "<cbc:StreetName>SET_SUPPLIER_STREET</cbc:StreetName>");
tpl = replaceOnce(tpl, "<cbc:BuildingNumber>2322</cbc:BuildingNumber>", "<cbc:BuildingNumber>SET_SUPPLIER_BUILDING</cbc:BuildingNumber>");
tpl = replaceOnce(tpl, "<cbc:CitySubdivisionName>المربع | Al-Murabba</cbc:CitySubdivisionName>", "<cbc:CitySubdivisionName>SET_SUPPLIER_CITY_SUBDIVISION</cbc:CitySubdivisionName>");
tpl = replaceOnce(tpl, "<cbc:CityName>الرياض | Riyadh</cbc:CityName>\n                <cbc:PostalZone>23333</cbc:PostalZone>", "<cbc:CityName>SET_SUPPLIER_CITY</cbc:CityName>\n                <cbc:PostalZone>SET_SUPPLIER_POSTAL_ZONE</cbc:PostalZone>");
tpl = replaceOnce(tpl, "<cbc:CompanyID>399999999900003</cbc:CompanyID>", "<cbc:CompanyID>SET_SUPPLIER_VAT_NUMBER</cbc:CompanyID>");
tpl = replaceOnce(
  tpl,
  "<cbc:RegistrationName>شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD</cbc:RegistrationName>",
  "<cbc:RegistrationName>SET_SUPPLIER_NAME</cbc:RegistrationName>",
);

// ── 6. Customer party → optional block placeholder ──────────────────────────
const customerBlock = extractOnce(
  tpl,
  "     <cac:AccountingCustomerParty>",
  "</cac:AccountingCustomerParty>",
);
tpl = replaceOnce(tpl, customerBlock, "SET_CUSTOMER_PARTY");
let customerTpl = customerBlock;
customerTpl = replaceOnce(customerTpl, "<cbc:StreetName>صلاح الدين | Salah Al-Din</cbc:StreetName>", "<cbc:StreetName>SET_CUSTOMER_STREET</cbc:StreetName>");
customerTpl = replaceOnce(customerTpl, "<cbc:BuildingNumber>1111</cbc:BuildingNumber>", "<cbc:BuildingNumber>SET_CUSTOMER_BUILDING</cbc:BuildingNumber>");
customerTpl = replaceOnce(customerTpl, "<cbc:CitySubdivisionName>المروج | Al-Murooj</cbc:CitySubdivisionName>", "<cbc:CitySubdivisionName>SET_CUSTOMER_CITY_SUBDIVISION</cbc:CitySubdivisionName>");
customerTpl = replaceOnce(customerTpl, "<cbc:CityName>الرياض | Riyadh</cbc:CityName>\n                <cbc:PostalZone>12222</cbc:PostalZone>", "<cbc:CityName>SET_CUSTOMER_CITY</cbc:CityName>\n                <cbc:PostalZone>SET_CUSTOMER_POSTAL_ZONE</cbc:PostalZone>");
customerTpl = replaceOnce(customerTpl, "<cbc:CompanyID>399999999800003</cbc:CompanyID>", "<cbc:CompanyID>SET_CUSTOMER_VAT_NUMBER</cbc:CompanyID>");
customerTpl = replaceOnce(
  customerTpl,
  "<cbc:RegistrationName>شركة نماذج فاتورة المحدودة | Fatoora Samples LTD</cbc:RegistrationName>",
  "<cbc:RegistrationName>SET_CUSTOMER_NAME</cbc:RegistrationName>",
);

// ── 7. Payment means ─────────────────────────────────────────────────────────
tpl = replaceOnce(tpl, "<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>", "<cbc:PaymentMeansCode>SET_PAYMENT_MEANS_CODE</cbc:PaymentMeansCode>");

// ── 8. Document-level AllowanceCharge → repeated TaxCategory ────────────────
const taxCategoryBlock = extractOnce(
  tpl,
  "        <cac:TaxCategory>\n            <cbc:ID schemeID=\"UN/ECE 5305\" schemeAgencyID=\"6\">S</cbc:ID>\n            <cbc:Percent>15</cbc:Percent>",
  "</cac:TaxCategory>",
);
// Two identical category blocks (one per invoice line) — collapse to one placeholder.
const twoCategories = `${taxCategoryBlock}\n${taxCategoryBlock}`;
if (!tpl.includes(twoCategories)) throw new Error("expected two adjacent TaxCategory blocks");
tpl = replaceOnce(tpl, twoCategories, "SET_ALLOWANCE_TAX_CATEGORIES");
let taxCategoryTpl = taxCategoryBlock;
taxCategoryTpl = replaceOnce(taxCategoryTpl, '5305" schemeAgencyID="6">S</cbc:ID>', '5305" schemeAgencyID="6">SET_CATEGORY_ID</cbc:ID>');
taxCategoryTpl = replaceOnce(taxCategoryTpl, "<cbc:Percent>15</cbc:Percent>", "<cbc:Percent>SET_CATEGORY_PERCENT</cbc:Percent>");

// ── 9. TaxTotals ─────────────────────────────────────────────────────────────
tpl = replaceOnce(
  tpl,
  '    <cac:TaxTotal>\n        <cbc:TaxAmount currencyID="SAR">30.15</cbc:TaxAmount>\n    </cac:TaxTotal>',
  '    <cac:TaxTotal>\n        <cbc:TaxAmount currencyID="SAR">SET_TAX_TOTAL</cbc:TaxAmount>\n    </cac:TaxTotal>',
);
const taxSubtotalBlock = extractOnce(
  tpl,
  "        <cac:TaxSubtotal>",
  "</cac:TaxSubtotal>",
);
tpl = replaceOnce(
  tpl,
  `    <cac:TaxTotal>\n        <cbc:TaxAmount currencyID="SAR">30.15</cbc:TaxAmount>\n${taxSubtotalBlock}\n    </cac:TaxTotal>`,
  `    <cac:TaxTotal>\n        <cbc:TaxAmount currencyID="SAR">SET_TAX_TOTAL</cbc:TaxAmount>\nSET_TAX_SUBTOTALS\n    </cac:TaxTotal>`,
);
let taxSubtotalTpl = taxSubtotalBlock;
taxSubtotalTpl = replaceOnce(taxSubtotalTpl, '<cbc:TaxableAmount currencyID="SAR">201.00</cbc:TaxableAmount>', '<cbc:TaxableAmount currencyID="SAR">SET_TAXABLE_AMOUNT</cbc:TaxableAmount>');
taxSubtotalTpl = replaceOnce(taxSubtotalTpl, '<cbc:TaxAmount currencyID="SAR">30.15</cbc:TaxAmount>', '<cbc:TaxAmount currencyID="SAR">SET_SUBTOTAL_TAX_AMOUNT</cbc:TaxAmount>');
taxSubtotalTpl = replaceOnce(taxSubtotalTpl, '5305" schemeAgencyID="6">S</cbc:ID>', '5305" schemeAgencyID="6">SET_CATEGORY_ID</cbc:ID>');
taxSubtotalTpl = replaceOnce(taxSubtotalTpl, "<cbc:Percent>15.00</cbc:Percent>", "<cbc:Percent>SET_CATEGORY_PERCENT</cbc:Percent>");

// ── 10. LegalMonetaryTotal ───────────────────────────────────────────────────
tpl = replaceOnce(tpl, '<cbc:LineExtensionAmount currencyID="SAR">201.00</cbc:LineExtensionAmount>', '<cbc:LineExtensionAmount currencyID="SAR">SET_LINE_EXTENSION_TOTAL</cbc:LineExtensionAmount>');
tpl = replaceOnce(tpl, '<cbc:TaxExclusiveAmount currencyID="SAR">201.00</cbc:TaxExclusiveAmount>', '<cbc:TaxExclusiveAmount currencyID="SAR">SET_TAX_EXCLUSIVE_TOTAL</cbc:TaxExclusiveAmount>');
tpl = replaceOnce(tpl, '<cbc:TaxInclusiveAmount currencyID="SAR">231.15</cbc:TaxInclusiveAmount>', '<cbc:TaxInclusiveAmount currencyID="SAR">SET_TAX_INCLUSIVE_TOTAL</cbc:TaxInclusiveAmount>');
tpl = replaceOnce(tpl, '<cbc:PayableAmount currencyID="SAR">231.15</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="SAR">SET_PAYABLE_AMOUNT</cbc:PayableAmount>');

// ── 11. Invoice lines → repeated block ───────────────────────────────────────
const lineOne = extractOnce(tpl, "    <cac:InvoiceLine>", "</cac:InvoiceLine>");
const lineTwoStart = tpl.indexOf("    <cac:InvoiceLine>", tpl.indexOf(lineOne) + lineOne.length);
const lineTwoEnd = tpl.indexOf("</cac:InvoiceLine>", lineTwoStart) + "</cac:InvoiceLine>".length;
const lineTwo = tpl.slice(lineTwoStart, lineTwoEnd);
tpl = replaceOnce(tpl, `${lineOne}\n${lineTwo}`, "SET_INVOICE_LINES");

let lineTpl = lineOne;
lineTpl = replaceOnce(lineTpl, "<cbc:ID>1</cbc:ID>", "<cbc:ID>SET_LINE_ID</cbc:ID>");
lineTpl = replaceOnce(lineTpl, '<cbc:InvoicedQuantity unitCode="PCE">33.000000</cbc:InvoicedQuantity>', '<cbc:InvoicedQuantity unitCode="PCE">SET_LINE_QUANTITY</cbc:InvoicedQuantity>');
lineTpl = replaceOnce(lineTpl, '<cbc:LineExtensionAmount currencyID="SAR">99.00</cbc:LineExtensionAmount>', '<cbc:LineExtensionAmount currencyID="SAR">SET_LINE_EXTENSION</cbc:LineExtensionAmount>');
lineTpl = replaceOnce(lineTpl, '<cbc:TaxAmount currencyID="SAR">14.85</cbc:TaxAmount>', '<cbc:TaxAmount currencyID="SAR">SET_LINE_TAX_AMOUNT</cbc:TaxAmount>');
lineTpl = replaceOnce(lineTpl, '<cbc:RoundingAmount currencyID="SAR">113.85</cbc:RoundingAmount>', '<cbc:RoundingAmount currencyID="SAR">SET_LINE_ROUNDING_AMOUNT</cbc:RoundingAmount>');
lineTpl = replaceOnce(lineTpl, "<cbc:Name>كتاب</cbc:Name>", "<cbc:Name>SET_LINE_NAME</cbc:Name>");
lineTpl = replaceOnce(lineTpl, "<cbc:ID>S</cbc:ID>", "<cbc:ID>SET_CATEGORY_ID</cbc:ID>");
lineTpl = replaceOnce(lineTpl, "<cbc:Percent>15.00</cbc:Percent>", "<cbc:Percent>SET_CATEGORY_PERCENT</cbc:Percent>");
lineTpl = replaceOnce(lineTpl, '<cbc:PriceAmount currencyID="SAR">3.00</cbc:PriceAmount>', '<cbc:PriceAmount currencyID="SAR">SET_LINE_PRICE</cbc:PriceAmount>');

// ── Emit TS module ───────────────────────────────────────────────────────────
const banner = `/**
 * GENERATED from test/fixtures/sdk/simplified-invoice.xml by
 * scripts/derive-template-from-golden.mjs — DO NOT EDIT BY HAND.
 *
 * The byte layout (including irregular indentation) is the exact layout the
 * ZATCA SDK validator hashed and approved for the golden sample (ADR-0007).
 * Regenerate with: node scripts/derive-template-from-golden.mjs
 */
`;

const emit = (name, value) =>
  `export const ${name} = ${JSON.stringify(value)};\n`;

const out =
  banner +
  emit("SIMPLIFIED_INVOICE_TEMPLATE", tpl) +
  "\n" +
  emit("CUSTOMER_PARTY_TEMPLATE", customerTpl) +
  "\n" +
  emit("ALLOWANCE_TAX_CATEGORY_TEMPLATE", taxCategoryTpl) +
  "\n" +
  emit("TAX_SUBTOTAL_TEMPLATE", taxSubtotalTpl) +
  "\n" +
  emit("INVOICE_LINE_TEMPLATE", lineTpl);

const outPath = join(pkgRoot, "src/modules/zatca/lib/templates/simplified-invoice.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log(`written: ${outPath}`);
console.log(`template bytes: ${tpl.length}, line tpl: ${lineTpl.length}`);
