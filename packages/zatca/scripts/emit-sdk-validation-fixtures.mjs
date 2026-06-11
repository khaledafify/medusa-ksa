#!/usr/bin/env node
/**
 * Emit signed v1.1 XML fixtures for offline validation with the ZATCA SDK.
 *
 * Run from packages/zatca after `pnpm --filter medusa-plugin-zatca build`:
 *
 *   node scripts/emit-sdk-validation-fixtures.mjs
 *
 * Then validate each generated XML:
 *
 *   export JAVA_HOME=/opt/homebrew/opt/openjdk@11
 *   export FATOORA_HOME=~/zatca-sdk/latest/zatca-einvoicing-sdk-238-R3.3.8/Apps
 *   export PATH="$JAVA_HOME/bin:$FATOORA_HOME:$PATH"
 *   fatoora -validate -invoice test/fixtures/sdk/generated/<file>.xml
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const fixtures = join(packageRoot, "test/fixtures/sdk");
const outDir = join(fixtures, "generated");

const {
  generatePendingInvoice,
} = require("../.medusa/server/src/modules/zatca/lib/generate-invoice.js");
const {
  SEED_PIH,
} = require("../.medusa/server/src/modules/zatca/lib/hash-chain.js");
const {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
} = require("../.medusa/server/src/modules/zatca/lib/lifecycle.js");
const {
  deriveSimplifiedInvoiceTaxBase,
} = require("../.medusa/server/src/modules/zatca/lib/tax-base.js");

const certificate = readFileSync(join(fixtures, "sample-cert.pem"), "utf8");
const privateKey = readFileSync(join(fixtures, "sample-priv-key.pem"), "utf8");

const supplier = {
  crn: "1010010000",
  street: "الامير سلطان | Prince Sultan",
  building: "2322",
  citySubdivision: "المربع | Al-Murabba",
  city: "الرياض | Riyadh",
  postalZone: "23333",
  vatNumber: "399999999900003",
  name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
};

const customer = {
  street: "صلاح الدين | Salah Al-Din",
  building: "1111",
  citySubdivision: "المروج | Al-Murooj",
  city: "الرياض | Riyadh",
  postalZone: "12222",
  vatNumber: "399999999800003",
  name: "شركة نماذج فاتورة المحدودة | Fatoora Samples LTD",
};

function baseInput(name, serialNumber, extra) {
  return {
    orderId: `order_${name}`,
    egsKey: "egs-sdk-validation",
    serialNumber,
    issueDate: "2026-06-11",
    issueTime: "12:00:00",
    invoiceTypeName: "0200000",
    certificate,
    privateKey,
    supplier,
    customer,
    paymentMeansCode: "10",
    ...extra,
  };
}

async function emit(name, input) {
  const fakeExecutor = {
    execute(sql) {
      if (sql.includes("pg_advisory_xact_lock")) return Promise.resolve([]);
      // Each SDK fixture validates standalone against Data/PIH/pih.txt.
      return Promise.resolve([{ icv: 9, invoice_hash: SEED_PIH }]);
    },
  };
  const record = await generatePendingInvoice(
    fakeExecutor,
    input,
    () => Promise.resolve(),
  );
  if (record.status !== "pending") {
    throw new Error(`${name} emitted ${record.status}, expected pending`);
  }
  const outPath = join(outDir, `${name}.xml`);
  writeFileSync(outPath, record.xml);
  console.log(`${name}.xml icv=${record.icv} hash=${record.invoice_hash}`);
}

function taxInclusiveTaxBase() {
  return deriveSimplifiedInvoiceTaxBase({
    id: "order_tax_inclusive",
    total: 115,
    tax_total: 15,
    items: [
      {
        id: "item_tax_inclusive",
        title: "Tax-inclusive item",
        quantity: 1,
        unit_price: 115,
        is_tax_inclusive: true,
        total: 115,
        subtotal: 100,
        tax_total: 15,
        tax_lines: [{ rate: 15, total: 15, subtotal: 100 }],
      },
    ],
    shipping_methods: [],
  });
}

mkdirSync(outDir, { recursive: true });

await emit(
  "invoice-discount",
  baseInput("discount", "SDK-DISCOUNT-1", {
    uuid: "11111111-1111-4111-8111-111111111111",
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
      { amountHalalas: 2000, vatPercent: 15, reason: "discount" },
    ],
  }),
);

await emit(
  "invoice-shipping",
  baseInput("shipping", "SDK-SHIPPING-1", {
    uuid: "22222222-2222-4222-8222-222222222222",
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
      { amountHalalas: 1000, vatPercent: 15, reason: "shipping" },
    ],
  }),
);

const taxInclusive = taxInclusiveTaxBase();
await emit(
  "invoice-tax-inclusive",
  baseInput("tax_inclusive", "SDK-TAX-INCLUSIVE-1", {
    uuid: "33333333-3333-4333-8333-333333333333",
    lines: taxInclusive.lines,
    documentAllowances: taxInclusive.documentAllowances,
    documentCharges: taxInclusive.documentCharges,
    expectedTaxInclusiveHalalas: taxInclusive.expectedTaxInclusiveHalalas,
    expectedTaxHalalas: taxInclusive.expectedTaxHalalas,
  }),
);

await emit(
  "invoice-multi-rate",
  baseInput("multi_rate", "SDK-MULTI-RATE-1", {
    uuid: "44444444-4444-4444-8444-444444444444",
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
  }),
);

await emit(
  "credit-note-full",
  baseInput("credit_full", "SDK-CN-FULL-1", {
    uuid: "55555555-5555-4555-8555-555555555555",
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    sourceId: "refund_sdk_full",
    parentInvoiceId: "zatinv_sdk_original",
    billingReference: "SDK-MULTI-RATE-1",
    reason: "Refund",
    lines: [
      {
        id: 1,
        name: "Full refund line",
        quantity: 1,
        unitPriceHalalas: 10000,
        vatPercent: 15,
      },
    ],
  }),
);

await emit(
  "credit-note-partial",
  baseInput("credit_partial", "SDK-CN-PARTIAL-1", {
    uuid: "66666666-6666-4666-8666-666666666666",
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.RETURN,
    sourceId: "return_sdk_partial",
    parentInvoiceId: "zatinv_sdk_original",
    billingReference: "SDK-MULTI-RATE-1",
    reason: "Return received",
    lines: [
      {
        id: 1,
        name: "Partial return line",
        quantity: 1,
        unitPriceHalalas: 5000,
        vatPercent: 15,
      },
    ],
  }),
);

await emit(
  "debit-note",
  baseInput("debit", "SDK-DN-1", {
    uuid: "77777777-7777-4777-8777-777777777777",
    documentType: ZATCA_DOCUMENT_TYPE.DEBIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    sourceId: "edit_sdk_debit",
    parentInvoiceId: "zatinv_sdk_original",
    billingReference: "SDK-MULTI-RATE-1",
    reason: "Order edit increase",
    lines: [
      {
        id: 1,
        name: "Order edit increase",
        quantity: 1,
        unitPriceHalalas: 2000,
        vatPercent: 15,
      },
    ],
  }),
);
