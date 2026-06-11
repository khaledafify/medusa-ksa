/**
 * Emit a freshly generated, signed, QR-stamped invoice (golden data, SDK test
 * credentials) for offline validation with the ZATCA SDK:
 *
 *   npx tsx scripts/emit-sample-signed-invoice.ts /tmp/generated-invoice.xml
 *   fatoora -validate -invoice /tmp/generated-invoice.xml   # JDK 11
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generatePendingInvoice } from "../src/modules/zatca/lib/generate-invoice";
import { SEED_PIH, type SqlExecutor } from "../src/modules/zatca/lib/hash-chain";

const FIXTURES = join(__dirname, "../test/fixtures/sdk");
function requiredOutPath(): string {
  const outPath = process.argv[2];
  if (!outPath) throw new Error("usage: emit-sample-signed-invoice.ts <out.xml>");
  return outPath;
}

const fakeExecutor: SqlExecutor = {
  execute(sql) {
    if (sql.includes("pg_advisory_xact_lock")) return Promise.resolve([]);
    // Chain head at ICV 9 / seed hash → allocates the golden position (10).
    return Promise.resolve([{ icv: 9, invoice_hash: SEED_PIH }]);
  },
};

async function main(): Promise<void> {
  const outPath = requiredOutPath();
  const record = await generatePendingInvoice(
  fakeExecutor,
  {
    orderId: "order_validation",
    egsKey: "egs-test",
    uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
    serialNumber: "SME00010",
    issueDate: "2022-08-17",
    issueTime: "17:41:08",
    invoiceTypeName: "0200000",
    note: { languageId: "ar", text: "ABC" },
    certificate: readFileSync(join(FIXTURES, "sample-cert.pem"), "utf8"),
    privateKey: readFileSync(join(FIXTURES, "sample-priv-key.pem"), "utf8"),
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
  },
  () => Promise.resolve(),
  );

  writeFileSync(outPath, record.xml);
  console.log(`written: ${outPath}`);
  console.log(`icv=${record.icv} pih=${record.pih.slice(0, 16)}… hash=${record.invoice_hash}`);
}

void main();
