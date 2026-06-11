import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  generatePendingInvoice,
  type GenerateInvoiceInput,
  type PendingZatcaInvoiceRecord,
} from "./generate-invoice";
import { type ChainHead, SEED_PIH, type SqlExecutor } from "./hash-chain";
import { computeInvoiceHash } from "./invoice-hash";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const goldenXml = readFileSync(join(FIXTURES, "simplified-invoice.xml"), "utf8");
const sampleCert = readFileSync(join(FIXTURES, "sample-cert.pem"), "utf8");
const sampleKey = readFileSync(join(FIXTURES, "sample-priv-key.pem"), "utf8");

/** Invoice hash of the golden sample, confirmed via `fatoora -generateHash`. */
const GOLDEN_HASH = "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=";
/** SignatureValue and SigningTime embedded in the golden sample. */
const GOLDEN_SIGNATURE =
  "MEUCIQCs+DNQ1vlz7JoovA7JRjakn4tUs0JlCcAoJNh/J65FHwIgKppt2+DfcLXtKQ6yR49tcVydgs/MSY2yV9vATzcpUq4=";
const GOLDEN_SIGNING_TIME = "2024-01-14T10:26:49";

/** Golden sample data as generate-path input (ICV/PIH come from the chain). */
const goldenInput: GenerateInvoiceInput = {
  orderId: "order_golden",
  egsKey: "egs-test",
  uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
  serialNumber: "SME00010",
  issueDate: "2022-08-17",
  issueTime: "17:41:08",
  invoiceTypeName: "0200000",
  note: { languageId: "ar", text: "ABC" },
  certificate: sampleCert,
  privateKey: sampleKey,
  signingTime: GOLDEN_SIGNING_TIME,
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

/** In-memory executor: answers the lock no-op and a fixed chain head. */
function fakeExecutor(head: ChainHead | null): SqlExecutor {
  return {
    execute(sql) {
      if (sql.includes("pg_advisory_xact_lock")) return Promise.resolve([]);
      if (!head) return Promise.resolve([]);
      return Promise.resolve([{ icv: head.icv, invoice_hash: head.invoiceHash }]);
    },
  };
}

const noopPersist = () => Promise.resolve();

describe("generatePendingInvoice (end-to-end golden gate)", () => {
  it("full pipeline byte-matches the golden signed sample modulo the fresh ECDSA value", async () => {
    // Head at ICV 9 whose hash is the golden PIH → next allocation is the
    // golden sample's exact chain position (ICV 10, seed PIH).
    const ex = fakeExecutor({ icv: 9, invoiceHash: SEED_PIH });
    const persisted: PendingZatcaInvoiceRecord[] = [];

    const record = await generatePendingInvoice(ex, goldenInput, (r) => {
      persisted.push(r);
      return Promise.resolve();
    });

    expect(record.icv).toBe(10);
    expect(record.pih).toBe(SEED_PIH);
    expect(record.invoice_hash).toBe(computeInvoiceHash(record.xml));

    // ECDSA is randomized: substituting the golden SignatureValue (which
    // also changes QR tag 7) must reproduce the golden file byte-for-byte.
    // The golden is normalized for BR-KSA-EN16931-06 (price-level charge
    // indicator must be "false" live), which shifts the invoice digest.
    const freshSignature = /<ds:SignatureValue>([^<]+)/.exec(record.xml)![1]!;
    const goldenQr =
      /<cbc:ID>QR<\/cbc:ID>[\s\S]*?mimeCode="text\/plain">([^<]+)</.exec(goldenXml)![1]!;
    const normalized = record.xml
      .replace(freshSignature, GOLDEN_SIGNATURE)
      .replace(record.qr_code, goldenQr);
    const normalizedGolden = goldenXml
      .replaceAll(
        "<cbc:ChargeIndicator>true</cbc:ChargeIndicator>",
        "<cbc:ChargeIndicator>false</cbc:ChargeIndicator>",
      )
      .replace(GOLDEN_HASH, record.invoice_hash);
    expect(normalized).toBe(normalizedGolden);

    expect(record).toMatchObject({
      order_id: "order_golden",
      document_type: "invoice",
      invoice_type: "simplified",
      source_type: "order",
      source_id: "order_golden",
      uuid: goldenInput.uuid,
      status: "pending",
    });
    // The QR is embedded in the XML and the hash survives signing.
    expect(record.xml).toContain(record.qr_code);
    expect(computeInvoiceHash(record.xml)).toBe(record.invoice_hash);
    // Persisted (inside the caller's transaction) before returning.
    expect(persisted).toEqual([record]);
  });

  it("starts a fresh chain at ICV 1 with the seed PIH", async () => {
    const record = await generatePendingInvoice(
      fakeExecutor(null),
      goldenInput,
      noopPersist,
    );
    expect(record.icv).toBe(1);
    expect(record.pih).toBe(SEED_PIH);
    expect(record.invoice_hash).toBe(computeInvoiceHash(record.xml));
  });

  it("mints a UUID v4 when none is provided and embeds it in the XML", async () => {
    const { uuid: _omitted, ...withoutUuid } = goldenInput;
    const record = await generatePendingInvoice(
      fakeExecutor(null),
      withoutUuid,
      noopPersist,
    );
    expect(record.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(record.xml).toContain(`<cbc:UUID>${record.uuid}</cbc:UUID>`);
  });

  it("does not persist when the build fails", async () => {
    const persisted: PendingZatcaInvoiceRecord[] = [];
    await expect(
      generatePendingInvoice(fakeExecutor(null), { ...goldenInput, lines: [] }, (r) => {
        persisted.push(r);
        return Promise.resolve();
      }),
    ).rejects.toThrow();
    expect(persisted).toHaveLength(0);
  });

  it("does not persist when reconciliation fails", async () => {
    const persisted: PendingZatcaInvoiceRecord[] = [];
    await expect(
      generatePendingInvoice(
        fakeExecutor(null),
        {
          ...goldenInput,
          expectedTaxInclusiveHalalas: 99999,
          expectedTaxHalalas: 3015,
        },
        (r) => {
          persisted.push(r);
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow(/reconciliation_mismatch/);
    expect(persisted).toHaveLength(0);
  });

  it("carries credit-note lifecycle metadata into the row and XML", async () => {
    const record = await generatePendingInvoice(
      fakeExecutor(null),
      {
        ...goldenInput,
        uuid: "11111111-1111-4111-8111-111111111111",
        serialNumber: "CN-1001",
        documentType: "credit_note",
        sourceType: "refund",
        sourceId: "refund_1001",
        parentInvoiceId: "zatinv_original",
        billingReference: "INV-1001",
        reason: "Refund",
        linesSnapshot: {
          lines: [
            {
              id: 1,
              name: "كتاب",
              quantity: 1,
              unitPriceHalalas: 300,
              vatPercent: 15,
            },
          ],
        },
      },
      noopPersist,
    );

    expect(record).toMatchObject({
      order_id: "order_golden",
      document_type: "credit_note",
      invoice_type: "simplified",
      source_type: "refund",
      source_id: "refund_1001",
      parent_invoice_id: "zatinv_original",
      billing_reference: "INV-1001",
      reason: "Refund",
      status: "pending",
    });
    expect(record.lines_snapshot).toEqual({
      lines: [
        {
          id: 1,
          name: "كتاب",
          quantity: 1,
          unitPriceHalalas: 300,
          vatPercent: 15,
        },
      ],
    });
    expect(record.xml).toContain("<cbc:InvoiceTypeCode");
    expect(record.xml).toContain(">381</cbc:InvoiceTypeCode>");
    expect(record.xml).toContain("<cbc:ID>INV-1001</cbc:ID>");
    expect(record.xml).toContain("<cbc:InstructionNote>Refund</cbc:InstructionNote>");
  });
});

describe("secret hygiene (PRD §6 credential-security gate)", () => {
  const keyBody = sampleKey.trim();
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map(
    (level) => vi.spyOn(console, level),
  );

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockClear());
  });

  const allConsoleOutput = () =>
    consoleSpies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map(String)
      .join("\n");

  it("never logs and never embeds the private key on the happy path", async () => {
    const record = await generatePendingInvoice(
      fakeExecutor(null),
      goldenInput,
      noopPersist,
    );
    expect(record.xml).not.toContain(keyBody);
    expect(record.qr_code).not.toContain(keyBody);
    expect(JSON.stringify(record)).not.toContain(keyBody);
    expect(allConsoleOutput()).not.toContain(keyBody);
  });

  it("never leaks the private key through errors (build, sign, persist)", async () => {
    const failures: Promise<unknown>[] = [
      // build failure
      generatePendingInvoice(fakeExecutor(null), { ...goldenInput, lines: [] }, noopPersist),
      // sign failure (corrupt key still must not surface its bytes)
      generatePendingInvoice(
        fakeExecutor(null),
        { ...goldenInput, privateKey: "not-a-key" },
        noopPersist,
      ),
      // persist failure
      generatePendingInvoice(fakeExecutor(null), goldenInput, () =>
        Promise.reject(new Error("insert failed")),
      ),
    ];
    for (const failure of failures) {
      try {
        await failure;
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(String(err)).not.toContain(keyBody);
        expect(JSON.stringify(err) ?? "").not.toContain(keyBody);
      }
    }
    expect(allConsoleOutput()).not.toContain(keyBody);
  });
});

const databaseUrl =
  process.env.ZATCA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.runIf(databaseUrl)("generatePendingInvoice (real chain, pg)", () => {
  const schema = `zatca_gen_test_${randomBytes(4).toString("hex")}`;
  let pool: Pool;

  const executor = (client: PoolClient): SqlExecutor => ({
    async execute(sql, params) {
      const result = await client.query(sql, params);
      return result.rows as unknown[];
    },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    await pool.query(`create schema ${schema}`);
    await pool.query(
      `create table ${schema}.zatca_invoice (
         id text primary key,
         order_id text not null,
         document_type text not null,
         invoice_type text not null,
         source_type text not null,
         source_id text not null,
         parent_invoice_id text,
         billing_reference text,
         reason text,
         lines_snapshot jsonb,
         uuid text not null unique,
         icv integer not null unique,
         pih text not null,
         invoice_hash text not null,
         xml text not null,
         qr_code text,
         status text not null,
         unique (source_type, source_id)
       )`,
    );
  });

  afterAll(async () => {
    await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`truncate table ${schema}.zatca_invoice`);
  });

  const generateDocument = async (input: GenerateInvoiceInput) => {
    const client = await pool.connect();
    try {
      await client.query(`set search_path to ${schema}`);
      await client.query("begin");
      const ex = executor(client);
      const record = await generatePendingInvoice(
        ex,
        input,
        async (r) => {
          await client.query(
            `insert into zatca_invoice
               (id, order_id, document_type, invoice_type, source_type, source_id,
                parent_invoice_id, billing_reference, reason, lines_snapshot,
                uuid, icv, pih, invoice_hash, xml, qr_code, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              `zatinv_${r.icv}`,
              r.order_id,
              r.document_type,
              r.invoice_type,
              r.source_type,
              r.source_id,
              r.parent_invoice_id,
              r.billing_reference,
              r.reason,
              JSON.stringify(r.lines_snapshot),
              r.uuid,
              r.icv,
              r.pih,
              r.invoice_hash,
              r.xml,
              r.qr_code,
              r.status,
            ],
          );
        },
      );
      await client.query("commit");
      return record;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  };

  it("persists one invoice and multiple notes for the same order by source key", async () => {
    const orderId = "order_lifecycle";
    const invoice = await generateDocument({
      ...goldenInput,
      uuid: "22222222-2222-4222-8222-222222222222",
      orderId,
      serialNumber: "INV-LIFE-1",
    });
    const parentInvoiceId = `zatinv_${invoice.icv}`;

    await generateDocument({
      ...goldenInput,
      uuid: "33333333-3333-4333-8333-333333333333",
      orderId,
      serialNumber: "CN-LIFE-1",
      documentType: "credit_note",
      sourceType: "refund",
      sourceId: "refund_lifecycle_1",
      parentInvoiceId,
      billingReference: "INV-LIFE-1",
      reason: "Refund",
    });
    await generateDocument({
      ...goldenInput,
      uuid: "44444444-4444-4444-8444-444444444444",
      orderId,
      serialNumber: "CN-LIFE-2",
      documentType: "credit_note",
      sourceType: "return",
      sourceId: "return_lifecycle_1",
      parentInvoiceId,
      billingReference: "INV-LIFE-1",
      reason: "Return received",
    });

    const { rows } = await pool.query<{
      document_type: string;
      source_type: string;
      source_id: string;
      parent_invoice_id: string | null;
      billing_reference: string | null;
      reason: string | null;
    }>(
      `select document_type, source_type, source_id, parent_invoice_id,
              billing_reference, reason
         from ${schema}.zatca_invoice
        where order_id = $1
        order by icv asc`,
      [orderId],
    );

    expect(rows).toEqual([
      {
        document_type: "invoice",
        source_type: "order",
        source_id: orderId,
        parent_invoice_id: null,
        billing_reference: null,
        reason: null,
      },
      {
        document_type: "credit_note",
        source_type: "refund",
        source_id: "refund_lifecycle_1",
        parent_invoice_id: parentInvoiceId,
        billing_reference: "INV-LIFE-1",
        reason: "Refund",
      },
      {
        document_type: "credit_note",
        source_type: "return",
        source_id: "return_lifecycle_1",
        parent_invoice_id: parentInvoiceId,
        billing_reference: "INV-LIFE-1",
        reason: "Return received",
      },
    ]);
  }, 30_000);

  it("parallel generations persist a correctly linked, signed pending chain", async () => {
    const inputs: GenerateInvoiceInput[] = Array.from({ length: 8 }, (_, i) => {
      if (i % 3 === 1) {
        return {
          ...goldenInput,
          uuid: undefined,
          orderId: `order_mixed_${i}`,
          serialNumber: `CN-MIXED-${i}`,
          documentType: "credit_note",
          sourceType: "refund",
          sourceId: `refund_mixed_${i}`,
          parentInvoiceId: "zatinv_original",
          billingReference: "INV-ORIGINAL",
          reason: "Refund",
        };
      }
      if (i % 3 === 2) {
        return {
          ...goldenInput,
          uuid: undefined,
          orderId: `order_mixed_${i}`,
          serialNumber: `DN-MIXED-${i}`,
          documentType: "debit_note",
          sourceType: "order_edit",
          sourceId: `edit_mixed_${i}`,
          parentInvoiceId: "zatinv_original",
          billingReference: "INV-ORIGINAL",
          reason: "Order edit increase",
        };
      }
      return {
        ...goldenInput,
        uuid: undefined,
        orderId: `order_mixed_${i}`,
        serialNumber: `INV-MIXED-${i}`,
      };
    });

    await Promise.all(
      inputs.map((input) => generateDocument(input)),
    );

    const { rows } = await pool.query<{
      icv: number;
      pih: string;
      invoice_hash: string;
      xml: string;
      qr_code: string;
      status: string;
      document_type: string;
    }>(
      `select icv, pih, invoice_hash, xml, qr_code, status, document_type
         from ${schema}.zatca_invoice
        where order_id like 'order_mixed_%'
        order by icv asc`,
    );

    expect(rows).toHaveLength(inputs.length);
    expect(new Set(rows.map((row) => row.document_type))).toEqual(
      new Set(["invoice", "credit_note", "debit_note"]),
    );
    rows.forEach((row) => {
      expect(row.status).toBe("pending");
      // Signed and QR-stamped; stored hash is the real hash of the stored XML.
      expect(row.xml).toContain("<ds:SignatureValue>");
      expect(row.xml).toContain(row.qr_code);
      expect(row.invoice_hash).toBe(computeInvoiceHash(row.xml));
    });
    expect(rows[0]!.pih).toBe(SEED_PIH);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.pih).toBe(rows[i - 1]!.invoice_hash);
    }
  }, 30_000);
});
