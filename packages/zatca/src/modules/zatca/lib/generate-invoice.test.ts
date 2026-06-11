import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  generatePendingInvoice,
  type GenerateInvoiceInput,
  type PendingZatcaInvoiceRecord,
} from "./generate-invoice";
import { type ChainHead, SEED_PIH, type SqlExecutor } from "./hash-chain";
import { canonicalizeForHashing, computeInvoiceHash } from "./invoice-hash";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const goldenXml = readFileSync(join(FIXTURES, "simplified-invoice.xml"), "utf8");

/** Invoice hash of the golden sample, confirmed via `fatoora -generateHash`. */
const GOLDEN_HASH = "Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=";

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

describe("generatePendingInvoice (golden gate)", () => {
  it("allocates ICV/PIH from the chain and reproduces the golden XML + hash", async () => {
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
    expect(record.invoice_hash).toBe(GOLDEN_HASH);
    expect(canonicalizeForHashing(record.xml)).toBe(canonicalizeForHashing(goldenXml));

    expect(record).toMatchObject({
      order_id: "order_golden",
      invoice_type: "simplified",
      uuid: goldenInput.uuid,
      status: "pending",
      qr_code: null,
    });
    // Persisted (inside the caller's transaction) before returning.
    expect(persisted).toEqual([record]);
  });

  it("starts a fresh chain at ICV 1 with the seed PIH", async () => {
    const record = await generatePendingInvoice(
      fakeExecutor(null),
      goldenInput,
      () => Promise.resolve(),
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
      () => Promise.resolve(),
    );
    expect(record.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(record.xml).toContain(`<cbc:UUID>${record.uuid}</cbc:UUID>`);
  });

  it("does not persist when the build fails", async () => {
    const persisted: PendingZatcaInvoiceRecord[] = [];
    await expect(
      generatePendingInvoice(
        fakeExecutor(null),
        { ...goldenInput, lines: [] },
        (r) => {
          persisted.push(r);
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow();
    expect(persisted).toHaveLength(0);
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
         order_id text not null unique,
         invoice_type text not null,
         uuid text not null unique,
         icv integer not null unique,
         pih text not null,
         invoice_hash text not null,
         xml text not null,
         qr_code text,
         status text not null
       )`,
    );
  });

  afterAll(async () => {
    await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
  });

  const generateForOrder = async (orderId: string) => {
    const client = await pool.connect();
    try {
      await client.query(`set search_path to ${schema}`);
      await client.query("begin");
      const ex = executor(client);
      const record = await generatePendingInvoice(
        ex,
        { ...goldenInput, uuid: undefined, orderId },
        async (r) => {
          await client.query(
            `insert into zatca_invoice
               (id, order_id, invoice_type, uuid, icv, pih, invoice_hash, xml, qr_code, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              `zatinv_${r.icv}`,
              r.order_id,
              r.invoice_type,
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

  it("parallel generations persist a correctly linked pending chain", async () => {
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) => generateForOrder(`order_${i}`)),
    );

    const { rows } = await pool.query(
      `select icv, pih, invoice_hash, xml, status from ${schema}.zatca_invoice order by icv asc`,
    );

    expect(rows).toHaveLength(N);
    rows.forEach((row, idx) => {
      expect(row.icv).toBe(idx + 1);
      expect(row.status).toBe("pending");
      // Stored hash is the real hash of the stored XML.
      expect(row.invoice_hash).toBe(computeInvoiceHash(row.xml));
    });
    expect(rows[0].pih).toBe(SEED_PIH);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].pih).toBe(rows[i - 1].invoice_hash);
    }
  }, 30_000);
});
