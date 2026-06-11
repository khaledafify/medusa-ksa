import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
      invoice_type: "simplified",
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

  it("parallel generations persist a correctly linked, signed pending chain", async () => {
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) => generateForOrder(`order_${i}`)),
    );

    const { rows } = await pool.query<{
      icv: number;
      pih: string;
      invoice_hash: string;
      xml: string;
      qr_code: string;
      status: string;
    }>(
      `select icv, pih, invoice_hash, xml, qr_code, status from ${schema}.zatca_invoice order by icv asc`,
    );

    expect(rows).toHaveLength(N);
    rows.forEach((row, idx) => {
      expect(row.icv).toBe(idx + 1);
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
